-- ============================================================
-- Migración 038: Permitir visitas sin cliente
-- ============================================================
-- Permite registrar visitas para clientes anónimos (Consumidor Final)
-- sin requerir un registro en la tabla clients.

-- 1. Eliminar restricción NOT NULL de client_id en visits
ALTER TABLE visits ALTER COLUMN client_id DROP NOT NULL;
