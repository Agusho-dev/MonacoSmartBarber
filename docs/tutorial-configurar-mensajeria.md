# Tutorial: Configurar Mensajeria (WhatsApp e Instagram)

Guia paso a paso para que cualquier organizacion conecte WhatsApp Business e Instagram Direct con Monaco Smart Barber.

---

## Requisitos previos

1. **Meta Business Account** — Si no tenes una, creala en [business.facebook.com](https://business.facebook.com)
2. **Meta Developer Account** — Registrate en [developers.facebook.com](https://developers.facebook.com)
3. Para WhatsApp: un **numero de telefono** verificado para WhatsApp Business
4. Para Instagram: una **cuenta Instagram Business** o Creator, conectada a una **Pagina de Facebook**
5. Acceso de **admin** al dashboard de Monaco Smart Barber

---

## Parte 1: Crear la Meta App

Todas las integraciones (WhatsApp e Instagram) usan una sola Meta App.

1. Ir a [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Click en **Crear app**
3. Tipo de app: **Empresa** (o "Business")
4. Nombre: `Monaco Smart Barber` (o el nombre de tu barberia)
5. Asociar a tu **Meta Business Account**
6. Click en **Crear app**

Una vez creada, vas a ver el **App Dashboard** con el **App ID** y el **App Secret**.

> **Importante:** Guarda el **App Secret** — lo vas a necesitar para la verificacion HMAC de seguridad.
> Lo encontras en: App Dashboard → Configuracion → Basica → Clave secreta de la app.

---

## Parte 2: Configurar WhatsApp Business

### 2.1 Agregar WhatsApp a la Meta App

1. En tu Meta App, ir a **Agregar producto** → **WhatsApp** → **Configurar**
2. Se abre el panel de WhatsApp. Aca vas a encontrar:
   - **Phone Number ID** — Identificador del numero de telefono
   - **WhatsApp Business Account ID** (WABA ID)
   - **Access Token temporal** — Funciona por 24h para testing

### 2.2 Generar un Access Token permanente

El token temporal expira. Para produccion:

1. Ir a [business.facebook.com/settings](https://business.facebook.com/settings)
2. **Usuarios del sistema** → **Agregar**
3. Nombre: `monaco-api`, Rol: **Admin**
4. Click en **Generar token**
5. Seleccionar la app creada
6. Marcar los permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
7. **Generar** — Este token **NO expira**

### 2.3 Configurar en Monaco Smart Barber

1. Ir al dashboard → **Mensajeria** → Icono de engranaje (configuracion)
2. Tab **WhatsApp**
3. Completar:
   - **Access Token**: el token permanente del System User
   - **Phone Number ID**: copiado del panel de WhatsApp
   - **WhatsApp Business Account ID**: copiado del panel
   - **App Secret**: de Configuracion → Basica en tu Meta App
4. Click en **Guardar credenciales**
5. Se genera automaticamente un **Token de verificacion** y una **URL de webhook**

### 2.4 Configurar el Webhook en Meta

1. En tu Meta App → WhatsApp → **Configuracion** (o "Configuration")
2. En la seccion **Webhook**, click **Editar**
3. Pegar:
   - **URL de devolucion de llamada**: la URL que te muestra Monaco (ej: `https://tudominio.com/api/webhooks/whatsapp`)
   - **Token de verificacion**: el token generado por Monaco
4. Click en **Verificar y guardar**
5. En **Campos del webhook**, suscribirse a:
   - `messages` — Para recibir mensajes entrantes
   - `message_status` — Para actualizaciones de estado (entregado, leido)

### 2.5 Probar

1. Desde otro telefono, enviar un mensaje de WhatsApp al numero configurado
2. Deberia aparecer en la bandeja de entrada de Mensajeria en el dashboard
3. Responder desde el dashboard — el mensaje debe llegar al WhatsApp del cliente

---

## Parte 3: Configurar Instagram Direct

### 3.1 Conectar Instagram Business a una Pagina de Facebook

Si tu cuenta de Instagram ya esta conectada a una Pagina de Facebook, saltar este paso.

1. Desde la app de Instagram → Configuracion → Cuenta → Cuentas vinculadas → Facebook
2. Vincular con la Pagina de Facebook de tu barberia
3. Asegurate de que la cuenta sea **Business** o **Creator** (no personal)

### 3.2 Agregar Instagram a la Meta App

1. En tu Meta App → **Agregar producto** → **Instagram** → **Configurar**
2. En **Configuracion de la API**, vincular tu cuenta de Instagram Business

### 3.3 Obtener las credenciales

Necesitas 3 valores:

| Credencial | Donde encontrarlo |
|---|---|
| **Facebook Page ID** | Meta App → Instagram → Configuracion de la API → Paginas conectadas → ID de pagina |
| **Page Access Token** | Graph API Explorer → Seleccionar tu pagina → Permisos: `instagram_manage_messages`, `pages_messaging` → Generar token |
| **Instagram Account ID** | Graph API Explorer → `GET /me?fields=instagram_business_account` → El ID devuelto |

> **Tip:** Para un token de larga duracion, usar Graph API Explorer para generar un token de usuario, luego extenderlo via:
> `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}`

### 3.4 Configurar en Monaco Smart Barber

1. Dashboard → **Mensajeria** → Engranaje → Tab **Instagram**
2. Completar:
   - **Facebook Page ID**: el ID de la pagina de Facebook conectada
   - **Page Access Token**: el token con permiso `instagram_manage_messages`
   - **Instagram Account ID** (opcional pero recomendado): el IGBA ID
   - **App Secret**: de Configuracion → Basica en tu Meta App
3. **Guardar credenciales**
4. Se genera un Token de verificacion y URL de webhook

### 3.5 Configurar el Webhook en Meta

1. Meta App → Instagram → **Webhooks**
2. Suscribirse al campo **messages**
3. Pegar la URL y el Token de verificacion de Monaco
4. Verificar y guardar

### 3.6 Probar

1. Desde otra cuenta de Instagram, enviar un DM a la cuenta Business
2. Deberia aparecer en la bandeja de entrada del dashboard
3. Responder desde Monaco — el mensaje llega como DM de Instagram

---

## Parte 4: Permisos y App Review (Produccion)

En **modo desarrollo**, la Meta App funciona solo con cuentas de prueba (hasta 5 usuarios). Para produccion:

### WhatsApp
- Solicitar permiso: `whatsapp_business_messaging`
- Meta generalmente lo aprueba automaticamente para Business API

### Instagram
- Solicitar permisos:
  - `instagram_manage_messages` — Para enviar y recibir DMs
  - `pages_messaging` — Para la Pagina de Facebook vinculada
- Se requiere **App Review** — Incluir:
  - Capturas del flujo de uso
  - Explicacion de por que la app necesita mensajeria
  - Video demo del flujo completo

### Tiempos
- WhatsApp: aprobacion tipica en 1-3 dias
- Instagram: aprobacion tipica en 3-7 dias

---

## Solucion de problemas

### No llegan mensajes al dashboard

1. **Verificar que el webhook este activo** — En Meta App, verificar que el campo `messages` este suscripto
2. **Probar el webhook manualmente** — En Meta App → Webhooks → "Enviar test" deberia generar un POST al webhook
3. **Revisar logs** — En Vercel Dashboard → Functions → `/api/webhooks/whatsapp` o `/api/webhooks/instagram`
4. **Verificar que los IDs sean correctos** — El `Phone Number ID` de WhatsApp o `Page ID` de Instagram deben coincidir con lo configurado en Monaco

### "Firma HMAC invalida"

- Verificar que el **App Secret** configurado en Monaco sea el mismo de tu Meta App (Configuracion → Basica)
- Si recien agregaste el App Secret, hacer deploy para que tome efecto

### Instagram no muestra conversaciones

- Verificar que `entry.id` del webhook coincida con el `Facebook Page ID` o `Instagram Account ID` configurado
- Meta envia como `entry.id` el **Instagram Account ID** (IGBA ID), no el Page ID
- Si solo tenes el Page ID configurado, agregar tambien el Instagram Account ID en la config

### Token expirado

- **WhatsApp System User Token**: NO expira
- **Instagram/Facebook Page Token**: puede expirar en ~60 dias
  - Regenerar desde Graph API Explorer
  - Extender via la API de OAuth (ver seccion 3.3)

### Ventana de 24 horas

- Meta exige responder dentro de 24h desde el ultimo mensaje del usuario
- Pasadas las 24h, solo se pueden enviar **templates** aprobados (solo WhatsApp)
- Instagram no permite ningun mensaje fuera de la ventana de 24h

---

## Resumen de URLs

| Plataforma | URL Webhook | Campos suscriptos |
|---|---|---|
| WhatsApp | `https://{tudominio}/api/webhooks/whatsapp` | `messages`, `message_status` |
| Instagram | `https://{tudominio}/api/webhooks/instagram` | `messages` |

## Resumen de credenciales necesarias

| Plataforma | Credenciales |
|---|---|
| WhatsApp | Access Token, Phone Number ID, WABA ID, App Secret |
| Instagram | Facebook Page ID, Page Access Token, Instagram Account ID, App Secret |

> **Nota:** El App Secret es el mismo para ambas plataformas si usan la misma Meta App.
