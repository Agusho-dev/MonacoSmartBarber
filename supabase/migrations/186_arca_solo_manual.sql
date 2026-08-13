-- =============================================================================
-- 186_arca_solo_manual.sql
-- La facturación pasa a ser SIEMPRE manual.
--
-- Decisión del dueño, y es la correcta para arrancar: emitir un comprobante
-- fiscal es irreversible —sólo se anula con nota de crédito, que consume otro
-- número y queda en los libros— así que nadie quiere descubrir a la mañana que
-- el sistema emitió 300 durante la noche.
--
-- Se cierra la vía automática en TRES capas, porque cerrarla en una sola deja
-- la puerta entornada:
--
--   1. Se desprograma el cron. Sin disparador, no hay corrida nocturna.
--   2. `auto_emit` queda en false en todas las políticas y con default false.
--   3. La server action ignora el pedido de prenderlo (ver arca-panel.ts).
--
-- Nada de esto se pierde: el motor sigue soportando la emisión automática y
-- volver a habilitarla es reprogramar el cron. Lo que cambia es que hoy la
-- única forma de que salga un comprobante es que alguien apriete el botón.
-- =============================================================================

-- 1. Sin disparador.
DO $$
BEGIN
  PERFORM cron.unschedule('arca-facturacion');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Ninguna política emite sola, ni las que ya estaban cargadas.
UPDATE arca_billing_policies SET auto_emit = false WHERE auto_emit;

ALTER TABLE arca_billing_policies ALTER COLUMN auto_emit SET DEFAULT false;

COMMENT ON COLUMN arca_billing_policies.auto_emit IS
  'Emisión automática. Apagada por decisión de producto (mig 186): la facturación es manual y sale sólo apretando el botón. El cron está desprogramado; para reactivarla hay que reprogramarlo Y prender esto.';

-- La función del trigger queda: si algún día se reactiva, el cron la necesita.
COMMENT ON FUNCTION public.trigger_arca_facturacion() IS
  'Dispara /api/cron/arca-facturacion. DESPROGRAMADA en la mig 186: hoy la facturación es sólo manual.';
