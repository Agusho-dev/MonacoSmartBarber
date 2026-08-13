-- =============================================================================
-- 173_arca_facturacion.sql
-- Facturación electrónica ARCA (ex-AFIP) — Argentina.
--
-- Cinco tablas y tres funciones. El orden de lectura recomendado es:
--   1. arca_taxpayers      → quién factura (CUIT, condición, certificado)
--   2. arca_sales_points   → desde qué punto de venta factura cada sucursal
--   3. arca_auth_tokens    → cache del Ticket de Acceso de WSAA (dura 12 h)
--   4. arca_billing_policies → EL CUPO: cuánto de lo que se vende se factura
--   5. arca_invoices       → cada comprobante, con su CAE
--
-- Decisiones que NO hay que "corregir" ingenuamente:
--
-- * `text` + CHECK en vez de ENUMs. Los knobs de la política van a cambiar
--   (estrategias de selección nuevas, períodos nuevos) y `ALTER TYPE` es una
--   piedra en el zapato. Los ENUMs del repo (payment_method, operation_mode)
--   son dominios cerrados de verdad; estos no lo son.
--
-- * El consumo del cupo se DERIVA de arca_invoices (función arca_quota_state).
--   No hay contador denormalizado. Es exactamente la trampa de la mig 160:
--   `increment_account_accumulated` nunca escribió un peso y la rotación de
--   cuentas no existió durante meses sin que nadie se enterara (Known Risk #13).
--
-- * La numeración se reserva con `pg_advisory_xact_lock` DENTRO de la misma
--   transacción que inserta la fila. Pedir el número y después insertar desde
--   la app deja una ventana en la que dos instancias serverless reservan el
--   mismo número y ARCA rechaza la segunda con 10016.
--
-- * La clave privada se guarda CIFRADA por la app (AES-256-GCM). La DB nunca ve
--   el texto plano, así que un dump de la base no alcanza para facturar en
--   nombre del contribuyente.
--   NOTA: la clave de cifrado se mudó a Supabase Vault en la migración 179
--   (secreto `arca_encryption_key`); ya no es una variable de entorno.
--
-- * RLS activo y SIN políticas en las 5 tablas: sólo service_role entra.
--   `anon` y `authenticated` no tienen nada que hacer acá — hay una clave
--   privada fiscal adentro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Helper de updated_at (propio, para no depender de otra migración)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. arca_taxpayers — el contribuyente y sus credenciales
--
-- Una fila por (organización, ambiente, CUIT). El ambiente separado permite
-- tener homologación y producción conviviendo, que es justo lo que necesita
-- el wizard: probás en homologación y recién después salís a producción sin
-- pisar nada.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_taxpayers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  environment         text NOT NULL DEFAULT 'homologacion'
                        CHECK (environment IN ('homologacion', 'produccion')),

  -- Identidad fiscal
  cuit                text NOT NULL CHECK (cuit ~ '^[0-9]{11}$'),
  razon_social        text,
  nombre_fantasia     text,
  condicion_iva       text NOT NULL DEFAULT 'monotributo'
                        CHECK (condicion_iva IN ('monotributo', 'responsable_inscripto', 'exento')),
  domicilio_comercial text,
  inicio_actividades  date,
  ingresos_brutos     text,

  -- Credenciales. `private_key_enc` es AES-256-GCM en base64 (formato de
  -- src/lib/arca/crypto.ts). El certificado es público por definición, se
  -- guarda en claro para poder leerle el vencimiento sin desencriptar nada.
  private_key_enc     text,
  csr_pem             text,
  certificate_pem     text,
  cert_alias          text,
  cert_subject        text,
  cert_serial         text,
  cert_not_before     timestamptz,
  cert_not_after      timestamptz,

  -- Estado del onboarding. Es lo que dibuja el checklist del wizard.
  status              text NOT NULL DEFAULT 'borrador'
                        CHECK (status IN ('borrador', 'csr_generado', 'certificado_cargado', 'verificado', 'activo', 'error')),
  last_check_at       timestamptz,
  last_check_ok       boolean,
  last_check_error    text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, environment, cuit)
);

CREATE INDEX IF NOT EXISTS idx_arca_taxpayers_org
  ON arca_taxpayers (organization_id, environment);

