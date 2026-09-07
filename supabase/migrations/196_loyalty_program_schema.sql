-- ============================================================================
-- 196 — Programa de fidelización Monaco: ESQUEMA
-- ============================================================================
-- Spec: sistema-de-puntos-monaco.md (dueño, 30/ago/2026).
--
-- Punto de partida verificado en prod: `point_transactions` y `client_points`
-- con CERO filas (nunca se acreditó un punto), `rewards_config` vacía. No hay
-- nada que migrar: se construye el modelo nuevo sobre las tablas existentes.
--
-- Modelo en una línea: la CATEGORÍA mide frecuencia reciente (visitas en una
-- ventana móvil, con gracia para bajar); los PUNTOS son capacidad de canje y
-- viven en LOTES con vencimiento propio que se consumen FEFO. Los dos son
-- independientes y TODO se configura por org desde el dashboard.
--
-- Esta migración es sólo DDL + seed. La lógica (funciones, triggers, cron)
-- va en la 197: los valores nuevos de un enum no se pueden usar en la misma
-- transacción que los crea.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Configuración por organización
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_settings (
  organization_id                  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_enabled                       boolean NOT NULL DEFAULT false,
  program_started_at               timestamptz,
  window_weeks                     integer NOT NULL DEFAULT 12 CHECK (window_weeks BETWEEN 1 AND 104),
  grace_days                       integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 365),
  base_points                      integer NOT NULL DEFAULT 100 CHECK (base_points BETWEEN 0 AND 100000),
  points_expiry_days               integer NOT NULL DEFAULT 120 CHECK (points_expiry_days BETWEEN 1 AND 3650),
  welcome_bonus_points             integer NOT NULL DEFAULT 100 CHECK (welcome_bonus_points BETWEEN 0 AND 100000),
  reward_validity_days             integer NOT NULL DEFAULT 30 CHECK (reward_validity_days BETWEEN 1 AND 365),
  expiring_soon_days               integer NOT NULL DEFAULT 14 CHECK (expiring_soon_days BETWEEN 1 AND 90),
  referral_enabled                 boolean NOT NULL DEFAULT true,
  referral_new_client_discount_pct integer NOT NULL DEFAULT 20 CHECK (referral_new_client_discount_pct BETWEEN 0 AND 100),
  referral_new_client_points       integer NOT NULL DEFAULT 100 CHECK (referral_new_client_points BETWEEN 0 AND 100000),
  referral_referrer_points         integer NOT NULL DEFAULT 150 CHECK (referral_referrer_points BETWEEN 0 AND 100000),
  referral_valid_from              timestamptz,
  referral_valid_until             timestamptz,
  referral_max_per_referrer        integer CHECK (referral_max_per_referrer IS NULL OR referral_max_per_referrer > 0),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.loyalty_settings IS 'Parámetros del programa de fidelización, uno por organización. is_enabled arranca en false (multi-tenant safe).';
COMMENT ON COLUMN public.loyalty_settings.program_started_at IS 'Desde cuándo se acreditan puntos. Las visitas anteriores sólo definen la categoría inicial.';

-- ----------------------------------------------------------------------------
-- 2. Categorías (4 por org, rangos contiguos de visitas en la ventana)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code IN ('bronce','plata','oro','platinum')),
  name             text NOT NULL,
  sort_order       integer NOT NULL CHECK (sort_order BETWEEN 1 AND 4),
  min_visits       integer NOT NULL CHECK (min_visits >= 0),
  max_visits       integer CHECK (max_visits IS NULL OR max_visits >= min_visits),
  multiplier_pct   integer NOT NULL DEFAULT 100 CHECK (multiplier_pct BETWEEN 100 AND 500),
  color_primary    text NOT NULL,
  color_secondary  text NOT NULL,
  text_color       text NOT NULL DEFAULT '#FFFFFF',
  benefits         text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, sort_order)
);
COMMENT ON TABLE public.loyalty_tiers IS 'Categorías del programa. max_visits NULL = sin tope (la más alta). Los rangos contiguos los valida el server action que reescribe las 4 juntas.';

