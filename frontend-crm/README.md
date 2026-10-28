# frontend-crm

Frontend del CRM SaaS: React 19 + TypeScript + Vite + MUI. Consume la API de [`backend-crm`](../backend-crm).

Incluye autenticación completa (login, registro, verificación de email, recuperación y cambio de contraseña, sesiones, perfil y selector de espacio de trabajo), planes y facturación, y el módulo **Equipo**: agentes y roles. El diseño de las pantallas de acceso sigue el estilo de wasapi.io (fondo animado, tarjeta con barra en degradado y etiquetas con asterisco). Los colores y logos por defecto son los de Vite y se configuran en un único archivo.

## Requisitos

- Node.js ≥ 22.12 (recomendado 24, ver `.nvmrc`).
- El backend corriendo en `http://localhost:3000` con su base de datos y Mailpit (ver el README del backend).

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre http://localhost:5173.

En desarrollo, Vite hace de **proxy**: `/api` se reenvía a `http://localhost:3000` (ver `vite.config.ts`). Frontend y API comparten origen, así que las cookies de sesión funcionan sin CORS.

### Usuarios de prueba

Si en el backend ejecutaste `npm run db:seed` con `SEED_DEMO_DATA=true`, existen estos usuarios. Todos usan la contraseña de `SEED_DEMO_PASSWORD` del `.env` del backend.

| Email | Rol |
| ----- | --- |
| `superadmin@example.com` | OWNER de Acme Corp, Globex Industries e Initech |
| `admin@example.com` | Administrador en Acme Corp |
| `agent@example.com` | Agente regular en Acme Corp y Globex |
| `viewer@example.com` | Rol personalizado «Solo lectura» en Acme Corp (membresía desactivada en Globex) |

Los emails de registro, verificación y recuperación llegan a **Mailpit**: http://localhost:8025. Sus enlaces abren directamente las pantallas del frontend (`/verify-email`, `/reset-password`).

## Personalizar el tema

Todo está en **[`src/theme/theme.config.ts`](src/theme/theme.config.ts)**:

| Clave | Qué controla |
| ----- | ------------ |
| `brand.name`, `brand.tagline` | Nombre en títulos, pestaña del navegador y bienvenida |
| `brand.logo`, `brand.secondaryLogo`, `brand.logoHeight` | Logos: importa tu SVG/PNG desde `src/assets` o usa una URL de `public/` |
| `palette.primary` / `palette.secondary` | Color principal y secundario, por separado para modo claro y oscuro |
| `palette.background` | Fondo y superficies por modo |
| `gradient` | Degradado de botones principales, barra de la tarjeta y avatar |
| `authBackground` | Fondo de las pantallas de login y registro |
| `typography.fontFamily`, `shape.borderRadius` | Tipografía y redondeo |
| `defaultMode` | `'light'`, `'dark'` o `'system'` |

Ejemplo, una marca verde con tu logo:

```ts
import logo from '../assets/mi-logo.svg'

brand: { name: 'Mi CRM', tagline: '…', logo, logoHeight: 40 },
palette: {
  primary: { light: '#16a34a', dark: '#22c55e' },
  …
},
gradient: { from: '#22c55e', to: '#0ea5e9', angle: 120 },
```

Algunos valores también se pueden cambiar sin tocar código, copiando `.env.example` a `.env.local` (`VITE_BRAND_NAME`, `VITE_PRIMARY_COLOR`, `VITE_BRAND_LOGO_URL`, `VITE_DEFAULT_COLOR_MODE`…).

Los componentes nunca usan colores fijos: solo `theme.palette.*` y `theme.custom.gradient`, así que cambiar el archivo cambia toda la app. El usuario puede alternar entre tema claro, oscuro o del sistema con el icono del pie de la tarjeta o de la barra superior; la elección se guarda en el navegador.

## Cómo funciona la sesión

