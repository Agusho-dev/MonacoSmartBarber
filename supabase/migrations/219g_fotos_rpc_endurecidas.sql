-- APLICADA en prod el 4/10/2026 (schema_migrations «219g_fotos_rpc_endurecidas»; los cuerpos
-- aplicados son los de este archivo con algunos comentarios internos abreviados).
-- ============================================================================
-- 219g — Fotos del corte: las RPC dejan de confiar en filas que no escribieron
-- ============================================================================
-- APLICAR YA (antes del deploy): HEAD no llama a ninguna de estas funciones;
-- sólo las usa el código nuevo (src/lib/fotos-corte/servidor.ts). Mismas
-- firmas que la 219 (CREATE OR REPLACE, sin cambiar argumentos): ningún
-- call-site cambia. Partido del cuerpo VIVO de prod (pg_get_functiondef,
-- 4/10/2026, idéntico al de 219_fotos_del_corte.sql).
--
-- Qué corrige (revisión adversarial, todo reproducido en una base espejo):
--
--  fotos_abrir_sesion
--   · retomaba "la activa" de la entrada sin mirar la organización ni un
--     vencimiento razonable: una sesión plantada (con la anon key, antes de la
--     219f) se retomaba como propia (fotos-del-corte-01, seg-y-despl-03).
--     Ahora la limpieza de vencidas y las dos retomas filtran por la org, y
--     una activa de OTRA org o con un vencimiento más largo que cualquiera que
--     pueda dar esta función se DESACTIVA (no se retoma): sólo filtrar dejaba
--     la entrada bloqueada por el índice único (una activa por entrada). Ese
--     chequeo usa clock_timestamp(), no now(): con now(), una apertura que
--     empezó antes pero tomó el lock después desactivaba la sesión que la otra
--     acababa de renovar (carrera reproducida en la base espejo).
--   · al retomar no renovaba el vencimiento: el QR podía mostrar un código al
--     que le quedaban segundos (fotos-del-corte-06). Ahora extiende
--     expires_at = greatest(expires_at, now() + p_minutos), con el lock tomado.
--   · una entrada cancelada (la asesoría que se cierra sin cobro) devuelve
--     'cerrada_sin_cobro' en vez de 'cobro_cerrado': la pantalla lo dice así.
--
--  fotos_vincular_entrada
--   · ataba TODA sesión sin visita con closed_at = now(): una sesión que había
--     vencido horas antes volvía a aceptar fotos 10 minutos (fotos-del-corte-07).
--     Ahora la gracia es sólo para la sesión viva al cobrar; la de una vencida
--     arranca en su vencimiento (LEAST(closed_at, expires_at)), no en el cobro.
--   · copiaba a visit_photos cualquier ruta de qr_photo_uploads de las sesiones
--     de la entrada. Ahora sólo las de la forma <org>/<id de SU sesión>/…, que
--     es la única que firma el servidor (fotos_registrar_subida ya lo exigía).
--
--  fotos_quitar_foto
--   · con la sesión ya atada contestaba 'cobro_cerrado' siempre: la foto que el
--     barbero quitó mientras se subía y que el cobro alcanzó a atar quedaba en
--     la ficha del cliente para siempre (fotos-del-corte-02). Ahora, dentro de
--     los minutos de gracia (los mismos que acepta registrar), la quita también
--     de visit_photos con el mismo lock.
--   · devolvía la ruta de la fila sin validarla, y el servidor la borraba de
--     Storage con service_role: una fila plantada con la ruta de una foto vieja
--     hacía borrar el objeto real. Ahora sólo devuelve la ruta si tiene la forma
--     <org>/<id de su sesión>/…; una fila que no la tiene se quita sin tocar
--     Storage. Devuelve además session_id, para que el servidor lo re-verifique.
--
--  fotos_registrar_subida
--   · una foto que llegaba a la sesión de un corte cerrado SIN cobro (solo
--     asesoría, o la entrada cancelada) se registraba igual y quedaba huérfana
--     para siempre (sin visita a la que atarse). Ahora devuelve
--     'cerrada_sin_cobro' y el servidor borra el objeto. Es la misma regla que
--     aplica estadoDeSesion en servidor.ts.
--
-- Grants: sólo service_role (se re-afirman y se autoverifican).
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- fotos_abrir_sesion
-- ----------------------------------------------------------------------------
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
     AND organization_id = p_organization_id
     AND is_active
     AND (expires_at IS NULL OR expires_at <= now());

  -- Una activa que esta función no pudo haber creado: de OTRA organización, o
  -- con un vencimiento más largo que el que da esta misma llamada (el tope es
  -- "ahora" + p_minutos, y cada retoma lo renueva hasta ahí). Se desactiva, no
  -- se retoma: sólo ignorarla dejaba la entrada bloqueada por el índice único.
  -- clock_timestamp() y no now(): now() es el inicio de ESTA transacción, y una
  -- apertura concurrente que empezó antes pero tomó el lock después vería como
  -- "absurdo" el vencimiento que la otra acaba de renovar.
  -- Corolario: si algún día se ACORTA MINUTOS_SESION_FOTOS (servidor.ts), las
  -- sesiones abiertas con el valor anterior se cierran en la próxima apertura y
  -- el celular tiene que volver a escanear. Es una vez y es seguro.
  UPDATE public.qr_photo_sessions
     SET is_active = false,
         closed_at = COALESCE(closed_at, now())
   WHERE queue_entry_id = p_queue_entry_id
     AND proposito = 'fotos'
     AND is_active
     AND (organization_id IS DISTINCT FROM p_organization_id
          OR expires_at > clock_timestamp() + make_interval(mins => v_minutos));

  IF v_entry.status = 'in_progress' THEN
    SELECT * INTO v_sesion
      FROM public.qr_photo_sessions
     WHERE queue_entry_id = p_queue_entry_id
       AND proposito = 'fotos'
       AND organization_id = p_organization_id
       AND is_active
     LIMIT 1;

    IF FOUND THEN
      -- Retomar renueva: el QR que se muestra ahora vale p_minutos desde ahora.
      UPDATE public.qr_photo_sessions
         SET expires_at = GREATEST(expires_at, now() + make_interval(mins => v_minutos))
       WHERE id = v_sesion.id
      RETURNING * INTO v_sesion;
    ELSE
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
        -- se retoma la que quedó —si es de esta org—, en vez de devolverle un
        -- error al barbero.
        SELECT * INTO v_sesion
          FROM public.qr_photo_sessions
         WHERE queue_entry_id = p_queue_entry_id
           AND proposito = 'fotos'
           AND organization_id = p_organization_id
           AND is_active
         LIMIT 1;
        IF NOT FOUND THEN
          RAISE;
        END IF;
        UPDATE public.qr_photo_sessions
           SET expires_at = GREATEST(expires_at, now() + make_interval(mins => v_minutos))
         WHERE id = v_sesion.id
        RETURNING * INTO v_sesion;
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
       AND organization_id = p_organization_id
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

  ELSIF v_entry.status = 'cancelled' THEN
    -- Se cerró sin cobro (solo asesoría, o se canceló): no hay ficha donde
    -- guardar fotos. Distinto de 'cobro_cerrado' para que la pantalla lo diga.
    RETURN jsonb_build_object('ok', false, 'motivo', 'cerrada_sin_cobro');

  ELSE
    -- waiting: todavía no hay corte del que sacar fotos.
    RETURN jsonb_build_object('ok', false, 'motivo', 'cobro_cerrado');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'creada', v_creada,
    'sesion', jsonb_build_object(
      'id',              v_sesion.id,
      'token',           v_sesion.token,
      'organization_id', v_sesion.organization_id,
      'is_active',       v_sesion.is_active,
      'expires_at',      v_sesion.expires_at,
      'visit_id',        v_sesion.visit_id,
      'closed_at',       v_sesion.closed_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer) IS
  'Fotos del corte (mig 219/219g): abre o retoma (y renueva) la sesión de fotos de un cobro; desactiva las activas que no pudo haber creado. Sólo service_role.';

