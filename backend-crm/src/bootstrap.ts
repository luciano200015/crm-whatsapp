import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './shared/http/swagger-setup';

/**
 * HTTP-level setup shared by main.ts and e2e tests, so tests exercise the
 * same middleware, prefix and validation as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  // req.ip (rate limiting, sessions, audit) must reflect the real client.
  (app as NestExpressApplication).set('trust proxy', config.get('TRUST_PROXY'));

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Validation errors still say which field failed, but never echo values.
      validationError: { target: false, value: false },
    }),
  );

  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) setupSwagger(app);
}