| Aspecto | Implementación |
| ------- | -------------- |
| Access token | Solo en **memoria** (`src/lib/api/token-store.ts`), nunca en `localStorage`. Se envía como `Authorization: Bearer` |
| Refresh token | Cookie `crm_rt` HttpOnly que gestiona el navegador; JavaScript no la puede leer |
| CSRF | `/auth/refresh` y `/auth/logout` envían `X-CSRF-Token` con el valor de la cookie `crm_csrf` |
| Recarga de página | `AuthProvider` intenta `POST /auth/refresh` si existe la cookie `crm_csrf`; si funciona, la sesión continúa |
| Token caducado | Ante un `401`, `apiRequest` hace **un único refresh compartido** por todas las peticiones en curso y las reintenta una vez. Si el refresh falla, se cierra la sesión y se vuelve a `/login?redirect=…` |
| Refresh proactivo | Al 80 % de la vida del access token |
| Varias pestañas | Los refresh se serializan entre pestañas con la Web Locks API (cada refresh rota la cookie compartida). Login y logout se propagan con `BroadcastChannel` |
| Tokens en enlaces | `/verify-email?token=` y `/reset-password?token=` leen el token y lo quitan de la URL al instante. `<meta name="referrer" content="no-referrer">` |
| Redirecciones | `?redirect=` solo acepta rutas internas (sin redirecciones abiertas) |

Los mensajes de la API se muestran en español. Los `401` de login siempre muestran el mismo texto genérico y los `429` avisan del límite de intentos.

## Rutas

| Ruta | Acceso | Pantalla |
| ---- | ------ | -------- |
| `/login` | visitantes | Iniciar sesión |
| `/sign-up`, `/sign-up/done` | visitantes | Registro y "revisa tu correo" |
| `/forgot-password` | visitantes | Solicitar enlace de recuperación |
| `/reset-password?token=` | todos | Nueva contraseña |
| `/verify-email?token=` | todos | Verificar email |
| `/` | autenticado | Inicio: workspace activo, roles y permisos |
| `/account/profile` | autenticado | Perfil (nombre, idioma, zona horaria) |
| `/account/security` | autenticado | Cambiar contraseña y gestionar sesiones |
| `/inbox` | `messages.read` | Bandeja de mensajes (`?conversation=` abre un chat, `?contactId=` filtra por contacto) |
| `/inbox/auto-assignment`, `/quick-replies` | — | Llevan a la bandeja (ahora son el modal de configuración y el panel del chat) |
| `/funnels`, `/funnels/:funnelId` | `funnels.read` | Embudos: tablero Kanban (`/funnels` abre el último embudo usado o el primero) |
| `/team/agents` | `members.read` | Equipo → Agentes (`/team/members` redirige aquí) |
| `/team/roles` | `roles.read` | Equipo → Roles |
| `/forbidden` | autenticado | «No autorizado»: adonde se redirige al abrir una página sin permiso |
| `/account/password-required` | autenticado | Cambio obligatorio de la contraseña temporal |
| `/billing` | `billing.read` | Plan y facturación del workspace activo |
| `/pricing` | todos | Planes y precios públicos (mensual/anual) |

La zona autenticada se carga bajo demanda (code splitting), así la pantalla de login es más ligera.

## Planes y prueba gratuita

La API guarda los planes, precios y límites (ver `docs/billing.md` del backend); el frontend los lee de `GET /billing/plans`, así que no hay precios fijos en el código.

| Pantalla | Qué hace |
| -------- | -------- |
| **`/pricing`** | Tarjetas de los 3 planes con selector **Mensual/Anual** (en anual muestra el equivalente mensual y el ahorro), funcionalidades incluidas y una tabla comparativa. "Comenzar prueba de N días" lleva a `/sign-up?plan=…&interval=…` y, con sesión iniciada, a `/billing?plan=…` |
| **Registro** | Muestra el plan elegido, o el básico por defecto, y "Iniciar prueba de N días" (N = `BILLING_TRIAL_DAYS` del backend) |
| **Aviso en la app** | Arriba de cada página: días de prueba restantes, o prueba terminada / plan inactivo, con enlace a "Ver planes" |
| **`/billing`** | Plan actual, estado, precio, fin de prueba o renovación, uso frente a límites (agentes usados de N), funcionalidades incluidas y cambio de plan (con confirmación). Según el estado: **Pagar y activar**, **Cancelar** o **Reanudar** |

Permisos: ver el plan requiere `billing.read` (OWNER, ADMIN) y cambiarlo `billing.manage` (OWNER). El resto de miembros ven el aviso, pero no la página. Los errores de la API llegan con un `code` estable que se traduce en `es.apiErrors` (p. ej. "El plan Equipo permite 3 agentes y este espacio de trabajo tiene 4 miembros activos…").

Con `BILLING_PAYMENTS_MODE=simulated` en el backend, los pagos se aprueban al instante (se avisa en la pantalla). Con `disabled`, solo se puede cambiar de plan durante la prueba.

