-- ═══════════════════════════════════════════════════════════════════════════
-- 195 — Buscar conversaciones en TODO el historial del inbox
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El problema: `/dashboard/mensajeria` traía las conversaciones con un SELECT
-- sin `.limit()`, y **PostgREST corta en 1000 filas** (`max-rows`). Con 6.367
-- conversaciones en la org, el inbox mostraba sólo las 1000 más recientes —o
-- sea los últimos 10 días de 5 meses de historia— y el buscador filtraba en el
-- cliente sobre ESE array. Buscar a alguien que escribió en junio no devolvía
-- nada, y no había forma de llegar a esa conversación desde la UI.
--
-- Esta función es la mitad server-side del arreglo: busca contra la tabla
-- entera y devuelve ids. La otra mitad es la paginación de la lista, que va por
-- keyset sobre `last_message_at` (ver `loadMoreConversations`).
--
-- Reusa `norm_text` y `phone_tail` (mig 167), así la tolerancia es la misma que
-- en `/dashboard/clientes`: pliega acentos (el 17 % de los nombres tiene tilde,
-- "agustin" tiene que encontrar a "Agustín"), acepta los tokens del nombre en
-- cualquier orden y normaliza el teléfono ("+54 9 351 212-5249" == "2125249").
--
-- Además del cliente vinculado busca por `platform_user_name` /
-- `platform_user_id`: **una conversación puede no tener `client_id`** (alguien
-- que escribió al WhatsApp y todavía no es cliente), y ésas son justamente las
-- que uno busca por el nombre que muestra WhatsApp.

CREATE OR REPLACE FUNCTION public.search_conversations(
  p_organization_id uuid,
  p_query           text,
  p_limit           integer DEFAULT 50
)
RETURNS TABLE(id uuid, last_message_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      text;
  v_norm   text;
  v_digits text;
  v_tail   text;
  v_tokens text[];
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'search_conversations: p_organization_id es obligatorio';
  END IF;

  v_q := btrim(coalesce(p_query, ''));
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  -- Los comodines del input van escapados: sin esto, buscar "%%" devolvía el
  -- inbox entero (misma trampa que en `search_clients_page`, mig 167).
  v_norm   := replace(replace(replace(public.norm_text(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  v_tail   := right(v_digits, 10);
  v_tokens := ARRAY(
    SELECT t FROM unnest(string_to_array(v_norm, ' ')) AS t WHERE btrim(t) <> ''
  );

  RETURN QUERY
  SELECT conv.id, conv.last_message_at
  FROM public.conversations conv
  JOIN public.social_channels sc ON sc.id = conv.channel_id
  LEFT JOIN public.clients cl ON cl.id = conv.client_id
  WHERE
    -- Scope org: los canales son org-scope y pueden ser org-wide
    -- (`branch_id IS NULL`) o legacy por sucursal. Filtrar sólo por branch_id
    -- deja afuera los org-wide, que son la mayoría (Known Risk de la mig 103).
    (
      sc.organization_id = p_organization_id
      OR sc.branch_id IN (
        SELECT b.id FROM public.branches b
        WHERE b.organization_id = p_organization_id
      )
    )
    AND (
      -- Nombre: todos los tokens, en cualquier orden, sobre el nombre del
      -- cliente O el que muestra la plataforma.
      (
        cardinality(v_tokens) > 0
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tokens) AS tok
          WHERE public.norm_text(coalesce(cl.name, '')) NOT LIKE '%' || tok || '%'
        )
      )
      OR (
        cardinality(v_tokens) > 0
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tokens) AS tok
          WHERE public.norm_text(coalesce(conv.platform_user_name, '')) NOT LIKE '%' || tok || '%'
        )
      )
      -- Teléfono / identificador de la plataforma.
      OR (
        length(v_digits) >= 4
        AND (
          regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
          OR public.phone_tail(cl.phone) = v_tail
          OR regexp_replace(coalesce(conv.platform_user_id, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
        )
      )
    )
  ORDER BY conv.last_message_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.search_conversations(uuid, text, integer) IS
  'Busca conversaciones del inbox en TODO el historial (nombre del cliente o de '
  'la plataforma, teléfono, platform_user_id), con la misma tolerancia que '
  'quick_search_clients. Devuelve ids: el server action los hidrata con los '
  'embeds que espera la UI.';

-- Sólo service_role: es SECURITY DEFINER sin RLS de contención, así que
-- `p_organization_id` no se puede confiar del cliente — lo resuelve el server
-- action con `getCurrentOrgId()`. Mismo criterio que `search_clients_page`.
REVOKE ALL ON FUNCTION public.search_conversations(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_conversations(uuid, text, integer) TO service_role;

-- El inbox ordena y pagina por `last_message_at DESC NULLS LAST`. Sin índice,
-- cada página es un Seq Scan + Sort sobre 6.367 filas.
CREATE INDEX IF NOT EXISTS idx_conversations_channel_last_message
  ON public.conversations (channel_id, last_message_at DESC NULLS LAST);
