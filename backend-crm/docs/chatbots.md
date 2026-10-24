# Chatbots

Bots de WhatsApp que atienden a los clientes de una línea: saludan, muestran menús con botones o listas, guardan respuestas, deciden por condiciones u horario y pasan el chat a un agente. Se arman en un editor de flujos (**Automatización → Chatbots**), como en wasapi.

Código: [`src/modules/chatbots`](../src/modules/chatbots). El flujo y el motor son dominio puro ([`flow.ts`](../src/modules/chatbots/domain/flow.ts), [`flow-engine.ts`](../src/modules/chatbots/domain/flow-engine.ts)); el resto envía y aplica lo que el motor decide.

## Reglas

- **Un bot por línea.** `channel_lines.chatbot_id` apunta a un solo bot, así nunca responden dos a la vez. Un bot puede atender varias líneas.
- **Responde en todos los chats de su línea** mientras esté **activo** y dentro de su **horario** (`schedule`; `null` = 24/7). Un horario sin ningún día ni rango deja el bot **completamente desactivado**.
- **Solo se activa con el flujo completo.** Si hay errores, la activación responde `409 FLOW_INCOMPLETE`.
- **No reclama el chat.** Mientras el bot atiende, el chat queda sin asignar y la autoasignación espera al nodo **Transferir**.
- **Duración de conversación activa:** un chat sin mensajes durante `restartAfterMinutes` (30 por defecto, entre 2 y 10080) empieza de nuevo con el saludo.
- **Desactivar en un chat** (⋮ de la cabecera, permiso `messages.send`) apaga el bot solo para ese contacto, **por 24 horas** (vuelve solo) o **permanentemente** (hasta que un agente lo active). La pausa sigue aunque el chat se cierre y el cliente vuelva a escribir.
- **Pausa al transferir.** El nodo **Transferir** apaga el bot en ese chat para que no repita el menú mientras atiende el agente: por 24 horas (predeterminado) o permanentemente, según `pause` del nodo.
- **No marca como leído.** Lo que envía el bot no pone a cero los no leídos; si el bot cierra el chat, este aparece en **Cerrado** con su contador.

## Configuración

`PATCH :chatbotId` guarda la configuración general («Configuración del chatbot», como en wasapi):

| Campo | Qué hace |
| --- | --- |
| `name`, `description` | Nombre y descripción (solo para el equipo, ≤ 300) |
| `fallbackText` | «Mensaje cuando no se encuentra respuesta»: el cliente escribe algo que el flujo no espera (flujo terminado, o botones o lista sin texto propio). Vacío: no se envía nada |
| `restartKeywords` | «Palabras para volver al saludo inicial» (`['menu']` por defecto, hasta 10). Se comparan sin mayúsculas ni tildes, con el mensaje entero |
| `restartAfterMinutes` | Duración de conversación activa (30, mínimo 2) |
| `inactivityMinutes`, `inactivityText` | Mensaje de inactividad: si el bot espera una respuesta (botones, lista o pregunta) y el cliente no contesta en 1–29 minutos, se envía una vez. `null`: desactivado |
| `schedule` | Días y horas con zona horaria (el editor propone `America/La_Paz`, UTC-4). `null`: 24/7 |
| `variables` | Variables del bot (ver abajo); `400 VARIABLES_INVALID` si un nombre se repite o choca con uno del contacto |

Las líneas se asignan con `PUT :chatbotId/lines`.

## Nodos

Cada nodo tiene un `title` (≤ 60) que solo ve quien arma el flujo, y el editor muestra en cada uno una guía «Cómo funciona».

| Nodo | Qué hace | Salidas |
| --- | --- | --- |
| `start` | Uno por flujo | `next` |
| `message` | Texto y hasta 5 archivos (`attachments`). Un archivo lleva el texto como pie; varios van después del texto | `next` |
| `buttons` | Hasta 3 botones de respuesta rápida (título ≤ 20, cuerpo ≤ 1024, encabezado y pie ≤ 60). `attachments` se envían antes. `invalidText` obligatorio | Una por botón y `other` |
| `list` | Lista desplegable: botón ≤ 20, hasta 10 filas (título ≤ 24, descripción ≤ 72). `attachments` antes; `invalidText` obligatorio | Una por fila y `other` |
| `url` | Botón con enlace (`cta_url`) | `next` |
| `question` | Guarda la respuesta en una variable del bot; valida por `validation` y por el tipo de la variable. `saveTo: name \| email` la guarda también en el contacto | `next` |
| `condition` | Reglas sobre el último mensaje o una variable (del bot o del contacto): igual, contiene, empieza con, es número, está vacío, mayor que, menor que, es sí, es no | Una por regla y `else` |
| `hours` | **No envía nada**: según la hora en su zona, sigue por «Dentro» o «Fuera del horario». Hay que conectar una respuesta en cada salida | `in` y `out` |
| `tags` | Agrega y quita etiquetas del contacto | `next` |
| `transfer` | A los agentes de la línea por turnos, a un agente o a la cola sin asignar. Luego envía `message` y apaga el bot en el chat (`pause: '24h' \| 'permanent'`) | Ninguna |
| `status` | Abrir, poner en espera o cerrar | `next` (salvo al cerrar) |
| `end` | Termina el flujo | Ninguna |

**Variables** ([`variables.ts`](../src/modules/chatbots/domain/variables.ts)):
- **del contacto**, siempre disponibles: `{{nombre}}`, `{{apellido}}`, `{{nombre_completo}}`, `{{email}}`, `{{telefono}}`;
- **del bot**, creadas en «Variables» con nombre, tipo (`text`, `number` o `boolean`), valor por defecto y descripción. Cada conversación empieza con los valores por defecto y `question` las llena. Un booleano guarda `'true'`/`'false'` y entiende «sí», «no», «1», «0»…;
- en el mensaje de `transfer`, `{{agente}}`: el nombre de quien recibió el chat, o «un agente» si quedó sin asignar.