DROP TRIGGER IF EXISTS trg_arca_taxpayers_updated ON arca_taxpayers;
CREATE TRIGGER trg_arca_taxpayers_updated
  BEFORE UPDATE ON arca_taxpayers
  FOR EACH ROW EXECUTE FUNCTION arca_touch_updated_at();

COMMENT ON TABLE  arca_taxpayers IS 'Contribuyente ARCA por organización y ambiente. Contiene la clave privada CIFRADA por la app.';
COMMENT ON COLUMN arca_taxpayers.private_key_enc IS 'Clave privada RSA en AES-256-GCM (base64). NUNCA en texto plano. Clave maestra en Vault (mig 179). Ver src/lib/arca/crypto.ts';

-- -----------------------------------------------------------------------------
-- 2. arca_sales_points — punto de venta por sucursal
--
-- Un PV de ARCA habilitado para Web Services. `branch_id` NULL = punto de
-- venta comodín de la organización (sirve cuando una sola boca factura todo).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_sales_points (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id     uuid NOT NULL REFERENCES arca_taxpayers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id) ON DELETE CASCADE,

  numero          integer NOT NULL CHECK (numero > 0 AND numero <= 99999),
  descripcion     text,
  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (taxpayer_id, numero)
);

-- Una sucursal factura por un único punto de venta activo. Dos PV activos para
-- la misma sucursal es una numeración partida en dos y nadie se da cuenta hasta
-- que el contador pide el libro IVA.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_sales_points_one_per_branch
  ON arca_sales_points (taxpayer_id, branch_id)
  WHERE branch_id IS NOT NULL AND is_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_sales_points_one_default
  ON arca_sales_points (taxpayer_id)
  WHERE branch_id IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_arca_sales_points_updated ON arca_sales_points;
CREATE TRIGGER trg_arca_sales_points_updated
  BEFORE UPDATE ON arca_sales_points
  FOR EACH ROW EXECUTE FUNCTION arca_touch_updated_at();

COMMENT ON TABLE arca_sales_points IS 'Puntos de venta ARCA habilitados para Web Services. branch_id NULL = comodín de la org.';

-- -----------------------------------------------------------------------------
-- 3. arca_auth_tokens — cache del Ticket de Acceso (WSAA)
--
-- WSAA rechaza un segundo login mientras hay un TA vigente ("El CEE ya posee
-- un TA valido para el acceso al WSN solicitado"). O sea que cachear no es una
-- optimización: sin cache, la segunda factura del día falla.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_auth_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id     uuid NOT NULL REFERENCES arca_taxpayers(id) ON DELETE CASCADE,
  service         text NOT NULL DEFAULT 'wsfe',

  token           text NOT NULL,
  sign            text NOT NULL,
  generation_time timestamptz NOT NULL,
  expiration_time timestamptz NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (taxpayer_id, service)
);

CREATE INDEX IF NOT EXISTS idx_arca_auth_tokens_exp
  ON arca_auth_tokens (taxpayer_id, service, expiration_time DESC);

COMMENT ON TABLE arca_auth_tokens IS 'Cache del TA de WSAA (12 h). Sin cache, WSAA rechaza el segundo login del período.';

