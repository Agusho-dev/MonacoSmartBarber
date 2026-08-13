-- =============================================================================
-- 178_arca_ambiente_en_comprobantes.sql
-- Separa los comprobantes de PRUEBA de los reales.
--
-- EL PROBLEMA
-- -----------
-- `arca_invoices` no sabía en qué ambiente se emitió cada comprobante, y ni el
-- cupo ni la búsqueda de candidatas miraban el contribuyente. El wizard invita
-- explícitamente a emitir un par de comprobantes de prueba para ver el circuito
-- completo, así que la secuencia era:
--
--   1. El dueño factura 5 ventas REALES contra el contribuyente de homologación.
--   2. Al día siguiente carga el de producción.
--   3. El cupo de producción arranca consumido con los $ de la prueba.
--   4. Y esas 5 ventas ya nunca vuelven como candidatas —su comprobante de
--      prueba figura como 'emitida'— así que quedan sin comprobante fiscal
--      REAL para siempre, en silencio.
--
-- El punto 4 es el grave: son ventas que el dueño cree facturadas y no lo están.
--
-- LA SOLUCIÓN
-- -----------
-- El ambiente viaja en la fila, el cupo cuenta sólo producción, y la unicidad
-- por visita pasa a ser por (visita, ambiente): una venta puede tener su
-- comprobante de prueba Y después su comprobante real.
-- =============================================================================

ALTER TABLE arca_invoices
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'produccion';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arca_invoices_environment_check') THEN
    ALTER TABLE arca_invoices
      ADD CONSTRAINT arca_invoices_environment_check
      CHECK (environment IN ('homologacion', 'produccion'));
  END IF;
END $$;

-- Backfill desde el contribuyente (en la práctica no hay filas todavía).
UPDATE arca_invoices i
   SET environment = t.environment
  FROM arca_taxpayers t
 WHERE t.id = i.taxpayer_id
   AND i.environment IS DISTINCT FROM t.environment;

COMMENT ON COLUMN arca_invoices.environment IS
  'Ambiente en que se emitió. Los de homologación NO consumen cupo ni bloquean la venta para su comprobante real.';

-- -----------------------------------------------------------------------------
-- Unicidad por visita, ahora por ambiente
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_arca_invoices_una_por_visita;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_invoices_una_por_visita
  ON arca_invoices (visit_id, environment)
  WHERE visit_id IS NOT NULL AND status IN ('pendiente','reservado','emitida','en_duda');

CREATE INDEX IF NOT EXISTS idx_arca_invoices_cupo_ambiente
  ON arca_invoices (organization_id, environment, branch_id, fecha_cbte)
  WHERE status IN ('reservado','emitida','en_duda');

