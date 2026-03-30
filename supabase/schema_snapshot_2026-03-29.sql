-- ============================================================
-- SNAPSHOT COMPLETO DEL SCHEMA DE PRODUCCIÓN
-- Fecha: 2026-03-29
-- Proyecto: Monaco Smart Barber (gzsfoqpxvnwmvngfoqqk)
-- Propósito: Backup antes de migración multi-tenant
-- ============================================================

-- ============================================================
-- 1. ENUMS
-- ============================================================

CREATE TYPE public.attendance_action AS ENUM ('clock_in', 'clock_out');
CREATE TYPE public.break_request_status AS ENUM ('pending', 'approved', 'rejected', 'completed');
CREATE TYPE public.client_reward_status AS ENUM ('available', 'redeemed', 'expired');
CREATE TYPE public.consequence_type AS ENUM ('none', 'presentismo_loss', 'warning', 'incentive_loss', 'salary_deduction');
CREATE TYPE public.crm_case_status AS ENUM ('open', 'contacted', 'resolved', 'dismissed');
CREATE TYPE public.disciplinary_event_type AS ENUM ('absence', 'late');
CREATE TYPE public.incentive_metric AS ENUM ('haircut_count', 'content_post', 'custom');
CREATE TYPE public.incentive_period AS ENUM ('weekly', 'monthly');
CREATE TYPE public.occupancy_level AS ENUM ('baja', 'media', 'alta', 'sin_espera');
CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'transfer');
CREATE TYPE public.point_tx_type AS ENUM ('earned', 'redeemed');
CREATE TYPE public.queue_status AS ENUM ('waiting', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.review_rating_category AS ENUM ('high', 'improvement', 'low');
CREATE TYPE public.review_request_status AS ENUM ('pending', 'completed', 'expired');
CREATE TYPE public.reward_type AS ENUM ('spin_prize', 'return_discount', 'milestone_free', 'manual', 'points_redemption');
CREATE TYPE public.salary_scheme AS ENUM ('fixed', 'commission', 'hybrid');
CREATE TYPE public.service_availability AS ENUM ('checkin', 'upsell', 'both');
CREATE TYPE public.staff_status AS ENUM ('available');
CREATE TYPE public.user_role AS ENUM ('owner', 'admin', 'receptionist', 'barber');

-- ============================================================
-- 2. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_delay_minutes integer NOT NULL DEFAULT 15,
  review_auto_send boolean NOT NULL DEFAULT false,
  shift_end_margin_minutes integer NOT NULL DEFAULT 35,
  business_hours_close time without time zone NOT NULL DEFAULT '21:00:00'::time without time zone,
  business_hours_open time without time zone NOT NULL DEFAULT '09:00:00'::time without time zone,
  next_client_alert_minutes integer NOT NULL DEFAULT 5,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  dynamic_cooldown_seconds integer NOT NULL DEFAULT 60,
  checkin_bg_color text NOT NULL DEFAULT 'graphite'::text,
  wa_api_url text,
  review_message_template text DEFAULT '¡Hola {nombre}! Gracias por visitarnos en Monaco Smart Barber 💈. Nos encantaría saber qué te pareció tu experiencia. Dejanos tu opinión acá: {link_resena} ⭐'::text,
  at_risk_client_days integer NOT NULL DEFAULT 25,
  lost_client_days integer NOT NULL DEFAULT 40,
  business_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}'::integer[],
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.branches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  google_review_url text,
  timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'::text,
  checkin_bg_color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  business_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}'::integer[],
  business_hours_close time without time zone NOT NULL DEFAULT '21:00:00'::time without time zone,
  business_hours_open time without time zone NOT NULL DEFAULT '09:00:00'::time without time zone,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  pin text,
  avatar_url text,
  auth_user_id uuid,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  role user_role NOT NULL,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  commission_pct numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  status staff_status NOT NULL DEFAULT 'available'::staff_status,
  hidden_from_checkin boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  notes text,
  instagram text,
  face_photo_url text,
  face_embedding vector,
  auth_user_id uuid,
  pin_hash text,
  onboarding_spin_used_at timestamp with time zone,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL,
  duration_minutes integer,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  default_commission_pct numeric NOT NULL DEFAULT 0,
  availability service_availability NOT NULL DEFAULT 'both'::service_availability,
  points_per_service integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.queue_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  barber_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id),
  break_request_id uuid,
  status queue_status NOT NULL DEFAULT 'waiting'::queue_status,
  position integer NOT NULL,
  checked_in_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  reward_claimed boolean NOT NULL DEFAULT false,
  is_break boolean DEFAULT false,
  is_dynamic boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.visits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  barber_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  queue_entry_id uuid REFERENCES public.queue_entries(id) ON DELETE SET NULL,
  payment_account_id uuid,
  amount numeric NOT NULL,
  commission_pct numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  payment_method payment_method NOT NULL DEFAULT 'cash'::payment_method,
  started_at timestamp with time zone NOT NULL,
  completed_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  tags text[],
  notes text,
  extra_services uuid[] DEFAULT '{}'::uuid[],
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  action_type attendance_action NOT NULL,
  face_verified boolean NOT NULL DEFAULT false,
  notes text,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.billboard_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  image_url text,
  bg_color text,
  link_type text,
  link_value text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.branch_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  queue_size integer NOT NULL DEFAULT 0,
  active_barbers integer NOT NULL DEFAULT 0,
  waiting_count integer NOT NULL DEFAULT 0,
  available_barbers integer NOT NULL DEFAULT 0,
  eta_minutes integer,
  best_arrival_in_minutes integer,
  suggestion_text text,
  occupancy_level occupancy_level NOT NULL DEFAULT 'baja'::occupancy_level,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (branch_id)
);

