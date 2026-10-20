import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfigService } from '../../config/app-config.service';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Paths redacted from every log line. Credentials must never reach logs,
 * even at debug level.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.appSecret',
  'req.headers["x-hub-signature-256"]',
];

export function buildLoggerParams(config: AppConfigService): Params {
  const isDevelopment = config.get('NODE_ENV') === 'development';

  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      // Reuse a well-formed upstream request id, otherwise mint one.
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id =
          typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // Keep request logs small: no query strings (may carry tokens).
      serializers: {
        req: (req: { id: unknown; method: unknown; url?: unknown }) => ({
          id: req.id,
          method: req.method,
          path: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
        }),
        res: (res: { statusCode: unknown }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          req.url?.includes('/health/live') ?? false,
      },
      transport: isDevelopment
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    },
  };
}
