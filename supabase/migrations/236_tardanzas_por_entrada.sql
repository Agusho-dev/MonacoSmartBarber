-- =============================================================================
-- 236 — Tardanzas por hora de entrada, con tolerancia y con horarios (3/nov/2026)
-- =============================================================================
--
-- QUÉ PASABA
-- Una tardanza se medía sólo contra el horario semanal (`staff_schedules`), y eso no
-- refleja cómo se trabaja: se entra a las 10:00 o a las 13:00 y casi todos rotan entre
-- los dos turnos. Sobre los últimos 30 días, de 422 días-barbero:
--   · 199 no se evaluaban: 10 barberos no tienen horario cargado.
--   · 20 caían "en el hueco" de un turno cortado cargado y sólo 1 tenía evento: Nico
--     Ulloque, con 10–13 y 16–21 desde marzo, entraba a las 13:05 y no figuraba tarde.
--   · 7 se marcaban sin motivo o por la vuelta, con un horario de otra rotación.
--
-- QUÉ HACE
-- 1. `app_settings`: las entradas, la vuelta del turno cortado y la tolerancia, por
--    organización. Sin entradas cargadas, una organización sigue como siempre. La regla
--    vive en src/lib/tardanza.ts. Decisión del dueño, el 3/nov/2026: 10:00 y 13:00, vuelta
--    a las 16:00 para quien entró a la mañana y 5 minutos de tolerancia.
-- 2. `disciplinary_events`: la hora de llegada, la que correspondía y los minutos, para
--    poder desplegar días y horarios en Disciplina sin leerlos de un texto. Las tardanzas
--    que ya existen se completan desde su nota, que tiene siempre la misma forma.
--
-- DECISIONES
-- · `hora_*` son hora de PARED de la sucursal, como `event_date`. Un timestamptz obligaría
--   a convertir en cada pantalla y es lo que hizo correr de día a otras fechas.
-- · NULLABLE: una falta o una tardanza cargada a mano no tiene horas.
-- · Sin FK nueva (Known Risk #15). `lock_timeout` por las dudas, como la 235.
--
-- RECÁLCULO DESDE OCTUBRE (no va acá: se corrió aparte, también el 3/nov/2026)
-- Pedido por el dueño. La lógica es TypeScript, así que lo hace
-- scripts/recalcular-tardanzas.ts, DESPUÉS del deploy para no perder fichadas en el medio:
--   1. Se guardan los eventos de sistema desde el 1/oct en
--      `disciplinary_events_antes_del_recalculo` (RLS prendida, sin policies).
--   2. --aplicar inserta las nuevas e imprime un corte de tiempo.
--   3. Se borran los de sistema desde el 1/oct con `created_at` anterior al corte.
-- Para volver atrás: borrar los posteriores al corte e insertar desde esa tabla.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS tardanza_entradas time[],
  ADD COLUMN IF NOT EXISTS tardanza_vuelta time,
  ADD COLUMN IF NOT EXISTS tardanza_tolerancia_minutos integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.app_settings.tardanza_entradas IS
  'Horas de entrada de los turnos. NULL = se mide sólo contra staff_schedules, sin tolerancia.';
COMMENT ON COLUMN public.app_settings.tardanza_vuelta IS
  'Hora de la vuelta del turno cortado, para quien entró a la mañana. NULL = no se mide.';
COMMENT ON COLUMN public.app_settings.tardanza_tolerancia_minutos IS
  'Minutos de gracia. Sólo se aplica con tardanza_entradas cargadas.';

ALTER TABLE public.disciplinary_events
  ADD COLUMN IF NOT EXISTS hora_llegada time,
  ADD COLUMN IF NOT EXISTS hora_esperada time,
  ADD COLUMN IF NOT EXISTS minutos_tarde integer;

COMMENT ON COLUMN public.disciplinary_events.hora_llegada IS
  'Hora de pared de la sucursal en que fichó. NULL en faltas y en lo cargado a mano.';

-- Las que ya existen: «Llegada tarde a las 13:31:48 (Horario: 13:00:00)».
UPDATE public.disciplinary_events
SET hora_llegada = (regexp_match(notes, 'a las (\d{2}:\d{2}:\d{2})'))[1]::time,
    hora_esperada = (regexp_match(notes, 'Horario: (\d{2}:\d{2}:\d{2})'))[1]::time,
    minutos_tarde = floor(extract(epoch FROM (
      (regexp_match(notes, 'a las (\d{2}:\d{2}:\d{2})'))[1]::time
      - (regexp_match(notes, 'Horario: (\d{2}:\d{2}:\d{2})'))[1]::time
    )) / 60)::integer
WHERE event_type = 'late'
  AND hora_llegada IS NULL
  AND notes ~ 'a las \d{2}:\d{2}:\d{2} \(Horario: \d{2}:\d{2}:\d{2}\)';

-- La decisión del dueño, para Monaco.
UPDATE public.app_settings
SET tardanza_entradas = ARRAY['10:00', '13:00']::time[],
    tardanza_vuelta = '16:00',
    tardanza_tolerancia_minutos = 5
WHERE organization_id = (SELECT organization_id FROM public.branches WHERE slug = 'rondeau');
