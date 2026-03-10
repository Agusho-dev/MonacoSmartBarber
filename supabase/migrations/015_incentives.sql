-- ============================================
-- Sistema de metas e incentivos
-- ============================================

CREATE TYPE incentive_metric AS ENUM ('haircut_count', 'content_post', 'custom');
CREATE TYPE incentive_period AS ENUM ('weekly', 'monthly');

CREATE TABLE incentive_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  metric incentive_metric NOT NULL DEFAULT 'haircut_count',
  threshold NUMERIC(10,2) NOT NULL,
  reward_amount NUMERIC(12,2) NOT NULL,
  period incentive_period NOT NULL DEFAULT 'monthly',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incentive_rules_branch ON incentive_rules(branch_id);

CREATE TRIGGER trg_incentive_rules_updated_at BEFORE UPDATE ON incentive_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Registro de logros alcanzados
CREATE TABLE incentive_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES incentive_rules(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_earned NUMERIC(12,2) NOT NULL,
  notes TEXT
);

CREATE INDEX idx_incentive_achievements_staff ON incentive_achievements(staff_id);
CREATE INDEX idx_incentive_achievements_rule ON incentive_achievements(rule_id);

-- RLS
ALTER TABLE incentive_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incentive_rules_read_all" ON incentive_rules FOR SELECT USING (true);
CREATE POLICY "incentive_rules_manage_owner" ON incentive_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));

ALTER TABLE incentive_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incentive_achievements_read_all" ON incentive_achievements FOR SELECT USING (true);
CREATE POLICY "incentive_achievements_manage_owner" ON incentive_achievements FOR ALL
  USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
