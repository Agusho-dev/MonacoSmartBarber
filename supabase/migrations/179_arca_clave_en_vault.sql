-- =============================================================================
-- 179_arca_clave_en_vault.sql
-- La clave maestra del facturador pasa a vivir en Supabase Vault.
--
-- POR QUÉ
-- -------
-- La clave privada del certificado fiscal se guarda cifrada con AES-256-GCM, y
-- esa clave de cifrado tiene que estar en algún lado. La primera opción fue una
-- variable de entorno del proyecto, pero no siempre se pueden agregar variables
-- nuevas. Vault es el otro lugar razonable, y este proyecto ya lo usa para
-- `app_base_url`, `cron_secret` y `service_role_key` (ver mig 087).
--
-- QUÉ SE GANA Y QUÉ SE PIERDE — dicho derecho
-- -------------------------------------------
-- Vault NO guarda el secreto en claro: `vault.secrets` tiene el blob cifrado y
-- la clave raíz la administra la plataforma FUERA de la base. O sea que un
-- `pg_dump`, un backup filtrado o alguien con acceso de lectura a las tablas
-- NO puede descifrar nada. Eso es lo importante y se mantiene igual que con la
-- variable de entorno.
--
-- Lo que sí cambia: con la variable de entorno hacían falta DOS accesos (la
-- base y el entorno de la app); ahora alcanza con la service role key, que es
-- la que abre la función de abajo. Es un factor menos. Se acepta porque esa
-- clave ya es la joya de la corona del sistema —saltea RLS en todas las tablas—
-- y porque la alternativa (dejar el certificado en claro, o derivar la clave de
-- la propia service role key) es peor: derivarla haría que rotar la service
-- role key destruyera todos los certificados guardados, en silencio.
--
-- SECURITY INVOKER a propósito
-- ----------------------------
-- La función corre con los permisos de QUIEN LA LLAMA, no con los del dueño.
-- `service_role` ya tiene SELECT sobre `vault.decrypted_secrets`, así que
-- funciona; y si mañana alguien le da EXECUTE a `anon` por error, la función
-- igual falla porque `anon` no puede leer Vault. Falla cerrado. Con SECURITY
-- DEFINER, ese mismo error entregaría la clave maestra.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El secreto — lo genera la BASE, no viene escrito acá
--
-- 32 bytes aleatorios de `gen_random_bytes`. El valor nunca aparece en este
-- archivo, ni en un log, ni en el historial de nadie.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'arca_encryption_key') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'arca_encryption_key',
      'Clave maestra AES-256-GCM del facturador ARCA. Cifra arca_taxpayers.private_key_enc. Si se pierde o se rota, hay que regenerar los certificados.'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. La puerta de lectura
--
-- Vive en `public` porque el esquema `vault` no está expuesto a PostgREST — y
-- no hay que exponerlo: ahí adentro están TODOS los secretos del proyecto, no
-- sólo éste.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arca_get_encryption_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'arca_encryption_key'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.arca_get_encryption_key() IS
  'Devuelve la clave maestra del facturador desde Vault. SECURITY INVOKER: sólo funciona para roles que ya pueden leer Vault.';

REVOKE ALL ON FUNCTION public.arca_get_encryption_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arca_get_encryption_key() TO service_role;
