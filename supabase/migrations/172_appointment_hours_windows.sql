-- 172_appointment_hours_windows.sql
-- ---------------------------------------------------------------------------
-- Franjas horarias del turnero, por día y con tramos.
--
-- Hasta acá la ventana en la que se podían reservar turnos era UN solo rango
-- para toda la semana (`appointment_settings.appointment_hours_open/close`) más
-- una lista de días habilitados (`appointment_days`). Eso no expresa lo que el
-- dueño necesita: dar turnos SÓLO en las horas de menos demanda, distinto según
-- el día, y **entrecortado** ("los martes de 10 a 13 y de 16 a 19"). La idea de
-- negocio es reservar el mostrador para el walk-in en las horas pico y empujar
-- los turnos a las horas flojas.
--
-- Esta tabla lo modela: N tramos por (sucursal, día).
--
-- COMPATIBILIDAD por sucursal, igual que la 171: si una sucursal no tiene
-- ninguna fila, el motor sigue usando `appointment_hours_open/close` +
-- `appointment_days`. Apenas carga la primera, mandan estos tramos y un día sin
-- tramos deja de ofrecer turnos.
--
-- Consumidores: `getAvailableSlots` (src/lib/actions/appointments.ts, que exige
-- que el turno entre ENTERO en una franja — con 10–13/16–19 un servicio de 45'
-- que arranque 12:45 se pasaría del corte), `/turnos/[slug]/page.tsx` (los días
-- habilitados de la tira pasan a ser los que tienen franja) y las server actions
-- de src/lib/actions/appointment-hours.ts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appointment_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_hours_rango CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appointment_hours_branch_dow
  ON public.appointment_hours(branch_id, day_of_week);

COMMENT ON TABLE public.appointment_hours IS
  'Franjas en las que la sucursal acepta turnos, por día. Varias filas por día = horario entrecortado. Sucursal sin filas = modelo viejo (appointment_hours_open/close + appointment_days).';

-- Sin UNIQUE por (branch, day, start): un día puede tener varios tramos y el
-- solape se valida en `saveBranchAppointmentHours`, que reescribe la semana
-- entera de una y por lo tanto puede razonar sobre el conjunto ordenado.

ALTER TABLE public.appointment_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_hours_service_role ON public.appointment_hours;
CREATE POLICY appointment_hours_service_role ON public.appointment_hours
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.appointment_hours FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.appointment_hours TO service_role;
