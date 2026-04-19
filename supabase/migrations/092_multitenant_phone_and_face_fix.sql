-- ============================================================
-- Migración 092: Fix multi-tenant en clients y client_face_descriptors
-- ============================================================
--
-- 1. Reemplazar UNIQUE(phone) global por UNIQUE(organization_id, phone).
--    Esto permite que una misma persona exista como cliente en más de
--    una barbería del SaaS — cada organización mantiene su propio
--    registro con historial, puntos, notas, etc. independientes.
--
-- 2. Defensa en profundidad: trigger BEFORE INSERT que auto-rellena
--    organization_id en client_face_descriptors derivándolo del
--    cliente asociado cuando llega NULL. Evita fallas silenciosas de
--    enrolment facial si algún caller olvida setearlo.
--
-- Pre-checks ejecutados antes de esta migración:
--   - No existen duplicados por (organization_id, phone) en clients.
--   - clients.phone es NOT NULL.
--   - client_face_descriptors.organization_id es NOT NULL sin default.
-- ============================================================

BEGIN;

-- ---- 1. UNIQUE por (organization_id, phone) ----------------------

-- Limpieza: el índice no-unique idx_clients_org_phone queda cubierto
-- por la nueva UNIQUE constraint (que crea su propio índice).
-- idx_clients_phone queda redundante: cualquier consulta por phone
-- debería scoped por org en un modelo multi-tenant correcto.
DROP INDEX IF EXISTS public.idx_clients_phone;
DROP INDEX IF EXISTS public.idx_clients_org_phone;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_phone_key;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_org_phone_key
  UNIQUE (organization_id, phone);

COMMENT ON CONSTRAINT clients_org_phone_key ON public.clients IS
  'Un teléfono puede repetirse en distintas organizaciones (multi-tenant), pero es único dentro de cada una.';

-- ---- 2. Trigger de consistencia en client_face_descriptors ------

CREATE OR REPLACE FUNCTION public.ensure_client_face_descriptor_org()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT c.organization_id INTO NEW.organization_id
    FROM public.clients c
    WHERE c.id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_face_descriptor_fill_org
  ON public.client_face_descriptors;

CREATE TRIGGER trg_client_face_descriptor_fill_org
  BEFORE INSERT ON public.client_face_descriptors
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_client_face_descriptor_org();

COMMENT ON FUNCTION public.ensure_client_face_descriptor_org IS
  'Auto-rellena organization_id en client_face_descriptors desde el cliente asociado para evitar fallas silenciosas de insert cuando el caller lo omite.';

COMMIT;