El editor inserta cualquiera con «Agregar variable». Una variable desconocida se lee como texto vacío.

**Mensaje al transferir:** el predeterminado es «Te comunicamos con {{agente}}. En breve te atenderá.». Vacío: no se envía nada.

**Respuestas que no coinciden:**
- **Una respuesta fuera de las opciones** envía «Respuesta si elige otra cosa» del nodo (si falta, `fallbackText`) y repite las opciones.
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
   - `status`;
   - `contact` (nombre o email guardados por `question`).
   Antes de avanzar, una palabra de `restartKeywords` vuelve al inicio. Si el flujo ya terminó pero la conversación sigue activa (`session.nodeId: null`), el mensaje recibe `fallbackText`.
5. **Se ejecutan las acciones** con `InboxService`:
   - los mensajes salen firmados `sentBy: { userId: 'bot:<id>', name, kind: 'bot' }`;
   - un mensaje rechazado (ventana de 24 h, cupo del plan…) detiene el resto del turno.
6. **Inactividad.** Si el bot quedó esperando y hay `inactivityMinutes`, la sesión guarda `nudgeAt`. Cada 30 s el runner reclama los vencidos de cada espacio (`claimBotNudges`, atómico) y envía `inactivityText` una sola vez.

## Historial

Lo que hace el bot queda en el chat como evento, firmado con `by: { userId: 'bot:<id>', name, kind: 'bot' }`.

| `kind` | Texto en el chat |
| --- | --- |
| `bot_tagged` | «🤖 Bot de ventas agregó la etiqueta VIP y quitó Nuevo» (`tags: { added, removed }` con los nombres) |
| `bot_transferred` | «🤖 Bot de ventas delegó el chat a Ana (bot desactivado por 24 horas)» (o «dejó el chat en la cola sin asignar»). `pause: { until }` |
| `closed`, `on_hold`, `reopened` | «🤖 Bot de ventas cerró el chat»… |
| `bot_paused`, `bot_resumed` | «Ana desactivó el bot en este chat por 24 horas» (o «permanentemente», `pause: { until: null }`) / «activó» |

## API

Bajo `/api/v1/workspaces/:workspaceId/chatbots`. Permiso `chatbots.manage` (Propietario y Admin); plan con `features.advanced_chatbots`.

| Método y ruta | Qué hace |
| --- | --- |
| `GET` · `POST` | Lista (con líneas y número de errores) · crea con un flujo de inicio |
| `GET :chatbotId` | El bot con `graph`, `schedule` e `issues` (errores y avisos por nodo) |
| `PATCH :chatbotId` | `name`, `enabled`, `graph` y la [configuración](#configuración) |
| `DELETE :chatbotId` | Elimina; sus líneas quedan sin bot |
| `POST :chatbotId/duplicate` | Copia inactiva, sin líneas |
| `PUT :chatbotId/lines` | `{ lineIds, takeOver }`: sin `takeOver`, una línea de otro bot da `409 LINE_HAS_CHATBOT` |
| `POST :chatbotId/media` · `GET :chatbotId/media/:fileId` | Archivos de los nodos de mensaje (GridFS, mismos tipos y tamaños que WhatsApp) |
| `POST simulate` | `{ graph, session, text, replyId, contactName, fallbackText, restartKeywords, variables }` → `{ actions, session }`. Prueba el flujo sin enviar nada |

En la bandeja, `POST /conversations/:id/bot/pause` con `{ duration: '24h' | 'permanent' }` (24 h si falta) y `/bot/resume` (`messages.send`). Cada chat trae `bot: { state: 'none' | 'active' | 'paused', name, pausedBy, pausedUntil }`; una pausa de 24 h vencida ya se lee `active`.

**Errores:**
- `CHATBOT_NOT_FOUND`;
- `FLOW_INVALID` (forma inválida);
- `FLOW_INCOMPLETE` (activar con errores);
- `SCHEDULE_INVALID`;
- `VARIABLES_INVALID`;
- `LINE_NOT_FOUND`;
- `LINE_HAS_CHATBOT`;
- `FEATURE_NOT_IN_PLAN`;
- `MEDIA_NOT_FOUND`.

**Auditoría:** `chatbots.chatbot.created`, `.updated`, `.deleted`, `.lines_changed`.

## Probar

- **Editor:** «Probar chatbot» abre un chat de prueba contra `simulate`, con la configuración y las variables guardadas. Los botones y las filas se pueden pulsar, y las acciones se muestran como avisos («Transferiría el chat a Ana y el bot quedaría desactivado en ese chat por 24 horas»).
- **Pruebas automáticas:**
  - `npx jest src/modules/chatbots`: motor y formato;
  - `npm run test:e2e -- chatbots`: con el gateway simulado, el bot responde, transfiere, avisa al cliente, se pausa 24 h o permanentemente y vuelve solo al vencer la pausa, cierra sin marcar como leído, responde con `fallbackText`, vuelve al menú con una palabra y envía el mensaje de inactividad.

## Límites

- **El bot corre en el proceso de la API.** No hay cola persistente: con varias instancias hay que moverlo a una cola compartida, y un reinicio a mitad de un turno lo pierde.
- **El mensaje de inactividad lo revisa un temporizador del proceso** cada 30 s (reclamo atómico en Mongo, así no se duplica entre instancias). No hay otras esperas con temporizador («si no responde en 1 hora…»); la pausa de 24 h no necesita temporizador: se compara la hora al recibir un mensaje.
- **Faltan nodos:** plantillas pagadas, consulta a una API externa y asistente IA (fuera de alcance a propósito).
