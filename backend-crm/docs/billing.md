# Planes, suscripciones y prueba gratuita

Código en [`src/modules/billing`](../src/modules/billing). Los pagos reales todavía no existen: el módulo está preparado para conectar un proveedor (Stripe u otro) detrás de una interfaz.

## Conceptos

| Concepto | Dónde vive | Notas |
| -------- | ---------- | ----- |
| **Funcionalidad** (`features`) | Catálogo en código: [`plan-catalog.ts`](../src/modules/billing/domain/plan-catalog.ts) → tabla `features` | `LIMIT` (cuota numérica; `null` = ilimitado), `BOOLEAN` (incluida o no) o `TEXT` (p. ej. frecuencia de backups) |
| **Plan** (`plans`) | Mismo catálogo → `plans` | `code` estable (`team`, `business`, `corporate`), nombre, eslogan, orden, público/activo, destacado |
| **Precio** (`plan_prices`) | Mismo catálogo → `plan_prices` | Por plan, periodo (`MONTH`/`YEAR`) y moneda, en **centavos** (enteros) |
| **Asignación** (`plan_features`) | Mismo catálogo → `plan_features` | Qué límite o inclusión tiene cada plan en cada funcionalidad |
| **Suscripción** (`subscriptions`) | Una fila por **workspace** | Plan, periodo, precio congelado, estado, fechas de prueba y de periodo, proveedor de pago |

La suscripción pertenece al **workspace**, no al usuario: cada empresa tiene su plan, y los límites (agentes, contactos…) se cuentan por workspace.

## Planes iniciales (seed)

Basados en la estructura de wasapi.io/precios. El anual equivale a pagar 10 meses y llevarse 2 gratis (ahorro del 17 %).

| | Equipo (`team`) | Empresa (`business`) ⭐ | Corporativo (`corporate`) |
| - | - | - | - |
| Mensual | $99 | $229 | $599 |
| Anual | $990 (≈ $83/mes) | $2,290 (≈ $191/mes) | $5,990 (≈ $499/mes) |
| Agentes | 3 | 10 | 30 |
| Líneas de WhatsApp | 2 | 5 | 15 |
| Contactos activos/mes | 5,000 | 15,000 | 60,000 |
| Créditos IA/mes | 30,000 | 70,000 | 200,000 |
| Historial de chats | 6 meses | 12 meses | 24 meses |
| Canales sociales | — | 5 | 15 |
| Embudos de venta, roles personalizados, API, webhooks | — | ✓ | ✓ |
| Registro de auditoría, soporte dedicado | — | — | ✓ |
| Backups automáticos | — | Mensual | Semanal |

Bandeja inteligente, chatbots avanzados, autoasignación, campañas, reportes y app móvil están en los tres planes.

### Cambiar planes, precios o límites

1. Edita [`plan-catalog.ts`](../src/modules/billing/domain/plan-catalog.ts): añade funcionalidades a `FEATURES` y valores en cada plan de `PLANS`. Las pruebas unitarias verifican que cada plan define todas las funcionalidades con el tipo correcto y que un plan más caro nunca tiene límites menores.
2. `npm run db:seed`. Es idempotente:
   - actualiza los precios en el sitio, pero las suscripciones existentes **conservan su precio** (`subscriptions.amount_cents`);
   - un plan eliminado del catálogo queda **retirado** (`is_active=false`, `is_public=false`); no se borra, porque puede tener suscripciones.

## Prueba gratuita y plan por defecto

Se configuran por **variables de entorno**. Son decisiones comerciales que cambian sin migraciones ni despliegues de código.

| Variable | Por defecto | Efecto |
| -------- | ----------- | ------ |
| `BILLING_TRIAL_DAYS` | `7` | Días de prueba al registrarse. `0` = sin prueba (la suscripción nace `INCOMPLETE`, pendiente de pago) |
| `BILLING_DEFAULT_PLAN` | `team` | Plan asignado si el registro no indica `planCode` (el más básico) |
| `BILLING_DEFAULT_INTERVAL` | `MONTH` | Periodo por defecto |
| `BILLING_CURRENCY` | `USD` | Moneda de los precios que se ofrecen |
| `BILLING_PAYMENTS_MODE` | `disabled` | `disabled`: no se puede pagar. `simulated`: los pagos se aprueban al instante (**solo desarrollo**; la app no arranca en producción con este valor) |

