import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

describe('Application (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('GET /api/v1/health/live reports the process is up', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200)
        .expect({ status: 'ok' });
    });

    it('GET /api/v1/health/ready reports PostgreSQL and MongoDB up', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        info: { postgres: { status: 'up' }, mongodb: { status: 'up' } },
      });
    });
  });

  describe('errors', () => {
    it('returns a uniform 404 body without internals', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        path: '/api/v1/does-not-exist',
      });
      expect(typeof (response.body as { requestId?: unknown }).requestId).toBe(
        'string',
      );
      expect(JSON.stringify(response.body)).not.toMatch(/stack|at \w+ \(/);
    });
  });

  describe('HTTP hardening', () => {
    it('sets security headers and a request id', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-request-id']).toMatch(/^[\w.-]+$/);
    });

    it('reuses a well-formed incoming request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('X-Request-Id', 'trace-abc.123');

      expect(response.headers['x-request-id']).toBe('trace-abc.123');
    });

    it.each(['<script>alert(1)</script>', 'has spaces', 'x'.repeat(65)])(
      'replaces the unsafe incoming request id %p',
      async (unsafe) => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/health/live')
          .set('X-Request-Id', unsafe);

        expect(response.headers['x-request-id']).not.toBe(unsafe);
        expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      },
    );

    it('allows CORS only for configured origins', async () => {
      const allowed = await request(app.getHttpServer())
        .options('/api/v1/health/live')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');
      expect(allowed.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');

      const denied = await request(app.getHttpServer())
        .options('/api/v1/health/live')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not expose Swagger when disabled', async () => {
      await request(app.getHttpServer()).get('/docs').expect(404);
    });
  });
});
