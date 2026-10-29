# Chatbots

Bots de WhatsApp que atienden a los clientes de una línea: saludan, muestran botones o listas, envían ubicaciones y contactos, guardan respuestas y campos del contacto, consultan APIs externas, deciden por condiciones u horario y pasan el chat a un agente. Se arman en un editor de flujos (**Automatización → Chatbots**), como en wasapi.

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
| `message` | «Respuesta»: texto y hasta 5 archivos (`attachments`). Un archivo lleva el texto como pie; varios van después del texto. Con «Botones interactivos» (`options`, ver abajo) envía botones o una lista. Sin opciones, `wait: true` desmarca «Enviar mensaje y saltar al siguiente nodo»: espera la respuesta (ver «Respuesta del usuario») | Una por opción; sin opciones, `next` (con `wait`, varias conexiones) |
| `url` | «Botón de URL» (`cta_url`), con un archivo de encabezado opcional (`attachment`: imagen, video o documento). Admite `wait` como `message` | `next` (con `wait`, varias conexiones) |
| `question` | «Guardar respuesta»: guarda la respuesta en una variable del bot; valida por `validation` y por el tipo de la variable. `saveTo: name \| email` la guarda también en el contacto. **Sin texto** (solo si la tarjeta tiene `trigger`) no pregunta: guarda el mensaje que la abrió | `next` y `other` (respuesta no válida, opcional) |
| `location` | «Enviar ubicación»: `latitude` (−90..90), `longitude` (−180..180), `name` y `address` (≤ 100, opcionales) | `next` |
| `contact_card` | «Enviar contacto»: de 1 a 5 tarjetas `{ name ≤ 80, phone }` (teléfono con código de país) | `next` |
| `condition` | Reglas sobre el último mensaje o una variable (del bot o del contacto, también `campo_<key>`): es igual / no es igual, contiene / no contiene, empieza con, es número / no es número, está vacío / no está vacío, mayor, menor, mayor o igual, menor o igual, está en / no está en (lista separada por comas), es sí, es no. `match`: `all` (se cumplen todas) o `any` (alguna) salen por «Cumple» / «No cumple»; `each` (los flujos guardados antes, que no tienen `match`) sale por la primera regla que se cumple | `all`/`any`: `yes` y `no`; `each`: una por regla y `else` |
| `hours` | **No envía nada**: según la hora en su zona, sigue por «Dentro» o «Fuera del horario». Hay que conectar una respuesta en cada salida. Se mantiene el editor de días y horas (el de wasapi interpreta texto libre con IA) | `in` y `out` |
| `tags` | «Gestionar etiquetas»: agrega y quita etiquetas del contacto | `next` |
| `funnel` | «Establecer contacto en embudo»: crea o mueve el lead del contacto a `stageId` de `funnelId` (ver [funnels.md](funnels.md)). Si el embudo ya no existe, es de otra línea o el plan no incluye embudos, se registra un aviso y el flujo sigue | `next` |
| `contact_field` | «Actualizar campo de contacto»: `field` (`name`, `email` o la clave de un [campo personalizado](contacts.md)), con el valor de `source: 'answer'` (el último mensaje del cliente) o `'manual'` (`value`, con variables). El valor se valida con el tipo del campo (fecha, número, opción…) | `ok` («Campo actualizado») y `fail` («Campo no actualizado») |
| `api` | «Consulta API»: llama a un servicio externo (ver abajo) y guarda valores de su respuesta en variables | `ok` («Éxito») y `error` |
| `transfer` | A los agentes de la línea por turnos, a un agente o a la cola sin asignar. Luego envía `message`, deja `note` («Mensaje para el agente», opcional) como nota interna del chat y apaga el bot en el chat (`pause: '24h' \| 'permanent'`) | Ninguna |
| `status` | Abrir, poner en espera o cerrar. `bot: 'pause'` («Desactivar bot») apaga el bot en el chat permanentemente, como la pausa de un agente, y termina el flujo; `'keep'` (por defecto) lo deja activo | `next` (salvo al cerrar o con `bot: 'pause'`) |
| `end` | Termina el flujo | Ninguna |

