-- APLICADA en prod el 4/10/2026, inmediatamente después del deploy d31840e (schema_migrations «219h_fotos_sin_acceso_anonimo_post_deploy»).
-- ============================================================================
-- 219h — Fotos del corte: después del deploy, nada anónimo en tablas de fotos
-- ============================================================================
-- APLICAR INMEDIATAMENTE DESPUÉS DEL DEPLOY, en la misma ventana fuera de
-- horario, sin esperar el gate de 24 h. Requiere la 219f aplicada.
--
-- POR QUÉ NO HACE FALTA ESPERAR
-- La 219f dejó lo anónimo acotado a las sesiones VIEJAS (proposito NULL), que
-- son las del flujo QR de HEAD. Después del deploy ese flujo muere igual, con o
-- sin estas policies: la página /upload/[token] nueva se resuelve en el
-- servidor y RECHAZA las sesiones sin propósito ("Este código no es válido"), y
-- el botón QR viejo ya no existe en el bundle nuevo. Un celular que tuviera la
-- página vieja abierta desde antes del deploy es el único caso que pierde algo
-- (no puede subir más con ese QR) y se resuelve escaneando el QR nuevo.
-- Lo ÚNICO que el bundle viejo sigue usando con la anon key es la SUBIDA a
-- Storage de la galería del cobro viejo (uploadVisitPhotos): esa policy
-- (visit_photos_storage_insert) queda para la 219b, con el gate de 24 h.
--
-- QUÉ SE CIERRA
--   · qr_sessions_anon_read / qr_uploads_anon_access / qr_uploads_insert_active_session
--     (las tres que la 219f acotó a proposito NULL): anon deja de leer tokens y
--     rutas de las 38 sesiones viejas y de insertar en ellas.
--   · qr_sessions_update_authenticated (acotada en la 219f): nadie actualiza
--     sesiones desde el browser.
--   · visit_photos_insert_existing_visit: el INSERT anónimo de visit_photos no
--     anda desde la mig 131 (28/4/2026: anon no ve la visita cobrada) y el
--     dashboard escribe por visit_photos_manage_by_org.
--   · visit_photos_storage_read: listar el bucket entero con la anon key
--     (POST /storage/v1/object/list/visit-photos daba 200 con las rutas de todas
--     las fotos de clientes). La descarga por URL pública NO pasa por esta
--     policy (el bucket es public = true) y la subida sin upsert del bundle
--     viejo sólo necesita INSERT (tabla de permisos de Storage: upload = insert;
--     upsert = select + insert + update).
--   · supabase_realtime deja de publicar qr_photo_uploads (rutas) a cualquiera.
--
-- No se revocan GRANTs de tabla a anon (Known Risk #34): sin policy, anon
-- recibe 200 con [] en vez de un 42501 que rompa algún embed.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS qr_sessions_anon_read             ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_update_authenticated  ON public.qr_photo_sessions;
-- Por si la 219f no se aplicó (la 219h es autosuficiente en lo que cierra):
DROP POLICY IF EXISTS qr_sessions_update_anon_deactivate ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_insert_existing_org    ON public.qr_photo_sessions;

DROP POLICY IF EXISTS qr_uploads_anon_access            ON public.qr_photo_uploads;
DROP POLICY IF EXISTS qr_uploads_insert_active_session  ON public.qr_photo_uploads;

DROP POLICY IF EXISTS visit_photos_insert_existing_visit ON public.visit_photos;

DROP POLICY IF EXISTS visit_photos_storage_read ON storage.objects;

-- El panel nuevo no escucha qr_photo_uploads por Realtime (polling al Route
-- Handler) y nadie más lo hace: grepeados MonacoSmartBarber, Monaco-mobile y
-- monaco-barber-studio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'qr_photo_uploads'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.qr_photo_uploads;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Autoverificación: anon ya no ve sesiones, rutas ni el listado del bucket, y
-- no inserta subidas; la subida a Storage del bundle viejo sigue en pie (se
-- cierra en la 219b). Si algo queda abierto (otra policy que nadie conocía),
-- la migración se aborta entera.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  n      integer;
  v_org  uuid;
  v_s    uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '219h: no hay ninguna organización para armar las sondas';
  END IF;

  BEGIN
    -- Una sesión vieja (proposito NULL) activa: el peor caso.
    INSERT INTO public.qr_photo_sessions (id, token, organization_id, is_active, expires_at)
    VALUES (v_s, 'sonda-219h-' || v_s::text, v_org, true, now() + interval '5 minutes');

    SET LOCAL ROLE anon;

    SELECT count(*) INTO n FROM public.qr_photo_sessions;
    IF n > 0 THEN RAISE EXCEPTION '219h: anon todavía ve % sesiones de subida', n; END IF;

    SELECT count(*) INTO n FROM public.qr_photo_uploads;
    IF n > 0 THEN RAISE EXCEPTION '219h: anon todavía ve % rutas de fotos', n; END IF;

    SELECT count(*) INTO n FROM public.visit_photos;
    IF n > 0 THEN RAISE EXCEPTION '219h: anon todavía ve % fotos de visitas', n; END IF;

    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'visit-photos';
    IF n > 0 THEN RAISE EXCEPTION '219h: anon todavía lista % objetos de visit-photos', n; END IF;

    BEGIN
      INSERT INTO public.qr_photo_uploads (session_id, storage_path)
      VALUES (v_s, 'qr-sonda-219h/' || v_s::text || '.webp');
      RAISE EXCEPTION '219h: anon todavía inserta subidas';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.qr_photo_sessions (token, organization_id)
      VALUES ('sonda-219h-alta-' || gen_random_uuid()::text, v_org);
      RAISE EXCEPTION '219h: anon todavía crea sesiones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    UPDATE public.qr_photo_sessions SET token = token || '-pisado' WHERE id = v_s;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION '219h: anon todavía modifica sesiones'; END IF;

    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'PF219', MESSAGE = '219h: sondas ok';
  EXCEPTION WHEN SQLSTATE 'PF219' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE id = v_s) THEN
    RAISE EXCEPTION '219h: quedó la sesión sonda';
  END IF;

  -- La galería del cobro viejo (bundle viejo, URL de Skew Protection) todavía
  -- sube con la anon key: su policy se cierra recién en la 219b.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'visit_photos_storage_insert'
  ) THEN
    RAISE EXCEPTION '219h: falta visit_photos_storage_insert (la cierra la 219b, después del gate)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'qr_photo_uploads'
  ) THEN
    RAISE EXCEPTION '219h: qr_photo_uploads sigue en supabase_realtime';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación después de aplicar (sólo lectura, con la anon key):
