-- APLICADA en prod el 4/10/2026 (schema_migrations «220_venta_productos_atomica»).
-- ============================================================================
-- 220 — Venta de productos: un solo motor, atómico e idempotente
-- ============================================================================
-- Hasta acá la venta de productos se escribía desde TypeScript en cuatro pasos
-- sueltos, y cada uno podía fallar sin que el siguiente se enterara:
--
--  · El stock se descontaba ANTES de registrar la venta, leyendo y escribiendo
--    por separado: si el insert de product_sales fallaba, el stock ya había
--    bajado; dos ventas simultáneas del mismo producto perdían un descuento.
--  · La venta directa insertaba la visita "fantasma", después el detalle,
--    después el stock y por último la comisión: sin clave de idempotencia, un
--    reintento tras el timeout de 8 s (KR#12) duplicaba caja, stock y comisión.
--  · La comisión del día se sumaba con lectura-modificación-escritura y sin
--    mirar el error: contra el índice único idx_sr_staff_date_product_commission_unique
--    (staff, día, tipo — sin sucursal ni estado), un reporte ya liquidado ese día
--    hacía fallar el INSERT con 23505 y la comisión se perdía en silencio.
--
-- Esta migración deja dos RPC, las dos SECURITY DEFINER y SÓLO para
-- service_role (el panel del barbero entra por PIN + cookie; la sesión la
-- valida el server action antes de llamarlas, nunca el browser):
--
--  · registrar_productos_de_visita(visita, items, método): las líneas de
--    productos de un COBRO (completeService). Una vez por visita.
--  · registrar_venta_directa_productos(clave, sucursal, barbero, método,
--    cuenta, items): la venta sin corte, completa e IDEMPOTENTE por clave
--    (un uuid por apertura del diálogo): misma clave = misma respuesta, sin
--    duplicar visita, detalle, stock ni comisión.
--
-- Las dos comparten tres helpers internos (validar, escribir, sumar comisión)
-- que no se pueden llamar desde afuera: así hay UNA regla de qué es una línea
-- válida y cómo se descuenta el stock.
--
-- El código TypeScript funciona con o sin esta migración: si la RPC no existe
-- (PGRST202 / 42883) usa el camino TS endurecido. Por eso se puede aplicar
-- antes o después del deploy, en cualquier horario: sólo CREA objetos nuevos
-- (una tabla sin FKs y cinco funciones), no toca tablas existentes.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1) Claves de idempotencia de la venta directa
-- ----------------------------------------------------------------------------
-- Sin FKs a propósito: una FK nueva hacia visits/branches toma un lock sobre
-- tablas calientes al crearse y suma relaciones al caché de PostgREST (KR#15).
-- La clave sólo tiene que vivir lo que dura un reintento; si la visita se borra
-- después, la fila queda como registro inofensivo.
CREATE TABLE IF NOT EXISTS public.ventas_directas_claves (
  clave           uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  branch_id       uuid NOT NULL,
  visit_id        uuid,
  respuesta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ventas_directas_claves IS
  'Idempotencia de registrar_venta_directa_productos: una fila por intento de venta directa (clave = uuid por apertura del diálogo). Sólo service_role.';

ALTER TABLE public.ventas_directas_claves ENABLE ROW LEVEL SECURITY;
-- Supabase da ALL a anon/authenticated sobre toda tabla nueva (default ACL):
-- sin este REVOKE, la RLS sin policies sería la única barrera.
REVOKE ALL ON TABLE public.ventas_directas_claves FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ventas_directas_claves TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Helper interno: valida las líneas y BLOQUEA los productos
-- ----------------------------------------------------------------------------
-- Una línea es {"id": "<uuid>", "quantity": <entero 1..20>}. Las repetidas se
-- suman (el tope se mide sobre la suma). Devuelve {ok, error} o {ok, lineas,
-- total, comision}. Los productos quedan bloqueados FOR UPDATE, en orden de id
-- (dos ventas con productos en común toman los locks en el mismo orden: sin
-- deadlock), hasta el final de la transacción de la RPC que lo llamó: el
-- descuento de stock que sigue no puede perder una venta concurrente.
-- p_solo_activos = false para el cobro: el server action ya validó is_active
-- segundos antes de cerrar la entrada, y en ese punto el cliente ya pagó —
-- rechazar ahí por un producto desactivado en el medio sólo descuadraría caja.
CREATE OR REPLACE FUNCTION public.productos_validar_lineas(
  p_branch_id    uuid,
  p_items        jsonb,
  p_solo_activos boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lineas      jsonb;
  v_pedidos     int;
  v_encontrados int;
  v_total       numeric;
  v_comision    numeric;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin_productos');
  END IF;

  IF jsonb_array_length(p_items) > 30 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiados_productos');
  END IF;

  -- La forma se valida ANTES de castear: un uuid mal formado abortaría la
  -- transacción con 22P02 en vez de devolver un motivo. IS DISTINCT FROM y
  -- COALESCE porque una clave ausente da NULL, y un NULL dentro del OR haría
  -- que la línea rota pasara como válida.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) e
     WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
        OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
        OR NOT COALESCE((e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
        OR jsonb_typeof(e->'quantity') IS DISTINCT FROM 'number'
        OR NOT COALESCE((e->>'quantity') ~ '^[0-9]{1,3}$', false)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'linea_invalida');
  END IF;

  -- Bloqueo en una sentencia propia: un FOR UPDATE dentro de un CTE puede no
  -- evaluarse si el planner no lo necesita.
  PERFORM 1
     FROM products p
    WHERE p.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_items) e)
      AND p.branch_id = p_branch_id
    ORDER BY p.id
      FOR UPDATE;

  WITH pedidas AS (
    SELECT (e->>'id')::uuid AS product_id, sum((e->>'quantity')::int) AS cantidad
      FROM jsonb_array_elements(p_items) e
     GROUP BY 1
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'product_id', q.product_id,
        'nombre',     p.name,
        'cantidad',   q.cantidad,
        'activo',     COALESCE(p.is_active, false),
        'precio',     p.sale_price
      ) ORDER BY q.product_id
    ),
    count(*),
    count(p.id),
    sum(p.sale_price * q.cantidad),
    sum(p.barber_commission * q.cantidad)
    INTO v_lineas, v_pedidos, v_encontrados, v_total, v_comision
    FROM pedidas q
    LEFT JOIN products p ON p.id = q.product_id AND p.branch_id = p_branch_id;

  -- Un id de otra sucursal u otra organización cuenta como inexistente.
  IF v_encontrados < v_pedidos THEN
    RETURN jsonb_build_object('ok', false, 'error', 'producto_no_disponible');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lineas) l
     WHERE (l->>'cantidad')::int NOT BETWEEN 1 AND 20
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cantidad_invalida');
  END IF;

  IF p_solo_activos AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lineas) l WHERE NOT (l->>'activo')::boolean
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'producto_no_disponible');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lineas) l WHERE (l->>'precio')::numeric < 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'precio_invalido');
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'lineas',   v_lineas,
    'total',    COALESCE(v_total, 0),
    'comision', COALESCE(v_comision, 0)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3) Helper interno: escribe el detalle y DESPUÉS descuenta el stock