-- ----------------------------------------------------------------------------
-- fotos_vincular_entrada
-- ----------------------------------------------------------------------------
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
  --    los minutos de gracia y no se corre con cada reintento). La gracia es
  --    sólo para la sesión que estaba VIVA al cobrar (la foto que el celular
  --    termina de subir); la de una que ya había vencido arranca en su
  --    vencimiento, no ahora: si no, un token vencido hace horas volvía a
  --    aceptar fotos 10 minutos.
  UPDATE public.qr_photo_sessions
     SET visit_id  = p_visit_id,
         closed_at = CASE
                       WHEN is_active AND expires_at > now() THEN now()
                       ELSE LEAST(closed_at, expires_at)
                     END,
         is_active = false
   WHERE queue_entry_id = p_queue_entry_id
     AND proposito = 'fotos'
     AND visit_id IS NULL
     AND organization_id = v_visit.organization_id;

  -- 2) Copiar las que falten, a continuación de las que ya tenga la visita.
  --    Sólo rutas <org>/<id de su sesión>/…: las que firma el servidor y
  --    valida fotos_registrar_subida. Una fila con otra forma no la escribió
  --    ninguna RPC y no va a la ficha de nadie.
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
     AND starts_with(u.storage_path, s.organization_id::text || '/' || s.id::text || '/')
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
  'Fotos del corte (mig 219/219g): ata las sesiones de fotos de la entrada a la visita (gracia sólo para la viva) y copia sus subidas válidas a visit_photos (idempotente). La llama completeService. Sólo service_role.';

