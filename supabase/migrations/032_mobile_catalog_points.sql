-- ============================================================
-- 032: Soporte de canje por puntos en catálogo de rewards
-- Agrega: points_cost e image_url en reward_catalog
--         nuevo valor 'points_redemption' en reward_type enum
-- ============================================================

-- Nuevo tipo de reward para items canjeables por puntos
ALTER TYPE reward_type ADD VALUE IF NOT EXISTS 'points_redemption';

-- Costo en puntos (null = no canjeable por puntos)
ALTER TABLE reward_catalog
  ADD COLUMN IF NOT EXISTS points_cost INTEGER CHECK (points_cost IS NULL OR points_cost > 0);

-- Imagen del item para mostrar en la app
ALTER TABLE reward_catalog
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Comentario: items existentes mantienen points_cost = NULL (no canjeables por puntos)
-- El admin puede configurar points_cost desde el dashboard para habilitar canje.
