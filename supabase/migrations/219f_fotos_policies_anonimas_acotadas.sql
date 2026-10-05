-- APLICADA en prod el 4/10/2026 (schema_migrations «219f_fotos_policies_anonimas_acotadas»).
-- ============================================================================
-- 219f — Fotos del corte: lo anónimo queda acotado a las sesiones VIEJAS
-- ============================================================================
-- APLICAR YA, con HEAD corriendo (no depende del deploy). Fuera del horario del
-- local (antes de las 9 o después de las 21) igual, por las dudas.
--
-- POR QUÉ
-- La 219 hizo que todo lo que escribe fotos pase por RPC con service_role y que
-- el token del QR sea la llave del celular. Pero en prod siguen vivas las
-- policies anónimas de antes de la 219 (la 219b, que las cierra, va con un gate
-- de 24 h después del deploy), y con ellas cualquiera con la anon key —que va
-- en el bundle— puede (hallazgos fotos-del-corte-01 y seguridad-y-despliegue-03,
-- reproducidos en una base espejo):
--   · leer el token de TODAS las sesiones (qr_sessions_anon_read, USING true):
--     la "capability" de 45 minutos del celular deja de ser secreta;
--   · crear sesiones para cualquier org activa (qr_sessions_insert_existing_org):
--     una sesión 'fotos' plantada sobre una entrada ajena con vencimiento en el
--     año 3000 hace que la tablet la retome, que el QR muestre el token del
--     atacante o que cada foto termine en «La foto no corresponde a este corte»;
--   · cambiar CUALQUIER columna de una sesión activa
--     (qr_sessions_update_anon_deactivate no tiene WITH CHECK: el USING
--     is_active = true hace de check, así que no la puede desactivar pero sí
--     moverle la org, la entrada, el token y el vencimiento);
--   · meter filas en qr_photo_uploads de cualquier sesión activa
--     (qr_uploads_insert_active_session): rutas de fotos de otros clientes que
--     al cobrar se copian a la ficha, o 12 filas basura que llenan el tope.
--
-- QUÉ USA HEAD CON LA ANON KEY (git show HEAD, 4/10/2026) — y sigue andando:
--   · /upload/[token] (página vieja del celular): SELECT de la sesión por token,
--     subida a Storage (visit-photos, policy de storage que esta migración NO
--     toca) e INSERT en qr_photo_uploads de esa sesión.
--   · qr-photo-button (panel viejo): crea y cierra la sesión con server actions
--     (service_role) y escucha los INSERT de qr_photo_uploads por Realtime con
--     la anon key, que pide poder LEER la fila nueva.
--   · Todas esas sesiones nacen con proposito NULL: HEAD no conoce la columna.
--   · Los comprobantes (/upload-comprobante, receipts.ts) van por service_role
--     en HEAD y en el código nuevo: no dependen de ninguna policy.
--   · Ni HEAD ni el código nuevo usan el INSERT ni el UPDATE anónimos de
--     qr_photo_sessions (uploads.ts y receipts.ts escriben con service_role).
--   · Monaco-mobile y monaco-barber-studio no tocan estas tablas (grep).
-- Por eso: se DROPean las dos puertas de escritura de sesiones que nadie usa y
-- las otras tres se recrean IGUALES pero acotadas a proposito IS NULL. Las
-- sesiones de 'fotos' y de 'comprobante' (las únicas que crea el código nuevo)
-- quedan fuera del alcance de anon: ni se leen ni se les inserta nada.
--
-- De paso, qr_sessions_update_authenticated (personal logueado, scoped por org)
-- también queda acotada a proposito IS NULL: nada del dashboard actualiza
-- sesiones desde el browser (HEAD y el código nuevo lo hacen con service_role),
-- y sin esto un usuario del dashboard podía mover una sesión de fotos a otra
-- entrada de su org por REST. Se dropea del todo en la 219h.
--
-- No se revocan GRANTs de tabla (Known Risk #34): sin policy, anon recibe 200
-- con [] (lectura) o 42501 (escritura), nunca un error de embed.
--
-- Las RPC (service_role) no miran policies: la tablet nueva y el celular nuevo
-- no cambian en nada.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- 1) Las dos puertas de escritura de sesiones que nadie usa.
DROP POLICY IF EXISTS qr_sessions_update_anon_deactivate ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_insert_existing_org    ON public.qr_photo_sessions;

-- 2) Lectura anónima de sesiones: sólo las viejas (las de la página /upload de
--    HEAD). Antes: FOR SELECT TO anon USING (true).
DROP POLICY IF EXISTS qr_sessions_anon_read ON public.qr_photo_sessions;
CREATE POLICY qr_sessions_anon_read ON public.qr_photo_sessions
  FOR SELECT TO anon
  USING (proposito IS NULL);

