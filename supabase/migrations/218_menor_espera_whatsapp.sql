-- APLICADA en prod el 4/10/2026 EN SEIS PARTES, con el mismo contenido que este archivo:
-- schema_migrations «218a_menor_espera_queue_entries» … «218f_menor_espera_cron». NO re-correr.
-- =============================================================================
-- 218 — Menor espera por WhatsApp
-- =============================================================================
--
-- QUÉ RESUELVE
-- A quien espera a un barbero PUNTUAL hace más de N minutos (45 por defecto) se
-- le ofrece por WhatsApp pasarse a Menor espera, sólo si en ese mismo minuto hay
-- un barbero realmente libre en su sucursal. Si toca «Sí, pasarme», la entrada
-- pasa al pool dinámico CONSERVANDO `priority_order` y guardando quién era su
-- barbero: en el FIFO de `claim_next_for_barber` sigue igual de adelante para su
-- barbero original y además lo puede tomar cualquiera. «Conservás tu lugar» es
-- literal: el panel (ola siguiente) lo sigue mostrando en la «Mi fila» del
-- barbero original, en su lugar, y el primer «Atender» gana (SKIP LOCKED).
--
-- Medido en 30 días (sin Test): ~130 casos/mes con un barbero libre en algún
-- minuto posterior a los 45 de espera; 21 de esos clientes se fueron sin
-- atenderse.
--
-- DECISIONES QUE NO HAY QUE DESHACER
--
-- 1. TRANSPORTE SIN REDEPLOY. La edge function `process-scheduled-messages`
--    DEPLOYADA es la v16 (28/abr) y arma cada componente como {type, parameters}:
--    descarta `sub_type`/`index`, así que un botón con payload propio hace fallar
--    el envío entero. Por eso la plantilla viaja SÓLO con el BODY (4 parámetros)
--    y Meta devuelve en el webhook `button.text` = `button.payload` = el texto del
--    botón (verificado en webhook_debug_log con las reseñas). La correlación es
--    TELÉFONO + oferta de esa org + texto EXACTO de nuestros botones (leído de la
--    plantilla, no hardcodeado). La Bienvenida de Monaco usa botones «Si»/«No»
--    de tipo `interactive`: el webhook nunca intercepta `interactive`.
--
-- 2. ENCENDIDO POR SUCURSAL (`branches.menor_espera_aviso`, apagado). Las cuatro
--    sucursales de Monaco están en hybrid: con un interruptor por organización la
--    prueba de punta a punta en Test habría afectado a clientes reales.
--
-- 3. NINGUNA FK NUEVA HACIA NI DESDE `queue_entries`. Una 2da FK entre tablas ya
--    relacionadas rompe embeds PostgREST (Known Risk #15). Y la oferta tampoco
--    referencia la entrada: el chequeo de una FK toma FOR KEY SHARE sobre la fila
--    referenciada mientras dura la transacción del tick, y `claim_next_for_barber`
--    (FOR UPDATE SKIP LOCKED) la saltearía: el barbero arrancaría a OTRO cliente.
--    `menor_espera_barbero_original_id` es un uuid suelto por la misma razón.
--
-- 4. «BARBERO LIBRE» = a quien `claim_next_for_barber` (cuerpo vivo del 3/10) le
--    daría un walk-in YA y el panel no excluye: activo, visible en el check-in,
--    barbero o «también barbero», último fichaje de HOY en su sucursal = clock_in,
--    sin corte ni descanso en curso, sin nada propio esperando (clientes, turnos
--    o descanso encolado), no «sólo turnos», no bloqueado por fin de turno
--    (`is_barber_blocked_by_shift_end` con el margen de la org), sin turno dentro
--    de la ventana de protección (45 + buffer) y con actividad en la última hora
--    (un corte cerrado o un fichaje): el que se fue a almorzar sin fichar no
--    cuenta.
--
-- 5. CAPACIDAD = libres − ofertas en vuelo (<10 min sin respuesta) − TODOS los
--    dinámicos que esperan hoy en la sucursal. No sólo los más viejos: los hints
--    del panel no se ven en la base (barber_id NULL) y un dinámico nuevo puede
--    estar ya en la tarjeta del barbero libre; aceptar la oferta le reordenaría
--    la fila mientras la usa.
--
-- 6. POLÍTICA DE CONTACTO. Una oferta por entrada. Nunca a quien pidió la baja
--    (`fila_menor_espera_bajas`), ni a quien dijo «no» dos veces en 90 días, ni a
--    quien dejó sin respuesta 3 ofertas en 60 días. Sólo en el horario de la
--    sucursal (`branches.business_hours_*` / `business_days`, 0 = domingo), sólo
--    entradas del día y hasta umbral + 120 min de espera.
--
-- 7. PRIORIDAD EN LA COLA. `claim_pending_messages` ordena por `scheduled_for`
--    para TODAS las orgs (50 por minuto): una difusión enterraría la oferta. Se
--    encola con `scheduled_for = now() - 1 h`; el vencimiento de la oferta se
--    mide por `creada_at`, así que no lo afecta.
--
-- 8. EL TEXTO SALE DE LA PLANTILLA. `content` (lo que ve el inbox) se renderiza
--    desde `message_templates.components`, no con un format() duplicado. La
--    FORMA se lee (4 variables en el BODY, 2 QUICK_REPLY, encabezado sin
--    parámetros): una variable de más o de menos es un 132000 y el cliente no
--    recibe nada. El idioma es el REGISTRADO en Meta, nunca el default `es_AR`
--    de `scheduled_messages` (Known Risk #4: 132001).
--
-- 9. DISYUNTOR SIN VENTANA DE TIEMPO. Si los últimos 3 envíos con resultado
--    conocido fallaron (incluye los que no salieron en 10 min), la org se
--    saltea y queda UNA alerta en el CRM, no una por minuto. Con ~5 ofertas por
--    día una ventana de una hora casi nunca juntaría 3. Se reanuda solo cuando
--    un envío vuelve a salir: la prueba del dashboard cuenta, así que «arreglá
--    y mandate una prueba» es el camino de vuelta.
--
-- 10. TODO LO NUEVO ES SÓLO SERVICE ROLE. Tablas con RLS prendida, cero
--     policies y REVOKE a anon/authenticated (en Supabase las tablas nuevas
--     nacen con GRANT para esos roles). Funciones SECURITY DEFINER con
--     search_path fijo y EXECUTE sólo para service_role (REVOKE FROM PUBLIC no
--     alcanza: mig 190).
--
-- CÓMO SE APLICA
-- Con psql y fuera del horario del local (9 a 21). Son cinco transacciones
-- cortas + el cron, a propósito: los ALTER de `queue_entries`, `branches` y
-- `app_settings` toman ACCESS EXCLUSIVE sobre tablas calientes, y crear las
-- FKs de las tablas nuevas toma SHARE ROW EXCLUSIVE sobre clients, staff y
-- scheduled_messages. Cada una lleva lock_timeout de 3 s: si alguna no consigue
-- el lock, falla sólo ésa; re-correr el archivo entero (es idempotente). Si se
-- aplica con una herramienta que envuelve todo en UNA transacción, los locks
-- duran hasta el final: mejor partirlo en los cinco bloques. Con todo apagado
-- el tick sólo hace mantenimiento de tablas vacías.
-- =============================================================================


-- ── 1. Marca en la entrada (sin FK) ─────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS dynamic_via_whatsapp_at          timestamptz,
  ADD COLUMN IF NOT EXISTS menor_espera_barbero_original_id uuid;

COMMENT ON COLUMN public.queue_entries.dynamic_via_whatsapp_at IS
  'Mig 218. Cuándo el cliente aceptó por WhatsApp pasarse a Menor espera. claim_next_for_barber NO la resetea (is_dynamic sí): sirve para medir.';
COMMENT ON COLUMN public.queue_entries.menor_espera_barbero_original_id IS
  'Mig 218. El barbero que el cliente esperaba cuando aceptó pasarse a Menor espera. SIN FK a propósito (Known Risk #15). El panel lo sigue mostrando en la «Mi fila» de ese barbero mientras espera en el pool.';

COMMIT;


-- ── 2. Encendido por sucursal ───────────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS menor_espera_aviso boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.menor_espera_aviso IS
  'Mig 218. Ofrecer Menor espera por WhatsApp en esta sucursal. Nace apagado: piloto en Test, después sucursal por sucursal.';

COMMIT;


-- ── 3. Configuración por organización ───────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS menor_espera_minutos   smallint NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS menor_espera_plantilla text     NOT NULL DEFAULT 'fila_menor_espera';

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_menor_espera_minutos_chk
    CHECK (menor_espera_minutos BETWEEN 20 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nombre válido para Meta (minúsculas, dígitos y guión bajo, hasta 512): un
-- nombre con mayúsculas nunca matchearía lo que devuelve el sync. (El largo va
-- aparte: el motor de regex de Postgres no acepta repeticiones de más de 255.)
DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_menor_espera_plantilla_chk
    CHECK (menor_espera_plantilla ~ '^[a-z0-9_]+$' AND length(menor_espera_plantilla) <= 512);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.app_settings.menor_espera_minutos IS
  'Mig 218. Minutos de espera (desde checked_in_at) a partir de los cuales se ofrece Menor espera por WhatsApp.';
COMMENT ON COLUMN public.app_settings.menor_espera_plantilla IS
  'Mig 218. Nombre de la plantilla en Meta. Configurable porque editar una aprobada la devuelve a revisión: se crea una _v2 y se apunta acá.';

COMMIT;


-- ── 4. Tablas nuevas ────────────────────────────────────────────────────────
-- Crear una FK toma SHARE ROW EXCLUSIVE sobre la tabla REFERENCIADA (clients,
-- staff, branches, scheduled_messages): bloquea sus escrituras mientras dura la
-- transacción. Por eso las tablas van solas, con lock_timeout, y las funciones
-- (que no tocan locks de esas tablas) en la transacción siguiente.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- 4.1 Ofertas: una por entrada, auditable.
CREATE TABLE IF NOT EXISTS public.fila_ofertas_menor_espera (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL sólo en las pruebas que el dueño se manda desde el dashboard.
  branch_id             uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  -- SIN FK (ver decisión 3). NULL sólo en las pruebas.
  queue_entry_id        uuid,
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Dos FKs hacia staff: todo embed hacia staff va por COLUMNA
  -- (`barbero:barbero_original_id(...)`), nunca por tabla.
  barbero_original_id   uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  scheduled_message_id  uuid REFERENCES public.scheduled_messages(id) ON DELETE SET NULL,
  es_prueba             boolean NOT NULL DEFAULT false,
  minutos_espera        integer NOT NULL,
  barberos_libres       integer NOT NULL,
  estado                text NOT NULL DEFAULT 'en_cola'
                        CHECK (estado IN ('en_cola','enviada','fallida','aceptada','rechazada','vencida')),
  respuesta             text CHECK (respuesta IN ('si','no')),
  resultado             text,
  error                 text,
  -- Cuándo se avisó a la recepción de una respuesta libre («¿cuánto falta?»):
  -- una sola alerta por oferta, aunque el cliente mande diez mensajes.
  aviso_recepcion_at    timestamptz,
  creada_at             timestamptz NOT NULL DEFAULT now(),
  enviada_at            timestamptz,
  respondida_at         timestamptz,
  cerrada_at            timestamptz,
  atendido_por_id       uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  atendido_at           timestamptz,
  CONSTRAINT fila_ofertas_me_real_tiene_entrada
    CHECK (es_prueba OR (queue_entry_id IS NOT NULL AND branch_id IS NOT NULL))
);

COMMENT ON TABLE public.fila_ofertas_menor_espera IS
  'Mig 218. Una oferta de Menor espera por WhatsApp por entrada de fila (o una prueba del dashboard). Sólo service role. Dos FKs a staff: todo embed hacia staff va por columna.';

-- Una sola oferta real por entrada, aunque dos ticks se pisen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fila_ofertas_me_entrada
  ON public.fila_ofertas_menor_espera (queue_entry_id) WHERE NOT es_prueba;
CREATE INDEX IF NOT EXISTS idx_fila_ofertas_me_org_fecha
  ON public.fila_ofertas_menor_espera (organization_id, creada_at DESC);
CREATE INDEX IF NOT EXISTS idx_fila_ofertas_me_abiertas
  ON public.fila_ofertas_menor_espera (branch_id, creada_at) WHERE estado IN ('en_cola','enviada');
CREATE INDEX IF NOT EXISTS idx_fila_ofertas_me_cliente
  ON public.fila_ofertas_menor_espera (client_id, creada_at DESC);
CREATE INDEX IF NOT EXISTS idx_fila_ofertas_me_sm
  ON public.fila_ofertas_menor_espera (scheduled_message_id) WHERE scheduled_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fila_ofertas_me_sin_atender
  ON public.fila_ofertas_menor_espera (creada_at) WHERE atendido_at IS NULL AND NOT es_prueba;

ALTER TABLE public.fila_ofertas_menor_espera ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fila_ofertas_menor_espera FROM anon, authenticated;
GRANT ALL ON public.fila_ofertas_menor_espera TO service_role;

-- 4.2 Latido, último error y disyuntor por organización: nada falla en silencio.
CREATE TABLE IF NOT EXISTS public.fila_menor_espera_estado (
  organization_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ultimo_tick_at       timestamptz,
  ultimo_error         text,
  ultimo_error_at      timestamptz,
  -- Disyuntor abierto desde (NULL = cerrado, los avisos salen).
  disyuntor_desde      timestamptz,
  disyuntor_error      text,
  -- La alerta del CRM de ESTA apertura: una sola, no una por minuto.
  disyuntor_alerta_id  uuid
);

COMMENT ON TABLE public.fila_menor_espera_estado IS
  'Mig 218. Latido del tick de Menor espera, último error y disyuntor por organización. Sólo service role.';

ALTER TABLE public.fila_menor_espera_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fila_menor_espera_estado FROM anon, authenticated;
GRANT ALL ON public.fila_menor_espera_estado TO service_role;

-- 4.3 Bajas: quien pidió no recibir más estos avisos. Meta exige respetarlo.
CREATE TABLE IF NOT EXISTS public.fila_menor_espera_bajas (
  client_id        uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  creada_at        timestamptz NOT NULL DEFAULT now(),
  -- El mensaje con el que la pidió, para que se pueda auditar.
  mensaje          text
);

CREATE INDEX IF NOT EXISTS idx_fila_me_bajas_org
  ON public.fila_menor_espera_bajas (organization_id);

COMMENT ON TABLE public.fila_menor_espera_bajas IS
  'Mig 218. Clientes que pidieron no recibir más avisos de Menor espera. El tick nunca les escribe. Sólo service role.';

ALTER TABLE public.fila_menor_espera_bajas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fila_menor_espera_bajas FROM anon, authenticated;
GRANT ALL ON public.fila_menor_espera_bajas TO service_role;

COMMIT;


-- ── 5. Funciones y permisos ──────────────────────────────────────────────────
BEGIN;


-- ── 5.1 Helpers de forma y de texto ─────────────────────────────────────────

-- La FORMA de la plantilla se lee, no se asume: exactamente las variables
-- {{1}}..{{4}} en el BODY, exactamente 2 botones y los dos QUICK_REPLY, y un
-- encabezado (si lo hay) que no pida parámetros. Si el dueño la edita en
-- Business Manager y cambia la forma, no se manda nada.
CREATE OR REPLACE FUNCTION public.menor_espera_forma_ok(p_components jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH comp AS (
    SELECT c.value AS c
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(p_components) = 'array' THEN p_components ELSE '[]'::jsonb END) c
  ),
  vars AS (
    SELECT DISTINCT (m[1])::int AS n
      FROM comp, regexp_matches(coalesce(comp.c->>'text', ''), '\{\{\s*(\d+)\s*\}\}', 'g') m
     WHERE upper(comp.c->>'type') = 'BODY'
  ),
  botones AS (
    SELECT upper(coalesce(b.value->>'type', '')) AS tipo
      FROM comp,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(comp.c->'buttons') = 'array' THEN comp.c->'buttons' ELSE '[]'::jsonb END) b
     WHERE upper(comp.c->>'type') = 'BUTTONS'
  )
  SELECT (SELECT count(*) FROM comp WHERE upper(comp.c->>'type') = 'BODY') = 1
     AND coalesce((SELECT array_agg(n ORDER BY n) FROM vars), '{}'::int[]) = ARRAY[1,2,3,4]
     AND (SELECT count(*) FROM botones) = 2
     AND (SELECT count(*) FROM botones WHERE tipo = 'QUICK_REPLY') = 2
     AND NOT EXISTS (
           SELECT 1 FROM comp
            WHERE upper(comp.c->>'type') = 'HEADER'
              AND (upper(coalesce(comp.c->>'format', 'TEXT')) <> 'TEXT'
                   OR coalesce(comp.c->>'text', '') ~ '\{\{'))
$$;

-- Textos de los QUICK_REPLY, en orden: [0] = sí, [1] = no.
CREATE OR REPLACE FUNCTION public.menor_espera_botones(p_components jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(b.value->>'text' ORDER BY c.ord, b.ord), '{}'::text[])
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_components) = 'array' THEN p_components ELSE '[]'::jsonb END)
         WITH ORDINALITY c(value, ord),
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(c.value->'buttons') = 'array' THEN c.value->'buttons' ELSE '[]'::jsonb END)
         WITH ORDINALITY b(value, ord)
   WHERE upper(c.value->>'type') = 'BUTTONS'
     AND upper(b.value->>'type') = 'QUICK_REPLY'
