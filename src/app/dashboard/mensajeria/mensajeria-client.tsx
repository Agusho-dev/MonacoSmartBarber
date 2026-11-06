'use client'

// Mensajería como WhatsApp (23/oct/2026, pedido del dueño: "quiero que esto
// sea igual a whatsapp en mobile, en desktop también debe verse bien").
// - Celular: la lista de chats de iOS a sangre, con la barra de vidrio del
//   dashboard flotando abajo. Lo que en iOS se "empuja" desde la lista (el
//   chat, la info. del contacto, las secciones del "…" y Programados) es una
//   CAPA fija sobre el shell entero (barra-ios.tsx). Debajo queda todo montado
//   y quieto: el encabezado del dashboard con sus pestañas, la lista y la
//   barra; al volver deslizando se ve la pantalla de verdad. Se fueron la barra
//   propia de 8 botones de abajo (el "quilombo de opciones") y la fila de
//   etiquetas de arriba (las etiquetas son chips de la lista).
// - Compu: tres columnas como WhatsApp para Mac: secciones, lista y
//   conversación, con anchos que salen del lugar que tienen las columnas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { usePantallaInmersiva } from '@/components/dashboard/pantalla-inmersiva'
import { useEsCelular } from '@/hooks/use-es-celular'
import type { Pendiente } from '@/lib/mensajeria/por-responder'
import { MensajeriaProvider, useMensajeria } from './components/shared/mensajeria-context'
import { ConversationList } from './components/inbox/conversation-list'
import { ChatView } from './components/inbox/chat-view'
import { ClientProfile } from './components/inbox/client-profile'
import { SettingsSheet } from './components/settings/settings-sheet'
import { NewChatDialog } from './components/dialogs/new-chat-dialog'
import { ScheduleDialog, type ClienteInicial } from './components/dialogs/schedule-dialog'
import { TemplatePicker } from './components/dialogs/template-picker'
import { BroadcastSection } from './components/broadcasts/broadcast-section'
import { WorkflowList } from './components/workflows/workflow-list'
import { QuickReplySection } from './components/quick-replies/quick-reply-section'
import { ProveedorPorResponder, usePorResponder } from './components/responder/contexto-por-responder'
import { PorResponder } from './components/responder/por-responder'
import { FilaPorResponder } from './components/responder/fila-por-responder'
import { TokenHealthBanner } from './components/shared/token-health-banner'
import { BarraSecciones } from './components/navegacion/barra-secciones'
import { MenuSecciones } from './components/navegacion/menu-secciones'
import { MarcoSeccion } from './components/navegacion/barra-ios'
import { destinoActivo, itemDe, type DestinoMensajeria } from './components/navegacion/secciones'
import type { MensajeriaProps, CrmSection } from './components/shared/types'

// Los anchos de las columnas de la compu. Se miden por el contenedor de las
// columnas (@container/columnas) y no por la pantalla: el menú del dashboard
// ocupa 256 px y el modo foco los devuelve. Medidos por la pantalla, a 1280 px
// la columna de secciones con etiquetas (220) y la lista ancha (380) dejaban
// la conversación en 424 px (a 1279, en 611).
// - --ancho-secciones: el riel de íconos (72) o, desde 1600 px de columnas, la
//   lista con etiquetas (220). 0 donde la columna no se dibuja (el celular).
//   La lista con etiquetas arrancaba en 1180, y desde una pantalla de 1436 px
//   quedaban dos barras laterales seguidas: el menú del dashboard y ella, 476
//   px de navegación antes de los chats y la conversación en 584 a 1440.
//   WhatsApp para Mac tiene un solo riel de íconos. Con 1600 el riel llega
//   hasta una pantalla de 1855 px con el menú (1600 en el modo foco, donde el
//   menú plegado deja su borde de 1 px): a 1440 la conversación mide 732 y a
//   1536, 828. La lista con etiquetas queda para las pantallas grandes, donde
//   no le saca lugar a nadie: a 1920, con ella, la conversación mide 1064 (704
//   con la info. del contacto al lado).
// - --ancho-lista: 340, o 380 desde 1000 px de columnas. Lo usan la lista y
//   Programados.
// La info. del contacto (client-profile.tsx) es hija de este mismo envoltorio:
// superpuesta, ocupa exactamente la conversación con
// left: calc(var(--ancho-secciones) + var(--ancho-lista)), y desde 1500 px de
// columnas va al lado. En el celular las columnas miden lo que la pantalla: por
// eso todo va con lg: además del container query.
const ANCHOS_DE_COLUMNAS =
  '[--ancho-secciones:0px] lg:[--ancho-secciones:72px] lg:@min-[1600px]/columnas:[--ancho-secciones:220px] ' +
  'lg:[--ancho-lista:340px] lg:@min-[1000px]/columnas:[--ancho-lista:380px]'

