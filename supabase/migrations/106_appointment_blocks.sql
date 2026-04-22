-- =============================================================================
-- Migración 106: Bloqueos de horario (appointment_blocks)
--
-- Tabla para bloquear slots de la agenda (vacaciones, descansos, capacitaciones,
-- eventos, feriados, etc.). Diferente de staff_schedule_exceptions (que es
-- ausencia completa de un día) — los bloques son por rango de tiempo arbitrario
-- y pueden ser por barbero, por sucursal, o por org.
-- =============================================================================

CREATE TABLE IF NOT EXISTS appointment_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  barber_id UUID REFERENCES staff(id) ON DELETE CASCADE,

  -- Scope del bloque:
  --   barber_id + branch_id:        solo ese barbero, esa sucursal
  --   branch_id + barber_id IS NULL: toda la sucursal (cierre local)
  --   branch_id IS NULL:            toda la organización (feriado)
  -- (checks abajo evitan combinaciones inválidas)

  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,

  -- Metadata
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT appointment_blocks_valid_range CHECK (end_at > start_at),
  CONSTRAINT appointment_blocks_scope_valid CHECK (
    -- Si hay barber_id, también debe haber branch_id (coherencia)
    barber_id IS NULL OR branch_id IS NOT NULL
  )
);

COMMENT ON TABLE appointment_blocks IS 'Bloqueos de horario en la agenda. Scope: barbero, sucursal o toda la org según qué columnas estén seteadas.';
COMMENT ON COLUMN appointment_blocks.barber_id IS 'NULL = bloquea a todos los barberos de la sucursal (o de la org si branch_id también es NULL).';
COMMENT ON COLUMN appointment_blocks.branch_id IS 'NULL = bloquea todas las sucursales de la organización (ej. feriado nacional).';
COMMENT ON COLUMN appointment_blocks.reason IS 'Texto libre: "Vacaciones", "Capacitación", "Feriado", etc.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_org ON appointment_blocks(organization_id);
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_branch ON appointment_blocks(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_barber ON appointment_blocks(barber_id) WHERE barber_id IS NOT NULL;

-- Índice para queries de rango (¿hay algún bloque que solape con este slot?)
-- Usamos tstzrange via expresión en btree_gist si está disponible; si no,
-- índices btree separados son suficientes para los volúmenes esperados.
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_range
  ON appointment_blocks(organization_id, start_at, end_at);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_appointment_blocks_updated_at ON appointment_blocks;
CREATE TRIGGER trg_appointment_blocks_updated_at
  BEFORE UPDATE ON appointment_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE appointment_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appointment_blocks_org' AND tablename = 'appointment_blocks') THEN
    CREATE POLICY "appointment_blocks_org" ON appointment_blocks FOR ALL
      USING (organization_id = get_user_org_id())
      WITH CHECK (organization_id = get_user_org_id());
  END IF;
END $$;

-- Realtime: útil para que la grilla refleje bloques creados por otros admins en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE appointment_blocks;

-- ---------------------------------------------------------------------------
-- Helper: verificar si un slot está bloqueado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_slot_blocked(
  p_org_id UUID,
  p_branch_id UUID,
  p_barber_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM appointment_blocks
    WHERE organization_id = p_org_id
      AND start_at < p_end_at
      AND end_at > p_start_at
      -- Scope match: el bloque aplica si su scope es más amplio o igual al slot
      AND (
        -- Bloque de org (branch_id NULL): bloquea todo
        branch_id IS NULL
        -- Bloque de sucursal (barber_id NULL): bloquea si coincide la sucursal
        OR (branch_id = p_branch_id AND barber_id IS NULL)
        -- Bloque de barbero específico
        OR (branch_id = p_branch_id AND barber_id = p_barber_id)
      )
  );
$$;

COMMENT ON FUNCTION is_slot_blocked IS 'Retorna TRUE si hay algún bloqueo que solape con el slot dado para el barbero/sucursal específico.';