-- ----------------------------------------------------------------------------
-- fotos_registrar_subida
-- ----------------------------------------------------------------------------
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
  v_estado   text;
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
    -- El corte se cerró SIN cobro (solo asesoría, o la entrada se canceló): no
    -- hay visita a la que atarla y quedaría huérfana. Lectura simple de
    -- queue_entries (sin FOR UPDATE/SHARE), como en fotos_abrir_sesion.
    IF v_s.visit_id IS NULL THEN
      SELECT status::text INTO v_estado
        FROM public.queue_entries
       WHERE id = v_s.queue_entry_id;
      IF v_estado = 'cancelled' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'cerrada_sin_cobro');
      END IF;
    END IF;

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
  'Fotos del corte (mig 219/219g): registra una foto subida a una sesión de fotos y, si el cobro ya tiene visita, la suma a la visita; rechaza la de un corte cerrado sin cobro. Sólo service_role.';

-- ----------------------------------------------------------------------------
-- fotos_quitar_foto
-- ----------------------------------------------------------------------------
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
  v          record;
  -- Los mismos minutos de gracia que acepta fotos_registrar_subida:
  -- MINUTOS_GRACIA_TRAS_COBRO en src/lib/types/fotos-corte.ts. La firma no
  -- cambia (CREATE OR REPLACE), así que va como constante.
  v_gracia   constant integer := 10;
  v_valida   boolean;
  v_en_ficha integer := 0;
