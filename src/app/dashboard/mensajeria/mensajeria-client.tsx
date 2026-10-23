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
import { useSearchParams, useRouter } from 'next/navigation'
import { usePantallaInmersiva } from '@/components/dashboard/pantalla-inmersiva'
import { useEsCelular } from '@/hooks/use-es-celular'
import { getOpenCrmCaseCount } from '@/lib/actions/crm-cases'
import { getUnreadAlertCount } from '@/lib/actions/workflows'
import { createClient } from '@/lib/supabase/client'
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
import { CrmAlertsPanel } from './components/alerts/crm-alerts-panel'
import { CrmCasesPanel } from './components/casos/crm-cases-panel'
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
// - --ancho-secciones: el riel de íconos (72) o, desde 1180 px de columnas, la
//   lista con etiquetas (220). 0 donde la columna no se dibuja (el celular).
// - --ancho-lista: 340, o 380 desde 1000 px de columnas. Lo usan la lista y
//   Programados.
// La info. del contacto (client-profile.tsx) es hija de este mismo envoltorio:
// superpuesta, ocupa exactamente la conversación con
// left: calc(var(--ancho-secciones) + var(--ancho-lista)), y desde 1500 px de
// columnas va al lado. En el celular las columnas miden lo que la pantalla: por
// eso todo va con lg: además del container query.
const ANCHOS_DE_COLUMNAS =
  '[--ancho-secciones:0px] lg:[--ancho-secciones:72px] lg:@min-[1180px]/columnas:[--ancho-secciones:220px] ' +
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
      <MarcoMensajeria />
    </MensajeriaProvider>
  )
}

