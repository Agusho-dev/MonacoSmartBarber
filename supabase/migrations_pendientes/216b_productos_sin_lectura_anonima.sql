-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- 216b — products deja de ser legible con la anon key
-- ============================================================================
-- APLICAR DESPUÉS DEL GATE. NO ANTES DEL DEPLOY.
--
-- products_public_read (SELECT, TO public, USING is_active = true) deja leer
-- con la anon key —la que viaja en el bundle de cualquier página pública— el
-- catálogo activo de TODAS las organizaciones, con costo y comisión por unidad
-- (medido el 3/10/2026: anon ve los 7 productos activos de Monaco, los 7 con
-- `cost`). Existía porque el panel del barbero leía products desde el browser
-- con la anon key. Desde este deploy la lista sale de un server action
-- (listarProductosParaCobro: sesión + service role, sin costo ni comisión) y no
-- queda ningún lector anónimo legítimo.
--
-- Qué NO cambia:
--  · El dashboard autenticado sigue viendo los productos de su organización por
--    products_read_by_org (get_user_org_id) y por las dos policies "de staff"
--    que la 216 pasó a TO authenticated.
--  · service_role no pasa por RLS: el panel, la venta directa y el cobro siguen
--    andando igual.
--  · No se revocan GRANTs de tabla a anon (KR#34): sin policy que lo habilite,
--    anon recibe 200 con [] — no un 42501 que rompa algún embed olvidado.
--
-- GATE (obligatorio). Si se aplica antes de que las TRES tablets recarguen el
-- bundle nuevo, el bundle viejo vuelve a ver la lista vacía EN SILENCIO —es
-- exactamente la rotura del 4/9—. Antes de aplicar:
--  1) Confirmar que el commit llegó a producción (monacobarber.vercel.app lo
--     deploya Trinkmax/monaco.barber) y recargar las tres tablets.
--  2) Correr en query_logs, sobre una ventana de 24 h de local abierto (9 a 21),
--     y exigir 0 filas:
--
--       select log_attributes['request.method'] as metodo,
--              log_attributes['response.status_code'] as status,
--              count(*) as n
--         from logs
--        where source = 'edge_logs'
--          and log_attributes['request.sb.jwt.authorization.payload.role'] = 'anon'
--          and log_attributes['request.method'] <> 'OPTIONS'
--          and log_attributes['request.path'] in ('/rest/v1/products', '/rest/v1/product_sales')
--        group by 1, 2
--
--     Línea de base del 3/10/2026 (últimas 24 h): 139 GET anon con 401 (antes de
--     la 216) y 4 con 200 (después). Con el bundle nuevo tiene que dar 0.
--
-- Se puede aplicar en horario: DROP POLICY toma un lock breve sólo sobre
-- products (tabla fría) y el lock_timeout lo acota.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS products_public_read ON public.products;

-- Autoverificación: anon ya no ve ningún producto (ni activo ni inactivo) y
-- la lectura sigue planificándose sin 42501 (si aparece un error de permisos
-- acá, la migración se aborta entera en vez de quedar "aplicada" y rota).
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.products;
  IF n <> 0 THEN
    RAISE EXCEPTION '216b: anon todavía ve % productos', n;
  END IF;
  SELECT count(*) INTO n FROM public.product_sales;
  IF n <> 0 THEN
    RAISE EXCEPTION '216b: anon todavía ve % ventas de productos', n;
  END IF;
  RESET ROLE;
END $$;

COMMIT;

-- ============================================================================
-- Verificación post-aplicación
-- ============================================================================
-- · curl -G "$URL/rest/v1/products" --data-urlencode "select=id,name" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"      → 200 []
-- · Las tres tablets siguen listando productos en la venta directa y en el
--   cobro (server action, no depende de esta policy).
-- · El dashboard (Servicios y Productos) sigue mostrando el catálogo de la org.
-- · query_logs: 0 nuevos 42501 sobre products en postgres_logs.
--
-- Rollback (vuelve a exponer el catálogo con costo a la anon key):
--   CREATE POLICY products_public_read ON public.products
--     FOR SELECT TO public USING (is_active = true);