-- -----------------------------------------------------------------------------
-- 4. arca_billing_policies — EL CUPO
--
-- Responde "de todo lo que vendemos, ¿qué se factura?".
--   mode = 'manual'   → nada automático; el dueño elige a mano.
--   mode = 'cantidad' → N comprobantes por día / semana / mes.
--   mode = 'monto'    → hasta $X por día / semana / mes.
--
-- `selection` decide QUÉ ventas se eligen para llenar ese cupo.
-- `allow_overflow` decide qué pasa con el ticket que cruza el tope de monto:
--   false = se corta antes (nunca te pasás), true = entra y te pasás por ese.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_billing_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id         uuid REFERENCES branches(id) ON DELETE CASCADE,

  is_enabled        boolean NOT NULL DEFAULT false,

  mode              text NOT NULL DEFAULT 'manual'
                      CHECK (mode IN ('manual', 'cantidad', 'monto')),
  period            text NOT NULL DEFAULT 'mes'
                      CHECK (period IN ('dia', 'semana', 'mes')),
  target_count      integer CHECK (target_count IS NULL OR target_count >= 0),
  target_amount     numeric(14,2) CHECK (target_amount IS NULL OR target_amount >= 0),

  selection         text NOT NULL DEFAULT 'cronologico'
                      CHECK (selection IN ('cronologico', 'mas_baratos', 'mas_caros', 'distribuido', 'aleatorio')),

  -- Filtros de elegibilidad de la venta
  payment_methods   text[] NOT NULL DEFAULT ARRAY['cash','card','transfer']::text[],
  min_ticket        numeric(14,2),
  max_ticket        numeric(14,2),
  include_tips      boolean NOT NULL DEFAULT false,
  allow_overflow    boolean NOT NULL DEFAULT false,
  lookback_days     integer NOT NULL DEFAULT 7 CHECK (lookback_days BETWEEN 1 AND 60),

  -- Emisión automática
  auto_emit         boolean NOT NULL DEFAULT false,
  auto_emit_hour    smallint NOT NULL DEFAULT 22 CHECK (auto_emit_hour BETWEEN 0 AND 23),
  last_auto_run_at  timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Coherencia: si el modo pide un objetivo, el objetivo tiene que estar.
  CONSTRAINT arca_policy_target_coherente CHECK (
    (mode = 'manual')
    OR (mode = 'cantidad' AND target_count IS NOT NULL)
    OR (mode = 'monto'    AND target_amount IS NOT NULL)
  ),
  CONSTRAINT arca_policy_ticket_range CHECK (
    min_ticket IS NULL OR max_ticket IS NULL OR max_ticket >= min_ticket
  )
);

