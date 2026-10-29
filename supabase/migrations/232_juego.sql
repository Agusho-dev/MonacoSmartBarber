-- =============================================================================
-- 232 — «Corte Final»: las partidas del juego de pelea de /juego (29/oct/2026)
-- =============================================================================
--
-- QUÉ ES
-- Los clientes juegan «Corte Final» en el celular mientras esperan su turno:
-- entran por el QR del cartel de éxito del kiosko (/juego?t=<token firmado>) o
-- por un link suelto (/juego?s=<slug>). Cada partida terminada se guarda acá
-- para el ranking por sucursal (hoy / semana / siempre, en hora de Córdoba) y
-- para las estadísticas por personaje de la pantalla de selección.
--
-- DECISIONES QUE NO HAY QUE DESHACER
--
-- 1. SÓLO SERVICE ROLE. RLS prendida, SIN policies y REVOKE ALL a anon y
--    authenticated. Todo pasa por las server actions de
--    src/lib/actions/juego.ts (createAdminClient): validación zod, rate limit
--    por IP, organización y sucursal resueltas EN EL SERVIDOR (del token
--    firmado del QR o del slug), nunca del browser.
--
-- 2. SIN FK hacia queue_entries ni hacia clients. `queue_entry_id` y
--    `client_id` son referencias blandas (de qué entrada de la fila salió la
--    partida). Una FK hacia queue_entries le toma FOR KEY SHARE a la fila y
--    hace que el SKIP LOCKED de claim_next_for_barber la saltee
--    (.claude/rules/operacion-local.md); hacia clients trabaría bajas y
--    fusiones de fichas por un juego.
--
-- 3. `personaje`, `rival` y `arena` son text sin lista de valores: el catálogo
--    vive en el código (src/lib/juego/personajes.ts y arenas.ts) y suma
--    luchadores sin migración; los valida zod. `dificultad` y `resultado` sí
--    tienen check.
--
-- 4. Los checks de números son la ÚLTIMA red (rangos holgados). Los rangos
--    realistas los aplica zod (puntaje ≤ 60.000, combo ≤ 60, duración
--    20–900 s): ajustarlos no pide migración.
--
-- 5. FKs a organizations y branches con PK de una sola columna: la misma forma
--    que queue_entries, visits, staff y otras 27 tablas, así que PostgREST no
--    la toma como tabla de unión entre branches y organizations y los embeds
--    del kiosko (`branches?select=*,organizations(...)`, org.ts y
--    kiosk-turnos.ts) siguen sin ambigüedad (Known Risk #15). Verificado con
--    la anon key antes y después de aplicarla.
--
-- 6. El ranking se arma EN SQL (juego_ranking / juego_puesto): con «siempre»
--    la tabla pasa de 1.000 filas y PostgREST las cortaría sin avisar. El
--    mejor puntaje es por apodo sin distinguir mayúsculas; a igual puntaje
--    gana el que lo hizo primero.
--
-- Aditiva e idempotente.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.juego_partidas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id        uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  -- Referencias blandas, SIN FK a propósito (ver la decisión 2).
  queue_entry_id   uuid,
  client_id        uuid,
  apodo            text NOT NULL CHECK (char_length(apodo) BETWEEN 1 AND 16),
  personaje        text NOT NULL CHECK (char_length(personaje) BETWEEN 1 AND 32),
  rival            text NOT NULL CHECK (char_length(rival) BETWEEN 1 AND 32),
  arena            text NOT NULL CHECK (char_length(arena) BETWEEN 1 AND 32),
  dificultad       text NOT NULL CHECK (dificultad IN ('facil', 'normal', 'dificil')),
  resultado        text NOT NULL CHECK (resultado IN ('victoria', 'derrota')),
  rondas_ganadas   smallint NOT NULL DEFAULT 0 CHECK (rondas_ganadas BETWEEN 0 AND 9),
  rondas_perdidas  smallint NOT NULL DEFAULT 0 CHECK (rondas_perdidas BETWEEN 0 AND 9),
  puntaje          integer NOT NULL CHECK (puntaje BETWEEN 0 AND 200000),
  combo_max        smallint NOT NULL DEFAULT 0 CHECK (combo_max BETWEEN 0 AND 999),
  criticos         smallint NOT NULL DEFAULT 0 CHECK (criticos BETWEEN 0 AND 999),
  especiales       smallint NOT NULL DEFAULT 0 CHECK (especiales BETWEEN 0 AND 999),
  danio_hecho      integer NOT NULL DEFAULT 0 CHECK (danio_hecho BETWEEN 0 AND 100000),
  danio_recibido   integer NOT NULL DEFAULT 0 CHECK (danio_recibido BETWEEN 0 AND 100000),
  perfectos        smallint NOT NULL DEFAULT 0 CHECK (perfectos BETWEEN 0 AND 9),
  final_al_cero    boolean NOT NULL DEFAULT false,
  duracion_seg     integer NOT NULL CHECK (duracion_seg BETWEEN 0 AND 3600),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.juego_partidas IS
  'Partidas terminadas de «Corte Final» (/juego). Sólo service_role: se escribe y se lee por src/lib/actions/juego.ts. Sin FK a queue_entries ni clients (mig 232).';
COMMENT ON COLUMN public.juego_partidas.queue_entry_id IS
  'Entrada de la fila del QR del kiosko (token firmado). Referencia blanda: SIN FK a propósito.';
COMMENT ON COLUMN public.juego_partidas.client_id IS
  'Cliente de esa entrada, si vino por QR. Referencia blanda: SIN FK a propósito.';
COMMENT ON COLUMN public.juego_partidas.apodo IS
  'Nombre para el ranking (1..16, validado y filtrado en el servidor). El ranking agrupa por lower(apodo).';
COMMENT ON COLUMN public.juego_partidas.personaje IS
  'Luchador del jugador (IdPersonaje de src/lib/juego/tipos.ts). Sin lista fija: la valida zod contra el catálogo.';
COMMENT ON COLUMN public.juego_partidas.puntaje IS
  'Puntaje final (calcularPuntaje del motor). zod acepta hasta 60.000; el check de la base es la última red.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices del ranking
-- ─────────────────────────────────────────────────────────────────────────────

-- Hoy / semana de una sucursal, y el puesto recién guardado.
CREATE INDEX IF NOT EXISTS juego_partidas_sucursal_fecha_idx
  ON public.juego_partidas (branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

-- Hoy / semana de toda la organización (el ranking general) y las estadísticas.
CREATE INDEX IF NOT EXISTS juego_partidas_org_fecha_idx
  ON public.juego_partidas (organization_id, created_at DESC);

-- «Siempre»: los mejores puntajes de una sucursal y de la organización.
CREATE INDEX IF NOT EXISTS juego_partidas_sucursal_puntaje_idx
  ON public.juego_partidas (branch_id, puntaje DESC, created_at)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS juego_partidas_org_puntaje_idx
  ON public.juego_partidas (organization_id, puntaje DESC, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Acceso: sólo service_role
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.juego_partidas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.juego_partidas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.juego_partidas TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Funciones del ranking (SECURITY INVOKER, EXECUTE sólo para service_role)
-- ─────────────────────────────────────────────────────────────────────────────

-- Desde cuándo cuenta cada período, en hora de Córdoba (la de los locales).
-- La semana va de lunes a domingo (date_trunc('week') es ISO).
CREATE OR REPLACE FUNCTION public.juego_inicio_periodo(p_periodo text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_periodo = 'hoy' THEN
    RETURN date_trunc('day', now() AT TIME ZONE 'America/Argentina/Cordoba')
           AT TIME ZONE 'America/Argentina/Cordoba';
  ELSIF p_periodo = 'semana' THEN
    RETURN date_trunc('week', now() AT TIME ZONE 'America/Argentina/Cordoba')
           AT TIME ZONE 'America/Argentina/Cordoba';
  ELSIF p_periodo = 'siempre' THEN
    RETURN '-infinity'::timestamptz;
  END IF;
  RAISE EXCEPTION 'juego_inicio_periodo: período desconocido «%»', p_periodo
    USING ERRCODE = '22023';
END;
$$;

-- Top N con el MEJOR puntaje de cada apodo (sin distinguir mayúsculas).
-- p_branch NULL = toda la organización (el ranking general).
CREATE OR REPLACE FUNCTION public.juego_ranking(
  p_org     uuid,
  p_branch  uuid,
  p_periodo text,
  p_limite  integer DEFAULT 10
)
RETURNS TABLE (apodo text, personaje text, puntaje integer, fecha timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ventana AS (
    SELECT jp.apodo      AS v_apodo,
           jp.personaje  AS v_personaje,
           jp.puntaje    AS v_puntaje,
           jp.created_at AS v_fecha,
           lower(jp.apodo) AS v_clave
    FROM public.juego_partidas jp
    WHERE jp.organization_id = p_org
      AND (p_branch IS NULL OR jp.branch_id = p_branch)
      AND jp.created_at >= public.juego_inicio_periodo(p_periodo)
  ),
  mejores AS (
    SELECT DISTINCT ON (v.v_clave) v.v_apodo, v.v_personaje, v.v_puntaje, v.v_fecha
    FROM ventana v
    ORDER BY v.v_clave, v.v_puntaje DESC, v.v_fecha ASC
  )
  SELECT m.v_apodo, m.v_personaje, m.v_puntaje, m.v_fecha
  FROM mejores m
  ORDER BY m.v_puntaje DESC, m.v_fecha ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limite, 10), 1), 50)
$$;

-- Puesto de un apodo en ese ranking (con su mejor puntaje del período), con el
-- mismo orden que juego_ranking. NULL si el apodo no jugó en el período.
CREATE OR REPLACE FUNCTION public.juego_puesto(
  p_org     uuid,
  p_branch  uuid,
  p_periodo text,
  p_apodo   text
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ventana AS (
    SELECT lower(jp.apodo) AS v_clave, jp.puntaje AS v_puntaje, jp.created_at AS v_fecha
    FROM public.juego_partidas jp
    WHERE jp.organization_id = p_org
      AND (p_branch IS NULL OR jp.branch_id = p_branch)
      AND jp.created_at >= public.juego_inicio_periodo(p_periodo)
  ),
  mejores AS (
    SELECT DISTINCT ON (v.v_clave) v.v_clave, v.v_puntaje, v.v_fecha
    FROM ventana v
    ORDER BY v.v_clave, v.v_puntaje DESC, v.v_fecha ASC
  ),
  mio AS (
    SELECT m.v_puntaje, m.v_fecha FROM mejores m WHERE m.v_clave = lower(p_apodo)
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM mio) THEN NULL
    ELSE 1 + (
      SELECT count(*)::integer
      FROM mejores m, mio
      WHERE m.v_clave <> lower(p_apodo)
        AND (m.v_puntaje > mio.v_puntaje
             OR (m.v_puntaje = mio.v_puntaje AND m.v_fecha < mio.v_fecha))
    )
  END
$$;

-- Peleas y victorias por personaje del jugador (pantalla de selección).
CREATE OR REPLACE FUNCTION public.juego_estadisticas_personajes(p_org uuid)
RETURNS TABLE (personaje text, peleas integer, victorias integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jp.personaje,
         count(*)::integer,
         (count(*) FILTER (WHERE jp.resultado = 'victoria'))::integer
  FROM public.juego_partidas jp
  WHERE jp.organization_id = p_org
  GROUP BY jp.personaje
$$;

-- Supabase da EXECUTE a anon y authenticated por default privileges: hay que
-- sacárselo explícito además de PUBLIC (ver la 229).
REVOKE ALL ON FUNCTION public.juego_inicio_periodo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.juego_ranking(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.juego_puesto(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.juego_estadisticas_personajes(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.juego_inicio_periodo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.juego_ranking(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.juego_puesto(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.juego_estadisticas_personajes(uuid) TO service_role;