-- 3) Lectura anónima de subidas (el Realtime del botón QR de HEAD): sólo las de
--    sesiones viejas. Antes: FOR SELECT TO anon USING (true).
DROP POLICY IF EXISTS qr_uploads_anon_access ON public.qr_photo_uploads;
CREATE POLICY qr_uploads_anon_access ON public.qr_photo_uploads
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1
      FROM public.qr_photo_sessions s
     WHERE s.id = qr_photo_uploads.session_id
       AND s.proposito IS NULL
  ));

-- 4) Alta de subidas desde el browser (la página /upload de HEAD): sólo en una
--    sesión vieja y activa. Mismos roles que en prod (public: la página vieja
--    corre como anon, o como authenticated si el celular tiene abierta una
--    sesión del dashboard). Antes: WITH CHECK (sesión activa), de cualquier tipo.
DROP POLICY IF EXISTS qr_uploads_insert_active_session ON public.qr_photo_uploads;
CREATE POLICY qr_uploads_insert_active_session ON public.qr_photo_uploads
  FOR INSERT TO public
  WITH CHECK (EXISTS (
    SELECT 1
      FROM public.qr_photo_sessions s
     WHERE s.id = qr_photo_uploads.session_id
       AND s.is_active = true
       AND s.proposito IS NULL
  ));

-- 5) UPDATE del personal logueado: sólo sesiones viejas de su org (USING y
--    WITH CHECK: tampoco puede convertir una vieja en una de fotos).
--    Antes: USING/WITH CHECK (organization_id = get_user_org_id()).
DROP POLICY IF EXISTS qr_sessions_update_authenticated ON public.qr_photo_sessions;
CREATE POLICY qr_sessions_update_authenticated ON public.qr_photo_sessions
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND proposito IS NULL)
  WITH CHECK (organization_id = public.get_user_org_id() AND proposito IS NULL);

-- ----------------------------------------------------------------------------
-- 6) Autoverificación con filas SONDA (se deshacen solas): si algo no quedó
--    como se espera, la migración se aborta entera.
--    · anon ve la sesión vieja y NO la de fotos;
--    · anon sube a la vieja (HEAD) y NO a la de fotos;
--    · anon lee la subida de la vieja (Realtime de HEAD);
--    · anon no crea ni modifica sesiones.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_org   uuid;
  v_vieja uuid := gen_random_uuid();
  v_fotos uuid := gen_random_uuid();
  n       integer;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '219f: no hay ninguna organización para armar las sondas';
  END IF;

  BEGIN
    INSERT INTO public.qr_photo_sessions (id, token, organization_id, is_active, expires_at)
    VALUES (v_vieja, 'sonda-219f-' || v_vieja::text, v_org, true, now() + interval '5 minutes');
    INSERT INTO public.qr_photo_sessions (id, token, organization_id, is_active, expires_at, proposito, queue_entry_id)
    VALUES (v_fotos, 'sonda-219f-' || v_fotos::text, v_org, true, now() + interval '5 minutes', 'fotos', gen_random_uuid());

    SET LOCAL ROLE anon;

    SELECT count(*) INTO n FROM public.qr_photo_sessions WHERE id IN (v_vieja, v_fotos);
    IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE id = v_vieja) THEN
      RAISE EXCEPTION '219f: anon ve % de las 2 sesiones sonda (tiene que ver sólo la vieja)', n;
    END IF;

    INSERT INTO public.qr_photo_uploads (session_id, storage_path)
    VALUES (v_vieja, 'qr-sonda-219f/' || v_vieja::text || '.webp');
    IF NOT EXISTS (SELECT 1 FROM public.qr_photo_uploads WHERE session_id = v_vieja) THEN
      RAISE EXCEPTION '219f: anon no lee la subida de una sesión vieja (el Realtime de HEAD dejaría de avisar)';
    END IF;

    BEGIN
      INSERT INTO public.qr_photo_uploads (session_id, storage_path)
      VALUES (v_fotos, v_org::text || '/' || v_fotos::text || '/sonda.webp');
      RAISE EXCEPTION '219f: anon todavía inserta subidas en una sesión de fotos';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.qr_photo_sessions (token, organization_id)
      VALUES ('sonda-219f-alta-' || gen_random_uuid()::text, v_org);
      RAISE EXCEPTION '219f: anon todavía crea sesiones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    UPDATE public.qr_photo_sessions SET token = token || '-pisado' WHERE id IN (v_vieja, v_fotos);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      RAISE EXCEPTION '219f: anon todavía modifica % sesiones', n;
    END IF;

    RESET ROLE;
    -- Todo dio: se deshacen las sondas.
    RAISE EXCEPTION USING ERRCODE = 'PF219', MESSAGE = '219f: sondas ok';
  EXCEPTION WHEN SQLSTATE 'PF219' THEN
    NULL;
  END;

  -- Las sondas no quedaron.
  IF EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE id IN (v_vieja, v_fotos)) THEN
    RAISE EXCEPTION '219f: quedaron filas sonda';
  END IF;

  -- Nada más quedó abierto para anon en estas dos tablas.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('qr_photo_sessions', 'qr_photo_uploads')
       AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
       AND policyname NOT IN ('qr_sessions_anon_read', 'qr_uploads_anon_access', 'qr_uploads_insert_active_session')
  ) THEN
    RAISE EXCEPTION '219f: hay otra policy anónima en qr_photo_sessions/qr_photo_uploads que nadie conocía';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación después de aplicar (sólo lectura):
