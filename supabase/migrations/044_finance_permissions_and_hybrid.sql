-- 044: Actualizar permisos de finanzas (granulares por tab) y agregar soporte para déficit híbrido
-- Migra el viejo permiso finances.view a los nuevos permisos granulares

-- Migrar permisos existentes: si un rol tiene finances.view = true,
-- darle acceso a todos los nuevos permisos de visualización de finanzas
UPDATE roles
SET permissions = permissions
  - 'finances.view'
  || jsonb_build_object(
    'finances.view_summary', (permissions->>'finances.view')::boolean,
    'finances.view_expenses', (permissions->>'finances.view')::boolean,
    'finances.view_fixed', (permissions->>'finances.view')::boolean,
    'finances.view_accounts', (permissions->>'finances.view')::boolean
  )
WHERE permissions ? 'finances.view';

-- Agregar salary.view_commissions a roles que ya tienen salary.view
UPDATE roles
SET permissions = permissions
  || jsonb_build_object('salary.view_commissions', (permissions->>'salary.view')::boolean)
WHERE permissions ? 'salary.view'
  AND NOT permissions ? 'salary.view_commissions';

-- Agregar tipo hybrid_deficit al check constraint de salary_reports si existe
-- Primero eliminamos el constraint existente y lo recreamos con el nuevo valor
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'salary_reports' AND constraint_name = 'salary_reports_type_check'
  ) THEN
    ALTER TABLE salary_reports DROP CONSTRAINT salary_reports_type_check;
  END IF;

  ALTER TABLE salary_reports
    ADD CONSTRAINT salary_reports_type_check
    CHECK (type IN ('commission', 'base_salary', 'bonus', 'advance', 'hybrid_deficit'));
END $$;
