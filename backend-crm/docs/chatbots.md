# Chatbots

Bots de WhatsApp que atienden a los clientes de una línea: saludan, muestran menús con botones o listas, guardan respuestas, deciden por condiciones u horario y pasan el chat a un agente. Se arman en un editor de flujos (**Automatización → Chatbots**), como en wasapi.

Código: [`src/modules/chatbots`](../src/modules/chatbots). El flujo y el motor son dominio puro ([`flow.ts`](../src/modules/chatbots/domain/flow.ts), [`flow-engine.ts`](../src/modules/chatbots/domain/flow-engine.ts)); el resto envía y aplica lo que el motor decide.

## Reglas

- **Un bot por línea.** `channel_lines.chatbot_id` apunta a un solo bot, así nunca responden dos a la vez. Un bot puede atender varias líneas.
- **Responde en todos los chats de su línea** mientras esté **activo** y dentro de su **horario** (`schedule`; `null` = siempre).
- **Solo se activa con el flujo completo.** Si hay errores, la activación responde `409 FLOW_INCOMPLETE`.
- **No reclama el chat.** Mientras el bot atiende, el chat queda sin asignar y la autoasignación espera al nodo **Transferir**.
- **Un chat inactivo empieza de nuevo** tras `restartAfterMinutes` (60 por defecto, entre 5 y 10080).
- **Desactivar en un chat** (⋮ de la cabecera, permiso `messages.send`) apaga el bot solo para ese contacto. Sigue apagado aunque el chat se cierre y el cliente vuelva a escribir, hasta que un agente lo active de nuevo.
- **Pausa al transferir.** El nodo **Transferir** pausa el bot en ese chat para que no repita el menú mientras atiende el agente. Esa pausa sí termina al cerrarse el chat: si el cliente vuelve a escribir, el bot lo atiende desde el inicio.

## Nodos

| Nodo | Qué hace | Salidas |
| --- | --- | --- |
| `start` | Uno por flujo | `next` |
| `message` | Texto, o un archivo subido al bot con el texto como pie | `next` |
| `buttons` | Hasta 3 botones de respuesta rápida (título ≤ 20, cuerpo ≤ 1024, encabezado y pie ≤ 60) | Una por botón y `other` |
| `list` | Lista desplegable: botón ≤ 20, hasta 10 filas (título ≤ 24, descripción ≤ 72) | Una por fila y `other` |
| `url` | Botón con enlace (`cta_url`) | `next` |
| `question` | Guarda la respuesta en una variable; valida texto, número, email o teléfono | `next` |
| `condition` | Reglas sobre el último mensaje o una variable (igual, contiene, empieza con, es número, está vacío) | Una por regla y `else` |
| `hours` | Horario de atención propio | `in` y `out` |
| `tags` | Agrega y quita etiquetas del contacto | `next` |
| `transfer` | A los agentes de la línea por turnos, a un agente o a la cola sin asignar. Luego envía `message` | Ninguna |
| `status` | Abrir, poner en espera o cerrar | `next` (salvo al cerrar) |
| `end` | Termina el flujo | Ninguna |

**Variables en los textos:**
- `{{nombre}}` y `{{telefono}}` del contacto;
- las respuestas guardadas con `question`, como `{{correo}}`;
- en el mensaje de `transfer`, `{{agente}}`: el nombre de quien recibió el chat, o «un agente» si quedó sin asignar.

**Mensaje al transferir:** el predeterminado es «Te comunicamos con {{agente}}. En breve te atenderá.». Vacío: no se envía nada.

**Respuestas que no coinciden:**
- **Una respuesta fuera de las opciones** repite la pregunta con el texto de «Respuesta no válida».
- **Tras 3 intentos** sigue la salida `other` si está conectada; si no, el flujo termina.
- **Escribir a mano el título o el número de la opción** también vale.
- **Contra bucles:** un turno recorre como máximo 25 nodos.

## Ejecución

1. **Llega el mensaje.** El webhook guarda el mensaje entrante (con `reply: { id, title }` si el cliente pulsó un botón o una fila) y emite `message.created`.
2. **Se encola.** [`ChatbotRunner`](../src/modules/chatbots/application/chatbot-runner.service.ts) lo toma después de responder a Meta, en una cola en memoria por conversación que conserva el orden.
3. **Se comprueba si el bot atiende:**
   - el chat no está cerrado ni tiene el bot pausado;
   - la línea tiene bot, activo y dentro de horario.