$$;

-- El BODY con las variables reemplazadas. Es lo que se guarda en
-- `scheduled_messages.content` y lo que termina en el inbox: una sola fuente
-- (la plantilla de Meta), sin un format() que se desincronice del original.
CREATE OR REPLACE FUNCTION public.menor_espera_render(p_components jsonb, p_vars text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_txt text;
  i     integer;
BEGIN
  IF jsonb_typeof(p_components) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  SELECT c->>'text' INTO v_txt
    FROM jsonb_array_elements(p_components) c
   WHERE upper(c->>'type') = 'BODY'
   LIMIT 1;
  IF v_txt IS NULL THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. coalesce(array_length(p_vars, 1), 0) LOOP
    v_txt := replace(v_txt, '{{' || i || '}}', coalesce(p_vars[i], ''));
  END LOOP;
  RETURN v_txt;
END;
$$;

-- Nombre de pila del cliente, presentable. NULL si no hay una palabra con
-- letras: un parámetro vacío mata el envío entero (131008) y «Hola 351…» es
-- peor que no escribir.
CREATE OR REPLACE FUNCTION public.menor_espera_nombre_cliente(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN t ~ '[[:alpha:]]' THEN initcap(t) END
    FROM (SELECT regexp_replace(
                   split_part(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), ' ', 1),
                   '^[^[:alpha:]]+|[^[:alpha:]]+$', '', 'g') AS t) x
$$;

-- Nombre del barbero tal como lo dice el mensaje: el de pila, salvo que otro
-- barbero activo de la misma sucursal se llame igual (ahí, el completo).
CREATE OR REPLACE FUNCTION public.menor_espera_nombre_barbero(p_staff_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
           WHEN EXISTS (
             SELECT 1 FROM staff s2
              WHERE s2.id <> s.id
                AND s2.branch_id IS NOT DISTINCT FROM s.branch_id
                AND s2.is_active AND s2.deleted_at IS NULL
                AND lower(split_part(regexp_replace(btrim(s2.full_name), '\s+', ' ', 'g'), ' ', 1))
                  = lower(split_part(regexp_replace(btrim(s.full_name), '\s+', ' ', 'g'), ' ', 1)))
           THEN initcap(regexp_replace(btrim(s.full_name), '\s+', ' ', 'g'))
           ELSE initcap(split_part(regexp_replace(btrim(s.full_name), '\s+', ' ', 'g'), ' ', 1))
         END
    FROM staff s
   WHERE s.id = p_staff_id
$$;

-- La plantilla configurada de la org, con su forma ya evaluada. Vive bajo el
-- canal org-wide (branch_id NULL), que es donde escribe el sync.
CREATE OR REPLACE FUNCTION public.menor_espera_plantilla_de(p_organization_id uuid)
RETURNS TABLE (
  template_id  uuid,
  nombre       text,
  idioma       text,
  estado       text,
  categoria    text,
  componentes  jsonb,
  channel_id   uuid,
  forma_ok     boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH cfg AS (
    SELECT coalesce(
             (SELECT a.menor_espera_plantilla FROM app_settings a
               WHERE a.organization_id = p_organization_id
               ORDER BY a.updated_at DESC NULLS LAST LIMIT 1),
             'fila_menor_espera') AS nombre
  )
  SELECT mt.id, mt.name, mt.language, lower(mt.status), lower(mt.category), mt.components, sc.id,
         public.menor_espera_forma_ok(mt.components)
    FROM cfg
    JOIN social_channels sc
      ON sc.organization_id = p_organization_id AND sc.platform = 'whatsapp' AND sc.is_active
    JOIN message_templates mt
      ON mt.channel_id = sc.id AND mt.name = cfg.nombre
   ORDER BY (sc.branch_id IS NULL) DESC, sc.created_at
   LIMIT 1
$$;


-- ── 5.2 Tick: mantenimiento + ofertas nuevas (pg_cron, cada minuto) ──────────
CREATE OR REPLACE FUNCTION public.menor_espera_ofertas_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org        record;
  v_tpl        record;
  v_c          record;
  v_oferta_id  uuid;
  v_sm_id      uuid;
  v_creadas    integer := 0;
  v_vencidas   integer := 0;
  v_motivo     text;
  v_disyuntor  boolean;
  v_ult_error  text;
  v_alerta_id  uuid;
  v_err        text;
BEGIN
  -- Un solo tick a la vez (pg_cron no solapa el mismo job; una corrida manual sí).
  IF NOT pg_try_advisory_xact_lock(hashtext('menor_espera_ofertas_tick')) THEN
    RETURN jsonb_build_object('omitido', true);
  END IF;

  -- ── A. Mantenimiento: corre aunque todo esté apagado (tablas chicas) ──
  -- El orden importa: primero se asienta lo que pasó con el ENVÍO y después lo
  -- que pasó con la ENTRADA. Al revés, una oferta cuyo envío falló y cuya
  -- entrada cambió en el mismo minuto quedaba «vencida» y la falla no se veía
  -- ni en la card ni en las métricas.

  -- A1. Resultado del envío de lo que estaba en cola.
  UPDATE fila_ofertas_menor_espera o
     SET estado     = CASE sm.status WHEN 'sent' THEN 'enviada' WHEN 'failed' THEN 'fallida' ELSE 'vencida' END,
         enviada_at = CASE WHEN sm.status = 'sent' THEN coalesce(sm.sent_at, now()) ELSE o.enviada_at END,
         error      = CASE WHEN sm.status = 'failed'
                           THEN left(coalesce(sm.error_message, 'Falló el envío'), 500)
                           ELSE o.error END,
         resultado  = CASE WHEN sm.status = 'failed'    THEN coalesce(o.resultado, 'fallo_el_envio')
                           WHEN sm.status = 'cancelled' THEN coalesce(o.resultado, 'cancelado')
                           ELSE o.resultado END,
         cerrada_at = CASE WHEN sm.status IN ('failed','cancelled') THEN now() ELSE o.cerrada_at END
    FROM scheduled_messages sm
   WHERE sm.id = o.scheduled_message_id
     AND o.estado = 'en_cola'
     AND sm.status IN ('sent','failed','cancelled');

  -- El cliente puede contestar (o la entrada cambiar) antes de que A1
  -- sincronice: completar enviada_at igual, que es lo que miden la política de
  -- contacto y la ventana de respuesta.
  UPDATE fila_ofertas_menor_espera o
     SET enviada_at = coalesce(sm.sent_at, now())
    FROM scheduled_messages sm
   WHERE sm.id = o.scheduled_message_id
     AND o.enviada_at IS NULL
     AND sm.status = 'sent';

  -- A2. La entrada dejó de esperar a SU barbero sin que el cliente contestara.
  WITH cerrar AS (
    SELECT o.id,
           CASE
             WHEN q.id IS NULL OR q.status = 'cancelled'    THEN 'salio_de_la_fila'
             WHEN q.status IN ('in_progress','completed')   THEN 'atendido_sin_responder'
             ELSE 'cambio_por_otra_via'
           END AS resultado
      FROM fila_ofertas_menor_espera o
      LEFT JOIN queue_entries q ON q.id = o.queue_entry_id
     WHERE NOT o.es_prueba
       AND o.estado IN ('en_cola','enviada')
       AND o.respondida_at IS NULL
       AND (q.id IS NULL OR q.status <> 'waiting' OR q.is_dynamic OR q.is_appointment
            OR q.barber_id IS DISTINCT FROM o.barbero_original_id)
  )
  UPDATE fila_ofertas_menor_espera o
     SET estado = 'vencida', cerrada_at = now(), resultado = cerrar.resultado
    FROM cerrar
   WHERE o.id = cerrar.id;
  GET DIAGNOSTICS v_vencidas = ROW_COUNT;

  -- A3. La situación cambió antes de que el mensaje saliera: no mandarlo.
  --     No es una falla del envío (no cuenta para el disyuntor).
  UPDATE scheduled_messages sm
     SET status = 'cancelled',
         error_message = 'Menor espera: la situación cambió antes de enviarse'
    FROM fila_ofertas_menor_espera o
   WHERE o.scheduled_message_id = sm.id
     AND sm.status = 'pending'
     AND o.estado = 'vencida';

  -- A4. Lo que no salió en 10 minutos ya no sale: un reintento (+5 min) o un
  --     «processing» huérfano que unclaim_stale_processing_messages devolvió a
  --     pending llegaría cuando la situación ya cambió. Con la prioridad de la
  --     decisión 7 esto sólo pasa si el envío está caído: cuenta como falla
  --     para el disyuntor.
  WITH canceladas AS (
    UPDATE scheduled_messages sm
       SET status = 'cancelled',
           error_message = 'Menor espera: no salió en 10 minutos'
      FROM fila_ofertas_menor_espera o
     WHERE o.scheduled_message_id = sm.id
       AND sm.status = 'pending'
       AND o.estado = 'en_cola'
       AND o.creada_at < now() - interval '10 minutes'
    RETURNING sm.id
  )
  UPDATE fila_ofertas_menor_espera o
     SET estado = 'vencida', resultado = 'no_salio_a_tiempo', cerrada_at = now(),
         error = coalesce(o.error, 'No salió en 10 minutos')
    FROM canceladas
   WHERE o.scheduled_message_id = canceladas.id;

  -- A5. Una prueba que nadie contestó en 90 min queda cerrada.
  UPDATE fila_ofertas_menor_espera
     SET estado = 'vencida', cerrada_at = now(), resultado = coalesce(resultado, 'prueba_sin_respuesta')
   WHERE es_prueba AND estado = 'enviada' AND creada_at < now() - interval '90 minutes';

  -- A6. Analítica: quién lo terminó atendiendo y cuándo.
  UPDATE fila_ofertas_menor_espera o
     SET atendido_por_id = q.barber_id, atendido_at = q.started_at
    FROM queue_entries q
   WHERE q.id = o.queue_entry_id
     AND NOT o.es_prueba
     AND o.atendido_at IS NULL
     AND q.started_at IS NOT NULL
     AND q.status IN ('in_progress','completed')
     AND o.creada_at > now() - interval '1 day';

  -- ── B. Ofertas nuevas: sólo orgs con al menos una sucursal encendida ──
  FOR v_org IN
    SELECT o.organization_id,
           coalesce(a.menor_espera_minutos, 45)::int     AS minutos,
           coalesce(a.shift_end_margin_minutes, 35)::int AS margen,
           a.wa_api_url
      FROM (SELECT DISTINCT b.organization_id
              FROM branches b
             WHERE b.menor_espera_aviso AND b.is_active) o
      LEFT JOIN LATERAL (
        SELECT s.menor_espera_minutos, s.shift_end_margin_minutes, s.wa_api_url
          FROM app_settings s
         WHERE s.organization_id = o.organization_id
         ORDER BY s.updated_at DESC NULLS LAST
         LIMIT 1) a ON true
  LOOP
    BEGIN
      INSERT INTO fila_menor_espera_estado AS e (organization_id, ultimo_tick_at)
      VALUES (v_org.organization_id, now())
      ON CONFLICT (organization_id) DO UPDATE SET ultimo_tick_at = excluded.ultimo_tick_at;

      -- Precondiciones. Cada una deja el motivo a la vista en la card.
      v_motivo := NULL;
      IF v_org.wa_api_url IS NOT NULL THEN
        -- Con el microservicio Baileys la edge function manda `content` como
        -- texto plano: sin botones no hay forma de contestar.
        v_motivo := 'Esta organización manda WhatsApp por el microservicio, que no admite botones.';
      ELSE
        SELECT * INTO v_tpl FROM public.menor_espera_plantilla_de(v_org.organization_id);
        IF NOT FOUND THEN
          v_motivo := 'Falta crear la plantilla de Menor espera en Meta.';
        ELSIF v_tpl.estado IS DISTINCT FROM 'approved' THEN
          v_motivo := format('La plantilla «%s» no está aprobada por Meta (estado: %s).', v_tpl.nombre, coalesce(v_tpl.estado, 'desconocido'));
        ELSIF NOT v_tpl.forma_ok THEN
          v_motivo := format('La plantilla «%s» cambió de forma: tiene que tener 4 variables y 2 botones de respuesta.', v_tpl.nombre);
        ELSIF nullif(btrim(v_tpl.idioma), '') IS NULL THEN
          v_motivo := format('La plantilla «%s» no tiene idioma registrado: sincronizá las plantillas.', v_tpl.nombre);
        ELSIF NOT EXISTS (
          SELECT 1 FROM organization_whatsapp_config w
           WHERE w.organization_id = v_org.organization_id AND w.is_active
             AND w.whatsapp_access_token IS NOT NULL AND w.whatsapp_phone_id IS NOT NULL) THEN
          v_motivo := 'WhatsApp no está conectado para esta organización.';
        END IF;
      END IF;

      IF v_motivo IS NOT NULL THEN
        UPDATE fila_menor_espera_estado
           SET ultimo_error = v_motivo, ultimo_error_at = now()
         WHERE organization_id = v_org.organization_id;
        CONTINUE;
      END IF;

      -- Disyuntor: los últimos 3 envíos con resultado conocido, sin ventana de
      -- tiempo. Cuentan las pruebas: una prueba que sale lo cierra.
      SELECT count(*) = 3 AND bool_and(NOT u.exito),
             (array_agg(u.error ORDER BY u.creada_at DESC) FILTER (WHERE NOT u.exito))[1]
        INTO v_disyuntor, v_ult_error
        FROM (SELECT o.creada_at,
                     coalesce(sm.status = 'sent', false) AS exito,
                     coalesce(o.error, sm.error_message,
                              CASE WHEN o.resultado = 'no_salio_a_tiempo' THEN 'no salió en 10 minutos' END) AS error
                FROM fila_ofertas_menor_espera o
                LEFT JOIN scheduled_messages sm ON sm.id = o.scheduled_message_id
               WHERE o.organization_id = v_org.organization_id
                 AND (sm.status IN ('sent','failed') OR o.resultado = 'no_salio_a_tiempo')
               ORDER BY o.creada_at DESC
               LIMIT 3) u;

      IF v_disyuntor THEN
        UPDATE fila_menor_espera_estado
           SET disyuntor_desde = coalesce(disyuntor_desde, now()),
               disyuntor_error = left(v_ult_error, 500)
         WHERE organization_id = v_org.organization_id
        RETURNING disyuntor_alerta_id INTO v_alerta_id;

        IF v_alerta_id IS NULL THEN
          INSERT INTO crm_alerts (organization_id, alert_type, title, message, metadata)
          VALUES (v_org.organization_id, 'urgent',
                  'Pausamos los avisos de Menor espera',
                  'Los últimos 3 avisos por WhatsApp no salieron'
                    || coalesce(' (' || left(v_ult_error, 200) || ')', '')
                    || '. Revisalo en Configuración → Menor espera por WhatsApp y mandate una prueba: si sale bien, los avisos vuelven solos.',
                  jsonb_build_object('origen', 'menor_espera', 'tipo', 'disyuntor'))
          RETURNING id INTO v_alerta_id;

          UPDATE fila_menor_espera_estado
             SET disyuntor_alerta_id = v_alerta_id
           WHERE organization_id = v_org.organization_id;
        END IF;
        CONTINUE;
      END IF;

      -- Todo en orden: el último error deja de ser actual.
      UPDATE fila_menor_espera_estado
         SET disyuntor_desde = NULL, disyuntor_error = NULL, disyuntor_alerta_id = NULL,
             ultimo_error = NULL, ultimo_error_at = NULL
       WHERE organization_id = v_org.organization_id
         AND (disyuntor_desde IS NOT NULL OR ultimo_error IS NOT NULL);

      -- Salida rápida: casi todos los minutos no hay nadie esperando de más.
      PERFORM 1
         FROM queue_entries q
         JOIN branches b ON b.id = q.branch_id
        WHERE b.organization_id = v_org.organization_id
          AND b.menor_espera_aviso AND b.is_active
          AND q.status = 'waiting' AND q.is_break IS NOT TRUE AND NOT q.is_appointment
          AND NOT q.is_dynamic AND q.barber_id IS NOT NULL
          AND q.checked_in_at <= now() - make_interval(mins => v_org.minutos)
          AND q.checked_in_at >= now() - make_interval(mins => v_org.minutos + 120)
        LIMIT 1;
      CONTINUE WHEN NOT FOUND;

      FOR v_c IN
        WITH br AS (
          SELECT b.id, b.name,
                 coalesce(b.timezone, 'America/Argentina/Buenos_Aires') AS tz,
                 -- Misma ventana de protección que claim_next_for_barber (45 + buffer).
                 make_interval(mins => 45 + coalesce((
                   SELECT s.buffer_minutes FROM appointment_settings s
                    WHERE s.organization_id = b.organization_id
                      AND (s.branch_id = b.id OR s.branch_id IS NULL)
                    ORDER BY s.branch_id NULLS LAST LIMIT 1), 10)) AS ventana
            FROM branches b
           WHERE b.organization_id = v_org.organization_id
             AND b.is_active
             AND b.menor_espera_aviso
             -- Horario de la sucursal (business_days: 0 = domingo). Nunca de
             -- madrugada aunque haya una entrada olvidada.
             AND extract(dow FROM now() AT TIME ZONE coalesce(b.timezone, 'America/Argentina/Buenos_Aires'))::int
                 = ANY (coalesce(b.business_days, ARRAY[1,2,3,4,5,6]))
             AND (now() AT TIME ZONE coalesce(b.timezone, 'America/Argentina/Buenos_Aires'))::time
                 >= coalesce(b.business_hours_open, time '09:00')
             AND (now() AT TIME ZONE coalesce(b.timezone, 'America/Argentina/Buenos_Aires'))::time
                 <  coalesce(b.business_hours_close, time '21:00')
        ),
        libres AS (
          -- Decisión 4. El que claim_next_for_barber atendería YA y el panel no excluye.
          SELECT s.id, s.branch_id
            FROM staff s
            JOIN br ON br.id = s.branch_id
           WHERE s.is_active AND s.deleted_at IS NULL
             AND NOT coalesce(s.hidden_from_checkin, false)
             AND (s.role = 'barber' OR s.is_also_barber)
             -- fichado: el último evento de HOY en su sucursal es clock_in
             AND (SELECT al.action_type::text FROM attendance_logs al
                   WHERE al.staff_id = s.id AND al.branch_id = s.branch_id
                     AND al.recorded_at >= (date_trunc('day', now() AT TIME ZONE br.tz) AT TIME ZONE br.tz)
                   ORDER BY al.recorded_at DESC LIMIT 1) IS NOT DISTINCT FROM 'clock_in'
             -- ni atendiendo ni en descanso (los dos son in_progress)
             AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.barber_id = s.id AND q.status = 'in_progress')
             -- sin clientes propios, turnos ni descanso encolado esperando
             AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.barber_id = s.id AND q.status = 'waiting')
             AND NOT EXISTS (SELECT 1 FROM appointment_staff aps
                              WHERE aps.staff_id = s.id AND aps.walkin_mode = 'appointments_only')
             AND NOT public.is_barber_blocked_by_shift_end(s.id, br.tz, v_org.margen)
             AND NOT EXISTS (SELECT 1 FROM appointments a
                              WHERE a.barber_id = s.id AND a.branch_id = s.branch_id
                                AND a.status IN ('confirmed','checked_in')
                                AND lower(a.time_range) > now()
                                AND lower(a.time_range) <= now() + br.ventana)
             -- anti «fantasma»: se fue a almorzar sin fichar ni pedir descanso.
             -- Por visits (idx_visits_barber_completed): queue_entries por
             -- barbero escanea todo su historial.
             AND (EXISTS (SELECT 1 FROM visits v
                           WHERE v.barber_id = s.id
                             AND v.completed_at >= now() - interval '60 minutes')
                  OR EXISTS (SELECT 1 FROM attendance_logs al
                              WHERE al.staff_id = s.id AND al.action_type = 'clock_in'
                                AND al.recorded_at >= now() - interval '60 minutes'))
        ),
        cap AS (
          SELECT br.id AS branch_id, count(l.id)::int AS libres
            FROM br LEFT JOIN libres l ON l.branch_id = br.id
           GROUP BY br.id
        ),
        en_vuelo AS (
          -- Ofertas sin respuesta de los últimos 10 min «reservan» un barbero libre.
          SELECT o.branch_id, count(*)::int AS n
            FROM fila_ofertas_menor_espera o
           WHERE o.organization_id = v_org.organization_id
             AND NOT o.es_prueba
             AND o.estado IN ('en_cola','enviada')
             AND o.respondida_at IS NULL
             AND o.creada_at > now() - interval '10 minutes'
           GROUP BY o.branch_id
        ),
        pool AS (
          -- Decisión 5: TODOS los dinámicos que esperan hoy, no sólo los más viejos.
          SELECT d.branch_id, count(*)::int AS n
            FROM queue_entries d
            JOIN br ON br.id = d.branch_id
           WHERE d.status = 'waiting'
             AND d.is_break IS NOT TRUE AND NOT d.is_appointment
             AND (d.barber_id IS NULL OR d.is_dynamic)
             AND (d.checked_in_at AT TIME ZONE br.tz)::date = (now() AT TIME ZONE br.tz)::date
           GROUP BY d.branch_id
        ),
        cand AS (
          SELECT q.id, q.branch_id, q.client_id, q.barber_id, q.priority_order,
                 floor(extract(epoch FROM now() - q.checked_in_at) / 60)::int AS minutos,
                 c.phone,
                 public.menor_espera_nombre_cliente(c.name)      AS nombre,
                 public.menor_espera_nombre_barbero(q.barber_id) AS barbero,
                 regexp_replace(btrim(br.name), '\s+', ' ', 'g') AS sucursal,
                 row_number() OVER (PARTITION BY q.branch_id ORDER BY q.priority_order, q.checked_in_at) AS rn
            FROM queue_entries q
            JOIN br ON br.id = q.branch_id
            JOIN clients c ON c.id = q.client_id
           WHERE q.status = 'waiting'
             AND q.is_break IS NOT TRUE AND NOT q.is_appointment AND NOT q.is_dynamic
             AND q.barber_id IS NOT NULL
             AND (q.checked_in_at AT TIME ZONE br.tz)::date = (now() AT TIME ZONE br.tz)::date
             AND q.checked_in_at <= now() - make_interval(mins => v_org.minutos)
             -- más de 2 h por encima del umbral = probablemente se fue y nadie lo sacó
             AND q.checked_in_at >= now() - make_interval(mins => v_org.minutos + 120)
             -- ni clientes «Especiales» (00XXXXXXXX) ni teléfonos basura
             AND public.is_real_phone(c.phone) AND length(public.phone_tail(c.phone)) = 10
             AND public.menor_espera_nombre_cliente(c.name) IS NOT NULL
             AND nullif(btrim(public.menor_espera_nombre_barbero(q.barber_id)), '') IS NOT NULL
             -- una oferta por entrada
             AND NOT EXISTS (SELECT 1 FROM fila_ofertas_menor_espera o
                              WHERE o.queue_entry_id = q.id AND NOT o.es_prueba)
             -- pidió la baja
             AND NOT EXISTS (SELECT 1 FROM fila_menor_espera_bajas bj WHERE bj.client_id = q.client_id)
             -- dijo «no» dos veces en 90 días: quiere a SU barbero, no insistir
             AND (SELECT count(*) FROM fila_ofertas_menor_espera o2
                   WHERE o2.client_id = q.client_id AND NOT o2.es_prueba
                     AND o2.respuesta = 'no'
                     AND o2.creada_at > now() - interval '90 days') < 2
             -- dejó sin respuesta 3 ofertas en 60 días (habiendo tenido al
             -- menos 10 min para contestar): tampoco insistir
             AND (SELECT count(*) FROM fila_ofertas_menor_espera o3
                   WHERE o3.client_id = q.client_id AND NOT o3.es_prueba
                     AND o3.enviada_at IS NOT NULL AND o3.respondida_at IS NULL
                     AND o3.creada_at > now() - interval '60 days'
                     AND o3.creada_at < now() - interval '2 hours'
                     AND (o3.cerrada_at IS NULL OR o3.cerrada_at >= o3.enviada_at + interval '10 minutes')) < 3
        )
        SELECT cand.*, cap.libres
          FROM cand
          JOIN cap ON cap.branch_id = cand.branch_id
          LEFT JOIN en_vuelo ev ON ev.branch_id = cand.branch_id
          LEFT JOIN pool p      ON p.branch_id  = cand.branch_id
         WHERE cand.rn <= cap.libres - coalesce(ev.n, 0) - coalesce(p.n, 0)
         ORDER BY cand.branch_id, cand.rn
      LOOP
        INSERT INTO fila_ofertas_menor_espera
          (organization_id, branch_id, queue_entry_id, client_id, barbero_original_id, minutos_espera, barberos_libres)
        VALUES
          (v_org.organization_id, v_c.branch_id, v_c.id, v_c.client_id, v_c.barber_id, v_c.minutos, v_c.libres)
        ON CONFLICT (queue_entry_id) WHERE NOT es_prueba DO NOTHING
        RETURNING id INTO v_oferta_id;
        CONTINUE WHEN v_oferta_id IS NULL;

        INSERT INTO scheduled_messages
          (organization_id, client_id, channel_id, phone, template_id, template_name, template_language,
           template_params, content, scheduled_for, status)
        VALUES
          (v_org.organization_id, v_c.client_id, v_tpl.channel_id, v_c.phone, v_tpl.template_id, v_tpl.nombre,
           v_tpl.idioma,  -- el idioma REGISTRADO en Meta ('es'), nunca el default es_AR (132001)
           -- Sólo el BODY: la v16 descarta sub_type/index de los botones (decisión 1).
           jsonb_build_array(
             jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(
               jsonb_build_object('type', 'text', 'text', v_c.nombre),
               jsonb_build_object('type', 'text', 'text', v_c.minutos::text),
               jsonb_build_object('type', 'text', 'text', v_c.barbero),
               jsonb_build_object('type', 'text', 'text', v_c.sucursal)))),
           public.menor_espera_render(v_tpl.componentes,
             ARRAY[v_c.nombre, v_c.minutos::text, v_c.barbero, v_c.sucursal]),
           -- Decisión 7: primero en la cola de envíos.
           now() - interval '1 hour',
           'pending')
        RETURNING id INTO v_sm_id;

        UPDATE fila_ofertas_menor_espera SET scheduled_message_id = v_sm_id WHERE id = v_oferta_id;
        v_creadas := v_creadas + 1;
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
      -- Una org con un problema no frena a las demás, pero queda a la vista.
      v_err := SQLERRM;
      BEGIN
        INSERT INTO fila_menor_espera_estado (organization_id, ultimo_tick_at, ultimo_error, ultimo_error_at)
        VALUES (v_org.organization_id, now(), left(v_err, 500), now())
        ON CONFLICT (organization_id) DO UPDATE
          SET ultimo_tick_at  = excluded.ultimo_tick_at,
              ultimo_error    = excluded.ultimo_error,
              ultimo_error_at = excluded.ultimo_error_at;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      RAISE WARNING '[menor_espera_ofertas_tick] org %: %', v_org.organization_id, v_err;
    END;
  END LOOP;

  RETURN jsonb_build_object('creadas', v_creadas, 'vencidas', v_vencidas);
