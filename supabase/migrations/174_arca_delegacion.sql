-- =============================================================================
-- 174_arca_delegacion.sql
-- Segundo modelo de autenticación contra ARCA: DELEGACIÓN.
--
-- Contexto: hay dos formas de que una app facture en nombre de un contribuyente.
--
--   A) certificado_propio — el contribuyente genera su certificado y lo carga
--      acá. Funciona siempre, no depende de nada de la plataforma, y es el
--      camino natural cuando la barbería es el mismo dueño del sistema.
--
--   B) delegacion — la PLATAFORMA tiene un CUIT y un certificado, y cada
--      contribuyente la autoriza desde el "Administrador de Relaciones de
--      Clave Fiscal". El cliente no toca un archivo en su vida: entra a ARCA,
--      elige el servicio "Facturación Electrónica", pega un CUIT y confirma.
--      Es lo que hacen Facturante (o sea Tiendanube, Mercado Pago Point y
--      Alegra Argentina), Fudo, Contabilium y Colppy.
--
-- La diferencia técnica es chica y vale la pena entenderla: el Ticket de Acceso
-- de WSAA se pide con el CERTIFICADO, y adentro del token viaja la lista de
-- CUITs que ese certificado puede representar. El CUIT del contribuyente viaja
-- aparte, en `Auth.Cuit` de cada llamada a WSFEv1. Consecuencia práctica:
--
--   >>> UN SOLO TA sirve para TODOS los clientes delegados. <<<
--
-- Por eso el cache de tokens deja de estar indexado por contribuyente y pasa a
-- estarlo por CREDENCIAL. Con el índice viejo, diez organizaciones delegadas
-- hubieran pedido diez TA con el mismo certificado y ARCA habría contestado
-- `coe.alreadyAuthenticated` a nueve — que además obliga a esperar 2 minutos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Credenciales de la PLATAFORMA (no pertenecen a ninguna organización)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arca_platform_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment     text NOT NULL UNIQUE
                    CHECK (environment IN ('homologacion', 'produccion')),

  cuit            text NOT NULL CHECK (cuit ~ '^[0-9]{11}$'),
  razon_social    text,

  private_key_enc text,
  csr_pem         text,
  certificate_pem text,
  cert_alias      text,
  cert_not_before timestamptz,
  cert_not_after  timestamptz,

  is_enabled      boolean NOT NULL DEFAULT false,
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_arca_platform_credentials_updated ON arca_platform_credentials;
CREATE TRIGGER trg_arca_platform_credentials_updated
  BEFORE UPDATE ON arca_platform_credentials
  FOR EACH ROW EXECUTE FUNCTION arca_touch_updated_at();

COMMENT ON TABLE arca_platform_credentials IS
  'Certificado de la plataforma para el modo delegación. Una fila por ambiente. Sin organization_id a propósito: es de la plataforma, no de un cliente.';

-- -----------------------------------------------------------------------------
-- 2. El contribuyente elige su modo
-- -----------------------------------------------------------------------------
ALTER TABLE arca_taxpayers
  ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'certificado_propio';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'arca_taxpayers_auth_mode_check'
  ) THEN
    ALTER TABLE arca_taxpayers
      ADD CONSTRAINT arca_taxpayers_auth_mode_check
      CHECK (auth_mode IN ('certificado_propio', 'delegacion'));
  END IF;
END $$;

COMMENT ON COLUMN arca_taxpayers.auth_mode IS
  'certificado_propio = el certificado está en esta fila. delegacion = se usa el de arca_platform_credentials y este CUIT viaja en Auth.Cuit.';

-- -----------------------------------------------------------------------------
-- 3. El cache del TA pasa a indexarse por CREDENCIAL, no por contribuyente
--
-- `credential_key` es:
--   'taxpayer:<uuid>'   cuando el certificado es del propio contribuyente
--   'platform:<env>'    cuando se usa el de la plataforma (todos comparten TA)
-- -----------------------------------------------------------------------------
ALTER TABLE arca_auth_tokens
  ADD COLUMN IF NOT EXISTS credential_key text;

-- Backfill para cualquier fila previa (en la práctica la tabla está vacía).
UPDATE arca_auth_tokens
   SET credential_key = 'taxpayer:' || taxpayer_id::text
 WHERE credential_key IS NULL;

ALTER TABLE arca_auth_tokens
  ALTER COLUMN credential_key SET NOT NULL;

-- El contribuyente deja de ser obligatorio: un TA de plataforma no es de nadie.
ALTER TABLE arca_auth_tokens
  ALTER COLUMN taxpayer_id DROP NOT NULL;

ALTER TABLE arca_auth_tokens
  DROP CONSTRAINT IF EXISTS arca_auth_tokens_taxpayer_id_service_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_auth_tokens_credencial
  ON arca_auth_tokens (credential_key, service);

COMMENT ON COLUMN arca_auth_tokens.credential_key IS
  'taxpayer:<uuid> | platform:<env>. El TA es del CERTIFICADO, no del contribuyente: en delegación uno solo sirve para todos.';

-- -----------------------------------------------------------------------------
-- 4. Serializar el pedido de TA entre instancias serverless
--
-- Dos lambdas que piden TA a la vez con el mismo certificado producen
-- `coe.alreadyAuthenticated` y dejan a la caja sin facturar durante 2 minutos.
-- Esta función toma un lock por credencial y devuelve el TA vigente si otro
-- proceso ya lo renovó mientras esperábamos.
--
-- Devuelve NULL si hay que ir a buscar uno nuevo a WSAA — y en ese caso el
-- lock ya quedó tomado hasta el fin de la transacción de quien la llamó.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arca_take_token_lock(
  p_credential_key text,
  p_service        text DEFAULT 'wsfe',
  p_margin_seconds integer DEFAULT 600
)
RETURNS TABLE (token text, sign text, expiration_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('arca_ta:' || p_credential_key || ':' || p_service, 0)
  );

  RETURN QUERY
  SELECT t.token, t.sign, t.expiration_time
  FROM arca_auth_tokens t
  WHERE t.credential_key = p_credential_key
    AND t.service = p_service
    AND t.expiration_time > now() + make_interval(secs => p_margin_seconds);
END;
$$;

COMMENT ON FUNCTION arca_take_token_lock IS
  'Toma el lock por credencial y devuelve el TA vigente si lo hay. Evita el coe.alreadyAuthenticated entre instancias.';

-- -----------------------------------------------------------------------------
-- 5. Seguridad (mismo criterio que la 173)
-- -----------------------------------------------------------------------------
ALTER TABLE arca_platform_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arca_platform_credentials FROM anon, authenticated;
REVOKE ALL ON FUNCTION arca_take_token_lock FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_take_token_lock TO service_role;
