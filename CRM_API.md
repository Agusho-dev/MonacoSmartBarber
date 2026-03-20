Plan: CRM Mensajería — Integración WhatsApp, Facebook e Instagram
Contexto
La UI de mensajería ya está construida (mensajeria-client.tsx, 863 líneas) con inbox, chat, mensajes programados y perfil de cliente. Los types (database.ts:536-613) y server actions (messaging.ts) también existen. Pero las tablas de DB no existen, no hay Edge Functions, no hay webhooks, y no hay UI de configuración de canales.

Las 3 plataformas usan el ecosistema Meta: una sola Meta App en developers.facebook.com maneja WA + FB + IG. Comparten el mismo sistema de webhooks (GET verificación + POST notificaciones, firmado con X-Hub-Signature-256). Todas tienen ventana de 24h para responder (WA la más estricta).

Paso 1: Migración de base de datos
Archivo: supabase/migrations/036_messaging_tables.sql

Crear las 5 tablas que ya tienen types definidos:

Tabla	Propósito
social_channels	Un registro por canal conectado (WA/FB/IG) por sucursal. Campo config JSONB guarda credenciales Meta
conversations	Una fila por contacto externo por canal. can_reply_until para ventana 24h
messages	Mensajes individuales con direction, status, content_type
message_templates	Templates de WhatsApp sincronizados desde Meta
scheduled_messages	Cola de mensajes programados
Credenciales por plataforma en config:

WhatsApp: { access_token, phone_number_id, waba_id, app_secret }
Facebook: { page_access_token, page_id, app_secret }
Instagram: { access_token, ig_user_id, app_secret }
Incluir:

Indexes: messages(conversation_id, created_at), conversations(channel_id, last_message_at), scheduled_messages(scheduled_for) WHERE status='pending'
Triggers update_updated_at() en social_channels y conversations
Realtime: ALTER PUBLICATION supabase_realtime ADD TABLE messages, conversations;
RLS habilitado con policies para staff (dashboard usa createAdminClient() que bypasea RLS)
Paso 2: Edge Function send-message
Archivo: supabase/functions/send-message/index.ts

Ya referenciado en messaging.ts:50 y messaging.ts:83. Siguiendo el patrón de client-auth/index.ts.

Maneja 2 tipos de request:

A) Mensaje de texto a conversación existente:

{ "conversation_id": "uuid", "content": "texto", "staff_id": "uuid" }
Buscar conversación → join social_channels para obtener platform + config
Insertar en messages con status pending, direction outbound
Llamar API según plataforma:
WA: POST graph.facebook.com/v21.0/{phone_number_id}/messages → { messaging_product: "whatsapp", to: phone, type: "text", text: { body } }
FB: POST graph.facebook.com/v21.0/me/messages → { recipient: { id: PSID }, message: { text } } con page_access_token
IG: POST graph.instagram.com/v21.0/me/messages → { recipient: { id: IGSID }, message: { text } }
Actualizar message status a sent + guardar platform_message_id, o failed + error_message
B) Template message (abre conversación nueva si necesario):

{ "client_id": "uuid", "channel_id": "uuid", "template_name": "str", "template_params": {}, "staff_id": "uuid" }
Solo para WhatsApp. Buscar/crear conversación, enviar template vía API.

Paso 3: Edge Function messaging-webhook
Archivo: supabase/functions/messaging-webhook/index.ts

Una sola URL de webhook para las 3 plataformas: https://gzsfoqpxvnwmvngfoqqk.supabase.co/functions/v1/messaging-webhook

GET (verificación Meta):

Parsear query params: hub.mode, hub.verify_token, hub.challenge
Validar verify_token contra social_channels.webhook_verify_token
Responder con hub.challenge como texto plano
POST (mensajes entrantes):

Verificar firma X-Hub-Signature-256 con HMAC-SHA256 del body usando app_secret
Responder 200 OK rápido
Parsear por campo object:
whatsapp_business_account → handler WA
page → handler FB
instagram → handler IG
Para cada mensaje entrante:
Encontrar social_channel por platform_account_id
Encontrar o crear conversation por (channel_id, platform_user_id)
Intentar matchear con clients (WA por teléfono, IG por username)
Insertar messages con direction: 'inbound', status: 'delivered'
Actualizar conversation.last_message_at, incrementar unread_count, setear can_reply_until
Para status updates (WA): actualizar messages.status por platform_message_id
Matcheo de clientes:

WA: normalizar teléfono y buscar en clients.phone
IG: fetch perfil GET graph.instagram.com/{IGSID}?fields=username → buscar en clients.instagram
FB: fetch nombre GET graph.facebook.com/{PSID}?fields=first_name,last_name → guardar como platform_user_name
Paso 4: UI de configuración de canales
Archivos nuevos:

src/app/dashboard/mensajeria/canales/page.tsx — Server component
src/app/dashboard/mensajeria/canales/canales-client.tsx — Client component
Archivo modificado:

src/lib/actions/messaging.ts — Agregar actions de CRUD de canales
Siguiendo el patrón de Card de configuracion-client.tsx, una card por plataforma:

Card WhatsApp:

Inputs: Access Token, Phone Number ID, WABA ID, App Secret
Display: Webhook URL auto-generada + Verify Token (copiable)
Botón "Probar conexión" y "Sincronizar Templates"
Indicador de estado (activo/inactivo)
Card Facebook Messenger:

Inputs: Page Access Token, Page ID, App Secret
Display: Webhook URL + Verify Token
Botón "Probar conexión"
Card Instagram:

Inputs: Access Token, IG User ID, App Secret
Display: Webhook URL + Verify Token
Botón "Probar conexión"
Cada card muestra instrucciones paso a paso para configurar en Meta Developers:

Crear Meta App (o usar existente)
Agregar producto (WhatsApp/Messenger/Instagram)
Copiar credenciales al formulario
Configurar webhook URL + verify token en Meta
Server actions nuevos en messaging.ts:

createOrUpdateChannel(data) — Upsert en social_channels, auto-genera webhook_verify_token
deleteChannel(channelId) — Desactiva canal
testChannelConnection(channelId) — Llama GET graph.facebook.com/v21.0/me para verificar token
syncTemplates(channelId) — Fetch templates de WhatsApp API y upsert en message_templates
Seguridad: Tokens enmascarados en UI después del guardado inicial (solo últimos 8 chars visibles). config nunca se expone al client component completo.

Link desde mensajería: Agregar ícono gear en header de mensajeria-client.tsx que lleve a /dashboard/mensajeria/canales.

Paso 5: Procesador de mensajes programados
Archivo: supabase/functions/process-scheduled/index.ts

Edge Function ejecutada por cron cada minuto (configurar desde Supabase Dashboard):

Query scheduled_messages WHERE status='pending' AND scheduled_for <= now()
Por cada mensaje:
Buscar canal y cliente
Si tiene template_id → enviar como template
Si tiene content → verificar ventana 24h y enviar como texto
Actualizar status a sent/failed, setear sent_at
Paso 6: Ajustes menores
mensajeria-client.tsx: Agregar botón de configuración (gear icon) en el header que linkee a /dashboard/mensajeria/canales
Permisos (opcional): Si se quiere restringir acceso, agregar categoría messaging en permissions.ts
Archivos a crear
Archivo	Descripción
supabase/migrations/036_messaging_tables.sql	5 tablas + indexes + RLS + Realtime
supabase/functions/send-message/index.ts	Envío de mensajes salientes vía Meta API
supabase/functions/messaging-webhook/index.ts	Recepción de webhooks de Meta
supabase/functions/process-scheduled/index.ts	Procesador cron de mensajes programados
src/app/dashboard/mensajeria/canales/page.tsx	Page server component
src/app/dashboard/mensajeria/canales/canales-client.tsx	UI de configuración de canales
Archivos a modificar
Archivo	Cambio
src/lib/actions/messaging.ts	Agregar 4 server actions para CRUD de canales
src/app/dashboard/mensajeria/mensajeria-client.tsx	Agregar link a configuración de canales
Orden de implementación (todo junto)
Se implementan las 3 plataformas (WA + FB + IG) de una vez ya que comparten la misma Meta API:

Migración DB (bloquea todo lo demás)
Edge Function send-message (desbloquea envío desde UI existente)
Edge Function messaging-webhook (habilita recepción de mensajes)
UI de configuración de canales en /dashboard/mensajeria/canales con guía paso a paso de Meta App
Edge Function process-scheduled (procesa cola de mensajes programados)
Ajustes menores (link gear en header de mensajería)
Guía de setup Meta App (incluir en UI de canales)
La UI de configuración de canales debe incluir instrucciones inline para el usuario:

Paso 1 — Crear Meta App:

Ir a developers.facebook.com → "Mis apps" → "Crear app"
Tipo: "Empresa" → Nombre: "Monaco Smart Barber"
Asociar a una Meta Business Account (crear si no existe)
Paso 2 — Agregar productos a la app:

WhatsApp: "Agregar producto" → WhatsApp → Configurar. Se obtiene Phone Number ID, WABA ID, y Access Token temporal (luego generar System User Token permanente en Business Settings)
Messenger: "Agregar producto" → Messenger → Vincular Facebook Page. Se obtiene Page Access Token
Instagram: "Agregar producto" → Instagram → Vincular cuenta profesional. Se obtiene Access Token + IG User ID
Paso 3 — Configurar webhooks (desde la UI de canales):

La UI muestra la Webhook URL y Verify Token generados automáticamente
El usuario los copia y pega en Meta Developers → Webhooks de cada producto
Suscribirse a: messages y messaging_postbacks (FB/IG), messages y message_status (WA)
Paso 4 — Permisos y App Review:

Para uso en producción, la Meta App necesita App Review con estos permisos:
WhatsApp: whatsapp_business_messaging
Messenger: pages_messaging, pages_manage_metadata
Instagram: instagram_business_manage_messages
En modo desarrollo, funciona sin review con hasta 5 usuarios de prueba
Nota sobre tokens:

WhatsApp System User Token (desde Business Settings > System Users): NO expira
Page Access Token (largo plazo): expira en ~60 días, se puede extender
La UI debe alertar cuando un token está próximo a expirar
Verificación
Aplicar migración con supabase db push
Deploy Edge Functions: supabase functions deploy send-message --no-verify-jwt, idem para webhook y process-scheduled
Desde el dashboard, ir a Mensajería > Canales, configurar un canal WhatsApp con token de prueba
En Meta Developers, configurar webhook URL y verificar que pasa la verificación
Enviar un mensaje de prueba desde WhatsApp al número configurado → debe aparecer en inbox
Responder desde el dashboard → debe llegar al WhatsApp del cliente
Programar un mensaje → verificar que se envía a la hora indicada