# Contactos y etiquetas

Código en [`src/modules/contacts`](../src/modules/contacts). Se guardan en **MongoDB** (colecciones `contacts` y `tags`), siempre con `workspaceId`. En el menú: **Contactos → Administrar** y **Contactos → Etiquetas**.

## Contactos

| Campo | Notas |
| ----- | ----- |
| `phone` | Normalizado a **E.164** (`+59171234567`) con `libphonenumber-js`. Acepta `+591 7123-4567`, `59171234567` o `0059171234567`. **Único por workspace**: el mismo número puede existir en otro workspace |
| `name`, `email`, `notes` | Opcionales. El email se guarda en minúsculas |
| `tagIds` | Etiquetas del mismo workspace (si no, `404 TAG_NOT_FOUND`) |
| `source` | `manual` (creado desde la app) o `whatsapp` (creado al llegar un mensaje) |
| `lastMessageAt` | Lo actualiza la bandeja de mensajes |

La lista se ordena del más nuevo al más antiguo y usa **paginación por cursor**: `nextCursor` se pasa como `cursor` para pedir la página siguiente. La búsqueda (`search`) busca en el nombre y el email, y en el teléfono por sus dígitos. `tagId` filtra por etiqueta.

Borrar un contacto lo elimina de verdad. Sus conversaciones se conservan con la copia de su nombre y su número, y si vuelve a escribir se crea un contacto nuevo.

## Etiquetas

- **Nombre:** único por workspace, sin distinguir mayúsculas ni tildes (`VIP` = `vip` = `Vïp`, `409 TAG_NAME_TAKEN`).
- **Color:** en formato `#RRGGBB`.
- **Al borrar una etiqueta** se quita de todos los contactos del workspace. MongoDB corre sin replica set y por tanto sin transacciones multi-documento. Si el proceso se cortara entre ambos pasos, quedaría un id huérfano en `tagIds`, que las lecturas ignoran.

## API

Todas bajo `/api/v1/workspaces/:workspaceId`, con `WorkspaceAccessGuard`.

| Método y ruta | Permiso |
| ------------- | ------- |
| `GET contacts?search&tagId&cursor&limit` · `GET contacts/:id` | `contacts.read` |
| `POST contacts` · `PATCH contacts/:id` · `PUT contacts/:id/tags` · `DELETE contacts/:id` | `contacts.write` |
| `GET tags` (con número de contactos por etiqueta) | `contacts.read` |
| `POST tags` · `PATCH tags/:id` · `DELETE tags/:id` | `tags.manage` |

**Permisos por rol:**

- Los agentes (`AGENT`) leen, crean y etiquetan contactos, pero no administran el catálogo de etiquetas.
- `tags.manage` lo tienen OWNER y ADMIN.

**Errores:** `CONTACT_NOT_FOUND`, `CONTACT_PHONE_TAKEN`, `INVALID_PHONE`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`.

**Auditoría:** `contacts.contact.deleted` y `contacts.tag.deleted`.

## Convenciones MongoDB

Las comparten todas las colecciones:

- **Plugin [`workspaceScoped`](../src/database/mongodb/workspace-scoped.plugin.ts):**
  - añade `workspaceId` obligatorio;
  - rechaza (`MissingWorkspaceFilterError`) cualquier `find`, `update`, `delete`, `count` o `distinct` sin `workspaceId` en el filtro, y cualquier `aggregate` cuyo primer `$match` no filtre por workspace.

  Un olvido falla en lugar de leer o modificar datos de otros workspaces.
- **Índices:** empiezan por `workspaceId`. Cada store los crea al arrancar con `createIndexes()`, que espera a que terminen e ignora los que ya existen. `autoIndex` está desactivado.
- **Paginación por cursor:** sobre `_id`, con los helpers de [`pagination.ts`](../src/database/mongodb/pagination.ts) (`afterCursor`, `toPage`, `escapeRegex` para búsquedas).

## Pendiente

- Importar y exportar CSV.
- Campos personalizados.
- Fusionar contactos duplicados.
