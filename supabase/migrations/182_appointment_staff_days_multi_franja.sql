-- 182 — Varias franjas por barbero y día en la agenda de turnos
--
-- `appointment_staff_days` (mig 171) nació con UNIQUE(branch_id, staff_id,
-- day_of_week): una sola franja por barbero y día. Eso alcanza para "Fabri toma
-- turnos los martes de 13 a 21", pero no para el caso que el negocio necesita
-- de verdad, que es el mismo que motivó `appointment_hours` en la mig 172: los
-- turnos se empujan a las horas flojas, y las horas flojas están CORTADAS —
-- "los lunes de 10 a 13 y de 16 a 19".
--
-- Sin esto, la única forma de expresarlo era una franja continua de 10 a 19,
-- que ofrece turnos justo en las horas que el dueño quiere reservar para el
-- walk-in.
--
-- El modelo pasa a ser el mismo que el de la tabla hermana: VARIAS filas por
-- día, y el solape se valida en la server action (`saveBarberAppointmentDays`),
-- que reescribe los días de un barbero de una sola vez y por eso puede razonar
-- sobre el conjunto ordenado. Un UNIQUE sobre (branch, staff, day, start_time)
-- no serviría: en Postgres dos NULL no son iguales, así que dejaría pasar
-- infinitas filas "toda su jornada" para el mismo día.

BEGIN;

ALTER TABLE appointment_staff_days
  DROP CONSTRAINT IF EXISTS appointment_staff_days_unique;

-- Lo único que SÍ es singular por naturaleza: "toma turnos toda su jornada" es
-- una afirmación sobre el día entero y no puede convivir con otra igual.
-- Tampoco tiene sentido junto a franjas acotadas, pero eso lo resuelve la
-- action, que al guardar elige uno de los dos modos.
CREATE UNIQUE INDEX IF NOT EXISTS appointment_staff_days_jornada_unica
  ON appointment_staff_days (branch_id, staff_id, day_of_week)
  WHERE start_time IS NULL;

-- El motor y el turnero público leen por (branch_id) y filtran por día.
CREATE INDEX IF NOT EXISTS appointment_staff_days_branch_dia
  ON appointment_staff_days (branch_id, day_of_week);

COMMENT ON TABLE appointment_staff_days IS
  'Agenda de TURNOS por día y barbero. Eje distinto de staff_schedules (jornada '
  'de trabajo). Varias filas por (branch, staff, day) = día con horario '
  'cortado. start_time/end_time NULL = toma turnos toda su jornada normal, y en '
  'ese caso hay a lo sumo una fila para ese día.';

COMMIT;
