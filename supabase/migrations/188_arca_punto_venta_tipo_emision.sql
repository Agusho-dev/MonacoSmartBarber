-- =============================================================================
-- 188 — El TIPO DE EMISIÓN del punto de venta, y el pozo real de "sin facturar"
--
-- ORIGEN: el CUIT de un barbero de Monaco no podía emitir un solo comprobante.
-- ARCA rechazaba los seis intentos con
--
--     10005 NO AUTORIZADO A EMITIR COMPROBANTES — EL PUNTO DE VENTA INFORMADO
--           DEBE ESTAR DADO DE ALTA Y SER DEL TIPO RECE
--
-- Consultado FEParamGetPtosVenta contra producción, ese CUIT tiene UN punto de
-- venta y ARCA lo declara `EmisionTipo = "CAEA - Monotributo CONTINGENCIA"`.
-- CAEA es el régimen de contingencia: el código se pide por adelantado para una
-- quincena entera y se informa después. `FECAESolicitar` —lo único que emite
-- este sistema— no lo acepta, y el rechazo es PERMANENTE.
--
-- El sistema ya leía `EmisionTipo` y lo guardaba en `descripcion`, pero no lo
-- miraba para decidir si el punto de venta servía: sólo miraba `Bloqueado` y
-- `FchBaja`, que en este caso venían `N` y `NULL`. Resultado: la prueba de
-- conexión daba verde, el barbero figuraba "listo para facturar", y cada
-- emisión moría contra ARCA sin explicación.
--
-- Esta migración hace dos cosas:
--   1. Convierte el tipo de emisión en un dato de primera clase de
--      `arca_sales_points`, con la regla en la base y no en cada call-site.
--   2. Arregla `arca_panel_barberos`: el pozo de "ventas disponibles" usaba una
--      ventana fija de 30 días mientras el motor usa `lookback_days` (hoy 7), y
--      encima ignoraba los filtros del cupo. La pantalla decía "2.848 ventas
--      disponibles" sobre un universo real de 675.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La regla, una sola vez y en la base
-- -----------------------------------------------------------------------------
-- FALLA ABIERTA a propósito: sólo se descarta lo que ARCA declara
-- EXPLÍCITAMENTE como CAEA. Un `EmisionTipo` vacío, nuevo o desconocido se
-- acepta — apagar un punto de venta que hoy factura bien porque ARCA cambió una
-- etiqueta sería mucho peor que dejar pasar un caso raro, y si el caso raro no
-- sirve, ARCA lo rechaza y el sistema ya sabe explicar ese rechazo.
--
-- "CAE y CAEA" SÍ sirve: alcanza con que aparezca CAE como palabra suelta. Por
-- eso los patrones son con bordes de palabra y no `LIKE '%CAE%'`, que daría
-- verdadero para "CAEA".
CREATE OR REPLACE FUNCTION arca_pv_sirve_para_cae(p_emision_tipo text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_emision_tipo IS NULL OR btrim(p_emision_tipo) = '' THEN true
    WHEN upper(p_emision_tipo) ~ '(^|[^A-Z0-9])(CAE|RECE|RECEL)([^A-Z0-9]|$)' THEN true
    WHEN upper(p_emision_tipo) ~ '(^|[^A-Z0-9])CAEA([^A-Z0-9]|$)'             THEN false
    ELSE true
  END
$$;

COMMENT ON FUNCTION arca_pv_sirve_para_cae IS
  '¿El EmisionTipo que informa ARCA habilita a pedir CAE en línea (FECAESolicitar)? CAEA a secas es contingencia y no sirve: ARCA lo rechaza con 10005.';

-- -----------------------------------------------------------------------------
-- 2. Columnas
-- -----------------------------------------------------------------------------
ALTER TABLE arca_sales_points
  ADD COLUMN IF NOT EXISTS emision_tipo   text,
  ADD COLUMN IF NOT EXISTS sirve_para_cae boolean,
  ADD COLUMN IF NOT EXISTS verificado_at  timestamptz;

COMMENT ON COLUMN arca_sales_points.emision_tipo IS
  'EmisionTipo tal cual lo informa FEParamGetPtosVenta. Ej: "CAE - Monotributo", "CAEA - Monotributo CONTINGENCIA".';
COMMENT ON COLUMN arca_sales_points.sirve_para_cae IS
  'Derivada de emision_tipo por trigger. false = punto de venta de contingencia: ARCA rechaza toda emisión con 10005.';
COMMENT ON COLUMN arca_sales_points.verificado_at IS
  'Última vez que este punto de venta se confirmó contra FEParamGetPtosVenta.';

-- Backfill. Hasta hoy `verificarConexionArca` guardaba el EmisionTipo crudo en
-- `descripcion`, así que ahí está el dato. Si alguien hubiera escrito una
-- descripción propia, la regla falla abierta (`sirve_para_cae = true`) y la
-- próxima "Probar conexión" la sobreescribe con la verdad de ARCA.
UPDATE arca_sales_points
   SET emision_tipo = NULLIF(btrim(descripcion), '')
 WHERE emision_tipo IS NULL;

-- El trigger es la garantía: la columna no puede quedar desalineada de
-- `emision_tipo` porque se olvidó un call-site.
CREATE OR REPLACE FUNCTION fn_arca_sales_points_tipo_emision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.sirve_para_cae := arca_pv_sirve_para_cae(NEW.emision_tipo);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_arca_sales_points_tipo_emision ON arca_sales_points;
CREATE TRIGGER trg_arca_sales_points_tipo_emision
  BEFORE INSERT OR UPDATE OF emision_tipo ON arca_sales_points
  FOR EACH ROW EXECUTE FUNCTION fn_arca_sales_points_tipo_emision();

-- El backfill de arriba corrió sin trigger (la columna se acababa de crear):
-- se completa a mano.
UPDATE arca_sales_points
   SET sirve_para_cae = arca_pv_sirve_para_cae(emision_tipo)
 WHERE sirve_para_cae IS DISTINCT FROM arca_pv_sirve_para_cae(emision_tipo);

-- -----------------------------------------------------------------------------
-- 2.b El índice que impedía importar el punto de venta CORRECTO
-- -----------------------------------------------------------------------------
-- `idx_arca_sales_points_one_default` era UNIQUE (taxpayer_id) WHERE branch_id IS
-- NULL AND is_active, o sea: un contribuyente podía tener UN solo punto de venta
-- sin sucursal asignada. Y `verificarConexionArca` da de alta los que trae ARCA
-- con `branch_id = NULL`.
--
-- Consecuencia sobre el caso real: el barbero va a ARCA, da de alta el punto de
-- venta bueno (Web Services), vuelve, aprieta "Probar conexión"… y el INSERT
-- choca con el 23505 del índice contra el punto CAEA que ya estaba. El error se
-- logueaba y se seguía, así que la pantalla no cambiaba nada. El camino de
-- reparación estaba cerrado por un índice.
--
-- La unicidad que de verdad importa —(taxpayer_id, numero), el mismo número de
-- punto de venta no puede estar dos veces para un CUIT— YA EXISTE como
-- `arca_sales_points_taxpayer_id_numero_key` (verificado en prod), así que
-- alcanza con sacar el índice de más.
--
-- La ambigüedad que `one_default` intentaba evitar —dos comodines y no saber cuál
-- se usa— ya no existe: `puntoVentaDe` ordena por `numero` y elige
-- determinísticamente.
DROP INDEX IF EXISTS idx_arca_sales_points_one_default;

-- -----------------------------------------------------------------------------
-- 2.c Una sola nota de crédito viva por comprobante
-- -----------------------------------------------------------------------------
-- `emitirNotaCredito` chequea antes de emitir si ya hay una NC en vuelo, pero es
-- un SELECT y después un INSERT: dos clics en el botón "Anular" pasan los dos
-- chequeos y emiten DOS notas de crédito reales por el mismo importe. La segunda
-- consume su propio número correlativo y queda en los libros para siempre.
-- El candado tiene que estar en la base.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_invoices_una_nc_por_comprobante
  ON arca_invoices (parent_invoice_id)
  WHERE parent_invoice_id IS NOT NULL
    AND status IN ('pendiente', 'reservado', 'emitida', 'en_duda');

-- -----------------------------------------------------------------------------
-- 2.d Una sola implementación de la regla del período (otra vez)
-- -----------------------------------------------------------------------------
-- La 176 dejó `arca_quota_state_params` como ÚNICA implementación y
-- `arca_quota_state` como envoltorio. La 183 rompió eso: redefinió
-- `arca_quota_state` con su propio cálculo —taxpayer-aware— y dejó
-- `arca_quota_state_params` sin enterarse del contribuyente.
--
-- El resultado es que las dos entradas dan números distintos. `_params` cuenta
-- TODOS los comprobantes de la organización contra el cupo de UNA persona: con
-- las cuatro políticas de producción en `branch_id = NULL`, la vista previa de
-- cualquier barbero leía los 42 comprobantes del negocio como si fueran suyos y
-- mostraba el cupo lleno.
--
-- Se restaura la forma de la 176, ahora con contribuyente.
DROP FUNCTION IF EXISTS arca_quota_state_params(uuid, uuid, text, integer, numeric, timestamptz);

CREATE OR REPLACE FUNCTION arca_quota_state_params(
  p_organization_id uuid,
  p_branch_id       uuid,
  p_period          text,
  p_target_count    integer,
  p_target_amount   numeric,
  p_at              timestamptz DEFAULT now(),
  p_taxpayer_id     uuid        DEFAULT NULL
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz    text;
  v_local date;
  v_start date;
  v_end   date;
BEGIN
  -- La zona horaria sale de la sucursal; si el cupo es de toda la organización,
  -- de la organización. Nunca del proceso: en Vercel es UTC y después de las
  -- 21:00 de Argentina "hoy" ya sería mañana.
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
    -- Con cupo por contribuyente, el cupo mide SU facturación: dos barberos del
    -- mismo local tienen cupos independientes. El filtro por sucursal sólo aplica
    -- a los cupos viejos, que no tenían contribuyente.
    AND (p_taxpayer_id IS NULL OR i.taxpayer_id = p_taxpayer_id)
    AND (p_taxpayer_id IS NOT NULL OR p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND i.fecha_cbte >= v_start
    AND i.fecha_cbte <  v_end
    AND i.status IN ('reservado','emitida','en_duda')
    -- Las notas de crédito no devuelven cupo.
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

COMMENT ON FUNCTION arca_quota_state_params IS
  'Estado del cupo calculado por parámetros. ÚNICA implementación de la regla del período; arca_quota_state la envuelve.';

-- Y `arca_quota_state` vuelve a ser un envoltorio, para que no puedan divergir.
CREATE OR REPLACE FUNCTION arca_quota_state(
  p_policy_id uuid,
  p_at        timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start date, period_end date, emitted_count integer, emitted_amount numeric,
  target_count integer, target_amount numeric, remaining_count integer, remaining_amount numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol arca_billing_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_pol FROM arca_billing_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM arca_quota_state_params(
    v_pol.organization_id,
    v_pol.branch_id,
    v_pol.period,
    v_pol.target_count,
    v_pol.target_amount,
    p_at,
    v_pol.taxpayer_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. arca_panel_barberos — el pozo real, y el punto de venta que de verdad sirve
-- -----------------------------------------------------------------------------
-- Cambios respecto de la 185:
--
--   · `pv` cuenta los puntos de venta que SIRVEN, y aparte los de contingencia.
--     Con el conteo viejo, un CUIT con un único punto CAEA figuraba
--     "listo para facturar".
--
--   · `pend` reemplaza a `sin_fact` + `pend_propio/sucursal/org`. La 185 usaba
--     `interval '30 days'` fijo e ignoraba `payment_methods`, `min_ticket`,
--     `max_ticket`, `include_tips` y el `environment` del contribuyente —o sea,
--     no coincidía con `arca_billing_candidates`, que es lo que el motor
--     realmente va a emitir. Ahora cada barbero mide su pozo con los parámetros
--     de SU cupo, vía LATERAL. Son ~13 agregaciones sobre una ventana de días;
--     el precio es barato y la alternativa era una pantalla que miente por 4x.
--
--   · El pozo respeta `p_branch_ids`. `correrPolitica` filtra el plan por las
--     sucursales que el usuario puede ver, así que mostrarle un pozo más grande
--     del que puede emitir era prometer de más.
--
-- OJO: la ventana del período (`ventana`) y los 12 meses móviles siguen
-- duplicados respecto de `arca_quota_state_params` / `arca_taxpayer_annual_state`.
-- Es la deuda que ya avisaba el CLAUDE.md: si cambia una regla, hay que cambiar
-- las dos.
DROP FUNCTION IF EXISTS arca_panel_barberos(uuid, uuid[], timestamptz);

CREATE OR REPLACE FUNCTION arca_panel_barberos(
  p_organization_id uuid, p_branch_ids uuid[], p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  staff_id uuid, nombre text, sucursal text, avatar_url text,
  taxpayer_id uuid, cuit text, razon_social text, categoria text, environment text,
  tiene_certificado boolean, tiene_csr boolean, puntos_venta integer,
  puntos_venta_contingencia integer, emision_tipo_contingencia text,
  last_check_ok boolean, last_check_at timestamptz, last_check_error text,
  policy_id uuid, policy_enabled boolean, modo text, periodo text,
  target_count integer, target_amount numeric, selection text, payment_methods text[],
  include_tips boolean, allow_overflow boolean, lookback_days integer,
  auto_emit boolean, auto_emit_hour smallint, origen text,
  emitidos_periodo integer, monto_periodo numeric, periodo_desde date, periodo_hasta date,
  -- El MES CALENDARIO, aparte del período del cupo. La tarjeta del panel dice
  -- "Facturado este mes" y sumaba `monto_periodo`, que con `period = 'semana'`
  -- es la semana: mostraba $0 un lunes con $694.000 emitidos en el mes.
  facturado_mes numeric, comprobantes_mes integer,
  facturado_12m numeric, comprobantes_12m integer, tope_anual numeric,
  porcentaje_anual numeric, proyectado_anual numeric,
  sin_facturar_cant integer, sin_facturar_monto numeric,
  -- El pozo del NEGOCIO, sin solaparse. Igual en todas las filas: es un total,
  -- no un dato del barbero. El resumen sumaba `sin_facturar_cant` de cada fila y
  -- con tres cupos org-wide contaba las mismas ventas tres veces (6.139 sobre
  -- 2.639 reales).
  sin_facturar_org_cant integer, sin_facturar_org_monto numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
WITH tz AS (
  SELECT COALESCE((SELECT o.timezone FROM organizations o WHERE o.id = p_organization_id),
                  'America/Argentina/Buenos_Aires') AS zona
),
hoy AS (SELECT (p_at AT TIME ZONE (SELECT zona FROM tz))::date AS d),
equipo AS (
  SELECT s.id, s.full_name, s.avatar_url, s.branch_id, b.name AS sucursal
  FROM staff s JOIN branches b ON b.id = s.branch_id
  WHERE s.organization_id = p_organization_id
    AND (p_branch_ids IS NULL OR s.branch_id = ANY (p_branch_ids))
    AND s.is_active AND s.deleted_at IS NULL
    AND (s.role = 'barber' OR s.is_also_barber = true)
),
contrib AS (
  SELECT DISTINCT ON (t.staff_id) t.*
  FROM arca_taxpayers t
  WHERE t.organization_id = p_organization_id AND t.is_active AND t.staff_id IS NOT NULL
  ORDER BY t.staff_id, (t.environment = 'produccion') DESC
),
pv AS (
  SELECT sp.taxpayer_id,
    count(*) FILTER (WHERE sp.sirve_para_cae IS NOT FALSE)::integer AS n,
    count(*) FILTER (WHERE sp.sirve_para_cae IS FALSE)::integer     AS n_contingencia,
    (array_agg(sp.emision_tipo) FILTER (WHERE sp.sirve_para_cae IS FALSE))[1] AS tipo_contingencia
  FROM arca_sales_points sp
  WHERE sp.organization_id = p_organization_id AND sp.is_active
  GROUP BY sp.taxpayer_id
),
pol AS (
  SELECT p.* FROM arca_billing_policies p
  WHERE p.organization_id = p_organization_id AND p.taxpayer_id IS NOT NULL
),
ventana AS (
  SELECT pol.taxpayer_id,
    CASE pol.period WHEN 'dia' THEN (SELECT d FROM hoy)
         WHEN 'semana' THEN (date_trunc('week',  (SELECT d FROM hoy)::timestamp))::date
         ELSE               (date_trunc('month', (SELECT d FROM hoy)::timestamp))::date END AS desde,
    CASE pol.period WHEN 'dia' THEN (SELECT d FROM hoy) + 1
         WHEN 'semana' THEN (date_trunc('week',  (SELECT d FROM hoy)::timestamp))::date + 7
         ELSE ((date_trunc('month', (SELECT d FROM hoy)::timestamp))::date + interval '1 month')::date END AS hasta
  FROM pol
),
fact AS (
  SELECT i.taxpayer_id,
    count(*) FILTER (WHERE i.fecha_cbte >= v.desde AND i.fecha_cbte < v.hasta)::integer AS emitidos_periodo,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte >= v.desde AND i.fecha_cbte < v.hasta), 0) AS monto_periodo,
    count(*) FILTER (WHERE i.fecha_cbte >= (date_trunc('month', (SELECT d FROM hoy)::timestamp))::date)::integer AS comprobantes_mes,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte >= (date_trunc('month', (SELECT d FROM hoy)::timestamp))::date), 0) AS facturado_mes,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months'), 0) AS facturado_12m,
    count(*) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months')::integer AS comprobantes_12m,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '90 days'), 0) AS ultimos_90d,
    -- Días REALES de historia dentro de la ventana de 90, para que la proyección
    -- anual no divida siempre por 90. Un CUIT que arrancó hace 5 días con
    -- $700.000 proyectaba $2,8M (verde, tope F $45M) cuando su ritmo real anualiza
    -- $51M: la "pared" del tope decía verde justo cuando había que frenar.
    LEAST(90, GREATEST(1,
      (SELECT d FROM hoy) - MIN(i.fecha_cbte) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '90 days') + 1
    ))::numeric AS dias_con_historia
  FROM arca_invoices i
  LEFT JOIN ventana v ON v.taxpayer_id = i.taxpayer_id
  WHERE i.organization_id = p_organization_id AND i.environment = 'produccion'
    AND i.status IN ('reservado','emitida','en_duda') AND i.cbte_tipo NOT IN (3,8,13,53)
  GROUP BY i.taxpayer_id
),
-- Ventas sin comprobante que ESTE cupo puede tomar, con LOS MISMOS filtros que
-- `arca_billing_candidates`. Si estos dos se separan, la pantalla promete una
-- cosa y el motor hace otra.
pend AS (
  SELECT c.id AS taxpayer_id, agg.cant, agg.monto
  FROM contrib c
  JOIN staff st        ON st.id = c.staff_id
  LEFT JOIN pol pl     ON pl.taxpayer_id = c.id
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS cant,
           COALESCE(SUM(vi.amount + CASE WHEN COALESCE(pl.include_tips, false) THEN vi.tip_amount ELSE 0 END), 0) AS monto
    FROM visits vi
    WHERE vi.organization_id = p_organization_id
      AND vi.amount > 0
      AND (p_branch_ids IS NULL OR vi.branch_id = ANY (p_branch_ids))
      AND vi.completed_at >= p_at - make_interval(days => COALESCE(pl.lookback_days, 30))
      AND vi.completed_at <  p_at
      AND vi.payment_method::text = ANY (COALESCE(pl.payment_methods, ARRAY['cash','card','transfer']::text[]))
      AND (pl.min_ticket IS NULL
           OR (vi.amount + CASE WHEN COALESCE(pl.include_tips, false) THEN vi.tip_amount ELSE 0 END) >= pl.min_ticket)
      AND (pl.max_ticket IS NULL
           OR (vi.amount + CASE WHEN COALESCE(pl.include_tips, false) THEN vi.tip_amount ELSE 0 END) <= pl.max_ticket)
      AND CASE COALESCE(pl.origen, 'propios')
            WHEN 'organizacion' THEN true
            WHEN 'sucursal'     THEN vi.branch_id = st.branch_id
            ELSE                     vi.barber_id = c.staff_id
          END
      AND NOT EXISTS (
        SELECT 1 FROM arca_invoices ai
        WHERE ai.visit_id = vi.id
          AND ai.environment = COALESCE(c.environment, 'produccion')
          AND ai.status IN ('pendiente','reservado','emitida','en_duda'))
  ) agg
),
-- El pozo del NEGOCIO, sin doble conteo: ventas sin comprobante que AL MENOS UN
-- cupo prendido podría tomar. Sumar `sin_facturar_cant` fila por fila cuenta las
-- mismas ventas una vez por cada cupo org-wide.
pend_org AS (
  SELECT count(*)::integer AS cant, COALESCE(SUM(vi.amount), 0) AS monto
  FROM visits vi
  WHERE vi.organization_id = p_organization_id
    AND vi.amount > 0
    AND (p_branch_ids IS NULL OR vi.branch_id = ANY (p_branch_ids))
    -- Cota inferior para no escanear toda la historia: la ventana más ancha que
    -- tenga algún cupo prendido.
    AND vi.completed_at >= p_at - make_interval(days =>
          COALESCE((SELECT MAX(lookback_days) FROM pol WHERE is_enabled), 30))
    AND vi.completed_at < p_at
    AND NOT EXISTS (
      SELECT 1 FROM arca_invoices ai
      WHERE ai.visit_id = vi.id AND ai.environment = 'produccion'
        AND ai.status IN ('pendiente','reservado','emitida','en_duda'))
    AND EXISTS (
      SELECT 1
      FROM contrib c2
      JOIN staff st2 ON st2.id = c2.staff_id
      JOIN pol pl2   ON pl2.taxpayer_id = c2.id
      WHERE pl2.is_enabled
        AND vi.completed_at >= p_at - make_interval(days => COALESCE(pl2.lookback_days, 30))
        AND vi.payment_method::text = ANY (COALESCE(pl2.payment_methods, ARRAY['cash','card','transfer']::text[]))
        AND (pl2.min_ticket IS NULL OR vi.amount >= pl2.min_ticket)
        AND (pl2.max_ticket IS NULL OR vi.amount <= pl2.max_ticket)
        AND CASE COALESCE(pl2.origen, 'propios')
              WHEN 'organizacion' THEN true
              WHEN 'sucursal'     THEN vi.branch_id = st2.branch_id
              ELSE                     vi.barber_id = c2.staff_id
            END)
)
SELECT
  e.id, e.full_name, e.sucursal, e.avatar_url,
  c.id, c.cuit, c.razon_social, c.monotributo_categoria, c.environment,
  (c.certificate_pem IS NOT NULL), (c.csr_pem IS NOT NULL),
  COALESCE(pv.n, 0), COALESCE(pv.n_contingencia, 0), pv.tipo_contingencia,
  c.last_check_ok, c.last_check_at, c.last_check_error,
  pl.id, pl.is_enabled, pl.mode, pl.period, pl.target_count, pl.target_amount,
  pl.selection, pl.payment_methods, pl.include_tips, pl.allow_overflow,
  pl.lookback_days, pl.auto_emit, pl.auto_emit_hour,
  COALESCE(pl.origen, 'propios'),
  COALESCE(f.emitidos_periodo, 0), COALESCE(f.monto_periodo, 0), v.desde, v.hasta,
  COALESCE(f.facturado_mes, 0), COALESCE(f.comprobantes_mes, 0),
  COALESCE(f.facturado_12m, 0), COALESCE(f.comprobantes_12m, 0),
  COALESCE(c.tope_anual_override, mc.tope_anual),
  CASE WHEN COALESCE(c.tope_anual_override, mc.tope_anual) > 0
       THEN ROUND((COALESCE(f.facturado_12m,0) / COALESCE(c.tope_anual_override, mc.tope_anual)) * 100, 1)
       ELSE NULL END,
  -- Se anualiza sobre los días que REALMENTE tiene de historia, no sobre 90 fijos.
  ROUND(COALESCE(f.ultimos_90d, 0) * (365.0 / COALESCE(NULLIF(f.dias_con_historia, 0), 90)), 2),
  COALESCE(pe.cant, 0), COALESCE(pe.monto, 0),
  (SELECT cant FROM pend_org), (SELECT monto FROM pend_org)
