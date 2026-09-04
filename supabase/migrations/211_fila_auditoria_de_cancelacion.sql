-- 211 — Por qué desapareció un cliente de la fila
--
-- Incidente 4/9/2026. El dueño reporta que la gente se anota en la tablet, espera, y
-- "se borra sola" de la fila: tiene que volver a anotarse. Caso testigo: Rodrigo Greco.
--
-- Medido contra producción (90 días, sin Test):
--   * 265 clientes se anotaron y NUNCA fueron atendidos (4 por día).
--   * 205 de ellos no volvieron a anotarse ese día — se fueron. A $16.404 de ticket
--     promedio son ~$3.4M en el trimestre.
--   * 39 esperaron y tuvieron que RE-ANOTARSE (24 pidiendo al MISMO barbero: no se
--     habían ido a ningún lado, estaban ahí).
--   * En ~99% de los casos, mientras esperaban, la sucursal atendió a un promedio de
--     9 a 12 personas que llegaron DESPUÉS. En 75 de los 105 casos con barbero
--     asignado, fue SU PROPIO barbero el que atendió a los que llegaron después.
--
-- Y no había forma de contestar la pregunta más básica —"¿quién sacó a este cliente
-- de la fila?"—: `queue_entries` guarda `status = 'cancelled'` y nada más. No hay
-- cuándo, ni quién, ni por qué. `panel_activity_logs` está vacía. Una cancelación era
-- indistinguible de un cliente que se fue, y por eso el problema vivió meses.
--
-- Esta migración es la instrumentación. El arreglo de la causa (el drag de
-- /dashboard/fila reescribía `priority_order` de toda la fila) va en el código.

BEGIN;

