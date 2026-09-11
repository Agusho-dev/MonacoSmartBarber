-- ============================================================================
-- Cuenta demo para App Review y para "Acceso a la app" de Play  (10/sep/2026)
--
-- Cliente `e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71` — "Apple Review (cuenta demo)",
-- teléfono 1100000000. Entra con el código fijo del secret `AUTH_TEST_PHONES`
-- (`1100000000=123456`): no recibe WhatsApp.
--
-- POR QUÉ ESTE ARCHIVO EXISTE
-- ---------------------------
-- Apple 2.1 (App Completeness) y la sección "Acceso a la app" de Play piden que
-- el revisor pueda VER la app funcionando. Con la cuenta vacía —0 visitas, 0
-- puntos, el programa de fidelización apagado— el revisor abre el Home y ve una
-- tarjeta gris en cero, Premios sin nada canjeable y media app diciendo
-- "próximamente". Eso se lee como una app a medias y es causal de rechazo.
--
-- POR QUÉ NO SE CREAN VISITAS
-- ---------------------------
-- `visits` es la tabla de la que salen los ingresos, la comisión de cada
-- barbero, el ticket promedio, los comprobantes de ARCA y el ledger de las
-- cuentas de cobro. Meter cortes de mentira ahí para una demo ensucia la
-- contabilidad real del negocio y no hay forma prolija de sacarlos después.
-- En vez de eso se usan las dos palancas que existen justamente para esto:
--
--   1. `client_loyalty_state.preview_until` (migración 201): mientras esté
--      vigente, `get_client_loyalty()` y el canje tratan a ESE cliente como si
--      el programa estuviera prendido, con la categoría que diga su fila. Ni el
--      trigger de visitas ni el cron lo miran, así que nadie más se entera.
--      Es el mismo mecanismo que se usó el 30/ago para que el dueño viera las
--      tarjetas en su iPhone.
--   2. Un lote de puntos `manual_adjust`, que es el tipo previsto para los
--      ajustes a mano y no pasa por `visits`.
--
-- CUÁNDO REVERTIRLO
-- -----------------
-- Cuando las dos apps estén publicadas y aprobadas, o cuando el programa de
-- fidelización se prenda de verdad para toda la organización (ahí la categoría
-- tiene que salir de las visitas reales, no de esta fila). Al final del archivo
-- está el bloque para deshacerlo.
--
-- Aplicar:  psql / SQL editor / MCP  →  este archivo entero. Es idempotente.
-- ============================================================================

BEGIN;

-- ── 1. Estado de fidelización con vista previa ──────────────────────────────
--
-- Oro con 7 visitas en la ventana (el umbral de Oro son 6 y el de Platinum 9):
-- así el Home muestra la tarjeta dorada Y la línea de progreso "te faltan 2
-- visitas para Platinum", que es lo que hace entendible la pantalla de un
-- vistazo. `preview_until` va al 31/3/2027 para cubrir la primera revisión, las
-- correcciones si hay rechazo y las primeras actualizaciones.

INSERT INTO public.client_loyalty_state (
  client_id, organization_id, tier_code, tier_sort,
  total_visits, visits_in_window, current_streak, next_milestone_at,
  enrolled_at, tier_reached_at, last_recalc_at, last_visit_at, preview_until
)
VALUES (
  'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'oro', 3,
  12, 7, 7, 10,
  now(), now(), now(), now() - interval '9 days',
  timestamptz '2027-03-31 23:59:59-03'
)
ON CONFLICT (client_id) DO UPDATE SET
  tier_code        = EXCLUDED.tier_code,
  tier_sort        = EXCLUDED.tier_sort,
  total_visits     = EXCLUDED.total_visits,
  visits_in_window = EXCLUDED.visits_in_window,
  preview_until    = EXCLUDED.preview_until,
  updated_at       = now();

