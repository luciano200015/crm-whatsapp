import { Injectable } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { BotRequest, BotResponse } from '../domain/bot-request';
import { isPublicAddress } from '../domain/ip-guard';
import { BotHttpClient } from '../application/ports';

/** Longest wait for an external service. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Largest answer read. */
export const MAX_RESPONSE_BYTES = 100 * 1024;

const failed = (error: string): BotResponse => ({
  ok: false,
  status: 0,
  body: null,
  error,
});

/**
 * Resolves the host and refuses non-public addresses. The connection goes
 * to the address checked here, so a DNS answer cannot change in between.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 4);
    const [first] = addresses;
    const blocked = addresses.find(({ address }) => !isPublicAddress(address));
    if (!first || blocked)
      return callback(
        Object.assign(new Error('Dirección no permitida'), {
          code: 'EBLOCKED',
        }),
        '',
        4,
      );
    if (options.all) return callback(null, addresses);
    return callback(null, first.address, first.family);
  });
};

/**
 * «Consulta API» over HTTPS only, to public addresses, without following
 * redirects, with a 10 s timeout and answers up to 100 KB.
 */
@Injectable()
export class HttpsBotClient extends BotHttpClient {
  send(req: BotRequest): Promise<BotResponse> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return Promise.resolve(failed('URL inválida'));
    }
    if (url.protocol !== 'https:')
      return Promise.resolve(failed('Solo se permiten URL https://'));
    if (url.username || url.password)
      return Promise.resolve(failed('La URL no puede llevar usuario'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host))
      return Promise.resolve(failed('Dirección no permitida'));

    return new Promise((resolve) => {
      let settled = false;
      const finish = (response: BotResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      const outgoing = request(
        url,
        {
          method: req.method,
          headers: {
            'User-Agent': 'CRM-Chatbot',
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
            ...req.headers,
            ...(req.body !== null && {
              'Content-Length': Buffer.byteLength(req.body),
            }),
          },
          lookup: publicLookup,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          const chunks: Buffer[] = [];
          let size = 0;
          incoming.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              outgoing.destroy();
              finish(failed('La respuesta supera 100 KB'));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: unknown = text;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              // Not JSON: the text itself.
            }
            const redirect = status >= 300 && status < 400;
            finish({
              ok: status >= 200 && status < 300,
              status,
              body,
              ...(redirect && { error: 'Las redirecciones no se siguen' }),
            });
          });
          incoming.on('error', () => finish(failed('La conexión se cortó')));
        },
      );
      const timer = setTimeout(() => {
        outgoing.destroy();
        finish(failed('El servicio tardó más de 10 s'));
      }, REQUEST_TIMEOUT_MS);
      outgoing.on('timeout', () => {
        outgoing.destroy();
        finish(failed('El servicio tardó más de 10 s'));
      });
      outgoing.on('error', (error: NodeJS.ErrnoException) =>
        finish(
          failed(
            error.code === 'EBLOCKED'
              ? 'Dirección no permitida'
              : 'No se pudo conectar con el servicio',
          ),
        ),
      );
      if (req.body !== null) outgoing.write(req.body);
      outgoing.end();
    });
  }
}
