-- ═══════════════════════════════════════════════════════════════════════════
-- 194 — Categoría de premio (chips de la pantalla Premios de la app)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La app agrupa los premios en tres solapas: Cortes · Merch · Marcas.
--   · "Cortes"  = servicios de la barbería (corte gratis, 20% off en el corte)
--   · "Merch"   = productos (gorra, remera, café, gaseosa)
--   · "Marcas"  = convenios con comercios aliados (`partner_benefits`), que NO
--                 viven en esta tabla: la app los inyecta con esa categoría fija.
--
-- La app DERIVA la categoría cuando esta columna es NULL:
--     is_free_service = true  OR discount_pct > 0  →  cortes
--     el resto                                     →  merch
-- Esta columna es el OVERRIDE manual desde /dashboard/app-movil, para cuando la
-- heurística se equivoca (un premio "1 mes de cortes" cargado como producto, o
-- una gorra con descuento). Nace NULL a propósito: sin cargar nada, la app ya
-- clasifica bien todo el catálogo actual.
--
-- No se hace backfill: escribir hoy la heurística en la columna la congelaría, y
-- el día que se corrija la regla las filas viejas quedarían con la vieja.

ALTER TABLE reward_catalog
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_catalog_category_check'
  ) THEN
    ALTER TABLE reward_catalog
      ADD CONSTRAINT reward_catalog_category_check
      CHECK (category IS NULL OR category IN ('cortes', 'merch'));
  END IF;
END $$;

COMMENT ON COLUMN reward_catalog.category IS
  'Override manual de la categoría que muestra la app (cortes|merch). NULL = la '
  'app la deriva de is_free_service/discount_pct. "marcas" no va acá: son los '
  'convenios de partner_benefits.';

-- ═══════════════════════════════════════════════════════════════════════════
-- get_client_wallet — sumar imagen, costo y categoría
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tira "Listos para usar" de la app dibuja los premios canjeados con la misma
-- tarjeta ilustrada del catálogo. La RPC devolvía sólo texto, así que esas
-- tarjetas no podían mostrar la foto del premio ni saber a qué chip pertenecen.
--
-- Se agregan columnas al FINAL del TABLE(): los consumidores leen por nombre de
-- clave (la app Flutter mapea `Map<String, dynamic>`), así que agregar no rompe.

DROP FUNCTION IF EXISTS public.get_client_wallet();

CREATE OR REPLACE FUNCTION public.get_client_wallet()
RETURNS TABLE(
  reward_id uuid,
  client_reward_id uuid,
  reward_name text,
  reward_description text,
  reward_type reward_type,
  discount_pct integer,
  is_free_service boolean,
  status client_reward_status,
  qr_code text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone,
  image_url text,
  points_cost integer,
  category text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT rc.id, cr.id, rc.name, rc.description, rc.type, rc.discount_pct, rc.is_free_service,
         cr.status, cr.qr_code, cr.expires_at, cr.created_at,
         rc.image_url, rc.points_cost, rc.category
  FROM client_rewards cr
  JOIN reward_catalog rc ON rc.id = cr.reward_id
  WHERE cr.client_id = public.current_client_id()
  ORDER BY cr.created_at DESC;
$function$;

-- El DROP se lleva los grants: se reponen los mismos que tenía (menos PUBLIC,
-- que era redundante con anon+authenticated). NO se le saca el EXECUTE a `anon`
-- a propósito: cambiar la superficie de permisos no es parte de este cambio de
-- UI, y la función ya falla cerrada para un anónimo (`current_client_id()`
-- resuelve por `auth.uid()` y devuelve NULL → cero filas).
GRANT EXECUTE ON FUNCTION public.get_client_wallet() TO anon, authenticated, service_role;
