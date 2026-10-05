-- APLICADA en prod el 4/10/2026 (schema_migrations «217_asesoria»).
-- ============================================================================
-- 217 — Asesoría sin costo en la tablet de entrada (aditiva)
-- ============================================================================
-- Pedido del dueño (oct/2026): "la asesoría es un servicio sin costo que pueden
-- brindar los barberos, es para que si como cliente no sabés qué hacerte, el
-- barbero te asesore. A los barberos debe salirles un aviso de que ese cliente
-- solicitó asesoría".
--
-- Modelo:
--   * El cliente la elige en "¿Qué te vas a hacer?" EN LUGAR de un servicio: la
--     entrada nace con service_id NULL y pidio_asesoria = true. Si ya estaba
--     esperando, la puede pedir desde "Mi turno" (sólo se prende, nunca se apaga).
--   * El barbero recibe un aviso cuando se anota (derivado en el panel, sin
--     escribir nada) y un pop-up al atenderlo, que confirma con asesoria_vista_at.
--   * Al cobrar elige el servicio que hizo. Si no se hizo nada, la entrada se
--     cierra con status 'cancelled' + cancel_reason 'solo_asesoria' y SIN visita:
--     no cuenta como corte, ni como visita de fidelización, ni como abandono
--     (queue_abandonos exige started_at IS NULL y ésta ya había arrancado).
--   * Se prende POR SUCURSAL (branches.asesoria_habilitada), para poder probarla
--     en Test sin publicarla en las tablets de los locales abiertos.
--
-- Qué NO hace, a propósito:
--   * Ninguna FK nueva de queue_entries a staff. Ya existe
--     queue_entries_barber_id_fkey y una segunda rompe con PGRST201 todos los
--     embeds `barber:staff(...)` del panel, el kiosko y la TV (Known Risk #15).
--     Por eso no hay "asesoria_vista_por": la confirma el barbero que atiende.
--   * No toca on_queue_completed ni agrega columnas a visits: la marca se lee por
--     visits.queue_entry_id (indexado) y queue_entries no se purga.
--   * No toca grants ni policies: queue_entries y branches tienen privilegios a
--     nivel TABLA para anon, así que el panel (PIN + anon key), el kiosko y la TV
--     leen las columnas nuevas sin 42501 (Known Risk #34). Las escrituras van por
--     server actions con service role.
--   * No prende nada: asesoria_habilitada nace en false en todas las sucursales.
--
-- Aditiva y segura ANTES del deploy (el código viejo ignora las columnas).
-- ADD COLUMN con default constante es sólo metadata en PG >= 11, pero toma un
-- ACCESS EXCLUSIVE breve sobre queue_entries: correrla con el local cerrado y
-- con lock_timeout, que falla rápido en vez de encolar a las tablets.
-- Aplicada el domingo 4/10/2026 (los locales no abren los domingos).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) Interruptor por sucursal --------------------------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS asesoria_habilitada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.asesoria_habilitada IS
  'Ofrece "¿No sabés qué hacerte? Pedí asesoría" en la tablet de check-in de esta sucursal. Apagado por defecto (mig 217). Se edita desde /dashboard/configuracion con actualizarAsesoriaSucursal().';

-- 2) La marca vive en la entrada de fila --------------------------------------
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS pidio_asesoria    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asesoria_vista_at timestamptz;

COMMENT ON COLUMN public.queue_entries.pidio_asesoria IS
  'El cliente pidió asesoría sin costo en la tablet (no sabe qué hacerse). Normalmente con service_id NULL: la eligió en vez de un servicio. Sólo se prende, nunca se apaga (mig 217).';

COMMENT ON COLUMN public.queue_entries.asesoria_vista_at IS
  'Cuándo el barbero que lo atiende confirmó el pop-up de asesoría en su panel. NULL con pidio_asesoria y status in_progress = el pop-up se le vuelve a mostrar (mig 217).';

-- 3) Nuevo motivo de cierre ---------------------------------------------------
COMMENT ON COLUMN public.queue_entries.cancel_reason IS
  'no_show (la X del panel/dashboard) | expired_overnight (cron) | moved_to_other_branch (se anotó en otra sucursal) | break_cancelado (descanso anulado) | cuenta_eliminada (borró su cuenta, mig 215) | solo_asesoria (se asesoró y no se hizo ningún servicio: cierre SIN visita, mig 217) | desconocido_pre_211.';

-- 4) Autoverificación ---------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'queue_entries'
                    AND column_name = 'pidio_asesoria' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '217: falta queue_entries.pidio_asesoria NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'queue_entries'
                    AND column_name = 'asesoria_vista_at') THEN
    RAISE EXCEPTION '217: falta queue_entries.asesoria_vista_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'branches'
                    AND column_name = 'asesoria_habilitada' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '217: falta branches.asesoria_habilitada NOT NULL';
  END IF;
  -- Known Risk #15: queue_entries tiene que seguir con UNA sola FK a staff.
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.queue_entries'::regclass
         AND confrelid = 'public.staff'::regclass
         AND contype = 'f') <> 1 THEN
    RAISE EXCEPTION '217: queue_entries no tiene exactamente una FK a staff (PGRST201)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE asesoria_habilitada) THEN
    RAISE EXCEPTION '217: ninguna sucursal debería nacer con la asesoría prendida';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación después de aplicar (sólo lectura):
--   select column_name, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and column_name in ('pidio_asesoria','asesoria_vista_at','asesoria_habilitada');
--   curl -G "$URL/rest/v1/queue_entries" --data-urlencode "select=*,client:clients(id,name),barber:staff(id,full_name)" \
--     --data-urlencode "limit=1" -H "apikey: $ANON"     -- 200
--
-- Métrica para el dueño (lectura):
--   select b.name, count(*) pidieron, count(v.id) con_servicio,
--          count(*) filter (where q.cancel_reason = 'solo_asesoria') solo_asesoria,
--          round(avg(v.amount)) ticket
--     from queue_entries q join branches b on b.id = q.branch_id
--     left join visits v on v.queue_entry_id = q.id
--    where q.pidio_asesoria and q.organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
--      and q.checked_in_at >= date_trunc('month', now())
--    group by 1;
--
-- Rollback (sólo junto con revertir el código):
--   ALTER TABLE public.queue_entries DROP COLUMN pidio_asesoria, DROP COLUMN asesoria_vista_at;
--   ALTER TABLE public.branches DROP COLUMN asesoria_habilitada;
-- ============================================================================