END;
$$;


-- ── 5.3 Respuesta del cliente (la llama el webhook de WhatsApp) ──────────────
CREATE OR REPLACE FUNCTION public.menor_espera_responder(
  p_oferta_id        uuid,
  p_respuesta        text,   -- 'si' | 'no'
  p_organization_id  uuid,   -- org resuelta por phone_number_id en el webhook
  p_telefono         text    -- message.from tal como lo manda Meta (549...)
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_o          fila_ofertas_menor_espera%ROWTYPE;
  v_q          queue_entries%ROWTYPE;
  v_cliente    text;
  v_tel        text;
  v_barbero    text;
  v_actual     text;
  v_sucursal   text;
  v_resultado  text;
  v_cambio     boolean := false;
  v_previa     timestamptz;
BEGIN
  IF p_respuesta IS NULL OR p_respuesta NOT IN ('si','no') THEN
    RETURN jsonb_build_object('resultado', 'invalida', 'cambio', false);
  END IF;

  SELECT * INTO v_o FROM fila_ofertas_menor_espera WHERE id = p_oferta_id FOR UPDATE;
  IF NOT FOUND OR v_o.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN jsonb_build_object('resultado', 'no_encontrada', 'cambio', false);
  END IF;

  -- El webhook no exige HMAC: el que contesta tiene que ser el dueño del teléfono.
  SELECT public.menor_espera_nombre_cliente(c.name), c.phone
    INTO v_cliente, v_tel
    FROM clients c WHERE c.id = v_o.client_id;
  IF length(public.phone_tail(p_telefono)) <> 10
     OR public.phone_tail(v_tel) IS DISTINCT FROM public.phone_tail(p_telefono) THEN
    RETURN jsonb_build_object('resultado', 'telefono_no_coincide', 'cambio', false, 'oferta_id', v_o.id);
  END IF;

  v_barbero := public.menor_espera_nombre_barbero(v_o.barbero_original_id);
  SELECT regexp_replace(btrim(b.name), '\s+', ' ', 'g') INTO v_sucursal
    FROM branches b WHERE b.id = v_o.branch_id;

  -- Una prueba nunca toca una fila: sólo confirma que el circuito volvió.
  IF v_o.es_prueba THEN
    RETURN jsonb_build_object(
      'resultado', 'prueba', 'cambio', false, 'es_prueba', true, 'respuesta', p_respuesta,
      'oferta_id', v_o.id, 'cliente', v_cliente, 'sucursal', v_sucursal);
  END IF;

  v_previa := v_o.respondida_at;

  -- Lock de la fila: si un claim_next_for_barber la está tomando en este
  -- instante, esperamos su commit y decidimos sobre el estado final.
  SELECT * INTO v_q FROM queue_entries WHERE id = v_o.queue_entry_id FOR UPDATE;

  IF v_q.id IS NULL OR v_q.status = 'cancelled' THEN
    v_resultado := 'fuera_de_fila';
  ELSIF v_q.status = 'in_progress' THEN
    v_resultado := 'ya_lo_atienden';
    v_actual := public.menor_espera_nombre_barbero(v_q.barber_id);
  ELSIF v_q.status = 'completed' THEN
    v_resultado := 'ya_atendido';
  ELSIF v_q.is_appointment OR v_q.is_break IS TRUE THEN
    -- Nunca se mueve un turno ni un descanso.
    v_resultado := 'es_turno';
    v_actual := public.menor_espera_nombre_barbero(v_q.barber_id);
  ELSIF p_respuesta = 'no' THEN
    IF v_o.estado = 'aceptada' THEN
      -- Volver con su barbero es decisión de la recepción, no automática.
      v_resultado := 'ya_estaba_en_menor_espera_no';
    ELSE
      -- Lo que se le contesta depende de dónde está HOY la entrada: «seguís
      -- esperando a Nico» sólo es verdad si la recepción no lo movió.
      v_resultado := CASE
        WHEN v_q.barber_id IS NULL OR v_q.is_dynamic                    THEN 'rechazada_en_menor_espera'
        WHEN v_q.barber_id IS DISTINCT FROM v_o.barbero_original_id     THEN 'rechazada_otro_barbero'
        ELSE 'rechazada'
      END;
      IF v_resultado = 'rechazada_otro_barbero' THEN
        v_actual := public.menor_espera_nombre_barbero(v_q.barber_id);
      END IF;
      v_cambio := v_o.respuesta IS DISTINCT FROM 'no';
      UPDATE fila_ofertas_menor_espera
         SET estado = 'rechazada', respuesta = 'no',
             respondida_at = CASE WHEN v_cambio THEN now() ELSE respondida_at END,
             cerrada_at = coalesce(cerrada_at, now()),
             resultado = 'prefirio_esperar'
       WHERE id = v_o.id;
    END IF;
  ELSIF v_q.barber_id IS NULL OR v_q.is_dynamic THEN
    -- Ya estaba en el pool (la recepción lo pasó, o es un doble toque).
    v_resultado := 'ya_estaba_en_menor_espera';
    IF v_o.estado <> 'aceptada' THEN
      v_cambio := true;
      UPDATE fila_ofertas_menor_espera
         SET estado = 'aceptada', respuesta = 'si', respondida_at = now(), cerrada_at = now(),
             resultado = 'ya_estaba_en_menor_espera'
       WHERE id = v_o.id;
    END IF;
  ELSE
    -- La transición canónica de «Menor espera» (la misma de reassignMyBarber del
    -- kiosko): barber_id NULL + is_dynamic. priority_order NO se toca: ése es
    -- «conservás tu lugar». El barbero original queda anotado para que el panel
    -- lo siga mostrando en su «Mi fila».
    UPDATE queue_entries
       SET barber_id = NULL,
           is_dynamic = true,
           dynamic_via_whatsapp_at = now(),
           menor_espera_barbero_original_id = v_q.barber_id
     WHERE id = v_q.id AND status = 'waiting';
    UPDATE fila_ofertas_menor_espera
       SET estado = 'aceptada', respuesta = 'si', respondida_at = now(), cerrada_at = now(),
           resultado = CASE WHEN v_o.respuesta = 'no' THEN 'movido_cambio_de_opinion' ELSE 'movido' END
     WHERE id = v_o.id;
    v_resultado := 'movida';
    v_cambio := true;
  END IF;

  -- Respondió cuando ya no había nada que mover: queda registrado igual.
  IF v_resultado IN ('fuera_de_fila','ya_lo_atienden','ya_atendido','es_turno')
     AND v_o.respondida_at IS NULL THEN
    v_cambio := true;
    UPDATE fila_ofertas_menor_espera
       SET respuesta = p_respuesta, respondida_at = now(),
           estado = CASE WHEN estado IN ('en_cola','enviada') THEN 'vencida' ELSE estado END,
           resultado = coalesce(resultado, 'respondio_tarde'),
           cerrada_at = coalesce(cerrada_at, now())
     WHERE id = v_o.id;
  END IF;

  RETURN jsonb_build_object(
    'resultado', v_resultado,
    'cambio', v_cambio,
    'segundos_desde_respuesta_previa',
      CASE WHEN v_previa IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - v_previa))::int END,
    'oferta_id', v_o.id,
    'es_prueba', false,
    'respuesta', p_respuesta,
    'cliente', v_cliente,
    'barbero', v_barbero,
    'barbero_actual', v_actual,
    'sucursal', v_sucursal);