## Menú y permisos

El menú lateral se define en un solo sitio, [`src/layouts/navigation.ts`](src/layouts/navigation.ts):

- Cada enlace declara los permisos que necesita (`anyOf` / `allOf`) y los grupos (p. ej. **Equipo → Agentes, Roles**) se pliegan.
- Un grupo sin enlaces permitidos no aparece.
- Los permisos son los del workspace activo, leídos de `/users/me`; al cambiar de workspace o volver a la pestaña, el menú se recalcula.

| Pieza | Uso |
| ----- | --- |
| `usePermissions()` ([`src/auth/usePermissions.ts`](src/auth/usePermissions.ts)) | `has('contacts.read')`, `allows({ anyOf, allOf })` |
| `<Can anyOf={[…]} allOf={[…]} fallback?>` | Renderiza sus hijos solo si se cumple el permiso; si no, nada (o `fallback`) |
| `<RequirePermission anyOf={[…]} />` | Elemento de ruta en [`router.tsx`](src/router.tsx): sin permiso redirige a `/forbidden` |

Es solo interfaz: la API vuelve a comprobar cada petición.

## Equipo (agentes y roles)

Grupo **Equipo** del menú con dos páginas: Agentes (`members.read`) y Roles (`roles.read`). Reglas y API en `docs/team.md` del backend.

| Pantalla | Qué hace |
| -------- | -------- |
| **Agentes** | Tabla con nombre, correo, rol, **líneas** («Todas» si su rol ve todo, «Sin líneas» en naranja si no recibirá chats), estado (Activo / Desactivado / Pendiente de primer acceso) y último acceso. Búsqueda y filtro por estado, indicador «N de M agentes» del plan. **Nuevo agente** pide nombre, correo, rol y, con `channels.manage`, sus líneas; el backend envía una contraseña temporal por correo. Menú por fila: asignar líneas (`channels.manage`), cambiar rol, reenviar acceso, desactivar (con confirmación) y reactivar |
| **Roles** | Tarjetas con los roles del sistema (Propietario, Administrador, Agente regular), de solo lectura con «Ver permisos», y los personalizados del workspace con Editar y Eliminar. **Nuevo rol** muestra los permisos agrupados por módulo, con «Todos» por grupo. Si el plan no incluye roles personalizados aparece un aviso con enlace a planes |
| **Contraseña obligatoria** | Si `/users/me` trae `mustChangePassword`, cualquier ruta de la app redirige a `/account/password-required` hasta que el agente cambie la contraseña temporal |

La interfaz solo ofrece lo que la API va a aceptar, con la misma regla anti-escalada:

- solo se pueden asignar roles cuyos permisos tengas;
- en tu propia fila solo puedes asignarte líneas;
- un Administrador no ve acciones sobre un Propietario;
- el botón de alta se desactiva al llegar al límite del plan.

Aun así, la API valida todo de nuevo. Los nombres de los roles del sistema y de los permisos están traducidos en `es.roles`; los roles personalizados muestran el nombre que les dio el workspace.

## Scripts

| Comando | Qué hace |
| ------- | -------- |
| `npm run dev` | Servidor de desarrollo con HMR en :5173 |
| `npm run build` | Comprobación de tipos y build de producción en `dist/` |
| `npm run preview` | Sirve el build localmente |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest: cliente API (refresh, CSRF), validaciones, flujo de login, página de precios y registro con plan, equipo (agentes, roles, límite del plan, contraseña obligatoria) con MSW, formato de precios y errores |

## Estructura

```
src/
  theme/          theme.config.ts (personalización), createAppTheme, selector de modo
  i18n/es.ts      Todos los textos de la interfaz
  lib/api/        Cliente HTTP, token en memoria, endpoints tipados, errores
  lib/            Validaciones (zod), redirecciones seguras, utilidades
  auth/           AuthProvider, useAuth, useMe, rutas protegidas
  workspace/      Workspace activo y selector
  layouts/        AuthLayout (pantallas de acceso) y AppLayout (barra + menú lateral)
  pages/auth/     Login, registro, recuperación, verificación
  pages/app/      Inicio, plan y facturación, perfil, seguridad
  pages/app/team/ Equipo: TeamPage (pestañas), MembersPage, RolesPage
  pages/          PricingPage (pública), NotFound
  components/     Logo, campos de formulario, botón en degradado, banners, ConfirmDialog
  components/billing/  PlanCard, IntervalToggle, FeatureComparison, PlanBanner, useCatalog
  components/team/     Diálogos de agente y de rol, useTeamAccess (permisos y plan)
  lib/team.ts     Nombres de roles y permisos, regla anti-escalada en cliente
  test/           Setup de Vitest y pruebas de integración
```