Las fechas de la prueba se **guardan en la suscripción** al registrarse (`trial_started_at`, `trial_ends_at`). Cambiar `BILLING_TRIAL_DAYS` solo afecta a los registros nuevos.

El registro (`POST /auth/register`) acepta `planCode` e `interval` opcionales, que llegan desde "Comenzar prueba" en la página de precios. Usuario, workspace, membresía OWNER y suscripción se crean en **una sola transacción**.

## Estados

| Estado | Significado | Acceso completo |
| ------ | ----------- | :-------------: |
| `TRIALING` | Prueba en curso | ✓ |
| `ACTIVE` | Pagado y dentro del periodo | ✓ |
| `INCOMPLETE` | Creado sin prueba, esperando el primer pago | |
| `EXPIRED` | La prueba terminó sin pago | |
| `PAST_DUE` | Terminó un periodo pagado sin renovación | |
| `CANCELED` | Cancelado (prueba cancelada, o fin de periodo con cancelación pedida) | |

**Estado efectivo:** todavía no hay un job programado, así que el servicio calcula el estado con el reloj (una prueba vencida es `EXPIRED`) y lo **persiste** la próxima vez que se lee. `/users/me` y las respuestas de la API muestran siempre el estado efectivo.

### Transiciones

```
registro ──► TRIALING ──(pasa trial_ends_at)──► EXPIRED ──(pago)──► ACTIVE
   │            │  ├─(cambio de plan)─► TRIALING (mismo fin de prueba)
   │            │  ├─(activar = pagar)─► ACTIVE
   │            │  └─(cancelar)────────► CANCELED (inmediato)
   └─(sin prueba)─► INCOMPLETE ──(pago)──► ACTIVE

ACTIVE ──(cancelar)──► ACTIVE + cancel_at_period_end ──(fin del periodo)──► CANCELED
   │                         └─(reanudar)──► ACTIVE
   ├─(cambio de plan = pago)──► ACTIVE con periodo nuevo
   └─(fin del periodo sin renovar)──► PAST_DUE ──(pago)──► ACTIVE
```

- **Cambiar de plan durante la prueba** no cobra nada y mantiene la fecha de fin de la prueba.
- **Fuera de la prueba**, cambiar de plan o activar requiere un **pago**: con `simulated` se aprueba al instante y empieza un periodo nuevo (mes o año de calendario; 31 de enero + 1 mes = 28/29 de febrero). Con `disabled` responde `402 PAYMENTS_UNAVAILABLE`.
- **Bajar de plan** se rechaza (`409 PLAN_LIMIT_EXCEEDED`) si el uso actual no cabe en los nuevos límites. Hoy se mide el número de agentes (membresías activas).
- **Límites en el equipo** ([team.md](team.md)):
  - registrar o reactivar un agente exige acceso completo (`402 SUBSCRIPTION_INACTIVE`) y caber en `limits.agents` (`409 AGENT_LIMIT_REACHED`);
  - los roles personalizados requieren `features.custom_roles`.
  - El módulo de equipo lee el plan a través del puerto `WorkspaceEntitlements`, que implementa `BillingService`.

## API

| Método y ruta | Permiso | Qué hace |
| ------------- | ------- | -------- |
| `GET /billing/plans` | público | Catálogo: planes, precios (con equivalente mensual del anual), funcionalidades, días de prueba, plan por defecto y si hay pagos |
| `GET /workspaces/:id/subscription` | `billing.read` | Plan, estado efectivo, días de prueba, periodo, límites con uso |
| `PUT /workspaces/:id/subscription/plan` | `billing.manage` | Cambiar plan o periodo `{ planCode, interval }` |
| `POST /workspaces/:id/subscription/activate` | `billing.manage` | Pagar el plan actual: termina la prueba antes o reactiva un plan vencido |
| `POST /workspaces/:id/subscription/cancel` | `billing.manage` | Prueba: termina ya. Pagado: al final del periodo |
| `POST /workspaces/:id/subscription/resume` | `billing.manage` | Deshace una cancelación pendiente |