-- ----------------------------------------------------------------------------
-- 3. Reglas de notificación (texto, activación, anticipación)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_notification_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN (
                     'tier_up','tier_grace_warning','tier_grace_reminder','tier_down','near_tier',
                     'points_earned','points_expiring','reward_unlocked','near_reward','benefit_new',
                     'referral_completed_referrer','referral_completed_referred')),
  is_enabled       boolean NOT NULL DEFAULT true,
  title            text NOT NULL,
  body             text NOT NULL,
  days_before      integer CHECK (days_before IS NULL OR days_before BETWEEN 0 AND 90),
  deep_link        text,
  sort_order       integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind)
);
COMMENT ON TABLE public.loyalty_notification_rules IS 'Una fila por tipo de notificación del programa. Variables: {{nombre}} {{categoria}} {{categoria_siguiente}} {{multiplicador}} {{puntos}} {{saldo}} {{dias}} {{fecha}} {{premio}} {{faltan}} {{visitas}} {{nombre_amigo}}.';

-- ----------------------------------------------------------------------------
-- 4. Historial / auditoría del programa (y dedupe de notificaciones)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  visit_id         uuid,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_client ON public.loyalty_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_org_kind ON public.loyalty_events (organization_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_notif_key ON public.loyalty_events (client_id, (data->>'key')) WHERE kind = 'notification_sent';
COMMENT ON TABLE public.loyalty_events IS 'Todo lo que le pasa a un cliente en el programa (subidas, bajas, gracia, puntos, canjes, referidos, reversiones, errores). Es el historial que ve el dashboard y la llave de dedupe de las notificaciones.';

-- ----------------------------------------------------------------------------
-- 5. Estado de categoría por cliente (extiende la tabla existente)
-- ----------------------------------------------------------------------------
ALTER TABLE public.client_loyalty_state
  ADD COLUMN IF NOT EXISTS tier_code          text CHECK (tier_code IS NULL OR tier_code IN ('bronce','plata','oro','platinum')),
  ADD COLUMN IF NOT EXISTS tier_sort          integer,
  ADD COLUMN IF NOT EXISTS visits_in_window   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier_reached_at    timestamptz,
  ADD COLUMN IF NOT EXISTS grace_until        timestamptz,
  ADD COLUMN IF NOT EXISTS enrolled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_bonus_tx_id uuid,
  ADD COLUMN IF NOT EXISTS last_recalc_at     timestamptz;
CREATE INDEX IF NOT EXISTS idx_client_loyalty_state_org_tier ON public.client_loyalty_state (organization_id, tier_code) WHERE tier_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_loyalty_state_grace ON public.client_loyalty_state (grace_until) WHERE grace_until IS NOT NULL;
COMMENT ON COLUMN public.client_loyalty_state.grace_until IS 'Si no es NULL, el cliente dejó de cumplir su categoría y tiene hasta esta fecha para recuperarla antes de bajar un escalón.';

-- ----------------------------------------------------------------------------
-- 6. Movimientos de puntos = LOTES con vencimiento propio
-- ----------------------------------------------------------------------------
-- `type` pasa de enum (earned|redeemed) a text con CHECK: la tabla está vacía
-- y el enum obligaría a partir esta migración en tres.
ALTER TABLE public.point_transactions
  ALTER COLUMN type TYPE text USING type::text;
ALTER TABLE public.point_transactions DROP CONSTRAINT IF EXISTS point_transactions_type_check;
ALTER TABLE public.point_transactions
  ADD CONSTRAINT point_transactions_type_check CHECK (type IN (
    'earned','welcome_bonus','referral_referrer','referral_referred','manual_adjust',
    'redeemed','expired','reversal'));

ALTER TABLE public.point_transactions
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS remaining    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS branch_id    uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reversed_by  uuid REFERENCES public.point_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses     uuid REFERENCES public.point_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.point_transactions DROP CONSTRAINT IF EXISTS point_transactions_remaining_check;
ALTER TABLE public.point_transactions
  ADD CONSTRAINT point_transactions_remaining_check CHECK (remaining >= 0 AND remaining <= GREATEST(points, 0));

-- Saldo = SUM(remaining) de lotes vivos: este índice es el que lo sirve.
CREATE INDEX IF NOT EXISTS idx_point_tx_client_live
  ON public.point_transactions (client_id, expires_at) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS idx_point_tx_client_created
  ON public.point_transactions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_expiring
  ON public.point_transactions (expires_at) WHERE remaining > 0;
-- Una sola acreditación viva por visita: es lo que hace idempotente al trigger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_point_tx_one_earned_per_visit
  ON public.point_transactions (visit_id) WHERE type = 'earned' AND reversed_by IS NULL;
COMMENT ON COLUMN public.point_transactions.remaining IS 'Puntos del lote todavía no consumidos ni vencidos. Sólo tiene sentido en movimientos positivos; en los negativos es 0.';
COMMENT ON COLUMN public.point_transactions.expires_at IS 'Vencimiento propio del lote (generado + points_expiry_days). NULL en movimientos negativos.';

-- Qué lotes consumió cada canje (para revertir y auditar FEFO).
CREATE TABLE IF NOT EXISTS public.point_lot_consumptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_tx_id  uuid NOT NULL REFERENCES public.point_transactions(id) ON DELETE CASCADE,
  lot_tx_id         uuid NOT NULL REFERENCES public.point_transactions(id) ON DELETE CASCADE,
  points            integer NOT NULL CHECK (points > 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_lot_consumptions_redemption ON public.point_lot_consumptions (redemption_tx_id);
CREATE INDEX IF NOT EXISTS idx_point_lot_consumptions_lot ON public.point_lot_consumptions (lot_tx_id);

-- ----------------------------------------------------------------------------
-- 7. Catálogo de premios (extiende)
-- ----------------------------------------------------------------------------
ALTER TABLE public.reward_catalog
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'descuento' CHECK (kind IN ('descuento','merch','especial')),
  ADD COLUMN IF NOT EXISTS service_id      uuid REFERENCES public.services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allowed_tiers   text[],
  ADD COLUMN IF NOT EXISTS allow_stacking  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured     boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.reward_catalog.kind IS 'descuento = % sobre el precio vigente del servicio (100 = gratis) · merch = producto físico con stock, se entrega en el local · especial = beneficio sin descuento automático.';
COMMENT ON COLUMN public.reward_catalog.allowed_tiers IS 'NULL = todas las categorías. Si no, códigos de tier habilitados (ej. {oro,platinum}).';
COMMENT ON COLUMN public.reward_catalog.service_id IS 'Servicio al que aplica el descuento. NULL = cualquiera.';
COMMENT ON COLUMN public.reward_catalog.allow_stacking IS 'Permite combinar con otro beneficio en el mismo cobro. Default NO (spec §6).';
CREATE INDEX IF NOT EXISTS idx_reward_catalog_org_active ON public.reward_catalog (organization_id, is_active, sort_order, points_cost);

-- Los que ya existían como "cortes" pasan a kind descuento (ya es el default);
-- los de puntos sin descuento son merch.
UPDATE public.reward_catalog
   SET kind = 'merch'
 WHERE kind = 'descuento' AND NOT is_free_service AND COALESCE(discount_pct, 0) = 0 AND points_cost > 0;

-- ----------------------------------------------------------------------------
-- 8. Beneficios canjeados (extiende)
-- ----------------------------------------------------------------------------
ALTER TYPE public.client_reward_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.client_rewards
  ADD COLUMN IF NOT EXISTS points_spent      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redemption_tx_id  uuid REFERENCES public.point_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason     text,
  ADD COLUMN IF NOT EXISTS delivered_by      uuid REFERENCES public.staff(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_rewards_client_status ON public.client_rewards (client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_rewards_expiring ON public.client_rewards (expires_at) WHERE status = 'available';

-- ----------------------------------------------------------------------------
-- 9. Referidos
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS referral_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_referral_code ON public.clients (referral_code) WHERE referral_code IS NOT NULL;
COMMENT ON COLUMN public.clients.referral_code IS 'Código personal de recomendación (8 chars, sin caracteres ambiguos). Lo genera get_my_referral_code() la primera vez que el cliente abre "Invitá a un amigo". El QR lleva MNC-REF:<código>.';

CREATE TABLE IF NOT EXISTS public.referrals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  referrer_client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referred_client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visit_id              uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  branch_id             uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  service_id            uuid REFERENCES public.services(id) ON DELETE SET NULL,
  scanned_by_staff_id   uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected','cancelled')),
  discount_pct          integer NOT NULL DEFAULT 0,
  discount_amount       numeric NOT NULL DEFAULT 0,
  referred_points       integer NOT NULL DEFAULT 0,
  referrer_points       integer NOT NULL DEFAULT 0,
  referred_tx_id        uuid REFERENCES public.point_transactions(id) ON DELETE SET NULL,
  referrer_tx_id        uuid REFERENCES public.point_transactions(id) ON DELETE SET NULL,
  rejection_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  CHECK (referrer_client_id <> referred_client_id)
);
-- Un cliente nuevo sólo puede ser referido UNA vez (spec §7 seguridad).
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_one_per_referred
  ON public.referrals (referred_client_id) WHERE status IN ('pending','completed');
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_visit ON public.referrals (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_org ON public.referrals (organization_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 10. Servicios: cuáles cuentan como visita
-- ----------------------------------------------------------------------------
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS counts_as_visit boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.services.counts_as_visit IS 'Si el servicio principal de una atención cuenta como visita para la categoría (spec §2). Los productos nunca cuentan.';

-- Visitas del cliente en la ventana móvil: hoy no había índice (client_id, completed_at).
CREATE INDEX IF NOT EXISTS idx_visits_client_completed ON public.visits (client_id, completed_at DESC) WHERE client_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 11. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.loyalty_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_tiers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_lot_consumptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals                  ENABLE ROW LEVEL SECURITY;

-- Las categorías son información pública del programa (nombre, rango, color):
-- la lee la tablet del barbero (anon + PIN) y la app.
DROP POLICY IF EXISTS loyalty_tiers_public_read ON public.loyalty_tiers;
CREATE POLICY loyalty_tiers_public_read ON public.loyalty_tiers FOR SELECT USING (is_active);

-- Settings: sólo el dashboard (service role) y la propia org autenticada.
DROP POLICY IF EXISTS loyalty_settings_org_read ON public.loyalty_settings;
CREATE POLICY loyalty_settings_org_read ON public.loyalty_settings FOR SELECT
  USING (organization_id = public.get_user_org_id());

-- El cliente ve SU historial y SUS referidos (como recomendador o como referido).
DROP POLICY IF EXISTS loyalty_events_client_read ON public.loyalty_events;
CREATE POLICY loyalty_events_client_read ON public.loyalty_events FOR SELECT
  USING (client_id = public.current_client_id() AND kind <> 'error');
DROP POLICY IF EXISTS referrals_client_read ON public.referrals;
CREATE POLICY referrals_client_read ON public.referrals FOR SELECT
  USING (referrer_client_id = public.current_client_id() OR referred_client_id = public.current_client_id());

-- point_lot_consumptions y loyalty_notification_rules: sólo service_role (sin policies).

-- ----------------------------------------------------------------------------
-- 12. Datos: los dos premios activos de Monaco tenían valid_until vencido
--     "cargado por error" (CLAUDE.md, 24/ago). Se libera la vigencia para que
--     el catálogo no arranque vacío; la fecha real la pone el dueño.
-- ----------------------------------------------------------------------------
UPDATE public.reward_catalog
   SET valid_until = NULL
 WHERE organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
   AND is_active AND points_cost > 0 AND valid_until IS NOT NULL AND valid_until < now();
