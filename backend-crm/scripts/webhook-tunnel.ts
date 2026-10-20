/**
 * Exposes ONLY the WhatsApp webhook of the local API to the internet, so Meta
 * can reach it while you develop. ngrok points at a small filter in front of
 * the API: any other request (login, Swagger, the rest of the API) gets 404
 * without reaching it, and bodies over 3 MB are refused.
 *
 *   npm run tunnel
 *   npm run tunnel -- --domain my-name.ngrok-free.app   # fixed URL
 *
 * Prints the PUBLIC_API_URL to put in .env. Needs ngrok logged in to your
 * account (`ngrok config add-authtoken …`). Reads PORT from .env.
 */
import { spawn } from 'node:child_process';
import { config } from 'dotenv';
import { createServer, request } from 'node:http';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

config({ path: resolve(__dirname, '../.env'), quiet: true });

/** Meta only calls GET (verification) and POST (events) on a line's URL. */
const WEBHOOK_PATH = /^\/api\/v1\/webhooks\/whatsapp\/[0-9a-f-]{36}(\?|$)/i;
const MAX_BODY_BYTES = 3 * 1024 * 1024;

function main(): void {
  const { values } = parseArgs({
    options: {
      domain: { type: 'string' },
      port: { type: 'string', default: '3001' },
    },
  });
  const apiPort = Number(process.env.PORT ?? 3000);
  const filterPort = Number(values.port);

  const filter = createServer((incoming, outgoing) => {
    const allowed =
      (incoming.method === 'GET' || incoming.method === 'POST') &&
      WEBHOOK_PATH.test(incoming.url ?? '');
    if (!allowed) {
      outgoing
        .writeHead(404, { 'Content-Type': 'text/plain' })
        .end('Not found');
      return;
    }
    if (Number(incoming.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      outgoing.writeHead(413).end();
      incoming.destroy();
      return;
    }

    const upstream = request(
      {
        host: '127.0.0.1',
        port: apiPort,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, host: `localhost:${apiPort}` },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });

    let received = 0;
    incoming.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        upstream.destroy();
        outgoing.writeHead(413).end();
        incoming.destroy();
      }
    });
    incoming.pipe(upstream);
  });

  filter.listen(filterPort, '127.0.0.1', () => {
    console.log(
      `Webhook filter on 127.0.0.1:${filterPort} → API on localhost:${apiPort}`,
    );
    startNgrok(filterPort, values.domain);
  });
}

function startNgrok(port: number, domain: string | undefined): void {
  const ngrok = spawn(
    'ngrok',
    [
      'http',
      `127.0.0.1:${port}`,
      '--log',
      'stdout',
      '--log-format',
      'json',
      ...(domain ? ['--domain', domain] : []),
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  ngrok.on('error', (error) => {
    console.error(`Could not start ngrok: ${error.message}`);
    process.exit(1);
  });
  // ngrok retries and repeats its errors: show each one once.
  const shown = new Set<string>();
  ngrok.on('exit', (code) => {
    if (code && shown.size === 0)
      console.error(`ngrok exited with code ${code}`);
    if ([...shown].some((error) => error.includes('ERR_NGROK_105'))) {
      console.error(
        'Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken and run: ngrok config add-authtoken <token>',
      );
    }
    process.exit(code ?? 0);
  });

  createInterface({ input: ngrok.stdout }).on('line', (line) => {
    let entry: { lvl?: string; msg?: string; url?: string; err?: string };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      return;
    }
    if (entry.msg === 'started tunnel' && entry.url) {
      console.log('\nTunnel ready. Only the WhatsApp webhook is reachable.');
      console.log(
        `Put this in .env and restart the API:\n\n  PUBLIC_API_URL=${entry.url}\n`,
      );
    } else if (entry.lvl === 'eror' || entry.lvl === 'crit') {
      const error = entry.err ?? entry.msg ?? line;
      if (!shown.has(error)) {
        shown.add(error);
        console.error(`ngrok: ${error}`);
      }
    }
  });

  const stop = () => {
    ngrok.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
