import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  SWAGGER_BEARER,
  SWAGGER_CSRF,
  SWAGGER_REFRESH_COOKIE,
} from './swagger';

const DESCRIPTION = `
Backend del CRM SaaS multi-tenant.

### Cómo probar la autenticación desde aquí

1. **POST /auth/register**: crea tu cuenta y tu primer workspace.
2. Abre **Mailpit** en <a href="http://localhost:8025" target="_blank">http://localhost:8025</a> para ver el email de verificación (el token viene en el texto).
3. **POST /auth/email/verify** con ese token. Es opcional: también puedes iniciar sesión sin verificar.
4. **POST /auth/login**: el \`accessToken\` se aplica solo en **Authorize** (candado). Las cookies \`crm_rt\` (refresh, HttpOnly) y \`crm_csrf\` quedan guardadas en el navegador.
5. Prueba **GET /users/me**, **GET /auth/sessions**, etc.
6. **POST /auth/refresh** rota el refresh token y renueva el access token (el header \`X-CSRF-Token\` se añade automáticamente).
7. **POST /auth/logout** cierra la sesión y quita la autorización.

Recuperar contraseña: **POST /auth/password/forgot**, luego el token de Mailpit en **POST /auth/password/reset**.

**Planes:** \`GET /billing/plans\` (público). La suscripción de un workspace está en \`/workspaces/{workspaceId}/subscription\`; el \`workspaceId\` sale de \`GET /users/me\`.

Los errores siguen siempre el formato \`{ statusCode, error, message, requestId, timestamp, path }\`.
`;

/**
 * Swagger UI options are serialized with Function#toString and run in the
 * browser, so these interceptors must be self-contained function expressions
 * (no imports, no outer variables).
 */
const requestInterceptor = function (request: {
  headers: Record<string, string>;
}) {
  const doc = (globalThis as unknown as { document?: { cookie: string } })
    .document;
  const match = doc ? /(?:^|;\s*)crm_csrf=([^;]+)/.exec(doc.cookie) : null;
  const csrf = match?.[1];
  if (csrf) request.headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  return request;
};

const responseInterceptor = function (response: {
  url: string;
  status: number;
  body?: unknown;
}) {
  const ui = (
    globalThis as unknown as {
      ui?: {
        preauthorizeApiKey: (name: string, value: string) => void;
        authActions: { logout: (names: string[]) => void };
      };
    }
  ).ui;
  if (!ui) return response;

  if (
    response.status === 200 &&
    /\/api\/v1\/auth\/(login|refresh)$/.test(response.url)
  ) {
    const token = (response.body as { accessToken?: unknown } | undefined)
      ?.accessToken;
    if (typeof token === 'string') ui.preauthorizeApiKey('access-token', token);
  }
  if (
    /\/api\/v1\/auth\/logout$/.test(response.url) ||
    (response.status === 401 && /\/api\/v1\/auth\/refresh$/.test(response.url))
  ) {
    ui.authActions.logout(['access-token']);
  }
  return response;
};

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CRM SaaS API')
      .setDescription(DESCRIPTION)
      .setVersion('1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Access token from POST /auth/login (applied automatically in this UI).',
        },
        SWAGGER_BEARER,
      )
      .addCookieAuth(
        'crm_rt',
        {
          type: 'apiKey',
          in: 'cookie',
          description:
            'HttpOnly refresh token cookie set by login/refresh. The browser sends it for you.',
        },
        SWAGGER_REFRESH_COOKIE,
      )
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description:
            'Must equal the crm_csrf cookie. Added automatically in this UI.',
        },
        SWAGGER_CSRF,
      )
      .addTag('auth', 'Registro, login, tokens, contraseñas y sesiones')
      .addTag('users', 'Perfil del usuario autenticado')
      .addTag(
        'billing',
        'Planes, precios, prueba gratuita y suscripción de cada workspace',
      )
      .addTag('health', 'Disponibilidad del servicio y sus dependencias')
      .build(),
  );

  // The UI keeps the token in localStorage: dev tool only (disabled in production by default).
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'CRM API · Swagger',
    jsonDocumentUrl: 'docs/openapi.json',
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
      docExpansion: 'list',
      requestInterceptor,
      responseInterceptor,
    },
  });
}