FROM equipo e
LEFT JOIN contrib c ON c.staff_id = e.id
LEFT JOIN pv        ON pv.taxpayer_id = c.id
LEFT JOIN pol pl    ON pl.taxpayer_id = c.id
LEFT JOIN ventana v ON v.taxpayer_id = c.id
LEFT JOIN fact f    ON f.taxpayer_id = c.id
LEFT JOIN pend pe   ON pe.taxpayer_id = c.id
LEFT JOIN arca_monotributo_categorias mc ON mc.categoria = c.monotributo_categoria
ORDER BY e.full_name;
$$;

COMMENT ON FUNCTION arca_panel_barberos IS
  'Todo el panel de facturación por barbero en UNA consulta: estado, cupo del período, 12 meses móviles vs tope, y ventas sin facturar con los filtros de SU cupo.';

-- Los grants se re-otorgan SÍ O SÍ: `DROP FUNCTION` se lleva los permisos con
-- él, y `arca_quota_state_params` se dropeó más arriba para cambiarle la firma.
-- Sin esto, el `leerCupo` del motor empezaría a fallar con "permission denied".
REVOKE ALL ON FUNCTION arca_panel_barberos       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_pv_sirve_para_cae    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_quota_state_params   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_quota_state          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_panel_barberos    TO service_role;
GRANT EXECUTE ON FUNCTION arca_pv_sirve_para_cae TO service_role;
GRANT EXECUTE ON FUNCTION arca_quota_state_params TO service_role;
GRANT EXECUTE ON FUNCTION arca_quota_state       TO service_role;