-- Una política por sucursal, y una sola política "de toda la organización".
-- Dos índices parciales en vez de NULLS NOT DISTINCT: se lee mejor y funciona
-- igual en cualquier versión.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_policy_per_branch
  ON arca_billing_policies (organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_policy_org_wide
  ON arca_billing_policies (organization_id)
  WHERE branch_id IS NULL;

DROP TRIGGER IF EXISTS trg_arca_policies_updated ON arca_billing_policies;
CREATE TRIGGER trg_arca_policies_updated
  BEFORE UPDATE ON arca_billing_policies
  FOR EACH ROW EXECUTE FUNCTION arca_touch_updated_at();

COMMENT ON TABLE arca_billing_policies IS 'Cupo de facturación: cuánto de lo vendido se factura, por período, y con qué criterio se eligen las ventas.';

-- -----------------------------------------------------------------------------
-- 5. arca_invoices — los comprobantes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  taxpayer_id              uuid NOT NULL REFERENCES arca_taxpayers(id) ON DELETE CASCADE,
  sales_point_id           uuid REFERENCES arca_sales_points(id) ON DELETE SET NULL,

  -- Origen. Hoy una visita; mañana puede ser una venta de producto o una
  -- factura suelta, por eso es nullable y no una FK obligatoria.
  visit_id                 uuid REFERENCES visits(id) ON DELETE SET NULL,
  client_id                uuid REFERENCES clients(id) ON DELETE SET NULL,
  policy_id                uuid REFERENCES arca_billing_policies(id) ON DELETE SET NULL,

  -- Cabecera del comprobante (nombres de ARCA para que el mapeo sea obvio)
  cbte_tipo                integer NOT NULL,
  pto_vta                  integer NOT NULL,
  cbte_nro                 bigint  NOT NULL,
  concepto                 integer NOT NULL DEFAULT 2 CHECK (concepto IN (1,2,3)),
  doc_tipo                 integer NOT NULL DEFAULT 99,
  doc_nro                  bigint  NOT NULL DEFAULT 0,
  -- RG 5616/2024: obligatorio desde el 1/9/2026 (rechazo 10246). Se manda
  -- siempre desde el día uno. 5 = Consumidor Final.
  condicion_iva_receptor_id integer NOT NULL DEFAULT 5,
  receptor_nombre          text,
  receptor_domicilio       text,

  fecha_cbte               date NOT NULL,
  fch_serv_desde           date,
  fch_serv_hasta           date,
  fch_vto_pago             date,

  -- Importes
  imp_total                numeric(14,2) NOT NULL,
  imp_tot_conc             numeric(14,2) NOT NULL DEFAULT 0,
  imp_neto                 numeric(14,2) NOT NULL,
  imp_op_ex                numeric(14,2) NOT NULL DEFAULT 0,
  imp_iva                  numeric(14,2) NOT NULL DEFAULT 0,
  imp_trib                 numeric(14,2) NOT NULL DEFAULT 0,
  iva_items                jsonb,
  moneda_id                text NOT NULL DEFAULT 'PES',
  moneda_ctz               numeric(14,6) NOT NULL DEFAULT 1,

  -- Nota de crédito / débito
  parent_invoice_id        uuid REFERENCES arca_invoices(id) ON DELETE SET NULL,
  cbtes_asoc               jsonb,

  -- Resultado de ARCA
  status                   text NOT NULL DEFAULT 'pendiente'
                             CHECK (status IN ('pendiente','reservado','emitida','rechazada','en_duda','anulada')),
  cae                      text,
  cae_vto                  date,
  resultado                text CHECK (resultado IS NULL OR resultado IN ('A','P','R')),
  observaciones            jsonb,
  errores                  jsonb,
  request_payload          jsonb,
  response_payload         jsonb,

  -- Trazabilidad
  emitted_at               timestamptz,
  emitted_by_staff_id      uuid REFERENCES staff(id) ON DELETE SET NULL,
  emitted_via              text NOT NULL DEFAULT 'manual'
                             CHECK (emitted_via IN ('manual','automatico','prueba','nota_credito')),
  attempt_count            integer NOT NULL DEFAULT 0,
  last_error               text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- La numeración es única mientras el número está TOMADO. 'rechazada' y
-- 'anulada' quedan fuera a propósito: un comprobante que ARCA nunca autorizó
-- no consumió el número, y dejarlo reservado abriría un hueco en la
-- numeración correlativa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_invoices_numeracion
  ON arca_invoices (taxpayer_id, cbte_tipo, pto_vta, cbte_nro)
  WHERE status IN ('pendiente','reservado','emitida','en_duda');

-- Una visita no se factura dos veces. Es la red de seguridad del motor de
-- cupo: aunque dos corridas del cron se pisen, la segunda choca acá.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_invoices_una_por_visita
  ON arca_invoices (visit_id)
  WHERE visit_id IS NOT NULL AND status IN ('pendiente','reservado','emitida','en_duda');

CREATE INDEX IF NOT EXISTS idx_arca_invoices_org_fecha
  ON arca_invoices (organization_id, fecha_cbte DESC);

CREATE INDEX IF NOT EXISTS idx_arca_invoices_branch_fecha
  ON arca_invoices (branch_id, fecha_cbte DESC);

CREATE INDEX IF NOT EXISTS idx_arca_invoices_status
  ON arca_invoices (organization_id, status)
  WHERE status IN ('reservado','en_duda','pendiente');

CREATE INDEX IF NOT EXISTS idx_arca_invoices_cupo
  ON arca_invoices (organization_id, branch_id, fecha_cbte)
  WHERE status IN ('reservado','emitida','en_duda');

DROP TRIGGER IF EXISTS trg_arca_invoices_updated ON arca_invoices;
CREATE TRIGGER trg_arca_invoices_updated
  BEFORE UPDATE ON arca_invoices
  FOR EACH ROW EXECUTE FUNCTION arca_touch_updated_at();

COMMENT ON TABLE arca_invoices IS 'Comprobantes electrónicos emitidos ante ARCA, con su CAE y el payload de ida y vuelta.';

-- -----------------------------------------------------------------------------
-- 6. arca_reserve_invoice — reserva atómica del número de comprobante
--
-- Toma el lock, calcula el próximo número contra ARCA Y contra lo local, e
-- inserta la fila 'reservado', todo en la misma transacción. La app recién
-- después llama a FECAESolicitar.
--
-- p_arca_last: lo que devolvió FECompUltimoAutorizado. Se toma el mayor entre
-- ese y el máximo local porque los dos pueden estar adelantados: ARCA si
-- alguien facturó desde otro sistema, lo local si hay una reserva en vuelo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_reserve_invoice(
  p_taxpayer_id              uuid,
  p_organization_id          uuid,
  p_branch_id                uuid,
  p_sales_point_id           uuid,
  p_pto_vta                  integer,
  p_cbte_tipo                integer,
  p_arca_last                bigint,
  p_concepto                 integer,
  p_doc_tipo                 integer,
  p_doc_nro                  bigint,
  p_condicion_iva_receptor_id integer,
  p_fecha_cbte               date,
  p_imp_total                numeric,
  p_imp_neto                 numeric,
  p_imp_iva                  numeric,
  p_iva_items                jsonb,
  p_visit_id                 uuid DEFAULT NULL,
  p_client_id                uuid DEFAULT NULL,
  p_policy_id                uuid DEFAULT NULL,
  p_emitted_via              text DEFAULT 'manual',
  p_emitted_by_staff_id      uuid DEFAULT NULL,
  p_fch_serv_desde           date DEFAULT NULL,
  p_fch_serv_hasta           date DEFAULT NULL,
  p_fch_vto_pago             date DEFAULT NULL,
  p_receptor_nombre          text DEFAULT NULL,
  p_parent_invoice_id        uuid DEFAULT NULL,
  p_cbtes_asoc               jsonb DEFAULT NULL
)
-- El OUT se llama `numero` y no `cbte_nro` a propósito: un parámetro de salida
-- homónimo de una columna de la tabla que se está insertando es una ambigüedad
-- de PL/pgSQL esperando su momento.
RETURNS TABLE (invoice_id uuid, numero bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_max bigint;
  v_next      bigint;
  v_id        uuid;
BEGIN
  -- Serializa por (contribuyente, punto de venta, tipo). Se libera solo al
  -- terminar la transacción.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_taxpayer_id::text || ':' || p_pto_vta::text || ':' || p_cbte_tipo::text, 0)
  );

  SELECT COALESCE(MAX(i.cbte_nro), 0) INTO v_local_max
  FROM arca_invoices i
  WHERE i.taxpayer_id = p_taxpayer_id
    AND i.cbte_tipo   = p_cbte_tipo
    AND i.pto_vta     = p_pto_vta
    AND i.status IN ('pendiente','reservado','emitida','en_duda');

  v_next := GREATEST(v_local_max, COALESCE(p_arca_last, 0)) + 1;

  INSERT INTO arca_invoices (
    organization_id, branch_id, taxpayer_id, sales_point_id,
    visit_id, client_id, policy_id,
    cbte_tipo, pto_vta, cbte_nro, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre,
    fecha_cbte, fch_serv_desde, fch_serv_hasta, fch_vto_pago,
    imp_total, imp_neto, imp_iva, iva_items,
    parent_invoice_id, cbtes_asoc,
    status, emitted_via, emitted_by_staff_id
  ) VALUES (
    p_organization_id, p_branch_id, p_taxpayer_id, p_sales_point_id,
    p_visit_id, p_client_id, p_policy_id,
    p_cbte_tipo, p_pto_vta, v_next, p_concepto,
    p_doc_tipo, p_doc_nro, p_condicion_iva_receptor_id, p_receptor_nombre,
    p_fecha_cbte, p_fch_serv_desde, p_fch_serv_hasta, p_fch_vto_pago,
    p_imp_total, p_imp_neto, p_imp_iva, p_iva_items,
    p_parent_invoice_id, p_cbtes_asoc,
    'reservado', p_emitted_via, p_emitted_by_staff_id
  )
  RETURNING id INTO v_id;

  invoice_id := v_id;
  numero     := v_next;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION arca_reserve_invoice IS 'Reserva atómica del próximo número de comprobante + inserta la fila en estado reservado. Advisory lock por (contribuyente, PV, tipo).';

