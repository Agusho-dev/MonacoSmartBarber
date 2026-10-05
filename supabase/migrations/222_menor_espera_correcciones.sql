-- APLICADA en prod el 4/10/2026 EN TRES PARTES, con el mismo contenido que este archivo:
-- schema_migrations «222a_menor_espera_esquema», «222b_menor_espera_funciones» y
-- «222c_menor_espera_trigger_y_verificacion». NO re-correr.
-- =============================================================================
-- 222 — Menor espera por WhatsApp: correcciones de la revisión (4/oct/2026)
-- =============================================================================
--
-- Parte del cuerpo VIVO de prod de la 218: el md5 de pg_get_functiondef de las
-- 13 funciones menor_espera_* (y de claim_next_for_barber) es idéntico al del
-- archivo 218 aplicado en un Postgres 17 local (verificado el 4/10/2026).
--
-- QUÉ RESUELVE (ids de la revisión adversarial)
--
--  menor-espera-02  Meta aprobó fila_menor_espera como MARKETING. Desde ahora se
--                   manda sólo si el dueño lo ACEPTÓ explícitamente
--                   (app_settings.menor_espera_acepta_marketing, nace en false):
--                   el tick y la prueba lo exigen; la card lo explica y lo pide.
--  menor-espera-07  message_templates.status admite paused, disabled, in_appeal y
--                   pending_deletion. Antes el upsert del sync fallaba, la fila
--                   quedaba 'approved' y la card volvía a decir «aprobada» al
--                   recargar. Es aditivo: todos los pickers filtran 'approved'.
--  menor-espera-05  Bajas por TELÉFONO dentro de la org (19 teléfonos de Monaco
--                   tienen dos fichas: la baja de una no frenaba a la otra). Un
--                   pedido de baja se acepta de quien recibió un aviso real en los
--                   últimos 30 días aunque ya no espere (sólo si el texto ES una
--                   baja: lo decide el webhook y lo pasa en p_es_baja). Alta y
--                   baja manual desde la card: menor_espera_baja_manual.
--  menor-espera-08  El tick no le ofrece a quien tiene DETRÁS un descanso
--                   encolado de su barbero. Mientras espera con barber_id = su
--                   barbero frena ese descanso; si acepta pasa al pool, deja de
--                   frenarlo y el barbero se va al descanso antes de atenderlo.
--                   Es la alternativa segura: claim_next_for_barber NO se toca.
--  menor-espera-11  Trigger en queue_entries: cuando cualquier camino le asigna un
--                   barbero concreto y DISTINTO a una entrada que sigue esperando,
--                   se borran menor_espera_barbero_original_id y
--                   dynamic_via_whatsapp_at. Sin eso, si después volvía al pool por
--                   otro camino (kiosko, arrastre a Dinámicos, desactivar al
--                   barbero), reaparecía «Por WhatsApp · esperaba a X» y la «Mi
--                   fila» de X lo volvía a mostrar. La analítica vive en
--                   fila_ofertas_menor_espera, no en estas marcas.
--  menor-espera-12  El tope de 3 pruebas por día cuenta las que salieron o están
--                   por salir; las que fallaron no (con disyuntor abierto y el
--                   token vencido, probar antes de arreglar dejaba la función
--                   pausada hasta el día siguiente). Techo de 10 intentos por día.
--  menor-espera-10 + seguridad-y-despliegue-04
--                   MEDIR ANTES DE EXIGIR la firma de Meta. whatsapp_webhook_firmas
--                   cuenta por org y por día los POST del webhook que validan la
--                   firma con el app_secret guardado, los que no, los que vienen
--                   sin header y los de orgs sin app_secret, más la hora de la
--                   última válida. El webhook sólo mueve a alguien o registra una
--                   baja con firma VÁLIDA (si no, deja una alerta); el tick no
--                   ofrece sin una firma válida en las últimas 24 h, que es la
--                   misma regla con la que la card deja prender.
--  menor-espera-04  Latido de ENTRADA: si salieron 2 avisos y después no entró
--                   NINGÚN mensaje verificado de Meta (ni siquiera el acuse de esos
--                   mismos avisos) y el primero salió hace más de 20 min, las
--                   respuestas no nos están llegando: se pausa con UNA alerta y se
--                   reanuda solo apenas entra uno. Se calcula con el registro de
--                   firmas (una fila por org y día), no escaneando messages.
--
-- DECISIONES QUE NO HAY QUE DESHACER
--
-- 1. La firma se MIDE con tráfico real antes de exigirla. Un app_secret
--    equivocado cortaría TODO el inbound (reseñas, IA, inbox), como en el apagón
--    del 25/ago. Por eso el resto del webhook no cambia: sólo el corte de Menor
--    espera depende de firmaValida, y la card no deja prender hasta ver firmas
--    válidas. Exigirla para todo el webhook es otra decisión, con estos números.
-- 2. La «entrada» que vale es la VERIFICADA. Contar POST sin firma o con firma
--    inválida como latido dejaría que cualquiera que conozca el phone_number_id
--    mantenga «viva» una entrada caída; contarlos como caída le permitiría
--    pausar la función. Ninguna de las dos cosas depende de un tercero así.
-- 3. El margen de 2 minutos del latido de entrada no es decorativo: el acuse
--    'sent' de Meta puede llegar ANTES de que la edge function escriba
--    scheduled_messages.sent_at. Sin margen, un aviso cuyo acuse llegó primero
--    contaría como «sin eco».
-- 4. menor_espera_contexto cambia de firma (p_es_baja). La de 4 argumentos se
--    DROPEA: con DEFAULTs, dos versiones vivas hacen ambigua la llamada por nombre
--    (PGRST203), lo mismo que pasó con loyalty en la 203.
-- 5. El trigger de queue_entries es BEFORE UPDATE OF barber_id con WHEN sobre
--    NEW/OLD: la función sólo corre cuando la entrada tiene marca de WhatsApp,
--    sigue 'waiting' y recibe un barbero concreto distinto. No interfiere con
--    claim_next_for_barber (pasa a 'in_progress': las marcas sobreviven, como
--    exige la 218) ni con menor_espera_responder (escribe barber_id = NULL).
--    Sólo toca NEW: no hay escrituras extra ni otro evento de Realtime.
-- 6. La baja manual y la automática escriben la misma tabla (por ficha); el
--    tick y la respuesta deciden por teléfono. «Volver a habilitar» borra las
--    bajas de TODAS las fichas con ese teléfono.
--
-- CUÁNDO Y CÓMO SE APLICA
-- ANTES del deploy del código de las olas, fuera del horario del local (antes
-- de las 9 o después de las 21). HEAD no llama a ninguna función menor_espera_*
-- (el corte del webhook y la card no están deployados) y ninguna sucursal tiene
-- menor_espera_aviso prendido, así que con HEAD corriendo esto no cambia nada
-- visible. El código nuevo SÍ la necesita: llama a menor_espera_contexto con
-- p_es_baja, a whatsapp_webhook_registrar y lee los campos nuevos del panel.
--
-- Son transacciones cortas con lock_timeout de 3 s, como la 218. La más
-- delicada es la del trigger: CREATE OR REPLACE TRIGGER toma SHARE ROW
-- EXCLUSIVE sobre queue_entries (bloquea escrituras mientras dura, que son
-- milisegundos). Si alguna no consigue el lock, falla sólo ésa: re-correr el
-- archivo entero (es idempotente). Con apply_migration de la MCP, que envuelve
-- todo en UNA transacción, conviene partirlo en los bloques numerados.
-- =============================================================================


