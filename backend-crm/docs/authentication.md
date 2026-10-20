# Autenticación

Implementación de la Fase 2. Código en [`src/modules/auth`](../src/modules/auth).

## Endpoints

Todos bajo `/api/v1`. Los marcados como públicos no requieren access token; el resto exige `Authorization: Bearer <accessToken>`.

| Método y ruta | Acceso | Qué hace |
| ------------- | ------ | -------- |
| `POST /auth/register` | público | Crea usuario + workspace + membresía OWNER y envía el email de verificación. Siempre `202` |
| `POST /auth/login` | público | Devuelve el access token y pone las cookies `crm_rt` y `crm_csrf` |
| `POST /auth/refresh` | público + cookie + CSRF | Rota el refresh token y emite un nuevo access token |
| `POST /auth/logout` | público + cookie + CSRF | Revoca la sesión y borra las cookies. Idempotente |
| `POST /auth/password/forgot` | público | Envía el enlace de recuperación. Siempre `202` |
| `POST /auth/password/reset` | público | Cambia la contraseña con el token y cierra todas las sesiones |
| `POST /auth/email/verify` | público | Verifica el email y activa la cuenta |
| `POST /auth/email/resend-verification` | token | Reenvía el email de verificación |
| `POST /auth/password/change` | token | Cambia la contraseña (pide la actual) y cierra las demás sesiones |
| `GET /auth/sessions` | token | Lista mis sesiones activas, marcando la actual |
| `DELETE /auth/sessions/:id` | token | Cierra una de mis sesiones (`404` si no es mía) |
| `POST /auth/sessions/revoke-others` | token | Cierra todas mis sesiones excepto la actual |
| `GET /users/me` | token | Perfil, workspaces, roles y permisos efectivos |
| `PATCH /users/me` | token | Actualiza nombre, idioma, zona horaria y avatar |

**Seguro por defecto**: `JwtAuthGuard` es un guard global. Toda ruta nueva exige token salvo que se marque explícitamente con `@Public()`.

## Tokens

| Token | Formato | Dónde vive | Vida | Almacenamiento en BD |
| ----- | ------- | ---------- | ---- | -------------------- |
| Access token | JWT ES256 (`sub`, `sid`, `iss`, `aud`, `exp`, `jti`) | Memoria del cliente → header `Authorization` | 15 min | No se guarda |
| Refresh token | 256 bits aleatorios (base64url) | Cookie `crm_rt` HttpOnly, `Path=/api/v1/auth` | 7 días, sin superar la sesión | HMAC-SHA256 en `refresh_tokens.token_hash` |
| CSRF token | 256 bits aleatorios | Cookie `crm_csrf` legible por JS | igual que el refresh | No se guarda |
| Reset de contraseña | 256 bits aleatorios | Email | 30 min, un solo uso | HMAC-SHA256 |
| Verificación de email | 256 bits aleatorios | Email | 24 h, un solo uso | HMAC-SHA256 |

- **JWT**: verificación con algoritmo fijado (`ES256`) más emisor y audiencia. Así se rechazan `alg: none`, la confusión HS256/clave pública, las firmas con otra clave, los payloads manipulados y los tokens caducados (todo cubierto en `test/e2e/auth.e2e-spec.ts`).
- **El JWT no basta**: en cada petición el guard comprueba que la sesión (`sid`) sigue activa, no ha caducado, pertenece al usuario y que el usuario no está suspendido. Un logout o una revocación tienen efecto inmediato, sin esperar a que caduque el access token. El coste es una consulta por clave primaria por petición.
- **Hash de tokens opacos**: HMAC-SHA256 con `TOKEN_HASH_SECRET`. Al tener 256 bits de entropía no hace falta un hash lento, y el secreto impide validar tokens solo con una copia de la base de datos.

## Rotación del refresh token y detección de robo

Cada login crea una `user_session`, que es la **familia** de refresh tokens. En cada `/auth/refresh`:

1. Se busca el token por su hash. Si la sesión no está activa, ha caducado o el token está revocado o caducado → `401`.
2. Si el token **ya se había usado**:
   - dentro de `REFRESH_REUSE_GRACE_SECONDS` (10 s): se interpreta como dos pestañas refrescando a la vez → `401` para la que pierde, **sin** revocar;
   - fuera de esa ventana: se interpreta como robo → se revoca **toda la sesión** (`REUSE_DETECTED`), se audita y `401`. Los access tokens de esa sesión dejan de funcionar al instante.
3. Si no, en una transacción: `UPDATE … SET used_at = now() WHERE id = $1 AND used_at IS NULL` (compare-and-set). Solo una petición concurrente puede ganar; se crea el token hijo (`parent_id` es único: un token solo puede tener un sucesor).
4. El hijo caduca a los 7 días o al final de la sesión (30 días), lo que llegue antes. Rotar nunca alarga la sesión.

## Cookies y CSRF

| Cookie | HttpOnly | Path | Secure | SameSite |
| ------ | -------- | ---- | ------ | -------- |
| `crm_rt` | sí | `/api/v1/auth` | `COOKIE_SECURE` (obligatorio en producción) | `COOKIE_SAMESITE` (`strict` por defecto) |
| `crm_csrf` | no | `/` | igual | igual |

`/auth/refresh` y `/auth/logout` se autentican con una cookie que el navegador envía solo, así que exigen **double-submit**: el header `X-CSRF-Token` debe coincidir con la cookie `crm_csrf` (comparación en tiempo constante). Un sitio malicioso puede provocar que el navegador envíe cookies, pero no puede leer `crm_csrf` para copiarla en el header. `SameSite=Strict` añade una segunda barrera.

