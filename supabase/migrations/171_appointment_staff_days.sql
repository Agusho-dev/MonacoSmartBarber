-- 171_appointment_staff_days.sql
-- ---------------------------------------------------------------------------
-- Quién toma TURNOS cada día, desacoplado de la jornada de trabajo.
--
-- El modelo real de Monaco es una agenda rotativa: Fabri toma turnos los
-- martes, Simón los miércoles, Nico los jueves. Pero los tres TRABAJAN casi
-- todos los días atendiendo walk-in.
--
-- Hasta acá el motor resolvía "quién atiende por turno el día X" leyendo
-- `staff_schedules`, que es la JORNADA DE TRABAJO: la misma tabla que usan el
-- fichaje, las tardanzas y el calendario. Expresar "Fabri sólo los martes"
-- obligaba a apagarle los otros días de trabajo, o sea a sacarlo del walk-in y
-- de la asistencia. Dos conceptos distintos compartiendo una tabla.
--
-- Esta tabla separa el eje: es la agenda de TURNOS por sucursal y por día.
--   · `start_time`/`end_time` NULL = ese día toma turnos durante toda su
--     jornada normal (se sigue leyendo de `staff_schedules`).
--   · con valor = además se acota la franja en la que acepta turnos, y en ese
--     caso ni siquiera hace falta que tenga jornada cargada.
--
-- COMPATIBILIDAD: si una sucursal NO tiene ninguna fila acá, el motor se
-- comporta exactamente como antes (candidatos = quienes tengan `staff_schedules`
-- ese día). Recién cuando el dueño carga la primera fila esa sucursal pasa al
-- modelo por día — y ahí el día sin nadie asignado no ofrece NADA, que es
-- justamente el punto de una agenda rotativa.
--
-- Consumidores: `getAvailableSlots` y `getPublicBranchAppointmentStaff`
-- (src/lib/actions/appointments.ts) y las server actions de
-- src/lib/actions/appointment-days.ts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_staff_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time,
  end_time time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_staff_days_unique UNIQUE (branch_id, staff_id, day_of_week),
  CONSTRAINT appointment_staff_days_rango CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_appointment_staff_days_branch_dow
  ON public.appointment_staff_days(branch_id, day_of_week);

COMMENT ON TABLE public.appointment_staff_days IS
  'Quién toma turnos cada día por sucursal. Separado de staff_schedules (jornada de trabajo/fichaje). Sucursal sin filas = modelo viejo, candidatos por staff_schedules.';
COMMENT ON COLUMN public.appointment_staff_days.start_time IS
  'NULL = toma turnos durante toda su jornada normal de ese día (staff_schedules). Con valor, acota la franja.';

-- RLS: todo el acceso pasa por server actions con service role, igual que el
-- resto de la configuración de turnos.
ALTER TABLE public.appointment_staff_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_staff_days_service_role ON public.appointment_staff_days;
CREATE POLICY appointment_staff_days_service_role ON public.appointment_staff_days
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.appointment_staff_days FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.appointment_staff_days TO service_role;

DROP TRIGGER IF EXISTS trg_appointment_staff_days_updated_at ON public.appointment_staff_days;
CREATE TRIGGER trg_appointment_staff_days_updated_at
  BEFORE UPDATE ON public.appointment_staff_days
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