-- ── 1. Aceptación explícita de la categoría MARKETING ───────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS menor_espera_acepta_marketing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.menor_espera_acepta_marketing IS
  'Mig 222. El dueño aceptó que el aviso de Menor espera salga como mensaje de MARKETING (Meta recategorizó la plantilla). Sin esto, con la plantilla en marketing no se manda ni se puede prender.';

COMMIT;


-- ── 2. Estados reales de Meta en message_templates ──────────────────────────
-- Superconjunto del CHECK anterior (pending/approved/rejected): todas las filas
-- existentes lo cumplen. La tabla es chica; la validación es instantánea.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.message_templates DROP CONSTRAINT IF EXISTS message_templates_status_check;
ALTER TABLE public.message_templates ADD CONSTRAINT message_templates_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text,
                             'paused'::text, 'disabled'::text, 'in_appeal'::text, 'pending_deletion'::text]));

COMMIT;


-- ── 3. Latido de entrada en el estado por organización ──────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.fila_menor_espera_estado
  ADD COLUMN IF NOT EXISTS sin_entrada_desde     timestamptz,
  ADD COLUMN IF NOT EXISTS sin_entrada_alerta_id uuid;

COMMENT ON COLUMN public.fila_menor_espera_estado.sin_entrada_desde IS
  'Mig 222. Pausado desde (NULL = no): salieron avisos y después no entró ningún mensaje de Meta con firma válida. Se reanuda solo cuando entra uno.';
COMMENT ON COLUMN public.fila_menor_espera_estado.sin_entrada_alerta_id IS
  'Mig 222. La crm_alert de ESTA pausa: una sola, no una por minuto.';

COMMIT;


-- ── 4. Registro de firmas del webhook de WhatsApp ───────────────────────────
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_firmas (
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Día local de Argentina: es como lo lee el dueño.
  dia                 date NOT NULL,
  -- POST que validaron con el app_secret guardado / que no / sin header /
  -- con header pero de una org sin app_secret cargado.
  validas             integer NOT NULL DEFAULT 0,
  invalidas           integer NOT NULL DEFAULT 0,
  sin_firma           integer NOT NULL DEFAULT 0,
  sin_secreto         integer NOT NULL DEFAULT 0,
  -- Mensajes entrantes (no acuses de estado) que trajeron esos POST.
  mensajes            integer NOT NULL DEFAULT 0,
  ultima_valida_at    timestamptz,
  ultima_invalida_at  timestamptz,
  ultima_sin_firma_at timestamptz,
  ultimo_post_at      timestamptz NOT NULL DEFAULT now(),
  ultimo_mensaje_at   timestamptz,
  PRIMARY KEY (organization_id, dia)
);

COMMENT ON TABLE public.whatsapp_webhook_firmas IS
  'Mig 222. Por organización y día: cuántos POST del webhook de WhatsApp validan la firma de Meta (x-hub-signature-256) con el app_secret guardado. Sirve para MEDIR antes de exigirla y como latido de entrada de Menor espera. Sólo service role.';

ALTER TABLE public.whatsapp_webhook_firmas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_webhook_firmas FROM anon, authenticated;
GRANT ALL ON public.whatsapp_webhook_firmas TO service_role;

COMMIT;


-- ── 5. Funciones ────────────────────────────────────────────────────────────
BEGIN;


