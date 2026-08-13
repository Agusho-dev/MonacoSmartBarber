-- =============================================================================
-- 184_arca_panel_rpc.sql
-- El panel completo en UNA consulta.
--
-- POR QUÉ
-- -------
-- La primera versión de `getPanelFacturacion` armaba el panel en TypeScript:
-- por cada barbero, una llamada a `arca_quota_state`, otra a
-- `arca_taxpayer_annual_state` y otra a `arca_billing_candidates`. Con 20
-- barberos son 60 idas y vueltas a Supabase — medidas, entre 6 y 10 segundos
-- de pantalla en blanco. Para el tablero que los dueños van a abrir todos los
-- días, eso no sirve.
--
-- Acá va todo junto: identidad del barbero, estado de su configuración, cupo
-- del período, 12 meses móviles contra el tope, y cuánto tiene sin facturar.
-- Una llamada.
--
-- El cálculo del período y de los 12 meses se hace igual que en las funciones
-- de a una (`arca_quota_state`, `arca_taxpayer_annual_state`) — mismas reglas,
-- misma zona horaria, mismos estados que cuentan. Si algún día cambia una,
-- tiene que cambiar la otra: es el precio de la velocidad y queda anotado acá.
-- =============================================================================

CREATE OR REPLACE FUNCTION arca_panel_barberos(
  p_organization_id uuid,
  p_branch_ids      uuid[],
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (
  staff_id            uuid,
  nombre              text,
  sucursal            text,
  avatar_url          text,
  taxpayer_id         uuid,
  cuit                text,
  razon_social        text,
  categoria           text,
  environment         text,
  tiene_certificado   boolean,
  tiene_csr           boolean,
  puntos_venta        integer,
  last_check_ok       boolean,
  last_check_at       timestamptz,
  last_check_error    text,
  policy_id           uuid,
  policy_enabled      boolean,
  modo                text,
  periodo             text,
  target_count        integer,
  target_amount       numeric,
  selection           text,
  payment_methods     text[],
  include_tips        boolean,
  allow_overflow      boolean,
  lookback_days       integer,
  auto_emit           boolean,
  auto_emit_hour      smallint,
  emitidos_periodo    integer,
  monto_periodo       numeric,
  periodo_desde       date,
  periodo_hasta       date,
  facturado_12m       numeric,
  comprobantes_12m    integer,
  tope_anual          numeric,
  porcentaje_anual    numeric,
  proyectado_anual    numeric,
  sin_facturar_cant   integer,
  sin_facturar_monto  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH tz AS (
  SELECT COALESCE((SELECT o.timezone FROM organizations o WHERE o.id = p_organization_id),
                  'America/Argentina/Buenos_Aires') AS zona
),
hoy AS (
  SELECT (p_at AT TIME ZONE (SELECT zona FROM tz))::date AS d
),
-- El equipo: barberos y quien además atiende (dueños que cortan).
equipo AS (
  SELECT s.id, s.full_name, s.avatar_url, s.branch_id, b.name AS sucursal
  FROM staff s
  JOIN branches b ON b.id = s.branch_id
  WHERE s.organization_id = p_organization_id
    AND (p_branch_ids IS NULL OR s.branch_id = ANY (p_branch_ids))
    AND s.is_active AND s.deleted_at IS NULL
    AND (s.role = 'barber' OR s.is_also_barber = true)
),
-- Un monotributo por barbero: producción si existe, si no homologación.
contrib AS (
  SELECT DISTINCT ON (t.staff_id) t.*
  FROM arca_taxpayers t
  WHERE t.organization_id = p_organization_id AND t.is_active AND t.staff_id IS NOT NULL
  ORDER BY t.staff_id, (t.environment = 'produccion') DESC
),
pv AS (
  SELECT sp.taxpayer_id, count(*)::integer AS n
  FROM arca_sales_points sp
  WHERE sp.organization_id = p_organization_id AND sp.is_active
  GROUP BY sp.taxpayer_id
),
pol AS (
  SELECT p.* FROM arca_billing_policies p
  WHERE p.organization_id = p_organization_id AND p.taxpayer_id IS NOT NULL
),
-- Límites del período del cupo, por política.
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
-- Facturación del período vigente y de los 12 meses móviles, en una pasada.
fact AS (
  SELECT i.taxpayer_id,
    count(*) FILTER (WHERE i.fecha_cbte >= v.desde AND i.fecha_cbte < v.hasta)::integer AS emitidos_periodo,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte >= v.desde AND i.fecha_cbte < v.hasta), 0) AS monto_periodo,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months'), 0) AS facturado_12m,
    count(*) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months')::integer AS comprobantes_12m,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '90 days'), 0) AS ultimos_90d
  FROM arca_invoices i
  LEFT JOIN ventana v ON v.taxpayer_id = i.taxpayer_id
  WHERE i.organization_id = p_organization_id
    AND i.environment = 'produccion'
    AND i.status IN ('reservado','emitida','en_duda')
    AND i.cbte_tipo NOT IN (3, 8, 13, 53)
  GROUP BY i.taxpayer_id
),
-- Ventas sin comprobante, por barbero, respetando los filtros de SU cupo.
pendiente AS (
  SELECT vi.barber_id,
    count(*)::integer AS cant,
    COALESCE(SUM(vi.amount + CASE WHEN COALESCE(pl.include_tips, false) THEN vi.tip_amount ELSE 0 END), 0) AS monto
  FROM visits vi
  JOIN equipo e ON e.id = vi.barber_id
  LEFT JOIN contrib c ON c.staff_id = vi.barber_id
  LEFT JOIN pol pl    ON pl.taxpayer_id = c.id
  WHERE vi.organization_id = p_organization_id
    AND vi.amount > 0
    AND vi.completed_at >= p_at - make_interval(days => COALESCE(pl.lookback_days, 30))
    AND vi.completed_at <  p_at
    AND vi.payment_method::text = ANY (COALESCE(pl.payment_methods, ARRAY['cash','card','transfer']::text[]))
    AND (pl.min_ticket IS NULL OR vi.amount >= pl.min_ticket)
    AND (pl.max_ticket IS NULL OR vi.amount <= pl.max_ticket)
    AND NOT EXISTS (
      SELECT 1 FROM arca_invoices ai
      WHERE ai.visit_id = vi.id
        AND ai.environment = COALESCE(c.environment, 'produccion')
        AND ai.status IN ('pendiente','reservado','emitida','en_duda'))
  GROUP BY vi.barber_id
)
SELECT
  e.id, e.full_name, e.sucursal, e.avatar_url,
  c.id, c.cuit, c.razon_social, c.monotributo_categoria, c.environment,
  (c.certificate_pem IS NOT NULL), (c.csr_pem IS NOT NULL), COALESCE(pv.n, 0),
  c.last_check_ok, c.last_check_at, c.last_check_error,
  pl.id, pl.is_enabled, pl.mode, pl.period, pl.target_count, pl.target_amount,
  pl.selection, pl.payment_methods, pl.include_tips, pl.allow_overflow,
  pl.lookback_days, pl.auto_emit, pl.auto_emit_hour,
  COALESCE(f.emitidos_periodo, 0), COALESCE(f.monto_periodo, 0), v.desde, v.hasta,
  COALESCE(f.facturado_12m, 0), COALESCE(f.comprobantes_12m, 0),
  COALESCE(c.tope_anual_override, mc.tope_anual) AS tope,
  CASE WHEN COALESCE(c.tope_anual_override, mc.tope_anual) > 0
       THEN ROUND((COALESCE(f.facturado_12m, 0) / COALESCE(c.tope_anual_override, mc.tope_anual)) * 100, 1)
       ELSE NULL END,
  ROUND(COALESCE(f.ultimos_90d, 0) * (365.0 / 90.0), 2),
  COALESCE(p.cant, 0), COALESCE(p.monto, 0)
FROM equipo e
LEFT JOIN contrib c   ON c.staff_id = e.id
LEFT JOIN pv          ON pv.taxpayer_id = c.id
LEFT JOIN pol pl      ON pl.taxpayer_id = c.id
LEFT JOIN ventana v   ON v.taxpayer_id = c.id
LEFT JOIN fact f      ON f.taxpayer_id = c.id
LEFT JOIN pendiente p ON p.barber_id = e.id
LEFT JOIN arca_monotributo_categorias mc ON mc.categoria = c.monotributo_categoria
ORDER BY e.full_name;
$$;

COMMENT ON FUNCTION arca_panel_barberos IS
  'Todo el panel de facturación por barbero en UNA consulta: estado, cupo del período, 12 meses móviles vs tope, y ventas sin facturar.';

REVOKE ALL ON FUNCTION arca_panel_barberos FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_panel_barberos TO service_role;
