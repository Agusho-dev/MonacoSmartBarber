-- 102_fixed_expenses_periods.sql
-- =======================================================================
-- Gastos fijos mensuales con períodos de pago (precio variable).
--
-- Concepto:
--   * fixed_expenses → catálogo maestro (QUÉ pagamos todos los meses)
--   * fixed_expense_periods → instancia mensual (CUÁNTO se pagó este mes)
--
-- Flujo:
--   1. El usuario carga un gasto en el catálogo con vencimiento, URL de pago
--      y hasta 2 datos copiables (contrato, CUIT, etc.). NO carga precio.
--   2. El día 1 de cada mes, pg_cron dispara un POST a Next.js que itera
--      las orgs y llama a generate_fixed_expense_periods() para cada una
--      cuya TZ local esté en día 1. Se crean filas "pending" con snapshot
--      de los datos del catálogo (congelados).
--   3. El usuario completa monto + fecha real de pago → status='paid'.
--      Opcionalmente se crea un expense_ticket linkeado para aparecer en
--      Egresos.
--
-- Snapshot strategy: los campos de la tabla de períodos copian los datos
-- del catálogo al momento de generación. Si luego el usuario edita el
-- catálogo (cambia nombre, contrato, etc.), los períodos anteriores NO se
-- tocan — reflejan qué se pagó con los datos que estaban vigentes ese mes.
-- =======================================================================

-- 1. Evolución del catálogo fixed_expenses ─────────────────────────────
--    Campos nuevos opcionales para no romper datos existentes.

ALTER TABLE fixed_expenses
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS payment_url TEXT,
    ADD COLUMN IF NOT EXISTS copyable_1_label TEXT,
    ADD COLUMN IF NOT EXISTS copyable_1_value TEXT,
    ADD COLUMN IF NOT EXISTS copyable_2_label TEXT,
    ADD COLUMN IF NOT EXISTS copyable_2_value TEXT,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill organization_id desde branches para filas existentes
UPDATE fixed_expenses fe
SET organization_id = b.organization_id
FROM branches b
WHERE fe.branch_id = b.id AND fe.organization_id IS NULL;

-- Relajar branch_id: permitir NULL para gastos a nivel organización
ALTER TABLE fixed_expenses ALTER COLUMN branch_id DROP NOT NULL;

-- Constraint de scope: al menos uno de branch_id u organization_id
ALTER TABLE fixed_expenses DROP CONSTRAINT IF EXISTS fixed_expenses_scope_check;
ALTER TABLE fixed_expenses ADD CONSTRAINT fixed_expenses_scope_check
    CHECK (branch_id IS NOT NULL OR organization_id IS NOT NULL);

-- Coherencia de copiables: si hay label debe haber value (app-level también)
ALTER TABLE fixed_expenses DROP CONSTRAINT IF EXISTS fixed_expenses_copyable_1_coherent;
ALTER TABLE fixed_expenses ADD CONSTRAINT fixed_expenses_copyable_1_coherent
    CHECK (
        (copyable_1_label IS NULL AND copyable_1_value IS NULL)
        OR (copyable_1_label IS NOT NULL AND copyable_1_value IS NOT NULL)
    );
