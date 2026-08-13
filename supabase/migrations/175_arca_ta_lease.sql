-- =============================================================================
-- 175_arca_ta_lease.sql
-- Corrige el mecanismo de exclusión mutua para pedir el Ticket de Acceso.
--
-- QUÉ ESTABA MAL (en la 174)
-- --------------------------
-- `arca_take_token_lock` tomaba `pg_advisory_xact_lock`. Un advisory lock de
-- transacción se libera al terminar la transacción — y una RPC llamada por
-- PostgREST ES una transacción que termina cuando la RPC retorna. O sea que el
-- lock moría en el mismo instante en que la app iba a usarlo, justo antes de
-- salir a la red a hablar con WSAA. Protegía exactamente nada.
--
-- El lock de sesión (`pg_advisory_lock`) tampoco sirve: PostgREST usa un pool
-- de conexiones, así que la sesión se devuelve al pool y el lock queda colgado
-- en una conexión que después atiende a cualquier otro.
--
-- QUÉ HACE AHORA
-- --------------
-- Un LEASE con vencimiento, que es el patrón correcto cuando el que se
-- coordina vive del otro lado de un request HTTP: una fila con `lease_until`,
-- tomada con un compare-and-set atómico (INSERT … ON CONFLICT DO UPDATE …
-- WHERE lease_until < now()). Si el proceso que la tomó se muere, el lease
-- vence solo y otro sigue. No hay lock que quede tomado para siempre.
--
-- El protocolo del lado de la app queda:
--   1. arca_ta_begin()  → o te devuelve un TA vigente, o te dice si te tocó
--                         salir a pedirlo.
--   2. si te tocó       → hablás con WSAA y llamás a arca_ta_store().
--   3. si no te tocó    → esperás un toque y volvés a leer; el otro lo guardó.
-- =============================================================================

DROP FUNCTION IF EXISTS arca_take_token_lock(text, text, integer);

CREATE TABLE IF NOT EXISTS arca_ta_leases (
  credential_key text NOT NULL,
  service        text NOT NULL DEFAULT 'wsfe',
  lease_until    timestamptz NOT NULL,
  holder         text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_key, service)
);

COMMENT ON TABLE arca_ta_leases IS
  'Lease con vencimiento para serializar el pedido de TA a WSAA entre instancias serverless.';

-- -----------------------------------------------------------------------------
-- arca_ta_begin — "¿hay TA? y si no, ¿me toca a mí ir a buscarlo?"
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_ta_begin(
  p_credential_key text,
  p_service        text    DEFAULT 'wsfe',
  p_margin_seconds integer DEFAULT 600,
  p_lease_seconds  integer DEFAULT 45,
  p_holder         text    DEFAULT NULL
)
RETURNS TABLE (
  token           text,
  sign            text,
  expiration_time timestamptz,
  lease_acquired  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tok  arca_auth_tokens%ROWTYPE;
  v_got  boolean := false;
BEGIN
  -- 1. ¿Ya hay un TA que sirva? Se pide con margen (10 min por default) para
  --    no arrancar una emisión con un token que vence en el medio.
  SELECT * INTO v_tok
  FROM arca_auth_tokens t
  WHERE t.credential_key = p_credential_key
    AND t.service = p_service
    AND t.expiration_time > now() + make_interval(secs => p_margin_seconds)
  LIMIT 1;

  IF FOUND THEN
    token           := v_tok.token;
    sign            := v_tok.sign;
    expiration_time := v_tok.expiration_time;
    lease_acquired  := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2. No hay. Compare-and-set del lease: gana uno solo.
  INSERT INTO arca_ta_leases (credential_key, service, lease_until, holder, updated_at)
  VALUES (p_credential_key, p_service, now() + make_interval(secs => p_lease_seconds), p_holder, now())
  ON CONFLICT (credential_key, service) DO UPDATE
    SET lease_until = EXCLUDED.lease_until,
        holder      = EXCLUDED.holder,
        updated_at  = now()
    WHERE arca_ta_leases.lease_until < now()
  RETURNING true INTO v_got;

  token           := NULL;
  sign            := NULL;
  expiration_time := NULL;
  lease_acquired  := COALESCE(v_got, false);
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION arca_ta_begin IS
  'Devuelve el TA vigente si lo hay; si no, indica si a este proceso le toca ir a pedirlo a WSAA.';

-- -----------------------------------------------------------------------------
-- arca_ta_store — guarda el TA recién obtenido y suelta el lease
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_ta_store(
  p_credential_key  text,
  p_service         text,
  p_token           text,
  p_sign            text,
  p_generation_time timestamptz,
  p_expiration_time timestamptz,
  p_taxpayer_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO arca_auth_tokens (
    credential_key, service, taxpayer_id, token, sign, generation_time, expiration_time
  ) VALUES (
    p_credential_key, p_service, p_taxpayer_id, p_token, p_sign, p_generation_time, p_expiration_time
  )
  ON CONFLICT (credential_key, service) DO UPDATE
    SET token           = EXCLUDED.token,
        sign            = EXCLUDED.sign,
        taxpayer_id     = EXCLUDED.taxpayer_id,
        generation_time = EXCLUDED.generation_time,
        expiration_time = EXCLUDED.expiration_time;

  -- Soltar el lease para que el próximo que necesite renovar no espere de gusto.
  UPDATE arca_ta_leases
     SET lease_until = now() - interval '1 second', updated_at = now()
   WHERE credential_key = p_credential_key AND service = p_service;
END;
$$;

COMMENT ON FUNCTION arca_ta_store IS 'Guarda el TA obtenido de WSAA y libera el lease.';

-- -----------------------------------------------------------------------------
-- arca_ta_release — soltar el lease cuando WSAA falló, para no bloquear 45 s
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_ta_release(
  p_credential_key text,
  p_service        text DEFAULT 'wsfe'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE arca_ta_leases
     SET lease_until = now() - interval '1 second', updated_at = now()
   WHERE credential_key = p_credential_key AND service = p_service;
$$;

ALTER TABLE arca_ta_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arca_ta_leases FROM anon, authenticated;
REVOKE ALL ON FUNCTION arca_ta_begin   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_ta_store   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION arca_ta_release FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_ta_begin   TO service_role;
GRANT EXECUTE ON FUNCTION arca_ta_store   TO service_role;
GRANT EXECUTE ON FUNCTION arca_ta_release TO service_role;
