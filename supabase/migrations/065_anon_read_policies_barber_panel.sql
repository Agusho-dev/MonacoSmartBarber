-- Políticas de lectura anónima para el panel de barberos y TV
-- El panel de barberos no usa Supabase Auth (usa PIN + cookie),
-- por lo que get_user_org_id() retorna NULL y los JOINs fallan.
-- Estas políticas permiten lectura de datos necesarios para la fila.

-- Clientes: permitir lectura anónima de clientes que están en la fila activa
CREATE POLICY clients_anon_read ON clients
  FOR SELECT
  USING (
    id IN (
      SELECT client_id FROM queue_entries
      WHERE status IN ('waiting', 'in_progress')
    )
  );

-- Servicios: permitir lectura anónima de servicios activos
CREATE POLICY services_anon_read ON services
  FOR SELECT
  USING (is_active = true);

-- App settings: permitir lectura anónima de configuración
CREATE POLICY settings_anon_read ON app_settings
  FOR SELECT
  USING (true);

-- Client loyalty state: permitir lectura para clientes en fila activa
CREATE POLICY client_loyalty_anon_read ON client_loyalty_state
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM queue_entries
      WHERE status IN ('waiting', 'in_progress')
    )
  );