ALTER TABLE fixed_expenses DROP CONSTRAINT IF EXISTS fixed_expenses_copyable_2_coherent;
ALTER TABLE fixed_expenses ADD CONSTRAINT fixed_expenses_copyable_2_coherent
    CHECK (
        (copyable_2_label IS NULL AND copyable_2_value IS NULL)
        OR (copyable_2_label IS NOT NULL AND copyable_2_value IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_fixed_expenses_org_id ON fixed_expenses(organization_id);

-- Reemplazar la policy org-aware para soportar gastos org-wide (branch_id NULL)
DROP POLICY IF EXISTS "fixed_expenses_manage_by_org" ON fixed_expenses;
CREATE POLICY "fixed_expenses_manage_by_org"
    ON fixed_expenses FOR ALL
    USING (
        (
            (branch_id IS NOT NULL AND branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
            OR (branch_id IS NULL AND organization_id = get_user_org_id())
        )
        AND is_org_admin_or_owner()
    )
    WITH CHECK (
        (
            (branch_id IS NOT NULL AND branch_id IN (SELECT id FROM branches WHERE organization_id = get_user_org_id()))
            OR (branch_id IS NULL AND organization_id = get_user_org_id())
        )
        AND is_org_admin_or_owner()
    );

-- 2. Columna source en expense_tickets para evitar doble conteo ─────────
--    Los pagos de gastos fijos crean un expense_ticket con source='fixed_expense_period'.
--    fetchFinancialData filtra por source='manual' en variableExpenses.

ALTER TABLE expense_tickets
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','fixed_expense_period'));

CREATE INDEX IF NOT EXISTS idx_expense_tickets_source ON expense_tickets(source) WHERE source <> 'manual';

-- 3. Tabla de períodos ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_expense_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixed_expense_id UUID NOT NULL REFERENCES fixed_expenses(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,

    period_year SMALLINT NOT NULL,
    period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),

    -- Snapshot del catálogo al momento de generación
    snapshot_name TEXT NOT NULL,
    snapshot_category TEXT,
    snapshot_due_day SMALLINT CHECK (snapshot_due_day BETWEEN 1 AND 31),
    snapshot_payment_url TEXT,
    snapshot_copyable_1_label TEXT,
    snapshot_copyable_1_value TEXT,
    snapshot_copyable_2_label TEXT,
    snapshot_copyable_2_value TEXT,

    due_date DATE,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','cancelled')),
    paid_amount NUMERIC(12,2),
    paid_at DATE,
    paid_by UUID REFERENCES staff(id) ON DELETE SET NULL,
    payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,
    payment_notes TEXT,
    expense_ticket_id UUID REFERENCES expense_tickets(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (fixed_expense_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_fep_org_period ON fixed_expense_periods(organization_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_fep_branch_period ON fixed_expense_periods(branch_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_fep_status_pending ON fixed_expense_periods(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fep_due_date ON fixed_expense_periods(due_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fep_paid_at ON fixed_expense_periods(paid_at) WHERE status = 'paid';

-- Trigger updated_at (reusar función update_updated_at si existe, si no se crea)
CREATE OR REPLACE FUNCTION fep_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fep_updated_at ON fixed_expense_periods;
CREATE TRIGGER trg_fep_updated_at
    BEFORE UPDATE ON fixed_expense_periods
    FOR EACH ROW EXECUTE FUNCTION fep_set_updated_at();

-- 4. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE fixed_expense_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fep_select_by_org" ON fixed_expense_periods;
CREATE POLICY "fep_select_by_org"
    ON fixed_expense_periods FOR SELECT
    USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS "fep_insert_by_org" ON fixed_expense_periods;
CREATE POLICY "fep_insert_by_org"
    ON fixed_expense_periods FOR INSERT
    WITH CHECK (organization_id = get_user_org_id() AND is_org_admin_or_owner());

DROP POLICY IF EXISTS "fep_update_by_org" ON fixed_expense_periods;
CREATE POLICY "fep_update_by_org"
    ON fixed_expense_periods FOR UPDATE
    USING (organization_id = get_user_org_id() AND is_org_admin_or_owner())
    WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS "fep_delete_by_org" ON fixed_expense_periods;
CREATE POLICY "fep_delete_by_org"
    ON fixed_expense_periods FOR DELETE
    USING (organization_id = get_user_org_id() AND is_org_admin_or_owner());

-- 5. Helper: último día del mes dado (para clamping de due_date) ────────
CREATE OR REPLACE FUNCTION public.fep_compute_due_date(p_year INT, p_month INT, p_due_day SMALLINT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_last_day INT;
BEGIN
    IF p_due_day IS NULL THEN RETURN NULL; END IF;
    -- Último día del mes calendar
    v_last_day := EXTRACT(DAY FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day'))::INT;
    -- Clamp: si due_day > último día del mes, usar último día
    RETURN make_date(p_year, p_month, LEAST(p_due_day::INT, v_last_day));
END;
$$;

-- 6. Generación mensual por organización ─────────────────────────────────
--    Llamada desde el route handler Next.js (que resuelve TZ por org).
--    Es idempotente gracias al UNIQUE + ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION public.generate_fixed_expense_periods(
    p_org_id UUID,
    p_year INT,
    p_month INT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_created INT := 0;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'organization_id es requerido';
    END IF;
    IF p_year < 2020 OR p_year > 2100 THEN
        RAISE EXCEPTION 'p_year fuera de rango razonable: %', p_year;
    END IF;
    IF p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'p_month debe estar entre 1 y 12, recibido: %', p_month;
    END IF;

    INSERT INTO fixed_expense_periods (
        fixed_expense_id, organization_id, branch_id,
        period_year, period_month,
        snapshot_name, snapshot_category, snapshot_due_day,
        snapshot_payment_url,
        snapshot_copyable_1_label, snapshot_copyable_1_value,
        snapshot_copyable_2_label, snapshot_copyable_2_value,
        due_date
    )
    SELECT
        fe.id,
        COALESCE(fe.organization_id, b.organization_id),
        fe.branch_id,
        p_year, p_month,
        fe.name, fe.category, fe.due_day,
        fe.payment_url,
        fe.copyable_1_label, fe.copyable_1_value,
        fe.copyable_2_label, fe.copyable_2_value,
        public.fep_compute_due_date(p_year, p_month, fe.due_day)
    FROM fixed_expenses fe
    LEFT JOIN branches b ON b.id = fe.branch_id
    WHERE fe.is_active = true
      AND COALESCE(fe.organization_id, b.organization_id) = p_org_id
    ON CONFLICT (fixed_expense_id, period_year, period_month) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;

    RETURN jsonb_build_object(
        'created', v_created,
        'org_id', p_org_id,
        'period_year', p_year,
        'period_month', p_month
    );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_fixed_expense_periods(UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_fixed_expense_periods(UUID, INT, INT) TO service_role, postgres;

-- 7. Cron: pg_cron → endpoint Next.js ───────────────────────────────────
--    Estrategia: cada hora en el día 1 de cada mes. El endpoint filtra por
--    "¿es día 1 en timezone de la org?" y skipea a las demás.
--    Idempotente gracias al UNIQUE (fixed_expense_id, year, month).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_generate_fixed_expense_periods()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
    v_url text;
    v_secret text;
    v_req_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

    IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE EXCEPTION 'Missing vault secrets: app_base_url=%, cron_secret=%',
            (v_url IS NOT NULL), (v_secret IS NOT NULL);
    END IF;

    SELECT net.http_post(
        url := v_url || '/api/cron/generate-fixed-expense-periods',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    ) INTO v_req_id;

    RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_generate_fixed_expense_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_generate_fixed_expense_periods() TO postgres;

-- Idempotencia: borrar job si existía
DO $$
BEGIN
    PERFORM cron.unschedule('generate-fixed-expense-periods');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Cada hora del día 1 de cada mes (cubre todos los timezones).
-- El endpoint filtra por org.timezone y solo ejecuta una vez por org.
SELECT cron.schedule(
    'generate-fixed-expense-periods',
    '0 * 1 * *',
    $job$SELECT public.trigger_generate_fixed_expense_periods();$job$
);

-- 8. Observabilidad: extender workflow_cron_health ──────────────────────
CREATE OR REPLACE VIEW public.workflow_cron_health AS
SELECT
    j.jobname,
    j.schedule,
    j.active,
    r.runid,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time,
    EXTRACT(EPOCH FROM (r.end_time - r.start_time)) AS duration_seconds
FROM cron.job j
LEFT JOIN LATERAL (
    SELECT *
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
) r ON true
WHERE j.jobname IN (
    'process-workflow-delays',
    'expire-stale-workflow-executions',
    'auto-clockout',
    'generate-fixed-expense-periods'
);

GRANT SELECT ON public.workflow_cron_health TO service_role;

-- 9. Comentarios ────────────────────────────────────────────────────────
COMMENT ON TABLE fixed_expense_periods IS
    'Instancia mensual de un gasto fijo. Se genera automáticamente el día 1 de cada mes (pg_cron → Next.js endpoint) con snapshot del catálogo. El usuario completa paid_amount al efectuar el pago.';

COMMENT ON COLUMN fixed_expense_periods.snapshot_name IS
    'Snapshot del nombre del catálogo al momento de generación. No cambia si luego se edita el catálogo.';

COMMENT ON COLUMN fixed_expense_periods.expense_ticket_id IS
    'Link al expense_ticket creado al marcar como pagado (si el usuario eligió registrarlo en Egresos). Permite revertir el pago borrando el ticket.';

COMMENT ON COLUMN fixed_expenses.payment_url IS
    'URL del portal/página donde se realiza el pago. El dashboard renderiza un botón "Pagar online".';

COMMENT ON COLUMN fixed_expenses.copyable_1_label IS
    'Etiqueta del primer dato copiable (ej: "Nº de contrato"). El valor va en copyable_1_value.';

COMMENT ON COLUMN expense_tickets.source IS
    'Origen del egreso: "manual" (creado desde Egresos) o "fixed_expense_period" (auto-creado al marcar pagado un gasto fijo). Usado para evitar doble conteo en Finanzas.';

COMMENT ON FUNCTION public.generate_fixed_expense_periods(UUID, INT, INT) IS
    'Genera los períodos pendientes del mes (year/month) para una org específica. Idempotente. Llamada desde el route handler Next.js que resuelve TZ por org.';

COMMENT ON FUNCTION public.trigger_generate_fixed_expense_periods() IS
    'Llamada por pg_cron cada hora del día 1 de cada mes. POSTea al endpoint /api/cron/generate-fixed-expense-periods que itera las orgs y llama a generate_fixed_expense_periods() para cada una cuya TZ esté en día 1.';
