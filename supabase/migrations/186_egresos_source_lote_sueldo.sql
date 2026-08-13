-- 186 — Distinguir el egreso de un LOTE DE SUELDO/PROPINAS del gasto variable manual.
--
-- El problema: `paySelectedReports` (salary.ts) y `payAllPendingTipsForBarber` (tips.ts)
-- insertan un `expense_tickets` por el total del lote SIN pasar `source`, así que cae en el
-- default 'manual'. Y `fetchFinancialData` arma los "gastos variables" del mes con
-- `.eq('source','manual')` y, en la MISMA suma de egresos, agrega los `salary_reports` de ese
-- mismo lote. Resultado: cada peso de sueldo pagado se resta DOS VECES del resultado neto.
--
-- Medido en prod al 13/08/2026: 34 tickets categoría 'Sueldos' por $23.381.904 y 3 de
-- 'Propinas' por $11.200, todos con source='manual'. En Paraná los 32 lotes con ticket suman
-- $23.121.604 y la suma de sus `salary_reports` da exactamente $23.121.604 — es literalmente
-- la misma plata contada dos veces. Por eso mayo daba -$6.666.750 y junio -$2.015.970 en una
-- sucursal que factura $20M estables.
--
-- Se excluye el TICKET y no el reporte porque los `salary_reports` cubren el 100% de los lotes
-- y los tickets no: hay 11 lotes sin ticket ($2.705.801; 10 de Rondeau, 1 de Test) porque
-- `salary.ts` loguea el error del insert y sigue de largo. Filtrando por el lado del reporte,
-- Rondeau perdería $2,7M de sueldos reales.

BEGIN;

-- 1) Habilitar los dos values nuevos. Additivo: 'manual' y 'fixed_expense_period' siguen
--    siendo válidos, así que el código viejo sigue escribiendo sin romperse (importa porque
--    esta migración se aplica ANTES del deploy).
ALTER TABLE public.expense_tickets
  DROP CONSTRAINT IF EXISTS expense_tickets_source_check;

ALTER TABLE public.expense_tickets
  ADD CONSTRAINT expense_tickets_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'fixed_expense_period'::text, 'salary_batch'::text, 'tip_batch'::text]));

COMMENT ON COLUMN public.expense_tickets.source IS
  'Origen del egreso. manual = gasto variable cargado a mano (el único que cuenta como '
  '"gastos variables" en Finanzas). fixed_expense_period = pago de un gasto fijo. '
  'salary_batch / tip_batch = contracara en caja de un lote de sueldos/propinas, cuyo costo '
  'Finanzas ya toma de salary_reports: NO volver a sumarlo como gasto variable.';

-- 2) Backfill de los tickets que ya existen, resueltos por el lote que los creó
--    (`salary_payment_batches.expense_ticket_id`) — no por la categoría, que es texto libre
--    y editable por el usuario.
UPDATE public.expense_tickets t
SET source = CASE WHEN t.category = 'Propinas' THEN 'tip_batch' ELSE 'salary_batch' END
WHERE t.source = 'manual'
  AND EXISTS (
    SELECT 1 FROM public.salary_payment_batches b
    WHERE b.expense_ticket_id = t.id
  );

COMMIT;

-- Verificación posterior esperada (13/08/2026):
--   select source, count(*), sum(amount) from expense_tickets group by 1;
--     manual               -> 30 filas / $844.560,77   (era 67 / $24.237.664,77)
--     fixed_expense_period -> 26 filas / $4.926.911
--     salary_batch         -> 34 filas / $23.381.904
--     tip_batch            ->  3 filas / $11.200
--
-- Los tickets de sueldo NO desaparecen de la pantalla: el donut "Egresos por categoría"
-- (`fetchExpensesByCategory`) no filtra por `source`, así que siguen visibles bajo su
-- categoría "Sueldos". Lo único que cambia es que dejan de sumarse por segunda vez al
-- resultado neto.
