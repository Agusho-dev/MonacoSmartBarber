-- ============================================================
-- Seed: planes y módulos comerciales MSB
-- ============================================================
-- Ejecutar DESPUÉS de 110_saas_billing_foundation.sql.
-- Idempotente: usa ON CONFLICT para actualizar precios/features en caliente.
--
-- Precios en centavos de ARS (AR$ 29.900 = 2.990.000).
-- ============================================================

-- ---- PLANS ---------------------------------------------------------

INSERT INTO public.plans (
  id, name, tagline, price_ars_monthly, price_ars_yearly,
  price_usd_monthly, price_usd_yearly,
  trial_days, features, limits, is_public, sort_order
) VALUES
-- FREE ---------------------------------------------------------------
('free',
 'Free',
 'Para probar el sistema con lo esencial',
 0, 0, 0, 0,
 0,
 jsonb_build_object(
   'queue.enabled', true,
   'kiosk.enabled', true,
   'tv.enabled', true,
   'clients.enabled', true,
   'services.enabled', true,
   'reviews.basic', true,
   'caja.basic', true
 ),
 jsonb_build_object(
   'branches', 1,
   'staff', 2,
   'clients', 200,
   'broadcasts_monthly', 0,
   'ai_messages_monthly', 0
 ),
 false, 0),

-- START --------------------------------------------------------------
('start',
 'Start',
 'Para barberías que están arrancando',
 2990000, 29900000, 2500, 25000,
 14,
 jsonb_build_object(
   'queue.enabled', true,
   'kiosk.enabled', true,
   'tv.enabled', true,
   'clients.enabled', true,
   'services.enabled', true,
   'reviews.basic', true,
   'reviews.google', true,
   'caja.basic', true,
   'caja.advanced', true,
   'reports.basic', true,
   'calendar.basic', true,
   'staff.schedule', true
 ),
 jsonb_build_object(
   'branches', 1,
   'staff', 5,
   'clients', 1500,
   'broadcasts_monthly', 0,
   'ai_messages_monthly', 0
 ),
 true, 10),

-- PRO ----------------------------------------------------------------
('pro',
 'Pro',
 'La solución completa para crecer',
 6990000, 69900000, 6000, 60000,
 14,
 jsonb_build_object(
   'queue.enabled', true,
   'kiosk.enabled', true,
   'tv.enabled', true,
   'clients.enabled', true,
   'services.enabled', true,
   'reviews.basic', true,
   'reviews.google', true,
   'reviews.automation', true,
   'caja.basic', true,
   'caja.advanced', true,
   'reports.basic', true,
   'reports.advanced', true,
   'calendar.basic', true,
   'staff.schedule', true,
   'appointments.enabled', true,
   'appointments.public_booking', true,
   'messaging.inbox', true,
   'messaging.whatsapp', true,
   'messaging.broadcasts', true,
   'messaging.quick_replies', true,
   'messaging.auto_replies', true,
   'rewards.enabled', true,
   'mobile_app.enabled', true,
   'salary.enabled', true,
   'salary.commissions', true,
   'breaks.enabled', true,
   'finances.advanced', true,
   'finances.fixed_expenses', true,
   'payment_accounts.enabled', true
 ),
 jsonb_build_object(
   'branches', 3,
   'staff', 20,
   'clients', 10000,
   'broadcasts_monthly', 500,
   'ai_messages_monthly', 0
 ),
 true, 20),