-- -----------------------------------------------------------------------------
-- El ambiente lo pone la RESERVA, leyéndolo del contribuyente
--
-- Se deriva adentro de la función en vez de agregarlo como parámetro: así no
-- hay forma de que un call-site se olvide de mandarlo y termine grabando un
-- comprobante de prueba como si fuera real.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_reserve_invoice(
  p_taxpayer_id              uuid,
  p_organization_id          uuid,
  p_branch_id                uuid,
  p_sales_point_id           uuid,
  p_pto_vta                  integer,
  p_cbte_tipo                integer,
  p_arca_last                bigint,
  p_concepto                 integer,
  p_doc_tipo                 integer,
  p_doc_nro                  bigint,
  p_condicion_iva_receptor_id integer,
  p_fecha_cbte               date,
  p_imp_total                numeric,
  p_imp_neto                 numeric,
  p_imp_iva                  numeric,
  p_iva_items                jsonb,
  p_visit_id                 uuid DEFAULT NULL,
  p_client_id                uuid DEFAULT NULL,
  p_policy_id                uuid DEFAULT NULL,
  p_emitted_via              text DEFAULT 'manual',
  p_emitted_by_staff_id      uuid DEFAULT NULL,
  p_fch_serv_desde           date DEFAULT NULL,
  p_fch_serv_hasta           date DEFAULT NULL,
  p_fch_vto_pago             date DEFAULT NULL,
  p_receptor_nombre          text DEFAULT NULL,
  p_parent_invoice_id        uuid DEFAULT NULL,
  p_cbtes_asoc               jsonb DEFAULT NULL
)
RETURNS TABLE (invoice_id uuid, numero bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_max bigint;
  v_next      bigint;
  v_id        uuid;
  v_env       text;
BEGIN
  SELECT environment INTO v_env FROM arca_taxpayers WHERE id = p_taxpayer_id;
  IF v_env IS NULL THEN
    RAISE EXCEPTION 'No existe el contribuyente %', p_taxpayer_id;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_taxpayer_id::text || ':' || p_pto_vta::text || ':' || p_cbte_tipo::text, 0)
  );

  SELECT COALESCE(MAX(i.cbte_nro), 0) INTO v_local_max
  FROM arca_invoices i
  WHERE i.taxpayer_id = p_taxpayer_id
    AND i.cbte_tipo   = p_cbte_tipo
    AND i.pto_vta     = p_pto_vta
    AND i.status IN ('pendiente','reservado','emitida','en_duda');

  v_next := GREATEST(v_local_max, COALESCE(p_arca_last, 0)) + 1;

  INSERT INTO arca_invoices (
    organization_id, branch_id, taxpayer_id, sales_point_id, environment,
    visit_id, client_id, policy_id,
    cbte_tipo, pto_vta, cbte_nro, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre,
    fecha_cbte, fch_serv_desde, fch_serv_hasta, fch_vto_pago,
    imp_total, imp_neto, imp_iva, iva_items,
    parent_invoice_id, cbtes_asoc,
    status, emitted_via, emitted_by_staff_id
  ) VALUES (
    p_organization_id, p_branch_id, p_taxpayer_id, p_sales_point_id, v_env,
    p_visit_id, p_client_id, p_policy_id,
    p_cbte_tipo, p_pto_vta, v_next, p_concepto,
    p_doc_tipo, p_doc_nro, p_condicion_iva_receptor_id, p_receptor_nombre,
    p_fecha_cbte, p_fch_serv_desde, p_fch_serv_hasta, p_fch_vto_pago,
    p_imp_total, p_imp_neto, p_imp_iva, p_iva_items,
    p_parent_invoice_id, p_cbtes_asoc,
    'reservado', p_emitted_via, p_emitted_by_staff_id
  )
  RETURNING id INTO v_id;

  invoice_id := v_id;
  numero     := v_next;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- El cupo cuenta SÓLO producción
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_quota_state_params(
  p_organization_id uuid,
  p_branch_id       uuid,
  p_period          text,
  p_target_count    integer,
  p_target_amount   numeric,
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start     date,
  period_end       date,
  emitted_count    integer,
  emitted_amount   numeric,
  target_count     integer,
  target_amount    numeric,
  remaining_count  integer,
  remaining_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz    text;
  v_local date;
  v_start date;
  v_end   date;
BEGIN
  SELECT COALESCE(b.timezone, o.timezone, 'America/Argentina/Buenos_Aires')
    INTO v_tz
  FROM organizations o
  LEFT JOIN branches b ON b.id = p_branch_id
  WHERE o.id = p_organization_id;

  v_local := (p_at AT TIME ZONE COALESCE(v_tz, 'America/Argentina/Buenos_Aires'))::date;

  v_start := CASE p_period
               WHEN 'dia'    THEN v_local
               WHEN 'semana' THEN (date_trunc('week',  v_local::timestamp))::date
               ELSE               (date_trunc('month', v_local::timestamp))::date
             END;
  v_end   := CASE p_period
               WHEN 'dia'    THEN v_start + 1
               WHEN 'semana' THEN v_start + 7
               ELSE               (v_start + interval '1 month')::date
             END;

  SELECT COALESCE(COUNT(*), 0)::integer, COALESCE(SUM(i.imp_total), 0)
  INTO emitted_count, emitted_amount
  FROM arca_invoices i
  WHERE i.organization_id = p_organization_id
    AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND i.fecha_cbte >= v_start
    AND i.fecha_cbte <  v_end
    AND i.status IN ('reservado','emitida','en_duda')
    AND i.cbte_tipo NOT IN (3, 8, 13, 53)
    -- Las pruebas no consumen cupo real.
    AND i.environment = 'produccion';

  period_start     := v_start;
  period_end       := v_end;
  target_count     := p_target_count;
  target_amount    := p_target_amount;
  remaining_count  := GREATEST(COALESCE(p_target_count, 0)  - emitted_count, 0);
  remaining_amount := GREATEST(COALESCE(p_target_amount, 0) - emitted_amount, 0);

  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- Las candidatas se excluyen por AMBIENTE
--
-- Una venta con comprobante de prueba sigue estando pendiente de su comprobante
-- real. El parámetro tiene default 'produccion' para no romper call-sites.
--
-- Se DROPEA la firma vieja primero: agregar un parámetro convierte el
-- `CREATE OR REPLACE` en una SOBRECARGA, y con dos versiones conviviendo los
-- `GRANT`/`REVOKE` sin lista de argumentos fallan con 42725 ("function name is
-- not unique") — y peor, un call-site viejo seguiría usando la versión sin
-- filtro de ambiente sin que nadie se entere.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS arca_billing_candidates(
  uuid, uuid[], timestamptz, timestamptz, text[], numeric, numeric, boolean, text, text, integer);

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
  p_environment     text     DEFAULT 'produccion'
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
      v.id                AS visit_id,
      v.branch_id,
      b.name              AS branch_name,
      b.timezone          AS tz,
      v.completed_at,
      (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) AS base_amount,
      v.amount,
      v.tip_amount,
      v.payment_method::text AS payment_method,
      v.client_id,
      c.name              AS client_name,
      c.phone             AS client_phone,
      s.full_name         AS barber_name,
      sv.name             AS service_name
    FROM visits v
    JOIN branches b        ON b.id = v.branch_id
    LEFT JOIN clients c    ON c.id = v.client_id
    LEFT JOIN staff s      ON s.id = v.barber_id
    LEFT JOIN services sv  ON sv.id = v.service_id
    WHERE v.organization_id = p_organization_id
      AND (p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids))
      AND v.completed_at >= p_from
      AND v.completed_at <  p_to
      AND v.payment_method::text = ANY (p_payment_methods)
      AND v.amount > 0
      AND (p_min_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) >= p_min_ticket)
      AND (p_max_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) <= p_max_ticket)
      AND NOT EXISTS (
        SELECT 1 FROM arca_invoices ai
        WHERE ai.visit_id = v.id
          AND ai.environment = p_environment
          AND ai.status IN ('pendiente','reservado','emitida','en_duda')
      )
  ),
  ordenadas AS (
    SELECT
      e.*,
      (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date AS dia_local,
      ROW_NUMBER() OVER (
        PARTITION BY (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date
        ORDER BY e.completed_at
      ) AS pos_en_dia,
      md5(e.visit_id::text || p_seed) AS orden_aleatorio
    FROM elegibles e
  )
  SELECT
    o.visit_id, o.branch_id, o.branch_name, o.completed_at,
    o.base_amount, o.amount, o.tip_amount, o.payment_method,
    o.client_id, o.client_name, o.client_phone, o.barber_name, o.service_name
  FROM ordenadas o
  ORDER BY
    CASE WHEN p_selection = 'mas_baratos'  THEN o.base_amount END ASC  NULLS LAST,
    CASE WHEN p_selection = 'mas_caros'    THEN o.base_amount END DESC NULLS LAST,
    CASE WHEN p_selection = 'distribuido'  THEN o.pos_en_dia  END ASC  NULLS LAST,
    CASE WHEN p_selection = 'distribuido'  THEN o.dia_local   END ASC  NULLS LAST,
    CASE WHEN p_selection = 'aleatorio'    THEN o.orden_aleatorio END ASC NULLS LAST,
    o.completed_at ASC
  LIMIT COALESCE(p_limit, 500);
$$;

REVOKE ALL ON FUNCTION arca_reserve_invoice      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_quota_state_params   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_billing_candidates   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_reserve_invoice    TO service_role;
GRANT EXECUTE ON FUNCTION arca_quota_state_params TO service_role;
GRANT EXECUTE ON FUNCTION arca_billing_candidates TO service_role;