END;
$$;


-- ── 5.4 Contexto de un mensaje entrante (lo pide el webhook, uno por mensaje) ─
-- Devuelve, para ese teléfono y esa org:
--   botones   textos de los QUICK_REPLY de la plantilla configurada (sólo si
--             p_es_boton: es lo único que decide si un `button` es nuestro).
--   boton     la oferta más reciente de los últimos 90 min, en cualquier estado:
--             la RPC sabe contestar cada uno («ya te está atendiendo Nico»).
--   texto     la oferta a la que un «sí»/«no» ESCRITO puede estar contestando:
--             en_cola/enviada, salió hace menos de 30 min, la entrada sigue
--             esperando y no es turno, y el último saliente de la conversación
--             es nuestra plantilla. (Una prueba cuenta sin entrada.)
--   contexto  hay una oferta recibida en los últimos 90 min y la entrada sigue
--             esperando: cualquier otro mensaje es una respuesta al aviso y no
--             puede disparar la Bienvenida en medio de la fila.
-- Sale rápido cuando no hay nada (el caso de casi todos los mensajes).
CREATE OR REPLACE FUNCTION public.menor_espera_contexto(
  p_organization_id  uuid,
  p_telefono         text,
  p_conversation_id  uuid,
  p_es_boton         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tail      text := public.phone_tail(p_telefono);
  v_botones   text[];
  v_boton     jsonb;
  v_texto     jsonb;
  v_contexto  jsonb;
  v_ultimo    text;
BEGIN
  IF p_es_boton THEN
    SELECT public.menor_espera_botones(t.componentes) INTO v_botones
      FROM public.menor_espera_plantilla_de(p_organization_id) t;
  END IF;

  IF length(v_tail) <> 10 OR NOT EXISTS (
       SELECT 1 FROM fila_ofertas_menor_espera o
        WHERE o.organization_id = p_organization_id
          AND o.creada_at > now() - interval '90 minutes') THEN
    RETURN jsonb_build_object('botones', to_jsonb(v_botones), 'boton', NULL, 'texto', NULL, 'contexto', NULL);
  END IF;

  -- El último saliente de la conversación (para el «sí» escrito).
  IF p_conversation_id IS NOT NULL THEN
    SELECT m.template_name INTO v_ultimo
      FROM messages m
     WHERE m.conversation_id = p_conversation_id AND m.direction = 'outbound'
     ORDER BY m.created_at DESC
     LIMIT 1;
  END IF;

  WITH o AS (
    SELECT o.id, o.estado, o.es_prueba, o.creada_at, o.aviso_recepcion_at, o.client_id,
           coalesce(o.enviada_at, CASE WHEN sm.status = 'sent' THEN coalesce(sm.sent_at, o.creada_at) END) AS salio_at,
           sm.template_name,
           q.status AS q_status,
           q.is_appointment AS q_turno,
           public.menor_espera_nombre_cliente(c.name) AS cliente
      FROM fila_ofertas_menor_espera o
      JOIN clients c ON c.id = o.client_id
      LEFT JOIN scheduled_messages sm ON sm.id = o.scheduled_message_id
      LEFT JOIN queue_entries q ON q.id = o.queue_entry_id
     WHERE o.organization_id = p_organization_id
       AND o.creada_at > now() - interval '90 minutes'
       AND public.phone_tail(c.phone) = v_tail
  )
  SELECT
    (SELECT jsonb_build_object('id', b.id, 'es_prueba', b.es_prueba, 'estado', b.estado)
       FROM o b ORDER BY coalesce(b.salio_at, b.creada_at) DESC LIMIT 1),
    (SELECT jsonb_build_object('id', t.id, 'es_prueba', t.es_prueba, 'estado', t.estado)
       FROM o t
      WHERE t.estado IN ('en_cola','enviada')
        AND t.salio_at IS NOT NULL AND t.salio_at > now() - interval '30 minutes'
        AND (t.es_prueba OR (t.q_status = 'waiting' AND t.q_turno IS NOT TRUE))
        AND v_ultimo IS NOT NULL
        AND v_ultimo = t.template_name
      ORDER BY t.salio_at DESC LIMIT 1),
    (SELECT jsonb_build_object('id', x.id, 'estado', x.estado, 'cliente', x.cliente,
                               'aviso_recepcion', x.aviso_recepcion_at IS NOT NULL)
       FROM o x
      WHERE NOT x.es_prueba
        AND x.salio_at IS NOT NULL
        AND x.q_status = 'waiting'
      ORDER BY x.salio_at DESC LIMIT 1)
    INTO v_boton, v_texto, v_contexto;

  RETURN jsonb_build_object('botones', to_jsonb(v_botones), 'boton', v_boton, 'texto', v_texto, 'contexto', v_contexto);
END;
$$;


-- ── 5.5 Una respuesta libre al aviso: UNA alerta para la recepción por oferta ─
CREATE OR REPLACE FUNCTION public.menor_espera_avisar_recepcion(
  p_oferta_id        uuid,
  p_organization_id  uuid,
  p_conversation_id  uuid,
  p_titulo           text,
  p_mensaje          text,
  p_metadata         jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE fila_ofertas_menor_espera
     SET aviso_recepcion_at = now()
   WHERE id = p_oferta_id
     AND organization_id = p_organization_id
     AND aviso_recepcion_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO crm_alerts (organization_id, conversation_id, alert_type, title, message, metadata)
  VALUES (p_organization_id, p_conversation_id, 'warning', p_titulo, p_mensaje,
          coalesce(p_metadata, '{}'::jsonb)
            || jsonb_build_object('origen', 'menor_espera', 'oferta_id', p_oferta_id));
  RETURN true;
END;
$$;


-- ── 5.6 Baja: «no me escriban más» ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.menor_espera_registrar_baja(
  p_oferta_id        uuid,
  p_organization_id  uuid,
  p_telefono         text,
  p_mensaje          text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_o        fila_ofertas_menor_espera%ROWTYPE;
  v_cliente  text;
  v_tel      text;
  v_nueva    integer;
BEGIN
  SELECT * INTO v_o FROM fila_ofertas_menor_espera WHERE id = p_oferta_id FOR UPDATE;
  IF NOT FOUND OR v_o.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN jsonb_build_object('resultado', 'no_encontrada');
  END IF;

  SELECT public.menor_espera_nombre_cliente(c.name), c.phone INTO v_cliente, v_tel
    FROM clients c WHERE c.id = v_o.client_id;
  IF length(public.phone_tail(p_telefono)) <> 10
     OR public.phone_tail(v_tel) IS DISTINCT FROM public.phone_tail(p_telefono) THEN
    RETURN jsonb_build_object('resultado', 'telefono_no_coincide', 'oferta_id', v_o.id);
  END IF;

  INSERT INTO fila_menor_espera_bajas (client_id, organization_id, mensaje)
  VALUES (v_o.client_id, v_o.organization_id, left(p_mensaje, 500))
  ON CONFLICT (client_id) DO NOTHING;
  GET DIAGNOSTICS v_nueva = ROW_COUNT;

  -- Pedir la baja también contesta ESTA oferta, sin mover nada. Si ya había
  -- aceptado, el movimiento queda como estaba.
  UPDATE fila_ofertas_menor_espera
     SET estado = CASE WHEN estado IN ('en_cola','enviada') THEN 'rechazada' ELSE estado END,
         resultado = CASE WHEN estado IN ('en_cola','enviada') THEN 'pidio_baja' ELSE resultado END,
         respondida_at = coalesce(respondida_at, now()),
         cerrada_at = coalesce(cerrada_at, now())
   WHERE id = v_o.id;

  RETURN jsonb_build_object(
    'resultado', CASE WHEN v_nueva > 0 THEN 'baja' ELSE 'ya_estaba' END,
    'oferta_id', v_o.id,
    'cliente', v_cliente);
END;
$$;


-- ── 5.7 Prueba desde el dashboard ──────────────────────────────────────────
-- El cliente se resuelve por teléfono DENTRO de la org y NUNCA se crea una
-- ficha (la difusión del 27/07 fabricó 134). Tres por día por organización.
-- Usa la misma plantilla, el mismo render y la misma prioridad que el tick: lo
-- que llega al teléfono del dueño es exactamente lo que le llega a un cliente.
CREATE OR REPLACE FUNCTION public.menor_espera_crear_prueba(
  p_organization_id  uuid,
  p_telefono         text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tail      text := public.phone_tail(p_telefono);
  v_tpl       record;
  v_cli       record;
  v_br        record;
  v_nombre    text;
  v_barbero   text;
  v_minutos   integer;
  v_tz        text;
  v_hoy       timestamptz;
  v_oferta_id uuid;
  v_sm_id     uuid;
BEGIN
  IF NOT public.is_real_phone(p_telefono) OR length(v_tail) <> 10 THEN
    RETURN jsonb_build_object('error', 'telefono_invalido');
  END IF;

  IF EXISTS (SELECT 1 FROM app_settings a
              WHERE a.organization_id = p_organization_id AND a.wa_api_url IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'baileys');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organization_whatsapp_config w
                  WHERE w.organization_id = p_organization_id AND w.is_active
                    AND w.whatsapp_access_token IS NOT NULL AND w.whatsapp_phone_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'sin_whatsapp');
  END IF;

  SELECT * INTO v_tpl FROM public.menor_espera_plantilla_de(p_organization_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'plantilla_inexistente');
  ELSIF v_tpl.estado IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('error', 'plantilla_no_aprobada', 'estado', v_tpl.estado);
  ELSIF NOT v_tpl.forma_ok OR nullif(btrim(v_tpl.idioma), '') IS NULL THEN
    RETURN jsonb_build_object('error', 'plantilla_forma');
  END IF;

  SELECT b.id, b.name, coalesce(b.timezone, 'America/Argentina/Buenos_Aires') AS tz INTO v_br
    FROM branches b
   WHERE b.organization_id = p_organization_id AND b.is_active
   ORDER BY b.menor_espera_aviso DESC, b.name
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'sin_sucursales');
  END IF;

  v_tz := v_br.tz;
  v_hoy := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  IF (SELECT count(*) FROM fila_ofertas_menor_espera o
       WHERE o.organization_id = p_organization_id AND o.es_prueba AND o.creada_at >= v_hoy) >= 3 THEN
    RETURN jsonb_build_object('error', 'limite_diario');
  END IF;

  SELECT c.id, c.name, c.phone INTO v_cli
    FROM clients c
   WHERE c.organization_id = p_organization_id
     AND public.phone_tail(c.phone) = v_tail
   ORDER BY (SELECT max(v.completed_at) FROM visits v WHERE v.client_id = c.id) DESC NULLS LAST,
            c.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'cliente_no_encontrado');
  END IF;

  v_nombre := public.menor_espera_nombre_cliente(v_cli.name);
  IF v_nombre IS NULL THEN
    RETURN jsonb_build_object('error', 'cliente_sin_nombre');
  END IF;

  SELECT public.menor_espera_nombre_barbero(s.id) INTO v_barbero
    FROM staff s
   WHERE s.branch_id = v_br.id AND s.is_active AND s.deleted_at IS NULL
     AND NOT coalesce(s.hidden_from_checkin, false)
     AND (s.role = 'barber' OR s.is_also_barber)
   ORDER BY s.full_name
   LIMIT 1;
  v_barbero := coalesce(nullif(btrim(v_barbero), ''), 'tu barbero');

  SELECT coalesce(a.menor_espera_minutos, 45)::int INTO v_minutos
    FROM app_settings a WHERE a.organization_id = p_organization_id
   ORDER BY a.updated_at DESC NULLS LAST LIMIT 1;
  v_minutos := coalesce(v_minutos, 45);

  INSERT INTO fila_ofertas_menor_espera
    (organization_id, branch_id, queue_entry_id, client_id, barbero_original_id, es_prueba,
     minutos_espera, barberos_libres, resultado)
  VALUES
    (p_organization_id, v_br.id, NULL, v_cli.id, NULL, true, v_minutos, 0, 'prueba')
  RETURNING id INTO v_oferta_id;

  INSERT INTO scheduled_messages
    (organization_id, client_id, channel_id, phone, template_id, template_name, template_language,
     template_params, content, scheduled_for, status)
  VALUES
    (p_organization_id, v_cli.id, v_tpl.channel_id, v_cli.phone, v_tpl.template_id, v_tpl.nombre, v_tpl.idioma,
     jsonb_build_array(
       jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(
         jsonb_build_object('type', 'text', 'text', v_nombre),
         jsonb_build_object('type', 'text', 'text', v_minutos::text),
         jsonb_build_object('type', 'text', 'text', v_barbero),
         jsonb_build_object('type', 'text', 'text', regexp_replace(btrim(v_br.name), '\s+', ' ', 'g'))))),
     public.menor_espera_render(v_tpl.componentes,
       ARRAY[v_nombre, v_minutos::text, v_barbero, regexp_replace(btrim(v_br.name), '\s+', ' ', 'g')]),
     now() - interval '1 hour',
     'pending')
  RETURNING id INTO v_sm_id;

  UPDATE fila_ofertas_menor_espera SET scheduled_message_id = v_sm_id WHERE id = v_oferta_id;

  RETURN jsonb_build_object('ok', true, 'oferta_id', v_oferta_id, 'cliente', v_nombre,
                            'sucursal', regexp_replace(btrim(v_br.name), '\s+', ' ', 'g'),
                            'barbero', v_barbero, 'minutos', v_minutos);
