# Modelo de datos PostgreSQL

Definido en [`prisma/schema.prisma`](../prisma/schema.prisma). Migración inicial: `prisma/migrations/20261019120000_init`.

## Convenciones

- Claves primarias UUID v7 (`uuid(7)`, ordenables por tiempo) en columnas `uuid`.
- Tablas y columnas en `snake_case` (`@@map` / `@map`); modelos en `PascalCase`.
- Fechas `timestamptz(3)`; `created_at` / `updated_at` en las entidades mutables.
- Emails siempre **normalizados** (`trim` + minúsculas) antes de escribir. Un `CHECK` en la base de datos lo garantiza como defensa en profundidad.
- Los tokens (refresh, reset, verificación, invitación) se guardan como `token_hash` = HMAC-SHA256 hex (64 caracteres) del token aleatorio de 256 bits. El token en claro nunca se persiste.

## Entidades

### Identidad

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `users` | Perfil y estado (`PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `DISABLED`) | `email` único + `CHECK` de normalización |
| `user_credentials` | Hash Argon2id, fecha de cambio, intentos fallidos, bloqueo y `must_change_password` (contraseña temporal de un agente creado por un administrador) | PK = `user_id` (1:1). Separado del perfil para que las lecturas de perfil nunca toquen hashes |
| `user_sessions` | Una por login; agrupa la familia de refresh tokens. Caducidad absoluta, motivo de revocación | índice `(user_id, status)` |
| `refresh_tokens` | Tokens rotativos de una sesión | `token_hash` único; `parent_id` **único** (un token solo puede rotarse una vez); `used_at` marca el canje → presentarlo de nuevo = reutilización |
| `password_reset_tokens` | Recuperación de contraseña, uso único | `token_hash` único, `expires_at`, `used_at` |
| `email_verification_tokens` | Verificación de correo, uso único | igual que el anterior |

### Workspaces

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `workspaces` | Espacio de trabajo (`ACTIVE`, `SUSPENDED`, `ARCHIVED`), `settings` JSON | `slug` único + `CHECK` de formato `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` |
| `workspace_memberships` | Usuario ↔ workspace, estado `ACTIVE`/`DEACTIVATED` | único `(workspace_id, user_id)` |
| `workspace_invitations` | Invitación por email con rol, expiración y uso único | `token_hash` único; **índice único parcial** `(workspace_id, email) WHERE status = 'PENDING'` |

### Autorización

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `roles` | Roles del sistema (`workspace_id IS NULL`: OWNER, ADMIN, AGENT) y roles personalizados de un workspace (`workspace_id` con valor) | Índices únicos parciales: `key` donde `workspace_id IS NULL`; `(workspace_id, key)` donde no es nulo. `CHECK roles_system_scope_check`: `is_system = (workspace_id IS NULL)` |
| `permissions` | Catálogo de permisos (`contacts.read`, …) | `key` único |
| `role_permissions` | Rol ↔ permiso | PK `(role_id, permission_id)` |
| `membership_roles` | Rol asignado a una membresía, con quién y cuándo | PK `(membership_id, role_id)` |

### Auditoría

`audit_logs`: `occurred_at`, actor, workspace, `action` (p. ej. `auth.login.succeeded`), objetivo, IP, user agent, `request_id`, `metadata` JSON. Índices por `(workspace_id, occurred_at)`, `(actor_user_id, occurred_at)` y `(action, occurred_at)`. Las FK a usuario y workspace son `SET NULL` para que el historial sobreviva a borrados. **Nunca** se guardan contraseñas, tokens, cookies ni secretos en `metadata`.

## Política de borrado (FK)

- `CASCADE` solo en hijos puramente dependientes: credenciales, sesiones, refresh tokens, tokens de reset/verificación, `role_permissions`, `membership_roles`, invitaciones de un workspace.
- `RESTRICT` en lo que tiene valor de negocio: un workspace con miembros no se puede borrar; un rol asignado no se puede borrar; un usuario con membresías no se puede borrar sin tratarlas antes.
- `SET NULL` en referencias de autoría (`created_by_id`, `invited_by_id`, `assigned_by_id`, auditoría).

## Índices parciales (preview de Prisma)

Los índices únicos parciales se declaran en el schema con la *preview feature* `partialIndexes` de Prisma 7.10 (`@@unique([...], where: {...})`), por lo que `migrate dev` no los ve como *drift*.

> ⚠️ El cliente Prisma expone estos índices como claves de `findUnique` (`role.findUnique({ where: { key } })`, `workspaceInvitation.findUnique({ where: { workspaceId_email } })`), pero **no son únicos fuera de su condición**. No usarlos en `findUnique`/`upsert`; consultar siempre con `findFirst` y el filtro de alcance explícito (`workspaceId: null`, `status: 'PENDING'`).

## Restricciones escritas a mano

Añadidas al final de la migración inicial porque Prisma no las modela: `CHECK` de email normalizado (`users`, `workspace_invitations`), formato de `slug` y `failed_login_count >= 0`.

## Flujo para cambiar el modelo

1. Editar `prisma/schema.prisma`.
2. `npm run prisma:migrate:dev -- --name <cambio> --create-only`.
3. Revisar el SQL; añadir a mano lo que Prisma no modele. Las migraciones destructivas (borrar columnas/tablas, cambiar tipos con pérdida) requieren aprobación explícita.
4. `npm run prisma:migrate:dev` para aplicarla, y `npm run test:int`.

## Cupo mensual de contactos (migración `monthly_contact_usage`)

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `workspace_contact_usage` | Contactos distintos a los que se respondió por workspace y mes UTC (`limits.active_contacts`). Una fila = un cupo reservado | PK `(workspace_id, month, contact_id)`; `CHECK` día 1 del mes e id de MongoDB válido; `CASCADE` con el workspace |

La reserva se hace bajo bloqueo de la fila del workspace, así que dos respuestas simultáneas no ocupan el mismo último cupo. Ver [inbox.md](inbox.md).

## Canales (migración `channel_lines`)

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `channel_lines` | Línea de WhatsApp: ids de Meta, credenciales **cifradas**, token de verificación del webhook, estado, autoasignación y cursor rotativo | `phone_number_id` único (enruta webhooks) + `CHECK` numérico; `webhook_verify_token` único; `CASCADE` con el workspace |
| `channel_line_agents` | Agentes (membresías) que atienden cada línea | PK `(line_id, membership_id)`; `CASCADE` con la línea y la membresía |

Ver [channels.md](channels.md).

## MongoDB

Datos operativos del CRM. Todas las colecciones usan el plugin `workspaceScoped` (ver [contacts.md](contacts.md#convenciones-mongodb)).

| Colección | Propósito | Índices |
| --------- | --------- | ------- |
| `contacts` | Contactos: teléfono E.164, nombre, email, notas, `tagIds`, origen | `(workspaceId, phone)` único; `(workspaceId, tagIds, _id)`; `(workspaceId, _id)` |
| `tags` | Etiquetas con color | `(workspaceId, normalizedName)` único |
| `conversations` | **El** chat de un contacto en una línea (se reabre, nunca se duplica): copia del contacto, estado `OPEN`/`ON_HOLD`/`CLOSED`, agente asignado, último mensaje, `lastInboundAt` (ventana de 24 h), no leídos | `(workspaceId, lineId, contactId)` **único** (antes solo para `OPEN`: `npm run inbox:merge-conversations` une los duplicados antiguos); `(workspaceId, status, lastActivityAt, _id)`; por agente y por línea |
| `messages` | Mensajes entrantes (`IN`), salientes (`OUT`), notas internas (`NOTE`) y movimientos (`EVENT`, con `event: { kind, by, from, to }`), con estado de entrega. Los archivos guardan el id de Meta y, una vez copiados, `media.fileId` (GridFS) y `media.size`. Las ubicaciones guardan `location` y las tarjetas de contacto, `contacts` | `(workspaceId, conversationId, _id)`; `(workspaceId, waMessageId)` único parcial: un webhook repetido no duplica |
| `quick_replies` | Respuestas rápidas: `shortcut` y `text` | `(workspaceId, shortcut)` único |
| `media.files` / `media.chunks` | Archivos de los chats en **GridFS**, con `metadata.workspaceId` y `metadata.mimeType`. Toda lectura filtra por workspace | Índices propios de GridFS |

## Equipo (migración `team_members_roles`)

- `user_credentials.must_change_password` (`boolean`, por defecto `false`).
- `CHECK roles_system_scope_check`: `workspace_id` decide si un rol es del sistema y `is_system` no puede contradecirlo.
- **Retiro del rol del sistema `VIEWER` sin perder accesos.** Por cada workspace que lo tenía asignado (en membresías o invitaciones), la migración:
  1. crea un rol personalizado `viewer` («Solo lectura») con los mismos permisos;
  2. mueve las asignaciones a ese rol;
  3. borra el rol del sistema. Si algo lo siguiera referenciando, el `ON DELETE RESTRICT` haría fallar la migración en lugar de quitar accesos en silencio.

Ver [team.md](team.md).

## Billing (migración `billing_plans_subscriptions`)

| Tabla | Propósito | Claves / restricciones |
| ----- | --------- | ---------------------- |
| `features` | Catálogo de funcionalidades: `LIMIT`, `BOOLEAN` o `TEXT` | `key` único |
| `plans` | Planes (`team`, `business`, `corporate`), público/activo/destacado | `code` único + `CHECK` de formato |
| `plan_prices` | Precio por plan, periodo (`MONTH`/`YEAR`) y moneda, en centavos | único `(plan_id, interval, currency)`; `CHECK amount_cents >= 0`; moneda ISO de 3 letras |
| `plan_features` | Valor de cada funcionalidad en cada plan (`limit_value` null = ilimitado, `enabled`, `text_value`) | PK `(plan_id, feature_id)`; `CHECK limit_value >= 0` |
| `subscriptions` | **Una por workspace**: plan, periodo, precio congelado, estado, prueba, periodo actual, cancelación, proveedor de pago | `workspace_id` único; `CHECK` de fechas coherentes (la prueba y el periodo tienen inicio y fin, y el fin es posterior) |

- Las filas de `plans`, `plan_prices`, `features` y `plan_features` se sincronizan desde el código con `npm run db:seed` (ver [billing.md](billing.md)).
- La suscripción **congela** el precio (`amount_cents`, `currency`), así que subir un precio del catálogo no cambia a quien ya está suscrito.
- El historial de cambios de plan se guarda en `audit_logs` (`billing.*`).
- Borrar un workspace borra su suscripción (`CASCADE`). Un plan con suscripciones no se puede borrar (`RESTRICT`): se retira con `is_active=false`.