## Producción

- Sirve el frontend y la API bajo el **mismo sitio**, por ejemplo con un proxy inverso que envíe `/api` al backend. Así funcionan las cookies `SameSite=Strict` y no hace falta CORS.
- Si la API está en otro dominio, define `VITE_API_BASE_URL` y configura en el backend `CORS_ORIGINS`, `COOKIE_SAMESITE=none` y `COOKIE_SECURE=true` (exige HTTPS).
- En el backend, `WEB_APP_URL` debe apuntar a la URL pública del frontend para que los enlaces de los emails abran estas pantallas.

## Pendiente

- Login con Google: la API todavía no tiene OAuth.
- Selector de idioma: los textos ya están centralizados en `src/i18n/es.ts`.
- Invitaciones por enlace y transferencia de propiedad (pendientes en el backend).
- Teléfonos asignados a cada agente: llegarán con la mensajería.
- Pago real: la pantalla de facturación está lista para un checkout cuando el backend tenga una pasarela.
## Contactos

**Contactos → Administrar** ([`ContactsPage.tsx`](src/pages/app/contacts/ContactsPage.tsx)), como en wasapi:

- **Barra:** buscador (nombre, correo o teléfono), «Seleccionar etiqueta», «Seleccionar estado» (Activo o Bloqueado), **Más opciones** (con `contacts.manage`) y **Nuevo contacto**.
- **Tabla:** casilla de selección, Contacto, Teléfono, Etiquetas, Creado el, Actualizado el, Estado y Acciones: Editar, **Iniciar conversación** (abre sus chats en la bandeja; desactivado si nunca escribió), Bloquear o Desbloquear y Eliminar.
- **Selección:** barra con Agregar etiquetas, Quitar etiquetas y Eliminar para los contactos marcados.
- **Más opciones:**
  - **Importar contactos** ([`ImportContactsDialog.tsx`](src/components/contacts/ImportContactsDialog.tsx)): Subir archivo (.xlsx o .csv hasta 20 MB, leído en el navegador con [`spreadsheet.ts`](src/lib/spreadsheet.ts) y `read-excel-file`) → **Asignar columna** (campos existentes, también «Apellido» que se une al nombre; campos personalizados o crear uno con el nombre de la columna; Saltar columna; se adivinan por el encabezado) → Reescribir o Combinar etiquetas → Resumen → **Importar contactos** en lotes de 200 con barra de progreso. Al final muestra creados, actualizados y con error, y descarga un CSV con las filas que fallaron y el motivo.
  - **Exportar todos los contactos** y **Exportar contactos con filtros asignados** (activo solo con algún filtro): descargan el CSV.
  - **Administrar campos personalizados** ([`ContactFieldsDialog.tsx`](src/components/contacts/ContactFieldsDialog.tsx)): texto, número, fecha o lista de opciones.
  - **Eliminar todos los contactos**: pide escribir ELIMINAR.
- **Editar contacto** ([`ContactDialog.tsx`](src/components/contacts/ContactDialog.tsx)), con dos pestañas:
  - **Detalles de contacto:** teléfono, nombre, correo, etiquetas, notas y los campos personalizados.
  - **Asignación de asesores:** «Asigne un asesor al contacto por línea de teléfono para ser atendido.» Por cada línea, su nombre y número, el selector **Agente regular** y, si alguien atiende su chat ahora, «⇄ Atendiendo ahora: Nombre (temporal)». Se habilita después de crear el contacto.
  - Cancelar y **Guardar** (verde) guardan las dos pestañas juntas.

## Bandeja de mensajes

**Menú:** **Bandeja** es una entrada de primer nivel. La autoasignación está en **Configuración del módulo de chat** y las respuestas rápidas se abren desde el chat. La bandeja imita WhatsApp Web y wasapi:

- **Barra de la lista** (como wasapi): tu avatar (al pulsarlo, **Mi perfil** con tu rol y **tus líneas**: nombre, número y estado), Ayuda, **Configuración del módulo de chat** (modal: auto-asignación, agentes de cada línea, transferencia de chats, firma de mensajes, mensaje al cerrar y avisos; todo menos los avisos pide `channels.manage`), Pantalla completa, botón de agentes (encendido: tus chats, los de tus agentes y los sin asignar; apagado: solo los tuyos; se recuerda por navegador), Sincronizar y ⋮ con accesos a Embudos y Líneas.
- **Filtros:** el embudo junto al buscador abre «Filtros de conversaciones» (etiquetas, agentes, línea, rango de fechas y orden). Se aplican con «Aplicar filtros» y se quitan con «Limpiar filtros».
- **Pestañas** Abierto (contador rojo) / En espera / Cerrado. Los chats sin asignar están dentro de Abierto, no en una pestaña aparte.
- **Líneas por agente:** un agente sin «ver todo» solo recibe los chats de sus líneas; sin líneas, la lista muestra un aviso para que pida una. Transferir solo ofrece a quien atiende la línea del chat.
- **Fila del chat:** distintivo de la línea en el avatar, hora «2:21 pm», ✓ / ✓✓ / leído del último mensaje, no leídos, etiquetas del contacto y quién atiende («Tú» o «C. Arze»). Si la línea tiene color (Canales → Líneas), la fila lleva un borde y un sombreado de ese color y el avatar un anillo, como en wasapi.
- **Chat:**
  - burbujas con fondo de chat, separadores por día y avisos centrados de cada movimiento (asignado, transferido, cerrado…);
  - visores de imagen, sticker, audio, video, documento y ubicación.
- **Cabecera:**
  - **Acciones rápidas:** ✓ «Cerrar chat» (o «Reabrir chat») y «Tomar chat» si nadie lo atiende.
  - **Menú ⋮:**
    - etiquetar chat (con buscador; son las etiquetas del contacto y se ven bajo el nombre);
    - transferir;
    - poner en espera;
    - marcar como no leído;
    - ver u ocultar detalles;
    - desactivar el bot en este chat por 24 horas o permanentemente, o activarlo;
    - bloquear contacto.
  - **Panel del contacto:** empieza oculto y se cierra con su ✕.
- **Chatbot en el chat:**
  - el chip «🤖 Bot activo» o «🤖 Bot off · 5 h 12 min» / «permanente» en la cabecera;
  - en la lista, un robot naranja sobre el avatar cuando el bot está apagado, con cuánto falta en el tooltip ([`bot-pause.ts`](src/components/inbox/bot-pause.ts));
  - la pestaña **Cerrado** cuenta solo los chats cerrados con mensajes sin leer (lo que envía el bot no marca como leído);
  - las burbujas del bot firmadas «🤖 nombre del bot»;
  - los menús con sus botones, lista (desplegable) o botón con enlace;
  - la opción que eligió el cliente marcada «Eligió una opción»;
  - lo que hizo el bot (etiquetas, delegar a un agente, cambiar estado) como aviso en el historial.
- **Envío inmediato:** como en WhatsApp, el mensaje (texto, archivo, nota de voz, contacto o nota) aparece al instante con 🕒 y pasa a ✓, ✓✓ y ✓✓ azul; el editor nunca se bloquea y los envíos de un chat salen en orden. La cola vive en [`outbox.ts`](src/components/inbox/outbox.ts) y [`useSendQueue.ts`](src/components/inbox/useSendQueue.ts): cada envío lleva un `clientId` y el mensaje del servidor con ese id reemplaza la burbuja local. Si la petición falla queda «No enviado» con **Reintentar** y **Descartar**.
- **No entregado:** explica el error de Meta en palabras simples y ofrece **Reintentar**.
- **Editor:** emojis, adjuntos con vista previa, notas de voz, **Firmar mensajes** (si la configuración deja elegir) y **respuestas rápidas**: el botón ⚡ o «/» al empezar el mensaje abren un panel sobre el chat para buscar (por título o contenido), **Enviar** (texto y archivos) o usar el texto; con `quick_replies.manage` también se crean, editan y eliminan ahí.
- **Tarjetas:** en cada pestaña no se repite su estado («En espera» no aparece en las tarjetas de En espera).
- **Cerrar chat:** con el mensaje al cerrar en «Preguntar para enviar», pregunta «¿Enviar el mensaje de cierre?».
- **Panel del contacto:** **Editar contacto** (abre el mismo modal de Contactos), «Agente regular» de la línea del chat (con `contacts.write`; lo usa la asignación «según el agente registrado») y los campos personalizados con valor.
- **Avisos:**
  - sonido y notificación de escritorio al llegar un mensaje, configurables en Configuración del módulo de chat;
  - «(N)» en el título de la pestaña.

