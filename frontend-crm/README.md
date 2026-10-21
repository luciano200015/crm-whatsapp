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
| `/inbox/auto-assignment` | `channels.manage` | Autoasignación |
| `/quick-replies` | `quick_replies.manage` | Respuestas rápidas |
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
| **Agentes** | Tabla con nombre, correo, rol, estado (Activo / Desactivado / Pendiente de primer acceso) y último acceso. Búsqueda y filtro por estado, indicador «N de M agentes» del plan. **Nuevo agente** pide nombre, correo y rol, y el backend envía una contraseña temporal por correo. Menú por fila: cambiar rol, reenviar acceso, desactivar (con confirmación) y reactivar |
| **Roles** | Tarjetas con los roles del sistema (Propietario, Administrador, Agente regular), de solo lectura con «Ver permisos», y los personalizados del workspace con Editar y Eliminar. **Nuevo rol** muestra los permisos agrupados por módulo, con «Todos» por grupo. Si el plan no incluye roles personalizados aparece un aviso con enlace a planes |
| **Contraseña obligatoria** | Si `/users/me` trae `mustChangePassword`, cualquier ruta de la app redirige a `/account/password-required` hasta que el agente cambie la contraseña temporal |

La interfaz solo ofrece lo que la API va a aceptar, con la misma regla anti-escalada:

- solo se pueden asignar roles cuyos permisos tengas;
- nunca hay acciones sobre tu propia fila;
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
## Bandeja de mensajes

**Menú:** **Bandeja**, **Autoasignación** y **Respuestas rápidas** son entradas de primer nivel, cada una con su permiso. La bandeja imita WhatsApp Web y wasapi:

- **Lista de chats:** filtros Abiertos / Cerrados / Todos, pestañas Mis chats / Sin asignar / Todos y contador verde de no leídos.
- **Chat:**
  - burbujas con fondo de chat, separadores por día y avisos centrados de cada movimiento (asignado, transferido, cerrado…);
  - visores de imagen, sticker, audio, video, documento y ubicación.
- **Cabecera:** transferir, cerrar, reabrir, marcar como no leído y bloquear contacto.
- **Editor:** emojis, adjuntos con vista previa, notas de voz y respuestas rápidas con «/».
- **Avisos:**
  - sonido y notificación de escritorio al llegar un mensaje, configurables con la campanita;
  - «(N)» en el título de la pestaña.

| Pieza | Dónde |
| ----- | ----- |
| Página y lista | [`src/pages/app/inbox/InboxPage.tsx`](src/pages/app/inbox/InboxPage.tsx), [`ConversationList.tsx`](src/components/inbox/ConversationList.tsx) |
| Chat | [`ConversationPanel.tsx`](src/components/inbox/ConversationPanel.tsx), [`ChatHeader.tsx`](src/components/inbox/ChatHeader.tsx), [`MessageBubble.tsx`](src/components/inbox/MessageBubble.tsx), [`MediaViewer.tsx`](src/components/inbox/MediaViewer.tsx), [`Composer.tsx`](src/components/inbox/Composer.tsx) |
| Tiempo real y avisos | [`InboxRealtime.tsx`](src/components/inbox/InboxRealtime.tsx) (SSE con `fetch`), [`notifications.ts`](src/components/inbox/notifications.ts) |
| Colores claro/oscuro del chat | [`chat-colors.ts`](src/components/inbox/chat-colors.ts) |

**Archivos:** se descargan con el token de sesión y se muestran desde URLs `blob:` (un `<img src>` no puede enviar el token).

**Autorización:** los controles verifican los permisos del workspace activo y el servidor valida cada operación. Cambiar de workspace o cerrar sesión desconecta el stream anterior.

Para probar sin WhatsApp real, activa el modo simulado y carga el seed del backend. La guía completa está en [Bandeja de mensajes](../backend-crm/docs/inbox.md).
