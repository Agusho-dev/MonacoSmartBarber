-- =============================================================================
-- 238 — Ficha de asesoría del cliente (7/nov/2026)
-- =============================================================================
--
-- QUÉ ES
-- La asesoría sin costo (migs 217 y 221) avisaba al barbero y lo obligaba a
-- elegir el servicio al cobrar, pero lo que se charlaba no quedaba en ningún
-- lado. Ahora el barbero completa una FICHA mientras asesora (cada cuánto se
-- corta, qué le molesta, qué se deja crecer, productos, forma, particularidades
-- craneales, el corte, la altura y el número del fade, particularidades) y la
-- próxima vez que el cliente se sienta, la ficha está a la vista en su tarjeta.
-- La foto del corte terminado NO vive acá: es la de siempre (visit_photos, por
-- la sesión de fotos de la entrada) y la ficha la encuentra por la entrada.
--
-- DECISIONES QUE NO HAY QUE DESHACER
--
-- 1. UNA ficha por cliente (`client_asesorias`, UNIQUE client_id), que se
--    edita: «si el cliente pide nuevamente asesoría queda para editar la
--    misma» (dueño). Los datos van en `datos` jsonb y el catálogo de preguntas
--    y opciones vive en el código (src/lib/asesoria/ficha.ts), que valida cada
--    clave y cada valor antes de escribir: sumar un corte o un producto no pide
--    migración (como los personajes del juego, mig 232).
--
-- 2. Un renglón por VISITA en que se tocó la ficha (`client_asesoria_sesiones`,
--    UNIQUE asesoria_id + queue_entry_id): cómo estaba al empezar
--    (`datos_antes`) y cómo quedó (`datos`). De ahí salen el «antes: Mid Fade»
--    que ve el barbero al actualizarla, la foto de referencia (la visita de esa
--    entrada) y, para el dueño, quién completó cada ficha. Nunca se pierde lo
--    que había: un cambio por error se recupera de acá.
--
-- 3. SÓLO SERVICE ROLE, como juego_partidas: RLS prendida, SIN policies y
--    REVOKE ALL a anon y authenticated. El panel del barbero se autentica por
--    PIN + cookie (no por Supabase Auth) y todo pasa por
--    src/lib/actions/ficha-asesoria.ts, que valida la cookie firmada, la
--    sucursal y que el cliente esté en la fila. La anon key no lee NADA de acá
--    (la ficha tiene salud del cliente: alopecia, hongos, lunares).
--
-- 4. SIN FK hacia o desde queue_entries (`queue_entry_id` es referencia
--    blanda): una FK le toma FOR KEY SHARE a la fila de la entrada y hace que
--    el SKIP LOCKED de claim_next_for_barber la saltee (operacion-local.md).
--    `creada_por`, `actualizada_por`, `staff_id`, `sucursal_id` y `branch_id`
--    también son blandas: sin embeds ambiguos con staff (Known Risk #15) y sin
--    trabar la baja de un barbero.
--
-- 5. FK a clients con ON DELETE CASCADE: `delete_client_account` borra la
--    ficha del cliente con su cuenta (es dato personal), y las sesiones caen
--    detrás por asesoria_id.
--
-- 6. Una persona con dos fichas de cliente (mismo teléfono, mig 149) tiene UNA
--    ficha de asesoría: `asesoria_ficha_de` y `asesoria_guardar` la buscan con
--    loyalty_same_person_ids, así no nace una segunda si el kiosko lo reconoció
--    por la otra.
--
-- Aditiva e idempotente: no toca ninguna tabla ni función existente.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_asesorias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  datos              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Referencias blandas, SIN FK a propósito (decisión 4).
  creada_por         uuid,
  actualizada_por    uuid,
  sucursal_id        uuid,
  ultima_entrada_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_asesorias_cliente_unico UNIQUE (client_id),
  CONSTRAINT client_asesorias_datos_objeto CHECK (jsonb_typeof(datos) = 'object'),
  CONSTRAINT client_asesorias_datos_tope CHECK (octet_length(datos::text) <= 8000)
);

