-- ============================================================================
-- 202 — Fidelización: el texto de las tarjetas es SIEMPRE blanco
-- ============================================================================
-- Decisión del dueño (30/ago/2026, viendo la tarjeta Oro en su iPhone): las
-- letras nunca van negras. Para que el blanco se lea sobre toda la tarjeta,
-- el extremo claro del dorado y del plateado se oscurece un poco (el
-- gradiente 135° termina abajo a la derecha, justo donde va "MIEMBRO DESDE").
-- Aplica al seed (orgs nuevas) y a los datos de Monaco.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.loyalty_seed_org(p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO loyalty_settings (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO loyalty_tiers (organization_id, code, name, sort_order, min_visits, max_visits, multiplier_pct, color_primary, color_secondary, text_color, benefits) VALUES
    (p_org, 'bronce',   'Bronce',   1, 0, 2,    100, '#7A4A22', '#C78A4E', '#FFFFFF', ARRAY['Sumás puntos en cada visita', 'Acceso al catálogo de premios']),
    (p_org, 'plata',    'Plata',    2, 3, 5,    105, '#3E444D', '#A9B1BA', '#FFFFFF', ARRAY['5 % más de puntos por visita', 'Premios exclusivos Plata']),
    (p_org, 'oro',      'Oro',      3, 6, 8,    110, '#7A5A12', '#D8AE3C', '#FFFFFF', ARRAY['10 % más de puntos por visita', 'Premios exclusivos Oro', 'Prioridad en novedades']),
    (p_org, 'platinum', 'Platinum', 4, 9, NULL, 115, '#0B0B0D', '#3A3A44', '#FFFFFF', ARRAY['15 % más de puntos por visita', 'Premios exclusivos Platinum', 'Beneficios en comercios asociados'])
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO loyalty_notification_rules (organization_id, kind, is_enabled, title, body, days_before, deep_link, sort_order) VALUES
    (p_org, 'tier_up',                      true,  '¡Llegaste a Cliente {{categoria}}!',                  'Ahora sumás puntos al {{multiplicador}} % en cada visita. Seguí así.',            NULL, '/categoria', 10),
    (p_org, 'near_tier',                    true,  'Te falta una visita para {{categoria_siguiente}}',    'Ya tenés {{visitas}} visitas recientes. Una más y subís de categoría.',            NULL, '/categoria', 20),
    (p_org, 'tier_grace_warning',           true,  'Tu nivel {{categoria}} está por vencer',              'Realizá una visita antes del {{fecha}} para mantener tu categoría.',               NULL, '/categoria', 30),
    (p_org, 'tier_grace_reminder',          true,  'Tenés {{dias}} días para mantener tu nivel {{categoria}}', 'Una visita alcanza para seguir siendo Cliente {{categoria}}.',                 3,    '/categoria', 40),
    (p_org, 'tier_down',                    true,  'Tu categoría cambió a {{categoria}}',                 'Tus puntos siguen intactos. Volvé pronto para recuperar tu nivel.',                NULL, '/categoria', 50),
    (p_org, 'points_earned',                false, 'Sumaste {{puntos}} puntos',                           'Ya tenés {{saldo}} puntos para canjear en la app.',                                NULL, '/points',    60),
    (p_org, 'points_expiring',              true,  'Tenés {{puntos}} puntos que vencen en {{dias}} días', 'Canjealos antes del {{fecha}} para no perderlos.',                                 14,   '/points',    70),
    (p_org, 'reward_unlocked',              true,  'Ya podés canjear {{premio}}',                         'Tenés {{saldo}} puntos. Entrá a la app y canjealo.',                               NULL, '/rewards',   80),
    (p_org, 'near_reward',                  true,  'Te faltan {{faltan}} puntos para {{premio}}',         'Estás cerca. Tu próxima visita te acerca al premio.',                              NULL, '/rewards',   90),
    (p_org, 'benefit_new',                  true,  'Tenés un nuevo beneficio disponible',                 '{{premio}} ya está en Mis premios. Mostrá el QR en la barbería antes del {{fecha}}.', NULL, '/mis-premios', 100),
    (p_org, 'referral_completed_referrer',  true,  'Tu recomendación se completó',                        '{{nombre_amigo}} ya se cortó en Monaco. Sumaste {{puntos}} puntos.',               NULL, '/invitar',   110),
    (p_org, 'referral_completed_referred',  true,  'Bienvenido a Monaco',                                 'Ya tenés tus primeros {{puntos}} puntos. Mirá los premios en la app.',             NULL, '/rewards',   120)
  ON CONFLICT (organization_id, kind) DO NOTHING;
END; $$;

-- Datos de Monaco: texto blanco en las 4 y extremos claros oscurecidos.
UPDATE public.loyalty_tiers SET text_color = '#FFFFFF', updated_at = now()
 WHERE organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
UPDATE public.loyalty_tiers SET color_secondary = '#D8AE3C', updated_at = now()
 WHERE organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AND code = 'oro' AND color_secondary = '#F2CC5B';
UPDATE public.loyalty_tiers SET color_secondary = '#A9B1BA', updated_at = now()
 WHERE organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AND code = 'plata' AND color_secondary = '#C9CFD6';