BEGIN
  IF p_queue_entry_id IS NULL OR p_upload_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fotos_corte:' || p_queue_entry_id::text, 0));

  SELECT u.id, u.storage_path, u.session_id, s.organization_id, s.visit_id, s.closed_at INTO v
    FROM public.qr_photo_uploads u
    JOIN public.qr_photo_sessions s ON s.id = u.session_id
   WHERE u.id = p_upload_id
     AND s.queue_entry_id = p_queue_entry_id
     AND s.proposito = 'fotos';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_existe');
  END IF;

  -- Ya atada a la visita: se puede sacar sólo dentro de la gracia (la foto que
  -- el barbero quitó mientras subía y el cobro alcanzó a atar). Después, ya es
  -- parte de la ficha del cliente.
  IF v.visit_id IS NOT NULL
     AND NOT COALESCE(v.closed_at > now() - make_interval(mins => v_gracia), false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cobro_cerrado');
  END IF;

  -- La ruta sólo vale con la forma que firma el servidor: <org>/<su sesión>/…
  -- Una fila con otra forma no la escribió ninguna RPC: se quita, pero su ruta
  -- NO se devuelve (el servidor borraría con service_role el objeto al que
  -- apunta, que puede ser la foto de otro cliente).
  v_valida := starts_with(v.storage_path, v.organization_id::text || '/' || v.session_id::text || '/');

  DELETE FROM public.qr_photo_uploads WHERE id = p_upload_id;

  IF v.visit_id IS NOT NULL AND v_valida THEN
    DELETE FROM public.visit_photos
     WHERE visit_id = v.visit_id
       AND storage_path = v.storage_path;
    GET DIAGNOSTICS v_en_ficha = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'storage_path',  CASE WHEN v_valida THEN v.storage_path END,
    'session_id',    v.session_id,
    'ruta_invalida', NOT v_valida,
    'de_la_ficha',   v_en_ficha > 0
  );
END;
$$;

COMMENT ON FUNCTION public.fotos_quitar_foto(uuid, uuid) IS
  'Fotos del corte (mig 219/219g): quita una foto de un cobro abierto (o atado hace menos de 10 min, también de visit_photos) y devuelve su ruta sólo si es válida. Sólo service_role.';

