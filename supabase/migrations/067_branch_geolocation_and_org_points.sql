-- =============================================================================
-- 067_branch_geolocation_and_org_points.sql
-- Agrega geolocalización a sucursales y migra puntos a nivel organización.
-- =============================================================================

-- =============================================================================
-- PARTE 1: Agregar latitud y longitud a branches (WGS84)
-- =============================================================================

ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN branches.latitude IS 'Latitud WGS84 de la sucursal';
COMMENT ON COLUMN branches.longitude IS 'Longitud WGS84 de la sucursal';

-- Índice para queries geoespaciales básicas
CREATE INDEX IF NOT EXISTS idx_branches_geo
  ON branches(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- =============================================================================
-- PARTE 2: Agregar organization_id a client_points
-- =============================================================================

ALTER TABLE client_points
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill desde clients.organization_id
UPDATE client_points cp
SET organization_id = c.organization_id
FROM clients c
WHERE cp.client_id = c.id
  AND cp.organization_id IS NULL;

-- Filas huérfanas → Monaco
UPDATE client_points
SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
WHERE organization_id IS NULL;

ALTER TABLE client_points
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_points_org
  ON client_points(organization_id);

CREATE INDEX IF NOT EXISTS idx_client_points_client_org
  ON client_points(client_id, organization_id);

-- =============================================================================
-- PARTE 3: Consolidar client_points de per-branch a per-organization
-- Estrategia: para cada (client_id, organization_id) con múltiples filas,
-- sumar en una sola fila y eliminar las duplicadas.
-- =============================================================================

-- 3a. Crear tabla temporal con los totales consolidados
CREATE TEMP TABLE _cp_consolidated AS
SELECT
  client_id,
  organization_id,
  SUM(points_balance)::INTEGER AS points_balance,
  SUM(total_earned)::INTEGER AS total_earned,
  SUM(total_redeemed)::INTEGER AS total_redeemed,
  (MIN(id::text))::uuid AS keep_id  -- mantener la fila con el ID más antiguo
FROM client_points
GROUP BY client_id, organization_id
HAVING COUNT(*) > 1;

-- 3b. Actualizar la fila que mantenemos con los totales
UPDATE client_points cp
SET
  points_balance = c.points_balance,
  total_earned = c.total_earned,
  total_redeemed = c.total_redeemed
FROM _cp_consolidated c
WHERE cp.id = c.keep_id;

-- 3c. Eliminar las filas duplicadas (las que no son keep_id)
DELETE FROM client_points cp
WHERE EXISTS (
  SELECT 1 FROM _cp_consolidated c
  WHERE c.client_id = cp.client_id
    AND c.organization_id = cp.organization_id
    AND c.keep_id != cp.id
);

DROP TABLE _cp_consolidated;

-- 3d. Hacer branch_id nullable (ya no es clave del modelo de puntos)
ALTER TABLE client_points ALTER COLUMN branch_id DROP NOT NULL;

-- 3e. Drop el constraint unique viejo y crear el nuevo
-- (El constraint original es client_points_client_id_branch_id_key)
ALTER TABLE client_points DROP CONSTRAINT IF EXISTS client_points_client_id_branch_id_key;

-- Nuevo constraint: puntos únicos por (client_id, organization_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_client_points_unique_client_org'
  ) THEN
    CREATE UNIQUE INDEX idx_client_points_unique_client_org
      ON client_points(client_id, organization_id);
  END IF;
END $$;

-- =============================================================================
-- PARTE 4: Actualizar on_queue_completed para puntos por org
-- =============================================================================

CREATE OR REPLACE FUNCTION public.on_queue_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_commission NUMERIC(5,2);
  v_visit_id UUID;
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_service_points INTEGER;
  v_org_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    -- Obtener org_id de la branch
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;

    -- Get barber commission percentage
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    -- Create visit with organization_id
    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at, organization_id)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, 0, v_commission, 0, NEW.started_at, NEW.completed_at, v_org_id)
    RETURNING id INTO v_visit_id;

    -- Check service-specific points first
    v_service_points := 0;
    IF NEW.service_id IS NOT NULL THEN
      SELECT COALESCE(points_per_service, 0) INTO v_service_points
      FROM services WHERE id = NEW.service_id;
    END IF;

    IF v_service_points > 0 THEN
      v_points := v_service_points;
      v_reward_active := true;
    ELSE
      SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
      FROM rewards_config rw
      WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL)
        AND rw.is_active = true
      LIMIT 1;
    END IF;

    IF v_reward_active IS TRUE AND v_points > 0 AND NEW.client_id IS NOT NULL THEN
      -- Puntos por organización (ya no por branch)
      INSERT INTO client_points (client_id, branch_id, organization_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_org_id, v_points, v_points)
      ON CONFLICT (client_id, organization_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, visit_id, points, type, description, organization_id)
      VALUES (NEW.client_id, v_visit_id, v_points, 'earned', 'Puntos por visita', v_org_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- PARTE 5: Actualizar deduct_client_points para trabajar por org
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_client_points(p_client_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  remaining INTEGER := p_amount;
  v_client_org UUID;
BEGIN
  -- Verificar que el cliente existe y obtener su org
  SELECT organization_id INTO v_client_org
  FROM clients WHERE id = p_client_id;

  IF v_client_org IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado: %', p_client_id;
  END IF;

  -- Con puntos por org, hay una sola fila por (client_id, organization_id)
  FOR r IN
    SELECT id, points_balance
    FROM client_points
    WHERE client_id = p_client_id
      AND organization_id = v_client_org
      AND points_balance > 0
    ORDER BY points_balance DESC
  LOOP
    IF remaining <= 0 THEN EXIT; END IF;
    IF r.points_balance >= remaining THEN
      UPDATE client_points
      SET points_balance = points_balance - remaining,
          total_redeemed = total_redeemed + remaining
      WHERE id = r.id;
      remaining := 0;
    ELSE
      remaining := remaining - r.points_balance;
      UPDATE client_points
      SET total_redeemed = total_redeemed + points_balance,
          points_balance = 0
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$function$;

-- =============================================================================
-- PARTE 6: Actualizar get_client_branch_signals para incluir lat/lng
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_client_branch_signals();

CREATE OR REPLACE FUNCTION public.get_client_branch_signals()
RETURNS TABLE(
  branch_id             uuid,
  branch_name           text,
  branch_address        text,
  branch_latitude       double precision,
  branch_longitude      double precision,
  occupancy_level       occupancy_level,
  is_open               boolean,
  waiting_count         integer,
  in_progress_count     integer,
  available_barbers     integer,
  total_barbers         integer,
  eta_minutes           integer,
  best_arrival_in_minutes integer,
  suggestion_text       text,
  updated_at            timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    b.id                AS branch_id,
    b.name              AS branch_name,
    b.address           AS branch_address,
    b.latitude          AS branch_latitude,
    b.longitude         AS branch_longitude,
    COALESCE(bs.occupancy_level, 'sin_espera'::occupancy_level),
    (EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')))::INTEGER = ANY(b.business_days)
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME >= b.business_hours_open
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME < b.business_hours_close),
    COALESCE(bs.waiting_count, 0)::integer,
    COALESCE(bs.queue_size - bs.waiting_count, 0)::integer AS in_progress_count,
    COALESCE(bs.available_barbers, 0)::integer,
    COALESCE(bs.active_barbers, 0)::integer AS total_barbers,
    bs.eta_minutes,
    bs.best_arrival_in_minutes,
    bs.suggestion_text,
    bs.updated_at
  FROM branches b
  LEFT JOIN branch_signals bs ON bs.branch_id = b.id
  WHERE b.is_active = true
    AND b.organization_id = get_user_org_id()
  ORDER BY b.name;
$$;

-- =============================================================================
-- PARTE 7: Trigger para auto-poblar organization_id en client_points
-- =============================================================================

CREATE OR REPLACE TRIGGER trg_client_points_set_org
  BEFORE INSERT ON client_points
  FOR EACH ROW EXECUTE FUNCTION set_org_from_client();
