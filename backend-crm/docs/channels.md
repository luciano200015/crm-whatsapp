# Canales: líneas de WhatsApp (Cloud API)

Código en [`src/modules/channels`](../src/modules/channels). En el menú: **Canales → Líneas**.

Una **línea** es un número de WhatsApp Business conectado con la **API oficial de Meta (Cloud API)** mediante credenciales que se copian a mano. Meta avisa de los mensajes entrantes con un **webhook** y nosotros respondemos con la Graph API. La conexión con «Iniciar sesión con Facebook» (Embedded Signup) queda para más adelante.

## Datos de una línea (PostgreSQL)

| Campo | Notas |
| ----- | ----- |
| `phoneNumberId` | «Phone number ID» de Meta. **Único** en todo el sistema: enruta los webhooks |
| `wabaId`, `displayPhone`, `verifiedName` | Informativos. `verifiedName` y el número se rellenan al probar la conexión |
| `accessTokenEnc`, `appSecretEnc` | **Cifrados** con AES-256-GCM ([`SecretBox`](../src/shared/security/secret-box.ts), clave `CHANNEL_SECRETS_KEY`). La API nunca los devuelve: solo `accessTokenLast4` |
| `webhookVerifyToken` | Aleatorio, lo generamos nosotros. Se pega en Meta |
| `status` | `PENDING` → `CONNECTED` (prueba correcta o primer webhook firmado), `ERROR` (Meta rechazó las credenciales, ver `lastError`), `DISABLED` (apagada por el workspace) |
| `autoAssign`, agentes (`channel_line_agents`) | Quién atiende la línea y si los chats nuevos se reparten solos (ver [inbox.md](inbox.md)) |

**Plan:**

- crear una línea exige acceso completo (`402 SUBSCRIPTION_INACTIVE`) y respetar `limits.whatsapp_lines`: Equipo 2, Empresa 5, Corporativo 15 (`409 LINE_LIMIT_REACHED`);
- el conteo y el alta van bajo un bloqueo de la fila del workspace, así que dos altas simultáneas no superan el límite.

## Conectar un número real paso a paso

1. **En Meta for Developers** (developers.facebook.com):
   - crea una app de tipo *Business* y añade el producto **WhatsApp**;
   - en *WhatsApp → API Setup* registra o elige el número.
2. **Copia:**
   - el **Phone number ID** (y, si quieres, el *WhatsApp Business Account ID*);
   - un **token de acceso permanente**: créalo con un *System User* en Business Settings, con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. El token temporal de 24 h sirve para probar;
   - el **App Secret** (*App settings → Basic*).
3. **En el CRM:** Canales → Líneas → **Conectar número**, pega los datos y pulsa **Probar conexión**:
   - comprueba el token contra el número;
   - si la línea tiene WABA ID, **suscribe la app a la cuenta de WhatsApp Business** (`POST /{waba-id}/subscribed_apps`). Sin esa suscripción Meta no envía los mensajes entrantes de un número real;
   - debe quedar «Conectada» con el nombre verificado.
4. **De vuelta en Meta, *WhatsApp → Configuration → Webhook*:**
   - pega la **URL de devolución de llamada** y el **token de verificación** que muestra la tarjeta de la línea y pulsa *Verify and save*;
   - Meta llama a `GET /api/v1/webhooks/whatsapp/:lineId` y debemos responder con el `hub.challenge`. La tarjeta muestra entonces «Último evento de Meta».
5. En **Webhook fields**, suscríbete a **`messages`**.

### ¿Por qué una URL por línea y no por workspace?

- **Cada línea puede venir de una app de Meta distinta, con su propio App Secret.** La URL dice con qué secreto verificar la firma **antes** de leer el cuerpo. Con una URL por workspace habría que probar todos los secretos del workspace.
- **Meta admite una sola URL de webhook por app.** Si varios números comparten app, basta pegar la URL de cualquiera de sus líneas: los eventos se enrutan por `phone_number_id` dentro del mismo workspace.

### En desarrollo: túnel con ngrok

Meta no puede llamar a `localhost`. `npm run tunnel` expone **solo el webhook**:

- arranca un filtro local (`127.0.0.1:3001`) delante de la API;
- abre ngrok hacia ese filtro;
- cualquier otra ruta (login, Swagger, el resto de la API) responde `404` sin llegar a la API;
- solo deja pasar `GET` y `POST` a `/api/v1/webhooks/whatsapp/<uuid>` y rechaza cuerpos de más de 3 MB;
- funciona con cualquier versión de ngrok y con cualquier otro túnel que apunte a ese puerto.

```bash
ngrok config add-authtoken <tu-authtoken>        # una vez: https://dashboard.ngrok.com/get-started/your-authtoken
npm run tunnel                                   # URL aleatoria
npm run tunnel -- --domain tu-nombre.ngrok-free.app   # tu dominio gratuito fijo de ngrok
```

El script imprime la línea `PUBLIC_API_URL=https://…`:

- cópiala en `.env`, pon `WHATSAPP_MODE=live` y reinicia la API;
- la tarjeta de la línea mostrará la URL pública;
- con una URL aleatoria, cada vez que reinicias ngrok cambia y hay que volver a pegarla en Meta. Por eso conviene el dominio fijo.

**Con el número de prueba de Meta:**

- solo puede escribir a un máximo de 5 números que añadas como destinatarios en *WhatsApp → API Setup*;
- para responder con texto libre, el cliente tiene que haber escrito en las últimas 24 h;
- el token temporal caduca a las 24 h. Para algo estable usa un token de *System User*.

Sin número real, usa el **simulador**:

- envía al webhook local un mensaje entrante firmado con el App Secret de la línea, exactamente como lo haría Meta;
- con `WHATSAPP_MODE=simulated`, «Probar conexión» y las respuestas se dan por buenas sin llamar a Meta.

```bash
npm run whatsapp:simulate -- --from +59171234567 --name "Lucía" --text "Hola, ¿tienen stock?"
```

## Webhook

`/api/v1/webhooks/whatsapp/:lineId`, público y sin JWT. Se autentica así:

| Método | Comprobación | Respuesta |
| ------ | ------------ | --------- |
| `GET` | `hub.mode=subscribe` y `hub.verify_token` igual al de la línea (comparación en tiempo constante) | `hub.challenge` en texto plano, o `403` |
| `POST` | `X-Hub-Signature-256` = HMAC-SHA256 del **cuerpo crudo** con el App Secret (`rawBody` de Nest, `timingSafeEqual`) | `200` si la firma es válida, `401` si no |

- **Si la firma es válida:**
  - se normaliza el payload ([`whatsapp-payload.ts`](../src/modules/channels/domain/whatsapp-payload.ts)): textos, medios, ubicaciones, botones y estados de entrega. Las reacciones y los avisos del sistema se ignoran;
  - los eventos se enrutan por `metadata.phone_number_id` a las líneas **del mismo workspace**, para que varias líneas de una misma app de Meta compartan URL;
  - la línea queda `CONNECTED` y registra `lastWebhookAt`;
  - una línea `DISABLED` responde `200`, para que Meta no reintente, pero ignora los eventos.
- **Procesamiento:** los eventos se entregan al puerto `WhatsAppEventsSink`, que implementa la bandeja ([inbox.md](inbox.md)). Se procesan **antes** de responder: si algo falla, Meta recibe un error y reintenta, y no se pierde el mensaje.
- **Logs:**
  - la cabecera de firma y los secretos se redactan; el texto de los mensajes nunca se registra;
  - una firma inválida deja un aviso con el id de la línea (normalmente el App Secret pegado no es el de la app).

## API de líneas

Todas bajo `/api/v1/workspaces/:workspaceId/channels/lines`.

| Método y ruta | Permiso | Qué hace |
| ------------- | ------- | -------- |
| `GET` · `GET :lineId` | `channels.read` | Líneas. `webhook` (URL y token de verificación) solo se incluye con `channels.manage` |
| `POST` | `channels.manage` | Conectar un número |
| `PATCH :lineId` | `channels.manage` | Nombre o credenciales (las nuevas vuelven a `PENDING`), `enabled`, `autoAssign` |
| `POST :lineId/test` | `channels.manage` | Comprueba las credenciales contra Meta y suscribe la app a la WABA |
| `PUT :lineId/agents` | `channels.manage` | Agentes que atienden la línea (solo miembros activos del workspace) |
| `DELETE :lineId` | `channels.manage` | Elimina la línea; sus conversaciones quedan en el historial |

**Errores:** `LINE_NOT_FOUND`, `LINE_LIMIT_REACHED`, `PHONE_NUMBER_ID_TAKEN`, `SUBSCRIPTION_INACTIVE`, `MEMBER_NOT_FOUND`, `WEBHOOK_VERIFICATION_FAILED`, `INVALID_SIGNATURE`.

**Auditoría:** `channels.line.created`, `channels.line.updated` (solo los nombres de los campos, nunca los valores) y `channels.line.deleted`.

## Variables de entorno

| Variable | Por defecto | Uso |
| -------- | ----------- | --- |
| `CHANNEL_SECRETS_KEY` | **obligatoria** | 32 bytes en base64 (`npm run secrets:generate`). Rotarla obliga a volver a cifrar las credenciales |
| `PUBLIC_API_URL` | `APP_URL` | Base de la URL del webhook que se muestra |
| `WHATSAPP_MODE` | `live` | `simulated`: nada sale hacia Meta (solo desarrollo; la app no arranca así en producción) |
| `WHATSAPP_GRAPH_BASE_URL` | `https://graph.facebook.com` | Base de la Graph API |
| `WHATSAPP_GRAPH_VERSION` | `v23.0` | Versión de la Graph API |

## Pendiente

- Conexión con Facebook (Embedded Signup) y alta del número desde el CRM.
- Plantillas de mensaje (para escribir fuera de la ventana de 24 h).
- Descargar y guardar los archivos multimedia.
- Rotación de `CHANNEL_SECRETS_KEY` con varias claves.
- Cola de procesamiento del webhook (hoy en el mismo proceso).