-- ENTERPRISE ---------------------------------------------------------
('enterprise',
 'Enterprise',
 'Para cadenas y franquicias',
 13990000, 139900000, 12500, 125000,
 14,
 jsonb_build_object(
   'queue.enabled', true,
   'kiosk.enabled', true,
   'tv.enabled', true,
   'clients.enabled', true,
   'services.enabled', true,
   'reviews.basic', true,
   'reviews.google', true,
   'reviews.automation', true,
   'caja.basic', true,
   'caja.advanced', true,
   'reports.basic', true,
   'reports.advanced', true,
   'calendar.basic', true,
   'staff.schedule', true,
   'appointments.enabled', true,
   'appointments.public_booking', true,
   'messaging.inbox', true,
   'messaging.whatsapp', true,
   'messaging.instagram', true,
   'messaging.broadcasts', true,
   'messaging.quick_replies', true,
   'messaging.auto_replies', true,
   'messaging.workflows', true,
   'rewards.enabled', true,
   'mobile_app.enabled', true,
   'salary.enabled', true,
   'salary.commissions', true,
   'breaks.enabled', true,
   'finances.advanced', true,
   'finances.fixed_expenses', true,
   'payment_accounts.enabled', true,
   'ai.enabled', true,
   'incentives.enabled', true,
   'discipline.enabled', true,
   'agreements.enabled', true,
   'face_recognition.enabled', true,
   'white_label.partial', true,
   'api.public', true,
   'support.priority', true
 ),
 jsonb_build_object(
   'branches', 10,
   'staff', -1,
   'clients', -1,
   'broadcasts_monthly', -1,
   'ai_messages_monthly', 5000
 ),
 true, 30)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  price_ars_monthly = EXCLUDED.price_ars_monthly,
  price_ars_yearly = EXCLUDED.price_ars_yearly,
  price_usd_monthly = EXCLUDED.price_usd_monthly,
  price_usd_yearly = EXCLUDED.price_usd_yearly,
  trial_days = EXCLUDED.trial_days,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  is_public = EXCLUDED.is_public,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();


-- ---- MODULES -------------------------------------------------------

INSERT INTO public.modules (
  id, name, description, icon, category, status, teaser_copy,
  estimated_release, price_ars_addon, included_in_plans, feature_key, sort_order
) VALUES
-- CORE ---------------------------------------------------------------
('queue',               'Fila en tiempo real', 'Cola de espera con realtime para admin, barbero, kiosk y TV.', 'ListOrdered',  'core', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'queue.enabled', 1),
('kiosk',               'Kiosk de check-in',   'Tablet público para auto-check-in de clientes.',                 'Tablet',       'core', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'kiosk.enabled', 2),
('tv',                  'TV Display',          'Monitor público con cola en vivo para salón.',                   'Tv',           'core', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'tv.enabled', 3),
('clients',             'Clientes',            'CRM: fichas de clientes, historial, segmentación.',              'Users',        'core', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'clients.enabled', 4),
('services',            'Servicios y productos','Catálogo, precios y comisiones.',                               'Sparkles',     'core', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'services.enabled', 5),
('caja_basic',          'Caja diaria',         'Cierre de caja simple.',                                         'Receipt',      'finance', 'active', NULL, NULL, NULL, ARRAY['free','start','pro','enterprise'], 'caja.basic', 6),

-- START+ -------------------------------------------------------------
('reports_basic',       'Reportes básicos',    'Ingresos del día, visitas, ticket promedio.',                    'BarChart3',    'analytics', 'active', NULL, NULL, NULL, ARRAY['start','pro','enterprise'], 'reports.basic', 10),
('reviews_google',      'Reseñas Google',      'Redirección de 5★ a Google Reviews.',                             'Star',         'reviews', 'active', NULL, NULL, NULL, ARRAY['start','pro','enterprise'], 'reviews.google', 11),
('calendar_basic',      'Calendario laboral',  'Horarios de staff y excepciones.',                               'Calendar',     'staff', 'active', NULL, NULL, NULL, ARRAY['start','pro','enterprise'], 'calendar.basic', 12),

