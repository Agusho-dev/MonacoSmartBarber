-- =============================================================================
-- 185_arca_origen_de_las_ventas.sql
-- De DÓNDE salen los cortes que factura cada monotributo.
--
-- EL PROBLEMA
-- -----------
-- Hasta acá, cada monotributo facturaba únicamente los cortes de SU barbero
-- (`visits.barber_id`). Para los que cortan todo el día está bien, pero deja
-- afuera justamente a los dueños:
--
--   Tony ramirez: 112 cortes propios = $1.648.000 en 12 meses,
--                 contra un tope de categoría F de $45.151.659.
--
-- O sea: su monotributo queda sin usar no porque no haya facturación en el
-- local, sino porque él no es quien sostiene la tijera. Y el local factura
-- ~$492M al año que hay que repartir entre los CUIT disponibles.
--
-- LA SOLUCIÓN
-- -----------
-- Cada cupo declara su ORIGEN:
--
--   'propios'      → sólo los cortes de su barbero (default, lo de antes)
--   'sucursal'     → cualquier corte de su sucursal
--   'organizacion' → cualquier corte del local, sin importar quién lo hizo
--
-- El reparto lo hace el motor solo: una venta se factura UNA vez (índice único
-- por visita), así que las políticas compiten por el mismo conjunto y el orden
-- importa. Por eso hay `prioridad`, y por eso el default la ordena sola:
--
--   primero 'propios' (100) → cada barbero se lleva lo suyo
--   después el pool  (200) → los dueños absorben lo que quedó sin facturar
--
-- Ese orden no es caprichoso: es el que hace que el sistema se auto-balancee.
-- Si un barbero tiene cupo chico, sobra más para el pool; si tiene cupo grande,
-- sobra menos. Nadie tiene que recalcular nada a mano.
-- =============================================================================

ALTER TABLE arca_billing_policies
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'propios',
  ADD COLUMN IF NOT EXISTS prioridad integer NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arca_policy_origen_check') THEN
    ALTER TABLE arca_billing_policies
      ADD CONSTRAINT arca_policy_origen_check
      CHECK (origen IN ('propios', 'sucursal', 'organizacion'));
  END IF;
END $$;

COMMENT ON COLUMN arca_billing_policies.origen IS
  'De dónde salen las ventas: propios = las de su barbero; sucursal / organizacion = del pool, para quien factura sin cortar.';
COMMENT ON COLUMN arca_billing_policies.prioridad IS
  'Orden de ejecución. Menor corre antes. Los cupos "propios" van 100 y el pool 200: cada barbero se lleva lo suyo y los dueños absorben el resto.';

-- Los que toman del pool corren después. Se ajusta solo al cambiar el origen.
CREATE OR REPLACE FUNCTION arca_policy_prioridad_por_origen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origen IS DISTINCT FROM OLD.origen OR TG_OP = 'INSERT' THEN
    NEW.prioridad := CASE WHEN NEW.origen = 'propios' THEN 100 ELSE 200 END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_arca_policy_prioridad ON arca_billing_policies;
CREATE TRIGGER trg_arca_policy_prioridad
  BEFORE INSERT OR UPDATE ON arca_billing_policies
  FOR EACH ROW EXECUTE FUNCTION arca_policy_prioridad_por_origen();

-- -----------------------------------------------------------------------------
-- El panel tiene que mostrar el pendiente que le corresponde a CADA origen
--
-- Con `origen = 'organizacion'`, "sin facturar" de Tony no son sus 3 cortes:
-- es todo lo que el local tiene sin comprobante. Mostrarle sus 3 sería decirle
-- que no tiene nada para facturar cuando en realidad tiene el local entero.
-- -----------------------------------------------------------------------------
-- Se dropea antes: agregar una columna al RETURNS TABLE cambia el tipo de
-- retorno, y `CREATE OR REPLACE` no puede hacerlo (42P13).
DROP FUNCTION IF EXISTS arca_panel_barberos(uuid, uuid[], timestamptz);

