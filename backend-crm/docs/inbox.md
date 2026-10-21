# Bandeja de mensajes

En la aplicación, **Bandeja** (menú de primer nivel) reúne las conversaciones del workspace activo, al estilo de WhatsApp Web y wasapi:

- **Lista de chats:**
  - avatar, hora, vista previa («📷 Foto», «🎤 Audio», «👤 Contacto»…) y contador verde de no leídos;
  - abajo, el **agente que atiende** el chat en letra pequeña y con color propio («Sin asignar» en naranja);
  - se carga sola al bajar.
- **Filtros:**
  - pestañas **Mis chats / Sin asignar / Todos** (esta última solo con `conversations.view_all`);
  - estado **Abiertos / En espera / Cerrados**;
  - línea y búsqueda por nombre o teléfono.
- **Un solo chat por contacto** (en cada línea). Al abrirlo carga los mensajes más recientes y, al subir, va trayendo los anteriores sin saltar de posición, como en wasapi.
- **Chat:**
  - fondo y burbujas estilo WhatsApp, con separadores por día y ✓ / ✓✓ / leído;
  - las notas internas van en amarillo;
  - los movimientos aparecen como **avisos centrados**.
- **Cabecera:**
  - **Tomar chat**, **Transferir** a otro agente, **Poner en espera**, **Cerrar** y **Reabrir**;
  - menú ⋮ con **Marcar como no leído**, **Ver contacto** y **Bloquear contacto**.
- **Panel del contacto** (plegable): datos, etiquetas editables, agente, estado y ventana de 24 h.
- **Editor:** emojis, adjuntar fotos, videos, documentos o **contactos**, grabar notas de voz, respuestas rápidas con «/» y modo **Nota interna**.

## Estados y un chat por contacto

| Estado | Qué significa | Cómo llega |
| --- | --- | --- |
| **Abierto** (`OPEN`) | Se está atendiendo | Mensaje nuevo del cliente, o «Reabrir chat» |
| **En espera** (`ON_HOLD`) | El agente espera algo (del cliente o interno) | «Poner en espera» desde el chat |
| **Cerrado** (`CLOSED`) | Atención terminada | «Cerrar chat» o bloquear el contacto |

**Un único chat por contacto y línea:**
- índice único `(workspaceId, lineId, contactId)`: nunca se crean chats duplicados;
- **Cerrado + el cliente vuelve a escribir:** se reabre **el mismo chat**, **sin asignar**, con el aviso «El cliente volvió a escribir: chat reabierto». La autoasignación solo reparte los chats nuevos;
- **En espera + el cliente escribe:** el chat **sigue en espera**. El mensaje suma no leídos y suena igual;
- en espera **se puede responder**; un chat cerrado hay que reabrirlo primero (`409 CONVERSATION_CLOSED`).

**Chats creados antes de este cambio:** quien tenga varios chats del mismo contacto debe unirlos antes de arrancar la API; si no, la API se detiene y lo indica. El script mueve los mensajes al chat más reciente, sin perder ninguno, y borra los chats vacíos:

```bash
npm run inbox:merge-conversations              # solo muestra qué haría
npm run inbox:merge-conversations -- --apply   # los une
```

**Autoasignación** y **Respuestas rápidas** también están en el primer nivel del menú.

## Permisos

| Operación | Permiso |
| --- | --- |
| Menú, historial, archivos, contadores y SSE | `messages.read` |
| Responder, enviar archivos, tomar, cerrar/reabrir, notas y usar respuestas rápidas | `messages.send` |
| Transferir o dejar sin asignar | `conversations.assign` |
| Ver todas las conversaciones del workspace | `conversations.view_all` |
| Datos completos del contacto | `contacts.read` |
| Etiquetas del contacto, bloquear y desbloquear | `contacts.write` |
| Crear, editar y borrar respuestas rápidas | `quick_replies.manage` (OWNER y ADMIN) |
| Configurar autoasignación | `channels.manage` |

