-- 187 — La cuenta de cobro "Alejo Jofre" estaba registrada en la sucursal Test y cobró
-- SIEMPRE en Paraná: 637 filas en `transfer_logs`, las 637 con `branch_id` = Paraná, cero de
-- Test. Y 810 visitas de Paraná la usaron como `payment_account_id` ($13.270.000; dejó de
-- usarse el 24/06/2026).
--
-- Mientras "Cobros por destino" armaba la lista de destinos con `payment_accounts.branch_id`,
-- eso escondía $10.414.000 de transferencias de Paraná y se los atribuía a Test, que en ese
-- período facturó $1.000. El camino de lectura ya se corrigió (`getAllAccountBalanceTotals`
-- ahora scopea por la sucursal del COBRO, no por la de la cuenta), pero el dato seguía mal y
-- Test seguiría figurando como dueño de cobros que no hizo.
--
-- Es un UPDATE de una sola columna y NO toca el ledger: `transfer_logs.branch_id` ya dice
-- Paraná en las 637 filas, así que ningún total se mueve por esto — sólo deja de mentir sobre
-- a qué sucursal pertenece la cuenta. Se hace por SQL porque `upsertPaymentAccount` bloquea
-- mover una cuenta con historial.
--
-- Aplicada a prod el 13/08/2026.

UPDATE public.payment_accounts
SET branch_id = '9a9e1dce-a08a-4381-b5bd-7c9aedd9cb2f'  -- Parana
WHERE id = '5cf00df1-2839-4ea5-b386-c58fa1b36da8'
  AND branch_id = 'c031e1bf-895e-4f5a-9213-cc69f3225816'; -- Test (guard de idempotencia)
