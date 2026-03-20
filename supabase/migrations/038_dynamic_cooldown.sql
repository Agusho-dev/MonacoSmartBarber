-- Cooldown configurable para la asignación dinámica de clientes
-- Segundos que un barbero queda "bloqueado" (carga +1) tras finalizar un servicio,
-- para evitar que el sistema le asigne un cliente que aún está en camino a su silla.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS dynamic_cooldown_seconds INTEGER NOT NULL DEFAULT 60;