**«Botones interactivos» de una Respuesta** (`options`, hasta 10, cada una `{ id, title ≤ 24, description ≤ 72 }`):
- **De 1 a 3 opciones con título ≤ 20 y sin descripción** se envían como botones de respuesta rápida. Si la Respuesta tiene un solo archivo de imagen, video o documento, va como **encabezado** de la misma burbuja.
- **Con 4 o más, un título largo o alguna descripción** se envían como lista de una sola sección, sin título. Solo se pide `listButton` («Nombre del botón de la lista», ≤ 20; «Ver opciones» si falta). Los archivos se envían antes, porque WhatsApp no admite encabezado de archivo en listas.
- `header`, `footer` (≤ 60) e `invalidText` («Texto si elige otra cosa»; vacío: el `fallbackText` del bot) son opcionales.
- **Compatibilidad:** los nodos `buttons` y `list` guardados antes se leen como `message` con `options`. Las secciones se aplanan y los `id` de opción se conservan, así que las conexiones y los botones ya enviados siguen valiendo. Se guardan con la forma nueva la próxima vez que se edita el bot; no hay migración.

**«Consulta API»** (`api`):
- `method` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), `url` (`https://` obligatorio, ≤ 2000), `auth` (`none`, `bearer` con `token`, `basic` con `user` y `password`, o `headers`), `headers` (≤ 20), `params` (≤ 30) y `responses` (≤ 20, `{ path, variable }`).
- La URL, las cabeceras y los parámetros admiten variables; en la URL van codificadas. Con `GET`, los parámetros van en la query; con los demás métodos, como JSON en el cuerpo.
- `responses` lee la respuesta JSON por ruta (`data.items.0.nombre` o `data.items[0].nombre`) y guarda el valor como texto (≤ 500) en la variable del bot.
- Solo un `2xx` sigue por `ok`; un error, un `3xx` o un tiempo agotado siguen por `error`.
- **Protecciones** ([`https-bot-client.ts`](../src/modules/chatbots/infrastructure/https-bot-client.ts), [`ip-guard.ts`](../src/modules/chatbots/domain/ip-guard.ts)): solo `https`; el nombre se resuelve con un `lookup` propio que rechaza direcciones privadas, de loopback, link-local (incluido `169.254.169.254`), CGNAT, multicast, reservadas y ULA, en IPv4 e IPv6 (también IPv4 dentro de IPv6), y la conexión va a la dirección ya comprobada, así un cambio de DNS no cuela otra; no sigue redirecciones; 10 s y 100 KB como máximo; `User-Agent: CRM-Chatbot`.
- Un turno hace como máximo 5 llamadas; después el flujo se detiene.
- **Los tokens y contraseñas quedan en el flujo**, visibles para quien tiene `chatbots.manage`. No se escriben en la auditoría (solo se registran los nombres de los campos cambiados).

**Variables** ([`variables.ts`](../src/modules/chatbots/domain/variables.ts)):
- **del contacto**, siempre disponibles: `{{nombre}}`, `{{apellido}}`, `{{nombre_completo}}`, `{{email}}`, `{{telefono}}`, y cada campo personalizado como `{{campo_<key>}}`;
- **del bot**, creadas en «Variables» con nombre, tipo (`text`, `number` o `boolean`), valor por defecto y descripción. Cada conversación empieza con los valores por defecto y `question` las llena. Un booleano guarda `'true'`/`'false'` y entiende «sí», «no», «1», «0»…;
- en el mensaje de `transfer`, `{{agente}}`: el nombre de quien recibió el chat, o «un agente» si quedó sin asignar.

El editor inserta cualquiera con «Agregar variable». Una variable desconocida se lee como texto vacío.

**Mensaje al transferir:** el predeterminado es «Te comunicamos con {{agente}}. En breve te atenderá.». Vacío: no se envía nada.

