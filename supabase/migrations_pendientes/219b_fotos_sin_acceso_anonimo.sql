-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- 219b — Fotos del corte: el último camino anónimo (subir al bucket) — GATE
-- ============================================================================
-- NO APLICAR junto con el deploy. Va DESPUÉS del gate de 24 h (abajo).
--
-- Reescrita el 4/10/2026: lo anónimo de las fotos se cierra ahora en tres
-- pasos, cada uno en cuanto deja de tener consumidores:
--   · 219f (YA, con HEAD corriendo): fuera las escrituras anónimas de sesiones;
--     lectura e inserción anónimas acotadas a las sesiones viejas de HEAD.
--   · 219h (inmediatamente DESPUÉS del deploy): fuera todo lo anónimo de
--     qr_photo_sessions / qr_photo_uploads / visit_photos, el listado del bucket
--     y la publicación de Realtime de qr_photo_uploads.
--   · 219b (ESTA, con el gate): la subida anónima a Storage del bucket
--     visit-photos, que es lo único que el bundle VIEJO sigue usando después del
--     deploy (la galería del cobro viejo: uploadVisitPhotos sube con la anon
--     key; Skew Protection mantiene vivo ese bundle hasta que vence la ventana o
--     se recarga la tablet).
-- Es autosuficiente e idempotente: re-afirma lo de la 219h (DROP ... IF EXISTS)
-- por si se aplicara sola, y verifica el estado final completo.
--
-- Mientras siga esta policy, cualquiera con la anon key puede SUBIR un archivo
-- (jpeg/png/webp de hasta 10 MB, límites del bucket desde la 219) a cualquier
-- ruta libre del bucket público. No puede pisar fotos existentes (sin UPDATE),
-- ni listarlas (219h), ni meterlas en la ficha de nadie (las RPC sólo registran
-- rutas que firma el servidor y verifican los bytes).
--
-- Las URLs públicas de las fotos siguen funcionando: un bucket public = true no
-- pasa por RLS para la descarga. Las subidas con URL firmada tampoco (se firman
-- con service role y no vuelven a mirar policies). No se revocan GRANTs de
-- tabla a anon (KR#34).
--
-- GATE (query_logs, 24 h con el local abierto, todas las tablets y PCs
-- recargadas después del deploy y el commit verificado en Trinkmax/monaco.barber):
--   select log_attributes['request.method'] m, log_attributes['request.path'] p, count(*)
--     from logs
--    where source = 'edge_logs'
--      and log_attributes['request.sb.jwt.authorization.payload.role'] = 'anon'
--      and log_attributes['request.method'] <> 'OPTIONS'
--      and (log_attributes['request.path'] in ('/rest/v1/qr_photo_sessions',
--                                              '/rest/v1/qr_photo_uploads',
--                                              '/rest/v1/visit_photos',
--                                              '/storage/v1/object/list/visit-photos')
--           or log_attributes['request.path'] like '/storage/v1/object/visit-photos/%')
--    group by 1, 2;
--   → 0 filas. (No cuenta /storage/v1/object/public/…, que es la descarga legítima,
--     ni /storage/v1/object/upload/sign/…, que es la subida firmada.)
--
-- Inmediatamente después de aplicarla, en la tablet de Test: una foto por
-- Cámara, una por Galería y una por QR, y cobrar. Si cualquiera falla, correr
-- el rollback de abajo (está listo para pegar) y avisar.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- Lo de la 219h (no-op si ya se aplicó).
DROP POLICY IF EXISTS qr_sessions_anon_read              ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_update_anon_deactivate ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_insert_existing_org    ON public.qr_photo_sessions;
DROP POLICY IF EXISTS qr_sessions_update_authenticated   ON public.qr_photo_sessions;

DROP POLICY IF EXISTS qr_uploads_anon_access           ON public.qr_photo_uploads;
DROP POLICY IF EXISTS qr_uploads_insert_active_session ON public.qr_photo_uploads;

DROP POLICY IF EXISTS visit_photos_insert_existing_visit ON public.visit_photos;

DROP POLICY IF EXISTS visit_photos_storage_read   ON storage.objects;

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

-- Lo propio de la 219b: la subida anónima al bucket.
DROP POLICY IF EXISTS visit_photos_storage_insert ON storage.objects;

-- Autoverificación: anon ya no ve tokens, rutas ni objetos del bucket, y no
-- puede insertar ni en las tablas ni en el bucket. Si algo queda abierto (otra
-- policy que nadie conocía), la migración se aborta entera.
DO $$
DECLARE
  n integer;
BEGIN
  SET LOCAL ROLE anon;

  SELECT count(*) INTO n FROM public.qr_photo_sessions;
  IF n > 0 THEN RAISE EXCEPTION '219b: anon todavía ve % sesiones de subida', n; END IF;

  SELECT count(*) INTO n FROM public.qr_photo_uploads;
  IF n > 0 THEN RAISE EXCEPTION '219b: anon todavía ve % rutas de fotos', n; END IF;

  SELECT count(*) INTO n FROM public.visit_photos;
  IF n > 0 THEN RAISE EXCEPTION '219b: anon todavía ve % fotos de visitas', n; END IF;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'visit-photos';
  IF n > 0 THEN RAISE EXCEPTION '219b: anon todavía lista % objetos de visit-photos', n; END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('visit-photos', '219b-prueba/no-deberia.webp');
    RAISE EXCEPTION '219b: anon todavía puede subir a visit-photos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- 42501: RLS lo rechaza
  END;

  RESET ROLE;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'qr_photo_uploads'
  ) THEN
    RAISE EXCEPTION '219b: qr_photo_uploads sigue en supabase_realtime';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('qr_photo_sessions', 'qr_photo_uploads')
       AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) THEN
    RAISE EXCEPTION '219b: queda una policy anónima en qr_photo_sessions/qr_photo_uploads';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación (sólo lectura, con la anon key):
--   curl -s -G "$URL/rest/v1/qr_photo_sessions" --data-urlencode "select=id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"   → []
--   curl -s -X POST "$URL/storage/v1/object/list/visit-photos" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'content-type: application/json' -d '{"prefix":""}'  → []
--   curl -sI "$URL/storage/v1/object/public/visit-photos/<una ruta de visit_photos>"  → 200
--   Monitorear 42501 en postgres_logs una semana.
--
-- Rollback de ESTA migración (vuelve al estado de la 219h: sólo la subida anónima):
--   BEGIN;
--   CREATE POLICY visit_photos_storage_insert ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'visit-photos');
--   COMMIT;
-- Si se aplicó sin la 219h y hay que volver todo al estado de la 219f, usar
-- además el rollback que está al pie de la 219h.
-- ============================================================================
