-- =============================================================================
-- 189 — La proyección anual necesita un piso de historia
--
-- La 188 arregló que la proyección dividiera SIEMPRE por 90 días (con lo que un
-- CUIT nuevo daba verde con un ritmo muy por encima del tope). Pero al dividir
-- por los días reales se pasó al otro extremo: los monotributos de Monaco
-- arrancaron el 13/8/2026, así que hoy anualizaría sobre 4 días de historia y le
-- diría al dueño que Nico cierra en $43.070.000 contra un tope de $24.670.494.
--
-- Anualizar 4 días no es una proyección, es ruido multiplicado por 91: un día con
-- dos cortes de más mueve el cierre estimado varios millones. Y esa cifra alimenta
-- el bloque de alerta del panel, o sea que grita "se pasa del tope" sin fundamento.
--
-- Con menos de 14 días de historia la respuesta honesta es NULL, "todavía no
-- sabemos". El TypeScript lo distingue de 0 y la ficha del barbero lo dice con
-- palabras en vez de imprimir "cierra el año en $0", que se lee como una promesa
-- de que NO se pasa. El porcentaje sobre lo YA facturado —que es un hecho, no una
-- estimación— sigue funcionando igual.
--
-- Se aplicó junto con la 188 el 18/8/2026.
-- =============================================================================

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
  -- PISO DE HISTORIA: con menos de 14 días no se proyecta. Anualizar 4 días es
  -- multiplicar el ruido por 91, y esa cifra dispara el bloque de alerta.
  CASE WHEN COALESCE(f.dias_con_historia, 0) >= 14
       THEN ROUND(COALESCE(f.ultimos_90d, 0) * (365.0 / f.dias_con_historia), 2)
       ELSE NULL END,
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
  'Todo el panel de facturación por barbero en UNA consulta. La proyección anual es NULL con menos de 14 días de historia: anualizar 4 días es ruido, no estimación.';

REVOKE ALL ON FUNCTION arca_panel_barberos    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_panel_barberos TO service_role;