END;
$$;


-- ── 5.8 Panel del dashboard: configuración, plantilla, latido y métricas ─────
-- Las métricas respetan el alcance de sucursales del usuario (p_branch_ids;
-- NULL = todas): un encargado de una sucursal no ve agregados de las otras.
CREATE OR REPLACE FUNCTION public.menor_espera_panel(
  p_organization_id  uuid,
  p_dias             integer DEFAULT 30,
  p_branch_ids       uuid[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cfg        record;
  v_tpl        jsonb;
  v_estado     jsonb;
  v_metricas   jsonb;
  v_tz         text;
  v_hoy        timestamptz;
BEGIN
  SELECT coalesce(a.menor_espera_minutos, 45)::int                 AS minutos,
         coalesce(a.menor_espera_plantilla, 'fila_menor_espera')   AS plantilla,
         a.wa_api_url IS NOT NULL                                  AS baileys
    INTO v_cfg
    FROM (SELECT 1) uno
    LEFT JOIN LATERAL (
      SELECT s.menor_espera_minutos, s.menor_espera_plantilla, s.wa_api_url
        FROM app_settings s WHERE s.organization_id = p_organization_id
       ORDER BY s.updated_at DESC NULLS LAST LIMIT 1) a ON true;

  SELECT jsonb_build_object(
           'existe', true, 'nombre', t.nombre, 'idioma', t.idioma, 'estado', t.estado,
           'categoria', t.categoria, 'forma_ok', t.forma_ok, 'componentes', t.componentes,
           'botones', to_jsonb(public.menor_espera_botones(t.componentes)))
    INTO v_tpl
    FROM public.menor_espera_plantilla_de(p_organization_id) t;

  SELECT to_jsonb(e) - 'organization_id' INTO v_estado
    FROM fila_menor_espera_estado e WHERE e.organization_id = p_organization_id;

  SELECT coalesce(min(coalesce(b.timezone, 'America/Argentina/Buenos_Aires')), 'America/Argentina/Buenos_Aires')
    INTO v_tz FROM branches b WHERE b.organization_id = p_organization_id AND b.is_active;
  v_hoy := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  SELECT jsonb_build_object(
           'enviadas',            count(*) FILTER (WHERE o.enviada_at IS NOT NULL),
           'aceptaron',           count(*) FILTER (WHERE o.estado = 'aceptada'),
           'prefirieron_esperar', count(*) FILTER (WHERE o.respuesta = 'no'),
           'sin_respuesta',       count(*) FILTER (WHERE o.enviada_at IS NOT NULL AND o.respondida_at IS NULL),
           'no_salieron',         count(*) FILTER (WHERE o.estado = 'fallida' OR o.resultado = 'no_salio_a_tiempo'),
           'atendidos_por_otro',  count(*) FILTER (WHERE o.estado = 'aceptada' AND o.atendido_por_id IS NOT NULL
                                                     AND o.atendido_por_id IS DISTINCT FROM o.barbero_original_id),
           'mediana_min_hasta_atencion',
             round((percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM o.atendido_at - o.respondida_at) / 60.0)
               FILTER (WHERE o.estado = 'aceptada' AND o.atendido_at IS NOT NULL
                         AND o.respondida_at IS NOT NULL AND o.atendido_at >= o.respondida_at))::numeric, 1))
    INTO v_metricas
    FROM fila_ofertas_menor_espera o
   WHERE o.organization_id = p_organization_id
     AND NOT o.es_prueba
     AND (p_branch_ids IS NULL OR o.branch_id = ANY (p_branch_ids))
     AND o.creada_at > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));

  RETURN jsonb_build_object(
    'ahora', now(),
    'config', jsonb_build_object('minutos', v_cfg.minutos, 'plantilla', v_cfg.plantilla),
    'transporte', jsonb_build_object(
      'baileys', coalesce(v_cfg.baileys, false),
      'whatsapp', EXISTS (SELECT 1 FROM organization_whatsapp_config w
                           WHERE w.organization_id = p_organization_id AND w.is_active
                             AND w.whatsapp_access_token IS NOT NULL AND w.whatsapp_phone_id IS NOT NULL)),
    'plantilla', coalesce(v_tpl, jsonb_build_object('existe', false, 'nombre', v_cfg.plantilla)),
    'latido', v_estado,
    'metricas', v_metricas,
    'bajas', (SELECT count(*) FROM fila_menor_espera_bajas bj WHERE bj.organization_id = p_organization_id),
    'pruebas_hoy', (SELECT count(*) FROM fila_ofertas_menor_espera o
                     WHERE o.organization_id = p_organization_id AND o.es_prueba AND o.creada_at >= v_hoy));