-- ----------------------------------------------------------------------------
-- Precio y comisión se releen de products (bloqueados por el helper anterior):
-- lo que viaja en las líneas es sólo id y cantidad. El stock baja con
-- GREATEST(stock - cantidad, 0) en el mismo UPDATE —atómico, nunca negativo— y
-- un producto sin control de stock (NULL) no se toca. Cualquier error acá aborta
-- la RPC entera: no puede quedar detalle sin stock ni stock sin detalle.
CREATE OR REPLACE FUNCTION public.productos_escribir_lineas(
  p_visit_id       uuid,
  p_branch_id      uuid,
  p_barber_id      uuid,
  p_payment_method text,
  p_lineas         jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH l AS (
    SELECT (x->>'product_id')::uuid AS product_id, (x->>'cantidad')::int AS cantidad
      FROM jsonb_array_elements(p_lineas) x
  )
  INSERT INTO product_sales (
    visit_id, product_id, barber_id, branch_id, quantity,
    unit_price, commission_amount, payment_method
  )
  SELECT p_visit_id, p.id, p_barber_id, p_branch_id, l.cantidad,
         p.sale_price,
         -- Venta de la barbería (sin barbero) = sin comisión.
         CASE WHEN p_barber_id IS NULL THEN 0 ELSE p.barber_commission * l.cantidad END,
         p_payment_method::payment_method
    FROM l
    JOIN products p ON p.id = l.product_id AND p.branch_id = p_branch_id;

  WITH l AS (
    SELECT (x->>'product_id')::uuid AS product_id, (x->>'cantidad')::int AS cantidad
      FROM jsonb_array_elements(p_lineas) x
  )
  UPDATE products p
     SET stock = GREATEST(p.stock - l.cantidad, 0)
    FROM l
   WHERE p.id = l.product_id
     AND p.branch_id = p_branch_id
     AND p.stock IS NOT NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4) Helper interno: suma la comisión al reporte pendiente del día
