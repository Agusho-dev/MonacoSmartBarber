-- ============================================================
-- 034: Cartelera comercial configurable (billboard)
-- Items de pantalla para la app: imágenes, texto, CTAs
-- branch_id NULL = visible en todas las sucursales
-- ============================================================

CREATE TABLE IF NOT EXISTS billboard_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID        REFERENCES branches(id) ON DELETE CASCADE,
  title           TEXT,
  body            TEXT,
  image_url       TEXT,
  video_url       TEXT,
  cta_text        TEXT,
  cta_url         TEXT,
  display_order   INTEGER     NOT NULL DEFAULT 0,
  display_seconds INTEGER     NOT NULL DEFAULT 8 CHECK (display_seconds BETWEEN 3 AND 60),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: al menos title o image_url debe estar presente
ALTER TABLE billboard_items
  ADD CONSTRAINT billboard_has_content
  CHECK (title IS NOT NULL OR image_url IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_billboard_active_order
  ON billboard_items(is_active, display_order)
  WHERE is_active = true;

CREATE TRIGGER trg_billboard_updated_at
  BEFORE UPDATE ON billboard_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE billboard_items ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario (incluyendo anon) puede leer items activos y vigentes
CREATE POLICY billboard_read_active ON billboard_items
  FOR SELECT
  USING (
    is_active = true
    AND (valid_from  IS NULL OR valid_from  <= now())
    AND (valid_until IS NULL OR valid_until >= now())
  );

-- Solo owner/admin puede gestionar la cartelera
CREATE POLICY billboard_manage_owner ON billboard_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND is_active = true
    )
  );
