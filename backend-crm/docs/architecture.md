# Arquitectura

## Estilo

Monolito modular en NestJS. Sin microservicios en esta etapa. Cada módulo de negocio es dueño de sus datos y expone casos de uso; los módulos no acceden a las tablas de otros directamente.

Dentro de un módulo se separan capas **solo cuando la complejidad lo justifica**:

```
src/modules/<módulo>/
  presentation/    controladores, DTOs, decoradores
  application/     casos de uso (orquestan dominio + puertos)
  domain/          reglas puras, sin Nest ni Prisma
  infrastructure/  repositorios Prisma/Mongoose, adaptadores externos
```

No se crean carpetas ni archivos vacíos para "cumplir" la estructura.

## Reglas

1. **PostgreSQL** es la fuente de verdad para identidad, autorización, workspaces y facturación futura.
2. **MongoDB** guarda contactos, conversaciones, mensajes y demás datos operativos.
3. Todo documento de negocio en MongoDB lleva `workspaceId`; toda consulta filtra por él (aislamiento lógico, sin base de datos por workspace).
4. Un usuario puede pertenecer a varios workspaces con roles distintos en cada uno.
5. Los permisos se asignan a roles, y los roles a **membresías** (no al usuario global).
6. Nunca se confía en `workspaceId`, roles ni permisos enviados por el cliente: se resuelven en el servidor en cada operación protegida.
7. Los JWT identifican al usuario; **no** sustituyen la comprobación de membresía y permisos (que pueden revocarse).
8. Casos de uso dependen de interfaces (puertos), no de Prisma, Mongoose ni proveedores externos.
9. Contraseñas con Argon2id; refresh, reset, verificación e invitaciones guardados solo como hash.
10. Sin secretos en el repositorio. `.env*` está en `.gitignore` salvo los `*.example`.
11. Sin `any` (ESLint `no-explicit-any: error`) y sin `catch` vacíos (`no-empty: error`).

## Módulos previstos

| Módulo           | Responsabilidad                                   | Estado |
| ---------------- | ------------------------------------------------- | ------ |
| `config`         | Validación centralizada del entorno               | Hecho  |
| `database/postgres` | Prisma + migraciones                           | Hecho  |
| `database/mongodb`  | Conexión Mongoose                              | Conexión hecha; convenciones en Fase 5 |
| `health`         | Liveness/readiness                                | Hecho  |
| `authorization`  | Catálogo de permisos, guards, resolución de permisos | Hecho: catálogo, `JwtAuthGuard` global, `AuthorizationService` y `WorkspaceAccessGuard` + `@RequirePermissions()` |
| `billing`        | Planes, precios, límites, suscripciones por workspace, prueba gratuita | Hecho sin pasarela de pago real, ver [billing.md](billing.md) |
| `auth`           | Registro, login, refresh, logout, recuperación, sesiones | Hecho (Fase 2), ver [authentication.md](authentication.md) |
| `users`          | Perfil propio (`/users/me`)                       | Hecho (Fase 2) |
| `audit`          | Registro de operaciones sensibles                 | Hecho (servicio con saneado de metadata) |
| `workspaces`, `memberships`, `invitations` | Espacios de trabajo y miembros | Fase 3 |

Las sesiones viven dentro de `auth` (son la familia de refresh tokens); no justifican un módulo propio por ahora.

Puertos actuales: `AuthStore`, `PasswordHasher`, `AccessTokens` (auth), `Mailer` (shared/mail) y `Clock` (shared/time). `UsersService` usa Prisma directamente porque solo hace lecturas y actualizaciones simples del propio perfil; si crece, se extraerá un puerto.

`auth` no depende de `billing`: depende del puerto `InitialSubscriptionProvider` (qué plan recibe un workspace nuevo), que implementa `BillingService`. Así el registro crea la suscripción en la misma transacción sin acoplar los módulos. Pagos reales y mensajería se añadirán como módulos o adaptadores propios.

## Capa HTTP (`src/bootstrap.ts`)

Compartida por `main.ts` y las pruebas e2e:

- Prefijo `/api` y versionado por URI (`/api/v1/...`).
- `helmet` (cabeceras de seguridad), CORS con lista blanca y `credentials: true`.
- `cookie-parser` (cookie de refresh en Fase 2).
- `ValidationPipe` global: `whitelist`, `forbidNonWhitelisted`, `transform`; los errores no devuelven los valores recibidos.
- Swagger en `/docs`, desactivado por defecto en producción.

## Errores y logs

- `AllExceptionsFilter` da un formato único `{ statusCode, error, message, requestId, timestamp, path }`. Los errores 5xx se registran con stack en el servidor y se devuelven como `Internal server error`. Errores Prisma conocidos: `P2002`/`P2003` → 409, `P2025` → 404.
- Logs JSON con `nestjs-pino`. Se redactan `Authorization`, `Cookie`, `Set-Cookie`, `X-CSRF-Token` y campos `password`/`token`/`secret`. Las URLs se registran sin query string.
- Cada petición tiene `X-Request-Id` (se reutiliza el entrante si es seguro; si no, se genera un UUID).