-- PRO+ ---------------------------------------------------------------
('appointments',        'Turnos online',       'Booking público por sucursal con link personalizable.',          'CalendarClock','scheduling', 'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'appointments.enabled', 20),
('messaging_whatsapp',  'WhatsApp Business',   'Inbox unificado con Meta Business API.',                         'MessageSquare','messaging',  'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'messaging.whatsapp', 21),
('messaging_broadcasts','Envíos masivos',      'Campañas segmentadas a clientes.',                               'Megaphone',    'messaging',  'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'messaging.broadcasts', 22),
('rewards',             'Fidelización',        'Programa de puntos canjeables por premios.',                     'Gift',         'loyalty',    'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'rewards.enabled', 23),
('mobile_app',          'App móvil cliente',   'Los clientes ven sus puntos, premios y reservas desde la app.',  'Smartphone',   'mobile',     'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'mobile_app.enabled', 24),
('salary',              'Sueldos y comisiones','Generación de nóminas con comisión por servicio.',                'Banknote',     'finance',    'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'salary.enabled', 25),
('reviews_automation',  'Reseñas automáticas', 'Auto-envío de pedido de reseña post-visita.',                    'MailCheck',    'reviews',    'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'reviews.automation', 26),
('fixed_expenses',      'Gastos fijos',        'Alquiler, servicios, tickets de gastos mensuales.',              'ReceiptText',  'finance',    'active', NULL, NULL, NULL, ARRAY['pro','enterprise'], 'finances.fixed_expenses', 27),

-- ENTERPRISE ---------------------------------------------------------
('messaging_instagram', 'Instagram DMs',       'Respondé DMs de Instagram desde el mismo inbox.',                'Instagram',    'messaging',  'active', NULL, NULL, NULL, ARRAY['enterprise'], 'messaging.instagram', 30),
('workflows',           'Automatizaciones CRM','Trigger → acción (ej: cliente inactivo 30 días → WhatsApp).',    'Workflow',     'messaging',  'beta',   'Está en beta con usuarios seleccionados.', NULL, NULL, ARRAY['enterprise'], 'messaging.workflows', 31),
('ai',                  'AI Assistant',        'Auto-tagging y sugerencias de respuesta con IA.',                'Sparkles',     'messaging',  'beta',   'Beta. Usá tus propias API keys de OpenAI/Anthropic.', NULL, 1490000, ARRAY['enterprise'], 'ai.enabled', 32),
('incentives',          'Incentivos',          'Metas mensuales y reconocimientos para barberos.',               'Trophy',       'staff',      'active', NULL, NULL, NULL, ARRAY['enterprise'], 'incentives.enabled', 33),
('discipline',          'Disciplina',          'Reglas disciplinarias y escala de sanciones.',                   'Gavel',        'staff',      'active', NULL, NULL, NULL, ARRAY['enterprise'], 'discipline.enabled', 34),
('agreements',          'Convenios y partners','Beneficios con empresas y clubes aliados.',                      'Handshake',    'growth',     'beta',   NULL, NULL, NULL, ARRAY['enterprise'], 'agreements.enabled', 35),

-- ADD-ONS (pagables independiente) ----------------------------------
('face_recognition',    'Check-in con rostro', 'Identificación facial en el kiosk para clientes recurrentes.',   'Scan',         'integrations','coming_soon', 'Disponible a partir de Q3 2026. Dejá tu email y te avisamos al lanzar.', '2026-09-01', 1990000, ARRAY['enterprise'], 'face_recognition.enabled', 40),
('email_marketing',     'Email marketing',     'Newsletters y campañas por email con plantillas.',               'Mail',         'messaging', 'coming_soon', 'Estamos integrando Resend. ¡Próximamente!', '2026-08-01', 0, ARRAY[]::TEXT[], 'email.enabled', 41),
('pos_mp_point',        'POS Mercado Pago Point','Cobrá con el lector físico de Mercado Pago.',                  'CreditCard',   'integrations','coming_soon', 'Integración en desarrollo con Mercado Pago Point.', '2026-10-01', 0, ARRAY[]::TEXT[], 'pos.mp_point', 42),

-- HIDDEN (solo visible a super-admin, se activa cuando haga falta)
('multilang_pt',        'Multi-idioma (pt-BR)','Soporte de dashboard y app en portugués de Brasil.',             'Languages',    'platform', 'hidden', NULL, NULL, NULL, ARRAY[]::TEXT[], 'i18n.pt_br', 99)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  teaser_copy = EXCLUDED.teaser_copy,
  estimated_release = EXCLUDED.estimated_release,
  price_ars_addon = EXCLUDED.price_ars_addon,
  included_in_plans = EXCLUDED.included_in_plans,
  feature_key = EXCLUDED.feature_key,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
