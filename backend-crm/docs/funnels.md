# Embudos (funnels)

Tableros Kanban con los contactos de una línea de WhatsApp, organizados en etapas. La referencia funcional es el módulo de Embudos de Wasapi (solo su documentación pública). El código es propio.

## Modelo

| Dato | Dónde | Reglas |
| --- | --- | --- |
| **Embudo** (`funnels`) | PostgreSQL | Pertenece a un workspace y a **una línea**. `is_primary`: **un solo principal por línea**, garantizado por un índice único parcial; marcar otro desmarca al anterior en la misma transacción. `archive_after_days` (1–365, `null` = nunca). `sync_rules`: las últimas reglas de «Sincronizar contactos». Sin nombres repetidos en la misma línea (sin importar mayúsculas ni tildes). |
| **Etapa** (`funnel_stages`) | PostgreSQL | Columna ordenada por `position` y luego `created_at`. Máximo 30 por embudo; siempre queda al menos una. |
| **Privilegio** (`funnel_stage_access`) | PostgreSQL | Etapas que ve cada miembro en un embudo. Si un miembro no tiene filas, ve todas. |
| **Regla de automatización** (`funnel_automation_rules`) | PostgreSQL | Estado del chat → embudo y etapa. Una por línea y estado (`OPEN`, `ON_HOLD`, `CLOSED`). |
| **Preferencias** (`funnel_board_preferences`) | PostgreSQL | «Mostrar valor del lead» y «Mostrar agente asignado», por usuario y embudo. Ocultar un dato no lo borra. |
| **Lead** (`funnel_leads`) | MongoDB | Un contacto en un embudo: `stageId`, `amountCents` (entero, sin decimales flotantes), `archivedAt` / `archivedBy`, `activityAt` y `version`. **Uno por contacto y embudo** (índice único). Un mismo contacto puede estar en varios embudos, con un valor distinto en cada uno. |

- El **contacto** y la **conversación** son los de siempre: un lead no los copia ni los duplica.
- La **etapa** no es el **estado del chat**: mover un lead nunca cambia el estado de la conversación. Las reglas solo van en un sentido: del estado a la etapa.
- El **agente** de un lead es el asignado a su chat en la línea del embudo; no se guarda aparte.
- Los leads viven en MongoDB, junto a contactos y conversaciones, para que el tablero filtre por nombre, etiquetas, estado y agente en una sola consulta.

## Quién ve qué

| Acción | Permiso |
| --- | --- |
| Ver tableros, buscar, filtrar, abrir el chat de un lead, exportar CSV, personalizar el tablero | `funnels.read` (Propietario, Admin y Agente) |
| Agregar y quitar leads, moverlos, cambiar su valor, archivar o restaurar, y la etapa desde el chat | `funnels.write` (Propietario, Admin y Agente) |
| Crear, editar y borrar embudos y etapas, privilegios, sincronizar y reglas de automatización | `funnels.manage` (Propietario y Admin) |

El plan debe incluir `features.sales_funnels` (Empresa y Corporativo); si no, se responde `FEATURE_NOT_IN_PLAN`. Además:

- **Embudos visibles:** con `conversations.view_all`, los de todas las líneas; sin él, solo los de las líneas que atiende el miembro. Un embudo que no ve responde 404, igual que uno que no existe.
- **Etapas visibles:** según «Privilegios del embudo». Quien tiene `funnels.manage` ve todas. Ese mismo alcance se aplica al tablero, «Cargar más», los conteos y sumas, la búsqueda, el CSV y las acciones masivas. Un lead de una etapa que no ve responde 404; mover un lead hacia una etapa que no ve responde 403 `STAGE_FORBIDDEN`.
- **Vista previa del chat:** una tarjeta muestra el último mensaje solo si el miembro puede ver ese chat en la bandeja (`conversation.visible`). Si no, solo se ven el nombre, el estado y el agente.

## Reglas