Los agentes sin `conversations.view_all` ven sus conversaciones y las no asignadas de las líneas que atienden. Las consultas, los archivos y los eventos del servidor aplican esta restricción: un chat ajeno responde 404. Ocultar controles en React no sustituye la autorización.

## Historial de movimientos

Cada cambio de una conversación se guarda en ella como mensaje `direction: EVENT`, con `event: { kind, by, from, to }`. El chat lo muestra centrado, por ejemplo «Olga transfirió el chat de Ana a Luis · 10:42». No cambia la vista previa de la lista.

| `kind` | Cuándo |
| --- | --- |
| `auto_assigned` | La autoasignación rotativa eligió un agente (`by: null`) |
| `assigned`, `transferred`, `unassigned` | `POST …/assign` (sin agente, de un agente a otro, o a nadie) |
| `taken` | «Tomar chat» |
| `claimed` | Alguien respondió un chat sin asignar y quedó asignado |
| `on_hold` | Poner en espera |
| `closed`, `reopened` | Cerrar y reabrir. `reopened` con `by: null`: el cliente volvió a escribir a un chat cerrado |
| `contact_blocked`, `contact_unblocked` | Bloquear y desbloquear al contacto |

## Archivos (imagen, audio, video, sticker, documento, ubicación)

**Recibidos:**
- Al llegar un mensaje con archivo, se copia de Meta a **MongoDB GridFS** (bucket `media`, con `workspaceId` en los metadatos) **en segundo plano**, sin retrasar la respuesta al webhook.
- Si esa copia falla, se reintenta la primera vez que alguien abre el archivo. Meta conserva los archivos unos 30 días.
- Las ubicaciones guardan latitud, longitud, nombre y dirección, y se muestran como tarjeta con enlace al mapa.

**Ver un archivo:** `GET …/conversations/:id/messages/:messageId/media`
- comprueba que puedes ver el chat (404 si no);
- devuelve el archivo en streaming con:
  - `Content-Type` de una lista de tipos conocidos (cualquier otro va como `application/octet-stream`);
  - `X-Content-Type-Options: nosniff` y `Content-Security-Policy: sandbox`;
  - `Content-Disposition` `inline` para imagen, audio y video, y `attachment` con nombre saneado para lo demás.
- El navegador lo descarga con el token y lo muestra desde una URL `blob:`.

**Enviar:** `POST …/conversations/:id/media` (multipart: `file`, `caption`)
- Aplica las mismas reglas que una respuesta de texto: chat abierto, ventana de 24 h, plan activo, cupo de contactos y reclamar el chat si nadie lo tiene.
- **Tipos y tamaños** (`415 UNSUPPORTED_MEDIA_TYPE`, `413 MEDIA_TOO_LARGE`):
  - imágenes JPG o PNG hasta 5 MB;
  - videos MP4 o 3GPP hasta 16 MB;
  - audio AAC, AMR, MP3, MP4 u OGG hasta 16 MB;
  - documentos PDF, Office o TXT hasta 16 MB (Meta admite 100 MB: el límite propio evita cargar archivos enormes en memoria).
- El archivo se guarda primero en GridFS, luego se sube a Meta (`/{phone-number-id}/media`) y se envía. Si Meta lo rechaza, el mensaje queda «fallido», pero el archivo sigue visible en el chat.
- **Notas de voz:** se graban en el navegador y siempre se envían como **OGG/Opus**, el formato de las notas de voz de WhatsApp:
  - Firefox graba OGG/Opus directamente;
  - Chrome, Edge y Safari graban en su formato. Meta rechaza el MP4 «fragmentado» que produce Chrome con «Media file scrutiny … failed», así que la grabación se decodifica, se codifica a Opus con WebCodecs (`AudioEncoder`) y se empaqueta en un contenedor Ogg propio, sin dependencias ([`ogg-opus.ts`](../../frontend-crm/src/components/inbox/ogg-opus.ts));
  - si el navegador no puede hacer ninguna de las dos cosas, el botón de micrófono no aparece.

## Contactos compartidos

