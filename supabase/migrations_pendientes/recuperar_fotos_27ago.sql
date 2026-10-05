-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- Recuperar las 2 fotos del 27/8/2026 (NO es una migración; NO correr sin el OK
-- del dueño). Requiere la 219 aplicada (columnas nuevas de qr_photo_sessions e
-- índice único de visit_photos).
-- ============================================================================
-- Qué pasó: el 27/8 a las 21:18–21:19 UTC el barbero de Caseros sacó 2 fotos
-- por QR (sesión 552f9da3, dos PNG de ~2 MB porque Safari no codifica WebP) y
-- cobró la visita cd0ce7df a las 21:24:30. Un segundo después, el INSERT en
-- visit_photos lo rechazó la RLS (rota desde la mig 131): las fotos quedaron en
-- el bucket y en qr_photo_uploads, sin visita. La entrada de la fila de esa
-- visita es 32270718 (visits.queue_entry_id).
--
-- Esto ata la sesión a la visita (como lo haría hoy fotos_vincular_entrada) y
-- copia las 2 fotos. Idempotente: correrlo dos veces no duplica nada. Aborta si
-- el estado no es exactamente el esperado.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  v_fotos_visita integer;
  v_subidas      integer;
  v_visita       record;
BEGIN
  SELECT id, queue_entry_id, branch_id, completed_at INTO v_visita
    FROM public.visits
   WHERE id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recuperar_27ago: la visita cd0ce7df ya no existe';
  END IF;
  IF v_visita.queue_entry_id IS DISTINCT FROM '32270718-9bf0-4192-b890-a36870d7f76c' THEN
    RAISE EXCEPTION 'recuperar_27ago: la visita no es la de la entrada 32270718 (es %)', v_visita.queue_entry_id;
  END IF;

  SELECT count(*) INTO v_subidas
    FROM public.qr_photo_uploads
   WHERE session_id = '552f9da3-db3f-4f35-a510-543e80e6742f'
     AND created_at BETWEEN '2026-08-27 21:18:00+00' AND v_visita.completed_at;
  IF v_subidas <> 2 THEN
    RAISE EXCEPTION 'recuperar_27ago: se esperaban 2 fotos de la sesión 552f9da3 antes del cobro y hay %', v_subidas;
  END IF;

  SELECT count(*) INTO v_fotos_visita
    FROM public.visit_photos
   WHERE visit_id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701'
     AND storage_path NOT IN (SELECT storage_path FROM public.qr_photo_uploads WHERE session_id = '552f9da3-db3f-4f35-a510-543e80e6742f');
  IF v_fotos_visita <> 0 THEN
    RAISE EXCEPTION 'recuperar_27ago: la visita ya tiene % fotos de otro origen: revisar a mano', v_fotos_visita;
  END IF;
END $$;

-- La sesión vieja pasa a ser una sesión de fotos de ese cobro, ya cerrada.
UPDATE public.qr_photo_sessions
   SET proposito      = 'fotos',
       queue_entry_id = '32270718-9bf0-4192-b890-a36870d7f76c',
       branch_id      = 'dfd3e0d2-c3a1-4de2-9de2-de99b9f35b34',
       visit_id       = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701',
       is_active      = false,
       closed_at      = COALESCE(closed_at, '2026-08-27 21:24:30.206+00')
 WHERE id = '552f9da3-db3f-4f35-a510-543e80e6742f'
   AND (visit_id IS NULL OR visit_id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701');

INSERT INTO public.visit_photos (visit_id, storage_path, order_index)
SELECT 'cd0ce7df-608b-4b5c-a5cc-dac38510c701',
       u.storage_path,
       row_number() OVER (ORDER BY u.created_at, u.id) - 1
  FROM public.qr_photo_uploads u
 WHERE u.session_id = '552f9da3-db3f-4f35-a510-543e80e6742f'
ON CONFLICT (visit_id, storage_path) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.visit_photos WHERE visit_id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701') <> 2 THEN
    RAISE EXCEPTION 'recuperar_27ago: no quedaron exactamente 2 fotos en la visita';
  END IF;
END $$;

COMMIT;

-- Verificación:
--   select vp.order_index, vp.storage_path from visit_photos vp where vp.visit_id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701' order by 1;
--   → las 2 rutas qr-75d181e6…/fdd7c8fb….png y …/d470b9d8….png. Las URLs públicas ya respondían 200.
-- Rollback:
--   delete from visit_photos where visit_id = 'cd0ce7df-608b-4b5c-a5cc-dac38510c701'
--     and storage_path like 'qr-75d181e6-e675-4ec0-b446-5ba2a3be8535/%';