--
--   select policyname, roles, cmd, qual, with_check from pg_policies
--    where tablename in ('qr_photo_sessions', 'qr_photo_uploads') order by 1;
--   → sin qr_sessions_insert_existing_org ni qr_sessions_update_anon_deactivate;
--     las tres anónimas y la de authenticated con "proposito IS NULL".
--
--   Con la anon key ($URL = https://gzsfoqpxvnwmvngfoqqk.supabase.co):
--   · Una sesión VIEJA (proposito NULL) se sigue leyendo por token —es lo que
--     hace la página /upload de HEAD—. El token, de:
--       select token from qr_photo_sessions where proposito is null order by created_at desc limit 1;
--     curl -s -G "$URL/rest/v1/qr_photo_sessions" --data-urlencode "select=id,is_active" \
--       --data-urlencode "token=eq.<token>" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--     → 200 [{"id": "...", "is_active": false}]
--   · Ninguna sesión con propósito es visible:
--     curl -s -G "$URL/rest/v1/qr_photo_sessions" --data-urlencode "select=id" \
--       --data-urlencode "proposito=not.is.null" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--     → 200 []
--   · Después del deploy, con una sesión de fotos real (la crea la tablet nueva
--     con la primera foto o el QR), su token por anon da vacío:
--       select token from qr_photo_sessions where proposito = 'fotos' order by created_at desc limit 1;
--     curl -s -G "$URL/rest/v1/qr_photo_sessions" --data-urlencode "select=id" \
--       --data-urlencode "token=eq.<token de fotos>" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--     → 200 []
--   Las escrituras anónimas ya las probó el bloque DO de arriba con filas sonda
--   (no hace falta, ni conviene, probar un POST contra prod).
--
--   Si HEAD sigue andando: en la tablet de Test, el botón QR viejo + una foto
--   desde el celular → aparece en el panel. Monitorear 42501 en postgres_logs
--   una hora (Known Risk #34):
--     select timestamp, event_message from postgres_logs
--      where parsed.sql_state_code = '42501' order by timestamp desc limit 50;
--
-- Rollback (recrea las cinco policies con su cuerpo de prod al 4/10/2026):
--   BEGIN;
--   DROP POLICY IF EXISTS qr_sessions_anon_read ON public.qr_photo_sessions;
--   CREATE POLICY qr_sessions_anon_read ON public.qr_photo_sessions FOR SELECT TO anon USING (true);
--   DROP POLICY IF EXISTS qr_uploads_anon_access ON public.qr_photo_uploads;
--   CREATE POLICY qr_uploads_anon_access ON public.qr_photo_uploads FOR SELECT TO anon USING (true);
--   DROP POLICY IF EXISTS qr_uploads_insert_active_session ON public.qr_photo_uploads;
--   CREATE POLICY qr_uploads_insert_active_session ON public.qr_photo_uploads FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM qr_photo_sessions WHERE qr_photo_sessions.id = qr_photo_uploads.session_id AND qr_photo_sessions.is_active = true));
--   DROP POLICY IF EXISTS qr_sessions_update_authenticated ON public.qr_photo_sessions;
--   CREATE POLICY qr_sessions_update_authenticated ON public.qr_photo_sessions FOR UPDATE TO authenticated
--     USING (organization_id = get_user_org_id()) WITH CHECK (organization_id = get_user_org_id());
--   CREATE POLICY qr_sessions_update_anon_deactivate ON public.qr_photo_sessions FOR UPDATE TO anon USING (is_active = true);
--   CREATE POLICY qr_sessions_insert_existing_org ON public.qr_photo_sessions FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM organizations WHERE organizations.id = qr_photo_sessions.organization_id AND organizations.is_active = true));
--   COMMIT;
-- ============================================================================