CREATE TABLE IF NOT EXISTS public.break_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  scheduled_time time without time zone,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.break_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  break_config_id uuid NOT NULL REFERENCES public.break_configs(id),
  status break_request_status NOT NULL DEFAULT 'pending'::break_request_status,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.staff(id),
  approved_at timestamp with time zone,
  actual_started_at timestamp with time zone,
  actual_completed_at timestamp with time zone,
  overtime_seconds integer DEFAULT 0,
  cuts_before_break integer DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_device_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL,
  device_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_face_descriptors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  descriptor vector NOT NULL,
  quality_score real DEFAULT 0,
  source text NOT NULL DEFAULT 'checkin'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  title text NOT NULL,
  description text,
  target_value integer NOT NULL,
  current_value integer NOT NULL DEFAULT 0,
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamp with time zone,
  reward_id uuid REFERENCES public.reward_catalog(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_loyalty_state (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  total_visits integer NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  last_visit_at timestamp with time zone,
  next_milestone_at integer NOT NULL DEFAULT 10,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (client_id)
);

CREATE TABLE IF NOT EXISTS public.client_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  review_request_id uuid REFERENCES public.review_requests(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_points (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  points_balance integer NOT NULL DEFAULT 0,
  total_earned integer NOT NULL DEFAULT 0,
  total_redeemed integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (client_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.client_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_request_id uuid NOT NULL REFERENCES public.review_requests(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  rating smallint NOT NULL,
  category review_rating_category NOT NULL,
  improvement_categories text[],
  comment text,
  redirected_to_google boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.reward_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type reward_type NOT NULL,
  points_cost integer NOT NULL DEFAULT 0,
  discount_pct integer,
  is_free_service boolean NOT NULL DEFAULT false,
  image_url text,
  stock integer,
  spin_probability numeric,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamp with time zone DEFAULT now(),
  valid_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_rewards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  reward_id uuid NOT NULL REFERENCES public.reward_catalog(id),
  source reward_type NOT NULL,
  status client_reward_status NOT NULL DEFAULT 'available'::client_reward_status,
  qr_code text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'::text),
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  redeemed_at timestamp with time zone,
  redeemed_by uuid REFERENCES public.staff(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.review_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  barber_id uuid REFERENCES public.staff(id),
  token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'::text),
  status review_request_status NOT NULL DEFAULT 'pending'::review_request_status,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.crm_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.client_reviews(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  status crm_case_status NOT NULL DEFAULT 'open'::crm_case_status,
  internal_notes text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.disciplinary_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  event_type disciplinary_event_type NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  occurrence_number integer NOT NULL DEFAULT 1,
  consequence_applied consequence_type,
  deduction_amount numeric,
  notes text,
  source text NOT NULL DEFAULT 'manual'::text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.disciplinary_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  event_type disciplinary_event_type NOT NULL,
  occurrence_number integer NOT NULL,
  consequence consequence_type NOT NULL DEFAULT 'none'::consequence_type,
  deduction_amount numeric,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.payment_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  alias_or_cbu text,
  daily_limit numeric,
  accumulated_today numeric DEFAULT 0,
  last_reset_date date DEFAULT CURRENT_DATE,
  sort_order integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.expense_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  category text NOT NULL,
  amount numeric NOT NULL,
  description text,
  receipt_url text,
  expense_date date DEFAULT CURRENT_DATE,
  payment_account_id uuid REFERENCES public.payment_accounts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.staff(id),
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.fixed_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  category text,
  due_day smallint,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.incentive_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  metric incentive_metric NOT NULL DEFAULT 'haircut_count'::incentive_metric,
  threshold numeric NOT NULL,
  reward_amount numeric NOT NULL,
  period incentive_period NOT NULL DEFAULT 'monthly'::incentive_period,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.incentive_achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.incentive_rules(id) ON DELETE CASCADE,
  period_label text NOT NULL,
  amount_earned numeric NOT NULL,
  notes text,
  achieved_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.point_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  points integer NOT NULL,
  type point_tx_type NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  name text NOT NULL,
  sale_price numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  barber_commission numeric NOT NULL DEFAULT 0,
  stock integer,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.product_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  barber_id uuid NOT NULL REFERENCES public.staff(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  visit_id uuid REFERENCES public.visits(id),
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  commission_amount numeric NOT NULL DEFAULT 0,
  payment_method payment_method NOT NULL DEFAULT 'cash'::payment_method,
  sold_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.rewards_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  reward_description text NOT NULL DEFAULT 'Corte gratis'::text,
  points_per_visit integer NOT NULL DEFAULT 1,
  redemption_threshold integer NOT NULL DEFAULT 10,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.role_branch_scope (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.salary_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  scheme salary_scheme NOT NULL DEFAULT 'fixed'::salary_scheme,
  base_amount numeric NOT NULL DEFAULT 0,
  commission_pct numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.salary_payment_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  paid_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.salary_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  calculated_amount numeric NOT NULL DEFAULT 0,
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.salary_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.salary_payment_batches(id) ON DELETE SET NULL,
  type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  period_start date,
  period_end date,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.service_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.social_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_account_id text NOT NULL,
  platform_business_id text,
  display_name text NOT NULL,
  access_token text,
  webhook_verify_token text,
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.social_channels(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  platform_conversation_id text,
  platform_user_id text NOT NULL,
  platform_user_name text,
  status text DEFAULT 'open'::text,
  unread_count integer DEFAULT 0,
  can_reply_until timestamp with time zone,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  content text,
  content_type text DEFAULT 'text'::text,
  media_url text,
  platform_message_id text,
  template_name text,
  template_params jsonb,
  sent_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  status text DEFAULT 'pending'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.social_channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  language text DEFAULT 'es_AR'::text,
  components jsonb,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.social_channels(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  phone text,
  content text,
  template_params jsonb,
  scheduled_for timestamp with time zone NOT NULL,
  status text DEFAULT 'pending'::text,
  sent_at timestamp with time zone,
  error_message text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.staff_face_descriptors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  descriptor vector NOT NULL,
  quality_score real DEFAULT 0,
  source text DEFAULT 'checkin'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.staff_schedule_exceptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_absent boolean NOT NULL DEFAULT true,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL,
  block_index smallint NOT NULL DEFAULT 0,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.staff_service_commissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  commission_pct numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.transfer_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  payment_account_id uuid NOT NULL REFERENCES public.payment_accounts(id),
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  transferred_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.visit_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.qr_photo_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.qr_photo_uploads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.qr_photo_sessions(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

-- ============================================================
-- 3. VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.branch_occupancy AS
SELECT b.id AS branch_id,
    b.name AS branch_name,
    count(CASE WHEN (qe.status = 'waiting'::queue_status) THEN 1 ELSE NULL::integer END) AS clients_waiting,
    count(CASE WHEN (qe.status = 'in_progress'::queue_status) THEN 1 ELSE NULL::integer END) AS clients_in_progress,
    ( SELECT count(*) AS count
           FROM staff s
          WHERE ((s.branch_id = b.id) AND (s.role = 'barber'::user_role) AND (s.is_active = true) AND (s.hidden_from_checkin IS DISTINCT FROM true) AND (( SELECT al.action_type
                   FROM attendance_logs al
                  WHERE ((al.staff_id = s.id) AND (((al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date = ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date))
                  ORDER BY al.recorded_at DESC
                 LIMIT 1) IS DISTINCT FROM 'clock_out'::attendance_action))) AS total_barbers,
    ( SELECT count(*) AS count
           FROM staff s
          WHERE ((s.branch_id = b.id) AND (s.role = 'barber'::user_role) AND (s.is_active = true) AND (s.hidden_from_checkin IS DISTINCT FROM true) AND (s.status = 'available'::staff_status) AND (NOT (s.id IN ( SELECT qe2.barber_id
                   FROM queue_entries qe2
                  WHERE ((qe2.branch_id = b.id) AND (qe2.status = 'in_progress'::queue_status) AND (qe2.barber_id IS NOT NULL))))) AND (( SELECT al.action_type
                   FROM attendance_logs al
                  WHERE ((al.staff_id = s.id) AND (((al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date = ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date))
                  ORDER BY al.recorded_at DESC
                 LIMIT 1) IS DISTINCT FROM 'clock_out'::attendance_action))) AS available_barbers
   FROM (branches b
     LEFT JOIN queue_entries qe ON (((qe.branch_id = b.id) AND (qe.status = ANY (ARRAY['waiting'::queue_status, 'in_progress'::queue_status])) AND (((qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date = ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date))))
  WHERE (b.is_active = true)
  GROUP BY b.id, b.name;

-- ============================================================
-- 4. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_attendance_branch ON public.attendance_logs USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_recorded ON public.attendance_logs USING btree (recorded_at);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.attendance_logs USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_billboard_active ON public.billboard_items USING btree (is_active, sort_order) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_billboard_branch ON public.billboard_items USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_break_configs_branch ON public.break_configs USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_break_requests_branch_status ON public.break_requests USING btree (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_break_requests_staff ON public.break_requests USING btree (staff_id, status);
CREATE INDEX IF NOT EXISTS idx_client_notifications_unread ON public.client_notifications USING btree (client_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients USING btree (phone);
CREATE INDEX IF NOT EXISTS idx_conversations_channel_status ON public.conversations USING btree (channel_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_client ON public.conversations USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active ON public.client_device_tokens USING btree (is_active) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_device_tokens_client ON public.client_device_tokens USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_disciplinary_events_date ON public.disciplinary_events USING btree (event_date);
CREATE INDEX IF NOT EXISTS idx_disciplinary_events_staff ON public.disciplinary_events USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_disciplinary_events_type ON public.disciplinary_events USING btree (staff_id, event_type);
CREATE INDEX IF NOT EXISTS idx_disciplinary_rules_branch ON public.disciplinary_rules USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_face_descriptors_client ON public.client_face_descriptors USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_active ON public.fixed_expenses USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_branch ON public.fixed_expenses USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_incentive_achievements_rule ON public.incentive_achievements USING btree (rule_id);
CREATE INDEX IF NOT EXISTS idx_incentive_achievements_staff ON public.incentive_achievements USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_incentive_rules_branch ON public.incentive_rules USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages USING btree (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_platform_id ON public.messages USING btree (platform_message_id) WHERE (platform_message_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payment_accounts_branch ON public.payment_accounts USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_point_tx_client ON public.point_transactions USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_qr_photo_sessions_token ON public.qr_photo_sessions USING btree (token);
CREATE INDEX IF NOT EXISTS idx_qr_photo_uploads_session ON public.qr_photo_uploads USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_queue_barber ON public.queue_entries USING btree (barber_id);
CREATE INDEX IF NOT EXISTS idx_queue_branch_status ON public.queue_entries USING btree (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_client ON public.queue_entries USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_salary_configs_staff ON public.salary_configs USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_period ON public.salary_payments USING btree (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff ON public.salary_payments USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_date ON public.staff_schedule_exceptions USING btree (exception_date);
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_staff ON public.staff_schedule_exceptions USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending ON public.scheduled_messages USING btree (scheduled_for) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON public.scheduled_messages USING btree (status, scheduled_for) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_services_branch ON public.services USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_spb_branch_id ON public.salary_payment_batches USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_spb_paid_at ON public.salary_payment_batches USING btree (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_spb_staff_id ON public.salary_payment_batches USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_sr_batch_id ON public.salary_reports USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_sr_branch_id ON public.salary_reports USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_sr_report_date ON public.salary_reports USING btree (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_sr_staff_id ON public.salary_reports USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_sr_status ON public.salary_reports USING btree (status);
CREATE INDEX IF NOT EXISTS idx_ssc_service ON public.staff_service_commissions USING btree (service_id);
CREATE INDEX IF NOT EXISTS idx_ssc_staff ON public.staff_service_commissions USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_auth_user ON public.staff USING btree (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_branch ON public.staff USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_role ON public.staff USING btree (role);
CREATE INDEX IF NOT EXISTS idx_staff_role_id ON public.staff USING btree (role_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_day ON public.staff_schedules USING btree (day_of_week);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_staff ON public.staff_schedules USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_visit_photos_visit ON public.visit_photos USING btree (visit_id);
CREATE INDEX IF NOT EXISTS idx_visits_barber ON public.visits USING btree (barber_id);
CREATE INDEX IF NOT EXISTS idx_visits_branch ON public.visits USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_visits_client ON public.visits USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_visits_completed ON public.visits USING btree (completed_at);

-- ============================================================
-- 5. FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_roles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.next_queue_position(p_branch_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  max_pos INTEGER;
BEGIN
  SELECT COALESCE(MAX(position), 0) INTO max_pos
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status IN ('waiting', 'in_progress')
    AND DATE(checked_in_at) = CURRENT_DATE;
  RETURN max_pos + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_queue_completed()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_commission NUMERIC(5,2);
  v_visit_id UUID;
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_service_points INTEGER;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);
    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, 0, v_commission, 0, NEW.started_at, NEW.completed_at)
    RETURNING id INTO v_visit_id;
    v_service_points := 0;
    IF NEW.service_id IS NOT NULL THEN
      SELECT COALESCE(points_per_service, 0) INTO v_service_points FROM services WHERE id = NEW.service_id;
    END IF;
    IF v_service_points > 0 THEN
      v_points := v_service_points;
      v_reward_active := true;
    ELSE
      SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
      FROM rewards_config rw
      WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL) AND rw.is_active = true
      LIMIT 1;
    END IF;
    IF v_reward_active IS TRUE AND v_points > 0 AND NEW.client_id IS NOT NULL THEN
      INSERT INTO client_points (client_id, branch_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_points, v_points)
      ON CONFLICT (client_id, branch_id) DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;
      INSERT INTO point_transactions (client_id, visit_id, points, type, description)
      VALUES (NEW.client_id, v_visit_id, v_points, 'earned', 'Puntos por visita');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_barber_salary(p_staff_id uuid, p_period_start date, p_period_end date)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_scheme salary_scheme;
  v_base NUMERIC(12,2);
  v_commission_pct NUMERIC(5,2);
  v_total_billed NUMERIC(12,2);
  v_commission_earned NUMERIC(12,2);
  v_result NUMERIC(12,2);
BEGIN
  SELECT scheme, base_amount, commission_pct INTO v_scheme, v_base, v_commission_pct
  FROM salary_configs WHERE staff_id = p_staff_id;
  IF NOT FOUND THEN
    SELECT commission_pct INTO v_commission_pct FROM staff WHERE id = p_staff_id;
    v_scheme := 'commission'; v_base := 0;
  END IF;
  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(commission_amount), 0)
  INTO v_total_billed, v_commission_earned
  FROM visits WHERE barber_id = p_staff_id AND completed_at::date BETWEEN p_period_start AND p_period_end;
  v_result := CASE v_scheme
    WHEN 'fixed' THEN v_base
    WHEN 'commission' THEN v_commission_earned
    WHEN 'hybrid' THEN GREATEST(v_base, v_commission_earned)
    ELSE v_base END;
  RETURN COALESCE(v_result, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_commission_report(p_staff_id uuid, p_branch_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_commission NUMERIC(12,2);
  v_report_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff_id AND role = 'barber'::user_role) THEN
    RAISE EXCEPTION 'El staff_id % no existe o no es barbero', p_staff_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'La branch_id % no existe', p_branch_id;
  END IF;
  SELECT id INTO v_report_id FROM salary_reports WHERE staff_id = p_staff_id AND report_date = p_date AND type = 'commission';
  IF v_report_id IS NOT NULL THEN RETURN v_report_id; END IF;
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_commission
  FROM visits WHERE barber_id = p_staff_id AND branch_id = p_branch_id AND completed_at::date = p_date;
  IF v_total_commission <= 0 THEN RETURN NULL; END IF;
  INSERT INTO salary_reports (staff_id, branch_id, type, amount, report_date, notes)
  VALUES (p_staff_id, p_branch_id, 'commission', v_total_commission, p_date, 'Comision auto-generada para ' || to_char(p_date, 'DD/MM/YYYY'))
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_salary_reports(p_report_ids uuid[], p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff_id UUID; v_branch_id UUID; v_total NUMERIC(12,2); v_batch_id UUID; v_count INT;
BEGIN
  IF array_length(p_report_ids, 1) IS NULL OR array_length(p_report_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debe proporcionar al menos un reporte para pagar';
  END IF;
  SELECT COUNT(DISTINCT sr.staff_id), MIN(sr.staff_id), MIN(sr.branch_id)
  INTO v_count, v_staff_id, v_branch_id FROM salary_reports sr
  WHERE sr.id = ANY(p_report_ids) AND sr.status = 'pending';
  IF v_count = 0 THEN RAISE EXCEPTION 'No se encontraron reportes pendientes'; END IF;
  IF v_count > 1 THEN RAISE EXCEPTION 'Todos los reportes deben pertenecer al mismo barbero'; END IF;
  SELECT COUNT(*) INTO v_count FROM salary_reports WHERE id = ANY(p_report_ids) AND status = 'pending';
  IF v_count != array_length(p_report_ids, 1) THEN RAISE EXCEPTION 'Algunos reportes no existen o ya fueron pagados'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM salary_reports WHERE id = ANY(p_report_ids);
  INSERT INTO salary_payment_batches (staff_id, branch_id, total_amount, notes) VALUES (v_staff_id, v_branch_id, v_total, p_notes) RETURNING id INTO v_batch_id;
  UPDATE salary_reports SET status = 'paid', batch_id = v_batch_id WHERE id = ANY(p_report_ids);
  RETURN v_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_client_points(p_client_id uuid, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r RECORD; remaining INTEGER := p_amount;
BEGIN
  FOR r IN SELECT id, points_balance FROM client_points WHERE client_id = p_client_id AND points_balance > 0 ORDER BY points_balance DESC
  LOOP
    IF remaining <= 0 THEN EXIT; END IF;
    IF r.points_balance >= remaining THEN
      UPDATE client_points SET points_balance = points_balance - remaining, total_redeemed = total_redeemed + remaining WHERE id = r.id;
      remaining := 0;
    ELSE
      remaining := remaining - r.points_balance;
      UPDATE client_points SET total_redeemed = total_redeemed + points_balance, points_balance = 0 WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_points_for_reward(p_reward_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client clients%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_total_points INTEGER; v_client_reward_id UUID;
BEGIN
  SELECT * INTO v_client FROM clients WHERE auth_user_id = auth.uid();
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  SELECT * INTO v_reward FROM reward_catalog WHERE id = p_reward_id AND is_active = true AND points_cost > 0;
  IF v_reward IS NULL THEN RETURN json_build_object('success', false, 'error', 'Reward not available'); END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN RETURN json_build_object('success', false, 'error', 'Out of stock'); END IF;
  SELECT COALESCE(SUM(points_balance), 0) INTO v_total_points FROM client_points WHERE client_id = v_client.id;
  IF v_total_points < v_reward.points_cost THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient points', 'required', v_reward.points_cost, 'available', v_total_points);
  END IF;
  PERFORM deduct_client_points(v_client.id, v_reward.points_cost);
  INSERT INTO client_rewards (client_id, reward_id, source) VALUES (v_client.id, p_reward_id, 'points_redemption') RETURNING id INTO v_client_reward_id;
  INSERT INTO point_transactions (client_id, points, type, description) VALUES (v_client.id, -v_reward.points_cost, 'redeemed', 'Canje: ' || v_reward.name);
  IF v_reward.stock IS NOT NULL THEN UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0; END IF;
  RETURN json_build_object('success', true, 'reward_name', v_reward.name, 'client_reward_id', v_client_reward_id, 'points_remaining', v_total_points - v_reward.points_cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_reward_by_qr(p_qr_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_staff staff%ROWTYPE; v_reward client_rewards%ROWTYPE; v_catalog reward_catalog%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM staff WHERE auth_user_id = auth.uid();
  IF v_staff IS NULL THEN RETURN json_build_object('success', false, 'error', 'Unauthorized'); END IF;
  SELECT * INTO v_reward FROM client_rewards WHERE qr_code = p_qr_code AND status = 'available';
  IF v_reward IS NULL THEN RETURN json_build_object('success', false, 'error', 'Reward not found or already redeemed'); END IF;
  IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at < now() THEN
    UPDATE client_rewards SET status = 'expired' WHERE id = v_reward.id;
    RETURN json_build_object('success', false, 'error', 'Reward expired');
  END IF;
  UPDATE client_rewards SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_staff.id WHERE id = v_reward.id;
  SELECT * INTO v_catalog FROM reward_catalog WHERE id = v_reward.reward_id;
  RETURN json_build_object('success', true, 'reward_name', v_catalog.name, 'is_free_service', v_catalog.is_free_service, 'discount_pct', v_catalog.discount_pct);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_onboarding_spin(p_reward_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_client clients%ROWTYPE; v_reward reward_catalog%ROWTYPE; v_client_reward_id uuid;
BEGIN
  SELECT * INTO v_client FROM clients WHERE auth_user_id = auth.uid();
  IF v_client IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  IF v_client.onboarding_spin_used_at IS NOT NULL THEN RETURN json_build_object('success', false, 'error', 'Spin already used'); END IF;
  SELECT * INTO v_reward FROM reward_catalog WHERE id = p_reward_id AND is_active = true;
  IF v_reward IS NULL THEN RETURN json_build_object('success', false, 'error', 'Reward not found'); END IF;
  INSERT INTO client_rewards (client_id, reward_id, source) VALUES (v_client.id, p_reward_id, 'spin_prize') RETURNING id INTO v_client_reward_id;
  UPDATE clients SET onboarding_spin_used_at = now() WHERE id = v_client.id;
  IF v_reward.stock IS NOT NULL THEN UPDATE reward_catalog SET stock = stock - 1 WHERE id = p_reward_id AND stock > 0; END IF;
  RETURN json_build_object('success', true, 'reward_name', v_reward.name, 'client_reward_id', v_client_reward_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_available_barbers_today(p_branch_id uuid)
RETURNS TABLE(staff_id uuid) LANGUAGE plpgsql AS $$
DECLARE v_today_dow SMALLINT; v_today DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;
  v_today_dow := EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::SMALLINT;
  RETURN QUERY
  SELECT s.id FROM staff s
  WHERE s.branch_id = p_branch_id AND s.role = 'barber' AND s.is_active = true AND s.hidden_from_checkin = false
    AND EXISTS (SELECT 1 FROM staff_schedules ss WHERE ss.staff_id = s.id AND ss.day_of_week = v_today_dow AND ss.is_active = true)
    AND NOT EXISTS (SELECT 1 FROM staff_schedule_exceptions sse WHERE sse.staff_id = s.id AND sse.exception_date = v_today AND sse.is_absent = true)
    AND (SELECT al.action_type FROM attendance_logs al WHERE al.staff_id = s.id AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today ORDER BY al.recorded_at DESC LIMIT 1) IS DISTINCT FROM 'clock_out'::attendance_action;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_open_status(p_branch_id uuid)
RETURNS TABLE(is_open boolean, opens_at time without time zone, closes_at time without time zone, current_day_of_week integer)
LANGUAGE plpgsql AS $$
DECLARE v_tz TEXT; v_now TIMESTAMPTZ; v_local_time TIME; v_local_dow INTEGER; v_open TIME; v_close TIME; v_days INTEGER[];
BEGIN
  SELECT b.timezone, b.business_hours_open, b.business_hours_close, b.business_days INTO v_tz, v_open, v_close, v_days FROM branches b WHERE b.id = p_branch_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, '00:00'::TIME, '00:00'::TIME, 0; RETURN; END IF;
  v_now := NOW() AT TIME ZONE COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_local_time := v_now::TIME; v_local_dow := EXTRACT(DOW FROM v_now)::INTEGER;
  RETURN QUERY SELECT (v_local_dow = ANY(v_days) AND v_local_time >= v_open AND v_local_time < v_close), v_open, v_close, v_local_dow;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_branch_signals_for_branch(p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_waiting_count INT; v_in_progress_count INT; v_active_barbers INT; v_available_barbers INT; v_eta INT; v_occupancy occupancy_level; v_today DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;
  SELECT COUNT(*) INTO v_waiting_count FROM queue_entries qe WHERE qe.branch_id = p_branch_id AND qe.status = 'waiting' AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;
  SELECT COUNT(*) INTO v_in_progress_count FROM queue_entries qe WHERE qe.branch_id = p_branch_id AND qe.status = 'in_progress' AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;
  SELECT COUNT(*) INTO v_active_barbers FROM staff s WHERE s.branch_id = p_branch_id AND s.role = 'barber' AND s.is_active = true AND s.hidden_from_checkin = false AND (SELECT al.action_type FROM attendance_logs al WHERE al.staff_id = s.id AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today ORDER BY al.recorded_at DESC LIMIT 1) IS DISTINCT FROM 'clock_out'::attendance_action;
  SELECT COUNT(*) INTO v_available_barbers FROM staff s WHERE s.branch_id = p_branch_id AND s.role = 'barber' AND s.is_active = true AND s.hidden_from_checkin = false AND (SELECT al.action_type FROM attendance_logs al WHERE al.staff_id = s.id AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today ORDER BY al.recorded_at DESC LIMIT 1) IS DISTINCT FROM 'clock_out'::attendance_action AND s.id NOT IN (SELECT qe.barber_id FROM queue_entries qe WHERE qe.branch_id = p_branch_id AND qe.status = 'in_progress' AND qe.barber_id IS NOT NULL);
  v_eta := v_waiting_count * 25;
  IF v_active_barbers = 0 AND v_waiting_count = 0 THEN v_occupancy := 'sin_espera';
  ELSIF v_available_barbers >= 1 THEN v_occupancy := 'sin_espera';
  ELSIF v_waiting_count = 0 THEN v_occupancy := 'baja';
  ELSIF v_waiting_count < (2 * v_active_barbers) THEN v_occupancy := 'media';
  ELSE v_occupancy := 'alta'; END IF;
  INSERT INTO branch_signals (branch_id, queue_size, active_barbers, waiting_count, available_barbers, eta_minutes, occupancy_level, updated_at)
  VALUES (p_branch_id, v_waiting_count + v_in_progress_count, v_active_barbers, v_waiting_count, v_available_barbers, v_eta, v_occupancy, NOW())
  ON CONFLICT (branch_id) DO UPDATE SET queue_size = EXCLUDED.queue_size, active_barbers = EXCLUDED.active_barbers, waiting_count = EXCLUDED.waiting_count, available_barbers = EXCLUDED.available_barbers, eta_minutes = EXCLUDED.eta_minutes, occupancy_level = EXCLUDED.occupancy_level, updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_branch_signals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_branch_id UUID;
BEGIN
  v_branch_id := COALESCE(NEW.branch_id, OLD.branch_id);
  PERFORM refresh_branch_signals_for_branch(v_branch_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_client_loyalty_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO client_loyalty_state (client_id, total_visits, current_streak, last_visit_at)
  VALUES (NEW.client_id, 1, 1, NEW.completed_at)
  ON CONFLICT (client_id) DO UPDATE SET
    total_visits = client_loyalty_state.total_visits + 1,
    current_streak = client_loyalty_state.current_streak + 1,
    last_visit_at = GREATEST(client_loyalty_state.last_visit_at, NEW.completed_at),
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_client_review_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_branch_name TEXT;
BEGIN
  SELECT name INTO v_branch_name FROM branches WHERE id = NEW.branch_id;
  INSERT INTO client_notifications (client_id, type, title, body, data, review_request_id)
  VALUES (NEW.client_id, 'review_request', '¿Cómo fue tu visita?', 'Contanos tu experiencia en ' || COALESCE(v_branch_name, 'Monaco'), jsonb_build_object('token', NEW.token, 'branch_id', NEW.branch_id), NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_client_review(p_token text, p_rating smallint, p_improvement_categories text[] DEFAULT NULL, p_comment text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_request review_requests%ROWTYPE; v_category review_rating_category; v_review_id uuid; v_google_url text;
BEGIN
  SELECT * INTO v_request FROM review_requests WHERE token = p_token AND status = 'pending';
  IF v_request IS NULL THEN RETURN json_build_object('success', false, 'error', 'Review request not found or expired'); END IF;
  IF p_rating = 5 THEN v_category := 'high'; ELSIF p_rating >= 3 THEN v_category := 'improvement'; ELSE v_category := 'low'; END IF;
  INSERT INTO client_reviews (review_request_id, client_id, branch_id, rating, category, improvement_categories, comment, redirected_to_google)
  VALUES (v_request.id, v_request.client_id, v_request.branch_id, p_rating, v_category, p_improvement_categories, p_comment, p_rating = 5)
  RETURNING id INTO v_review_id;
  UPDATE review_requests SET status = 'completed' WHERE id = v_request.id;
  IF v_category = 'low' THEN INSERT INTO crm_cases (review_id, client_id, branch_id) VALUES (v_review_id, v_request.client_id, v_request.branch_id); END IF;
  IF p_rating = 5 THEN SELECT google_review_url INTO v_google_url FROM branches WHERE id = v_request.branch_id; END IF;
  RETURN json_build_object('success', true, 'category', v_category::text, 'google_review_url', v_google_url);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_review_branch_google_maps_url(p_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT b.google_review_url FROM review_requests rr JOIN branches b ON b.id = rr.branch_id WHERE rr.token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_client_branch_signals()
RETURNS TABLE(branch_id uuid, branch_name text, branch_address text, occupancy_level occupancy_level, is_open boolean, waiting_count integer, in_progress_count integer, available_barbers integer, total_barbers integer, eta_minutes integer, best_arrival_in_minutes integer, suggestion_text text, updated_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT b.id, b.name, b.address, COALESCE(bs.occupancy_level, 'sin_espera'::occupancy_level),
    (EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')))::INTEGER = ANY(b.business_days)
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME >= b.business_hours_open
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME < b.business_hours_close),
    COALESCE(bs.waiting_count, 0)::integer, COALESCE(bs.queue_size - bs.waiting_count, 0)::integer,
    COALESCE(bs.available_barbers, 0)::integer, COALESCE(bs.active_barbers, 0)::integer,
    bs.eta_minutes, bs.best_arrival_in_minutes, bs.suggestion_text, bs.updated_at
  FROM branches b LEFT JOIN branch_signals bs ON bs.branch_id = b.id WHERE b.is_active = true ORDER BY b.name;
$$;

CREATE OR REPLACE FUNCTION public.get_client_global_points()
RETURNS TABLE(total_balance integer, total_earned integer, total_redeemed integer)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(points_balance), 0)::INTEGER, COALESCE(SUM(total_earned), 0)::INTEGER, COALESCE(SUM(total_redeemed), 0)::INTEGER
  FROM client_points WHERE client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.get_client_pending_reviews()
RETURNS TABLE(request_id uuid, branch_name text, barber_name text, visit_date timestamp with time zone, token text, expires_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rr.id, b.name, s.full_name, rr.created_at, rr.token, rr.expires_at
  FROM review_requests rr JOIN branches b ON b.id = rr.branch_id LEFT JOIN staff s ON s.id = rr.barber_id
  WHERE rr.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()) AND rr.status = 'pending' AND rr.expires_at > now()
  ORDER BY rr.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_client_wallet()
RETURNS TABLE(reward_id uuid, client_reward_id uuid, reward_name text, reward_description text, reward_type reward_type, discount_pct integer, is_free_service boolean, status client_reward_status, qr_code text, expires_at timestamp with time zone, created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rc.id, cr.id, rc.name, rc.description, rc.type, rc.discount_pct, rc.is_free_service, cr.status, cr.qr_code, cr.expires_at, cr.created_at
  FROM client_rewards cr JOIN reward_catalog rc ON rc.id = cr.reward_id
  WHERE cr.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()) ORDER BY cr.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.set_client_pin(p_pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_client_id UUID;
BEGIN
  SELECT id INTO v_client_id FROM clients WHERE auth_user_id = auth.uid();
  IF v_client_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Client not found'); END IF;
  IF length(p_pin) < 4 OR length(p_pin) > 6 THEN RETURN json_build_object('success', false, 'error', 'PIN must be 4-6 digits'); END IF;
  UPDATE clients SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) WHERE id = v_client_id;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_client_pin(p_pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hash TEXT;
BEGIN
  SELECT pin_hash INTO v_hash FROM clients WHERE auth_user_id = auth.uid();
  IF v_hash IS NULL THEN RETURN json_build_object('success', false, 'error', 'No PIN configured'); END IF;
  IF v_hash = extensions.crypt(p_pin, v_hash) THEN RETURN json_build_object('success', true);
  ELSE RETURN json_build_object('success', false, 'error', 'Invalid PIN'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_occurrence_count(p_staff_id uuid, p_event_type disciplinary_event_type, p_from_date date DEFAULT date_trunc('month', CURRENT_DATE)::date)
RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM disciplinary_events WHERE staff_id = p_staff_id AND event_type = p_event_type AND event_date >= p_from_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.match_client_face_dist(query_embedding vector, match_threshold double precision, match_count integer)
RETURNS TABLE(id uuid, name text, phone text, distance double precision) LANGUAGE sql STABLE AS $$
  SELECT clients.id, clients.name, clients.phone, clients.face_embedding <-> query_embedding as distance
  FROM clients WHERE clients.face_embedding <-> query_embedding < match_threshold ORDER BY distance ASC LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_face_descriptor(query_descriptor vector, match_threshold double precision DEFAULT 0.5, max_results integer DEFAULT 3)
RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT ON (c.id) c.id, c.name, c.phone, c.face_photo_url, (cfd.descriptor <-> query_descriptor)::FLOAT
  FROM client_face_descriptors cfd JOIN clients c ON c.id = cfd.client_id
  WHERE (cfd.descriptor <-> query_descriptor) < match_threshold ORDER BY c.id, (cfd.descriptor <-> query_descriptor) LIMIT max_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_staff_face_descriptor(query_descriptor vector, match_threshold double precision DEFAULT 0.5, max_results integer DEFAULT 3)
RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT ON (s.id) s.id, s.full_name, COALESCE(s.phone, ''), NULL::text, (sfd.descriptor <-> query_descriptor)::FLOAT
  FROM staff_face_descriptors sfd JOIN staff s ON s.id = sfd.staff_id
  WHERE (sfd.descriptor <-> query_descriptor) < match_threshold ORDER BY s.id, (sfd.descriptor <-> query_descriptor) LIMIT max_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_unread(conv_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE conversations SET unread_count = unread_count + 1, updated_at = now() WHERE id = conv_id;
END;
$$;

-- ============================================================
-- 6. TRIGGERS
-- ============================================================

CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_branch_signals_on_attendance AFTER INSERT ON public.attendance_logs FOR EACH ROW EXECUTE FUNCTION trg_refresh_branch_signals();
CREATE TRIGGER trg_billboard_updated_at BEFORE UPDATE ON public.billboard_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_break_configs_updated_at BEFORE UPDATE ON public.break_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_device_tokens_updated_at BEFORE UPDATE ON public.client_device_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_disciplinary_rules_updated_at BEFORE UPDATE ON public.disciplinary_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fixed_expenses_updated_at BEFORE UPDATE ON public.fixed_expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_incentive_rules_updated_at BEFORE UPDATE ON public.incentive_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payment_accounts_updated_at BEFORE UPDATE ON public.payment_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_branch_signals_on_queue AFTER INSERT OR DELETE OR UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION trg_refresh_branch_signals();
CREATE TRIGGER trg_queue_completed AFTER UPDATE ON public.queue_entries FOR EACH ROW EXECUTE FUNCTION on_queue_completed();
CREATE TRIGGER trg_notify_review_request AFTER INSERT ON public.review_requests FOR EACH ROW EXECUTE FUNCTION notify_client_review_request();
CREATE TRIGGER trg_rewards_config_updated_at BEFORE UPDATE ON public.rewards_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER on_roles_updated BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION handle_roles_updated_at();
CREATE TRIGGER trg_salary_configs_updated_at BEFORE UPDATE ON public.salary_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_salary_payments_updated_at BEFORE UPDATE ON public.salary_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_salary_reports_updated_at BEFORE UPDATE ON public.salary_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_branch_signals_on_staff AFTER UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION trg_refresh_branch_signals();
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schedule_exceptions_updated_at BEFORE UPDATE ON public.staff_schedule_exceptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_staff_schedules_updated_at BEFORE UPDATE ON public.staff_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ssc_updated_at BEFORE UPDATE ON public.staff_service_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_update_loyalty_after_visit AFTER INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION update_client_loyalty_state();

-- ============================================================
-- 7. RLS POLICIES (resumen - ver archivo completo para detalles)
-- ============================================================

-- RLS está habilitado en todas las tablas
-- El dashboard usa createAdminClient() (service_role) que bypasea RLS
-- Las políticas principales son:
--   - staff con role owner/admin: CRUD completo vía is_admin_or_owner()
--   - staff autenticado: lectura en la mayoría de tablas
--   - clientes (auth_user_id): lectura de sus propios datos
--   - público: lectura de branches, services, queue_entries, etc.
-- Para las políticas detalladas, consultar las migraciones 001-046

-- ============================================================
-- FIN DEL SNAPSHOT
-- ============================================================