-- ── 2. Un lote de puntos ────────────────────────────────────────────────────
--
-- 2.000 puntos: alcanzan para canjear los dos premios reales del catálogo de
-- Monaco (Café y Coca, 2.000 pts cada uno) y que el revisor pueda probar el
-- canje de punta a punta, incluido el QR. El saldo se DERIVA de la suma de
-- `remaining` de los lotes vivos (no hay contador), así que con esta fila sola
-- alcanza. Vence en 2027 para que no se apague en medio de la revisión.

INSERT INTO public.point_transactions (
  client_id, organization_id, points, remaining, type, description, expires_at, meta
)
SELECT
  'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  2000, 2000, 'manual_adjust',
  'Cuenta demo App Review',
  timestamptz '2027-03-31 23:59:59-03',
  jsonb_build_object('demo_reviewer', true, 'creado', '2026-09-10')
WHERE NOT EXISTS (
  SELECT 1 FROM public.point_transactions
   WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'
     AND meta->>'demo_reviewer' = 'true'
);

-- ── 3. Bandeja de notificaciones ────────────────────────────────────────────
--
-- La campana del Home dibuja un badge con las no leídas y el revisor la va a
-- tocar. Con la bandeja vacía ve un estado vacío; con esto ve la pantalla real.
-- Van SIN `push_outbox`: son filas de bandeja, no se manda ningún push (además
-- hoy no hay ningún token FCM registrado en toda la base).

INSERT INTO public.client_notifications (
  client_id, organization_id, type, title, body, deep_link, is_read, created_at, data
)
SELECT * FROM (VALUES
  (
    'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'::uuid,
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
    'promo',
    'Bienvenido a Monaco',
    'Reservá tu turno, mirá la fila en vivo y sumá puntos en cada corte.',
    '/home',
    false,
    now() - interval '3 days',
    jsonb_build_object('demo_reviewer', true)
  ),
  (
    'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'::uuid,
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
    'points',
    'Sumaste 110 puntos',
    'Gracias por tu visita. Ya tenés puntos para canjear en Premios.',
    '/points',
    false,
    now() - interval '2 days',
    jsonb_build_object('demo_reviewer', true)
  ),
  (
    'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'::uuid,
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
    'reward',
    'Sos Cliente Oro',
    'Subiste de categoría: ahora sumás más puntos en cada corte.',
    '/categoria',
    true,
    now() - interval '1 day',
    jsonb_build_object('demo_reviewer', true)
  )
) AS v(client_id, organization_id, type, title, body, deep_link, is_read, created_at, data)
WHERE NOT EXISTS (
  SELECT 1 FROM public.client_notifications
   WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'
     AND data->>'demo_reviewer' = 'true'
);

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
--
--   SELECT tier_code, visits_in_window, preview_until
--     FROM client_loyalty_state
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71';
--
--   SELECT coalesce(sum(remaining), 0) AS saldo
--     FROM point_transactions
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'
--      AND remaining > 0 AND (expires_at IS NULL OR expires_at > now());
--   -- esperado: 2000
--
--   SELECT count(*) FROM client_notifications
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71';   -- esperado: 3

-- ── Revertir ────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   DELETE FROM public.client_notifications
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'
--      AND data->>'demo_reviewer' = 'true';
--   DELETE FROM public.point_transactions
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71'
--      AND meta->>'demo_reviewer' = 'true';
--   -- Ojo: si el revisor llegó a canjear un premio, ese lote tiene consumos en
--   -- `point_lot_consumptions` y el DELETE de arriba va a fallar por la FK. En
--   -- ese caso, primero: DELETE FROM client_rewards WHERE client_id = '…';
--   UPDATE public.client_loyalty_state SET preview_until = NULL
--    WHERE client_id = 'e8bd69f8-ebbe-4c6a-ace3-f926e9eb1a71';
-- COMMIT;
--
-- El `preview_until` en NULL alcanza para que la cuenta demo vuelva a
-- comportarse como cualquier otra: con el programa apagado deja de ver
-- categorías, y con el programa prendido su categoría sale de sus visitas
-- reales (que son cero).
