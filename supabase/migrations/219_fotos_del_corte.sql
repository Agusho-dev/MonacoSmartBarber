-- APLICADA en prod el 4/10/2026 EN CINCO PARTES, con el mismo contenido que este archivo:
-- schema_migrations «219a_fotos_sesion_columnas», «219b1_fotos_subidas_e_indices», «219c_fotos_rpc»,
-- «219d_fotos_cierre_sesiones_viejas» y «219e_fotos_bucket_limites». Las RPC se reemplazaron
-- después en la 219g. NO re-correr.
-- ============================================================================
-- 219 — Fotos del corte: una sesión por cobro, atada en el servidor (aditiva)
-- ============================================================================
-- El panel del barbero no guarda una foto del corte desde el 28/4/2026 y no
-- muestra ninguna desde el 30/3:
--
--  · La mig 131 (schema_migrations 20260428042316; el archivo 131 del repo es
--    OTRO, 131_push_on_complete_root_fix.sql) cambió el INSERT anónimo de
--    visit_photos por un EXISTS sobre visits, y una vez cobrada la entrada anon
--    ya no ve la visita: "new row violates row-level security policy". Evidencia
--    en prod: 27/8 21:24:31 UTC, un segundo después de cobrar la visita
--    cd0ce7df (Caseros) con 2 fotos subidas por QR que nunca se vincularon.
--  · multi_tenant_rls_tier2 (20260330085948) dropeó visit_photos_read_all: el
--    panel (anon) lee 0 de las 7 fotos que hay en toda la historia.
--
-- El rediseño: la tablet y el celular suben DIRECTO a Storage con una URL
-- firmada (los bytes no pasan por un server action: Next 16 los serializa y el
-- cobro quedaba esperando detrás de las fotos), el servidor registra cada foto
-- en una sesión atada a la ENTRADA de la fila, y completeService ata la sesión
-- a la visita y copia las fotos con fotos_vincular_entrada. Todo lo que escribe
-- pasa por estas RPC (sólo service_role) y se serializa por entrada con un
-- advisory lock: una foto que llega DURANTE el cobro no se pierde, porque
-- registrar mira si hay visita DESPUÉS de insertar su fila y vincular ata ANTES
-- de copiar.
--
-- Esta migración sólo AGREGA (columnas, índices, funciones, límites del
-- bucket): el código viejo sigue andando igual. Las policies anónimas se
-- cierran recién en la 219b, con el gate de 24 h.
--
-- ORDEN: aplicar ANTES del deploy del código nuevo (el código lee las columnas
-- nuevas). Fuera de horario (antes de las 9 o después de las 21): no toca
-- tablas calientes —ninguna FK nueva hacia queue_entries ni visits—, pero crea
-- índices en tablas que la tablet escribe.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1) La sesión de fotos queda atada al cobro
-- ----------------------------------------------------------------------------
-- SIN FKs a propósito: una FK hacia queue_entries o visits toma un lock sobre
-- las dos tablas más escritas al crearse, y cada INSERT de la sesión haría
-- FOR KEY SHARE sobre la entrada mientras dura la transacción: claim_next_for_barber
-- la toma con FOR UPDATE SKIP LOCKED y la saltearía (mismo criterio que la 218).
-- Tampoco hacia branches/staff: no hacen falta para nada y suman relaciones al
-- caché de PostgREST (KR#15). La integridad la garantiza fotos_abrir_sesion,
-- que es la única que crea sesiones de fotos.
ALTER TABLE public.qr_photo_sessions
  ADD COLUMN IF NOT EXISTS branch_id      uuid,
  ADD COLUMN IF NOT EXISTS staff_id       uuid,
  ADD COLUMN IF NOT EXISTS queue_entry_id uuid,
  ADD COLUMN IF NOT EXISTS visit_id       uuid,
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS proposito      text;

-- Toda sesión nueva vence: hasta hoy un token de subida vivía para siempre
-- (10 activos al 3/10/2026, el más viejo del 3/4).
ALTER TABLE public.qr_photo_sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '45 minutes');