CREATE OR REPLACE FUNCTION arca_panel_barberos(
  p_organization_id uuid, p_branch_ids uuid[], p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  staff_id uuid, nombre text, sucursal text, avatar_url text,
  taxpayer_id uuid, cuit text, razon_social text, categoria text, environment text,
  tiene_certificado boolean, tiene_csr boolean, puntos_venta integer,
  last_check_ok boolean, last_check_at timestamptz, last_check_error text,
  policy_id uuid, policy_enabled boolean, modo text, periodo text,
  target_count integer, target_amount numeric, selection text, payment_methods text[],
  include_tips boolean, allow_overflow boolean, lookback_days integer,
  auto_emit boolean, auto_emit_hour smallint, origen text,
  emitidos_periodo integer, monto_periodo numeric, periodo_desde date, periodo_hasta date,
  facturado_12m numeric, comprobantes_12m integer, tope_anual numeric,
  porcentaje_anual numeric, proyectado_anual numeric,
  sin_facturar_cant integer, sin_facturar_monto numeric
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
  SELECT sp.taxpayer_id, count(*)::integer AS n FROM arca_sales_points sp
  WHERE sp.organization_id = p_organization_id AND sp.is_active GROUP BY sp.taxpayer_id
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
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months'), 0) AS facturado_12m,
    count(*) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '12 months')::integer AS comprobantes_12m,
    COALESCE(SUM(i.imp_total) FILTER (WHERE i.fecha_cbte > (SELECT d FROM hoy) - interval '90 days'), 0) AS ultimos_90d
  FROM arca_invoices i
  LEFT JOIN ventana v ON v.taxpayer_id = i.taxpayer_id
  WHERE i.organization_id = p_organization_id AND i.environment = 'produccion'
    AND i.status IN ('reservado','emitida','en_duda') AND i.cbte_tipo NOT IN (3,8,13,53)
  GROUP BY i.taxpayer_id
),
-- Ventas sin comprobante. Se calculan las dos vistas: la del barbero y la del
-- local entero, y después cada fila toma la que le corresponde por su origen.
sin_fact AS (
  SELECT vi.barber_id, vi.branch_id, vi.amount, vi.tip_amount
  FROM visits vi
  WHERE vi.organization_id = p_organization_id
    AND vi.amount > 0
    AND vi.completed_at >= p_at - interval '30 days'
    AND vi.completed_at <  p_at
    AND NOT EXISTS (
      SELECT 1 FROM arca_invoices ai
      WHERE ai.visit_id = vi.id AND ai.environment = 'produccion'
        AND ai.status IN ('pendiente','reservado','emitida','en_duda'))
),
pend_propio AS (
  SELECT barber_id, count(*)::integer AS cant, COALESCE(SUM(amount), 0) AS monto
  FROM sin_fact GROUP BY barber_id
),
pend_sucursal AS (
  SELECT branch_id, count(*)::integer AS cant, COALESCE(SUM(amount), 0) AS monto
  FROM sin_fact GROUP BY branch_id
),
pend_org AS (
  SELECT count(*)::integer AS cant, COALESCE(SUM(amount), 0) AS monto FROM sin_fact
)
SELECT
  e.id, e.full_name, e.sucursal, e.avatar_url,
  c.id, c.cuit, c.razon_social, c.monotributo_categoria, c.environment,
  (c.certificate_pem IS NOT NULL), (c.csr_pem IS NOT NULL), COALESCE(pv.n, 0),
  c.last_check_ok, c.last_check_at, c.last_check_error,
  pl.id, pl.is_enabled, pl.mode, pl.period, pl.target_count, pl.target_amount,
  pl.selection, pl.payment_methods, pl.include_tips, pl.allow_overflow,
  pl.lookback_days, pl.auto_emit, pl.auto_emit_hour,
  COALESCE(pl.origen, 'propios'),
  COALESCE(f.emitidos_periodo, 0), COALESCE(f.monto_periodo, 0), v.desde, v.hasta,
  COALESCE(f.facturado_12m, 0), COALESCE(f.comprobantes_12m, 0),
  COALESCE(c.tope_anual_override, mc.tope_anual),
  CASE WHEN COALESCE(c.tope_anual_override, mc.tope_anual) > 0
       THEN ROUND((COALESCE(f.facturado_12m,0) / COALESCE(c.tope_anual_override, mc.tope_anual)) * 100, 1)
       ELSE NULL END,
  ROUND(COALESCE(f.ultimos_90d, 0) * (365.0 / 90.0), 2),
  CASE COALESCE(pl.origen, 'propios')
    WHEN 'organizacion' THEN (SELECT cant FROM pend_org)
    WHEN 'sucursal'     THEN COALESCE(ps.cant, 0)
    ELSE COALESCE(pp.cant, 0) END,
  CASE COALESCE(pl.origen, 'propios')
    WHEN 'organizacion' THEN (SELECT monto FROM pend_org)
    WHEN 'sucursal'     THEN COALESCE(ps.monto, 0)
    ELSE COALESCE(pp.monto, 0) END
FROM equipo e
LEFT JOIN contrib c        ON c.staff_id = e.id
LEFT JOIN pv               ON pv.taxpayer_id = c.id
LEFT JOIN pol pl           ON pl.taxpayer_id = c.id
LEFT JOIN ventana v        ON v.taxpayer_id = c.id
LEFT JOIN fact f           ON f.taxpayer_id = c.id
LEFT JOIN pend_propio pp   ON pp.barber_id = e.id
LEFT JOIN pend_sucursal ps ON ps.branch_id = e.branch_id
LEFT JOIN arca_monotributo_categorias mc ON mc.categoria = c.monotributo_categoria
ORDER BY e.full_name;
$$;

REVOKE ALL ON FUNCTION arca_panel_barberos FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_panel_barberos TO service_role;
