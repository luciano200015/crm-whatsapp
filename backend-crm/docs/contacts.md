# Contactos y etiquetas

Código en [`src/modules/contacts`](../src/modules/contacts). Se guardan en **MongoDB** (colecciones `contacts` y `tags`), siempre con `workspaceId`. En el menú: **Contactos → Administrar** y **Contactos → Etiquetas**.

## Contactos

| Campo | Notas |
| ----- | ----- |
| `phone` | Normalizado a **E.164** (`+59171234567`) con `libphonenumber-js`. Acepta `+591 7123-4567`, `59171234567` o `0059171234567`. **Único por workspace**: el mismo número puede existir en otro workspace |
| `name`, `email`, `notes` | Opcionales. El email se guarda en minúsculas |
| `tagIds` | Etiquetas del mismo workspace (si no, `404 TAG_NOT_FOUND`) |
| `source` | `manual` (creado desde la app), `whatsapp` (creado al llegar un mensaje) o `import` (importado) |
| `lastMessageAt` | Lo actualiza la bandeja de mensajes |
| `blocked` | Bloqueado: sus mensajes se ignoran. En la lista es el **Estado** (Activo o Bloqueado) |
| `lineAgents` | **Asignación de asesores**: el agente regular de cada línea (`{ lineId, membershipId }`) |
| `fields` | Valores de los **campos personalizados**, por clave |

La lista se ordena del más nuevo al más antiguo y usa **paginación por cursor**: `nextCursor` se pasa como `cursor` para pedir la página siguiente. La búsqueda (`search`) busca en el nombre y el email, y en el teléfono por sus dígitos. `tagId` filtra por etiqueta y `status` (`ACTIVE` o `BLOCKED`) por estado.

Borrar un contacto lo elimina de verdad. Sus conversaciones se conservan con la copia de su nombre y su número, y si vuelve a escribir se crea un contacto nuevo. También sale de todos los **embudos** (sus leads se borran y los tableros se refrescan).

## Asignación de asesores

Como en wasapi («Editar contacto» → **Asignación de asesores**), cada contacto tiene un **agente regular por línea**:

- `GET contacts/:id/agents` devuelve cada línea no desactivada con:
  - `agents`: quién puede ser su agente regular (los agentes de la línea y los miembros con `conversations.view_all`);
  - `agentMembershipId`: el elegido;
  - `attending`: quién atiende **ahora** el chat abierto o en espera de esa línea («Atendiendo ahora: … (temporal)»).
- `PUT contacts/:id/agents { agents: [{ lineId, membershipId | null }] }` cambia solo las líneas enviadas. El agente debe atender esa línea (`404 CONTACT_AGENT_NOT_FOUND`, `CONTACT_LINE_NOT_FOUND`).
- Con la autoasignación **Asignar según el agente registrado**, los chats nuevos del contacto en una línea van a su agente regular de esa línea (ver [inbox.md](inbox.md)).

## Campos personalizados

«Más opciones» → **Administrar campos personalizados** (`contacts.manage`). Colección `contact_fields`:

| Campo | Notas |
| ----- | ----- |
| `label` | Nombre visible (hasta 60 caracteres); se puede cambiar |
| `key` | Sale del primer nombre (`Fecha de nacimiento` → `fecha_de_nacimiento`), es única y **no cambia** |
| `type` | `TEXT` (hasta 500 caracteres), `NUMBER`, `DATE` (se guarda `YYYY-MM-DD`; acepta `DD/MM/YYYY`) o `SELECT` (una de `options`, sin distinguir mayúsculas ni tildes) |

- Hasta **50** campos (`409 CONTACT_FIELDS_LIMIT`). Un nombre que da la misma clave que otro: `409 CONTACT_FIELD_TAKEN`.
- En el contacto, `fields` se envía en `POST` y `PATCH /contacts`. Solo cambian las claves enviadas; `null` o `""` borra una. Una clave desconocida da `404 CONTACT_FIELD_NOT_FOUND` y un valor que no encaja con el tipo, `400 CONTACT_FIELD_INVALID_VALUE`.
- Borrar un campo quita su valor de todos los contactos.

## Más opciones (importar, exportar, eliminar todos)

Requieren `contacts.manage` (Propietario y Administrador):

- **Importar contactos** (`POST contacts/import`): la app lee el Excel (.xlsx) o CSV de hasta 20 MB en el navegador, muestra sus columnas para **Asignar columna** (campos existentes, campos personalizados —o crear uno— o **Saltar columna**) y envía las filas en lotes de hasta 200 `{ phone, name, email, notes, tags, fields }`.
  - Un teléfono que ya existe **actualiza** ese contacto con los valores no vacíos de la fila; uno nuevo se crea con origen `import`.
  - Etiquetas por nombre (las que faltan se crean). Con contactos existentes: `tagMode` **REPLACE** («Reescribir etiquetas») o **MERGE** («Combinar etiquetas»).
  - Cada fila mala falla sola: la respuesta trae `{ created, updated, failed: [{ index, phone, code }] }` con `INVALID_PHONE`, `INVALID_EMAIL`, `CONTACT_FIELD_INVALID_VALUE` o `CONTACT_PHONE_TAKEN`. La app ofrece descargar un CSV con esas filas y el motivo. En wasapi el resultado llega por correo; aquí se ve al terminar.