4. **Avanza el flujo.** `advance()` devuelve las acciones:
   - `send` (texto, archivo o interactivo);
   - `tags`;
   - `transfer`;
   - `status`.
5. **Se ejecutan las acciones** con `InboxService`:
   - los mensajes salen firmados `sentBy: { userId: 'bot:<id>', name, kind: 'bot' }`;
   - un mensaje rechazado (ventana de 24 h, cupo del plan…) detiene el resto del turno.

## Historial

Lo que hace el bot queda en el chat como evento, firmado con `by: { userId: 'bot:<id>', name, kind: 'bot' }`.

| `kind` | Texto en el chat |
| --- | --- |
| `bot_tagged` | «🤖 Bot de ventas agregó la etiqueta VIP y quitó Nuevo» (`tags: { added, removed }` con los nombres) |
| `bot_transferred` | «🤖 Bot de ventas delegó el chat a Ana» (o «dejó el chat en la cola sin asignar») |
| `closed`, `on_hold`, `reopened` | «🤖 Bot de ventas cerró el chat»… |
| `bot_paused`, `bot_resumed` | «Ana desactivó el bot en este chat» / «activó» |

## API

Bajo `/api/v1/workspaces/:workspaceId/chatbots`. Permiso `chatbots.manage` (Propietario y Admin); plan con `features.advanced_chatbots`.

| Método y ruta | Qué hace |
| --- | --- |
| `GET` · `POST` | Lista (con líneas y número de errores) · crea con un flujo de inicio |
| `GET :chatbotId` | El bot con `graph`, `schedule` e `issues` (errores y avisos por nodo) |
| `PATCH :chatbotId` | `name`, `enabled`, `graph`, `schedule`, `restartAfterMinutes` |
| `DELETE :chatbotId` | Elimina; sus líneas quedan sin bot |
| `POST :chatbotId/duplicate` | Copia inactiva, sin líneas |
| `PUT :chatbotId/lines` | `{ lineIds, takeOver }`: sin `takeOver`, una línea de otro bot da `409 LINE_HAS_CHATBOT` |
| `POST :chatbotId/media` · `GET :chatbotId/media/:fileId` | Archivos de los nodos de mensaje (GridFS, mismos tipos y tamaños que WhatsApp) |
| `POST simulate` | `{ graph, session, text, replyId, contactName }` → `{ actions, session }`. Prueba el flujo sin enviar nada |

En la bandeja, `POST /conversations/:id/bot/pause` y `/bot/resume` (`messages.send`). Cada chat trae `bot: { state: 'none' | 'active' | 'paused', name, pausedBy }`.

**Errores:**
- `CHATBOT_NOT_FOUND`;
- `FLOW_INVALID` (forma inválida);
- `FLOW_INCOMPLETE` (activar con errores);
- `SCHEDULE_INVALID`;
- `LINE_NOT_FOUND`;
- `LINE_HAS_CHATBOT`;
- `FEATURE_NOT_IN_PLAN`;
- `MEDIA_NOT_FOUND`.

**Auditoría:** `chatbots.chatbot.created`, `.updated`, `.deleted`, `.lines_changed`.

## Probar

- **Editor:** «Probar chatbot» abre un chat de prueba contra `simulate`. Los botones y las filas se pueden pulsar, y las acciones se muestran como avisos («Transferiría el chat a Ana»).
- **Pruebas automáticas:**
  - `npx jest src/modules/chatbots`: motor y formato;
  - `npm run test:e2e -- chatbots`: con el gateway simulado, el bot responde, transfiere, avisa al cliente y se pausa o reactiva desde el chat.

## Límites

- **El bot corre en el proceso de la API.** No hay cola persistente: con varias instancias hay que moverlo a una cola compartida, y un reinicio a mitad de un turno lo pierde.
- **No hay esperas largas con temporizador** («si no responde en 1 hora…»).
- **Faltan nodos:** plantillas pagadas, consulta a una API externa y asistente IA.
