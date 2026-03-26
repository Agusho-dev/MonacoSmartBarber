-- Corrige el FK de transfer_logs.visit_id para que no bloquee la eliminación de visitas
ALTER TABLE transfer_logs
  DROP CONSTRAINT transfer_logs_visit_id_fkey,
  ADD CONSTRAINT transfer_logs_visit_id_fkey
    FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL;