-- La misma tabla la usan los comprobantes de transferencia (receipts.ts) y las
-- fotos del corte. Sin un discriminador, un token de comprobante servía en la
-- página de fotos y al revés. NULL = sesión vieja (anterior a esta migración).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'qr_photo_sessions_proposito_check'
       AND conrelid = 'public.qr_photo_sessions'::regclass
  ) THEN
    ALTER TABLE public.qr_photo_sessions
      ADD CONSTRAINT qr_photo_sessions_proposito_check
      CHECK (proposito IS NULL OR proposito IN ('fotos', 'comprobante'));
  END IF;

  -- Una sesión de fotos sin entrada no se puede atar a ningún cobro.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'qr_photo_sessions_fotos_con_entrada_check'
       AND conrelid = 'public.qr_photo_sessions'::regclass
  ) THEN
    ALTER TABLE public.qr_photo_sessions
      ADD CONSTRAINT qr_photo_sessions_fotos_con_entrada_check
      CHECK (proposito IS DISTINCT FROM 'fotos' OR queue_entry_id IS NOT NULL);
  END IF;
END $$;

-- Una sola sesión de fotos ACTIVA por cobro. La segunda apertura (el barbero
-- cierra y reabre el cobro, o toca Cámara y QR casi a la vez) retoma la misma:
-- la tablet y el celular suben al mismo lugar.
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_photo_sessions_fotos_activa
  ON public.qr_photo_sessions (queue_entry_id)
  WHERE is_active AND proposito = 'fotos' AND queue_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qr_photo_sessions_queue_entry
  ON public.qr_photo_sessions (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;

COMMENT ON COLUMN public.qr_photo_sessions.proposito IS
  '''fotos'' (fotos del corte, atada a queue_entry_id) | ''comprobante'' (QR del comprobante de transferencia). NULL = anterior a la mig 219.';
COMMENT ON COLUMN public.qr_photo_sessions.visit_id IS
  'Visita a la que se ataron las fotos (fotos_vincular_entrada). Con valor, la sesión está cerrada; acepta fotos sólo 10 min más.';

-- Las sesiones viejas: vencen a los 45 minutos de creadas (nunca tuvieron
-- vencimiento) y las que ya pasaron se cierran. Incluye las de comprobantes,
-- que tampoco se cerraban nunca. Inocuo: ninguna lleva fotos sin vincular que
-- sirvan (las 2 del 27/8 se recuperan aparte, ver recuperar_fotos_27ago.sql).
UPDATE public.qr_photo_sessions
   SET expires_at = created_at + interval '45 minutes'
 WHERE expires_at IS NULL;

UPDATE public.qr_photo_sessions
   SET is_active = false,
       closed_at = COALESCE(closed_at, now())
 WHERE is_active IS DISTINCT FROM false
   AND expires_at <= now();

-- ----------------------------------------------------------------------------
-- 2) De dónde vino cada foto, y que una ruta no se registre dos veces
-- ----------------------------------------------------------------------------
-- Todas las filas existentes vinieron del celular (QR): de ahí el default.
-- NOT NULL con default constante es sólo metadata en PG ≥ 11 (no reescribe).
ALTER TABLE public.qr_photo_uploads
  ADD COLUMN IF NOT EXISTS origen       text NOT NULL DEFAULT 'celular',
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS bytes        integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'qr_photo_uploads_origen_check'
       AND conrelid = 'public.qr_photo_uploads'::regclass
  ) THEN
    ALTER TABLE public.qr_photo_uploads
      ADD CONSTRAINT qr_photo_uploads_origen_check CHECK (origen IN ('celular', 'tablet'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'qr_photo_uploads_bytes_check'
       AND conrelid = 'public.qr_photo_uploads'::regclass
  ) THEN
    ALTER TABLE public.qr_photo_uploads
      ADD CONSTRAINT qr_photo_uploads_bytes_check CHECK (bytes IS NULL OR bytes > 0);
  END IF;
END $$;

-- Confirmar dos veces la misma subida (se perdió la respuesta y la tablet
-- reintenta) no la duplica. Las rutas llevan un uuid: ya eran únicas de hecho
-- (0 duplicadas en las 26 filas al 3/10/2026).
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_photo_uploads_ruta
  ON public.qr_photo_uploads (storage_path);

-- ----------------------------------------------------------------------------
-- 3) Registrar dos veces las fotos de un cobro no las duplica
-- ----------------------------------------------------------------------------
-- 0 duplicadas en las 7 filas al 3/10/2026.
CREATE UNIQUE INDEX IF NOT EXISTS ux_visit_photos_visit_path
  ON public.visit_photos (visit_id, storage_path);

-- ----------------------------------------------------------------------------
-- 4) Bucket: sólo imágenes y con tope
-- ----------------------------------------------------------------------------
-- Hoy acepta cualquier tipo y tamaño: un SVG o un HTML en un bucket público es
-- contenido activo servido desde el dominio de Supabase. La tablet sube WebP o
-- JPEG de ~300 KB; el tope del cliente es 4 MB y éste es el respaldo. PNG queda
-- por las fotos viejas (Safari no codifica WebP y caía a PNG de 2 MB).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit    = 10485760
 WHERE id = 'visit-photos';

-- ----------------------------------------------------------------------------
-- 5) Las RPC. SECURITY DEFINER y SÓLO service_role: la sesión (cookie del
--    barbero, Supabase Auth del dashboard o el token del celular) la valida el
--    servidor de Next antes de llamarlas, nunca el browser.
--
--    Todas las escrituras de fotos de UN cobro (abrir, registrar, quitar,
--    vincular) toman el mismo advisory lock por entrada: así el orden entre
--    "llega una foto" y "se cobra" queda definido sin lockear filas de
--    queue_entries (la tabla caliente) ni de visits.
-- ----------------------------------------------------------------------------

-- Abre la sesión de fotos de un cobro, o retoma la que ya está activa.
-- Con la entrada ya cobrada (la foto se sacó justo antes de tocar Cobrar) la
-- sesión nace atada a la visita, dentro de los minutos de gracia.
CREATE OR REPLACE FUNCTION public.fotos_abrir_sesion(
  p_organization_id uuid,
  p_queue_entry_id  uuid,
  p_minutos         integer DEFAULT 45,
  p_gracia_minutos  integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry   record;
  v_visit   record;
  v_sesion  public.qr_photo_sessions%ROWTYPE;
  v_creada  boolean := false;
  v_minutos integer := LEAST(GREATEST(COALESCE(p_minutos, 45), 5), 240);
  v_gracia  integer := LEAST(GREATEST(COALESCE(p_gracia_minutos, 10), 0), 60);
BEGIN
  IF p_organization_id IS NULL OR p_queue_entry_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  END IF;

  -- Lectura simple, SIN FOR UPDATE/SHARE: queue_entries es la tabla más
  -- caliente del sistema y claim_next_for_barber la toma con SKIP LOCKED.
  SELECT id, organization_id, branch_id, barber_id, status, COALESCE(is_break, false) AS is_break
    INTO v_entry
    FROM public.queue_entries
   WHERE id = p_queue_entry_id;

  IF NOT FOUND OR v_entry.organization_id <> p_organization_id OR v_entry.is_break THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'entrada_inexistente');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fotos_corte:' || p_queue_entry_id::text, 0));

  -- Una activa vencida no puede bloquear la apertura de otra (índice único).
  UPDATE public.qr_photo_sessions
     SET is_active = false,
         closed_at = COALESCE(closed_at, now())
   WHERE queue_entry_id = p_queue_entry_id
     AND proposito = 'fotos'
     AND is_active
     AND (expires_at IS NULL OR expires_at <= now());

  IF v_entry.status = 'in_progress' THEN
    SELECT * INTO v_sesion
      FROM public.qr_photo_sessions
     WHERE queue_entry_id = p_queue_entry_id
       AND proposito = 'fotos'
       AND is_active
     LIMIT 1;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.qr_photo_sessions
          (token, organization_id, branch_id, staff_id, queue_entry_id, proposito, expires_at)
        VALUES
          (gen_random_uuid()::text, p_organization_id, v_entry.branch_id, v_entry.barber_id,
           p_queue_entry_id, 'fotos', now() + make_interval(mins => v_minutos))
        RETURNING * INTO v_sesion;
        v_creada := true;
      EXCEPTION WHEN unique_violation THEN
        -- Otra apertura que no pasó por este lock (un camino futuro, un script)
        -- ganó la carrera: el índice único (una activa por entrada) la frenó y
        -- se retoma la que quedó, en vez de devolverle un error al barbero.
        SELECT * INTO v_sesion
          FROM public.qr_photo_sessions
         WHERE queue_entry_id = p_queue_entry_id
           AND proposito = 'fotos'
           AND is_active
         LIMIT 1;
        IF NOT FOUND THEN
          RAISE;
        END IF;
      END;
    END IF;

  ELSIF v_entry.status = 'completed' THEN
    SELECT id, completed_at INTO v_visit
      FROM public.visits
     WHERE queue_entry_id = p_queue_entry_id
     ORDER BY completed_at DESC
     LIMIT 1;

    IF NOT FOUND OR v_visit.completed_at < now() - make_interval(mins => v_gracia) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'cobro_cerrado');
    END IF;

    SELECT * INTO v_sesion
      FROM public.qr_photo_sessions
     WHERE queue_entry_id = p_queue_entry_id
       AND proposito = 'fotos'
       AND visit_id = v_visit.id
     ORDER BY closed_at DESC NULLS LAST, created_at DESC
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.qr_photo_sessions
        (token, organization_id, branch_id, staff_id, queue_entry_id, proposito,
         visit_id, is_active, closed_at, expires_at)
      VALUES
        (gen_random_uuid()::text, p_organization_id, v_entry.branch_id, v_entry.barber_id,
         p_queue_entry_id, 'fotos', v_visit.id, false, v_visit.completed_at,
         v_visit.completed_at + make_interval(mins => v_gracia))
      RETURNING * INTO v_sesion;
      v_creada := true;
    END IF;

  ELSE
    -- waiting / cancelled / no_show: no hay corte del que sacar fotos.
    RETURN jsonb_build_object('ok', false, 'motivo', 'cobro_cerrado');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'creada', v_creada,
    'sesion', jsonb_build_object(
      'id',         v_sesion.id,
      'token',      v_sesion.token,
      'is_active',  v_sesion.is_active,
      'expires_at', v_sesion.expires_at,
      'visit_id',   v_sesion.visit_id,
      'closed_at',  v_sesion.closed_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer) IS
  'Fotos del corte (mig 219): abre o retoma la sesión de fotos de un cobro. Sólo service_role.';

-- Ata las sesiones de fotos de una entrada a su visita y copia TODAS sus
-- subidas a visit_photos. El orden importa: primero ATA (desde acá, una foto que
-- llega ve la sesión cerrada y se suma sola a la visita) y después COPIA (con el
-- lock tomado, ve también lo que se registró justo antes). Idempotente: el
-- índice único (visit_id, storage_path) no deja duplicar.
-- Devuelve cuántas fotos quedaron en la visita.
CREATE OR REPLACE FUNCTION public.fotos_vincular_entrada(
  p_queue_entry_id uuid,
  p_visit_id       uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit record;
  v_base  integer;
  v_total integer;
BEGIN
  IF p_queue_entry_id IS NULL OR p_visit_id IS NULL THEN
    RAISE EXCEPTION 'fotos_vincular_entrada: faltan la entrada o la visita'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, organization_id, queue_entry_id INTO v_visit
    FROM public.visits
   WHERE id = p_visit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fotos_vincular_entrada: la visita % no existe', p_visit_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_visit.queue_entry_id IS DISTINCT FROM p_queue_entry_id THEN
    RAISE EXCEPTION 'fotos_vincular_entrada: la visita % no es la de la entrada %', p_visit_id, p_queue_entry_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fotos_corte:' || p_queue_entry_id::text, 0));

  -- 1) Atar. Las sesiones ya atadas no se tocan (closed_at marca el inicio de
  --    los minutos de gracia y no se corre con cada reintento).
  UPDATE public.qr_photo_sessions
     SET visit_id  = p_visit_id,
         closed_at = now(),
         is_active = false
   WHERE queue_entry_id = p_queue_entry_id
     AND proposito = 'fotos'
     AND visit_id IS NULL
     AND organization_id = v_visit.organization_id;

  -- 2) Copiar las que falten, a continuación de las que ya tenga la visita.
  SELECT COALESCE(max(order_index), -1) INTO v_base
    FROM public.visit_photos
   WHERE visit_id = p_visit_id;

  INSERT INTO public.visit_photos (visit_id, storage_path, order_index)
  SELECT p_visit_id,
         u.storage_path,
         v_base + row_number() OVER (ORDER BY u.created_at, u.id)
    FROM public.qr_photo_uploads u
    JOIN public.qr_photo_sessions s ON s.id = u.session_id
   WHERE s.queue_entry_id = p_queue_entry_id
     AND s.proposito = 'fotos'
     AND s.organization_id = v_visit.organization_id
     AND NOT EXISTS (
       SELECT 1 FROM public.visit_photos vp
        WHERE vp.visit_id = p_visit_id
          AND vp.storage_path = u.storage_path
     )
  ON CONFLICT (visit_id, storage_path) DO NOTHING;

  SELECT count(*) INTO v_total
    FROM public.visit_photos
   WHERE visit_id = p_visit_id;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.fotos_vincular_entrada(uuid, uuid) IS
  'Fotos del corte (mig 219): ata las sesiones de fotos de la entrada a la visita y copia sus subidas a visit_photos (idempotente). La llama completeService. Sólo service_role.';

-- Registra una foto ya subida a Storage (la ruta la armó el servidor al firmar
-- la URL; acá se re-verifica igual). Si la sesión ya está atada, o si la
-- entrada ya tiene visita aunque todavía no se haya atado, la foto se suma a la
-- visita en el acto: el chequeo va DESPUÉS de insertar la fila, con el lock
-- tomado, así una foto que llega durante el cobro no queda afuera.
CREATE OR REPLACE FUNCTION public.fotos_registrar_subida(
  p_session_id     uuid,
  p_storage_path   text,
  p_origen         text,
  p_content_type   text,
  p_bytes          integer,
  p_tope           integer DEFAULT 12,
  p_gracia_minutos integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s        public.qr_photo_sessions%ROWTYPE;
  v_prefijo  text;
  v_upload   record;
  v_acepta   boolean;
  v_ya       boolean := false;
  v_cant     integer;
  v_visit_id uuid;
  v_total    integer;
  v_tope     integer := LEAST(GREATEST(COALESCE(p_tope, 12), 1), 50);
  v_gracia   integer := LEAST(GREATEST(COALESCE(p_gracia_minutos, 10), 0), 60);
BEGIN
  IF p_session_id IS NULL OR p_storage_path IS NULL OR p_origen IS NULL
     OR p_origen NOT IN ('tablet', 'celular') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  END IF;

  SELECT * INTO v_s FROM public.qr_photo_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_s.proposito IS DISTINCT FROM 'fotos' OR v_s.queue_entry_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  END IF;

  v_prefijo := v_s.organization_id::text || '/' || v_s.id::text || '/';
  IF left(p_storage_path, length(v_prefijo)) <> v_prefijo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ruta_invalida');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fotos_corte:' || v_s.queue_entry_id::text, 0));

  -- Releída con el lock tomado: vincular pudo haberla atado mientras esperábamos.
  SELECT * INTO v_s FROM public.qr_photo_sessions WHERE id = p_session_id;

  SELECT id, created_at INTO v_upload
    FROM public.qr_photo_uploads
   WHERE storage_path = p_storage_path;

  IF FOUND THEN
    -- La misma confirmación otra vez (se perdió la respuesta): idempotente.
    v_ya := true;
  ELSE
    -- Acepta fotos: abierta y sin vencer, o ya atada hace menos de los minutos
    -- de gracia (la foto que el celular termina de subir después de cobrar).
    -- Con COALESCE en cada término: un NULL acá daría "acepta" por omisión.
    v_acepta :=
         (v_s.visit_id IS NULL
          AND COALESCE(v_s.is_active, false)
          AND COALESCE(v_s.expires_at > now(), false))
      OR (v_s.visit_id IS NOT NULL
          AND COALESCE(v_s.closed_at > now() - make_interval(mins => v_gracia), false));

    IF NOT v_acepta THEN
      RETURN jsonb_build_object(
        'ok', false,
        'motivo', CASE WHEN v_s.visit_id IS NOT NULL THEN 'cobro_cerrado' ELSE 'vencida' END
      );
    END IF;

    -- El tope es por CORTE (todas las sesiones de la entrada), no por sesión.
    SELECT count(*) INTO v_cant
      FROM public.qr_photo_uploads u
      JOIN public.qr_photo_sessions s ON s.id = u.session_id
     WHERE s.queue_entry_id = v_s.queue_entry_id
       AND s.proposito = 'fotos';
    IF v_cant >= v_tope THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'tope', 'tope', v_tope);
    END IF;

    INSERT INTO public.qr_photo_uploads (session_id, storage_path, origen, content_type, bytes)
    VALUES (p_session_id, p_storage_path, p_origen, p_content_type, NULLIF(p_bytes, 0))
    RETURNING id, created_at INTO v_upload;
  END IF;

  -- DESPUÉS de la fila: ¿el cobro ya tiene visita?
  v_visit_id := v_s.visit_id;
  IF v_visit_id IS NULL THEN
    SELECT id INTO v_visit_id
      FROM public.visits
     WHERE queue_entry_id = v_s.queue_entry_id
     ORDER BY completed_at DESC
     LIMIT 1;
  END IF;

  IF v_visit_id IS NOT NULL THEN
    -- Mismo lock (los advisory locks son reentrantes dentro de la sesión).
    v_total := public.fotos_vincular_entrada(v_s.queue_entry_id, v_visit_id);
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'upload_id',    v_upload.id,
    'creada_en',    v_upload.created_at,
    'ya_estaba',    v_ya,
    'visit_id',     v_visit_id,
    'vinculada',    v_visit_id IS NOT NULL,
    'fotos_en_visita', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer) IS
  'Fotos del corte (mig 219): registra una foto subida a una sesión de fotos y, si el cobro ya tiene visita, la suma a la visita. Sólo service_role.';

-- Quita una foto de un cobro que todavía no se cerró. Devuelve la ruta para
-- que el servidor borre el objeto de Storage (la fila se borra primero: si
-- falla el borrado del objeto queda un huérfano, nunca una foto fantasma).
CREATE OR REPLACE FUNCTION public.fotos_quitar_foto(
  p_queue_entry_id uuid,
  p_upload_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF p_queue_entry_id IS NULL OR p_upload_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fotos_corte:' || p_queue_entry_id::text, 0));

  SELECT u.id, u.storage_path, s.visit_id INTO v
    FROM public.qr_photo_uploads u
    JOIN public.qr_photo_sessions s ON s.id = u.session_id
   WHERE u.id = p_upload_id
     AND s.queue_entry_id = p_queue_entry_id
     AND s.proposito = 'fotos';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_existe');
  END IF;
  IF v.visit_id IS NOT NULL THEN
    -- Ya está en la ficha del cliente: se saca desde el historial, no desde acá.
    RETURN jsonb_build_object('ok', false, 'motivo', 'cobro_cerrado');
  END IF;

  DELETE FROM public.qr_photo_uploads WHERE id = p_upload_id;

  RETURN jsonb_build_object('ok', true, 'storage_path', v.storage_path);
END;
$$;

COMMENT ON FUNCTION public.fotos_quitar_foto(uuid, uuid) IS
  'Fotos del corte (mig 219): quita una foto de un cobro todavía abierto y devuelve su ruta. Sólo service_role.';

REVOKE ALL ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_vincular_entrada(uuid, uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_quitar_foto(uuid, uuid)                                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer)               TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_vincular_entrada(uuid, uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_quitar_foto(uuid, uuid)                                  TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Autoverificación: si algo no quedó como se espera, la migración se aborta
--    entera en vez de quedar "aplicada" a medias.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.fotos_abrir_sesion(uuid, uuid, integer, integer)',
    'public.fotos_vincular_entrada(uuid, uuid)',
    'public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer)',
    'public.fotos_quitar_foto(uuid, uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '219: % quedó ejecutable por anon/authenticated', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '219: % no es ejecutable por service_role', f;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_visit_photos_visit_path') THEN
    RAISE EXCEPTION '219: falta ux_visit_photos_visit_path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_qr_photo_sessions_fotos_activa') THEN
    RAISE EXCEPTION '219: falta ux_qr_photo_sessions_fotos_activa';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE is_active AND expires_at <= now()) THEN
    RAISE EXCEPTION '219: quedaron sesiones activas vencidas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE expires_at IS NULL) THEN
    RAISE EXCEPTION '219: quedaron sesiones sin vencimiento';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación después de aplicar (sólo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'qr_photo_sessions' order by ordinal_position;
--   select count(*) filter (where is_active) from qr_photo_sessions;      -- 0 si se aplicó fuera de horario
--   select allowed_mime_types, file_size_limit from storage.buckets where id = 'visit-photos';
--   select proname, proacl from pg_proc where proname like 'fotos\_%';
--   -- KR#15: ninguna FK nueva, así que ningún embed nuevo es ambiguo. Igual:
--   curl -G "$URL/rest/v1/queue_entries" --data-urlencode "select=id,client:clients(id,name),barber:staff(id,full_name)" --data-urlencode "limit=1" -H "apikey: $ANON"
--
-- Rollback (sólo junto con revertir el código):
--   DROP FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer);
--   DROP FUNCTION public.fotos_quitar_foto(uuid, uuid);
--   DROP FUNCTION public.fotos_vincular_entrada(uuid, uuid);
--   DROP FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer);
--   DROP INDEX public.ux_visit_photos_visit_path, public.ux_qr_photo_uploads_ruta,
--              public.ux_qr_photo_sessions_fotos_activa, public.idx_qr_photo_sessions_queue_entry;
--   ALTER TABLE public.qr_photo_uploads DROP COLUMN origen, DROP COLUMN content_type, DROP COLUMN bytes;
--   ALTER TABLE public.qr_photo_sessions DROP CONSTRAINT qr_photo_sessions_fotos_con_entrada_check,
--     DROP CONSTRAINT qr_photo_sessions_proposito_check, DROP COLUMN proposito, DROP COLUMN closed_at,
--     DROP COLUMN expires_at, DROP COLUMN visit_id, DROP COLUMN queue_entry_id, DROP COLUMN staff_id,
--     DROP COLUMN branch_id;
--   UPDATE storage.buckets SET allowed_mime_types = NULL, file_size_limit = NULL WHERE id = 'visit-photos';
-- ============================================================================
