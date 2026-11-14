-- =============================================================================
-- 239 · «Corte Final»: el PIN de los dueños (14/nov/2026)
--
-- Pedido del dueño: «Que dentro del juego haya que hacer algo y poner un pin
-- para jugar como dueño». En la portada del juego, 5 toques al logo de Monaco
-- abren un teclado; con el PIN, el servidor (`canjearPinDuenos`,
-- src/lib/actions/juego.ts) devuelve el mismo pase de dueños que da el
-- dashboard (src/lib/juego/pase.ts). Un PIN por organización, compartido por
-- los 4 dueños; lo ponen y lo cambian desde Configuración → «Corte Final»
-- (`guardarPinDuenos`, src/lib/actions/juego-config.ts, con settings.manage).
--
-- NO va en app_settings: anon la lee entera (Known Risk #36) y el hash de un
-- PIN de 6 dígitos se rompe offline en segundos. Esta tabla la lee y la
-- escribe SÓLO el service role: RLS prendida y sin policies, y sin grants para
-- anon ni authenticated.
--
-- pin_hash: `scrypt$<sal>$<hash>` (base64url; la sal es propia de cada fila).
-- Lo arma y lo verifica src/lib/juego/pin-duenos.ts (crypto.scrypt y
-- timingSafeEqual). El PIN nunca se guarda ni se loguea.
--
-- Cambiar el PIN NO anula los pases que ya se dieron (son sin estado y valen
-- 90 días): para anularlos todos, `:v1` → `:v2` en src/lib/juego/pase.ts.
--
-- Idempotente y autosuficiente: sólo necesita public.organizations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.juego_pin_duenos (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  pin_hash        text        NOT NULL,
  -- auth.users.id de quien lo puso o lo cambió. Sin FK a propósito: dar de
  -- baja esa cuenta no tiene que borrar el PIN ni trabar el borrado. Es también
  -- el `u` de los pases que se canjean con este PIN.
  actualizado_por uuid        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- El formato del hash: lo que no salga de pin-duenos.ts no entra.
DO $migracion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'juego_pin_duenos_formato_hash'
      AND conrelid = 'public.juego_pin_duenos'::regclass
  ) THEN
    ALTER TABLE public.juego_pin_duenos
      ADD CONSTRAINT juego_pin_duenos_formato_hash
      CHECK (pin_hash ~ '^scrypt[$][A-Za-z0-9_-]{16,}[$][A-Za-z0-9_-]{32,}$');
  END IF;
END
$migracion$;

-- Sólo el service role. Sin policies: con RLS prendida, cualquier otro rol ve
-- cero filas aunque alguien le devuelva un grant por error.
ALTER TABLE public.juego_pin_duenos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.juego_pin_duenos FROM PUBLIC;
REVOKE ALL ON TABLE public.juego_pin_duenos FROM anon;
REVOKE ALL ON TABLE public.juego_pin_duenos FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.juego_pin_duenos TO service_role;

COMMENT ON TABLE public.juego_pin_duenos IS
  'PIN de dueños de «Corte Final» (uno por organización). Sólo service role. pin_hash = scrypt$<sal>$<hash>. Ver src/lib/juego/pin-duenos.ts.';
COMMENT ON COLUMN public.juego_pin_duenos.actualizado_por IS
  'auth.users.id de quien lo puso o lo cambió (sin FK a propósito). Va como `u` en los pases canjeados con este PIN.';