--   curl -s -G "$URL/rest/v1/qr_photo_sessions" --data-urlencode "select=id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"   → []
--   curl -s -G "$URL/rest/v1/qr_photo_uploads" --data-urlencode "select=id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"    → []
--   curl -s -X POST "$URL/storage/v1/object/list/visit-photos" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'content-type: application/json' -d '{"prefix":""}'                                                                   → []
--   curl -sI "$URL/storage/v1/object/public/visit-photos/<una ruta de visit_photos>"                                             → 200
-- Inmediatamente después, en la tablet de Test: una foto por Cámara, una por
-- Galería y una por QR (con el celular), quitar una y cobrar. Monitorear 42501
-- en postgres_logs una hora.
--
-- Rollback (recrea lo que esta migración saca, en el estado de la 219f):
--   BEGIN;
--   CREATE POLICY qr_sessions_anon_read ON public.qr_photo_sessions FOR SELECT TO anon USING (proposito IS NULL);
--   CREATE POLICY qr_sessions_update_authenticated ON public.qr_photo_sessions FOR UPDATE TO authenticated
--     USING (organization_id = public.get_user_org_id() AND proposito IS NULL)
--     WITH CHECK (organization_id = public.get_user_org_id() AND proposito IS NULL);
--   CREATE POLICY qr_uploads_anon_access ON public.qr_photo_uploads FOR SELECT TO anon
--     USING (EXISTS (SELECT 1 FROM public.qr_photo_sessions s WHERE s.id = qr_photo_uploads.session_id AND s.proposito IS NULL));
--   CREATE POLICY qr_uploads_insert_active_session ON public.qr_photo_uploads FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM public.qr_photo_sessions s WHERE s.id = qr_photo_uploads.session_id AND s.is_active = true AND s.proposito IS NULL));
--   CREATE POLICY visit_photos_insert_existing_visit ON public.visit_photos FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM visits WHERE visits.id = visit_photos.visit_id));
--   CREATE POLICY visit_photos_storage_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'visit-photos');
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_photo_uploads;
--   COMMIT;
-- ============================================================================
