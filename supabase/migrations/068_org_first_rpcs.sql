-- =============================================================================
-- 068_org_first_rpcs.sql
-- RPCs para el flujo org-first en la app mobile:
-- 1. get_nearby_organizations() — lista orgs con sus branches y coordenadas
-- 2. get_org_branch_signals(p_org_id) — branches con señales para una org específica
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_nearby_organizations()
RETURNS TABLE(
  org_id         uuid,
  org_name       text,
  org_slug       text,
  org_logo_url   text,
  branch_count   integer,
  branches       jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.logo_url,
    COUNT(b.id)::integer,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'address', b.address,
        'latitude', b.latitude,
        'longitude', b.longitude
      )
    ) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM organizations o
  LEFT JOIN branches b ON b.organization_id = o.id AND b.is_active = true
  WHERE o.is_active = true
  GROUP BY o.id, o.name, o.slug, o.logo_url
  HAVING COUNT(b.id) > 0
  ORDER BY o.name;
$$;

CREATE OR REPLACE FUNCTION public.get_org_branch_signals(p_org_id uuid)
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
    b.id, b.name, b.address, b.latitude, b.longitude,
    COALESCE(bs.occupancy_level, 'sin_espera'::occupancy_level),
    (EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires')))::INTEGER = ANY(b.business_days)
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME >= b.business_hours_open
     AND (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::TIME < b.business_hours_close),
    COALESCE(bs.waiting_count, 0)::integer,
    COALESCE(bs.queue_size - bs.waiting_count, 0)::integer,
    COALESCE(bs.available_barbers, 0)::integer,
    COALESCE(bs.active_barbers, 0)::integer,
    bs.eta_minutes, bs.best_arrival_in_minutes, bs.suggestion_text, bs.updated_at
  FROM branches b
  LEFT JOIN branch_signals bs ON bs.branch_id = b.id
  WHERE b.is_active = true
    AND b.organization_id = p_org_id
  ORDER BY b.name;
$$;
