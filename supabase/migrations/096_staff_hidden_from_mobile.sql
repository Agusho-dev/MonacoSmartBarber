-- F1: Permite ocultar barberos de la app móvil pública
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS hidden_from_mobile boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff.hidden_from_mobile IS 'Si es true, el barbero no aparece en la app móvil del cliente';