- **Exportar** (`GET contacts/export.csv`): sin filtros, todos los contactos («Exportar todos los contactos»); con `search`, `tagId` o `status`, los de la lista filtrada («Exportar contactos con filtros asignados»). Se descarga al momento (en wasapi llega por correo).
  - Columnas: Nombre, Teléfono, Correo, Etiquetas, Estado, Origen, Notas, Último mensaje, Creado, Actualizado y una por campo personalizado.
  - UTF-8 con BOM, RFC 4180, en streaming por lotes de 1000, con la protección contra fórmulas de [`shared/csv.ts`](../src/shared/csv.ts).
- **Eliminar todos los contactos** (`POST contacts/delete-all { confirmation: "ELIMINAR" }`, si no `400 CONFIRMATION_REQUIRED`): borra todos los contactos del workspace y sus leads de embudos; las conversaciones se conservan.

**Selección en la lista** (`POST contacts/bulk`, `contacts.write`): hasta 500 contactos con `add_tags`, `remove_tags` (con `tagIds`) o `delete`. Responde `{ affected }`.

## Etiquetas

- **Nombre:** único por workspace, sin distinguir mayúsculas ni tildes (`VIP` = `vip` = `Vïp`, `409 TAG_NAME_TAKEN`).
- **Color:** en formato `#RRGGBB`.
- **Al borrar una etiqueta** se quita de todos los contactos del workspace. MongoDB corre sin replica set y por tanto sin transacciones multi-documento. Si el proceso se cortara entre ambos pasos, quedaría un id huérfano en `tagIds`, que las lecturas ignoran.

## API

Todas bajo `/api/v1/workspaces/:workspaceId`, con `WorkspaceAccessGuard`.

| Método y ruta | Permiso |
| ------------- | ------- |
| `GET contacts?search&tagId&status&cursor&limit` · `GET contacts/:id` · `GET contacts/:id/agents` | `contacts.read` |
| `POST contacts` · `PATCH contacts/:id` · `PUT contacts/:id/tags` · `PUT contacts/:id/agents` · `DELETE contacts/:id` · `POST contacts/bulk` | `contacts.write` |
| `GET contacts/export.csv` · `POST contacts/import` · `POST contacts/delete-all` | `contacts.manage` |
| `GET tags` (con número de contactos por etiqueta) · `GET contact-fields` | `contacts.read` |
| `POST tags` · `PATCH tags/:id` · `DELETE tags/:id` | `tags.manage` |
| `POST contact-fields` · `PATCH contact-fields/:id` · `DELETE contact-fields/:id` | `contacts.manage` |

**Permisos por rol:**

- Los agentes (`AGENT`) leen, crean, etiquetan y asignan asesores a contactos, pero no administran el catálogo de etiquetas ni trabajan con toda la base (importar, exportar, eliminar todos, campos personalizados).
- `tags.manage` y `contacts.manage` los tienen OWNER y ADMIN.

**Errores:** `CONTACT_NOT_FOUND`, `CONTACT_PHONE_TAKEN`, `INVALID_PHONE`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`, `CONTACT_AGENT_NOT_FOUND`, `CONTACT_LINE_NOT_FOUND`, `CONTACT_FIELD_NOT_FOUND`, `CONTACT_FIELD_TAKEN`, `CONTACT_FIELD_INVALID_LABEL`, `CONTACT_FIELD_OPTIONS_REQUIRED`, `CONTACT_FIELDS_LIMIT`, `CONTACT_FIELD_INVALID_VALUE`, `CONFIRMATION_REQUIRED`.

**Auditoría:** `contacts.contact.deleted`, `contacts.contact.bulk_deleted`, `contacts.contact.all_deleted`, `contacts.contact.imported`, `contacts.contact.exported`, `contacts.field.deleted` y `contacts.tag.deleted`.

## Convenciones MongoDB

Las comparten todas las colecciones:

- **Plugin [`workspaceScoped`](../src/database/mongodb/workspace-scoped.plugin.ts):**
  - añade `workspaceId` obligatorio;
  - rechaza (`MissingWorkspaceFilterError`) cualquier `find`, `update`, `delete`, `count` o `distinct` sin `workspaceId` en el filtro, y cualquier `aggregate` cuyo primer `$match` no filtre por workspace.

  Un olvido falla en lugar de leer o modificar datos de otros workspaces.
- **Índices:** empiezan por `workspaceId`. Cada store los crea al arrancar con `createIndexes()`, que espera a que terminen e ignora los que ya existen. `autoIndex` está desactivado.
- **Paginación por cursor:** sobre `_id`, con los helpers de [`pagination.ts`](../src/database/mongodb/pagination.ts) (`afterCursor`, `toPage`, `escapeRegex` para búsquedas).

## Pendiente

- Importar archivos `.xls` antiguos (se pide guardarlos como `.xlsx`).
- Iniciar una conversación con un contacto que nunca escribió: necesita plantillas de WhatsApp, que todavía no están. El botón «Iniciar conversación» abre sus chats existentes.
- Fusionar contactos duplicados.
