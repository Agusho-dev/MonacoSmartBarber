-- ============================================
-- Registro de entrada/salida con Face ID
-- ============================================

CREATE TYPE attendance_action AS ENUM ('clock_in', 'clock_out');

CREATE TABLE attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  action_type attendance_action NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  face_verified BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

CREATE INDEX idx_attendance_staff ON attendance_logs(staff_id);
CREATE INDEX idx_attendance_branch ON attendance_logs(branch_id);
CREATE INDEX idx_attendance_recorded ON attendance_logs(recorded_at);

-- RLS
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_read_staff" ON attendance_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY "attendance_insert_all" ON attendance_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "attendance_manage_owner" ON attendance_logs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