Los endpoints autenticados con Bearer no necesitan CSRF: el navegador nunca añade ese header por su cuenta.

**Frontend**: guarda el access token en memoria (no en `localStorage`). Al recargar la página, llama a `/auth/refresh` con `credentials: 'include'` y el header `X-CSRF-Token` leído de `document.cookie`. Si frontend y API están en dominios distintos, usa `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` y añade el origen del frontend a `CORS_ORIGINS`.

## Contraseñas

- **Argon2id** con m=64 MiB, t=3, p=4 (por encima del mínimo de OWASP). Si se suben los parámetros, el hash se actualiza en el siguiente login (`needsRehash`).
- **Normalización NFKC** antes de aplicar el hash, para que caracteres equivalentes (p. ej. `Ａ` y `A`) produzcan la misma contraseña.
- **Política** ([`password-policy.ts`](../src/modules/auth/domain/password-policy.ts)), al estilo NIST 800-63B: de 12 a 128 caracteres; no puede ser el email ni su parte local; se rechazan patrones triviales. No hay reglas de composición ("una mayúscula y un símbolo") ni caducidad periódica. La entrada se corta a 256 caracteres antes de llegar a Argon2 para evitar DoS.

## Anti-enumeración y fuerza bruta

| Vector | Mitigación |
| ------ | ---------- |
| Login con email inexistente | Misma respuesta (`401 Invalid email or password`) y mismo coste: se verifica contra un hash ficticio |
| Login de cuenta bloqueada, suspendida o desactivada | Misma respuesta genérica. El estado se comprueba *después* de la contraseña, así que quien adivina no lo descubre |
| Registro con email existente | Misma respuesta `202` y mismo coste (Argon2 se calcula siempre); el dueño recibe un aviso por email |
| Recuperación de contraseña | Siempre `202`; los emails se envían en segundo plano para no alterar el tiempo de respuesta |
| Fuerza bruta por cuenta | 5 fallos seguidos → bloqueo de 15 min (el contador se reinicia al entrar) |
| Fuerza bruta por IP | `@nestjs/throttler` en `/auth/*`: `AUTH_THROTTLE_LIMIT` peticiones por `AUTH_THROTTLE_TTL_SECONDS` → `429` |
| Sesiones ajenas | `DELETE /auth/sessions/:id` de otro usuario responde `404`, igual que una sesión inexistente |

## Registro

En una sola transacción PostgreSQL: usuario (`PENDING_VERIFICATION`), credencial, token de verificación, workspace (slug derivado del nombre y, si está ocupado, con un sufijo aleatorio), membresía y rol `OWNER`. El usuario no puede elegir su rol. Los registros concurrentes con el mismo email los resuelve la restricción única: uno gana y el otro recibe la respuesta genérica.

La cuenta sin verificar **puede iniciar sesión**. Si en el futuro una funcionalidad exige email verificado, se comprobará en esa funcionalidad (`emailVerified` está en `/users/me`).

## Auditoría

Se registran en `audit_logs`: registro, registro con email duplicado, login correcto y fallido (con el motivo: `unknown_email`, `bad_password`, `account_locked`, `account_blocked`), logout, reutilización de refresh token, solicitud y uso de recuperación, cambio de contraseña, verificación de email, revocación de sesiones y cambios de perfil. Todo `metadata` pasa por [`sanitizeAuditMetadata`](../src/modules/audit/audit-sanitizer.ts), que descarta claves con aspecto sensible (`password`, `token`, `secret`, `cookie`, `authorization`, `hash`…). Una prueba e2e verifica que ni la contraseña ni los tokens aparecen en la tabla.

## Correo

Los casos de uso dependen del puerto [`Mailer`](../src/shared/mail/mailer.ts). En desarrollo el adaptador SMTP envía a **Mailpit** (http://localhost:8025); en las pruebas se sustituye por una bandeja en memoria. Los emails incluyen un enlace a `WEB_APP_URL` y, para poder probar con Swagger, el token en texto plano. Ni el destinatario ni el cuerpo se registran en los logs.

## Swagger

`/docs` (desactivado por defecto en producción). Lleva configurados interceptores para que sea usable sin herramientas externas:

- tras `login`/`refresh`, aplica el `accessToken` en **Authorize**;
- añade `X-CSRF-Token` a cada petición leyendo la cookie `crm_csrf`;
- tras `logout`, o si `refresh` responde `401`, borra la autorización.

`persistAuthorization` guarda el access token en `localStorage` del navegador: solo es aceptable porque Swagger es una herramienta de desarrollo.

## Integración con el frontend

El frontend React vive en [`../frontend-crm`](../../frontend-crm) (ver su README). Resumen del contrato:

- En desarrollo, Vite hace de proxy de `/api` → `http://localhost:3000`: misma origin, sin CORS, y las cookies `crm_rt` (path `/api/v1/auth`) y `crm_csrf` funcionan tal cual.
- El access token se guarda solo en memoria. Al recargar la página, el frontend llama a `/auth/refresh` con `X-CSRF-Token` si existe la cookie `crm_csrf`.
- Ante un `401`, el frontend hace un único refresh compartido y reintenta. Entre pestañas, los refresh se serializan con la Web Locks API para no disparar la detección de reutilización.
- `WEB_APP_URL=http://localhost:5173` hace que los enlaces de los emails abran `/verify-email?token=…` y `/reset-password?token=…` del frontend. Este quita el token de la URL nada más leerlo.