END;
$$;


-- ── 5.9 Permisos: sólo service_role (REVOKE FROM PUBLIC no alcanza en Supabase) ─
REVOKE ALL ON FUNCTION public.menor_espera_forma_ok(jsonb)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_botones(jsonb)                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_render(jsonb, text[])                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_nombre_cliente(text)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_nombre_barbero(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_plantilla_de(uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_ofertas_tick()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_responder(uuid, text, uuid, text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_contexto(uuid, text, uuid, boolean)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_avisar_recepcion(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_registrar_baja(uuid, uuid, text, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_crear_prueba(uuid, text)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_panel(uuid, integer, uuid[])                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.menor_espera_forma_ok(jsonb)                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_botones(jsonb)                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_render(jsonb, text[])                             TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_nombre_cliente(text)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_nombre_barbero(uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_plantilla_de(uuid)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_ofertas_tick()                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_responder(uuid, text, uuid, text)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_contexto(uuid, text, uuid, boolean)               TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_avisar_recepcion(uuid, uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_registrar_baja(uuid, uuid, text, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_crear_prueba(uuid, text)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_panel(uuid, integer, uuid[])                      TO service_role;

COMMIT;


-- ── 6. Cron SQL puro, cada minuto (Known Risk #26: nada de HTTP ni CRON_SECRET) ─
-- cron.schedule con nombre es upsert (pg_cron 1.6): re-correr no duplica el job.
-- Para verificar: NO mirar job_run_details (en un job SQL dice «1 row»), sino
-- fila_menor_espera_estado.ultimo_tick_at y una corrida manual del tick.
SELECT cron.schedule('menor-espera-ofertas', '* * * * *', $$SELECT public.menor_espera_ofertas_tick()$$);