-- ----------------------------------------------------------------------------
-- El índice único es (staff, día, tipo): no admite un segundo reporte del mismo
-- día aunque el primero esté liquidado o sea de otra sucursal. En esos dos casos
-- NO se pisa nada (sumarle a un reporte pagado sería pagar dos veces; sumarle
-- al de otra sucursal, imputarlo mal): se devuelve el motivo y el server action
-- se lo dice al barbero. La comisión igual queda devengada en
-- visits.commission_amount, que es de donde la lee Finanzas.
-- Devuelve 'sumada' | 'sin_comision' | 'liquidado' | 'otra_sucursal'.
CREATE OR REPLACE FUNCTION public.productos_sumar_comision(
  p_staff_id  uuid,
  p_branch_id uuid,
  p_monto     numeric,
  p_fecha     date
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_status text;
BEGIN
  IF p_staff_id IS NULL OR COALESCE(p_monto, 0) <= 0 THEN
    RETURN 'sin_comision';
  END IF;

  INSERT INTO salary_reports (staff_id, branch_id, type, amount, report_date, status)
  VALUES (p_staff_id, p_branch_id, 'product_commission', p_monto, p_fecha, 'pending')
  ON CONFLICT (staff_id, report_date, type) WHERE type = 'product_commission'
  DO UPDATE SET amount = salary_reports.amount + EXCLUDED.amount
   WHERE salary_reports.status = 'pending'
     AND salary_reports.branch_id = EXCLUDED.branch_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN 'sumada';
  END IF;

  SELECT sr.status INTO v_status
    FROM salary_reports sr
   WHERE sr.staff_id = p_staff_id AND sr.report_date = p_fecha AND sr.type = 'product_commission';
  RETURN CASE WHEN v_status IS DISTINCT FROM 'pending' THEN 'liquidado' ELSE 'otra_sucursal' END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5) RPC: productos de un COBRO (completeService)