COMMENT ON TABLE public.client_asesorias IS
  'Ficha de asesoría del cliente (mig 238): una por cliente, se edita. Sólo service_role (src/lib/actions/ficha-asesoria.ts). El catálogo de claves y valores de `datos` vive en src/lib/asesoria/ficha.ts.';
COMMENT ON COLUMN public.client_asesorias.datos IS
  'Respuestas de la ficha. Clave ausente = sin responder; [] en las de varias opciones = «nada / ninguno». Lo valida src/lib/asesoria/ficha.ts (limpiarCambiosFicha).';
COMMENT ON COLUMN public.client_asesorias.ultima_entrada_id IS
  'Entrada de la fila de la última vez que se tocó. Referencia blanda: SIN FK a queue_entries (SKIP LOCKED de claim_next_for_barber).';

CREATE INDEX IF NOT EXISTS client_asesorias_org_fecha_idx
  ON public.client_asesorias (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.client_asesoria_sesiones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asesoria_id      uuid NOT NULL REFERENCES public.client_asesorias(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  client_id        uuid NOT NULL,
  -- Referencias blandas, SIN FK a propósito (decisión 4).
  queue_entry_id   uuid,
  branch_id        uuid,
  staff_id         uuid,
  pidio_asesoria   boolean NOT NULL DEFAULT false,
  datos_antes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  datos            jsonb NOT NULL DEFAULT '{}'::jsonb,
  cambios          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_asesoria_sesiones IS
  'Una fila por visita en que se tocó la ficha de asesoría (mig 238): cómo estaba al empezar (datos_antes) y cómo quedó (datos). Sólo service_role.';

CREATE UNIQUE INDEX IF NOT EXISTS client_asesoria_sesiones_entrada_uidx
  ON public.client_asesoria_sesiones (asesoria_id, queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_asesoria_sesiones_ficha_fecha_idx
  ON public.client_asesoria_sesiones (asesoria_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_asesoria_sesiones_org_fecha_idx
  ON public.client_asesoria_sesiones (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_asesoria_sesiones_entrada_idx
  ON public.client_asesoria_sesiones (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Acceso: sólo service_role
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_asesorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_asesoria_sesiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_asesorias FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_asesoria_sesiones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_asesorias TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_asesoria_sesiones TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La ficha de una persona (con sus fichas de cliente duplicadas)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.asesoria_ficha_de(p_org uuid, p_cliente uuid)
RETURNS SETOF public.client_asesorias
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.*
    FROM public.client_asesorias a
   WHERE a.organization_id = p_org
     AND a.client_id IN (SELECT public.loyalty_same_person_ids(p_cliente))
   ORDER BY (a.client_id = p_cliente) DESC, a.updated_at DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.asesoria_ficha_de(uuid, uuid) IS
  'La ficha de asesoría de un cliente o, si no tiene, la de otra ficha de cliente del mismo teléfono (mig 238). Sólo service_role.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Guardar: aplica un cambio parcial de una vez, sin carreras
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `p_cambios` pisa claves (jsonb ||) y `p_quitar` las borra (jsonb - text[]):
-- el panel manda sólo lo que tocó, así dos guardados seguidos no se pisan
-- enteros. El que llama (la server action) ya validó cada clave y cada valor
-- contra el catálogo, la cookie del barbero, la sucursal y la entrada. Un
-- primer guardado sin nada que guardar no crea la ficha.

CREATE OR REPLACE FUNCTION public.asesoria_guardar(
  p_org      uuid,
  p_cliente  uuid,
  p_entrada  uuid,
  p_sucursal uuid,
  p_staff    uuid,
  p_pidio    boolean,
  p_cambios  jsonb,
  p_quitar   text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ficha        public.client_asesorias%ROWTYPE;
  v_cliente_org  uuid;
  v_antes        jsonb;
  v_despues      jsonb;
  v_quitar       text[] := COALESCE(p_quitar, '{}'::text[]);
BEGIN
  IF p_org IS NULL OR p_cliente IS NULL OR p_cambios IS NULL OR jsonb_typeof(p_cambios) <> 'object' THEN
    RAISE EXCEPTION 'asesoria_datos_invalidos' USING ERRCODE = '22023';
  END IF;

  SELECT organization_id INTO v_cliente_org FROM public.clients WHERE id = p_cliente;
  IF v_cliente_org IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'asesoria_cliente_ajeno' USING ERRCODE = '42501';
  END IF;

  -- Dos tablets (o dos guardados seguidos de la misma) sobre el mismo cliente
  -- van de a uno.
  PERFORM pg_advisory_xact_lock(hashtextextended('client_asesoria:' || p_cliente::text, 0));

  SELECT a.* INTO v_ficha
    FROM public.client_asesorias a
   WHERE a.organization_id = p_org
     AND a.client_id IN (SELECT public.loyalty_same_person_ids(p_cliente))
   ORDER BY (a.client_id = p_cliente) DESC, a.updated_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    v_antes := '{}'::jsonb;
    v_despues := p_cambios - v_quitar;
    IF v_despues = '{}'::jsonb THEN
      RETURN jsonb_build_object('id', NULL, 'client_id', p_cliente, 'datos', '{}'::jsonb,
                                'updated_at', NULL, 'created_at', NULL);
    END IF;
    INSERT INTO public.client_asesorias
      (organization_id, client_id, datos, creada_por, actualizada_por, sucursal_id, ultima_entrada_id)
    VALUES
      (p_org, p_cliente, v_despues, p_staff, p_staff, p_sucursal, p_entrada)
    RETURNING * INTO v_ficha;
  ELSE
    v_antes := v_ficha.datos;
    v_despues := (v_ficha.datos || p_cambios) - v_quitar;
    UPDATE public.client_asesorias
       SET datos             = v_despues,
           actualizada_por   = COALESCE(p_staff, actualizada_por),
           sucursal_id       = COALESCE(p_sucursal, sucursal_id),
           ultima_entrada_id = COALESCE(p_entrada, ultima_entrada_id),
           updated_at        = now()
     WHERE id = v_ficha.id
    RETURNING * INTO v_ficha;
  END IF;

  IF p_entrada IS NOT NULL THEN
    INSERT INTO public.client_asesoria_sesiones AS s
      (asesoria_id, organization_id, client_id, queue_entry_id, branch_id, staff_id,
       pidio_asesoria, datos_antes, datos)
    VALUES
      (v_ficha.id, p_org, p_cliente, p_entrada, p_sucursal, p_staff,
       COALESCE(p_pidio, false), v_antes, v_despues)
    ON CONFLICT (asesoria_id, queue_entry_id) WHERE queue_entry_id IS NOT NULL
    DO UPDATE SET datos          = EXCLUDED.datos,
                  staff_id       = COALESCE(EXCLUDED.staff_id, s.staff_id),
                  branch_id      = COALESCE(EXCLUDED.branch_id, s.branch_id),
                  pidio_asesoria = s.pidio_asesoria OR EXCLUDED.pidio_asesoria,
                  cambios        = s.cambios + 1,
                  updated_at     = now();
  END IF;

  RETURN jsonb_build_object(
    'id',         v_ficha.id,
    'client_id',  v_ficha.client_id,
    'datos',      v_ficha.datos,
    'updated_at', v_ficha.updated_at,
    'created_at', v_ficha.created_at
  );
END;
$$;

COMMENT ON FUNCTION public.asesoria_guardar(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, text[]) IS
  'Aplica un cambio parcial a la ficha de asesoría (|| y - text[]) y deja la foto de la visita en client_asesoria_sesiones (mig 238). Sólo service_role: valida src/lib/actions/ficha-asesoria.ts.';

REVOKE ALL ON FUNCTION public.asesoria_ficha_de(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asesoria_guardar(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesoria_ficha_de(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.asesoria_guardar(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, text[]) TO service_role;
