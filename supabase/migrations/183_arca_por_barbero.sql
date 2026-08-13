-- =============================================================================
-- 183_arca_por_barbero.sql
-- El facturador pasa de UN contribuyente por organización a UNO POR BARBERO.
--
-- POR QUÉ CAMBIA EL EJE
-- --------------------
-- En Monaco cada barbero tiene su propio monotributo y factura sus propios
-- cortes; los dueños (Tony y Nico) administran todos desde un solo panel y
-- deciden CUÁNTO factura cada uno. O sea que el cupo —"de los 20 cortes que
-- hizo, facturamos 10"— deja de colgar de la sucursal y pasa a colgar del
-- CONTRIBUYENTE.
--
-- Los números lo confirman: la organización factura ~$492M al año, muy por
-- encima de cualquier monotributo, pero repartido entre ~13 barberos da
-- $10–20M cada uno, que entra cómodo en las categorías A–C. La figura no era
-- viable a nivel razón social y sí lo es a nivel persona.
--
-- QUÉ NO CAMBIA
-- -------------
-- El motor de selección (`planificarFacturacion`) queda igual: ya sabía cortar
-- "N de M ventas" con una estrategia. Lo único que cambia es el conjunto sobre
-- el que corta — ahora son las ventas DE ESE BARBERO.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Escala del monotributo — para el semáforo anual
--
-- Es tabla y no constantes en el código porque ARCA la actualiza dos veces por
-- año (febrero y agosto). Con una tabla, actualizarla es un UPDATE; con
-- constantes, es un deploy.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_monotributo_categorias (
  categoria        text PRIMARY KEY,
  tope_anual       numeric(14,2) NOT NULL,
  cuota_servicios  numeric(14,2),
  vigente_desde    date NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE arca_monotributo_categorias IS
  'Escala de monotributo (servicios). ARCA la actualiza en febrero y agosto: mantenerla al día es un UPDATE, no un deploy.';

INSERT INTO arca_monotributo_categorias (categoria, tope_anual, cuota_servicios, vigente_desde) VALUES
  ('A',  12009410.45,   49527.18, '2026-08-01'),
  ('B',  17595182.74,   56379.08, '2026-08-01'),
  ('C',  24670494.31,   66020.12, '2026-08-01'),
  ('D',  30628651.43,   84612.93, '2026-08-01'),
  ('E',  36028231.33,  119811.45, '2026-08-01'),
  ('F',  45151659.41,  150784.21, '2026-08-01'),
  ('G',  53995798.87,  230312.94, '2026-08-01'),
  ('H',  81924660.37,  522706.68, '2026-08-01'),
  ('I',  91699761.90,  963747.86, '2026-08-01'),
  ('J', 105012519.20, 1167299.76, '2026-08-01'),
  ('K', 126610838.75, 1614446.04, '2026-08-01')
ON CONFLICT (categoria) DO UPDATE
  SET tope_anual      = EXCLUDED.tope_anual,
      cuota_servicios = EXCLUDED.cuota_servicios,
      vigente_desde   = EXCLUDED.vigente_desde,
      updated_at      = now();

ALTER TABLE arca_monotributo_categorias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arca_monotributo_categorias FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. El contribuyente es una PERSONA del equipo
-- -----------------------------------------------------------------------------
ALTER TABLE arca_taxpayers
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monotributo_categoria text REFERENCES arca_monotributo_categorias(categoria),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  -- Tope anual propio, para el caso en que no se quiera atar a una categoría.
  -- Si está NULL, manda el tope de la categoría.
  ADD COLUMN IF NOT EXISTS tope_anual_override numeric(14,2);

-- Un barbero, un CUIT por ambiente. Sin esto, dos altas del mismo barbero
-- parten su facturación en dos y ningún tope mide bien.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_taxpayers_un_cuit_por_barbero
  ON arca_taxpayers (organization_id, environment, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arca_taxpayers_staff
  ON arca_taxpayers (staff_id) WHERE staff_id IS NOT NULL;

COMMENT ON COLUMN arca_taxpayers.staff_id IS
  'El barbero titular de este monotributo. Es lo que conecta cada venta (visits.barber_id) con el CUIT que la factura.';

-- -----------------------------------------------------------------------------
-- 3. El cupo cuelga del CONTRIBUYENTE, no de la sucursal
--
-- La tabla está vacía (la feature es nueva), así que se reestructura sin
-- migrar datos.
-- -----------------------------------------------------------------------------
ALTER TABLE arca_billing_policies
  ADD COLUMN IF NOT EXISTS taxpayer_id uuid REFERENCES arca_taxpayers(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_arca_policy_per_branch;
DROP INDEX IF EXISTS idx_arca_policy_org_wide;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_policy_por_contribuyente
  ON arca_billing_policies (taxpayer_id)
  WHERE taxpayer_id IS NOT NULL;

COMMENT ON COLUMN arca_billing_policies.taxpayer_id IS
  'Dueño del cupo. Cada monotributo tiene el suyo: es el "de 20 cortes le facturamos 10" de ESE barbero.';

-- -----------------------------------------------------------------------------
-- 4. Estado anual de un contribuyente — el semáforo del tope
--
-- Mide 12 meses MÓVILES, que es como mide ARCA para la recategorización, y no
-- el año calendario. Y proyecta el cierre a ritmo actual, que es el dato que
-- de verdad sirve: al día 200 del año no importa tanto lo que llevás como
-- adónde vas a llegar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_taxpayer_annual_state(
  p_taxpayer_id uuid,
  p_at          timestamptz DEFAULT now()
)
RETURNS TABLE (
  desde              date,
  hasta              date,
  facturado_12m      numeric,
  comprobantes_12m   integer,
  tope_anual         numeric,
  categoria          text,
  restante           numeric,
  porcentaje         numeric,
  -- Proyección a 12 meses según el ritmo de los últimos 90 días.
  proyectado_anual   numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tp     arca_taxpayers%ROWTYPE;
  v_desde  date;
  v_hasta  date;
  v_90d    numeric;
BEGIN
  SELECT * INTO v_tp FROM arca_taxpayers WHERE id = p_taxpayer_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_hasta := (p_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_desde := v_hasta - interval '12 months';

  SELECT COALESCE(SUM(i.imp_total), 0), COALESCE(COUNT(*), 0)::integer
  INTO facturado_12m, comprobantes_12m
  FROM arca_invoices i
  WHERE i.taxpayer_id = p_taxpayer_id
    AND i.environment = 'produccion'
    AND i.status IN ('reservado','emitida','en_duda')
    AND i.cbte_tipo NOT IN (3, 8, 13, 53)
    AND i.fecha_cbte >= v_desde
    AND i.fecha_cbte <= v_hasta;

  SELECT COALESCE(SUM(i.imp_total), 0) INTO v_90d
  FROM arca_invoices i
  WHERE i.taxpayer_id = p_taxpayer_id
    AND i.environment = 'produccion'
    AND i.status IN ('reservado','emitida','en_duda')
    AND i.cbte_tipo NOT IN (3, 8, 13, 53)
    AND i.fecha_cbte > v_hasta - interval '90 days';

  categoria  := v_tp.monotributo_categoria;
  tope_anual := COALESCE(
    v_tp.tope_anual_override,
    (SELECT c.tope_anual FROM arca_monotributo_categorias c WHERE c.categoria = v_tp.monotributo_categoria)
  );

  desde            := v_desde;
  hasta            := v_hasta;
  restante         := GREATEST(COALESCE(tope_anual, 0) - facturado_12m, 0);
  porcentaje       := CASE WHEN COALESCE(tope_anual, 0) > 0
                           THEN ROUND((facturado_12m / tope_anual) * 100, 1)
                           ELSE NULL END;
  proyectado_anual := ROUND(v_90d * (365.0 / 90.0), 2);

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION arca_taxpayer_annual_state IS
  'Facturado de un contribuyente en 12 meses MÓVILES (como mide ARCA), contra el tope de su categoría, más la proyección a ritmo de los últimos 90 días.';

-- -----------------------------------------------------------------------------
-- 5. Las candidatas se pueden pedir por BARBERO
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS arca_billing_candidates(
  uuid, uuid[], timestamptz, timestamptz, text[], numeric, numeric, boolean, text, text, integer, text);

CREATE OR REPLACE FUNCTION arca_billing_candidates(
  p_organization_id uuid,
  p_branch_ids      uuid[],
  p_from            timestamptz,
  p_to              timestamptz,
  p_payment_methods text[]   DEFAULT ARRAY['cash','card','transfer']::text[],
  p_min_ticket      numeric  DEFAULT NULL,
  p_max_ticket      numeric  DEFAULT NULL,
  p_include_tips    boolean  DEFAULT false,
  p_selection       text     DEFAULT 'cronologico',
  p_seed            text     DEFAULT 'x',
  p_limit           integer  DEFAULT 500,
  p_environment     text     DEFAULT 'produccion',
  p_staff_id        uuid     DEFAULT NULL
)
RETURNS TABLE (
  visit_id       uuid,
  branch_id      uuid,
  branch_name    text,
  completed_at   timestamptz,
  base_amount    numeric,
  amount         numeric,
  tip_amount     numeric,
  payment_method text,
  client_id      uuid,
  client_name    text,
  client_phone   text,
  barber_id      uuid,
  barber_name    text,
  service_name   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH elegibles AS (
    SELECT
      v.id AS visit_id, v.branch_id, b.name AS branch_name, b.timezone AS tz, v.completed_at,
      (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) AS base_amount,
      v.amount, v.tip_amount, v.payment_method::text AS payment_method,
      v.client_id, c.name AS client_name, c.phone AS client_phone,
      v.barber_id, s.full_name AS barber_name, sv.name AS service_name
    FROM visits v
    JOIN branches b        ON b.id = v.branch_id
    LEFT JOIN clients c    ON c.id = v.client_id
    LEFT JOIN staff s      ON s.id = v.barber_id
    LEFT JOIN services sv  ON sv.id = v.service_id
    WHERE v.organization_id = p_organization_id
      AND (p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids))
      -- El filtro que hace posible el modelo por barbero.
      AND (p_staff_id IS NULL OR v.barber_id = p_staff_id)
      AND v.completed_at >= p_from
      AND v.completed_at <  p_to
      AND v.payment_method::text = ANY (p_payment_methods)
      AND v.amount > 0
      AND (p_min_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) >= p_min_ticket)
      AND (p_max_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) <= p_max_ticket)
      AND NOT EXISTS (
        SELECT 1 FROM arca_invoices ai
        WHERE ai.visit_id = v.id AND ai.environment = p_environment
          AND ai.status IN ('pendiente','reservado','emitida','en_duda'))
  ),
  ordenadas AS (
    SELECT e.*,
      (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date AS dia_local,
      ROW_NUMBER() OVER (PARTITION BY (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date
        ORDER BY e.completed_at) AS pos_en_dia,
      md5(e.visit_id::text || p_seed) AS orden_aleatorio
    FROM elegibles e
  )
  SELECT o.visit_id, o.branch_id, o.branch_name, o.completed_at, o.base_amount, o.amount,
    o.tip_amount, o.payment_method, o.client_id, o.client_name, o.client_phone,
    o.barber_id, o.barber_name, o.service_name
  FROM ordenadas o
  ORDER BY
    CASE WHEN p_selection = 'mas_baratos' THEN o.base_amount END ASC NULLS LAST,
    CASE WHEN p_selection = 'mas_caros'   THEN o.base_amount END DESC NULLS LAST,
    CASE WHEN p_selection = 'distribuido' THEN o.pos_en_dia  END ASC NULLS LAST,
    CASE WHEN p_selection = 'distribuido' THEN o.dia_local   END ASC NULLS LAST,
    CASE WHEN p_selection = 'aleatorio'   THEN o.orden_aleatorio END ASC NULLS LAST,
    o.completed_at ASC
  LIMIT COALESCE(p_limit, 500);
$$;

-- -----------------------------------------------------------------------------
-- 6. El cupo mensual también se mide por contribuyente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_quota_state(
  p_policy_id uuid,
  p_at        timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start date, period_end date, emitted_count integer, emitted_amount numeric,
  target_count integer, target_amount numeric, remaining_count integer, remaining_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol   arca_billing_policies%ROWTYPE;
  v_tz    text;
  v_local date;
  v_start date;
  v_end   date;
BEGIN
  SELECT * INTO v_pol FROM arca_billing_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(b.timezone, o.timezone, 'America/Argentina/Buenos_Aires') INTO v_tz
  FROM organizations o LEFT JOIN branches b ON b.id = v_pol.branch_id
  WHERE o.id = v_pol.organization_id;

  v_local := (p_at AT TIME ZONE COALESCE(v_tz, 'America/Argentina/Buenos_Aires'))::date;
  v_start := CASE v_pol.period WHEN 'dia' THEN v_local
               WHEN 'semana' THEN (date_trunc('week', v_local::timestamp))::date
               ELSE (date_trunc('month', v_local::timestamp))::date END;
  v_end   := CASE v_pol.period WHEN 'dia' THEN v_start + 1
               WHEN 'semana' THEN v_start + 7
               ELSE (v_start + interval '1 month')::date END;

  SELECT COALESCE(COUNT(*), 0)::integer, COALESCE(SUM(i.imp_total), 0)
  INTO emitted_count, emitted_amount
  FROM arca_invoices i
  WHERE i.organization_id = v_pol.organization_id
    -- Con política por contribuyente el cupo mide SU facturación, no la de la
    -- sucursal: dos barberos del mismo local tienen cupos independientes.
    AND (v_pol.taxpayer_id IS NULL OR i.taxpayer_id = v_pol.taxpayer_id)
    AND (v_pol.taxpayer_id IS NOT NULL OR v_pol.branch_id IS NULL OR i.branch_id = v_pol.branch_id)
    AND i.fecha_cbte >= v_start
    AND i.fecha_cbte <  v_end
    AND i.status IN ('reservado','emitida','en_duda')
    AND i.cbte_tipo NOT IN (3, 8, 13, 53)
    AND i.environment = 'produccion';

  period_start := v_start; period_end := v_end;
  target_count := v_pol.target_count; target_amount := v_pol.target_amount;
  remaining_count  := GREATEST(COALESCE(v_pol.target_count, 0)  - emitted_count, 0);
  remaining_amount := GREATEST(COALESCE(v_pol.target_amount, 0) - emitted_amount, 0);
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Permisos
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION arca_billing_candidates    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_taxpayer_annual_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_quota_state           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_billing_candidates    TO service_role;
GRANT EXECUTE ON FUNCTION arca_taxpayer_annual_state TO service_role;
GRANT EXECUTE ON FUNCTION arca_quota_state           TO service_role;