- **Recibidos:** las tarjetas de contacto que envía el cliente (`type: contacts`) se guardan con nombre, teléfonos, correos y empresa. En el chat se muestran como tarjeta, con **Agregar a contactos** (`contacts.write`).
- **Enviar:** clip → **Contacto**. Se eligen hasta 5, de los contactos del CRM o escritos a mano. `POST …/conversations/:id/contacts` con `{ "contacts": [{ "name", "phone" }] }`:
  - aplica las mismas reglas que una respuesta;
  - un teléfono no válido devuelve `400 INVALID_PHONE`;
  - el cliente puede guardar el contacto o escribirle desde la tarjeta.

## Bloquear contacto

`POST /contacts/:id/block` y `/unblock` (`contacts.write`). Desde la bandeja (menú ⋮) o desde Contactos → Administrar.

**Al bloquear:**
1. El contacto queda `blocked`, con quién y cuándo.
2. Sus chats abiertos se cierran con el aviso `contact_blocked`; si no tenía ninguno abierto, el aviso queda en el más reciente.
3. Se bloquea su número en WhatsApp (`POST /{phone-number-id}/block_users`) en cada línea donde escribió.
4. Los mensajes que envíe después se ignoran al llegar: no abren chat ni suenan.

**Si Meta lo rechaza** (solo deja bloquear a quien escribió en las últimas 24 h):
- el bloqueo del CRM se mantiene igual;
- la respuesta lo indica por línea en `whatsapp[].ok` / `error`, y la interfaz lo explica.

**Desbloquear** revierte las dos cosas y deja el aviso `contact_unblocked`.

## Respuestas rápidas

- **Dónde se guardan:** colección `quick_replies`, con un `shortcut` único por workspace (letras, números, `-` y `_`, sin tildes) y el `text`.
- **API:** `GET/POST/PATCH/DELETE /quick-replies`. Para administrarlas hace falta `quick_replies.manage`; para listarlas basta `messages.send`.
- **Página:** **Respuestas rápidas** (menú de primer nivel).
- **En el editor:** «/» y parte del atajo muestran las coincidencias. Se elige con las flechas y Enter o Tab, o con un clic; Escape cierra la lista.

## Avisos de mensajes nuevos

Con cada mensaje **entrante** que puedes ver (por SSE), salvo el del chat que tienes abierto y visible:
- suena un **«ding» de dos tonos** generado con Web Audio, sin archivos de sonido;
- con las **notificaciones de escritorio** activadas y la pestaña en segundo plano, aparece una notificación con el contacto y el texto. Al hacer clic se abre ese chat.

**Contadores:**
- el menú **Bandeja** muestra los no leídos;
- la pestaña del navegador muestra «(N) …» en cualquier página.

**Preferencias:** con la campanita de la bandeja. Se guardan por navegador (`localStorage`), y el permiso del navegador se pide solo al pulsar el interruptor.

## Respuestas y eventos