-- ----------------------------------------------------------------------------
-- Grants: sólo service_role (CREATE OR REPLACE conserva los de la 219; se
-- re-afirman por si alguien los tocó a mano).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_vincular_entrada(uuid, uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fotos_quitar_foto(uuid, uuid)                                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fotos_abrir_sesion(uuid, uuid, integer, integer)               TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_vincular_entrada(uuid, uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fotos_quitar_foto(uuid, uuid)                                  TO service_role;

-- ----------------------------------------------------------------------------
-- Autoverificación: grants, y las reglas nuevas con filas SONDA que se
-- deshacen solas (sólo qr_photo_sessions y qr_photo_uploads: no se toca
-- queue_entries ni visits, que son tablas calientes).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  f       text;
  v_org   uuid;
  v_otra  uuid := gen_random_uuid();
  v_e     uuid := gen_random_uuid();   -- entrada sonda (no existe en queue_entries)
  v_s     uuid := gen_random_uuid();
  v_ok    uuid := gen_random_uuid();
  v_mala  uuid := gen_random_uuid();
  r       jsonb;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.fotos_abrir_sesion(uuid, uuid, integer, integer)',
    'public.fotos_vincular_entrada(uuid, uuid)',
    'public.fotos_registrar_subida(uuid, text, text, text, integer, integer, integer)',
    'public.fotos_quitar_foto(uuid, uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '219g: % quedó ejecutable por anon/authenticated', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '219g: % no es ejecutable por service_role', f;
    END IF;
  END LOOP;

  SELECT id INTO v_org FROM public.organizations ORDER BY id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '219g: no hay ninguna organización para armar las sondas';
  END IF;

  BEGIN
    INSERT INTO public.qr_photo_sessions (id, token, organization_id, queue_entry_id, proposito, is_active, expires_at)
    VALUES (v_s, 'sonda-219g-' || v_s::text, v_org, v_e, 'fotos', true, now() + interval '5 minutes');
    INSERT INTO public.qr_photo_uploads (id, session_id, storage_path, origen)
    VALUES (v_ok,   v_s, v_org::text || '/' || v_s::text || '/' || gen_random_uuid()::text || '.webp', 'tablet'),
           (v_mala, v_s, 'qr-otra-cosa/' || gen_random_uuid()::text || '.webp', 'tablet');

    -- quitar: la buena devuelve su ruta; la que no tiene la forma, no.
    r := public.fotos_quitar_foto(v_e, v_ok);
    IF NOT (r->>'ok')::boolean OR r->>'storage_path' IS NULL OR (r->>'ruta_invalida')::boolean THEN
      RAISE EXCEPTION '219g: quitar una foto válida dio %', r;
    END IF;
    r := public.fotos_quitar_foto(v_e, v_mala);
    IF NOT (r->>'ok')::boolean OR r->>'storage_path' IS NOT NULL OR NOT (r->>'ruta_invalida')::boolean THEN
      RAISE EXCEPTION '219g: quitar una fila con ruta ajena dio % (no tiene que devolver la ruta)', r;
    END IF;
    IF EXISTS (SELECT 1 FROM public.qr_photo_uploads WHERE id IN (v_ok, v_mala)) THEN
      RAISE EXCEPTION '219g: quitar no borró las filas sonda';
    END IF;

    -- abrir con otra org sobre una entrada que no existe: no toca nada.
    r := public.fotos_abrir_sesion(v_otra, v_e, 45, 10);
    IF r->>'motivo' IS DISTINCT FROM 'entrada_inexistente' THEN
      RAISE EXCEPTION '219g: abrir sobre una entrada inexistente dio %', r;
    END IF;

    -- registrar con una ruta de otra sesión: rechazada antes de tocar nada.
    r := public.fotos_registrar_subida(v_s, v_org::text || '/' || gen_random_uuid()::text || '/x.webp', 'tablet', 'image/webp', 100, 12, 10);
    IF r->>'motivo' IS DISTINCT FROM 'ruta_invalida' THEN
      RAISE EXCEPTION '219g: registrar con ruta ajena dio %', r;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'PF219', MESSAGE = '219g: sondas ok';
  EXCEPTION WHEN SQLSTATE 'PF219' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.qr_photo_sessions WHERE id = v_s) THEN
    RAISE EXCEPTION '219g: quedó la sesión sonda';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificación después de aplicar (sólo lectura):
--   select p.oid::regprocedure, p.proacl, md5(pg_get_functiondef(p.oid))
--     from pg_proc p where p.proname like 'fotos\_%' order by 1;
--   → las 4 con {postgres=X/postgres,service_role=X/postgres}.
--   select pg_get_functiondef('public.fotos_quitar_foto(uuid,uuid)'::regprocedure) ~ 'de_la_ficha';  → true
--   select pg_get_functiondef('public.fotos_abrir_sesion(uuid,uuid,integer,integer)'::regprocedure) ~ 'GREATEST\(expires_at';  → true
--   select pg_get_functiondef('public.fotos_registrar_subida(uuid,text,text,text,integer,integer,integer)'::regprocedure) ~ 'cerrada_sin_cobro';  → true
--   Antes del deploy no hay sesiones de fotos en prod: el primer uso real es la
--   tablet de Test después del deploy (Cámara, Galería, QR, quitar una, cobrar).
--
-- Rollback: volver a los cuerpos de la 219, que están enteros en
-- 219_fotos_del_corte.sql (sección 5: los cuatro CREATE OR REPLACE + los
-- REVOKE/GRANT). Re-aplicar ese archivo ENTERO también sirve: es idempotente y
-- deja los cuatro cuerpos idénticos a los vivos de prod al 4/10/2026
-- (md5(pg_get_functiondef): abrir b2801d36…, quitar a7e0d039…, registrar
-- f25f3f26…, vincular d785088c…), verificado en una base espejo. Sin pérdida de
-- datos: la 219g no cambia ninguna tabla. El código nuevo entiende las dos
-- versiones (la de la 219 no devuelve session_id, organization_id ni
-- 'cerrada_sin_cobro'), así que el rollback no rompe la tablet; sólo vuelven
-- los huecos que esto cierra.
-- ============================================================================
