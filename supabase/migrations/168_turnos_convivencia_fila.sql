-- 168_turnos_convivencia_fila.sql
-- ---------------------------------------------------------------------------
-- Fundación del sistema de turnos y su convivencia con la FILA.
--
-- CONTEXTO IMPORTANTE: la migración 166 (que reparaba las tres RPCs del kiosko)
-- NUNCA se aplicó a producción. `supabase_migrations.schema_migrations` salta
-- de 165 a 167. Verificado en vivo con pg_get_functiondef: los cuerpos siguen
-- siendo los de las migraciones fantasma 119-122.
-- Esta migración es AUTOSUFICIENTE: incluye los cuerpos definitivos (los fixes
-- de la 166 + los de acá), así que aplicar ésta deja el sistema correcto
-- independientemente de si la 166 corrió o no.
--
-- ═══ LA REGLA DE CONVIVENCIA ═══
--
-- El problema: un barbero con 3 walk-ins esperando y un cliente que sacó turno
-- para las 15:00. Hoy el turno entra al FONDO de la fila (priority_order = hora
-- del turno = 15:00, mayor que la de los tres que llegaron antes) y encima es
-- inatendible, porque `claim_next_for_barber` filtra `is_appointment = false`.
--
-- La regla que implementa esta migración, en una línea:
--
--   Un turno con check-in hecho tiene precedencia ABSOLUTA sobre los walk-ins
--   desde el momento en que su hora llegó. Antes de su hora sólo se adelanta
--   si igual no había ningún walk-in atendible — o sea, si la ventana de
--   protección ya los bloqueó y el barbero iba a quedar ocioso.
--
-- Por qué es la correcta, caso por caso:
--   · Turno 15:00, walk-ins de 14:20/14:35/14:50, check-in 14:55. A las 14:55
--     la ventana de protección (que YA existía, mig 139) impide arrancar un
--     walk-in que terminaría después de las 15:00. Antes el barbero quedaba
--     parado; ahora atiende al del turno. Nadie pierde: los walk-ins no podían
--     entrar igual.
--   · Turno 15:00, cliente llega 13:00 y hace check-in, hay walk-ins. La
--     protección no aplica (faltan 2h): se atienden los walk-ins primero. El
--     que llegó dos horas antes espera. Correcto.
--   · Turno 14:00, son las 14:30, cliente presente, hay walk-ins esperando.
--     Su hora pasó: precedencia absoluta, entra él. Correcto: reservó.
--
-- La lógica de la fila walk-in NO cambia: mismo FIFO por priority_order, misma
-- ventana de protección, mismos guards de in_progress y de descansos. Lo único
-- que se agrega es la puerta por la que un turno puede ser atendido.
-- ---------------------------------------------------------------------------