| Pieza | Dónde |
| ----- | ----- |
| Página y lista | [`src/pages/app/inbox/InboxPage.tsx`](src/pages/app/inbox/InboxPage.tsx), [`InboxToolbar.tsx`](src/components/inbox/InboxToolbar.tsx), [`ConversationFilters.tsx`](src/components/inbox/ConversationFilters.tsx), [`ConversationList.tsx`](src/components/inbox/ConversationList.tsx) |
| Chat | [`ConversationPanel.tsx`](src/components/inbox/ConversationPanel.tsx), [`ChatHeader.tsx`](src/components/inbox/ChatHeader.tsx), [`MessageBubble.tsx`](src/components/inbox/MessageBubble.tsx), [`MediaViewer.tsx`](src/components/inbox/MediaViewer.tsx), [`Composer.tsx`](src/components/inbox/Composer.tsx) |
| Tiempo real y avisos | [`InboxRealtime.tsx`](src/components/inbox/InboxRealtime.tsx) (SSE con `fetch`), [`notifications.ts`](src/components/inbox/notifications.ts) |
| Colores claro/oscuro del chat | [`chat-colors.ts`](src/components/inbox/chat-colors.ts) |

**Scrollbar:** fino y transparente hasta pasar el mouse sobre la zona que se desplaza (tema, `MuiCssBaseline`), en claro y oscuro.

**Archivos:** se descargan con el token de sesión y se muestran desde URLs `blob:` (un `<img src>` no puede enviar el token).

**Autorización:** los controles verifican los permisos del workspace activo y el servidor valida cada operación. Cambiar de workspace o cerrar sesión desconecta el stream anterior.

Para probar sin WhatsApp real, activa el modo simulado y carga el seed del backend. La guía completa está en [Bandeja de mensajes](../backend-crm/docs/inbox.md).

**Colores:** las etiquetas y las líneas aceptan cualquier color con [`ColorPicker.tsx`](src/components/ColorPicker.tsx): paleta amplia, selector libre, código hex y cuentagotas si el navegador lo trae.

## Chatbots

**Automatización → Chatbots** (permiso `chatbots.manage`):

- **Tarjetas de los bots:**
  - interruptor Activo y líneas asignadas;
  - Editar y Probar;
  - ⋮ con Asignar líneas, Duplicar, Renombrar y Eliminar.
  - **Una línea tiene un solo bot:** asignarla a otro pide confirmación.