-- -----------------------------------------------------------------------------
-- 7. arca_quota_state — cuánto del cupo se consumió en el período vigente
--
-- Devuelve SIEMPRE datos derivados de arca_invoices. Si el resultado parece
-- mal, el problema está en los comprobantes, no en un contador desincronizado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_quota_state(
  p_policy_id uuid,
  p_at        timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start     date,
  period_end       date,
  emitted_count    integer,
  emitted_amount   numeric,
  target_count     integer,
  target_amount    numeric,
  remaining_count  integer,
  remaining_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol   arca_billing_policies%ROWTYPE;
  v_tz    text;
  v_local date;
  v_start date;
  v_end   date;
BEGIN
  SELECT * INTO v_pol FROM arca_billing_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- La zona horaria sale de la sucursal; si la política es de toda la org,
  -- de la organización. Nunca del proceso: en Vercel es UTC y después de las
  -- 21:00 de Argentina "hoy" ya sería mañana.
  SELECT COALESCE(b.timezone, o.timezone, 'America/Argentina/Buenos_Aires')
    INTO v_tz
  FROM organizations o
  LEFT JOIN branches b ON b.id = v_pol.branch_id
  WHERE o.id = v_pol.organization_id;

  v_local := (p_at AT TIME ZONE COALESCE(v_tz, 'America/Argentina/Buenos_Aires'))::date;

  v_start := CASE v_pol.period
               WHEN 'dia'    THEN v_local
               WHEN 'semana' THEN (date_trunc('week',  v_local::timestamp))::date
               ELSE               (date_trunc('month', v_local::timestamp))::date
             END;
  v_end   := CASE v_pol.period
               WHEN 'dia'    THEN v_start + 1
               WHEN 'semana' THEN v_start + 7
               ELSE               (v_start + interval '1 month')::date
             END;

  SELECT
    COALESCE(COUNT(*), 0)::integer,
    COALESCE(SUM(i.imp_total), 0)
  INTO emitted_count, emitted_amount
  FROM arca_invoices i
  WHERE i.organization_id = v_pol.organization_id
    AND (v_pol.branch_id IS NULL OR i.branch_id = v_pol.branch_id)
    AND i.fecha_cbte >= v_start
    AND i.fecha_cbte <  v_end
    -- 'reservado' y 'en_duda' cuentan a propósito: mientras no se sepa si
    -- ARCA los autorizó, hay que asumir que sí. Sobrefacturar por optimismo
    -- es peor que quedarse corto.
    AND i.status IN ('reservado','emitida','en_duda')
    -- Las notas de crédito restan del cupo, no suman.
    AND i.cbte_tipo NOT IN (3, 8, 13, 53);

  period_start     := v_start;
  period_end       := v_end;
  target_count     := v_pol.target_count;
  target_amount    := v_pol.target_amount;
  remaining_count  := GREATEST(COALESCE(v_pol.target_count, 0)  - emitted_count, 0);
  remaining_amount := GREATEST(COALESCE(v_pol.target_amount, 0) - emitted_amount, 0);

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION arca_quota_state IS 'Estado del cupo del período vigente, DERIVADO de arca_invoices. Sin contadores denormalizados.';

-- -----------------------------------------------------------------------------
-- 8. arca_billing_candidates — qué ventas podrían facturarse
--
-- Devuelve las visitas elegibles (no facturadas, dentro de los filtros de la
-- política) ordenadas según la estrategia elegida. El corte por cupo lo hace
-- la app, porque en modo 'monto' depende de ir sumando.
--
-- Sobre 'distribuido': ordena por (posición dentro del día, día). O sea toma
-- una venta de cada día antes de tomar la segunda de ninguno — que es lo que
-- la gente quiere decir con "repartilo parejo a lo largo del mes".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_billing_candidates(
  p_organization_id uuid,
  p_branch_ids      uuid[],
  p_from            timestamptz,
  p_to              timestamptz,
  p_payment_methods text[]   DEFAULT ARRAY['cash','card','transfer']::text[],
  p_min_ticket      numeric  DEFAULT NULL,
  p_max_ticket      numeric  DEFAULT NULL,
  p_include_tips    boolean  DEFAULT false,
  p_selection       text     DEFAULT 'cronologico',
  p_seed            text     DEFAULT 'x',
  p_limit           integer  DEFAULT 500
)
RETURNS TABLE (
  visit_id       uuid,
  branch_id      uuid,
  branch_name    text,
  completed_at   timestamptz,
  base_amount    numeric,
  amount         numeric,
  tip_amount     numeric,
  payment_method text,
  client_id      uuid,
  client_name    text,
  client_phone   text,
  barber_name    text,
  service_name   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH elegibles AS (
    SELECT
      v.id                AS visit_id,
      v.branch_id,
      b.name              AS branch_name,
      b.timezone          AS tz,
      v.completed_at,
      (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) AS base_amount,
      v.amount,
      v.tip_amount,
      v.payment_method::text AS payment_method,
      v.client_id,
      c.name              AS client_name,
      c.phone             AS client_phone,
      s.full_name         AS barber_name,   -- `staff` NO tiene `name` (Known Risk #16)
      sv.name             AS service_name
    FROM visits v
    JOIN branches b        ON b.id = v.branch_id
    LEFT JOIN clients c    ON c.id = v.client_id
    LEFT JOIN staff s      ON s.id = v.barber_id
    LEFT JOIN services sv  ON sv.id = v.service_id
    WHERE v.organization_id = p_organization_id
      AND (p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids))
      AND v.completed_at >= p_from
      AND v.completed_at <  p_to
      AND v.payment_method::text = ANY (p_payment_methods)
      AND v.amount > 0
      AND (p_min_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) >= p_min_ticket)
      AND (p_max_ticket IS NULL OR (v.amount + CASE WHEN p_include_tips THEN v.tip_amount ELSE 0 END) <= p_max_ticket)
      -- Ya facturada (o en vuelo): fuera.
      AND NOT EXISTS (
        SELECT 1 FROM arca_invoices ai
        WHERE ai.visit_id = v.id
          AND ai.status IN ('pendiente','reservado','emitida','en_duda')
      )
  ),
  ordenadas AS (
    SELECT
      e.*,
      (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date AS dia_local,
      ROW_NUMBER() OVER (
        PARTITION BY (e.completed_at AT TIME ZONE COALESCE(e.tz, 'America/Argentina/Buenos_Aires'))::date
        ORDER BY e.completed_at
      ) AS pos_en_dia,
      md5(e.visit_id::text || p_seed) AS orden_aleatorio
    FROM elegibles e
  )
  SELECT
    o.visit_id, o.branch_id, o.branch_name, o.completed_at,
    o.base_amount, o.amount, o.tip_amount, o.payment_method,
    o.client_id, o.client_name, o.client_phone, o.barber_name, o.service_name
  FROM ordenadas o
  ORDER BY
    CASE WHEN p_selection = 'mas_baratos'  THEN o.base_amount END ASC  NULLS LAST,
    CASE WHEN p_selection = 'mas_caros'    THEN o.base_amount END DESC NULLS LAST,
    CASE WHEN p_selection = 'distribuido'  THEN o.pos_en_dia  END ASC  NULLS LAST,
    CASE WHEN p_selection = 'distribuido'  THEN o.dia_local   END ASC  NULLS LAST,
    CASE WHEN p_selection = 'aleatorio'    THEN o.orden_aleatorio END ASC NULLS LAST,
    o.completed_at ASC
  LIMIT COALESCE(p_limit, 500);
$$;

COMMENT ON FUNCTION arca_billing_candidates IS 'Ventas elegibles para facturar según la política, ya excluyendo las facturadas o en vuelo.';

-- -----------------------------------------------------------------------------
-- 9. Seguridad
--
-- RLS prendido y CERO políticas: sólo service_role atraviesa. Es deliberado —
-- estas tablas guardan una clave privada fiscal y el historial de CAEs. Todo
-- acceso pasa por server actions que ya resuelven la organización con
-- getCurrentOrgId(). Mismo criterio que las RPCs de payment_accounts (mig
-- 162/163) y las de turnos (mig 168).
-- -----------------------------------------------------------------------------
ALTER TABLE arca_taxpayers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arca_sales_points     ENABLE ROW LEVEL SECURITY;
ALTER TABLE arca_auth_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arca_billing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE arca_invoices         ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON arca_taxpayers,
              arca_sales_points,
              arca_auth_tokens,
              arca_billing_policies,
              arca_invoices
  FROM anon, authenticated;

REVOKE ALL ON FUNCTION arca_reserve_invoice     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_quota_state         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_billing_candidates  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION arca_reserve_invoice    TO service_role;
GRANT EXECUTE ON FUNCTION arca_quota_state        TO service_role;
GRANT EXECUTE ON FUNCTION arca_billing_candidates TO service_role;