-- ── 5.1 Registro de una firma (lo llama el webhook, una vez por POST y org) ──
CREATE OR REPLACE FUNCTION public.whatsapp_webhook_registrar(
  p_organization_id  uuid,
  p_firma            text,              -- 'valida' | 'invalida' | 'sin_firma' | 'sin_secreto'
  p_mensajes         integer DEFAULT 0  -- mensajes entrantes del POST (los acuses no cuentan)
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_msjs integer := least(greatest(coalesce(p_mensajes, 0), 0), 1000);
BEGIN
  IF p_organization_id IS NULL OR p_firma IS NULL
     OR p_firma NOT IN ('valida', 'invalida', 'sin_firma', 'sin_secreto') THEN
    RAISE EXCEPTION 'whatsapp_webhook_registrar: firma desconocida (%)', p_firma USING ERRCODE = '22023';
  END IF;

  -- Una fila por org y día: el upsert pisa siempre la misma, así que el costo
  -- por POST es un UPDATE de una fila chica.
  INSERT INTO whatsapp_webhook_firmas AS f
    (organization_id, dia, validas, invalidas, sin_firma, sin_secreto, mensajes,
     ultima_valida_at, ultima_invalida_at, ultima_sin_firma_at, ultimo_post_at, ultimo_mensaje_at)
  VALUES
    (p_organization_id, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
     (p_firma = 'valida')::int, (p_firma = 'invalida')::int,
     (p_firma = 'sin_firma')::int, (p_firma = 'sin_secreto')::int,
     v_msjs,
     CASE WHEN p_firma = 'valida'    THEN now() END,
     CASE WHEN p_firma = 'invalida'  THEN now() END,
     CASE WHEN p_firma = 'sin_firma' THEN now() END,
     now(),
     CASE WHEN v_msjs > 0 THEN now() END)
  ON CONFLICT (organization_id, dia) DO UPDATE SET
    validas             = f.validas + excluded.validas,
    invalidas           = f.invalidas + excluded.invalidas,
    sin_firma           = f.sin_firma + excluded.sin_firma,
    sin_secreto         = f.sin_secreto + excluded.sin_secreto,
    mensajes            = f.mensajes + excluded.mensajes,
    ultima_valida_at    = coalesce(excluded.ultima_valida_at, f.ultima_valida_at),
    ultima_invalida_at  = coalesce(excluded.ultima_invalida_at, f.ultima_invalida_at),
    ultima_sin_firma_at = coalesce(excluded.ultima_sin_firma_at, f.ultima_sin_firma_at),
    ultimo_post_at      = greatest(f.ultimo_post_at, excluded.ultimo_post_at),
    ultimo_mensaje_at   = coalesce(excluded.ultimo_mensaje_at, f.ultimo_mensaje_at);
END;
$$;


-- ── 5.2 Trigger: la marca de WhatsApp no sobrevive a una reasignación ───────
-- La condición vive en el WHEN del trigger (paso 6), que se evalúa sin llamar a
-- la función: en la tabla más caliente, la función sólo corre en el caso raro.
CREATE OR REPLACE FUNCTION public.fn_queue_entry_menor_espera_marca()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Le asignaron un barbero concreto y sigue esperando: ya no es «el que aceptó
  -- por WhatsApp esperando a X». Si después vuelve al pool por otro camino, no
  -- tiene que reaparecer en la «Mi fila» de X ni con el chip de WhatsApp.
  NEW.menor_espera_barbero_original_id := NULL;
  NEW.dynamic_via_whatsapp_at := NULL;
  RETURN NEW;
END;
$$;


-- ── 5.3 Tick: mantenimiento + ofertas nuevas (pg_cron, cada minuto) ──────────
-- Cuerpo vivo de la 218 con cuatro cambios marcados «222»: aceptación de
-- marketing, firma válida en 24 h, latido de entrada, y en los candidatos la
-- baja por teléfono y el descanso encolado detrás.
CREATE OR REPLACE FUNCTION public.menor_espera_ofertas_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org            record;
  v_tpl            record;
  v_c              record;
  v_oferta_id      uuid;
  v_sm_id          uuid;
  v_creadas        integer := 0;
  v_vencidas       integer := 0;
  v_motivo         text;
  v_disyuntor      boolean;
  v_ult_error      text;
  v_alerta_id      uuid;
  v_err            text;
  v_wa_ok          boolean;
  v_tiene_secreto  boolean;
  v_ult_valida     timestamptz;
  v_sin_eco        integer;
  v_sin_eco_desde  timestamptz;
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
           coalesce(a.menor_espera_minutos, 45)::int              AS minutos,
           coalesce(a.shift_end_margin_minutes, 35)::int          AS margen,
           a.wa_api_url,
           coalesce(a.menor_espera_acepta_marketing, false)       AS acepta_marketing
      FROM (SELECT DISTINCT b.organization_id
              FROM branches b
             WHERE b.menor_espera_aviso AND b.is_active) o
      LEFT JOIN LATERAL (
        SELECT s.menor_espera_minutos, s.shift_end_margin_minutes, s.wa_api_url,
               s.menor_espera_acepta_marketing
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
        -- 222: Meta la recategorizó como MARKETING. Sale sólo con la aceptación
        -- explícita del dueño (costo, entregas no garantizadas, bajas de
        -- marketing y calidad del número compartido).
        ELSIF v_tpl.categoria = 'marketing' AND NOT v_org.acepta_marketing THEN
          v_motivo := format('Meta aprobó la plantilla «%s» como MARKETING: no se manda hasta que lo aceptes en Configuración → Menor espera por WhatsApp.', v_tpl.nombre);
        ELSE
          SELECT true, nullif(btrim(w.app_secret), '') IS NOT NULL
            INTO v_wa_ok, v_tiene_secreto
            FROM organization_whatsapp_config w
           WHERE w.organization_id = v_org.organization_id AND w.is_active
             AND w.whatsapp_access_token IS NOT NULL AND w.whatsapp_phone_id IS NOT NULL
           LIMIT 1;
          IF v_wa_ok IS NOT TRUE THEN
            v_motivo := 'WhatsApp no está conectado para esta organización.';
          -- 222: el webhook sólo mueve a alguien con la firma de Meta verificada.
          -- Sin firmas válidas recientes, el «Sí» del cliente sólo dejaría una
          -- alerta: no tiene sentido preguntarle.
          ELSIF v_tiene_secreto IS NOT TRUE THEN
            v_motivo := 'Falta el App Secret de Meta (Mensajería → Configuración): sin él no podemos verificar que las respuestas vengan de WhatsApp.';
          ELSIF NOT EXISTS (
            SELECT 1 FROM whatsapp_webhook_firmas f
             WHERE f.organization_id = v_org.organization_id
               AND f.dia >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 2
               AND f.ultima_valida_at > now() - interval '24 hours') THEN
            v_motivo := 'En las últimas 24 h no entró ningún mensaje de WhatsApp con la firma de Meta verificada: sin eso no podemos confirmar que las respuestas sean del cliente.';
          END IF;
        END IF;
      END IF;

      IF v_motivo IS NOT NULL THEN
        UPDATE fila_menor_espera_estado
           SET ultimo_error = v_motivo, ultimo_error_at = now()
         WHERE organization_id = v_org.organization_id;
        CONTINUE;
      END IF;

      -- 222: las precondiciones se cumplen, el último error deja de ser actual.
      -- (Antes se limpiaba recién al final, junto con el disyuntor: una pausa
      -- por otra causa dejaba a la vista un motivo viejo.)
      UPDATE fila_menor_espera_estado
         SET ultimo_error = NULL, ultimo_error_at = NULL
       WHERE organization_id = v_org.organization_id
         AND ultimo_error IS NOT NULL;

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

      UPDATE fila_menor_espera_estado
         SET disyuntor_desde = NULL, disyuntor_error = NULL, disyuntor_alerta_id = NULL
       WHERE organization_id = v_org.organization_id
         AND disyuntor_desde IS NOT NULL;

      -- 222: latido de ENTRADA. Cada aviso que Meta acepta genera acuses de
      -- estado que entran por el mismo webhook. Si salieron 2 avisos y después
      -- no entró NINGÚN mensaje verificado de Meta, el «Sí» del cliente no nos
      -- llega: se pausa con UNA alerta. Se reanuda solo cuando entra uno.
      SELECT max(f.ultima_valida_at) INTO v_ult_valida
        FROM whatsapp_webhook_firmas f
       WHERE f.organization_id = v_org.organization_id;

      SELECT count(*), min(o.enviada_at)
        INTO v_sin_eco, v_sin_eco_desde
        FROM fila_ofertas_menor_espera o
       WHERE o.organization_id = v_org.organization_id
         AND o.creada_at > now() - interval '25 hours'
         AND o.enviada_at > now() - interval '24 hours'
         -- Decisión 3: 2 min de margen (el acuse puede llegar antes que sent_at).
         AND (v_ult_valida IS NULL OR o.enviada_at > v_ult_valida + interval '2 minutes');

      IF v_sin_eco >= 2 AND v_sin_eco_desde < now() - interval '20 minutes' THEN
        UPDATE fila_menor_espera_estado
           SET sin_entrada_desde = coalesce(sin_entrada_desde, now())
         WHERE organization_id = v_org.organization_id
        RETURNING sin_entrada_alerta_id INTO v_alerta_id;

        IF v_alerta_id IS NULL THEN
          INSERT INTO crm_alerts (organization_id, alert_type, title, message, metadata)
          VALUES (v_org.organization_id, 'urgent',
                  'Pausamos los avisos de Menor espera: no llegan las respuestas',
                  'Salieron avisos de Menor espera por WhatsApp y '
                    || coalesce('desde el ' || to_char(v_ult_valida AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' ', '')
                    || 'no entró ningún mensaje de Meta con la firma verificada: si un cliente toca «Sí», no nos enteramos. '
                    || 'Revisá el webhook de WhatsApp en Meta y el App Secret en Mensajería → Configuración. Los avisos vuelven solos apenas entra un mensaje.',
                  jsonb_build_object('origen', 'menor_espera', 'tipo', 'sin_entrada'))
          RETURNING id INTO v_alerta_id;

          UPDATE fila_menor_espera_estado
             SET sin_entrada_alerta_id = v_alerta_id
           WHERE organization_id = v_org.organization_id;
        END IF;
        CONTINUE;
      END IF;

      UPDATE fila_menor_espera_estado
         SET sin_entrada_desde = NULL, sin_entrada_alerta_id = NULL
       WHERE organization_id = v_org.organization_id
         AND sin_entrada_desde IS NOT NULL;

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
          -- Decisión 4 de la 218. El que claim_next_for_barber atendería YA y el panel no excluye.
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
          -- Decisión 5 de la 218: TODOS los dinámicos que esperan hoy, no sólo los más viejos.
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
             -- 222: pidió la baja ESTA ficha o CUALQUIER ficha de la org con el
             -- mismo teléfono (los duplicados por formato son el mismo humano).
             AND NOT EXISTS (SELECT 1 FROM fila_menor_espera_bajas bj
                               JOIN clients cb ON cb.id = bj.client_id
                              WHERE bj.organization_id = v_org.organization_id
                                AND (bj.client_id = q.client_id
                                     OR public.phone_tail(cb.phone) = public.phone_tail(c.phone)))
             -- 222: tiene DETRÁS un descanso encolado de su barbero. Esperando con
             -- barber_id = su barbero lo frena; en el pool, no: el barbero se iría
             -- al descanso antes de atenderlo y perdería su lugar.
             AND NOT EXISTS (SELECT 1 FROM queue_entries dq
                              WHERE dq.barber_id = q.barber_id
                                AND dq.branch_id = q.branch_id
                                AND dq.is_break IS TRUE
                                AND dq.status = 'waiting'
                                AND dq.priority_order > q.priority_order)
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
           -- Sólo el BODY: la v16 descarta sub_type/index de los botones (decisión 1 de la 218).
           jsonb_build_array(
             jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(
               jsonb_build_object('type', 'text', 'text', v_c.nombre),
               jsonb_build_object('type', 'text', 'text', v_c.minutos::text),
               jsonb_build_object('type', 'text', 'text', v_c.barbero),
               jsonb_build_object('type', 'text', 'text', v_c.sucursal)))),
           public.menor_espera_render(v_tpl.componentes,
             ARRAY[v_c.nombre, v_c.minutos::text, v_c.barbero, v_c.sucursal]),
           -- Decisión 7 de la 218: primero en la cola de envíos.
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


-- ── 5.4 Contexto de un mensaje entrante (lo pide el webhook, uno por mensaje) ─
-- Igual que en la 218, más:
--   baja      (222) la oferta más reciente de los últimos 30 días a ese teléfono
--             que el cliente RECIBIÓ, aunque ya no esté esperando. Sólo se busca
--             con p_es_baja (el webhook ya sabe que el texto es un pedido de
--             baja): el resto de los mensajes no paga la consulta.
--   cliente   en boton y texto, para que una alerta pueda nombrarlo.
-- La firma de 4 argumentos se dropea (decisión 4).
DROP FUNCTION IF EXISTS public.menor_espera_contexto(uuid, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.menor_espera_contexto(
  p_organization_id  uuid,
  p_telefono         text,
  p_conversation_id  uuid,
  p_es_boton         boolean DEFAULT false,
  p_es_baja          boolean DEFAULT false
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
  v_baja      jsonb;
  v_ultimo    text;
BEGIN
  IF p_es_boton THEN
    SELECT public.menor_espera_botones(t.componentes) INTO v_botones
      FROM public.menor_espera_plantilla_de(p_organization_id) t;
  END IF;

  IF length(v_tail) <> 10 THEN
    RETURN jsonb_build_object('botones', to_jsonb(v_botones), 'boton', NULL, 'texto', NULL,
                              'contexto', NULL, 'baja', NULL);
  END IF;

  -- 222: «no me escriban más» después de que lo atendieron (cuando más se
  -- queja) también es una baja, si recibió un aviso real en los últimos 30 días.
  IF p_es_baja THEN
    SELECT jsonb_build_object('id', o.id, 'cliente', public.menor_espera_nombre_cliente(c.name))
      INTO v_baja
      FROM clients c
      JOIN fila_ofertas_menor_espera o ON o.client_id = c.id
      LEFT JOIN scheduled_messages sm ON sm.id = o.scheduled_message_id
     WHERE c.organization_id = p_organization_id
       AND public.phone_tail(c.phone) = v_tail
       AND o.organization_id = p_organization_id
       AND NOT o.es_prueba
       AND o.creada_at > now() - interval '30 days'
       AND (o.enviada_at IS NOT NULL OR sm.status = 'sent')
     ORDER BY o.creada_at DESC
     LIMIT 1;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM fila_ofertas_menor_espera o
        WHERE o.organization_id = p_organization_id
          AND o.creada_at > now() - interval '90 minutes') THEN
    RETURN jsonb_build_object('botones', to_jsonb(v_botones), 'boton', NULL, 'texto', NULL,
                              'contexto', NULL, 'baja', v_baja);
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
    (SELECT jsonb_build_object('id', b.id, 'es_prueba', b.es_prueba, 'estado', b.estado, 'cliente', b.cliente)
       FROM o b ORDER BY coalesce(b.salio_at, b.creada_at) DESC LIMIT 1),
    (SELECT jsonb_build_object('id', t.id, 'es_prueba', t.es_prueba, 'estado', t.estado, 'cliente', t.cliente)
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

  RETURN jsonb_build_object('botones', to_jsonb(v_botones), 'boton', v_boton, 'texto', v_texto,
                            'contexto', v_contexto, 'baja', v_baja);
END;
$$;


-- ── 5.5 Baja: «no me escriban más» ──────────────────────────────────────────
-- Igual que en la 218, salvo:
--  - «ya_estaba» mira el TELÉFONO (una baja de una ficha duplicada cuenta).
--  - La oferta se cierra como «pidio_baja» sólo si seguía abierta. Con la baja
--    aceptada hasta 30 días después de un aviso, reescribir una oferta vieja
--    (vencida, ignorada) cambiaba sus métricas a destiempo.
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
  v_ya       boolean;
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

  SELECT EXISTS (
           SELECT 1 FROM fila_menor_espera_bajas bj
             JOIN clients cb ON cb.id = bj.client_id
            WHERE bj.organization_id = v_o.organization_id
              AND (bj.client_id = v_o.client_id
                   OR public.phone_tail(cb.phone) = public.phone_tail(v_tel)))
    INTO v_ya;

  INSERT INTO fila_menor_espera_bajas (client_id, organization_id, mensaje)
  VALUES (v_o.client_id, v_o.organization_id, left(p_mensaje, 500))
  ON CONFLICT (client_id) DO NOTHING;

  -- Pedir la baja contesta ESTA oferta si seguía abierta, sin mover nada.
  UPDATE fila_ofertas_menor_espera
     SET estado = 'rechazada', resultado = 'pidio_baja',
         respondida_at = coalesce(respondida_at, now()),
         cerrada_at = coalesce(cerrada_at, now())
   WHERE id = v_o.id
     AND estado IN ('en_cola','enviada');

  RETURN jsonb_build_object(
    'resultado', CASE WHEN v_ya THEN 'ya_estaba' ELSE 'baja' END,
    'oferta_id', v_o.id,
    'cliente', v_cliente);
END;
$$;


-- ── 5.6 Alta y baja manual desde la card (settings.manage en la server action) ─
-- Por teléfono (todas las fichas de la org con ese número) o por ficha (desde
-- la lista de bajas). Nunca crea fichas: si el número no es de un cliente, no
-- hay a quién dejar de escribirle.
CREATE OR REPLACE FUNCTION public.menor_espera_baja_manual(
  p_organization_id  uuid,
  p_activa           boolean,          -- true = dar de baja; false = volver a habilitar
  p_telefono         text DEFAULT NULL,
  p_client_id        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tail     text;
  v_nombre   text;
  v_fichas   integer;
  v_n        integer;
BEGIN
  IF p_organization_id IS NULL OR p_activa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalido');
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT public.phone_tail(c.phone), public.menor_espera_nombre_cliente(c.name)
      INTO v_tail, v_nombre
      FROM clients c
     WHERE c.id = p_client_id AND c.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cliente_no_encontrado');
    END IF;
  ELSE
    IF NOT public.is_real_phone(p_telefono) OR length(public.phone_tail(p_telefono)) <> 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'telefono_invalido');
    END IF;
    v_tail := public.phone_tail(p_telefono);
  END IF;

  -- Una ficha sin un teléfono de 10 dígitos sólo se representa a sí misma: con
  -- la cola vacía ('') «mismo teléfono» abarcaría a todas las fichas sin número.
  IF length(coalesce(v_tail, '')) <> 10 THEN
    v_tail := NULL;
  END IF;

  IF p_activa THEN
    -- Todas las fichas de la org con ese número: el tick decide por teléfono,
    -- pero así la lista de la card muestra cada ficha.
    SELECT count(*), (array_agg(public.menor_espera_nombre_cliente(c.name)
                                ORDER BY c.created_at DESC) FILTER (WHERE public.menor_espera_nombre_cliente(c.name) IS NOT NULL))[1]
      INTO v_fichas, v_nombre
      FROM clients c
     WHERE c.organization_id = p_organization_id
       AND (c.id = p_client_id OR public.phone_tail(c.phone) = v_tail);
    IF v_fichas = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cliente_no_encontrado');
    END IF;

    WITH ins AS (
      INSERT INTO fila_menor_espera_bajas (client_id, organization_id, mensaje)
      SELECT c.id, p_organization_id, 'Baja cargada a mano en Configuración'
        FROM clients c
       WHERE c.organization_id = p_organization_id
         AND (c.id = p_client_id OR public.phone_tail(c.phone) = v_tail)
      ON CONFLICT (client_id) DO NOTHING
      RETURNING client_id
    )
    SELECT count(*) INTO v_n FROM ins;

    RETURN jsonb_build_object('ok', true, 'resultado', CASE WHEN v_n > 0 THEN 'baja' ELSE 'ya_estaba' END,
                              'fichas', v_fichas, 'cliente', v_nombre);
  END IF;

  WITH borradas AS (
    DELETE FROM fila_menor_espera_bajas bj
     USING clients c
     WHERE c.id = bj.client_id
       AND bj.organization_id = p_organization_id
       AND (bj.client_id = p_client_id OR public.phone_tail(c.phone) = v_tail)
    RETURNING bj.client_id
  )
  SELECT count(*) INTO v_n FROM borradas;

  RETURN jsonb_build_object('ok', true, 'resultado', CASE WHEN v_n > 0 THEN 'habilitado' ELSE 'no_estaba' END,
                            'fichas', v_n, 'cliente', v_nombre);
END;
$$;


-- ── 5.7 Prueba desde el dashboard ──────────────────────────────────────────
-- Igual que en la 218, más:
--  - con la plantilla en MARKETING sin aceptar, no sale (la prueba es el aviso real);
--  - el tope de 3 cuenta las que salieron o están por salir: las que fallaron
--    no (menor-espera-12). Techo de 10 intentos por día, fallidos incluidos.
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
  v_cuentan   integer;
  v_intentos  integer;
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
  ELSIF v_tpl.categoria = 'marketing'
        AND NOT coalesce((SELECT a.menor_espera_acepta_marketing FROM app_settings a
                           WHERE a.organization_id = p_organization_id
                           ORDER BY a.updated_at DESC NULLS LAST LIMIT 1), false) THEN
    RETURN jsonb_build_object('error', 'plantilla_marketing');
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
  -- Mismo criterio que menor_espera_panel.pruebas_hoy.
  SELECT count(*) FILTER (WHERE o.estado <> 'fallida'
                            AND coalesce(o.resultado, '') NOT IN ('fallo_el_envio', 'no_salio_a_tiempo', 'cancelado')
                            AND coalesce(sm.status, '') NOT IN ('failed', 'cancelled')),
         count(*)
    INTO v_cuentan, v_intentos
    FROM fila_ofertas_menor_espera o
    LEFT JOIN scheduled_messages sm ON sm.id = o.scheduled_message_id
   WHERE o.organization_id = p_organization_id AND o.es_prueba AND o.creada_at >= v_hoy;
  IF v_cuentan >= 3 THEN
    RETURN jsonb_build_object('error', 'limite_diario');
  END IF;
  IF v_intentos >= 10 THEN
    RETURN jsonb_build_object('error', 'limite_intentos');
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


-- ── 5.8 Panel del dashboard ─────────────────────────────────────────────────
-- Igual que en la 218, más: config.acepta_marketing; webhook (firmas por día,
-- para medir antes de exigir); pruebas_hoy con el criterio del tope (las que
-- salieron o están por salir) y pruebas_intentos_hoy (todas).
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
  v_webhook    jsonb;
  v_pruebas    record;
  v_tz         text;
  v_hoy        timestamptz;
  v_hoy_ar     date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  SELECT coalesce(a.menor_espera_minutos, 45)::int                 AS minutos,
         coalesce(a.menor_espera_plantilla, 'fila_menor_espera')   AS plantilla,
         coalesce(a.menor_espera_acepta_marketing, false)          AS acepta_marketing,
         a.wa_api_url IS NOT NULL                                  AS baileys
    INTO v_cfg
    FROM (SELECT 1) uno
    LEFT JOIN LATERAL (
      SELECT s.menor_espera_minutos, s.menor_espera_plantilla, s.menor_espera_acepta_marketing, s.wa_api_url
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

  -- Mismo criterio que el tope de menor_espera_crear_prueba.
  SELECT count(*) FILTER (WHERE o.estado <> 'fallida'
                            AND coalesce(o.resultado, '') NOT IN ('fallo_el_envio', 'no_salio_a_tiempo', 'cancelado')
                            AND coalesce(sm.status, '') NOT IN ('failed', 'cancelled')) AS cuentan,
         count(*) AS intentos
    INTO v_pruebas
    FROM fila_ofertas_menor_espera o
    LEFT JOIN scheduled_messages sm ON sm.id = o.scheduled_message_id
   WHERE o.organization_id = p_organization_id AND o.es_prueba AND o.creada_at >= v_hoy;

  -- 222: firma del webhook en los últimos 7 días (una fila por día).
  SELECT jsonb_build_object(
           'tiene_app_secret', EXISTS (SELECT 1 FROM organization_whatsapp_config w
                                        WHERE w.organization_id = p_organization_id
                                          AND nullif(btrim(w.app_secret), '') IS NOT NULL),
           'ultima_valida_at',    max(f.ultima_valida_at),
           'ultima_invalida_at',  max(f.ultima_invalida_at),
           'ultima_sin_firma_at', max(f.ultima_sin_firma_at),
           'ultimo_post_at',      max(f.ultimo_post_at),
           'ultimo_mensaje_at',   max(f.ultimo_mensaje_at),
           'hoy', jsonb_build_object(
             'validas',     coalesce(sum(f.validas)     FILTER (WHERE f.dia = v_hoy_ar), 0),
             'invalidas',   coalesce(sum(f.invalidas)   FILTER (WHERE f.dia = v_hoy_ar), 0),
             'sin_firma',   coalesce(sum(f.sin_firma)   FILTER (WHERE f.dia = v_hoy_ar), 0),
             'sin_secreto', coalesce(sum(f.sin_secreto) FILTER (WHERE f.dia = v_hoy_ar), 0)),
           'semana', jsonb_build_object(
             'validas',     coalesce(sum(f.validas), 0),
             'invalidas',   coalesce(sum(f.invalidas), 0),
             'sin_firma',   coalesce(sum(f.sin_firma), 0),
             'sin_secreto', coalesce(sum(f.sin_secreto), 0)))
    INTO v_webhook
    FROM whatsapp_webhook_firmas f
   WHERE f.organization_id = p_organization_id
     AND f.dia > v_hoy_ar - 7;

  RETURN jsonb_build_object(
    'ahora', now(),
    'config', jsonb_build_object('minutos', v_cfg.minutos, 'plantilla', v_cfg.plantilla,
                                 'acepta_marketing', coalesce(v_cfg.acepta_marketing, false)),
    'transporte', jsonb_build_object(
      'baileys', coalesce(v_cfg.baileys, false),
      'whatsapp', EXISTS (SELECT 1 FROM organization_whatsapp_config w
                           WHERE w.organization_id = p_organization_id AND w.is_active
                             AND w.whatsapp_access_token IS NOT NULL AND w.whatsapp_phone_id IS NOT NULL)),
    'plantilla', coalesce(v_tpl, jsonb_build_object('existe', false, 'nombre', v_cfg.plantilla)),
    'latido', v_estado,
    'metricas', v_metricas,
    'webhook', v_webhook,
    'bajas', (SELECT count(*) FROM fila_menor_espera_bajas bj WHERE bj.organization_id = p_organization_id),
    'pruebas_hoy', coalesce(v_pruebas.cuentan, 0),
    'pruebas_intentos_hoy', coalesce(v_pruebas.intentos, 0));
END;
$$;


-- ── 5.9 Permisos: sólo service_role (REVOKE FROM PUBLIC no alcanza en Supabase) ─
-- Las que se reemplazaron con CREATE OR REPLACE conservan los permisos de la
-- 218; las nuevas (y la de contexto, que se dropeó) nacen con EXECUTE para anon
-- y authenticated por los default privileges de Supabase.
REVOKE ALL ON FUNCTION public.whatsapp_webhook_registrar(uuid, text, integer)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_queue_entry_menor_espera_marca()                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_ofertas_tick()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_contexto(uuid, text, uuid, boolean, boolean)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_registrar_baja(uuid, uuid, text, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_baja_manual(uuid, boolean, text, uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_crear_prueba(uuid, text)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.menor_espera_panel(uuid, integer, uuid[])                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.whatsapp_webhook_registrar(uuid, text, integer)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_queue_entry_menor_espera_marca()                            TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_ofertas_tick()                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_contexto(uuid, text, uuid, boolean, boolean)       TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_registrar_baja(uuid, uuid, text, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_baja_manual(uuid, boolean, text, uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_crear_prueba(uuid, text)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.menor_espera_panel(uuid, integer, uuid[])                      TO service_role;

COMMIT;


-- ── 6. El trigger (queue_entries es la tabla más caliente: transacción sola) ─
-- CREATE OR REPLACE TRIGGER (PG 14+) es idempotente sin DROP, que tomaría
-- ACCESS EXCLUSIVE. Toma SHARE ROW EXCLUSIVE el tiempo que tarda en crearse.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE TRIGGER trg_queue_entry_menor_espera_marca
  BEFORE UPDATE OF barber_id ON public.queue_entries
  FOR EACH ROW
  WHEN (NEW.barber_id IS NOT NULL
        AND NEW.barber_id IS DISTINCT FROM OLD.barber_id
        AND NEW.status = 'waiting'::queue_status
        AND (OLD.menor_espera_barbero_original_id IS NOT NULL OR OLD.dynamic_via_whatsapp_at IS NOT NULL))
  EXECUTE FUNCTION public.fn_queue_entry_menor_espera_marca();

COMMIT;


-- ── 7. Autoverificación: aborta si algo no quedó ────────────────────────────
DO $$
DECLARE
  v_def text;
  f     regprocedure;
BEGIN
  -- 1. Columnas.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'app_settings'
                    AND column_name = 'menor_espera_acepta_marketing' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '222: falta app_settings.menor_espera_acepta_marketing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fila_menor_espera_estado'
         AND column_name IN ('sin_entrada_desde', 'sin_entrada_alerta_id')) <> 2 THEN
    RAISE EXCEPTION '222: faltan las columnas del latido de entrada';
  END IF;

  -- 2. CHECK de estados de plantilla.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.message_templates'::regclass AND c.conname = 'message_templates_status_check';
  IF v_def IS NULL OR v_def NOT LIKE '%paused%' OR v_def NOT LIKE '%disabled%'
     OR v_def NOT LIKE '%in_appeal%' OR v_def NOT LIKE '%pending_deletion%' OR v_def NOT LIKE '%approved%' THEN
    RAISE EXCEPTION '222: message_templates_status_check no quedó ampliado: %', v_def;
  END IF;

  -- 3. Registro de firmas: RLS, sin policies, cerrado a anon/authenticated.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.whatsapp_webhook_firmas'::regclass) THEN
    RAISE EXCEPTION '222: whatsapp_webhook_firmas sin RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_webhook_firmas') THEN
    RAISE EXCEPTION '222: whatsapp_webhook_firmas no debe tener policies';
  END IF;
  IF has_table_privilege('anon', 'public.whatsapp_webhook_firmas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.whatsapp_webhook_firmas', 'SELECT')
     OR has_table_privilege('anon', 'public.whatsapp_webhook_firmas', 'INSERT') THEN
    RAISE EXCEPTION '222: whatsapp_webhook_firmas abierta a anon/authenticated';
  END IF;

  -- 4. Una sola menor_espera_contexto, la de 5 argumentos.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'menor_espera_contexto') <> 1
     OR to_regprocedure('public.menor_espera_contexto(uuid, text, uuid, boolean, boolean)') IS NULL THEN
    RAISE EXCEPTION '222: menor_espera_contexto quedó con más de una firma o sin la nueva';
  END IF;

  -- 5. El tick trae los cambios.
  v_def := pg_get_functiondef('public.menor_espera_ofertas_tick()'::regprocedure);
  IF v_def NOT LIKE '%whatsapp_webhook_firmas%' OR v_def NOT LIKE '%acepta_marketing%'
     OR v_def NOT LIKE '%dq.is_break IS TRUE%' OR v_def NOT LIKE '%public.phone_tail(cb.phone)%'
     OR v_def NOT LIKE '%sin_entrada_desde%' THEN
    RAISE EXCEPTION '222: menor_espera_ofertas_tick no quedó actualizado';
  END IF;

  -- 6. Permisos: todo lo nuevo, sólo service_role.
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'menor_espera%' OR p.proname IN ('whatsapp_webhook_registrar', 'fn_queue_entry_menor_espera_marca')) LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '222: % ejecutable por anon/authenticated', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '222: service_role sin EXECUTE en %', f;
    END IF;
  END LOOP;

  -- 7. El trigger: BEFORE UPDATE OF barber_id, por fila, con WHEN, habilitado.
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.queue_entries'::regclass
     AND t.tgname = 'trg_queue_entry_menor_espera_marca'
     AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE UPDATE OF barber_id%' OR v_def NOT LIKE '%WHEN%'
     OR v_def NOT LIKE '%fn_queue_entry_menor_espera_marca%' THEN
    RAISE EXCEPTION '222: el trigger de queue_entries no quedó: %', v_def;
  END IF;

  RAISE NOTICE '222 OK: columnas, CHECK, registro de firmas, funciones, permisos y trigger';
END $$;


-- =============================================================================
-- VERIFICACIÓN DESPUÉS DE APLICAR (sólo lectura salvo el tick, que es idempotente)
-- =============================================================================
-- a) La autoverificación de arriba imprime «222 OK».
-- b) SELECT public.menor_espera_ofertas_tick();  → {"creadas": 0, "vencidas": 0}
--    (con todas las sucursales apagadas no hay nada que ofrecer).
-- c) Con la anon key, el select de la fila del panel y de la TV sigue en 200
--    (nada de esto toca permisos de anon; el trigger no necesita EXECUTE):
--      curl -G "$URL/rest/v1/queue_entries" --data-urlencode "select=*,client:clients(id,name)" \
--           --data-urlencode "status=eq.waiting" --data-urlencode "limit=1" -H "apikey: $ANON"
-- d) DESPUÉS DEL DEPLOY, en los primeros minutos con tráfico:
--      SELECT * FROM public.whatsapp_webhook_firmas ORDER BY dia DESC;
--    Tiene que aparecer la fila de Monaco con validas > 0. Si sólo crecen
--    invalidas (o sin_firma), el app_secret guardado no es el de la app de Meta:
--    NO prender Menor espera (la card tampoco lo deja) y NO exigir la firma en el
--    resto del webhook hasta que validas sea el 100% de un día de tráfico.
-- e) La plantilla: después de «Verificar estado en Meta» en la card,
--      SELECT name, status, category FROM message_templates WHERE name = 'fila_menor_espera';
--    → approved / marketing (lo que dice Meta hoy). La card pide la aceptación.
--
-- =============================================================================
-- ROLLBACK (sólo junto con el rollback del código: el código nuevo llama a la
-- firma de 5 argumentos de menor_espera_contexto y a whatsapp_webhook_registrar)
-- =============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_queue_entry_menor_espera_marca ON public.queue_entries;
-- DROP FUNCTION IF EXISTS public.fn_queue_entry_menor_espera_marca();
-- DROP FUNCTION IF EXISTS public.menor_espera_contexto(uuid, text, uuid, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.menor_espera_baja_manual(uuid, boolean, text, uuid);
-- DROP FUNCTION IF EXISTS public.whatsapp_webhook_registrar(uuid, text, integer);
-- COMMIT;
-- Después, re-correr SÓLO el bloque 5 de la 218 (funciones y permisos): recrea
-- menor_espera_contexto de 4 argumentos y devuelve tick, baja, prueba y panel a
-- sus cuerpos de la 218. Recién entonces, si hace falta:
--   DROP TABLE IF EXISTS public.whatsapp_webhook_firmas;
--   ALTER TABLE public.fila_menor_espera_estado DROP COLUMN IF EXISTS sin_entrada_desde,
--                                               DROP COLUMN IF EXISTS sin_entrada_alerta_id;
--   ALTER TABLE public.app_settings DROP COLUMN IF EXISTS menor_espera_acepta_marketing;
-- El CHECK ampliado de message_templates NO hace falta revertirlo (es un
-- superconjunto). Si se quisiera: primero
--   UPDATE public.message_templates SET status = 'pending'
--    WHERE status NOT IN ('pending', 'approved', 'rejected');
-- y después volver a crear el CHECK con los tres estados.
