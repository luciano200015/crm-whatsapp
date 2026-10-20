/**
 * Exposes ONLY the WhatsApp webhook of the local API to the internet, so Meta
 * can reach it while you develop. The tunnel points at a small filter in
 * front of the API: any other request (login, Swagger, the rest of the API)
 * gets 404 without reaching it, and bodies over 3 MB are refused.
 *
 *   npm run tunnel                       # Cloudflare quick tunnel, no account
 *   npm run tunnel -- --ngrok            # ngrok (needs its authtoken)
 *   npm run tunnel -- --ngrok --domain my-name.ngrok-free.app   # fixed URL
 *
 * Prints the PUBLIC_API_URL to put in .env. Reads PORT from .env.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
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
      ngrok: { type: 'boolean', default: false },
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
    if (values.ngrok) startNgrok(filterPort, values.domain);
    else startCloudflare(filterPort);
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
      announce(entry.url);
    } else if (entry.lvl === 'eror' || entry.lvl === 'crit') {
      const error = entry.err ?? entry.msg ?? line;
      if (!shown.has(error)) {
        shown.add(error);
        console.error(`ngrok: ${error}`);
      }
    }
  });

  stopWith(ngrok);
}

/**
 * Cloudflare quick tunnel: no account, a new *.trycloudflare.com URL each
 * time it starts (paste it again in Meta after a restart).
 */
function startCloudflare(port: number): void {
  const cloudflared = spawn(
    cloudflaredPath(),
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  cloudflared.on('error', (error) => {
    console.error(
      `Could not start cloudflared (${error.message}). Install it with: winget install Cloudflare.cloudflared`,
    );
    process.exit(1);
  });
  cloudflared.on('exit', (code) => process.exit(code ?? 0));

  // cloudflared logs to stderr: the URL, then the connections and errors.
  const shown = new Set<string>();
  createInterface({ input: cloudflared.stderr }).on('line', (line) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0];
    if (url && !shown.has(url)) {
      shown.add(url);
      announce(url);
    } else if (/ ERR /.test(line)) {
      const error = line.replace(/^\S+ ERR /, '');
      if (!shown.has(error)) {
        shown.add(error);
        console.error(`cloudflared: ${error}`);
      }
    } else if (/Registered tunnel connection/.test(line) && !shown.has('up')) {
      shown.add('up');
      console.log('Connected to Cloudflare.');
    }
  });

  stopWith(cloudflared);
}

/** The Windows installer puts it outside the PATH of shells opened before. */
function cloudflaredPath(): string {
  const installed = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  return process.platform === 'win32' && existsSync(installed)
    ? installed
    : 'cloudflared';
}

function announce(url: string): void {
  console.log('\nTunnel ready. Only the WhatsApp webhook is reachable.');
  console.log(
    `Put this in .env and restart the API:\n\n  PUBLIC_API_URL=${url}\n`,
  );
}

function stopWith(child: ChildProcess): void {
  const stop = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