-- ----------------------------------------------------------------------------
-- La visita ya existe (la crea el trigger on_queue_completed). El método de
-- pago viaja aparte porque en este punto la visita todavía tiene el default
-- del trigger: completeService la actualiza después.
-- Una visita registra sus productos UNA vez: el advisory lock serializa dos
-- llamadas a la misma visita y la segunda devuelve lo ya registrado.
CREATE OR REPLACE FUNCTION public.registrar_productos_de_visita(
  p_visit_id       uuid,
  p_items          jsonb,
  p_payment_method text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '4s'
AS $$
DECLARE
  v_branch   uuid;
  v_barber   uuid;
  v_tz       text;
  v_val      jsonb;
  v_total    numeric;
  v_comision numeric;
  v_estado   text;
BEGIN
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'metodo_invalido');
  END IF;

  SELECT v.branch_id, v.barber_id INTO v_branch, v_barber
    FROM visits v WHERE v.id = p_visit_id;
  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'visita_no_encontrada');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('registrar_productos_de_visita:' || p_visit_id::text, 0));

  IF EXISTS (SELECT 1 FROM product_sales ps WHERE ps.visit_id = p_visit_id) THEN
    SELECT COALESCE(sum(ps.unit_price * ps.quantity), 0), COALESCE(sum(ps.commission_amount), 0)
      INTO v_total, v_comision
      FROM product_sales ps WHERE ps.visit_id = p_visit_id;
    RETURN jsonb_build_object(
      'success', true, 'ya_registrado', true,
      'total', v_total, 'comision', v_comision, 'comision_estado', 'sumada'
    );
  END IF;

  v_val := productos_validar_lineas(v_branch, p_items, false);
  IF NOT (v_val->>'ok')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', v_val->>'error');
  END IF;

  PERFORM productos_escribir_lineas(p_visit_id, v_branch, v_barber, p_payment_method, v_val->'lineas');

  v_total    := (v_val->>'total')::numeric;
  v_comision := CASE WHEN v_barber IS NULL THEN 0 ELSE (v_val->>'comision')::numeric END;

  -- Día LOCAL de la sucursal (el mismo criterio que fn_visits_sync_tip_report):
  -- con now() en UTC, una venta después de las 21:00 caería en el reporte de mañana.
  SELECT COALESCE(NULLIF(b.timezone, ''), 'America/Argentina/Buenos_Aires') INTO v_tz
    FROM branches b WHERE b.id = v_branch;
  v_estado := productos_sumar_comision(v_barber, v_branch, v_comision, (now() AT TIME ZONE v_tz)::date);

  RETURN jsonb_build_object(
    'success', true, 'ya_registrado', false,
    'total', v_total, 'comision', v_comision, 'comision_estado', v_estado
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6) RPC: venta directa (sin corte), completa e idempotente
-- ----------------------------------------------------------------------------
-- La clave es el semáforo: el INSERT ... ON CONFLICT DO NOTHING hace esperar a
-- una segunda llamada con la misma clave hasta que la primera termine, y
-- después le devuelve la respuesta guardada. Si la venta no procede (producto
-- inválido, cuenta dada de baja…) la clave se libera en la misma transacción:
-- el barbero corrige y reintenta con la MISMA clave sin chocar contra su
-- propio intento fallido.
-- La visita "fantasma" lleva exactamente los campos que escribía sales.ts:
-- sin cliente, sin servicio y sin queue_entry_id (por eso esCorte() la cuenta
-- como venta de producto y no como corte), commission_pct 0. Los triggers de
-- visits que disparan: set_org_from_branch (ya va organization_id),
-- fn_sync_transfer_log_from_visit (sólo transferencia con cuenta), tip report y
-- fidelización (no-op sin cliente / sin propina).
CREATE OR REPLACE FUNCTION public.registrar_venta_directa_productos(
  p_clave              uuid,
  p_branch_id          uuid,
  p_barber_id          uuid,
  p_payment_method     text,
  p_payment_account_id uuid,
  p_items              jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '4s'
AS $$
DECLARE
  v_org       uuid;
  v_tz        text;
  v_insertada uuid;
  v_previa    record;
  v_cuenta    uuid;
  v_val       jsonb;
  v_total     numeric;
  v_comision  numeric;
  v_visit     uuid;
  v_estado    text;
  v_respuesta jsonb;
  v_ahora     timestamptz := now();
BEGIN
  IF p_clave IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'clave_requerida');
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'metodo_invalido');
  END IF;

  SELECT b.organization_id, COALESCE(NULLIF(b.timezone, ''), 'America/Argentina/Buenos_Aires')
    INTO v_org, v_tz
    FROM branches b WHERE b.id = p_branch_id;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sucursal_invalida');
  END IF;

  INSERT INTO ventas_directas_claves (clave, organization_id, branch_id)
  VALUES (p_clave, v_org, p_branch_id)
  ON CONFLICT (clave) DO NOTHING
  RETURNING clave INTO v_insertada;

  IF v_insertada IS NULL THEN
    SELECT k.branch_id, k.visit_id, k.respuesta INTO v_previa
      FROM ventas_directas_claves k WHERE k.clave = p_clave;
    IF v_previa.branch_id IS DISTINCT FROM p_branch_id OR v_previa.visit_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'clave_reutilizada');
    END IF;
    RETURN v_previa.respuesta || jsonb_build_object('ya_registrada', true);
  END IF;

  -- Barbero: NULL = venta de la barbería (sin comisión). Si viene, tiene que
  -- ser personal activo de ESTA sucursal. Quién puede vender a nombre de quién
  -- lo decide el server action con la sesión; acá se cuida el dato.
  IF p_barber_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff s
     WHERE s.id = p_barber_id AND s.branch_id = p_branch_id AND s.is_active
  ) THEN
    DELETE FROM ventas_directas_claves WHERE clave = p_clave;
    RETURN jsonb_build_object('success', false, 'error', 'barbero_invalido');
  END IF;

  -- Cuenta de cobro: sólo en transferencia, activa y de esta sucursal (las
  -- mismas que ofrece get_transfer_accounts_state). Un cobro en efectivo con
  -- una cuenta colgada aparecía filtrando la caja por esa cuenta.
  IF p_payment_method = 'transfer' AND p_payment_account_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM payment_accounts pa
       WHERE pa.id = p_payment_account_id AND pa.branch_id = p_branch_id AND pa.is_active
    ) THEN
      DELETE FROM ventas_directas_claves WHERE clave = p_clave;
      RETURN jsonb_build_object('success', false, 'error', 'cuenta_invalida');
    END IF;
    v_cuenta := p_payment_account_id;
  END IF;

  v_val := productos_validar_lineas(p_branch_id, p_items, true);
  IF NOT (v_val->>'ok')::boolean THEN
    DELETE FROM ventas_directas_claves WHERE clave = p_clave;
    RETURN jsonb_build_object('success', false, 'error', v_val->>'error');
  END IF;

  v_total    := (v_val->>'total')::numeric;
  v_comision := CASE WHEN p_barber_id IS NULL THEN 0 ELSE (v_val->>'comision')::numeric END;

  IF v_total <= 0 THEN
    DELETE FROM ventas_directas_claves WHERE clave = p_clave;
    RETURN jsonb_build_object('success', false, 'error', 'total_cero');
  END IF;

  INSERT INTO visits (
    branch_id, organization_id, barber_id, amount, commission_amount, commission_pct,
    payment_method, payment_account_id, started_at, completed_at
  ) VALUES (
    p_branch_id, v_org, p_barber_id, v_total, v_comision, 0,
    p_payment_method::payment_method, v_cuenta, v_ahora, v_ahora
  )
  RETURNING id INTO v_visit;

  PERFORM productos_escribir_lineas(v_visit, p_branch_id, p_barber_id, p_payment_method, v_val->'lineas');

  v_estado := productos_sumar_comision(p_barber_id, p_branch_id, v_comision, (v_ahora AT TIME ZONE v_tz)::date);

  v_respuesta := jsonb_build_object(
    'success',         true,
    'visit_id',        v_visit,
    'total',           v_total,
    'comision',        v_comision,
    'comision_estado', v_estado,
    'ya_registrada',   false
  );

  UPDATE ventas_directas_claves
     SET visit_id = v_visit, respuesta = v_respuesta
   WHERE clave = p_clave;

  RETURN v_respuesta;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7) Permisos
