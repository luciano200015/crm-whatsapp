# Bandeja de mensajes

En la aplicación, **Mensajes → Bandeja** reúne las conversaciones del workspace activo. Las pestañas separan los chats propios, sin asignar y, para supervisores autorizados, todos los chats. Se puede buscar por contacto, filtrar por línea y estado, cargar historial anterior, tomar un chat, transferirlo, cerrar o reabrirlo.

## Permisos

| Operación | Permiso |
| --- | --- |
| Menú, historial, contadores y SSE | `messages.read` |
| Responder, tomar, cerrar/reabrir y notas internas | `messages.send` |
| Transferir o dejar sin asignar | `conversations.assign` |
| Consultar todas las conversaciones del workspace | `conversations.view_all` |
| Consultar datos completos del contacto | `contacts.read` |
| Modificar etiquetas del contacto | `contacts.write` |
| Configurar autoasignación | `channels.manage` |

Los agentes sin `conversations.view_all` ven sus conversaciones y las no asignadas de las líneas que atienden. Las consultas y eventos del servidor aplican esta restricción; ocultar controles en React no sustituye la autorización. Los menús vacíos se ocultan y las rutas sin permiso redirigen a `/forbidden`.

## Respuestas y eventos

Las respuestas de texto requieren una conversación abierta y un mensaje entrante del cliente en las últimas 24 horas. Las notas son internas y nunca se envían a WhatsApp. Un fallo de envío se conserva como mensaje fallido: no se reintenta automáticamente, para evitar duplicados.

El frontend usa `fetch` con Bearer para leer `/api/v1/workspaces/:workspaceId/conversations/events`. Reconecta con espera progresiva de hasta 30 segundos, sincroniza las consultas al reconectar y cancela la conexión al cambiar workspace o cerrar sesión. Los contadores también se actualizan cada 30 segundos.

El servidor revalida token, sesión, membresía y permiso antes de cada evento y cada 25 segundos sin actividad. Tras una revocación no entrega más datos; una conexión inactiva se cierra en la siguiente comprobación. Al expirar el access token se cierra la conexión mediante un temporizador. Los secretos y textos de mensajes no se registran en logs.

## API

Swagger: `/docs`, etiqueta `inbox`. Prefijo: `/api/v1/workspaces/:workspaceId`.

- `GET /conversations`: `view`, `status`, `lineId`, `contactId`, `search`, `cursor`, `limit`.
- `GET /conversations/options`: nombres de líneas visibles; destinatarios activos solo con `conversations.assign`.
- `GET /conversations/counts` y `GET /conversations/events`.
- `GET /conversations/:id` y `GET /conversations/:id/messages`.
- `POST /conversations/:id/messages` y `/notes`: `{ "text": "..." }`.
- `POST /conversations/:id/take`, `/read`, `/close`, `/reopen`.
- `POST /conversations/:id/assign`: `{ "membershipId": "uuid o null" }` (usar JSON `null` para desasignar).
- `GET /channels/auto-assignment`: configuración y miembros activos, sin credenciales y sin exigir `channels.read` o `members.read`.
- La configuración usa `PUT /channels/lines/:id/agents` y `PATCH /channels/lines/:id` con `autoAssign`.

## Probar localmente

Con Docker y API activos, configurar en `.env` `SEED_DEMO_DATA=true`, `WHATSAPP_MODE=simulated`, `SEED_DEMO_PASSWORD` y `CHANNEL_SECRETS_KEY`. Ejecutar `npm run db:seed`. El workspace Acme tendrá una línea demo, diez contactos, etiquetas y conversaciones. Repetir el seed conserva las conversaciones editadas. No se crean datos de mensajería demo en modo live ni en producción.

Ingresar con un usuario demo y abrir **Mensajes → Bandeja**. El propietario puede elegir «Todos»; los agentes ven sus chats. Para generar un mensaje entrante nuevo:

```bash
npm run whatsapp:simulate -- --line ID_DE_LINEA --from +59170000555 --text "Hola desde el simulador"
```

El mensaje aparece en tiempo real y se asigna rotativamente si la línea tiene autoasignación activa y agentes disponibles. Probar responder, agregar una nota, cerrar y reabrir. En modo simulado ningún mensaje sale hacia Meta.

## Límites de esta entrega

El límite mensual cuenta contactos distintos a los que se intenta responder, en meses UTC. Se reserva el cupo en PostgreSQL bajo bloqueo del workspace: dos respuestas simultáneas no pueden ocupar el mismo último cupo. Un fallo de Meta conserva la reserva; reintentar para ese contacto no consume otro cupo. Recibir mensajes y guardar notas nunca consume cupos. Sin acceso completo al plan (prueba terminada o impaga) no se puede responder: `402 SUBSCRIPTION_INACTIVE`, igual que al registrar agentes o conectar líneas. El registro de cupos comienza con esta migración; no reconstruye retrospectivamente envíos previos.

- La configuración real de WhatsApp requiere credenciales válidas y una URL HTTPS pública: ver [Canales](channels.md). Embedded Signup queda pendiente.
- Multimedia entrante muestra tipo, nombre y descripción; todavía no se descargan archivos ni se envían adjuntos o plantillas.
- SSE utiliza un bus en memoria de una sola instancia; para varias instancias se necesita distribución de eventos con Redis.
- No hay cola persistente ni transacción distribuida PostgreSQL/MongoDB; los webhooks se procesan durante la petición. Se conserva la deduplicación por identificador de Meta, pero la recuperación de fallos entre escrituras requiere una futura cola/outbox.
- Los no leídos pertenecen a la conversación, no a cada agente.
- Los datos demo no renuevan sus fechas al repetir el seed. Usar el simulador para abrir otra ventana de respuesta.