export function MensajeriaClient(props: MensajeriaProps) {
  return (
    <MensajeriaProvider
      initialConversations={props.initialConversations}
      scheduledMessages={props.scheduledMessages}
      waConfig={props.waConfig}
      igConfig={props.igConfig}
      aiConfig={props.aiConfig}
      initialTags={props.initialTags}
      appSettings={props.appSettings}
      branches={props.branches}
      totalConversations={props.totalConversations}
    >
      {/* «Por responder» lee del contexto de Mensajería (la lista de chats le avisa
          cuándo releer): va adentro del provider. */}
      <ProveedorPorResponder>
        <MarcoMensajeria />
      </ProveedorPorResponder>
    </MensajeriaProvider>
  )
}

// Adentro del provider: la navegación necesita la vista del inbox (chats o
// programados) y la pantalla inmersiva necesita saber si hay un chat abierto.
function MarcoMensajeria() {
  const searchParams = useSearchParams()
  const isFocusMode = searchParams.get('foco') === '1'
  const {
    inboxTab, setInboxTab, conversations, scheduled, showMobileChat, activeConv,
    setActiveConv, setShowMobileChat, setShowProfile, handleStartConversation,
  } = useMensajeria()
  const { cuenta: porResponder, urgente: porResponderUrgente, refrescar: refrescarPorResponder } = usePorResponder()
  const esCelular = useEsCelular()
  // La tarjeta que tiene que quedar arriba al abrir «Por responder» (la del aviso que se tocó).
  const [convPorResponder, setConvPorResponder] = useState<string | null>(null)

  const [section, setSection] = useState<CrmSection>('inbox')
  const [showSettings, setShowSettings] = useState(() => searchParams.get('settings') === '1')
  const [showNewChat, setShowNewChat] = useState(false)
  // Programar un mensaje: desde Programados, sin cliente; desde la info. del
  // contacto, con el cliente de esa conversación ya elegido.
  const [programar, setProgramar] = useState<{ abierto: boolean; cliente: ClienteInicial | null }>({
    abierto: false,
    cliente: null,
  })

  // En el celular, un chat abierto, una sección y Programados son capas que
  // tapan la pantalla entera. El shell deja quietos e inertes su encabezado y
  // su barra (debajo de la capa) y apaga el deslizar entre pestañas.
  const capaAbierta =
    esCelular && ((showMobileChat && !!activeConv) || section !== 'inbox' || inboxTab === 'scheduled')
  usePantallaInmersiva(capaAbierta)

  // ?foco lo leen sólo el shell y esta pantalla, en el cliente: alcanza con el
  // replaceState de la ventana (el de Next lo parchea y actualiza
  // useSearchParams en el acto, sin ir al servidor). Con router.replace había
  // una navegación en vuelo, y si en ese rato se abría una capa (que empuja su
  // entrada del historial) Next la descartaba y el modo foco no se aplicaba.
  const toggleFocusMode = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (isFocusMode) params.delete('foco')
    else params.set('foco', '1')
    const qs = params.toString()
    window.history.replaceState(null, '', `/dashboard/mensajeria${qs ? `?${qs}` : ''}${window.location.hash}`)
  }, [isFocusMode, searchParams])

  // «Por responder» (6/nov/2026) reemplazó a Alertas y Casos, y con ellos al
  // canal de realtime `crm-alerts-badge`, que escuchaba crm_alerts de TODAS las
  // orgs. El número sale de contexto-por-responder.tsx, que relee cuando se
  // mueve la lista de chats.
  const irA = useCallback((destino: DestinoMensajeria) => {
    // Cada cambio de sección vuelve a leer: al salir de «Por responder» el
    // número tiene que reflejar lo que se contestó ahí.
    refrescarPorResponder()
    if (destino === 'chats' || destino === 'programados') {
      setSection('inbox')
      setInboxTab(destino === 'programados' ? 'scheduled' : 'inbox')
      return
    }
    setSection(destino)
    // De Programados a una sección: Programados se cierra. Si no, en la compu
    // quedaban las dos a la vista y la sección se apretaba en el lugar del chat.
    setInboxTab('inbox')
  }, [refrescarPorResponder, setInboxTab])

  const abrirPorResponder = useCallback((conv: string | null) => {
    setConvPorResponder(conv)
    irA('responder')
  }, [irA])

  // Tocar un aviso push con Mensajería abierta: el service worker le avisa a la
  // página (public/sw-avisos.js) y se abre la bandeja en esa tarjeta, sin recargar.
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw) return
    const alMensaje = (e: MessageEvent) => {
      const d = e.data as { tipo?: string; conv?: string | null } | null
      if (d?.tipo === 'abrir-por-responder') abrirPorResponder(typeof d.conv === 'string' ? d.conv : null)
    }
    sw.addEventListener('message', alMensaje)
    return () => sw.removeEventListener('message', alMensaje)
  }, [abrirPorResponder])

  // «Ver chat» desde una tarjeta: el chat de esa conversación, como desde la lista.
  const verChatDesdePendiente = useCallback((p: Pendiente) => {
    const conv = conversations.find((c) => c.id === p.id)
    if (conv) {
      setActiveConv(conv)
      setShowProfile(false)
      setShowMobileChat(true)
      irA('chats')
      return
    }
    if (p.clientId) {
      handleStartConversation(p.clientId)
      irA('chats')
      return
    }
    toast.info('Esa conversación no está entre las últimas: buscala en Chats.')
  }, [conversations, handleStartConversation, irA, setActiveConv, setShowMobileChat, setShowProfile])

  const activo = destinoActivo(section, inboxTab)
  const seccionAbierta = section !== 'inbox'
  const chatsNoLeidos = useMemo(() => conversations.filter((c) => c.unread_count > 0).length, [conversations])
  const programadosPendientes = useMemo(() => scheduled.filter((s) => s.status === 'pending').length, [scheduled])
  const abrirConfiguracion = () => setShowSettings(true)
  const abrirChatNuevo = () => setShowNewChat(true)
  // Lo que no traiga id y nombre (por ejemplo, el evento del clic si quien
  // llama pasa el handler tal cual) abre el diálogo sin cliente. La foto (la de
  // la info. del contacto) pasa si es un texto: «Para» la muestra.
  const abrirProgramar = (cliente?: ClienteInicial) =>
    setProgramar({
      abierto: true,
      cliente:
        typeof cliente?.id === 'string' && typeof cliente.nombre === 'string'
          ? { id: cliente.id, nombre: cliente.nombre, foto: typeof cliente.foto === 'string' ? cliente.foto : null }
          : null,
    })

  return (
    // overflow-clip y no hidden, acá y en las columnas: un overflow hidden es un
    // contenedor de scroll, y el scrollIntoView del final del hilo (el contexto,
    // 50 ms después de cargar) lo corría de costado mientras el chat entraba
    // desde la derecha: la conversación quedaba 138 px a la izquierda con una
    // franja negra (23/oct/2026). Con clip no hay nada que correr.
    <div className="wa-scope flex h-full min-h-0 flex-col overflow-clip bg-[var(--wa-bg)] text-[var(--wa-text)]">
      {/* Debajo de una capa queda inerte, como la lista: tapado, «Reconectar» se
          podía enfocar y el lector de pantalla lo leía. */}
      <div inert={capaAbierta} aria-hidden={capaAbierta || undefined} className="contents">
        <TokenHealthBanner onOpenSettings={abrirConfiguracion} />
      </div>

      {/* Las columnas: el contenedor que miden las container queries (sólo en
          la compu: en el celular no hay columnas que medir). */}
      <div className="relative flex min-h-0 flex-1 overflow-clip lg:@container/columnas">
        <div className={`relative flex min-h-0 min-w-0 flex-1 ${ANCHOS_DE_COLUMNAS}`}>
          <BarraSecciones
            activo={activo}
            contadores={{
              chats: chatsNoLeidos,
              responder: porResponder,
              responderUrgente: porResponderUrgente,
              programados: programadosPendientes,
            }}
            configAbierta={showSettings}
            isFocusMode={isFocusMode}
            onIr={irA}
            onConfig={abrirConfiguracion}
            onToggleFoco={toggleFocusMode}
          />

          {/* La lista está siempre: en el celular, debajo de las capas; en la
              compu, escondida mientras una sección o Programados ocupan su lugar. */}
          <ConversationList
            onNewChat={abrirChatNuevo}
            onOpenSettings={abrirConfiguracion}
            onProgramar={() => abrirProgramar()}
            seccionAbierta={seccionAbierta}
            menu={
              <MenuSecciones
                responderCount={porResponder}
                responderUrgente={porResponderUrgente}
                isFocusMode={isFocusMode}
                onIr={irA}
                onConfig={abrirConfiguracion}
                onToggleFoco={toggleFocusMode}
                onAbrir={refrescarPorResponder}
              />
            }
            porResponder={<FilaPorResponder onAbrir={() => abrirPorResponder(null)} />}
          />

          {seccionAbierta ? (
            <MarcoSeccion titulo={itemDe(activo).titulo} onVolver={() => irA('chats')}>
              {section === 'broadcasts' && <BroadcastSection />}
              {section === 'automations' && <WorkflowList />}
              {section === 'responder' && <PorResponder convInicial={convPorResponder} onVerChat={verChatDesdePendiente} />}
              {section === 'quick-replies' && <QuickReplySection />}
            </MarcoSeccion>
          ) : (
            <>
              <ChatView onOpenSettings={abrirConfiguracion} onNewChat={abrirChatNuevo} />
              <ClientProfile onProgramar={abrirProgramar} />
            </>
          )}
        </div>
      </div>

      <DeepLinkHandler onSection={setSection} onPorResponder={abrirPorResponder} />

      {/* ═══ Dialogs & Sheets ═══ */}
      <SettingsSheet open={showSettings} onOpenChange={setShowSettings} />
      <NewChatDialog open={showNewChat} onOpenChange={setShowNewChat} />
      <ScheduleDialog
        open={programar.abierto}
        onOpenChange={(abierto) => setProgramar((p) => ({ ...p, abierto }))}
        clienteInicial={programar.cliente}
      />
      <TemplatePicker />
    </div>
  )
}

