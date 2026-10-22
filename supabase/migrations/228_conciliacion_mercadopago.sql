-- =============================================================================
-- 228_conciliacion_mercadopago.sql
-- Conciliación de transferencias: lo que entró DE VERDAD en cada cuenta de
-- Mercado Pago contra lo que el sistema dice que se cobró por transferencia.
--
-- POR QUÉ UNA CONEXIÓN POR CUENTA DE MP Y NO POR SUCURSAL
-- -------------------------------------------------------
-- `branch_payment_providers` define dónde cobra la SEÑA cada sucursal y no se
-- toca. Los cobros del mostrador entran a cuentas personales de los barberos
-- (`payment_accounts`), y la misma cuenta puede estar cargada en dos
-- sucursales (barberia.monaco: Caseros y Paraná, dos filas, UNA cuenta). Por
-- eso la conexión es por `mp_user_id` (mp_cuentas) y cada `payment_accounts`
-- apunta a la suya (N:1).
--
-- QUÉ SE GUARDA DE CADA MOVIMIENTO
-- --------------------------------
-- Sólo lo necesario para conciliar: id, tipo, montos, fechas, y del pagador el
-- nombre y los ÚLTIMOS 4 dígitos del documento (Ley 25.326: minimización). Los
-- egresos de la cuenta no se guardan: la página que ve el titular promete que
-- sólo se leen los cobros.
--
-- EL CRUCE NO SE GUARDA
-- ---------------------
-- Es determinístico sobre `transfer_logs` + `mp_movimientos` y se recalcula
-- cada vez (src/lib/conciliacion-mp/motor.ts). Lo único que se persiste es lo
-- que decide una persona (`mp_conciliacion_resoluciones`). Así una edición del
-- historial de visitas (que no deja rastro: transfer_logs no tiene updated_at)
-- se refleja sola, sin snapshots viejos que mientan.
--
-- KNOWN RISK #15: cada tabla nueva tiene UNA sola FK hacia cada tabla vieja,
-- así que ningún embed existente de PostgREST se vuelve ambiguo.
--
-- Todo es service_role: RLS prendida, cero policies, sin grants a anon ni a
-- authenticated. El dashboard llega por server actions con permiso verificado.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cuentas de Mercado Pago conectadas (una por mp_user_id y organización)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_cuentas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mp_user_id             text NOT NULL,
  nickname               text,
  titular                text,                 -- nombre que devuelve /users/me
  email_enmascarado      text,                 -- jo•••@gmail.com, para confirmar la cuenta
  connection_mode        text NOT NULL CHECK (connection_mode IN ('oauth', 'manual')),
  access_token_cifrado   text,
  refresh_token_cifrado  text,
  token_expires_at       timestamptz,
  live_mode              boolean,
  status                 text NOT NULL DEFAULT 'conectada'
                           CHECK (status IN ('conectada', 'error', 'revocada', 'desconectada')),
  last_error             text,
  last_check_at          timestamptz,
  -- Sincronización. `sync_cursor` es el mayor date_last_updated leído (se
  -- vuelve a pedir con solape). `sincronizada_hasta` es hasta dónde la lectura
  -- está COMPLETA: el motor marca "pendiente" lo cobrado después de esa hora y
  -- nunca lo da por faltante. `sincronizada_desde` es hasta dónde se trajo
  -- para atrás: antes de esa fecha no hay fuente y lo cobrado queda "sin
  -- verificar".
  sync_cursor            timestamptz,
  sincronizada_desde     timestamptz,
  sincronizada_hasta     timestamptz,
  sync_lock_until        timestamptz,
  last_sync_at           timestamptz,
  -- Confirmación del dueño: quien autoriza por el link puede entrar con OTRA
  -- cuenta de MP. Hasta que alguien con permiso confirme, la tarjeta lo pide.
  confirmada_at          timestamptz,
  confirmada_por         uuid,
  connected_at           timestamptz NOT NULL DEFAULT now(),
  connected_by           uuid,
  connected_via          text NOT NULL DEFAULT 'dashboard' CHECK (connected_via IN ('dashboard', 'link')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mp_cuentas_org_user UNIQUE (organization_id, mp_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_cuentas_org ON public.mp_cuentas(organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. payment_accounts → mp_cuentas (N:1) y cuentas de banco (sin API)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_accounts
  ADD COLUMN IF NOT EXISTS mp_cuenta_id uuid REFERENCES public.mp_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fuente_conciliacion text NOT NULL DEFAULT 'mercadopago';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_accounts_fuente_conciliacion_check') THEN
    ALTER TABLE public.payment_accounts
      ADD CONSTRAINT payment_accounts_fuente_conciliacion_check
      CHECK (fuente_conciliacion IN ('mercadopago', 'banco'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_accounts_mp_cuenta
  ON public.payment_accounts(mp_cuenta_id) WHERE mp_cuenta_id IS NOT NULL;

COMMENT ON COLUMN public.payment_accounts.mp_cuenta_id IS
  'Cuenta de Mercado Pago conectada para conciliar. La misma cuenta cargada en dos sucursales apunta a la misma fila.';
COMMENT ON COLUMN public.payment_accounts.fuente_conciliacion IS
  'mercadopago | banco. Una cuenta de banco no tiene API: sus cobros quedan "sin verificar" y se controlan con el comprobante.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Links para que el titular autorice desde su celular
-- ─────────────────────────────────────────────────────────────────────────────
-- El token viaja en la URL pública (/conectar-mp/<token>); acá se guarda su
-- SHA-256. Un dump de la base no alcanza para usar un link.
CREATE TABLE IF NOT EXISTS public.mp_conexion_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_account_id  uuid NOT NULL REFERENCES public.payment_accounts(id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  abierto_at          timestamptz,
  used_at             timestamptz,
  revoked_at          timestamptz,
  mp_cuenta_id        uuid REFERENCES public.mp_cuentas(id) ON DELETE SET NULL,
  resultado           text
);

CREATE INDEX IF NOT EXISTS idx_mp_links_cuenta ON public.mp_conexion_links(payment_account_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `state` del OAuth de conciliación (un uso, 10 minutos)
-- ─────────────────────────────────────────────────────────────────────────────
-- Separado de `payment_oauth_states` (señas): el callback de señas exige
-- sesión del dashboard y `senas.manage`; éste lo usa un barbero sin sesión, y
-- lo que lo autoriza es haber llegado por un link vigente.
CREATE TABLE IF NOT EXISTS public.mp_conexion_oauth_states (
  state               text PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_account_id  uuid NOT NULL REFERENCES public.payment_accounts(id) ON DELETE CASCADE,
  link_id             uuid REFERENCES public.mp_conexion_links(id) ON DELETE CASCADE,
  created_by          uuid,
  code_verifier       text,
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Movimientos de Mercado Pago (sólo créditos: plata que ENTRÓ)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_movimientos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mp_cuenta_id          uuid NOT NULL REFERENCES public.mp_cuentas(id) ON DELETE CASCADE,
  mp_id                 text NOT NULL,
  -- Clasificación propia (src/lib/conciliacion-mp/clasificar.ts): transferencia,
  -- qr, link, tarjeta, point, rendimiento, devolucion, otro. Los campos crudos
  -- de MP quedan al lado porque la tipificación de las transferencias al CVU no
  -- está documentada: se clasifica en código y se puede re-clasificar.
  tipo                  text NOT NULL,
  operation_type        text,
  payment_type_id       text,
  payment_method_id     text,
  status                text NOT NULL,
  status_detail         text,
  monto                 numeric(14,2) NOT NULL,
  monto_neto            numeric(14,2),
  moneda                text,
  fecha                 timestamptz NOT NULL,      -- date_approved, o date_created si no hay
  fecha_creacion        timestamptz,
  fecha_actualizacion   timestamptz,
  pagador_nombre        text,
  pagador_doc_ult4      text,
  descripcion           text,
  referencia_externa    text,
  datos                 jsonb,                     -- recorte del payload, sin datos personales
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mp_movimientos_cuenta_id UNIQUE (mp_cuenta_id, mp_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_mov_org_fecha    ON public.mp_movimientos(organization_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mp_mov_cuenta_fecha ON public.mp_movimientos(mp_cuenta_id, fecha DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Lo que decide una persona: vincular a mano o marcar revisado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_conciliacion_resoluciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tipo               text NOT NULL CHECK (tipo IN ('vinculo', 'revisado')),
  movimiento_id      uuid REFERENCES public.mp_movimientos(id) ON DELETE CASCADE,
  transfer_log_id    uuid REFERENCES public.transfer_logs(id) ON DELETE CASCADE,
  -- Para "revisado" de un esperado sin transfer_log (transferencia sin cuenta,
  -- propina suelta): la clave estable del motor ('sc:<visit>' / 'pr:<visit>').
  clave_esperado     text,
  motivo             text CHECK (motivo IS NULL OR motivo IN (
                       'propina', 'pago_personal', 'sena', 'error_carga',
                       'dos_transferencias', 'pago_en_efectivo', 'otro')),
  nota               text,
  created_by         uuid,
  created_by_nombre  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deshecho_at        timestamptz,
  deshecho_por       uuid,
  CONSTRAINT mp_res_forma CHECK (
    (tipo = 'vinculo' AND movimiento_id IS NOT NULL AND transfer_log_id IS NOT NULL)
    OR (tipo = 'revisado' AND (movimiento_id IS NOT NULL OR transfer_log_id IS NOT NULL OR clave_esperado IS NOT NULL))
  )
);

-- Un cobro del sistema queda vinculado a lo sumo a UN movimiento (un
-- movimiento sí puede cubrir varios cobros: cobro conjunto).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_res_vinculo_tl
  ON public.mp_conciliacion_resoluciones(transfer_log_id)
  WHERE tipo = 'vinculo' AND deshecho_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mp_res_org ON public.mp_conciliacion_resoluciones(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_res_mov ON public.mp_conciliacion_resoluciones(movimiento_id) WHERE movimiento_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Corridas de sincronización (diagnóstico y "leído hace N min")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_sync_corridas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mp_cuenta_id    uuid NOT NULL REFERENCES public.mp_cuentas(id) ON DELETE CASCADE,
  origen          text NOT NULL CHECK (origen IN ('manual', 'auto', 'cron', 'tex', 'conexion')),
  desde           timestamptz,
  hasta           timestamptz,
  iniciada_at     timestamptz NOT NULL DEFAULT now(),
  terminada_at    timestamptz,
  estado          text NOT NULL DEFAULT 'corriendo' CHECK (estado IN ('corriendo', 'ok', 'error')),
  paginas         integer NOT NULL DEFAULT 0,
  leidos          integer NOT NULL DEFAULT 0,
  nuevos          integer NOT NULL DEFAULT 0,
  actualizados    integer NOT NULL DEFAULT 0,
  error           text
);

CREATE INDEX IF NOT EXISTS idx_mp_sync_cuenta ON public.mp_sync_corridas(mp_cuenta_id, iniciada_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. updated_at
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_mp_cuentas_touch BEFORE UPDATE ON public.mp_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE TRIGGER trg_mp_movimientos_touch BEFORE UPDATE ON public.mp_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Candado por cuenta: dos corridas a la vez no leen ni escriben lo mismo
-- ─────────────────────────────────────────────────────────────────────────────
-- El UPDATE condicional ES la lectura y la validación: la fila que vuelve
-- prueba que este pedido —y no otro— tomó el candado.
CREATE OR REPLACE FUNCTION public.mp_tomar_candado(p_cuenta uuid, p_segundos integer DEFAULT 240)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tomado AS (
    UPDATE mp_cuentas
       SET sync_lock_until = now() + make_interval(secs => GREATEST(LEAST(p_segundos, 900), 30))
     WHERE id = p_cuenta
       AND (sync_lock_until IS NULL OR sync_lock_until < now())
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM tomado);
$$;

CREATE OR REPLACE FUNCTION public.mp_soltar_candado(p_cuenta uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE mp_cuentas SET sync_lock_until = NULL WHERE id = p_cuenta;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Lado sistema del cruce: cada cobro por transferencia esperado
-- ─────────────────────────────────────────────────────────────────────────────
-- Una sola consulta con toda la evidencia (visita, barbero, cliente, servicio
-- y comprobante). Va por RPC y NO por embeds de PostgREST: visits ↔
-- payment_receipts tiene dos FKs (Known Risk #15). Devuelve SETOF: quien la
-- llama pagina con .range() porque PostgREST corta en 1000 filas sin avisar.
--
-- Tres tipos de esperado:
--   cobro           un transfer_log (monto neto de seña + propina transferida)
--   sin_cuenta      transferencia registrada sin cuenta asignada
--   propina_suelta  propina transferida en un corte cobrado en efectivo/tarjeta
--
-- receipt_hhmm: sólo hora y minuto leídos del comprobante (la FECHA que lee la
-- IA no sirve: 64 % trae el año 2023).
CREATE OR REPLACE FUNCTION public.conciliacion_mp_esperados(
  p_org   uuid,
  p_desde timestamptz,
  p_hasta timestamptz
)
RETURNS TABLE (
  clave                 text,
  tipo                  text,
  transfer_log_id       uuid,
  visit_id              uuid,
  payment_account_id    uuid,
  branch_id             uuid,
  monto                 numeric,
  propina               numeric,
  t_sistema             timestamptz,
  covering_receipt_id   uuid,
  barbero               text,
  cliente               text,
  servicio              text,
  es_manual             boolean,
  receipt_id            uuid,
  receipt_operacion     text,
  receipt_remitente     text,
  receipt_monto         numeric,
  receipt_hhmm          text,
  receipt_estado        text,
  receipt_tiene_imagen  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cobros AS (
    SELECT 'tl:' || tl.id::text            AS clave,
           'cobro'::text                   AS tipo,
           tl.id                           AS transfer_log_id,
           tl.visit_id                     AS visit_id,
           tl.payment_account_id           AS payment_account_id,
           tl.branch_id                    AS branch_id,
           tl.amount                       AS monto,
           COALESCE(tl.tip_amount, 0)      AS propina,
           tl.transferred_at               AS t_sistema
      FROM transfer_logs tl
      JOIN payment_accounts pa ON pa.id = tl.payment_account_id
      JOIN branches b          ON b.id  = pa.branch_id
     WHERE b.organization_id = p_org
       AND tl.transferred_at >= p_desde
       AND tl.transferred_at <  p_hasta
  ),
  sin_cuenta AS (
    SELECT 'sc:' || v.id::text,
           'sin_cuenta'::text,
           NULL::uuid,
           v.id,
           NULL::uuid,
           v.branch_id,
           GREATEST(COALESCE(v.amount, 0) - COALESCE(v.prepaid_amount, 0), 0),
           CASE WHEN v.tip_payment_method = 'transfer' THEN COALESCE(v.tip_amount, 0) ELSE 0 END,
           v.completed_at
      FROM visits v
      JOIN branches b ON b.id = v.branch_id
     WHERE b.organization_id = p_org
       AND v.payment_method::text = 'transfer'
       AND v.payment_account_id IS NULL
       AND v.completed_at >= p_desde
       AND v.completed_at <  p_hasta
  ),
  propinas AS (
    SELECT 'pr:' || v.id::text,
           'propina_suelta'::text,
           NULL::uuid,
           v.id,
           NULL::uuid,
           v.branch_id,
           0::numeric,
           COALESCE(v.tip_amount, 0),
           v.completed_at
      FROM visits v
      JOIN branches b ON b.id = v.branch_id
     WHERE b.organization_id = p_org
       AND v.payment_method::text <> 'transfer'
       AND v.tip_payment_method = 'transfer'
       AND COALESCE(v.tip_amount, 0) > 0
       AND v.completed_at >= p_desde
       AND v.completed_at <  p_hasta
  ),
  todos AS (
    SELECT * FROM cobros
    UNION ALL SELECT * FROM sin_cuenta
    UNION ALL SELECT * FROM propinas
  )
  SELECT t.clave,
         t.tipo,
         t.transfer_log_id,
         t.visit_id,
         t.payment_account_id,
         t.branch_id,
         t.monto,
         t.propina,
         t.t_sistema,
         v.covering_receipt_id,
         s.full_name,
         c.name,
         sv.name,
         (v.queue_entry_id IS NULL),
         r.id,
         r.operation_number,
         r.sender_name,
         r.extracted_amount,
         CASE WHEN r.extracted_datetime IS NULL THEN NULL
              ELSE to_char(r.extracted_datetime AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI') END,
         r.status::text,
         (r.image_path IS NOT NULL)
    FROM todos t
    LEFT JOIN visits   v  ON v.id  = t.visit_id
    LEFT JOIN staff    s  ON s.id  = v.barber_id
    LEFT JOIN clients  c  ON c.id  = v.client_id
    LEFT JOIN services sv ON sv.id = v.service_id
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.operation_number, pr.sender_name, pr.extracted_amount,
             pr.extracted_datetime, pr.status, pr.image_path
        FROM payment_receipts pr
       WHERE pr.organization_id = p_org
         AND (
           pr.visit_id = t.visit_id
           OR (v.covering_receipt_id IS NOT NULL AND pr.id = v.covering_receipt_id)
         )
       ORDER BY (pr.visit_id = t.visit_id) DESC, pr.created_at DESC
       LIMIT 1
    ) r ON true
   ORDER BY t.t_sistema, t.clave;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RLS y grants: sólo service_role
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mp_cuentas                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_conexion_links              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_conexion_oauth_states       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_movimientos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_conciliacion_resoluciones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_sync_corridas               ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mp_cuentas, public.mp_conexion_links, public.mp_conexion_oauth_states,
              public.mp_movimientos, public.mp_conciliacion_resoluciones, public.mp_sync_corridas
  FROM anon, authenticated;
GRANT ALL ON public.mp_cuentas, public.mp_conexion_links, public.mp_conexion_oauth_states,
             public.mp_movimientos, public.mp_conciliacion_resoluciones, public.mp_sync_corridas
  TO service_role;

REVOKE ALL ON FUNCTION public.mp_tomar_candado(uuid, integer)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mp_soltar_candado(uuid)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_mp_esperados(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mp_tomar_candado(uuid, integer)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.mp_soltar_candado(uuid)                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.conciliacion_mp_esperados(uuid, timestamptz, timestamptz) TO service_role;