**«Respuesta del usuario»** (`trigger` en cada nodo, salvo el inicio): palabras separadas por comas que abren la tarjeta. Al comparar no importan mayúsculas, tildes ni un punto o paréntesis final («1.» = «1»).
- **Menú de texto:** un `message` o `url` con `wait: true` espera la respuesta y sigue por la tarjeta conectada cuyo `trigger` coincide. Puede conectar varias tarjetas desde `next`. Cada una necesita su `trigger`, sin repetirse; si no conecta ninguna, es un error.
- **Desde cualquier punto:** una tarjeta a la que no llega ninguna conexión y tiene `trigger` se abre cuando el cliente lo escribe, incluso como primer mensaje (en lugar del saludo), después del final del flujo o mientras otro nodo espera y la respuesta no le sirve a ese nodo. Estas tarjetas no cuentan como inalcanzables. Dos de ellas no pueden compartir palabras.
- **«Aceptar cualquier mensaje»** (`trigger: '*'`): en una tarjeta conectada a un mensaje que espera, toma cualquier respuesta que no coincida con las palabras de las otras tarjetas (se prueban primero las palabras concretas). En una tarjeta a la que no llega ninguna conexión es un error, porque atraparía todos los mensajes.
- **Sin efecto en tarjetas a las que llegan botones, listas o nodos que siguen solos:** ahí lo que activa la tarjeta es el botón o la conexión. El editor deshabilita el campo y el `trigger` se descarta al guardar.

**Respuestas que no coinciden** (sin bucles de errores ni silencio):
- **En botones o lista**, una respuesta fuera de las opciones recibe «Respuesta si elige otra cosa» del nodo como mensaje con botones: «Ver menú» (`<nodo>:@menu`, vuelve a mostrar las opciones) y «Volver al inicio» (`start:@start`). El segundo no aparece en el primer menú del flujo, donde mostraría lo mismo. No se repite el menú completo y el bot nunca deja de responder.
- **En un mensaje que espera**, una respuesta sin tarjeta recibe `fallbackText` con los mismos botones; «Ver menú» reenvía el mensaje.
- **En una pregunta**, una respuesta no válida sigue la salida `other` si está conectada; si no, envía su texto con «Volver al inicio» y espera otra respuesta. Si la pregunta es lo primero del flujo, envía el texto y la pregunta otra vez.
- **Ya no existe la salida «Otra respuesta» de botones y listas.** Las conexiones antiguas desde `other` se descartan al leer el flujo, en el backend y en el editor.
- **Las opciones de mensajes anteriores siguen funcionando:** el `id` de cada opción (`<nodo>:<opción>`) es único en el flujo, así que pulsar un menú viejo (o uno después de que el flujo terminó) sigue esa opción.
- **Escribir a mano el título o el número de la opción** también vale.
- **Contra bucles:** un turno recorre como máximo 25 nodos.

## Ejecución

1. **Llega el mensaje.** El webhook guarda el mensaje entrante (con `reply: { id, title }` si el cliente pulsó un botón o una fila) y emite `message.created`.
2. **Se encola.** [`ChatbotRunner`](../src/modules/chatbots/application/chatbot-runner.service.ts) lo toma después de responder a Meta, en una cola en memoria por conversación que conserva el orden.
3. **Se comprueba si el bot atiende:**
   - el chat no está cerrado ni tiene el bot pausado;
   - la línea tiene bot, activo y dentro de horario.
4. **Avanza el flujo.** `advance()` devuelve las acciones:
   - `send` (texto, archivo, interactivo, ubicación o tarjetas de contacto);
   - `tags`;
   - `funnel`;
   - `transfer` (con `note`, que se guarda como nota interna firmada por el bot);
   - `status`;
   - `pause` («Desactivar bot»: pausa permanente, evento `bot_paused`);
   - `contact` (nombre, email o campo personalizado, de `question` o `contact_field`).
   El motor es puro: al llegar a una «Consulta API» se detiene y devuelve `request`. [`runTurn`](../src/modules/chatbots/application/bot-turn.ts) hace la llamada con `BotHttpClient` y vuelve a avanzar con la respuesta, en el mismo turno y la misma cola.
   Antes de avanzar, una palabra de `restartKeywords` vuelve al inicio. Si el flujo ya terminó pero la conversación sigue activa (`session.nodeId: null`), el mensaje recibe `fallbackText` con el botón «Volver al inicio».