- **Etapas por defecto:** Nuevo, En atención, Esperando cliente y Cerrado, en ese orden, creadas en la misma transacción que el embudo.
- **Embudo principal:** cada **conversación nueva** de la línea entra como lead en la primera etapa. Si la línea no tiene embudo principal o este no tiene etapas, el chat se crea igual y queda sin lead. Si el contacto ya está en el embudo, no se toca.
- **Mover un lead:** se puede enviar la `version` que se leyó. Si alguien lo cambió antes, la respuesta es 409 `LEAD_CHANGED` y el tablero recarga. El chat del contacto registra el evento `funnel_stage` (ver [inbox.md](inbox.md#historial-de-movimientos)).
- **Borrar una etapa:** si tiene leads, exige `moveTo` (si falta, 409 `STAGE_HAS_LEADS` con cuántos son); los leads pasan a esa etapa y después se borra. No se puede borrar la última etapa (`LAST_STAGE`). Nunca se borran contactos ni chats.
- **Borrar un embudo:** con leads exige `?confirm=true` (si falta, 409 `FUNNEL_HAS_LEADS`). Se borran sus leads, nunca los contactos ni los chats.
- **Cambiar la línea de un embudo:** solo mientras no tenga leads (`FUNNEL_HAS_LEADS`). Sus leads apuntan a los chats de la línea anterior.
- **Valor:** entero en centavos, de 0 a 10¹³. El símbolo `$` es solo visual: no hay monedas. Cada columna suma los valores de sus leads según los filtros aplicados; es un valor potencial, no ingresos.
- **Archivar:** a mano o, si el embudo tiene `archive_after_days`, de forma automática. Un temporizador del proceso revisa cada 15 minutos y archiva los leads cuya última actividad (`activityAt`) es más antigua que ese plazo. Archivar no cambia la etapa. Un mensaje nuevo del cliente restaura los leads archivados por inactividad (`archivedBy: null`), pero no los archivados a mano.
- **Sincronizar contactos:** por cada regla (estado del chat → etapa), los chats de la línea con ese estado se agregan como leads. Los contactos que ya están en el embudo conservan su etapa, así que repetirla no cambia nada. Responde `{ created, skipped, failed }` y recorre los chats en lotes de 100.
- **Automatización por estado:** cuando un chat de la línea cambia de estado (lo cierra un agente o un bot, lo pone en espera, o el cliente escribe a un chat cerrado), la regla de ese estado mueve el lead a su etapa, o lo crea si no existe. Se ejecuta después de guardar el cambio, en orden por conversación. Si el lead ya está en esa etapa, no hace nada. Cada movimiento queda en auditoría con `source: 'automation'` y el `ruleId`.
- **Chatbot:** el nodo «Establecer contacto en embudo» llama a `FunnelsService.setLeadStage`. El embudo debe ser de la línea del chat (`FUNNEL_NOT_ON_LINE`) y la etapa debe ser suya. Repetirlo no mueve dos veces.

## API

Bajo `/api/v1/workspaces/:workspaceId`.

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET /funnels` | read | Embudos visibles con sus leads activos |
| `POST /funnels` | manage | `{ lineId, name, description?, isPrimary?, defaultStages?, archiveAfterDays? }` |
| `GET /funnels/:id` | read | Embudo con las etapas visibles y `syncRules` |
| `PATCH /funnels/:id` | manage | Nombre, descripción, línea, principal, archivado automático |
| `DELETE /funnels/:id?confirm=true` | manage | Ver «Borrar un embudo» |
| `POST /funnels/:id/stages` · `PATCH …/stages/:stageId` | manage | Crear o renombrar una etapa (`{ name }`) |
| `PUT /funnels/:id/stages/order` | manage | `{ stageIds }`: todas las etapas, en el nuevo orden |
| `DELETE /funnels/:id/stages/:stageId?moveTo=` | manage | Ver «Borrar una etapa» |
| `GET /funnels/:id/board` | read | Columnas con `count`, `totalCents`, `hasMore` y los primeros 50 leads |
| `GET /funnels/:id/stages/:stageId/leads?offset=` | read | «Cargar más» de una columna |
| `POST /funnels/:id/leads` | write | `{ contactId, stageId }`. Si ya está: 409 `LEAD_EXISTS` con `leadId` |
| `PATCH /funnels/:id/leads/:leadId/stage` · `…/amount` · `…/archive` | write | `{ stageId, version? }` · `{ amountCents, version? }` · `{ archived }` |
| `DELETE /funnels/:id/leads/:leadId` | write | Lo quita del embudo |
| `POST /funnels/:id/leads/bulk` | write | `{ action: move \| archive \| restore \| remove, leadIds? \| stageId?, archived?, moveTo? }` |
| `GET /funnels/contacts/:contactId` · `PUT …` | read · write | Embudos del contacto para el selector del chat · `{ funnelId, stageId }` lo agrega o lo mueve |
| `GET /funnels/:id/permissions` · `PUT …` | manage | `{ members: [{ membershipId, stageIds }] }`, todo de una vez |
| `POST /funnels/:id/sync` | manage | `{ rules: [{ status, stageId }] }` |
| `GET /funnels/:id/preferences` · `PUT …` | read | `{ showValue, showAgent }` |
| `GET /funnels/:id/export.csv` | read | Ver «CSV» |
| `GET /funnel-automation?lineId=` · `PUT …` | manage | `{ rules: [{ status, funnelId, stageId }] }` de una línea |

**Filtros** de `board`, `leads` y `export.csv`:

- `search` busca en el nombre o el teléfono, solo dentro del embudo.
- `agentIds` y `unassigned=true` (sin agente, o sin chat en la línea).
- `tagIds`: el contacto tiene alguna de esas etiquetas.
- `statuses`: estados del chat.
- `archived=true`: solo los archivados, en la etapa donde estaban.
- `minCents` y `maxCents`.
- `sort`: `recent`, `value_desc` o `value_asc`.

Las listas se envían separadas por comas. Entre filtros se combinan con **Y**; dentro de una lista, con **O**.

**Tiempo real:** cada cambio emite `funnel.changed { funnelId }` por el SSE de la bandeja (`/conversations/events`). El navegador vuelve a pedir el tablero con sus propios permisos.

## CSV

- Columnas, en este orden: Nombre, Teléfono, Embudo, Etapa, Valor (`1234.56`), Agente, Etiquetas (separadas con `; `), Estado del chat, Archivado (Sí/No), Creado y Última actividad (ISO 8601, UTC).
- Formato: UTF-8 con BOM, RFC 4180 y CRLF.
- Un texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno se antepone con `'` para que la hoja de cálculo no lo ejecute como fórmula. Los números simples, como `+59170000000`, quedan igual.
- Usa los mismos filtros y etapas visibles que el tablero, con un máximo de 10 000 leads; si hay más, responde 413 `EXPORT_TOO_LARGE` y hay que filtrar primero.

## Auditoría

Las acciones quedan en `audit_logs` con `targetType: 'funnel'`:

- `funnels.funnel.created`, `.updated`, `.deleted` y `.exported`;
- `funnels.stage.created`, `.renamed`, `.reordered` y `.deleted` (con `movedTo`);
- `funnels.lead.added`, `.moved` (con `from`, `to` y `source`: `manual`, `automation`, `primary` o `chatbot`), `.amount_changed`, `.archived`, `.restored`, `.removed` y `.bulk_*`;
- `funnels.permissions.changed` y `funnels.sync.run`.

Además, `funnels.rules.changed` se registra con `targetType: 'channel_line'`.

## Pruebas

- **Unitarias:** `src/modules/funnels/domain/csv.spec.ts` cubre el escape del CSV, la inyección de fórmulas, las etapas visibles y la comparación de nombres.
- **E2E:** `test/e2e/funnels.e2e-spec.ts` cubre:
  - etapas por defecto y su orden, un solo principal por línea, nombre repetido y reordenar;
  - el plan Equipo;
  - chat nuevo en la primera etapa, una línea sin embudo principal, valor y totales, `LEAD_CHANGED` y el evento en el chat;
  - la etapa desde el chat;
  - lead duplicado, borrar etapas con y sin destino, borrar el embudo con confirmación;
  - sincronización idempotente y automatización por estado sin doble proceso;
  - privilegios y líneas por API y CSV, y aislamiento entre workspaces;
  - filtros combinados y orden por valor;
  - archivado manual y automático, y restauración con un mensaje.

## Pendientes de validar con el negocio

Lo que la documentación pública no define y aquí se resolvió así:

- **Etapa con leads:** se elige una etapa destino.
- **Valor:** es por lead (contacto y embudo), no del contacto.
- **Un contacto en varios embudos:** se permite, uno por embudo.
- **Privilegios:** controlan qué etapas se ven y hacia cuáles se mueve.
- **Reglas de automatización:** hay una por estado y línea, sin prioridades.
- **Búsqueda:** solo dentro del embudo abierto.
- **Archivado por inactividad:** el umbral lo define cada embudo y viene apagado.
- **Paginación:** 50 leads por columna y «Cargar más».
- **CSV:** las columnas son las indicadas arriba.
