-- (schema_migrations «226_metas_en_panel_por_sucursal»)
-- ============================================================================
-- 226 — La sección Metas del panel del barbero, prendida o apagada por sucursal
-- ============================================================================
-- APLICADA en prod el 19/10/2026 (la columna; el dato va al final).
--
-- Pedido del dueño (19/oct/2026): «Ocultá la sección de metas en Rondeau y
-- Paraná». Interruptor por sucursal, como asesoria_habilitada (217) y
-- menor_espera_aviso (218). Default TRUE: ninguna otra sucursal cambia.
--
-- No se deriva de si hay metas cargadas: Paraná tiene una regla activa y
-- Rondeau ninguna, y el pedido es el mismo para las dos.
--
-- Lo leen el layout de /barbero (la barra de abajo) y /barbero/metas (que
-- redirige a la fila si está apagado), los dos con service role. Lo escribe
-- `guardarMetasEnPanel` (src/lib/actions/incentives.ts), desde
-- /dashboard/incentivos. Apagarlo no toca las reglas ni los logros: el dueño
-- los sigue cargando y registrando igual.
-- ============================================================================

-- branches se lee en cada pedido de las tablets: si el ALTER tiene que esperar
-- un lock, que falle a los 3 s en vez de encolar a todos detrás. Con default
-- constante el ALTER es sólo de catálogo (no reescribe la tabla).
SET lock_timeout = '3s';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS metas_en_panel boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.branches.metas_en_panel IS
  'Si el panel del barbero muestra la sección Metas en esta sucursal (mig 226). Apagado: no aparece en la barra y /barbero/metas lleva a la fila.';

-- Dato (NO es parte de la migración: se corrió aparte, el 19/oct/2026, y
-- devolvió Rondeau y Parana en false). Queda acá como registro:
--
--   UPDATE public.branches SET metas_en_panel = false
--   WHERE id IN ('1264eb6e-bb7e-4c71-9110-a8b3f3acec12',   -- Rondeau
--                '9a9e1dce-a08a-4381-b5bd-7c9aedd9cb2f');  -- Paraná