function DeepLinkHandler({
  onSection,
  onPorResponder,
}: {
  onSection: (s: CrmSection) => void
  /** ?responder=1 (y &conv=): lo que abre tocar un aviso push con Mensajería cerrada. */
  onPorResponder: (conv: string | null) => void
}) {
  const searchParams = useSearchParams()
  const responderAtendido = useRef('')

  // El enlace de un aviso push: «Por responder», con esa tarjeta arriba. Se
  // consume con el replaceState de la ventana (como ?clientId: nadie lo lee en
  // el servidor y un router.replace en vuelo lo descartaría la capa que se abre).
  useEffect(() => {
    if (searchParams.get('responder') !== '1') return
    const conv = searchParams.get('conv')
    const clave = `responder|${conv ?? ''}`
    if (responderAtendido.current === clave) return
    responderAtendido.current = clave
    onPorResponder(conv && /^[0-9a-f-]{36}$/i.test(conv) ? conv : null)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('responder')
    params.delete('conv')
    const qs = params.toString()
    window.history.replaceState(null, '', `/dashboard/mensajeria${qs ? `?${qs}` : ''}${window.location.hash}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const { handleStartConversation, activeConv, setConversations, tags } = useMensajeria()
  const [pendingTag, setPendingTag] = useState<{ clientId: string; tagId: string } | null>(null)
  // Cada enlace se atiende una sola vez: si el ?clientId vuelve a aparecer
  // (una entrada del historial que lo conservó), no reabre el chat ni vuelve
  // a llamar a handleStartConversation.
  const atendidoRef = useRef('')

  useEffect(() => {
    const clientId = searchParams.get('clientId')
    if (!clientId) return
    const tag = searchParams.get('tag')
    const clave = `${clientId}|${tag ?? ''}`
    if (atendidoRef.current === clave) return
    atendidoRef.current = clave
    onSection('inbox')
    handleStartConversation(clientId)
    if (tag) setPendingTag({ clientId, tagId: tag })
    // Se consumen clientId y tag; lo demás (?foco=1, ?settings=1) queda. Con el
    // replaceState de la ventana (el de Next lo parchea) y no con
    // router.replace: nadie los lee en el servidor, y una navegación en vuelo
    // la descartaba la entrada del historial del chat que se abre (con la red
    // lenta, la entrada quedaba con ?clientId y el chat se volvía a abrir).
    const params = new URLSearchParams(searchParams.toString())
    params.delete('clientId')
    params.delete('tag')
    const qs = params.toString()
    window.history.replaceState(null, '', `/dashboard/mensajeria${qs ? `?${qs}` : ''}${window.location.hash}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Cuando la conversacion objetivo queda activa, aplicamos la etiqueta pendiente.
  useEffect(() => {
    if (!pendingTag || !activeConv) return
    if (activeConv.client_id !== pendingTag.clientId) return
    const { tagId } = pendingTag
    setPendingTag(null)
    ;(async () => {
      const { assignConversationTag } = await import('@/lib/actions/tags')
      const res = await assignConversationTag(activeConv.id, tagId)
      if (res.error) return
      const tagObj = tags.find(t => t.id === tagId)
      if (!tagObj) return
      setConversations(prev => prev.map(c => {
        if (c.id !== activeConv.id) return c
        const already = c.tags?.some(t => t.tag_id === tagId)
        if (already) return c
        return {
          ...c,
          tags: [...(c.tags ?? []), { tag_id: tagId, tag: tagObj }],
        }
      }))
    })()
    // tags es estable (viene del context), no necesita re-trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv, pendingTag, setConversations])

  return null
}