-- (Supabase aplica cada migración dentro de su propia transacción.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. visits.appointment_id — cerrar el circuito turno → cobro
-- ═══════════════════════════════════════════════════════════════════════════
-- La mig 109 nunca se aplicó (Known Risk #14). Sin esta columna:
--   · `queue.ts` bloque 3.6 (descuento de prepagos) tira 42703 en CADA corte
--     de un turno y sólo lo loguea.
--   · no hay forma de saber desde `visits` que un cobro vino de un turno, así
--     que no se puede deduplicar turno ↔ visita.
--
-- Antes de agregarla se verificó que NO existe ninguna otra FK entre `visits`
-- y `appointments` (Known Risk #15: una segunda FK entre dos tablas ya
-- relacionadas rompe todos los embeds PostgREST existentes). Es la primera y
-- única, así que ningún embed se vuelve ambiguo.

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS appointment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visits_appointment_id_fkey'
  ) THEN
    ALTER TABLE public.visits
      ADD CONSTRAINT visits_appointment_id_fkey
      FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_appointment_id
  ON public.visits(appointment_id) WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN public.visits.appointment_id IS
  'Turno que originó la visita (NULL para walk-ins). Lo copia el trigger on_queue_completed desde queue_entries.appointment_id.';

-- Backfill de lo que ya existe.
UPDATE public.visits v
SET appointment_id = q.appointment_id
FROM public.queue_entries q
WHERE v.queue_entry_id = q.id
  AND q.appointment_id IS NOT NULL
  AND v.appointment_id IS NULL;

-- El trigger de la fila copia el vínculo. Único cambio: una columna más en el
-- INSERT. El resto del cuerpo queda idéntico al de producción.
CREATE OR REPLACE FUNCTION public.on_queue_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commission NUMERIC(5,2);
  v_visit_id UUID;
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_service_points INTEGER;
  v_org_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at, organization_id, appointment_id)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, 0, v_commission, 0, NEW.started_at, NEW.completed_at, v_org_id, NEW.appointment_id)
    RETURNING id INTO v_visit_id;

    v_service_points := 0;
    IF NEW.service_id IS NOT NULL THEN
      SELECT COALESCE(points_per_service, 0) INTO v_service_points FROM services WHERE id = NEW.service_id;
    END IF;

    IF v_service_points > 0 THEN
      v_points := v_service_points;
      v_reward_active := true;
    ELSE
      SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
      FROM rewards_config rw
      WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL) AND rw.is_active = true
      LIMIT 1;
    END IF;

    IF v_reward_active IS TRUE AND v_points > 0 AND NEW.client_id IS NOT NULL THEN
      INSERT INTO client_points (client_id, branch_id, organization_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_org_id, v_points, v_points)
      ON CONFLICT (client_id, organization_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, visit_id, points, type, description, organization_id)
      VALUES (NEW.client_id, v_visit_id, v_points, 'earned', 'Puntos por visita', v_org_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. lookup_appointment_by_phone — reparación (fixes de la 166)
-- ═══════════════════════════════════════════════════════════════════════════
--   a) s.name -> s.full_name (era 42703: la columna de `staff` es full_name).
--   b) CURRENT_DATE (UTC) -> fecha en la TZ de la sucursal. Después de las
--      21:00 en Argentina el kiosko buscaba los turnos de MAÑANA.
--   c) match por últimos 10 dígitos, igual que las mig 149/150.
--   d) jsonb_agg con ORDER BY interno.

CREATE OR REPLACE FUNCTION public.lookup_appointment_by_phone(p_branch_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_tz text;
  v_today date;
  v_normalized text;
  v_digits10 text;
  v_appt jsonb;
BEGIN
  SELECT organization_id, COALESCE(timezone, 'America/Argentina/Buenos_Aires')
    INTO v_org_id, v_tz
  FROM branches WHERE id = p_branch_id AND is_active;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  v_normalized := normalize_phone_e164(p_phone);
  IF v_normalized IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_digits10 := right(regexp_replace(v_normalized, '\D', '', 'g'), 10);
  IF length(v_digits10) < 10 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'starts_at', lower(a.time_range),
    'ends_at', upper(a.time_range),
    'barber_id', a.barber_id,
    'barber_name', s.full_name,
    'barber_avatar_url', s.avatar_url,
    'service_id', a.service_id,
    'duration_minutes', a.duration_minutes,
    'status', a.status,
    'client_id', a.client_id,
    'client_name', c.name,
    'client_phone', c.phone,
    'services', (
      SELECT jsonb_agg(
               jsonb_build_object('id', sv.id, 'name', sv.name, 'duration', sv.duration_minutes)
               ORDER BY aps.sort_order
             )
      FROM appointment_services aps
      JOIN services sv ON sv.id = aps.service_id
      WHERE aps.appointment_id = a.id
    )
  ) INTO v_appt
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  LEFT JOIN staff s ON s.id = a.barber_id
  WHERE a.branch_id = p_branch_id
    AND a.organization_id = v_org_id
    AND a.appointment_date = v_today
    AND a.status IN ('scheduled','confirmed','checked_in')
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = v_digits10
  ORDER BY a.start_time ASC
  LIMIT 1;

  IF v_appt IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'appointment', v_appt);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. check_in_appointment — la puerta del turno hacia la fila
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes respecto de producción:
--   a) el INSERT omitía `position` (integer NOT NULL SIN default) -> 23502 en
--      el 100% de las llamadas. Nunca creó una sola fila.
--   b) idempotencia ante doble tap / red intermitente.
--   c) el cliente que YA estaba en la fila como walk-in hacía saltar el
--      unique parcial idx_queue_unique_active_client (23505) sin mapear, y el
--      kiosko mostraba "Error al confirmar llegada". Ahora esa entrada se
--      ADOPTA como la del turno en vez de duplicar al cliente.
--   d) `p_allow_early` para que el staff pueda registrar una llegada muy
--      anticipada desde el dashboard/panel, cosa que el cliente no puede hacer
--      solo desde la tablet.
--
-- priority_order = HORA DEL TURNO. Es la clave de toda la convivencia: no es
-- la hora de llegada. Junto con la precedencia de claim_next_for_barber (más
-- abajo) hace que el cliente sea atendido a su hora, ni antes ni después.
--
-- Se DROPea la versión de 2 argumentos: crear la de 3 sin dropear la vieja
-- dejaría dos overloads y PostgREST rechazaría la llamada por ambigüedad.