5. **Se ejecutan las acciones** con `InboxService`:
   - los mensajes salen firmados `sentBy: { userId: 'bot:<id>', name, kind: 'bot' }`;
   - un mensaje rechazado (ventana de 24 h, cupo del plan…) detiene el resto del turno.
6. **Inactividad.** Si el bot quedó esperando y hay `inactivityMinutes`, la sesión guarda `nudgeAt`. Cada 30 s el runner reclama los vencidos de cada espacio (`claimBotNudges`, atómico) y envía `inactivityText` una sola vez, con el botón «Continuar» (`<nodo>:@menu`), que vuelve a mostrar lo que el bot esperaba.

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
| `POST simulate` | `{ graph, session, text, replyId, contactName, fallbackText, restartKeywords, variables }` → `{ actions, session }`. Prueba el flujo sin enviar nada ni tocar el contacto; la «Consulta API» sí se llama |
| `POST test-request` | «Probar conexión»: `{ api, sample }` (datos de un nodo `api` y valores de prueba para sus variables) → `{ ok, status, error, body (≤ 2 KB), values }`. Mismas protecciones; hasta 10 por minuto por usuario (`429 TOO_MANY_REQUESTS`) |

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
- `MEDIA_NOT_FOUND`;
- `TOO_MANY_REQUESTS`.

**Auditoría:** `chatbots.chatbot.created`, `.updated`, `.deleted`, `.lines_changed`.

## Probar

- **Editor:** «Probar chatbot» abre un chat de prueba contra `simulate`, con la configuración y las variables guardadas. Los botones y las filas se pueden pulsar, y las acciones se muestran como avisos («Transferiría el chat a Ana y el bot quedaría desactivado en ese chat por 24 horas»).
- **Pruebas automáticas:**
  - `npx jest src/modules/chatbots`: motor y formato, y en `flow-scenarios.spec.ts` conversaciones completas con bots de distinta forma (tienda con lista, horario y cierre; registro con preguntas, validaciones y condición por edad; menús anidados con transferencia y «En espera»);
  - `flow-widgets.spec.ts`: opciones como botones o lista, «Aceptar cualquier mensaje», condiciones `all`/`any`/`each`, guardar sin pregunta, campo de contacto, Consulta API (y el tope de 5 llamadas), ubicación, contacto, nota y «Desactivar bot»; `ip-guard.spec.ts`: direcciones bloqueadas y armado de la petición;
  - `npm run test:e2e -- chatbots`: con el gateway simulado, el bot responde, transfiere, avisa al cliente, se pausa 24 h o permanentemente y vuelve solo al vencer la pausa, cierra sin marcar como leído, responde con `fallbackText` y «Volver al inicio», vuelve al menú con una palabra y envía el mensaje de inactividad con «Continuar». También: una lista guardada antes sigue respondiendo, la Consulta API (con un cliente falso) sigue por éxito o error, se actualiza un campo personalizado, se envían ubicación y contacto, la nota queda como nota, «Desactivar bot» pausa, y «Probar conexión» rechaza `https://127.0.0.1` y es solo para `chatbots.manage`.

## Límites

- **El bot corre en el proceso de la API.** No hay cola persistente: con varias instancias hay que moverlo a una cola compartida, y un reinicio a mitad de un turno lo pierde.
- **El mensaje de inactividad lo revisa un temporizador del proceso** cada 30 s (reclamo atómico en Mongo, así no se duplica entre instancias). No hay otras esperas con temporizador («si no responde en 1 hora…»); la pausa de 24 h no necesita temporizador: se compara la hora al recibir un mensaje.
- **Faltan nodos:** plantillas pagadas, WhatsApp Flows y asistente IA (fuera de alcance a propósito).
- **Consulta API:** solo JSON o texto, sin subir archivos ni seguir redirecciones; los tokens se guardan en el flujo sin cifrar aparte. «Probar conexión» limita por usuario en memoria (con varias instancias, el límite es por instancia).
