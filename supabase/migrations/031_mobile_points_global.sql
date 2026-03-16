-- ============================================================
-- 031: Billetera global de puntos + función de redención cliente
-- ============================================================

-- Vista: saldo global de puntos (suma de todas las sucursales)
CREATE OR REPLACE VIEW client_points_global AS
SELECT
  client_id,
  SUM(points_balance)  AS global_balance,
  SUM(total_earned)    AS global_earned,
  SUM(total_redeemed)  AS global_redeemed,
  MAX(updated_at)      AS last_updated
FROM client_points
GROUP BY client_id;

-- ============================================================
-- Función: client_redeem_points
-- Permite al cliente (autenticado) canjear un item del catálogo
-- por puntos. Genera un client_reward con QR para validar en caja.
-- Estrategia de deducción: descuenta del bucket de mayor saldo.
-- ============================================================
CREATE OR REPLACE FUNCTION client_redeem_points(
  p_catalog_id  UUID,
  p_branch_id   UUID    -- sucursal donde se presentará el QR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client           clients%ROWTYPE;
  v_catalog          reward_catalog%ROWTYPE;
  v_global_balance   INTEGER;
  v_top_bucket_id    UUID;
  v_top_bucket_bal   INTEGER;
  v_client_reward_id UUID;
BEGIN
  -- Verificar cliente autenticado
  SELECT * INTO v_client FROM clients WHERE auth_user_id = auth.uid();
  IF v_client IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;

  -- Verificar item del catálogo canjeble por puntos
  SELECT * INTO v_catalog
  FROM reward_catalog
  WHERE id = p_catalog_id
    AND is_active = true
    AND points_cost IS NOT NULL
    AND points_cost > 0
    AND (valid_from IS NULL OR valid_from <= now())
    AND (valid_until IS NULL OR valid_until >= now());

  IF v_catalog IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Item no disponible para canje por puntos');
  END IF;

  -- Verificar saldo global suficiente
  SELECT COALESCE(SUM(points_balance), 0)
  INTO v_global_balance
  FROM client_points
  WHERE client_id = v_client.id;

  IF v_global_balance < v_catalog.points_cost THEN
    RETURN json_build_object(
      'success',  false,
      'error',    'Puntos insuficientes',
      'balance',  v_global_balance,
      'required', v_catalog.points_cost
    );
  END IF;

  -- Obtener bucket de mayor saldo para descontar
  SELECT id, points_balance
  INTO v_top_bucket_id, v_top_bucket_bal
  FROM client_points
  WHERE client_id = v_client.id
  ORDER BY points_balance DESC
  LIMIT 1;

  -- Crear client_reward (con QR auto-generado)
  INSERT INTO client_rewards (client_id, reward_id, source)
  VALUES (v_client.id, p_catalog_id, 'points_redemption')
  RETURNING id INTO v_client_reward_id;

  -- Descontar puntos del bucket de mayor saldo
  UPDATE client_points
  SET
    points_balance = points_balance - v_catalog.points_cost,
    total_redeemed = total_redeemed + v_catalog.points_cost,
    updated_at     = now()
  WHERE id = v_top_bucket_id;

  -- Registrar transacción
  INSERT INTO point_transactions (client_id, points, type, description)
  VALUES (
    v_client.id,
    -v_catalog.points_cost,
    'redeemed',
    'Canje: ' || v_catalog.name
  );

  RETURN json_build_object(
    'success',          true,
    'client_reward_id', v_client_reward_id,
    'reward_name',      v_catalog.name,
    'points_spent',     v_catalog.points_cost,
    'remaining_balance', v_global_balance - v_catalog.points_cost
  );
END;
$$;