- **Editor de flujos** ([`ChatbotEditorPage.tsx`](src/pages/app/automation/ChatbotEditorPage.tsx), con [React Flow](https://reactflow.dev)):
  - **Lienzo:**
    - tarjetas con título, caja «Respuesta del bot», archivos adjuntos y un punto de salida por botón u opción (los botones y opciones como píldoras verdes) ([`FlowNodeCard.tsx`](src/components/chatbots/FlowNodeCard.tsx));
    - cada conexión tiene una ✕ para quitarla sin borrar las tarjetas ([`DeletableEdge.tsx`](src/components/chatbots/DeletableEdge.tsx));
    - Supr borra lo seleccionado; Ctrl+S guarda;
    - avisa al salir sin guardar.
  - **Panel derecho:**
    - «Opciones de respuesta» para agregar nodos;
    - el formulario de cada nodo, con los límites de WhatsApp ([`NodeEditor.tsx`](src/components/chatbots/NodeEditor.tsx)):
      - «Título» (solo lo ve quien arma el flujo) y la guía «Cómo funciona» del nodo;
      - «Agregar variable» en los textos ([`VariableButton.tsx`](src/components/chatbots/VariableButton.tsx));
      - «Adjuntar archivos», hasta 5 ([`AttachmentsField.tsx`](src/components/chatbots/AttachmentsField.tsx));
      - «Respuesta si elige otra cosa» obligatoria en botones y listas: el bot la envía con los botones «Ver menú» y «Volver al inicio» (ya no hay salida «Otra respuesta»; las conexiones antiguas se descartan al abrir el flujo);
      - «Respuesta del usuario» en cada tarjeta (palabras que la abren; deshabilitada si le llegan botones, listas o tarjetas que siguen solas) y «Enviar mensaje y saltar al siguiente nodo» en Respuesta básica y Botón de URL: desmarcado, el mensaje espera y conecta varias tarjetas, una por respuesta (menús de texto «1, 2, 3»);
      - en listas, el título de la sección avisa que WhatsApp solo lo muestra con dos o más secciones;
      - Guardar respuesta elige una variable del bot y puede guardar nombre o email en el contacto;
      - Transferir: mensaje al cliente con `{{agente}}` y bot apagado 24 horas o permanentemente;
    - «Probar chatbot» ([`TestChat.tsx`](src/components/chatbots/TestChat.tsx)): un chat simulado que no envía nada por WhatsApp.
  - **Variables** ([`VariablesDialog.tsx`](src/components/chatbots/VariablesDialog.tsx)): las del contacto (nombre, apellido, email, teléfono) y las del bot, de tipo texto, numérico o booleano, con valor por defecto y descripción.
  - **Configuración** ([`BotSettingsDialog.tsx`](src/components/chatbots/BotSettingsDialog.tsx)): nombre, descripción, líneas, mensaje cuando no se encuentra respuesta, palabras para volver al saludo, duración de conversación activa (30 min, mínimo 2), mensaje de inactividad (hasta 29 min) y días y horas con zona horaria (America/La_Paz por defecto). Sin días elegidos, el bot queda apagado.

Reglas, nodos y API: [Chatbots](../backend-crm/docs/chatbots.md).

El nodo «Establecer contacto en embudo» elige un embudo (primero los de las líneas del bot) y una etapa. Avisa si el embudo es de otra línea, porque entonces el bot no mueve al contacto.

## Embudos

**Embudos** en el menú (permiso `funnels.read`; plan Empresa o Corporativo) es un tablero Kanban de leads por embudo ([`FunnelBoardPage.tsx`](src/pages/app/funnels/FunnelBoardPage.tsx)). Un lead es un contacto dentro de un embudo.

- **Barra superior:**
  - selector de embudo agrupado por línea;
  - «Nuevo embudo»;
  - búsqueda (espera 300 ms);
  - «Filtros» ([`FunnelFilters.tsx`](src/components/funnels/FunnelFilters.tsx)): agentes, sin asignar, etiquetas, estado del chat, archivados, valor mínimo y máximo, y orden. Hay AND entre grupos y OR dentro de cada uno; «Limpiar» conserva la búsqueda;
  - «Agregar lead»;
  - «Personalizar tablero» (mostrar valor y agente, guardado por usuario);
  - menú ⋮ con Editar embudo, Sincronizar contactos, Privilegios, Automatización por estado del chat y Exportar a CSV.
- **Columnas** ([`StageColumn.tsx`](src/components/funnels/StageColumn.tsx)):
  - muestran conteo y total en $ (el valor es solo informativo);
  - menú con Renombrar, Eliminar (si tiene leads, pide la etapa destino), Seleccionar leads y Seleccionar toda la etapa;
  - «Cargar más»;
  - con `funnels.manage` se reordenan con su asa, y «+ Etapa» agrega una.
- **Tarjetas** ([`LeadCard.tsx`](src/components/funnels/LeadCard.tsx)):
  - contenido: nombre, último mensaje, estado del chat, etiquetas, valor y agente;
  - si el chat es de otro agente, dice «Chat de otro agente» y no muestra el mensaje;
  - se arrastran con mouse, toque o teclado ([dnd-kit](https://dndkit.com): Espacio, flechas, Espacio) y también se mueven con el menú «Mover a…»;
  - el movimiento es optimista: si la API falla, la tarjeta vuelve a su lugar y se muestra el error.
- **Selección múltiple:** una barra inferior con Mover a, Archivar o Restaurar y Quitar del embudo, cada una con confirmación.
- **Chat del lead** ([`LeadChatDialog.tsx`](src/components/funnels/LeadChatDialog.tsx)): un modal con la etapa del contacto en cada embudo, el valor, Archivar y Quitar, y debajo la conversación de la línea (`ConversationPanel`). No se abre el chat de otro agente.
- **Bandeja:** el panel del contacto tiene la sección «Embudos» para cambiar su etapa ([`ContactFunnels.tsx`](src/components/funnels/ContactFunnels.tsx)).
- **Tiempo real:** `InboxRealtime` recarga los tableros con `funnel.changed` y con los cambios de los chats.

Reglas, API y CSV: [Embudos](../backend-crm/docs/funnels.md).
