-- ============================================================================
-- 215 — Borrado de cuenta completo + endurecimiento de la superficie anon
-- (10/sep/2026, revisión pre‑App Review)
--
-- Cinco cosas, todas verificadas contra el cuerpo VIVO de prod (Known Risk #23):
--
--  1. `check_rate_limit` era SECURITY DEFINER con EXECUTE para PUBLIC/anon:
--     con la anon key del bundle cualquiera fijaba una ventana de un año sobre
--     el bucket `client_otp_phone:<org>:<tel>` de una víctima (429 "ya te
--     mandamos varios códigos" para siempre) o sobre `pin_login:<ip>:<sucursal>`
--     de la tablet del local. Queda sólo `service_role` (los dos call‑sites
--     —`src/lib/rate-limit.ts` con admin client y `client-auth` con service
--     role— ya eran service role) y la ventana se acota a 24 h dentro del
--     cuerpo. Hasta hoy el cuerpo sólo vivía en `db-export/`.
--
--  2. `delete_client_account` (mig 193) fallaba con 23503 para cualquier
--     cliente que hubiera usado un premio en una visita (`visits.client_reward_id`
--     es NO ACTION) y borraba `review_requests` antes que `client_reviews`. Se
--     redefine ENTERA, autosuficiente, y además: disocia las señas en vez de
--     destruirlas (registro fiscal + devoluciones: los términos §9 lo prometen),
--     purga los desafíos OTP del teléfono, cancela la fila activa, y recorre
--     TODAS las fichas del mismo teléfono (`loyalty_same_person_ids`, mismo
--     criterio de identidad que la mig 149). Devuelve jsonb con los ids
--     borrados para que la edge function limpie Storage y Auth.
--
--  3. `booking_deposits.client_id` pasa a nullable + ON DELETE SET NULL.
--
--  4. Storage: se dropea la policy `Public read face-references`, que dejaba
--     LISTAR el bucket de caras con la anon key. Los objetos siguen bajando por
--     URL pública (bucket public=true no pasa por RLS para el download), que es
--     lo único que usan el kiosko y el dashboard; ningún camino del browser
--     hace `.list()` (grepeados los tres repos).
--
--  5. (VACÍO — ver el bloque 6 al final del archivo). Acá iba el endurecimiento
--     de `clients` y `visits` para el rol `anon`. Se aplicó, ROMPIÓ EL PANEL DEL
--     BARBERO durante 33 minutos el 10/9/2026 y se revirtió. El bloque quedó
--     documentado con la causa y con cómo habría que hacerlo bien; NO se
--     ejecuta nada.
--
--  6. `client_social_identities.apple_refresh_token` para revocar Sign in with
--     Apple al borrar la cuenta (TN3194).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. check_rate_limit: cuerpo completo, ventana acotada, sólo service_role
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket text,
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now        timestamptz := now();
  -- La ventana la elige el caller, pero el caller ya no puede ser anon: igual
  -- se acota a 24 h para que ningún bug de un call-site deje un bucket clavado
  -- por un año (fue exactamente el vector que se cerró con el REVOKE de abajo).
  v_window     integer     := LEAST(GREATEST(COALESCE(p_window_seconds, 60), 1), 86400);
  v_limit      integer     := GREATEST(COALESCE(p_limit, 1), 1);
  v_window_end timestamptz;
  v_count      integer;
BEGIN
  -- Upsert con reset de la ventana si expiró.
  INSERT INTO public.rate_limits (bucket, key, count, window_end)
  VALUES (p_bucket, p_key, 1, v_now + make_interval(secs => v_window))
  ON CONFLICT (bucket, key) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_end <= v_now THEN 1
      ELSE rate_limits.count + 1
    END,
    window_end = CASE
      WHEN rate_limits.window_end <= v_now THEN v_now + make_interval(secs => v_window)
      ELSE rate_limits.window_end
    END
  RETURNING rate_limits.count, rate_limits.window_end INTO v_count, v_window_end;

  RETURN QUERY SELECT
    (v_count <= v_limit)            AS allowed,
    GREATEST(0, v_limit - v_count)  AS remaining,
    v_window_end                    AS reset_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.check_rate_limit(text, text, integer, integer) IS
  'Contador por (bucket, key) con ventana deslizante. SÓLO service_role (mig 215): con anon, cualquiera bloqueaba el login OTP de un teléfono o el PIN de una sucursal.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. booking_deposits.client_id: nullable + SET NULL
--    La seña es un registro contable (mp_payment_id, importe, devolución) y
--    puede tener una devolución en curso: se DISOCIA, no se destruye.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.booking_deposits ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.booking_deposits DROP CONSTRAINT IF EXISTS booking_deposits_client_id_fkey;
ALTER TABLE public.booking_deposits
  ADD CONSTRAINT booking_deposits_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.booking_deposits.client_id IS
  'NULL = el cliente borró su cuenta (mig 215). La seña queda como registro contable disociado; una `pagada` bloquea el borrado hasta que se resuelva.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. client_social_identities.apple_refresh_token
--    Apple exige revocar los tokens al borrar la cuenta (TN3194). El
--    `authorization_code` de la app se canjea en `client-auth` (acción `social`)
--    por un refresh_token, que es lo que acepta `POST /auth/revoke`. La tabla es
--    sólo service_role (RLS prendida, cero policies, sin grants a anon/authenticated).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_social_identities
  ADD COLUMN IF NOT EXISTS apple_refresh_token text;

COMMENT ON COLUMN public.client_social_identities.apple_refresh_token IS
  'Refresh token de Sign in with Apple (canjeado del authorization_code en client-auth). Se usa una sola vez: POST https://appleid.apple.com/auth/revoke al borrar la cuenta.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. delete_client_account — cuerpo completo
-- ─────────────────────────────────────────────────────────────────────────────

-- Cambia el tipo de retorno (uuid → jsonb): hay que dropear primero. Único
-- call-site: supabase/functions/delete-client-account (ignoraba el retorno).
DROP FUNCTION IF EXISTS public.delete_client_account(uuid);

CREATE FUNCTION public.delete_client_account(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_primary    uuid;
  v_org        uuid;
  v_phone      text;
  v_tail       text;
  v_ids        uuid[];
  v_auth_ids   uuid[];
  v_id         uuid;
  v_pagadas    integer;
  v_now        timestamptz := now();
BEGIN
  SELECT id, organization_id, phone
    INTO v_primary, v_org, v_phone
    FROM public.clients
   WHERE auth_user_id = p_auth_user_id
   ORDER BY created_at
   LIMIT 1;
  IF v_primary IS NULL THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;

  -- Todas las fichas del mismo teléfono (mig 149: la identidad es el teléfono;
  -- en prod hay 19 teléfonos con dos fichas). Si el teléfono es degenerado o
  -- corto, `loyalty_same_person_ids` devuelve sólo la principal.
  SELECT array_agg(DISTINCT x) INTO v_ids FROM public.loyalty_same_person_ids(v_primary) AS x;
  v_tail := public.phone_tail(v_phone);

  -- Una seña PAGADA todavía no resuelta es plata del cliente en la cuenta de
  -- la sucursal: la resolución (devolución dentro de la ventana, pérdida
  -- fuera, arrepentimiento de 10 días) la hace el camino TypeScript al
  -- cancelar el turno desde la app, que es el que habla con Mercado Pago. Acá
  -- no se puede llamar a MP, y borrar el cliente con la seña en el aire es
  -- justo lo que los términos (§9) prometen que no pasa. Se corta con un
  -- código que la edge function traduce a un 409 con instrucciones.
  SELECT count(*) INTO v_pagadas
    FROM public.booking_deposits
   WHERE client_id = ANY (v_ids) AND status = 'pagada';
  IF v_pagadas > 0 THEN
    RAISE EXCEPTION 'deposit_pending';
  END IF;

  -- Usuarios de Auth de las fichas secundarias (normalmente ninguno: el alias
  -- es por teléfono). La edge function los borra después del principal.
  SELECT array_agg(auth_user_id) INTO v_auth_ids
    FROM public.clients
   WHERE id = ANY (v_ids) AND auth_user_id IS NOT NULL AND auth_user_id <> p_auth_user_id;

  FOREACH v_id IN ARRAY v_ids LOOP
    -- 1. Fila: lo que está esperando se cancela (una entrada `waiting` sin
    --    cliente sería "Sin nombre" en el panel para siempre). Lo que está
    --    en atención NO se toca: el barbero lo termina y cobra igual.
    UPDATE public.queue_entries
       SET status = 'cancelled', cancelled_at = v_now, cancel_reason = 'cuenta_eliminada'
     WHERE client_id = v_id AND status = 'waiting';

    -- 2. Premios: la visita que los usó los referencia con NO ACTION.
    UPDATE public.visits SET client_reward_id = NULL
     WHERE client_reward_id IN (SELECT id FROM public.client_rewards WHERE client_id = v_id);
    UPDATE public.prode_weekly_prizes SET client_reward_id = NULL
     WHERE client_reward_id IN (SELECT id FROM public.client_rewards WHERE client_id = v_id);

    -- 3. Reseñas: primero lo que apunta a review_requests, después las requests.
    UPDATE public.client_notifications SET review_request_id = NULL
     WHERE review_request_id IN (SELECT id FROM public.review_requests WHERE client_id = v_id);
    -- `crm_cases.review_id` es NOT NULL (no se puede disociar): el caso nace de
    -- la reseña del cliente y se va con ella.
    DELETE FROM public.crm_cases
     WHERE client_id = v_id
        OR review_id IN (SELECT id FROM public.client_reviews WHERE client_id = v_id);
    DELETE FROM public.client_reviews   WHERE client_id = v_id;
    DELETE FROM public.review_requests  WHERE client_id = v_id;

    -- 4. Señas: la intención abierta muere con la cuenta (no hay a quién
    --    crearle el turno); un pago tardío sobre una `cancelada` lo devuelve
    --    solo `acreditarPago` → `resolverPagoFueraDeTermino`. El resto de los
    --    estados (consumida, perdida, devuelta, sin_cupo, rechazada, expirada)
    --    se disocia: el registro contable queda, el vínculo con la persona no.
    UPDATE public.booking_deposits
       SET status = 'cancelada', failure_reason = 'Cuenta eliminada por el cliente'
     WHERE client_id = v_id AND status = 'iniciada';
    UPDATE public.booking_deposits SET client_id = NULL WHERE client_id = v_id;

    -- 5. Turnos. `appointments.client_id` es NOT NULL con FK CASCADE, así que
    --    no se pueden conservar "cancelados" sin cambiar el esquema (y los ~12
    --    lectores TS asumen `client` no nulo). Se borran: para la agenda el
    --    hueco queda libre igual que con una cancelación, y el registro que
    --    importa —la visita cobrada, con `appointment_id` SET NULL— sobrevive.
    --    Los recordatorios y servicios cascadean; los WhatsApp programados se
    --    borran abajo por client_id.
    DELETE FROM public.appointments WHERE client_id = v_id;

    -- 6. Todo lo que es del cliente y no es registro del negocio.
    DELETE FROM public.client_face_descriptors          WHERE client_id = v_id;
    DELETE FROM public.client_device_tokens             WHERE client_id = v_id;
    DELETE FROM public.client_notifications             WHERE client_id = v_id;
    DELETE FROM public.client_notification_preferences  WHERE client_id = v_id;
    DELETE FROM public.push_outbox                      WHERE client_id = v_id;
    DELETE FROM public.client_goals                     WHERE client_id = v_id;
    DELETE FROM public.client_loyalty_state             WHERE client_id = v_id;
    DELETE FROM public.client_points                    WHERE client_id = v_id;
    DELETE FROM public.client_rewards                   WHERE client_id = v_id;
    DELETE FROM public.broadcast_recipients             WHERE client_id = v_id;
    DELETE FROM public.scheduled_messages               WHERE client_id = v_id;
    DELETE FROM public.partner_benefit_redemptions      WHERE client_id = v_id;
    DELETE FROM public.point_transactions               WHERE client_id = v_id;
    DELETE FROM public.client_social_identities         WHERE client_id = v_id;
    DELETE FROM public.conversations                    WHERE client_id = v_id;

    -- 7. Registro del negocio: se disocia (importes, comisiones, ARCA y caja
    --    siguen cuadrando; la persona ya no está).
    UPDATE public.visits        SET client_id = NULL WHERE client_id = v_id;
    UPDATE public.queue_entries SET client_id = NULL WHERE client_id = v_id;

    -- 8. La ficha (cascadea referrals, loyalty_events, appointment_waitlist,
    --    prode_participants; SET NULL en payment_receipts y arca_invoices).
    DELETE FROM public.clients WHERE id = v_id;
  END LOOP;

  -- 9. Desafíos OTP: no tienen client_id, se identifican por teléfono.
  IF v_tail IS NOT NULL AND length(v_tail) >= 8 THEN
    DELETE FROM public.client_otp_challenges
     WHERE organization_id = v_org AND phone_tail = v_tail;
  END IF;

  RETURN jsonb_build_object(
    'client_id',     v_primary,
    'client_ids',    to_jsonb(v_ids),
    'auth_user_ids', COALESCE(to_jsonb(v_auth_ids), '[]'::jsonb)
  );
END;
$$;

-- OJO: `REVOKE … FROM PUBLIC` NO alcanza. Este proyecto tiene default privileges
-- que le dan EXECUTE a `anon`, `authenticated` y `service_role` sobre TODA función
-- nueva de `public` (`\ddp` → acl={postgres=X, anon=X, authenticated=X, service_role=X}),
-- y esos son GRANTs explícitos a esos roles, no al pseudo-rol PUBLIC. Es la misma
-- trampa de la mig 163 con las RPC de cuentas de cobro. Sin los dos nombres de acá
-- abajo, un `DROP + CREATE FUNCTION` deja `delete_client_account` invocable con la
-- anon key del bundle: `POST /rest/v1/rpc/delete_client_account` borraría la cuenta
-- de cualquier cliente cuyo `auth_user_id` se conozca, y es SECURITY DEFINER, así que
-- la RLS no contiene nada. `check_rate_limit` no cae en esto porque usa
-- `CREATE OR REPLACE` (no re-dispara el default ACL) y además revoca por rol.
REVOKE ALL ON FUNCTION public.delete_client_account(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_client_account(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_account(uuid) TO service_role;

COMMENT ON FUNCTION public.delete_client_account(uuid) IS
  'Borra la cuenta del cliente (Apple 5.1.1(v)). Recorre todas las fichas del mismo teléfono; disocia visits/queue_entries/booking_deposits; falla con deposit_pending si hay una seña pagada sin resolver. Devuelve {client_id, client_ids, auth_user_ids}.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Storage: el bucket de caras deja de ser enumerable con la anon key
--
--    Usos de `face-references` (grepeados MonacoSmartBarber/src,
--    supabase/functions, Monaco-mobile/lib):
--      - src/lib/face-recognition.ts:184 y :236 → `.upload()` desde el BROWSER
--        del kiosko con anon (necesita la policy de INSERT, que se conserva).
--      - src/lib/face-recognition.ts:194 y :246 → `.getPublicUrl()`: cálculo
--        local, sin red, sin policy.
--      - src/lib/actions/clients.ts:217 → valida el string de la URL.
--      - NINGÚN `.list()` fuera de la edge function delete-client-account, que
--        corre con service role (bypass de RLS).
--    Un bucket `public = true` sirve `/object/public/...` sin consultar
--    storage.objects, así que las fotos siguen cargando en el kiosko y en
--    el dashboard. Lo único que se pierde es `POST /storage/v1/object/list`
--    con la anon key: 15.345 caras indexadas por client_id.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public read face-references" ON storage.objects;

-- Limpieza de carpetas huérfanas (clientes ya borrados ANTES de esta
-- migración; a partir de ahora la edge function borra la carpeta al dar de
-- baja). NO se ejecuta acá: son binarios y se borran por la API de Storage,
-- no con DELETE sobre storage.objects (dejaría los archivos en el disco).
-- Plan, para correr desde un script con la service role:
--
--   -- 1) Listar carpetas cuyo prefijo no es ni un cliente ni un staff vivo:
--   SELECT DISTINCT split_part(name, '/', 1) AS carpeta
--     FROM storage.objects
--    WHERE bucket_id = 'face-references'
--      AND split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
--      AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id::text = split_part(name, '/', 1))
--      AND NOT EXISTS (SELECT 1 FROM public.staff   s WHERE s.id::text = split_part(name, '/', 1));
--   -- (10/sep/2026: 40 carpetas; las 97 del informe incluían las de staff,
--   --  que van como `<staff_id>/<uuid>-staff.webp` en el mismo bucket.)
--   -- 2) Por cada carpeta: supabase.storage.from('face-references').list(carpeta, {limit: 1000})
--   --    → .remove(paths). Verificar después que la consulta 1) devuelva 0.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS anon sobre clients / visits — REVERTIDO, NO VOLVER A APLICAR ASÍ
--
--    INCIDENTE DEL 10/9/2026, 17:15–17:48 (hora de Córdoba). Este bloque hacía
--    `REVOKE SELECT ON public.clients FROM anon` + `GRANT SELECT (11 columnas)`
--    y `DROP POLICY visits_anon_read`. Rompió el panel del barbero en las tres
--    sucursales durante 33 minutos: 889 consultas rechazadas con 42501
--    `permission denied for table clients`, todas la MISMA — la que dibuja la
--    fila (`queue_entries` con el embed `client:clients(id, name, phone, …)`).
--    Los barberos dejaron de ver a los clientes en la tablet y no podían
--    cobrarlos. Se revirtió con `GRANT SELECT ON public.clients TO anon` y
--    recreando `visits_anon_read` con su cuerpo original (está en
--    `db-export/schema/10_rls_policies.sql`).
--
--    POR QUÉ FALLÓ, SI LAS TRES COLUMNAS DEL EMBED ESTABAN OTORGADAS: no
--    alcanza con cubrir las columnas que el `select` nombra. PostgREST arma el
--    embed como un LEFT JOIN LATERAL sobre `clients` y Postgres exige permiso
--    de tabla para resolverlo; con grants por columna el planner corta con
--    42501 antes de mirar RLS. `staff` (mig 212) toleró el mismo tratamiento
--    porque ahí se revocaron DOS columnas puntuales sin tocar el grant de
--    tabla, que es una operación distinta.
--
--    LA LECCIÓN, QUE VALE PARA CUALQUIER TABLA: revocar el SELECT de tabla a
--    `anon` no se puede validar leyendo el código. Las superficies que corren
--    con `anon` (panel del barbero por PIN, kiosko, TV, turnero público) son
--    las del NEGOCIO EN VIVO, y un grep de `select(...)` no ve lo que PostgREST
--    genera. Si alguna vez se retoma:
--      1. probarlo contra un branch de Supabase, NO contra producción;
--      2. ejercitar con curl y la anon key las consultas REALES de las cuatro
--         superficies, empezando por la de la fila;
--      3. hacerlo fuera del horario del local (abren de 9 a 21);
--      4. tener el `GRANT SELECT ON <tabla> TO anon` listo para pegar.
--
--    Lo que SÍ hay que hacer, y es la forma correcta de cerrar esto: sacar las
--    columnas sensibles del alcance de `anon` cambiando el CAMINO, no el
--    permiso — que la fila se lea por una vista o una RPC `SECURITY DEFINER`
--    con las columnas mínimas (id, nombre de pila, categoría), y recién
--    entonces revocar. Mientras tanto, `clients` sigue exponiendo con la anon
--    key `pin_hash`, `face_embedding`, `email`, `instagram`, `auth_user_id` y
--    `signup_source` de las personas que están esperando en la fila; queda
--    anotado como deuda abierta y no como algo resuelto.
-- ─────────────────────────────────────────────────────────────────────────────

-- (bloque intencionalmente vacío: ver arriba)
