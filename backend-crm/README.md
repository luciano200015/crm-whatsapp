# backend-crm

Backend de un CRM SaaS multi-tenant construido como **monolito modular** con NestJS y TypeScript estricto.

| Almacén        | Uso                                                                 |
| -------------- | ------------------------------------------------------------------- |
| PostgreSQL 18  | Fuente de verdad: identidad, sesiones, workspaces, roles, permisos, auditoría (y facturación futura). Acceso vía Prisma 7. |
| MongoDB 8      | Datos operativos del CRM (contactos, conversaciones, mensajes). Acceso vía Mongoose 9. |
| Redis 8        | Reservado para caché y rate limiting distribuido (aún no conectado). |
| Mailpit        | Bandeja de correo de desarrollo: captura todos los emails (UI en http://localhost:8025). |

## Inicio rápido

Con Docker Desktop abierto y `.env` / `.env.test` ya creados (ver sección 2):

```bash
npm ci                          # dependencias + cliente Prisma
npm run docker:up               # PostgreSQL (5433), MongoDB (27018) y Mailpit (8025)
npm run prisma:migrate:deploy   # crea las tablas
npm run db:seed                 # roles y permisos
npm run start:dev               # API en http://localhost:3000
```

Está corriendo si http://localhost:3000/api/v1/health/ready devuelve `"status":"ok"`.

| Qué | Dónde |
| --- | ----- |
| **Swagger UI** (probar la API) | http://localhost:3000/docs |
| Especificación OpenAPI (JSON) | http://localhost:3000/docs/openapi.json |
| **Mailpit** (emails de verificación y recuperación) | http://localhost:8025 |
| **Frontend** (proyecto aparte, [`../frontend-crm`](../frontend-crm)) | http://localhost:5173 |

Guía paso a paso para probar registro, login, refresh y logout desde Swagger: [sección 4](#4-probar-la-api-con-swagger). Usuarios de prueba: [datos demo](#datos-demo-desarrollo).

> Estado actual: Fases **0** (infraestructura), **1** (modelo PostgreSQL), **2** (autenticación), **planes y suscripciones** con prueba gratuita ([docs/billing.md](docs/billing.md)) y el guard de permisos por workspace. Workspaces e invitaciones (Fase 3) están pendientes. Ver [docs/limitations.md](docs/limitations.md).

---

## 1. Requisitos

| Herramienta     | Versión            | Comprobar                 |
| --------------- | ------------------ | ------------------------- |
| Node.js         | ≥ 22.12 (recomendado 24, ver `.nvmrc`) | `node --version` |
| npm             | ≥ 10               | `npm --version`           |
| Docker Desktop  | ≥ 4.x con Compose v2 | `docker compose version` |
| Git             | cualquiera reciente | `git --version`          |

### Instalar Docker Desktop

**Windows** (PowerShell):

```powershell
winget install -e --id Docker.DockerDesktop
```

Después:

1. Acepta el aviso de administrador (UAC) y reinicia si Windows lo pide.
2. Abre Docker Desktop una vez y acepta sus términos de servicio. Docker Desktop es gratuito para uso personal, educativo y empresas de menos de 250 empleados y menos de 10 M USD de ingresos anuales; en otro caso requiere suscripción de pago.
3. Docker Desktop en Windows usa WSL 2. Si no está instalado, ejecuta `wsl --install` en una terminal de administrador y reinicia.
4. Comprueba: `docker version` y `docker compose version`.

**macOS**: `brew install --cask docker` o el instalador de docker.com. **Linux**: Docker Engine + plugin `docker-compose-plugin` de tu distribución.

---

## 2. Puesta en marcha (primera vez)

```bash
# 1. Dependencias (también genera el cliente Prisma vía postinstall)
npm ci

# 2. Variables de entorno
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
cp .env.test.example .env.test  # Windows PowerShell: Copy-Item .env.test.example .env.test
```

Edita `.env` y `.env.test`:

- Sustituye **todos** los `change-me` por contraseñas propias.
- La contraseña de `POSTGRES_PASSWORD` debe coincidir con la de `DATABASE_URL` (y la de `MONGO_ROOT_PASSWORD` con la de `MONGODB_URI`), en ambos archivos.
- Si la contraseña contiene caracteres especiales (`@ : / ? # %`), codifícala en las URLs (`encodeURIComponent`).
- Genera los secretos de tokens y pega las tres líneas que imprime en lugar de `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` y `TOKEN_HASH_SECRET`. Ejecútalo **una vez para `.env` y otra para `.env.test`** (valores distintos):

```bash
npm run secrets:generate
```

```bash
# 3. Levantar PostgreSQL, MongoDB y Mailpit (espera a que estén "healthy")
npm run docker:up

# 4. Aplicar migraciones y datos iniciales (roles y permisos)
npm run prisma:migrate:deploy
npm run db:seed

# 5. Arrancar la API en modo desarrollo (recarga automática)
npm run start:dev
```

Comprobaciones:

| URL                                         | Esperado                                  |
| ------------------------------------------- | ----------------------------------------- |
| http://localhost:3000/api/v1/health/live    | `{"status":"ok"}`                         |
| http://localhost:3000/api/v1/health/ready   | `status: ok` con `postgres` y `mongodb` en `up` |
| http://localhost:3000/docs                  | Swagger UI (solo si `SWAGGER_ENABLED=true`) |

### Puertos locales

Los contenedores publican puertos **desplazados** y solo en `127.0.0.1`, para no chocar con servicios instalados en la máquina:

| Servicio   | Puerto host | Puerto contenedor |
| ---------- | ----------- | ----------------- |
| PostgreSQL | 5433        | 5432              |
| MongoDB    | 27018       | 27017             |
| Redis      | 6380        | 6379 (perfil `cache`, opcional) |
| Mailpit    | 1025 (SMTP) / 8025 (web) | 1025 / 8025 |

---

## 3. Uso diario

```bash
npm run docker:up        # arrancar bases de datos y Mailpit
npm run start:dev        # API con watch
npm run docker:down      # parar contenedores (los datos se conservan en volúmenes)
```

Redis (todavía no lo usa la aplicación): `docker compose --profile cache up -d`.

---

## 4. Probar la API con Swagger

Abre http://localhost:3000/docs. Arriba de la página está la misma guía resumida.

1. **Registro**: abre `POST /auth/register`, pulsa **Try it out**, edita el JSON (email, contraseña de 12 caracteres o más, nombre y nombre del workspace) y pulsa **Execute**. Respuesta esperada: `202`.
2. **Email**: abre **Mailpit** (http://localhost:8025). Verás el correo *Confirm your email address* con el token.
3. **Verificar** (opcional): `POST /auth/email/verify` con `{ "token": "<token del email>" }` → `204`. La cuenta pasa a `ACTIVE`. Sin verificar también se puede iniciar sesión.
4. **Login**: `POST /auth/login` con email y contraseña → `200`. Swagger **aplica el access token automáticamente** (el candado de **Authorize** aparece cerrado). El navegador guarda las cookies `crm_rt` (refresh, HttpOnly) y `crm_csrf`.
5. **Endpoints protegidos**: `GET /users/me` (perfil, workspaces, roles y permisos), `PATCH /users/me`, `GET /auth/sessions`, `POST /auth/password/change`…
6. **Refresh**: `POST /auth/refresh` → `200`. Rota el refresh token y renueva el access token en Authorize. El header `X-CSRF-Token` lo añade Swagger por ti.
7. **Logout**: `POST /auth/logout` → `204`. Revoca la sesión y quita la autorización; los endpoints protegidos vuelven a dar `401`.

**Recuperar contraseña**: `POST /auth/password/forgot` → copia el token del email *Reset your password* en Mailpit → `POST /auth/password/reset` con `{ "token": "...", "newPassword": "..." }`. Cierra todas las sesiones de esa cuenta.

Comportamientos que vas a notar (son intencionados):

| Situación | Respuesta |
| --------- | --------- |
| Email ya registrado en `/auth/register` | `202` igual que siempre; el dueño del email recibe un aviso en Mailpit (evita enumerar cuentas). |
| Email inexistente o contraseña incorrecta en `/auth/login` | `401` con el mismo mensaje: *Invalid email or password*. |
| 5 contraseñas incorrectas seguidas | La cuenta se bloquea 15 minutos (sigue respondiendo el mismo `401`). |
| Más de `AUTH_THROTTLE_LIMIT` peticiones por minuto a `/auth/*` desde la misma IP | `429 Too Many Requests`. |
| `/auth/refresh` o `/auth/logout` sin header CSRF | `403`. Fuera de Swagger, envía `X-CSRF-Token` con el valor de la cookie `crm_csrf`. |
| Reutilizar un refresh token ya usado | `401` y se revoca **toda** la sesión (protección contra robo de tokens). |

Para probar desde Postman o curl: usa `Authorization: Bearer <accessToken>` y conserva las cookies que devuelve el login. Detalles en [docs/authentication.md](docs/authentication.md).

---

## 5. Base de datos (Prisma)

| Comando                         | Qué hace |
| ------------------------------- | -------- |
| `npm run prisma:generate`       | Regenera el cliente en `src/generated/prisma` (ignorado por git). |
| `npm run prisma:migrate:dev -- --name <nombre>` | Crea una migración nueva a partir de cambios en `prisma/schema.prisma` y la aplica en desarrollo. **Revisa el SQL generado antes de hacer commit.** |
| `npm run prisma:migrate:deploy` | Aplica migraciones pendientes (CI/producción). Nunca genera ni borra nada. |
| `npm run prisma:migrate:status` | Muestra qué migraciones faltan por aplicar. |
| `npm run db:seed`               | Sincroniza permisos, roles de sistema y sus asignaciones y, si está activado, crea los datos demo. Idempotente: se puede ejecutar cuantas veces se quiera. |

### Datos demo (desarrollo)

Con `SEED_DEMO_DATA=true` y `SEED_DEMO_PASSWORD=<12 caracteres o más>` en tu `.env`, `npm run db:seed` crea ([`prisma/seed-demo.ts`](prisma/seed-demo.ts)):

| Usuario | Membresías |
| ------- | ---------- |
| `superadmin@example.com` (el "super usuario") | OWNER de **Acme Corp** (`acme`), **Globex Industries** (`globex`) e **Initech** (`initech`) |
| `admin@example.com` | ADMIN en Acme Corp |
| `agent@example.com` | AGENT en Acme Corp y Globex |
| `viewer@example.com` | VIEWER en Acme Corp; membresía **desactivada** en Globex |

- Todos están `ACTIVE`, con el email verificado, y usan la contraseña de `SEED_DEMO_PASSWORD`.
- Cada workspace tiene un plan en un estado distinto: **Acme** Empresa anual activo, **Globex** Equipo en prueba (7 días), **Initech** Corporativo con la prueba vencida. Ver [docs/billing.md](docs/billing.md#datos-demo).
- Es idempotente: si vuelves a ejecutarlo no duplica nada ni cambia contraseñas que ya existan.
- Se niega a ejecutarse con `NODE_ENV=production`.

Para añadir un permiso: edítalo en [`src/modules/authorization/domain/permission-catalog.ts`](src/modules/authorization/domain/permission-catalog.ts) y ejecuta `npm run db:seed`.

Reiniciar completamente la base de datos de **desarrollo** (borra todos los datos locales):

```bash
docker compose down -v   # elimina los volúmenes
npm run docker:up
npm run prisma:migrate:deploy
npm run db:seed
```

---

## 6. Pruebas

| Comando              | Alcance | Necesita Docker |
| -------------------- | ------- | --------------- |
| `npm test`           | Unitarias (`src/**/*.spec.ts`) | No |
| `npm run test:int`   | Integración contra PostgreSQL (`test/integration`) | Sí |
| `npm run test:e2e`   | API completa con Supertest (`test/e2e`): auth, sesiones, JWT falsificados, CSRF, rate limiting | Sí |
| `npm run test:cov`   | Unitarias con cobertura | No |

Las pruebas de integración y e2e:

- Usan `.env.test` y la base de datos `crm_test` (creada automáticamente por `docker/postgres/init` la primera vez que se crea el volumen).
- Aplican las migraciones al empezar (`prisma migrate deploy`).
- **Se niegan a ejecutarse** si `DATABASE_URL` no apunta a una base cuyo nombre termine en `_test`, porque vacían las tablas entre pruebas.
- Sustituyen el envío de correo por una bandeja en memoria: no necesitan Mailpit.
- Ejecútalas una detrás de otra (comparten `crm_test`).

Calidad de código:

```bash
npm run lint        # ESLint (type-checked) + Prettier
npm run typecheck   # tsc --noEmit
npm run build       # compila a dist/
```

---

## 7. Estructura

```
prisma/
  schema.prisma           Modelo PostgreSQL
  migrations/             Migraciones versionadas (revisadas a mano)
  seed.ts                 Punto de entrada del seed
  seed-authorization.ts   Sincronización idempotente de roles/permisos
scripts/
  generate-secrets.mjs    Genera claves JWT ES256 y TOKEN_HASH_SECRET
src/
  config/                 Validación de variables de entorno (zod)
  database/postgres/      PrismaService
  database/mongodb/       Conexión Mongoose
  health/                 /health/live y /health/ready
  modules/
    auth/                 Registro, login, refresh, logout, contraseñas, sesiones
      domain/             Reglas puras (email, política de contraseñas, slugs)
      application/        Casos de uso (AuthService) y puertos (interfaces)
      infrastructure/     Argon2id, JWT ES256, almacén Prisma
      presentation/       Controlador, DTOs, guards (JWT global, CSRF), cookies
    users/                GET/PATCH /users/me (incluye el plan de cada workspace)
    billing/              Planes, precios, límites, suscripciones y prueba gratuita
      domain/             plan-catalog.ts (catálogo editable) y reglas de estados/periodos
      application/        BillingService, puertos (almacén, pasarela de pago), códigos de error
      infrastructure/     Almacén Prisma, pasarelas simulada/deshabilitada
    authorization/        Catálogo de permisos, AuthorizationService, WorkspaceAccessGuard
    audit/                Registro de operaciones sensibles (con saneado)
  shared/                 Excepciones, logs, mail (puerto + SMTP), hashing de tokens, Swagger
  bootstrap.ts            Helmet, CORS, trust proxy, validación, versionado, Swagger
  main.ts
test/
  integration/  e2e/  setup/  utils/
docker/postgres/init/     Scripts de inicialización del contenedor
docs/                     Documentación técnica
```

Documentación técnica:

- [docs/architecture.md](docs/architecture.md) — reglas de arquitectura y módulos.
- [docs/authentication.md](docs/authentication.md) — flujos de autenticación, tokens, cookies, CSRF y decisiones de seguridad.
- [docs/data-model.md](docs/data-model.md) — entidades, índices y decisiones del modelo.
- [docs/authorization.md](docs/authorization.md) — permisos, roles, guard por workspace y reglas de propietario.
- [docs/billing.md](docs/billing.md) — planes, precios, límites, prueba gratuita, estados y API de suscripciones.
- [docs/limitations.md](docs/limitations.md) — pendientes y limitaciones conocidas.

---

## 8. Variables de entorno

Se validan al arrancar ([`src/config/env.schema.ts`](src/config/env.schema.ts)); si alguna falta o es inválida la aplicación no arranca y el error indica el nombre de la variable (nunca su valor).

| Variable          | Obligatoria | Descripción |
| ----------------- | ----------- | ----------- |
| `NODE_ENV`        | no (`development`) | `development`, `test` o `production` |
| `PORT`            | no (`3000`) | Puerto HTTP |
| `APP_URL`         | sí | URL pública de la API |
| `CORS_ORIGINS`    | sí | Orígenes permitidos separados por comas. `*` prohibido en producción |
| `DATABASE_URL`    | sí | `postgresql://…` |
| `MONGODB_URI`     | sí | `mongodb://…` |
| `REDIS_URL`       | no | `redis://…` (aún sin uso) |
| `LOG_LEVEL`       | no (`info`) | `fatal`…`trace`, `silent` |
| `SWAGGER_ENABLED` | no | Por defecto `true` salvo en producción |
| `TRUST_PROXY`     | no (`false`) | `true` o número de proxies delante de la API (afecta a la IP usada en rate limiting y auditoría) |
| `COOKIE_DOMAIN`   | no | Dominio de las cookies; sin definir = solo el host |
| `COOKIE_SECURE`   | no (`true`) | Obligatorio `true` en producción |
| `COOKIE_SAMESITE` | no (`strict`) | `strict`, `lax` o `none` (este último exige `COOKIE_SECURE=true`) |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | sí | Par de claves ES256 en PEM codificado en base64 (`npm run secrets:generate`) |
| `TOKEN_HASH_SECRET` | sí | Secreto HMAC (≥ 32 caracteres) para guardar los tokens opacos como hash |
| `JWT_ISSUER` / `JWT_AUDIENCE` | no | Claims `iss`/`aud` emitidos y exigidos |
| `JWT_ACCESS_TTL_SECONDS` | no (`900`) | Vida del access token |
| `REFRESH_TOKEN_TTL_DAYS` | no (`7`) | Vida de cada refresh token |
| `SESSION_MAX_AGE_DAYS` | no (`30`) | Vida máxima absoluta de una sesión |
| `REFRESH_REUSE_GRACE_SECONDS` | no (`10`) | Ventana para refrescos simultáneos legítimos (ver docs/authentication.md) |
| `PASSWORD_RESET_TTL_MINUTES` | no (`30`) | Validez del enlace de recuperación |
| `EMAIL_VERIFICATION_TTL_HOURS` | no (`24`) | Validez del enlace de verificación |
| `AUTH_THROTTLE_LIMIT` / `AUTH_THROTTLE_TTL_SECONDS` | no (`10` / `60`) | Peticiones permitidas por IP y ventana en `/auth/*` |
| `WEB_APP_URL` | no (= `APP_URL`) | Base de los enlaces de los emails (frontend) |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | no | SMTP. Por defecto apunta a Mailpit (`localhost:1025`) |
| `BILLING_TRIAL_DAYS` | no (`7`) | Días de prueba gratuita al registrarse (`0` = sin prueba) |
| `BILLING_DEFAULT_PLAN` / `BILLING_DEFAULT_INTERVAL` | no (`team` / `MONTH`) | Plan y periodo asignados si el registro no elige uno |
| `BILLING_CURRENCY` | no (`USD`) | Moneda de los precios ofrecidos |
| `BILLING_PAYMENTS_MODE` | no (`disabled`) | `simulated` aprueba los pagos al instante (solo desarrollo; prohibido en producción) |
| `SEED_DEMO_DATA` / `SEED_DEMO_PASSWORD` | no | Datos demo del seed (solo desarrollo) |

Las variables `POSTGRES_*`, `MONGO_*`, `REDIS_*` y `MAILPIT_*` solo las usa Docker Compose.

---

## 9. Solución de problemas

| Síntoma | Causa probable / solución |
| ------- | ------------------------- |
| `docker: command not found` / `docker no se reconoce` | Docker Desktop no instalado o la terminal se abrió antes de instalarlo. Abre una terminal nueva. |
| `error during connect … pipe/docker_engine` | Docker Desktop no está arrancado. Ábrelo y espera a que indique *Engine running*. |
| `Invalid environment configuration` al arrancar | Falta o es inválida una variable en `.env`. El mensaje indica cuál. Si es `JWT_*` o `TOKEN_HASH_SECRET`, ejecuta `npm run secrets:generate`. |
| `P1000 Authentication failed` | La contraseña de `DATABASE_URL` no coincide con `POSTGRES_PASSWORD`. Si cambiaste la contraseña después de crear el volumen, el contenedor conserva la antigua: `docker compose down -v` (borra datos locales) y vuelve a levantar. |
| `database "crm_test" does not exist` | El volumen se creó antes de existir el script de init. Créala: `docker compose exec postgres createdb -U crm crm_test`. |
| Puerto 5433/27018/1025/8025 ocupado | Cambia `POSTGRES_PORT`/`MONGO_PORT`/`MAILPIT_SMTP_PORT`/`MAILPIT_UI_PORT` en `.env` y ajusta las URLs y `SMTP_PORT`. |
| `/health/ready` devuelve 503 | Alguna base de datos no responde: `docker compose ps` y `docker compose logs <servicio>`. |
| El registro responde 500 y los logs dicen *System role OWNER is missing* | Falta el seed: `npm run db:seed`. |
| No llega ningún email | Comprueba que Mailpit está levantado (`docker compose ps`) y abre http://localhost:8025. |
| `401` en todo tras regenerar las claves JWT | Los access tokens anteriores ya no son válidos: vuelve a hacer login. |
| `429 Too Many Requests` mientras pruebas | Espera un minuto o sube `AUTH_THROTTLE_LIMIT` en tu `.env` local. |

---

## 10. Versiones fijadas

NestJS 11.1, Prisma 7.10.1, Mongoose 9, TypeScript 5.9, Jest 30, zod 4, argon2 0.45, nodemailer 10. Los motivos para no usar aún NestJS 12 / TypeScript 7 están en [docs/limitations.md](docs/limitations.md).