DROP FUNCTION IF EXISTS public.check_in_appointment(uuid, uuid);

CREATE OR REPLACE FUNCTION public.check_in_appointment(
  p_appointment_id uuid,
  p_staff_id_assign uuid DEFAULT NULL::uuid,
  p_allow_early boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_appt appointments%ROWTYPE;
  v_settings appointment_settings%ROWTYPE;
  v_starts_at timestamptz;
  v_tolerance int;
  v_queue_entry_id uuid;
  v_final_staff uuid;
  v_adopted boolean := false;
  v_entry_status queue_status;
BEGIN
  SELECT * INTO v_appt FROM appointments WHERE id = p_appointment_id FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Idempotencia: si ya se hizo check-in, devolver la entry existente.
  IF v_appt.status IN ('checked_in','in_progress') AND v_appt.queue_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'queue_entry_id', v_appt.queue_entry_id,
      'staff_id', v_appt.barber_id,
      'already_checked_in', true
    );
  END IF;

  IF v_appt.status NOT IN ('scheduled','confirmed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  -- Staff: si el turno es "cualquiera disponible" (barber_id NULL) lo resuelve
  -- quien llama (kiosko/panel) pasando p_staff_id_assign.
  v_final_staff := COALESCE(v_appt.barber_id, p_staff_id_assign);
  IF v_final_staff IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'STAFF_REQUIRED');
  END IF;

  SELECT * INTO v_settings FROM appointment_settings
  WHERE organization_id = v_appt.organization_id
    AND (branch_id = v_appt.branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST LIMIT 1;

  v_tolerance := COALESCE(v_settings.no_show_tolerance_minutes, 15);
  v_starts_at := lower(v_appt.time_range);

  IF NOT p_allow_early AND v_starts_at > now() + INTERVAL '1 hour' THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'TOO_EARLY',
      'starts_at', v_starts_at
    );
  END IF;

  IF v_starts_at < now() - (v_tolerance || ' minutes')::interval THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'TOO_LATE',
      'starts_at', v_starts_at, 'tolerance_minutes', v_tolerance
    );
  END IF;

  BEGIN
    INSERT INTO queue_entries (
      organization_id, branch_id, client_id, barber_id, service_id,
      status, is_appointment, appointment_id, priority_order, "position"
    ) VALUES (
      v_appt.organization_id, v_appt.branch_id, v_appt.client_id, v_final_staff, v_appt.service_id,
      'waiting', true, v_appt.id, v_starts_at, next_queue_position(v_appt.branch_id)
    ) RETURNING id INTO v_queue_entry_id;

  EXCEPTION WHEN unique_violation THEN
    -- idx_queue_unique_active_client: el cliente ya está en la fila (se anotó
    -- como walk-in antes de acordarse del turno). Adoptamos esa entrada en vez
    -- de duplicarlo o de fallar.
    SELECT id, status INTO v_queue_entry_id, v_entry_status
    FROM queue_entries
    WHERE client_id = v_appt.client_id
      AND branch_id = v_appt.branch_id
      AND status IN ('waiting','in_progress')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_queue_entry_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'QUEUE_CONFLICT');
    END IF;

    -- Si ya lo están atendiendo no se le toca el barbero ni el orden: sólo se
    -- vincula. Si todavía espera, el turno manda (barbero y prioridad), pero
    -- se le respeta la hora de llegada si fue anterior a la del turno.
    UPDATE queue_entries
    SET is_appointment  = true,
        appointment_id  = v_appt.id,
        barber_id       = CASE WHEN status = 'waiting' THEN v_final_staff ELSE barber_id END,
        is_dynamic      = CASE WHEN status = 'waiting' THEN false ELSE is_dynamic END,
        priority_order  = CASE WHEN status = 'waiting' THEN LEAST(priority_order, v_starts_at) ELSE priority_order END
    WHERE id = v_queue_entry_id;

    v_adopted := true;
  END;

  UPDATE appointments
  SET status = CASE WHEN v_entry_status = 'in_progress' THEN 'in_progress' ELSE 'checked_in' END,
      barber_id = COALESCE(v_appt.barber_id, v_final_staff),
      queue_entry_id = v_queue_entry_id
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object(
    'success', true,
    'queue_entry_id', v_queue_entry_id,
    'staff_id', v_final_staff,
    'adopted_existing_entry', v_adopted
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. claim_next_for_barber — LA CONVIVENCIA
-- ═══════════════════════════════════════════════════════════════════════════
-- Cuerpo de la mig 139 con DOS agregados y CERO cambios en la lógica walk-in:
--
--   [A] Antes de mirar walk-ins: si el barbero tiene un turno con check-in
--       hecho cuya hora YA LLEGÓ, lo atiende. Precedencia absoluta.
--
--   [B] Si la ventana de protección bloquea a los walk-ins (o el barbero es
--       `appointments_only`), en vez de devolver vacío y dejarlo ocioso se
--       intenta atender al cliente del turno que ya está presente.
--
-- Además se corrige el bug que hacía que un turno fuera INATENDIBLE: los dos
-- SELECT de walk-in llevan `is_appointment = false`, así que la tarjeta del
-- turno se dibujaba en "Mi fila" y el botón Atender devolvía vacío ("el
-- cliente ya no está disponible") para siempre. Ese filtro se mantiene en el
-- camino walk-in — los turnos entran por [A]/[B], que son caminos propios.
--
-- Los guards de descanso, de un solo in_progress por barbero, el FIFO por
-- priority_order y la ventana de protección quedan EXACTAMENTE como estaban.

CREATE OR REPLACE FUNCTION public.claim_next_for_barber(p_barber_id uuid, p_branch_id uuid, p_preferred_entry_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_id uuid, is_break boolean, was_dynamic boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry_id UUID;
  v_entry_barber_id UUID;
  v_entry_priority TIMESTAMPTZ;
  v_entry_is_dynamic BOOLEAN;
  v_branch_tz TEXT;
  v_org_id UUID;
  v_today DATE;
  v_walkin_mode TEXT;
  v_buffer_minutes INTEGER;
  v_next_appt_start TIMESTAMPTZ;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_pending_break_id UUID;
  v_pending_break_priority TIMESTAMPTZ;
  v_appt_entry_id UUID;
  v_serve_present_appt BOOLEAN := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  -- FIX #13: si el barbero ya tiene un SERVICIO (no-break) in_progress, no reclamar otro.
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = false
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  SELECT id, priority_order
    INTO v_pending_break_id, v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id
    AND branch_id = p_branch_id
    AND is_break = true
    AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_pending_break_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND priority_order < v_pending_break_priority
  ) THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_pending_break_id
      AND status = 'waiting';

    RETURN QUERY SELECT v_pending_break_id, true, false;
    RETURN;
  END IF;

  -- ── [A] TURNOS: el turno cuya hora ya llegó manda ────────────────────────
  SELECT id INTO v_appt_entry_id
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND barber_id = p_barber_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = true
    AND priority_order <= v_now
    AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_appt_entry_id IS NOT NULL THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_appt_entry_id AND status = 'waiting';

    UPDATE appointments a
    SET status = 'in_progress'
    FROM queue_entries q
    WHERE q.id = v_appt_entry_id
      AND a.id = q.appointment_id
      AND a.status IN ('scheduled','confirmed','checked_in');

    RETURN QUERY SELECT v_appt_entry_id, false, false;
    RETURN;
  END IF;

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;

  IF v_walkin_mode = 'appointments_only' THEN
    -- No toma walk-ins nunca, pero sí a su cliente con turno ya presente.
    v_serve_present_appt := true;
  ELSE
    SELECT s.buffer_minutes INTO v_buffer_minutes
    FROM appointment_settings s
    WHERE s.organization_id = v_org_id
      AND (s.branch_id = p_branch_id OR s.branch_id IS NULL)
    ORDER BY s.branch_id NULLS LAST
    LIMIT 1;
    v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
    v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

    SELECT (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz
      INTO v_next_appt_start
    FROM appointments a
    WHERE a.barber_id = p_barber_id
      AND a.branch_id = p_branch_id
      AND a.appointment_date = v_today
      AND a.status IN ('confirmed', 'checked_in')
      AND ((a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz) > v_now
    ORDER BY (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz ASC
    LIMIT 1;

    IF v_next_appt_start IS NOT NULL
       AND v_next_appt_start <= v_now + v_protection_window THEN
      v_serve_present_appt := true;
    END IF;
  END IF;

  -- ── [B] El walk-in no entra antes del turno: si el cliente del turno ya
  --        está acá, se lo atiende en vez de dejar al barbero parado. ───────
  IF v_serve_present_appt THEN
    SELECT id INTO v_appt_entry_id
    FROM queue_entries
    WHERE branch_id = p_branch_id
      AND barber_id = p_barber_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = true
      AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
    ORDER BY priority_order ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_appt_entry_id IS NOT NULL THEN
      UPDATE queue_entries
      SET status = 'in_progress', started_at = v_now
      WHERE id = v_appt_entry_id AND status = 'waiting';

      UPDATE appointments a
      SET status = 'in_progress'
      FROM queue_entries q
      WHERE q.id = v_appt_entry_id
        AND a.id = q.appointment_id
        AND a.status IN ('scheduled','confirmed','checked_in');

      RETURN QUERY SELECT v_appt_entry_id, false, false;
    END IF;

    RETURN;
  END IF;

  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id, is_dynamic
      INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (
        barber_id = p_barber_id
        OR barber_id IS NULL
        OR is_dynamic = true
      )
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      IF v_pending_break_priority IS NOT NULL
         AND v_entry_priority >= v_pending_break_priority THEN
        RETURN;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false,
          status = 'in_progress',
          started_at = v_now
      WHERE id = v_entry_id
        AND status = 'waiting';

      RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
      RETURN;
    END IF;
  END IF;

  SELECT id, priority_order, barber_id, is_dynamic
    INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (
      barber_id = p_barber_id
      OR barber_id IS NULL
      OR is_dynamic = true
    )
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false,
      status = 'in_progress',
      started_at = v_now
  WHERE id = v_entry_id
    AND status = 'waiting';

  RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
END;
$function$;

-- Soporte de índice para las dos búsquedas nuevas de [A] y [B].
CREATE INDEX IF NOT EXISTS idx_queue_waiting_appointments
  ON public.queue_entries(branch_id, barber_id, priority_order)
  WHERE status = 'waiting' AND is_appointment = true AND is_break = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. get_available_slots — motor secundario, alineado con el de TypeScript
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes de la 166 (ab.staff_id -> ab.barber_id, bloqueos org-wide, ventana por
-- solapamiento, horario real del barbero, appointment_staff.is_active, slots
-- pasados) MÁS el que faltaba: filtrar por sucursal. Sin `s.branch_id =
-- p_branch_id`, pedir los slots de Rondeau devolvía también a los barberos de
-- Caseros y Parana, porque las 13 filas de staff_schedules de Monaco tienen
-- branch_id NULL y la rama `OR sch.branch_id IS NULL` matchea siempre.
-- El motor canónico sigue siendo getAvailableSlots (TypeScript).

CREATE OR REPLACE FUNCTION public.get_available_slots(p_branch_id uuid, p_date date, p_total_duration_minutes integer, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(slot_start timestamp with time zone, available_staff_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_tz text;
  v_business_open time;
  v_business_close time;
  v_business_days int[];
  v_dow int;
  v_settings appointment_settings%ROWTYPE;
  v_step_minutes int;
  v_total_minutes int;
  v_open time;
  v_close time;
  v_days int[];
  v_min_start timestamptz;
BEGIN
  SELECT b.organization_id, COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'),
         b.business_hours_open, b.business_hours_close, b.business_days
    INTO v_org_id, v_tz, v_business_open, v_business_close, v_business_days
  FROM branches b
  WHERE b.id = p_branch_id AND b.is_active;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  -- Convención del proyecto: 0=Domingo .. 6=Sábado. ISODOW devuelve 7 para el
  -- domingo y nunca matcheaba.
  v_dow := EXTRACT(DOW FROM p_date)::int;

  SELECT * INTO v_settings FROM appointment_settings
  WHERE organization_id = v_org_id AND (branch_id = p_branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST LIMIT 1;

  IF NOT COALESCE(v_settings.is_enabled, false) THEN
    RETURN;
  END IF;

  v_open  := COALESCE(v_settings.appointment_hours_open,  v_business_open);
  v_close := COALESCE(v_settings.appointment_hours_close, v_business_close);
  v_days  := COALESCE(v_settings.appointment_days, v_business_days);

  IF v_open IS NULL OR v_close IS NULL OR v_days IS NULL THEN
    RETURN;
  END IF;

  IF NOT (v_dow = ANY(v_days)) THEN
    RETURN;
  END IF;

  v_step_minutes  := GREATEST(COALESCE(v_settings.slot_interval_minutes, 15), 1);
  v_total_minutes := p_total_duration_minutes + COALESCE(v_settings.buffer_minutes, 0);
  v_min_start := now() + (COALESCE(v_settings.lead_time_minutes, 0) || ' minutes')::interval;

  RETURN QUERY
  WITH staff_candidates AS (
    SELECT DISTINCT s.id AS staff_id
    FROM staff s
    JOIN appointment_staff aps
      ON aps.staff_id = s.id
     AND aps.is_active
     AND aps.organization_id = v_org_id
    WHERE s.organization_id = v_org_id
      AND s.is_active
      AND s.branch_id = p_branch_id
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
      AND EXISTS (
        SELECT 1 FROM staff_schedules sch
        WHERE sch.staff_id = s.id
          AND sch.day_of_week = v_dow
          AND sch.is_active
          AND (sch.branch_id = p_branch_id OR sch.branch_id IS NULL)
      )
      AND NOT EXISTS (
        SELECT 1 FROM staff_schedule_exceptions sse
        WHERE sse.staff_id = s.id
          AND sse.exception_date = p_date
          AND COALESCE(sse.is_absent, true)
          AND (sse.exception_type IS NULL OR sse.exception_type IN ('absence','vacation','closed'))
      )
  ),
  slot_times AS (
    SELECT generate_series(
      (p_date + v_open)::timestamp AT TIME ZONE v_tz,
      ((p_date + v_close)::timestamp - (v_total_minutes || ' minutes')::interval) AT TIME ZONE v_tz,
      (v_step_minutes || ' minutes')::interval
    ) AS s_start
  ),
  busy_appointments AS (
    SELECT a.barber_id, a.time_range
    FROM appointments a
    WHERE a.branch_id = p_branch_id
      AND a.appointment_date = p_date
      AND a.status IN ('confirmed','checked_in','in_progress')
      AND a.barber_id IS NOT NULL
  ),
  busy_blocks AS (
    SELECT ab.barber_id, tstzrange(ab.start_at, ab.end_at, '[)') AS block_range
    FROM appointment_blocks ab
    WHERE ab.organization_id = v_org_id
      AND (ab.branch_id IS NULL OR ab.branch_id = p_branch_id)
      AND ab.start_at < ((p_date + 1)::timestamp AT TIME ZONE v_tz)
      AND ab.end_at   > ((p_date)::timestamp AT TIME ZONE v_tz)
  )
  SELECT
    st.s_start AS slot_start,
    array_agg(sc.staff_id ORDER BY sc.staff_id) AS available_staff_ids
  FROM slot_times st
  CROSS JOIN staff_candidates sc
  WHERE st.s_start >= v_min_start
  AND EXISTS (
    SELECT 1 FROM staff_schedules sch
    WHERE sch.staff_id = sc.staff_id
      AND sch.day_of_week = v_dow
      AND sch.is_active
      AND (sch.branch_id = p_branch_id OR sch.branch_id IS NULL)
      AND (st.s_start AT TIME ZONE v_tz)::time >= sch.start_time
      AND ((st.s_start + (v_total_minutes || ' minutes')::interval) AT TIME ZONE v_tz)::time <= sch.end_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM busy_appointments ba
    WHERE ba.barber_id = sc.staff_id
      AND ba.time_range && tstzrange(st.s_start, st.s_start + (v_total_minutes||' min')::interval, '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM busy_blocks bb
    WHERE (bb.barber_id IS NULL OR bb.barber_id = sc.staff_id)
      AND bb.block_range && tstzrange(st.s_start, st.s_start + (v_total_minutes||' min')::interval, '[)')
  )
  GROUP BY st.s_start
  ORDER BY st.s_start;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. change_branch_operation_mode — guard de org y activación por SUCURSAL
-- ═══════════════════════════════════════════════════════════════════════════
--   a) `v_org_id <> get_user_org_id()` no protegía nada cuando get_user_org_id()
--      es NULL (comparar con NULL da NULL y el IF no dispara). El server action
--      que la llama usa service role, así que ahí SIEMPRE es NULL: el guard
--      real pasa a ser el REVOKE de más abajo, y esta comparación sólo aplica
--      cuando efectivamente hay una sesión con org.
--   b) Al activar, la versión anterior prendía `is_enabled` en la fila
--      ORG-LEVEL, que comparten las 4 sucursales: pasar UNA a turnos dejaba a
--      todas marcadas como habilitadas, y volver a walk_in no lo apagaba nunca.
--      Ahora se crea/actualiza una fila BRANCH-LEVEL, copiando la configuración
--      de la org como plantilla.

CREATE OR REPLACE FUNCTION public.change_branch_operation_mode(p_branch_id uuid, p_new_mode branch_operation_mode)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id uuid;
  v_session_org uuid;
  v_current_mode branch_operation_mode;
  v_future_appts int;
  v_active_queue int;
BEGIN
  SELECT organization_id, operation_mode INTO v_org_id, v_current_mode
  FROM branches WHERE id = p_branch_id FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  v_session_org := get_user_org_id();
  IF v_session_org IS NOT NULL AND v_org_id <> v_session_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  IF v_current_mode = p_new_mode THEN
    RETURN jsonb_build_object('success', true, 'noop', true);
  END IF;

  SELECT count(*) INTO v_future_appts FROM appointments
  WHERE branch_id = p_branch_id
    AND status IN ('scheduled','confirmed','checked_in','in_progress')
    AND appointment_date >= CURRENT_DATE;

  IF v_future_appts > 0 AND p_new_mode = 'walk_in' THEN
    RETURN jsonb_build_object('success', false, 'error', 'HAS_FUTURE_APPOINTMENTS', 'count', v_future_appts);
  END IF;

  SELECT count(*) INTO v_active_queue FROM queue_entries
  WHERE branch_id = p_branch_id AND status IN ('waiting','in_progress');

  IF v_active_queue > 0 AND p_new_mode = 'appointments' THEN
    RETURN jsonb_build_object('success', false, 'error', 'HAS_ACTIVE_QUEUE', 'count', v_active_queue);
  END IF;

  UPDATE branches SET operation_mode = p_new_mode WHERE id = p_branch_id;

  IF p_new_mode IN ('appointments','hybrid') THEN
    UPDATE appointment_settings
    SET is_enabled = true, updated_at = now()
    WHERE organization_id = v_org_id AND branch_id = p_branch_id;

    IF NOT FOUND THEN
      -- Primera activación de esta sucursal: se copia la fila org-level como
      -- plantilla para que herede la configuración ya cargada por el dueño.
      INSERT INTO appointment_settings (
        organization_id, branch_id, is_enabled,
        appointment_hours_open, appointment_hours_close, appointment_days,
        slot_interval_minutes, max_advance_days, no_show_tolerance_minutes,
        cancellation_min_hours, reminder_hours_before, reminder_hours_before_list,
        payment_mode, buffer_minutes, lead_time_minutes,
        brand_primary_color, brand_bg_color, brand_text_color, welcome_message
      )
      SELECT
        v_org_id, p_branch_id, true,
        d.appointment_hours_open, d.appointment_hours_close, d.appointment_days,
        d.slot_interval_minutes, d.max_advance_days, d.no_show_tolerance_minutes,
        d.cancellation_min_hours, d.reminder_hours_before, d.reminder_hours_before_list,
        d.payment_mode, d.buffer_minutes, d.lead_time_minutes,
        d.brand_primary_color, d.brand_bg_color, d.brand_text_color, d.welcome_message
      FROM appointment_settings d
      WHERE d.organization_id = v_org_id AND d.branch_id IS NULL;

      -- La org tampoco tenía fila: se crea una con los defaults de la tabla.
      IF NOT FOUND THEN
        INSERT INTO appointment_settings (organization_id, branch_id, is_enabled)
        VALUES (v_org_id, p_branch_id, true);
      END IF;
    END IF;
  ELSE
    UPDATE appointment_settings
    SET is_enabled = false, updated_at = now()
    WHERE organization_id = v_org_id AND branch_id = p_branch_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'previous_mode', v_current_mode,
    'new_mode', p_new_mode
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Cerrar las RPCs de turnos a service_role
-- ═══════════════════════════════════════════════════════════════════════════
-- Todas las llamadas del repo salen de archivos 'use server' (service role):
-- verificado con grep sobre los 10 call-sites. Hoy, en cambio, `anon` tiene
-- EXECUTE sobre todas y varias no chequean nada: con el UUID de un turno —que
-- viaja al browser en la agenda— cualquier anónimo podía cancelarlo, hacerle
-- check-in o cambiarle el modo de operación a una sucursal ajena.
-- Mismo criterio ya aplicado a las RPCs de payment_accounts (mig 162/163).
-- REVOKE FROM PUBLIC no alcanza: hay grants explícitos por rol.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.book_appointment(uuid, uuid[], uuid, timestamptz, uuid, text, uuid, text)',
    'public.book_appointment_public(text, text, text, uuid, timestamptz, uuid[])',
    'public.check_in_appointment(uuid, uuid, boolean)',
    'public.cancel_appointment_by_id(uuid, text)',
    'public.cancel_appointment_by_token(text)',
    'public.reschedule_appointment(uuid, timestamptz, uuid, timestamptz)',
    'public.change_branch_operation_mode(uuid, branch_operation_mode)',
    'public.mark_no_show_overdue()',
    'public.lookup_appointment_by_phone(uuid, text)',
    'public.get_available_slots(uuid, date, integer, uuid)'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip (no existe): %', fn;
    END;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.claim_next_for_barber(uuid, uuid, uuid) IS
  'Reclama el próximo cliente del barbero. Walk-in: FIFO por priority_order (sin cambios). Turnos: precedencia absoluta cuando su hora llegó, y prioridad si la ventana de protección ya bloqueó a los walk-ins.';
COMMENT ON FUNCTION public.check_in_appointment(uuid, uuid, boolean) IS
  'Registra la llegada de un turno creando su queue_entry con priority_order = HORA DEL TURNO. Idempotente; adopta la entrada existente si el cliente ya estaba en la fila.';

