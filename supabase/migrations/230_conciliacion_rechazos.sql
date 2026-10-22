-- =============================================================================
-- 230 — Rechazar un emparejamiento dudoso de la conciliación (22/oct/2026)
--
-- El motor marca "para confirmar" lo que encontró con poca certeza (ventana de
-- 90 min o un crédito que suma varios cobros sin marcar). Hasta acá sólo se
-- podía CONFIRMAR: si el dueño veía que ese crédito no era de ese cobro, el día
-- quedaba en "no se sabe" para siempre. Un rechazo dice "este crédito NO es de
-- este cobro": el motor no vuelve a juntar ese par en ninguna pasada
-- automática, y los dos siguen su camino (otro emparejamiento o, si no,
-- "falta"/"sobra" a la vista). Un vínculo manual posterior manda sobre el
-- rechazo. Deshacer = deshecho_at.
--
-- Tabla aparte y no un tipo nuevo en mp_conciliacion_resoluciones: cambiar sus
-- CHECK exige DROP CONSTRAINT (Known Risk #40) y semánticamente no es una
-- resolución del caso (no lo saca de "para revisar"), es una restricción para
-- el motor. Sólo aditiva.
--
-- Known Risk #15: tiene FK a transfer_logs y a mp_movimientos. Verificado
-- antes de crearla que no hay embeds entre esas dos tablas (los de
-- mp_conciliacion_resoluciones usan la columna explícita como pista).
-- Como el resto del módulo: RLS sin policies, sólo service_role.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mp_conciliacion_rechazos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_log_id uuid NOT NULL REFERENCES public.transfer_logs(id) ON DELETE CASCADE,
  movimiento_id uuid NOT NULL REFERENCES public.mp_movimientos(id) ON DELETE CASCADE,
  created_by uuid,
  created_by_nombre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deshecho_at timestamptz,
  deshecho_por uuid
);

COMMENT ON TABLE public.mp_conciliacion_rechazos IS
  'Pares (cobro, crédito de MP) que una persona dijo que NO van juntos: el motor de conciliación no los vuelve a emparejar solo. Sólo service_role.';

-- Un rechazo activo por par.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_rechazo_activo
  ON public.mp_conciliacion_rechazos (transfer_log_id, movimiento_id)
  WHERE deshecho_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_rechazo_org ON public.mp_conciliacion_rechazos (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_rechazo_mov ON public.mp_conciliacion_rechazos (movimiento_id);

ALTER TABLE public.mp_conciliacion_rechazos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mp_conciliacion_rechazos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mp_conciliacion_rechazos TO service_role;