-- ── 1. Rastro de la cancelación ──────────────────────────────────────────────
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  -- SIN foreign key a `staff` A PROPÓSITO. `queue_entries.barber_id` ya referencia
  -- `staff`, y una SEGUNDA FK entre las mismas dos tablas vuelve ambiguo todo embed
  -- `barber:staff(...)` de PostgREST: la query entera falla con PGRST201 (Known Risk
  -- #15 del CLAUDE.md). Se aplicó CON la FK el 4/9/2026 a las 16:4x y dejó las tablets
  -- de los tres locales mostrando "Esperando clientes · General 0" con gente adentro,
  -- porque `fetchQueue` hacía `if (data)` y una respuesta nula se ve igual que un
  -- local vacío. Se dropeó en caliente. Es un id de staff sin integridad referencial:
  -- el staff no se borra (hay soft-delete con `deleted_at`), así que no se pierde nada.
  ADD COLUMN IF NOT EXISTS cancelled_by   UUID,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

COMMENT ON COLUMN public.queue_entries.cancelled_at IS
  'Cuándo se sacó al cliente de la fila. NULL en las canceladas antes de la mig 211.';
COMMENT ON COLUMN public.queue_entries.cancelled_by IS
  'Staff que apretó la X. NULL = lo hizo un proceso automático (ver cancel_reason).';
COMMENT ON COLUMN public.queue_entries.cancel_reason IS
  'no_show (la X del panel/dashboard) | expired_overnight (cron) | '
  'moved_to_other_branch (se anotó en otra sucursal) | barber_off (su barbero se dio de baja).';

-- Backfill mínimo y honesto: sabemos que las viejas se cancelaron, no cuándo.
-- Se marcan como 'desconocido' en vez de inventar una fecha: un cancelled_at falso
-- arruinaría para siempre la medición de "cuánto esperó antes de que lo borraran".
UPDATE public.queue_entries
SET cancel_reason = 'desconocido_pre_211'
WHERE status = 'cancelled' AND cancel_reason IS NULL;

-- ── 2. Nadie sale de la fila sin dejar rastro ────────────────────────────────
-- Trigger y no "que cada call-site se acuerde": el mismo criterio del Known Risk #13
-- del CLAUDE.md. Hoy cancelan `cancelQueueEntry`, el cron, la baja de un barbero y
-- —desde la policy `queue_entries_manage_by_org`, que es ALL para PUBLIC— cualquier
-- staff logueado con la anon key. El invariante lo tiene que garantizar la base.
CREATE OR REPLACE FUNCTION public.fn_queue_entry_stamp_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    NEW.cancel_reason := COALESCE(NEW.cancel_reason, 'no_show');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_entry_stamp_cancel ON public.queue_entries;
CREATE TRIGGER trg_queue_entry_stamp_cancel
  BEFORE UPDATE OF status ON public.queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_queue_entry_stamp_cancel();

-- ── 3. El cron marca SU motivo ───────────────────────────────────────────────
-- Sin esto, las que vence el cron a la mañana entran como 'no_show' y se mezclan con
-- las que alguien sacó a mano — que son las únicas que importan para este problema.
CREATE OR REPLACE FUNCTION public.expire_stale_queue_entries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH stale AS (
    SELECT qe.id
    FROM queue_entries qe
    JOIN branches b ON b.id = qe.branch_id
    WHERE qe.status = 'waiting'
      AND qe.is_break = false
      AND (qe.checked_in_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::DATE
          < (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::DATE
  )
  UPDATE queue_entries qe
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancel_reason = 'expired_overnight'
  FROM stale
  WHERE qe.id = stale.id
    AND qe.status = 'waiting';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 4. El tablero: quién se está quedando sin atender y hace cuánto ──────────
-- Lo que hoy nadie ve. `espera_min` es hasta que lo sacaron (o hasta ahora si sigue
-- esperando), y `le_pasaron` cuenta a los que llegaron DESPUÉS y ya fueron atendidos:
-- ése es el número que convierte "se fue" en "lo saltearon".
CREATE OR REPLACE VIEW public.queue_abandonos AS
SELECT
  q.id,
  q.organization_id,
  q.branch_id,
  b.name                                   AS sucursal,
  q.client_id,
  c.name                                   AS cliente,
  c.phone                                  AS telefono,
  q.barber_id,
  s.full_name                              AS barbero_pedido,
  q.is_dynamic                             AS eligio_menor_espera,
  q.checked_in_at,
  q.cancelled_at,
  q.cancel_reason,
  q.cancelled_by,
  CASE
    WHEN q.status = 'waiting' THEN
      ROUND(EXTRACT(epoch FROM (NOW() - q.checked_in_at)) / 60)::int
    WHEN q.cancelled_at IS NOT NULL THEN
      ROUND(EXTRACT(epoch FROM (q.cancelled_at - q.checked_in_at)) / 60)::int
    ELSE NULL   -- cancelada antes de la mig 211: no sabemos cuándo
  END                                      AS espera_min,
  -- Ventana acotada a 3 h: una fila de barberia no dura mas que eso, y sin la cota
  -- las filas viejas (sin cancelled_at) contaban a TODOS los atendidos desde entonces.
  (SELECT count(*) FROM queue_entries o
    WHERE o.branch_id = q.branch_id
      AND o.is_break = false
      AND o.checked_in_at > q.checked_in_at
      AND o.started_at IS NOT NULL
      AND o.started_at < LEAST(
            COALESCE(q.cancelled_at, NOW()),
            q.checked_in_at + INTERVAL '3 hours'
          ))::int                          AS le_pasaron
FROM queue_entries q
JOIN branches b        ON b.id = q.branch_id
LEFT JOIN clients c    ON c.id = q.client_id
LEFT JOIN staff s      ON s.id = q.barber_id
WHERE q.is_break = false
  AND q.client_id IS NOT NULL
  AND q.started_at IS NULL
  AND (
    q.status = 'cancelled'
    OR (q.status = 'waiting' AND q.checked_in_at < NOW() - INTERVAL '45 minutes')
  );

COMMENT ON VIEW public.queue_abandonos IS
  'Clientes que se anotaron y nadie atendió: los ya cancelados y los que AHORA llevan '
  'más de 45 min esperando. `le_pasaron` > 0 significa que la sucursal siguió '
  'atendiendo gente que llegó después — o sea que no es que el cliente se fue.';

REVOKE ALL ON public.queue_abandonos FROM anon, authenticated;
GRANT SELECT ON public.queue_abandonos TO service_role;

-- Red de seguridad para cualquier entorno donde esta migración ya haya corrido con la
-- FK puesta (producción, 4/9/2026). Idempotente.
ALTER TABLE public.queue_entries DROP CONSTRAINT IF EXISTS queue_entries_cancelled_by_fkey;

COMMIT;
