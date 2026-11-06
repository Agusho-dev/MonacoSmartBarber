-- =============================================================================
-- 237_por_responder.sql — «Por responder» en Mensajería (6/nov/2026)
--
-- Pedido del dueño: «la idea es que aparezcan cards tipo tinder y que te
-- aparezca para responder… las reseñas malas y las preguntas que queden sin
-- responder… que salte notificaciones».
--
-- Lo que había: «Alertas» (crm_alerts) y «Casos» (crm_cases). Al 6/nov/2026:
--   - crm_cases: 1 caso en toda la historia (de prueba, marzo). Lo creaba
--     submit_client_review sobre client_reviews, que está vacía: las reseñas
--     reales viven en el motor de WhatsApp (memoria reference_review_analytics_chain).
--   - crm_alerts: 307 sin leer y la última leída el 26/jun. Son dos cosas:
--     «Cliente Insatisfecho» (urgent, los workflows de reseñas con nota 1–3) y
--     «Responder Duda» (warning, Bienvenida: el cliente tocó «Sí» a «¿Tenés
--     otra consulta?»). Medido: en las 234 dudas el cliente escribió su
--     pregunta después y nadie la contestó a mano.
--
-- Esta migración (aditiva, no toca nada existente):
--   1. mensajeria_atencion: «ya la atendí» por conversación (el «Listo» de la
--      bandeja). Una consulta vuelve a aparecer sola si el cliente escribe
--      después de atendida_hasta.
--   2. mensajeria_pendientes(): una fila por conversación que espera a alguien
--      (reseña baja sin atender, o el cliente escribió lo último y nadie le
--      contestó), con el hilo corto, la visita y el barbero. Sólo service_role.
--   3. push_claves, push_suscripciones y mensajeria_avisos: los avisos push
--      (Web Push con VAPID, src/lib/push/*). El cron que los manda es la 237b,
--      que va DESPUÉS del deploy (Known Risk #26).
--
-- Todas las tablas: RLS prendida y CERO policies (sólo el servidor, con
-- service role), como las de rrhh (213) y las del programa de fidelización.
--
-- APLICADA en prod el 6/nov/2026 en dos pasos (MCP): primero el archivo entero
-- y, enseguida, `237_por_responder_sin_ruido` con el mismo cuerpo de la función
-- que queda acá (sin reacciones ni menciones). Este archivo es el estado final.
--
-- ROLLBACK (no borra nada de lo que ya existía):
--   drop function if exists public.mensajeria_pendientes(uuid, uuid[], int);
--   drop table if exists public.mensajeria_avisos, public.push_suscripciones,
--     public.push_claves, public.mensajeria_atencion;
-- =============================================================================

-- ── 1. La atención de cada conversación ──────────────────────────────────────

create table if not exists public.mensajeria_atencion (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Todo lo que el cliente escribió hasta acá ya está atendido.
  atendida_hasta  timestamptz not null,
  -- 'respondida' (salió un mensaje de una persona) o 'listo' (no necesitaba respuesta).
  como            text not null check (como in ('respondida', 'listo')),
  -- auth.users.id de quien la atendió (sin FK: hay dueños que no tienen fila en staff).
  atendida_por    uuid,
  updated_at      timestamptz not null default now()
);

comment on table public.mensajeria_atencion is
  'Por responder (mig 237): hasta cuándo está atendida cada conversación. Una consulta reaparece si el cliente escribe después de atendida_hasta.';

alter table public.mensajeria_atencion enable row level security;
revoke all on public.mensajeria_atencion from anon, authenticated;

-- ── 2. Las claves VAPID (una sola fila) ──────────────────────────────────────

create table if not exists public.push_claves (
  id              boolean primary key default true check (id),
  -- La pública en base64url (65 bytes, punto sin comprimir de P-256). No es secreta.
  publica         text not null,
  -- La privada (d de la JWK, base64url) cifrada con cifrarSecreto (src/lib/crypto/secretos.ts).
  privada_cifrada text not null,
  creada_at       timestamptz not null default now()
);

comment on table public.push_claves is
  'Claves VAPID de los avisos push (mig 237). La genera el servidor la primera vez (src/lib/push/claves.ts). Cambiarla invalida TODAS las suscripciones.';

alter table public.push_claves enable row level security;
revoke all on public.push_claves from anon, authenticated;

-- ── 3. Las suscripciones (un dispositivo = una fila) ─────────────────────────

create table if not exists public.push_suscripciones (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  auth_user_id      uuid not null,
  endpoint          text not null unique,
  p256dh            text not null,
  auth              text not null,
  -- Las sucursales que veía la persona al suscribirse (null = todas): una reseña
  -- de Caseros no le llega a quien sólo ve Rondeau.
  sucursales        uuid[],
  avisar_resenas    boolean not null default true,
  avisar_consultas  boolean not null default true,
  -- «iPhone · app instalada»: para reconocerla en la lista.
  dispositivo       text,
  creada_at         timestamptz not null default now(),
  actualizada_at    timestamptz not null default now(),
  ultimo_ok_at      timestamptz,
  fallas            int not null default 0,
  ultimo_error      text
);

create index if not exists push_suscripciones_org_idx on public.push_suscripciones (organization_id);
create index if not exists push_suscripciones_usuario_idx on public.push_suscripciones (auth_user_id);

comment on table public.push_suscripciones is
  'Avisos push de Mensajería (mig 237): una fila por navegador/dispositivo. Una respuesta 404/410 del servicio de push la borra.';

alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;

-- ── 4. Lo que ya se avisó (para no repetir) ──────────────────────────────────

create table if not exists public.mensajeria_avisos (
  -- 'resena:<alerta>', 'consulta:<conversación>:<epoch del primer mensaje que espera>',
  -- 'recordatorio:<org>:<bloque de 45 min>'…: la ruta del cron arma la clave.
  clave           text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enviado_at      timestamptz not null default now()
);

create index if not exists mensajeria_avisos_org_idx on public.mensajeria_avisos (organization_id, enviado_at desc);

alter table public.mensajeria_avisos enable row level security;
revoke all on public.mensajeria_avisos from anon, authenticated;

-- ── 5. Lo que espera una respuesta ───────────────────────────────────────────
--
-- Una fila por conversación de los canales dados, de los últimos p_dias días:
--   - 'resena': tiene una alerta SIN LEER de un workflow de reseñas (post-servicio
--     o respuesta a plantilla) o con la nota tocada (1–5). Está pendiente hasta
--     que alguien la atienda en la bandeja o le conteste a mano (sendMessage
--     marca las alertas como leídas).
--   - 'consulta': el último mensaje del CLIENTE que no es un botón (texto, foto,
--     audio…) es posterior a la última salida que no falló y a atendida_hasta.
--     No cuentan las marcas que guardan los webhooks en vez de un mensaje:
--     «[Reacción: …]», «[Mención en Historia]» (106 en 30 días, de Instagram),
--     «[Sticker]», «[Adjunto: unsupported]» y «[template]». Los «gracias» y
--     «listo» sí vienen: la interfaz los reconoce y los manda al final
--     (src/lib/mensajeria/por-responder.ts, esCierreDeCharla).
--     Los mensajes automáticos cuentan como respuesta si salieron DESPUÉS de la
--     pregunta (el «¿en qué te puedo ayudar?» de Bienvenida sale antes y no la
--     tapa: así quedaron sin contestar las 234 dudas).
-- Las vencidas (can_reply_until pasado) vienen igual: la interfaz las separa.

create or replace function public.mensajeria_pendientes(
  p_org     uuid,
  p_canales uuid[],
  p_dias    int default 7
)
returns table (
  conversation_id    uuid,
  tipo               text,
  plataforma         text,
  client_id          uuid,
  nombre             text,
  telefono           text,
  usuario_ig         text,
  avatar_url         text,
  calificacion       int,
  calificacion_final int,
  alerta_ids         uuid[],
  pidio_humano       boolean,
  esperando_desde    timestamptz,
  ultimo_entrante_at timestamptz,
  can_reply_until    timestamptz,
  visita_at          timestamptz,
  barbero            text,
  sucursal_id        uuid,
  sucursal           text,
  servicio           text,
  visitas_totales    int,
  hilo               jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ventana as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_dias, 7), 30))) as desde
  ),
  -- Las alertas sin leer de la ventana, con su workflow (para saber si es una reseña).
  al as (
    select a.id, a.conversation_id, a.created_at, a.workflow_execution_id,
           nullif(a.metadata->>'button_pressed', '') as boton,
           (
             w.trigger_type in ('post_service', 'template_reply')
             or coalesce(a.metadata->>'button_pressed', '') ~ '^[1-5]$'
           ) as es_resena
      from crm_alerts a
      left join automation_workflows w
        on w.id = case
                    when coalesce(a.metadata->>'workflow_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (a.metadata->>'workflow_id')::uuid
                  end
     where a.organization_id = p_org
       and a.is_read is not true
       and a.conversation_id is not null
       and a.created_at >= (select desde from ventana)
  ),
  al_conv as (
    select al.conversation_id,
           array_agg(al.id order by al.created_at) as ids,
           bool_or(al.es_resena) as hay_resena,
           bool_or(not al.es_resena) as pidio_humano,
           -- La primera reseña de la ventana manda (nota, ejecución y hora).
           (array_agg(al.id order by al.created_at) filter (where al.es_resena))[1] as resena_id,
           min(al.created_at) filter (where al.es_resena) as resena_at
      from al
     group by al.conversation_id
  ),
  cand as (
    select c.id, c.client_id, c.platform_user_id, c.platform_user_name, c.platform_user_handle,
           c.platform_user_avatar, c.can_reply_until, c.last_inbound_at, ch.platform
      from conversations c
      join social_channels ch on ch.id = c.channel_id
     where c.channel_id = any (p_canales)
       and (
         c.last_inbound_at >= (select desde from ventana)
         or c.id in (select conversation_id from al_conv)
       )
  ),
  estado as (
    select cand.*,
           ac.ids as alerta_ids,
           coalesce(ac.hay_resena, false) as hay_resena,
           coalesce(ac.pidio_humano, false) as pidio_humano,
           ac.resena_id,
           ac.resena_at,
           ult_cli.created_at as ult_cliente,
           greatest(ult_sal.created_at, at.atendida_hasta) as base
      from cand
      left join al_conv ac on ac.conversation_id = cand.id
      left join mensajeria_atencion at on at.conversation_id = cand.id
      -- Lo último que escribió el cliente que no es tocar un botón.
      left join lateral (
        select m.created_at
          from messages m
         where m.conversation_id = cand.id
           and m.direction = 'inbound'
           and coalesce(m.content_type, 'text') <> 'interactive'
           and coalesce(m.content, '') !~ '^\[(Reacción|Mención en Historia|Sticker|Adjunto|template)'
         order by m.created_at desc
         limit 1
      ) ult_cli on true
      -- Lo último que salió (un envío fallido no es una respuesta).
      left join lateral (
        select m.created_at
          from messages m
         where m.conversation_id = cand.id
           and m.direction = 'outbound'
           and coalesce(m.status, '') <> 'failed'
         order by m.created_at desc
         limit 1
      ) ult_sal on true
  ),
  pend as (
    select e.*,
           case
             when e.hay_resena then 'resena'
             else 'consulta'
           end as tipo
      from estado e
     where e.hay_resena
        or (
          e.ult_cliente is not null
          and e.ult_cliente >= (select desde from ventana)
          and e.ult_cliente > coalesce(e.base, '-infinity'::timestamptz)
        )
  )
  select p.id,
         p.tipo,
         p.platform,
         p.client_id,
         coalesce(nullif(btrim(cl.name), ''), nullif(btrim(p.platform_user_name), ''), nullif(btrim(p.platform_user_handle), ''), p.platform_user_id),
         case when p.platform = 'whatsapp' then p.platform_user_id end,
         p.platform_user_handle,
         p.platform_user_avatar,
         nota.inicial,
         nota.final,
         p.alerta_ids,
         p.pidio_humano,
         case
           when p.tipo = 'resena' then p.resena_at
           else espera.desde
         end,
         p.ult_cliente,
         p.can_reply_until,
         vis.started_at,
         vis.barbero,
         vis.branch_id,
         vis.sucursal,
         vis.servicio,
         lo.total_visits,
         coalesce(hilo.mensajes, '[]'::jsonb)
    from pend p
    left join clients cl on cl.id = p.client_id
    left join client_loyalty_state lo on lo.client_id = p.client_id
    -- Desde cuándo espera: el primer mensaje del cliente sin contestar.
    left join lateral (
      select min(m.created_at) as desde
        from messages m
       where m.conversation_id = p.id
         and m.direction = 'inbound'
         and coalesce(m.content_type, 'text') <> 'interactive'
         and coalesce(m.content, '') !~ '^\[(Reacción|Mención en Historia|Sticker|Adjunto|template)'
         and m.created_at > coalesce(p.base, '-infinity'::timestamptz)
    ) espera on true
    -- La nota: la del botón de la alerta y, si después tocó otro número en los
    -- 15 minutos siguientes, ese (pasa: «1» y al segundo «5»).
    left join lateral (
      select case when a.boton ~ '^[1-5]$' then a.boton::int end as inicial,
             (
               select m.content::int
                 from messages m
                where m.conversation_id = p.id
                  and m.direction = 'inbound'
                  and m.content_type = 'interactive'
                  and btrim(coalesce(m.content, '')) ~ '^[1-5]$'
                  and m.created_at between a.created_at - interval '1 minute' and a.created_at + interval '15 minutes'
                order by m.created_at desc
                limit 1
             ) as final
        from al a
       where a.id = p.resena_id
    ) nota on true
    -- La visita: en una reseña, la del pedido de reseña (ejecución → mensaje
    -- programado → visit_id, la cadena de tex_resenas_whatsapp, mig 231); en
    -- una consulta, la última visita del cliente.
    left join lateral (
      select v.started_at, s.full_name as barbero, v.branch_id, b.name as sucursal, sv.name as servicio
        from visits v
        left join staff s on s.id = v.barber_id
        left join branches b on b.id = v.branch_id
        left join services sv on sv.id = v.service_id
       where v.id = coalesce(
               (
                 select case
                          when sm.workflow_trigger_data->>'visit_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then (sm.workflow_trigger_data->>'visit_id')::uuid
                        end
                   from al a
                   join workflow_executions we on we.id = a.workflow_execution_id
                   join scheduled_messages sm
                     on sm.client_id = p.client_id
                    and sm.workflow_id = we.workflow_id
                    and sm.sent_at between we.started_at - interval '30 seconds' and we.started_at + interval '30 seconds'
                  where a.id = p.resena_id
                  order by abs(extract(epoch from (sm.sent_at - we.started_at)))
                  limit 1
               ),
               (
                 select v2.id
                   from visits v2
                  where p.client_id is not null
                    and v2.client_id = p.client_id
                  order by v2.started_at desc
                  limit 1
               )
             )
    ) vis on true
    -- El hilo corto: los últimos 10 mensajes, del más viejo al más nuevo.
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id', x.id,
                 'dir', x.direction,
                 'tipo', x.content_type,
                 'texto', left(x.content, 700),
                 'plantilla', x.template_name,
                 'media', x.media_url,
                 'estado', x.status,
                 'at', x.created_at
               )
               order by x.created_at
             ) as mensajes
        from (
          select m.id, m.direction, m.content_type, m.content, m.template_name, m.media_url, m.status, m.created_at
            from messages m
           where m.conversation_id = p.id
           order by m.created_at desc
           limit 10
        ) x
    ) hilo on true
   limit 150;
$$;

comment on function public.mensajeria_pendientes(uuid, uuid[], int) is
  'Por responder (mig 237): las conversaciones que esperan a una persona (reseña baja sin atender o consulta sin contestar) de los canales dados. Sólo service_role; la org y los canales los pone el servidor (alcanceDeMensajeria).';

revoke all on function public.mensajeria_pendientes(uuid, uuid[], int) from public, anon, authenticated;
grant execute on function public.mensajeria_pendientes(uuid, uuid[], int) to service_role;