-- ----------------------------------------------------------------------------
-- El default ACL de Supabase da EXECUTE a anon y authenticated sobre toda
-- función nueva, y REVOKE ... FROM PUBLIC no se lo quita a esos roles: hay que
-- nombrarlos. Los helpers internos tampoco quedan para service_role: sólo se
-- llaman desde las dos RPC (que corren como su dueño), así nadie puede escribir
-- detalle o stock salteando la validación.
REVOKE ALL ON FUNCTION public.productos_validar_lineas(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.productos_escribir_lineas(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.productos_sumar_comision(uuid, uuid, numeric, date)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_productos_de_visita(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_productos_de_visita(uuid, jsonb, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.registrar_venta_directa_productos(uuid, uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_venta_directa_productos(uuid, uuid, uuid, text, uuid, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 8) Autoverificación: si anon o authenticated pueden ejecutar algo, se aborta
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_rol  text;
  v_fn   text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_fn IN ARRAY ARRAY[
      'public.productos_validar_lineas(uuid, jsonb, boolean)',
      'public.productos_escribir_lineas(uuid, uuid, uuid, text, jsonb)',
      'public.productos_sumar_comision(uuid, uuid, numeric, date)',
      'public.registrar_productos_de_visita(uuid, jsonb, text)',
      'public.registrar_venta_directa_productos(uuid, uuid, uuid, text, uuid, jsonb)'
    ] LOOP
      IF has_function_privilege(v_rol, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '220: % todavía puede ejecutar %', v_rol, v_fn;
      END IF;
    END LOOP;
    IF has_table_privilege(v_rol, 'public.ventas_directas_claves', 'SELECT') THEN
      RAISE EXCEPTION '220: % todavía puede leer ventas_directas_claves', v_rol;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.registrar_venta_directa_productos(uuid, uuid, uuid, text, uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.registrar_productos_de_visita(uuid, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '220: service_role no puede ejecutar las RPC de productos';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación post-aplicación (prod, sólo lectura o con ROLLBACK)
-- ============================================================================
-- 1) Objetos y permisos:
--    select proname, proacl from pg_proc where proname in
--      ('registrar_productos_de_visita','registrar_venta_directa_productos',
--       'productos_validar_lineas','productos_escribir_lineas','productos_sumar_comision');
-- 2) Como anon, la RPC no existe para PostgREST:
--    curl -X POST "$URL/rest/v1/rpc/registrar_venta_directa_productos" -H "apikey: $ANON" ...
--    → 401/404 (permission denied / PGRST202).
-- 3) Venta directa de punta a punta en una transacción revertida (Test, efectivo):
--    begin;
--      select registrar_venta_directa_productos(gen_random_uuid(), '<branch Test>', null, 'cash', null,
--             '[{"id":"<producto Test>","quantity":1}]');
--    rollback;
-- 4) En el panel: la próxima venta con productos deja product_sales.payment_method
--    igual al de la visita y el stock baja 1 (o queda en 0).
--
-- Rollback (sólo junto con revertir el código, que igual cae solo al camino TS):
--   DROP FUNCTION IF EXISTS public.registrar_venta_directa_productos(uuid, uuid, uuid, text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.registrar_productos_de_visita(uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.productos_sumar_comision(uuid, uuid, numeric, date);
--   DROP FUNCTION IF EXISTS public.productos_escribir_lineas(uuid, uuid, uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.productos_validar_lineas(uuid, jsonb, boolean);
--   DROP TABLE IF EXISTS public.ventas_directas_claves;