// Adentro del provider: la navegación necesita la vista del inbox (chats o
// programados) y la pantalla inmersiva necesita saber si hay un chat abierto.
function MarcoMensajeria() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isFocusMode = searchParams.get('foco') === '1'
  const { inboxTab, setInboxTab, conversations, scheduled, showMobileChat, activeConv } = useMensajeria()
  const esCelular = useEsCelular()

  const [section, setSection] = useState<CrmSection>('inbox')
  const [showSettings, setShowSettings] = useState(() => searchParams.get('settings') === '1')
  const [showNewChat, setShowNewChat] = useState(false)
  // Programar un mensaje: desde Programados, sin cliente; desde la info. del
  // contacto, con el cliente de esa conversación ya elegido.
  const [programar, setProgramar] = useState<{ abierto: boolean; cliente: ClienteInicial | null }>({
    abierto: false,
    cliente: null,
  })
  const [alertCount, setAlertCount] = useState(0)
  const [casosCount, setCasosCount] = useState(0)

  // En el celular, un chat abierto, una sección y Programados son capas que
  // tapan la pantalla entera. El shell deja quietos e inertes su encabezado y
  // su barra (debajo de la capa) y apaga el deslizar entre pestañas.
  usePantallaInmersiva(
    esCelular && ((showMobileChat && !!activeConv) || section !== 'inbox' || inboxTab === 'scheduled'),
  )

  const toggleFocusMode = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (isFocusMode) params.delete('foco')
    else params.set('foco', '1')
    const qs = params.toString()
    router.replace(`/dashboard/mensajeria${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [isFocusMode, router, searchParams])

  // Alertas no leídas y casos pendientes. Sólo pinta la última consulta: si
  // una vieja llega tarde no pisa el número nuevo.
  const consultaContadores = useRef(0)
  const refrescarContadores = useCallback(() => {
    const n = ++consultaContadores.current
    getUnreadAlertCount()
      .then((r) => { if (n === consultaContadores.current) setAlertCount(r.count) })
      .catch(() => {})
    getOpenCrmCaseCount()
      .then((r) => { if (n === consultaContadores.current) setCasosCount(r.count) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refrescarContadores()
  }, [refrescarContadores])

  // Realtime para actualizar los badges cuando llega una alerta o un caso nuevo
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('crm-alerts-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_alerts' }, () => {
        setAlertCount(prev => prev + 1)
      })
      // NOTA: crm_cases NO está en la publication supabase_realtime, así que un
      // listener postgres_changes sobre esa tabla nunca dispara (era código muerto).
      // El badge de casos se refresca por refetch manual al montar, al cambiar
      // de sección y al abrir el menú "…". Si se quiere en vivo, agregar
      // crm_cases a la publication (bajo riesgo: tasa de cambios baja y el
      // callback solo refetchea un count).
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.error('[crm-alerts-badge realtime] canal en estado', status, err)
        }
      })
    return () => { supabase.removeChannel(channel) }
  }, [])

  const irA = (destino: DestinoMensajeria) => {
    // Cada cambio de sección vuelve a contar: al salir de Alertas o de Casos el
    // número tiene que reflejar lo que se leyó o se resolvió ahí.
    refrescarContadores()
    if (destino === 'chats' || destino === 'programados') {
      setSection('inbox')
      setInboxTab(destino === 'programados' ? 'scheduled' : 'inbox')
      return
    }
    setSection(destino)
  }

  const activo = destinoActivo(section, inboxTab)
  const seccionAbierta = section !== 'inbox'
  const chatsNoLeidos = useMemo(() => conversations.filter((c) => c.unread_count > 0).length, [conversations])
  const programadosPendientes = useMemo(() => scheduled.filter((s) => s.status === 'pending').length, [scheduled])
  const abrirConfiguracion = () => setShowSettings(true)
  const abrirChatNuevo = () => setShowNewChat(true)
  // Lo que no traiga id y nombre (por ejemplo, el evento del clic si quien
  // llama pasa el handler tal cual) abre el diálogo sin cliente.
  const abrirProgramar = (cliente?: ClienteInicial) =>
    setProgramar({
      abierto: true,
      cliente: typeof cliente?.id === 'string' && typeof cliente.nombre === 'string' ? { id: cliente.id, nombre: cliente.nombre } : null,
    })

  return (
    // overflow-clip y no hidden, acá y en las columnas: un overflow hidden es un
    // contenedor de scroll, y el scrollIntoView del final del hilo (el contexto,
    // 50 ms después de cargar) lo corría de costado mientras el chat entraba
    // desde la derecha: la conversación quedaba 138 px a la izquierda con una
    // franja negra (23/oct/2026). Con clip no hay nada que correr.
    <div className="wa-scope flex h-full min-h-0 flex-col overflow-clip bg-[var(--wa-bg)] text-[var(--wa-text)]">
      <TokenHealthBanner onOpenSettings={abrirConfiguracion} />

      {/* Las columnas: el contenedor que miden las container queries (sólo en
          la compu: en el celular no hay columnas que medir). */}
      <div className="relative flex min-h-0 flex-1 overflow-clip lg:@container/columnas">
        <div className={`relative flex min-h-0 min-w-0 flex-1 ${ANCHOS_DE_COLUMNAS}`}>
          <BarraSecciones
            activo={activo}
            contadores={{
              chats: chatsNoLeidos,
              alertas: alertCount,
              casos: casosCount,
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
                alertCount={alertCount}
                casosCount={casosCount}
                isFocusMode={isFocusMode}
                onIr={irA}
                onConfig={abrirConfiguracion}
                onToggleFoco={toggleFocusMode}
                onAbrir={refrescarContadores}
              />
            }
          />

          {seccionAbierta ? (
            <MarcoSeccion titulo={itemDe(activo).titulo} onVolver={() => irA('chats')}>
              {section === 'broadcasts' && <BroadcastSection />}
              {section === 'automations' && <WorkflowList />}
              {section === 'alerts' && <CrmAlertsPanel onNavigateToInbox={() => irA('chats')} />}
              {section === 'casos' && <CrmCasesPanel onNavigateToInbox={() => irA('chats')} />}
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

      <DeepLinkHandler onSection={setSection} />

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

function DeepLinkHandler({ onSection }: { onSection: (s: CrmSection) => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { handleStartConversation, activeConv, setConversations, tags } = useMensajeria()
  const [pendingTag, setPendingTag] = useState<{ clientId: string; tagId: string } | null>(null)

  useEffect(() => {
    const clientId = searchParams.get('clientId')
    if (!clientId) return
    const tag = searchParams.get('tag')
    onSection('inbox')
    handleStartConversation(clientId)
    if (tag) setPendingTag({ clientId, tagId: tag })
    // Se consumen clientId y tag; lo demás (?foco=1, ?settings=1) queda.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('clientId')
    params.delete('tag')
    const qs = params.toString()
    router.replace(`/dashboard/mensajeria${qs ? `?${qs}` : ''}`, { scroll: false })
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