Además, `GET /users/me` incluye en cada workspace un resumen `plan` (código, nombre, estado, días de prueba) visible para **todos** los miembros. Lo usa el aviso de prueba del frontend.

Con los roles de sistema, `billing.read` lo tienen OWNER y ADMIN, y `billing.manage` solo OWNER. Un usuario que no es miembro recibe `404` (no se revela si el workspace existe) y un miembro sin permiso, `403`. Ver [authorization.md](authorization.md).

### Códigos de error

Los errores de billing incluyen `code` (y a veces `details`) en el cuerpo, para que el cliente muestre su propio mensaje traducido:

| `code` | HTTP | Cuándo |
| ------ | ---- | ------ |
| `PLAN_UNAVAILABLE` | 400 | Plan inexistente, retirado, privado o sin precio en esa moneda/periodo |
| `NO_SUBSCRIPTION` | 404 | El workspace no tiene suscripción |
| `ALREADY_ON_PLAN` | 409 | Ya está en ese plan y periodo |
| `ALREADY_ACTIVE` | 409 | `activate` sobre un plan activo |
| `NOTHING_TO_CANCEL` / `NO_PENDING_CANCELLATION` | 409 | Cancelar o reanudar sin sentido en el estado actual |
| `PLAN_LIMIT_EXCEEDED` | 409 | El uso supera el nuevo límite. `details: { feature, plan, limit, usage }` |
| `PAYMENTS_UNAVAILABLE` | 402 | Hace falta pagar y `BILLING_PAYMENTS_MODE=disabled` |

## Pasarela de pago

`PaymentGateway` ([`ports.ts`](../src/modules/billing/application/ports.ts)) tiene hoy dos implementaciones: `SimulatedPaymentGateway` y `DisabledPaymentGateway`, elegidas por `BILLING_PAYMENTS_MODE`. Para conectar Stripe u otro proveedor:

1. Implementar `PaymentGateway` (checkout o cobro, guardando `provider` y `provider_reference`).
2. Añadir los webhooks del proveedor para renovaciones, fallos de pago (`PAST_DUE`) y cancelaciones.
3. Añadir el modo nuevo a `BILLING_PAYMENTS_MODE`.

## Auditoría

Se registran `billing.plan.changed` (con `from`, `to` y `status`), `billing.subscription.activated`, `billing.subscription.canceled` y `billing.subscription.resumed`.

## Datos demo

Con `SEED_DEMO_DATA=true`, cada workspace demo queda en un estado distinto para poder probar todas las pantallas:

| Workspace | Plan | Estado |
| --------- | ---- | ------ |
| Acme Corp | Empresa, anual | `ACTIVE` (pago simulado) |
| Globex Industries | Equipo, mensual | `TRIALING` (7 días) |
| Initech | Corporativo, mensual | `EXPIRED` (la prueba venció hace 3 días) |

Cualquier otro workspace sin suscripción (por ejemplo, creado antes de existir los planes) recibe la prueba del plan por defecto.

## Pendiente

- Job periódico que pase a `EXPIRED`/`PAST_DUE`/`CANCELED` sin esperar a una lectura, y envíe avisos por email antes de que termine la prueba.
- Aplicar los límites en los módulos que aún no existen (líneas, contactos, créditos IA…) y restringir la escritura cuando no hay acceso completo (`hasFullAccess=false`). Agentes y roles personalizados ya se validan.
- Pasarela de pago real, facturas, impuestos y prorrateo al cambiar de plan a mitad de periodo.
- Complementos de pago por uso (agente adicional, paquetes de contactos o créditos).