- **Respuestas:** requieren una conversación abierta y un mensaje entrante del cliente en las últimas 24 horas.
- **Notas:** son internas y nunca se envían a WhatsApp.
- **Fallos de envío:** el mensaje se conserva como «No entregado» y no se reintenta automáticamente, para evitar duplicados. Debajo, el chat explica la causa según el código de Meta (131005 permiso del token, 190 token vencido, 131030 número no permitido en modo prueba, 131047 fuera de las 24 h…; ver [Canales](channels.md#envíos-rechazados-por-meta)).
- **Reintentar:** `POST /conversations/:id/messages/:messageId/retry` vuelve a enviar **el mismo mensaje** (texto, contactos o el archivo guardado en GridFS) con las mismas reglas que una respuesta. Solo para mensajes salientes en `failed` (`409 MESSAGE_NOT_RETRYABLE`); el chat no cambia de lugar en la lista.
- **Errores de Meta:** se guardan con `error_data.details` y `fbtrace_id`, sin el token de acceso (Meta lo repite en algunos errores y se reemplaza por `[token]`).

**Tiempo real:**
- El frontend lee `/api/v1/workspaces/:workspaceId/conversations/events` con `fetch` y Bearer.
- Si se corta, reconecta esperando cada vez más (hasta 30 segundos) y resincroniza las consultas al volver.
- Al cambiar de workspace o cerrar sesión, cancela la conexión.

**Controles del servidor:**
- Antes de cada evento, y cada 25 segundos sin actividad, revalida el token, la sesión, la membresía y el permiso.
- Tras una revocación no entrega más datos.
- Al expirar el access token cierra la conexión.
- Ni los secretos ni los textos de los mensajes se registran en los logs.

## API

Swagger: `/docs`, etiquetas `inbox`, `contacts` y `quick-replies`. Prefijo: `/api/v1/workspaces/:workspaceId`.

- `GET /conversations`: `view` (`mine|unassigned|all`), `status` (`OPEN|ON_HOLD|CLOSED|ALL`), `lineId`, `contactId`, `search`, `cursor` y `limit`.
- `GET /conversations/options` · `GET /conversations/counts` (`mine`, `unassigned`, `all`, `onHold`, `closed`, `unread`) · `GET /conversations/events`.
- `GET /conversations/:id` · `GET /conversations/:id/messages` · `GET /conversations/:id/messages/:messageId/media`.
- `POST /conversations/:id/messages` y `/notes` (`{ "text": "..." }`) · `POST /conversations/:id/media` (multipart) · `POST /conversations/:id/contacts` · `POST /conversations/:id/messages/:messageId/retry`.
- `POST /conversations/:id/take`, `/read`, `/unread`, `/hold`, `/close` y `/reopen`.
- `POST /conversations/:id/assign`: `{ "membershipId": "uuid o null" }`.
- `POST /contacts/:id/block` y `/unblock`.
- `GET/POST/PATCH/DELETE /quick-replies`.
- `GET /channels/auto-assignment`: configuración y miembros activos, sin credenciales.

## Probar localmente

**Con datos demo:**
1. Con Docker y la API activos, configura en `.env`:
   - `SEED_DEMO_DATA=true`;
   - `WHATSAPP_MODE=simulated`;
   - `SEED_DEMO_PASSWORD`;
   - `CHANNEL_SECRETS_KEY`.
2. Ejecuta `npm run db:seed`. El workspace Acme tendrá una línea demo, diez contactos, etiquetas y conversaciones.

**Generar un mensaje entrante:**

```bash
npm run whatsapp:simulate -- --line ID_DE_LINEA --from +59170000555 --text "Hola desde el simulador"
```

Con un número real (túnel y `WHATSAPP_MODE=live`), ver [Canales](channels.md#en-desarrollo-túnel-hacia-el-webhook).

## Límites de esta entrega

**Cupo mensual de contactos:**
- Cuenta los contactos distintos a los que se intenta responder (texto o archivo), en meses UTC.
- El cupo se reserva en PostgreSQL bajo bloqueo del workspace: dos respuestas simultáneas no pueden ocupar el mismo último cupo.
- Recibir mensajes y guardar notas nunca consume cupos.
- Sin acceso completo al plan no se puede responder: `402 SUBSCRIPTION_INACTIVE`.

**Otros límites:**
- **Plantillas:** todavía no se envían, así que fuera de la ventana de 24 h no se puede escribir.
- **Archivos:**
  - se conservan en GridFS sin caducidad, y al borrar una línea o un contacto no se borran;
  - un archivo que Meta ya eliminó (más de ~30 días) y que nunca se copió no se puede recuperar.
- **Tiempo real con varias instancias:** SSE usa un bus en memoria de una sola instancia; con varias hace falta Redis.
- **Fallos parciales:** no hay cola persistente ni transacción distribuida entre PostgreSQL y MongoDB. Los webhooks se procesan durante la petición, y la deduplicación usa el identificador de Meta.
- **No leídos:** pertenecen a la conversación, no a cada agente.
- **Avisos:** el sonido y las notificaciones de escritorio solo funcionan con la aplicación abierta en alguna pestaña; no hay notificaciones push.
