-- APLICADA en prod el 3/10/2026 (schema_migrations 20261003222512 «216_productos_policies_anon»).
-- 216 — Productos: las policies "de staff" dejan de aplicarse a `anon`
-- Desde la 212/212b (4/9/2026) `anon` no tiene SELECT sobre staff.auth_user_id/email/pin.
-- Estas cuatro policies eran TO public y comparaban staff.auth_user_id con auth.uid()
-- en una subconsulta: Postgres las planifica también para `anon`, exige permiso sobre
-- esa columna y TODA lectura de products con la anon key cortaba con 42501
-- "permission denied for table staff" (PostgREST 401). El panel tragaba el error:
-- lista vacía y cero ventas de productos desde el 4/9.
-- Para `anon` esas policies son siempre falsas (auth.uid() es NULL), así que sacarlas
-- de su alcance no cambia lo que ve ni lo que escribe nadie; para `authenticated` el
-- USING es idéntico.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER POLICY "Products are viewable by all staff of the branch"
  ON public.products TO authenticated;
ALTER POLICY "Products are editable by admins of the branch"
  ON public.products TO authenticated;
ALTER POLICY "Product sales are viewable by all staff of the branch"
  ON public.product_sales TO authenticated;
ALTER POLICY "Product sales are editable by admins and barbers"
  ON public.product_sales TO authenticated;

-- product_sales.payment_method nunca se escribía (default 'cash'): se copia el de la
-- visita a la que pertenece cada línea.
UPDATE public.product_sales ps
   SET payment_method = v.payment_method
  FROM public.visits v
 WHERE v.id = ps.visit_id
   AND v.payment_method IS NOT NULL
   AND ps.payment_method IS DISTINCT FROM v.payment_method;

-- Autoverificación: si anon todavía no puede planificar estas lecturas, la migración
-- se aborta entera.
DO $$
BEGIN
  SET LOCAL ROLE anon;
  EXECUTE 'EXPLAIN SELECT * FROM public.products WHERE is_active';
  EXECUTE 'EXPLAIN SELECT * FROM public.product_sales';
  RESET ROLE;
END $$;

COMMIT;
