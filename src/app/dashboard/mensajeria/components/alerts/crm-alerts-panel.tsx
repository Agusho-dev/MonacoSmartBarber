'use client'

// Alertas, como una pantalla de WhatsApp para iOS (23/oct/2026, tercera
// ronda): las sin leer arriba y las leídas abajo, cada una en una celda con el
// ícono del color de su tipo (rojo urgente, ámbar advertencia, azul info), el
// título, de quién es, el mensaje y la hora en 24 h. «Responder» abre el chat y
// «Marcar como leída» la pasa abajo; «Leer todas» va en la barra. En la compu,
// la misma lista con la piel de la Mac.

import { useState, useEffect, useTransition, useCallback } from 'react'
import { AlertCircle, AlertTriangle, Bell, Check, Info, MessageSquare, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getCrmAlerts, markAlertRead, markAllAlertsRead } from '@/lib/actions/workflows'
import { useMensajeria } from '../shared/mensajeria-context'
import { createClient } from '@/lib/supabase/client'
import type { CrmAlert, CrmAlertType } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { displayName, formatRelativeDate } from '../shared/helpers'
import { useDiaLocal } from '../shared/use-dia-local'
import { AccionDeBarraIos, BotonSecundario, BotonTextoIos, EncabezadoSeccion } from '../navegacion/barra-ios'
import {
  BotonTextoCeldaIos, CargandoIos, CLASE_CELDA, CLASE_CUERPO, ContenidoSeccion, GrupoIos, IconoCeldaIos,
  TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos, avisarFalla, type ColorIcono,
} from '../navegacion/lista-ios'

type AlertWithConversation = CrmAlert & {
  conversation?: {
    id: string
    platform_user_name: string
    platform_user_id: string
    channel?: { platform: string } | null
    client?: { id: string; name: string; phone: string }
  }
}

const ALERT_CONFIG: Record<CrmAlertType, { icon: LucideIcon; label: string; color: ColorIcono }> = {
  urgent: { icon: AlertCircle, label: 'Urgente', color: 'rojo' },
  warning: { icon: AlertTriangle, label: 'Advertencia', color: 'naranja' },
  info: { icon: Info, label: 'Info', color: 'azul' },
}

export function CrmAlertsPanel({ onNavigateToInbox }: { onNavigateToInbox?: () => void } = {}) {
  const { conversations, setActiveConv, setShowMobileChat } = useMensajeria()
  const [alerts, setAlerts] = useState<AlertWithConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [isMarking, startMarking] = useTransition()
  // La hora de cada celda ("14:32", "Ayer", "martes") cambia sola a la medianoche.
  const dia = useDiaLocal()

  const loadAlerts = useCallback(async () => {
    try {
      const result = await getCrmAlerts()
      setAlerts(result.data as AlertWithConversation[])
    } catch {
      // Se queda la lista que había: es una relectura por Realtime.
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await getCrmAlerts()
        if (cancelled) return
        setAlerts(result.data as AlertWithConversation[])
      } catch {
        // Sin red: se ve el vacío y la relectura de Realtime la trae después.
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime para nuevas alertas
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('crm-alerts-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_alerts' }, () => {
        loadAlerts()
      })
      // Sincronizar el estado de leído/no-leído entre usuarios (antes era optimista local).
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'crm_alerts' }, (payload) => {
        const updated = payload.new as { id: string; is_read: boolean; read_at: string | null }
        setAlerts(prev => prev.map(a => a.id === updated.id ? { ...a, is_read: updated.is_read, read_at: updated.read_at } : a))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAlerts])

  const handleMarkRead = (alertId: string) => {
    startMarking(async () => {
      try {
        await markAlertRead(alertId)
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a))
      } catch (e) {
        avisarFalla(e, 'No se pudo marcar como leída. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleMarkAllRead = () => {
    startMarking(async () => {
      try {
        await markAllAlertsRead()
        setAlerts(prev => prev.map(a => ({ ...a, is_read: true, read_at: new Date().toISOString() })))
      } catch (e) {
        avisarFalla(e, 'No se pudieron marcar como leídas. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleGoToConversation = (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (conv) {
      setActiveConv(conv)
      setShowMobileChat(true)
      onNavigateToInbox?.()
      return
    }
    // La lista trae las conversaciones más recientes: una vieja no está. Antes
    // el botón no hacía nada.
    toast.info('Esa conversación no está entre las últimas: buscala en Chats.')
  }

  const sinLeer = alerts.filter(a => !a.is_read)
  const leidas = alerts.filter(a => a.is_read)
  const resumen = sinLeer.length > 0 ? `${sinLeer.length} sin leer` : 'Todo al día'

  const celda = (alert: AlertWithConversation) => (
    <CeldaAlerta
      key={alert.id}
      alert={alert}
      dia={dia}
      marcando={isMarking}
      onResponder={alert.conversation_id ? () => handleGoToConversation(alert.conversation_id!) : undefined}
      onLeida={() => handleMarkRead(alert.id)}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sinLeer.length > 0 && (
        <AccionDeBarraIos>
          <BotonTextoIos onClick={handleMarkAllRead} disabled={isMarking}>Leer todas</BotonTextoIos>
        </AccionDeBarraIos>
      )}
      <EncabezadoSeccion titulo="Alertas" subtitulo={loading ? undefined : resumen}>
        {sinLeer.length > 0 && (
          <BotonSecundario onClick={handleMarkAllRead} disabled={isMarking}>
            <Check aria-hidden className="size-4" /> Leer todas
          </BotonSecundario>
        )}
      </EncabezadoSeccion>

      <ContenidoSeccion>
        {loading ? (
          <CargandoIos texto="Cargando alertas…" />
        ) : alerts.length === 0 ? (
          <VacioIos icono={Bell} titulo="Sin alertas" texto="Las que generan tus automatizaciones aparecen acá." />
        ) : (
          <>
            {sinLeer.length > 0 ? (
              <GrupoIos titulo={`Sin leer · ${sinLeer.length}`}>{sinLeer.map(celda)}</GrupoIos>
            ) : (
              <p className={cn(TEXTO_SECUNDARIO, 'px-4 pt-2 lg:px-3')}>Todo al día: no hay alertas sin leer.</p>
            )}
            {leidas.length > 0 && <GrupoIos titulo="Leídas">{leidas.map(celda)}</GrupoIos>}
          </>
        )}
      </ContenidoSeccion>
    </div>
  )
}

function CeldaAlerta({
  alert,
  dia,
  marcando,
  onResponder,
  onLeida,
}: {
  alert: AlertWithConversation
  /** El día del navegador (useDiaLocal): null mientras no se sabe. */
  dia: string | null
  marcando: boolean
  onResponder?: () => void
  onLeida: () => void
}) {
  const config = ALERT_CONFIG[alert.alert_type] || ALERT_CONFIG.info
  const rawAlertName =
    alert.conversation?.client?.name
    || alert.conversation?.platform_user_name
    || alert.conversation?.platform_user_id
  const clientName = rawAlertName
    ? displayName(rawAlertName, alert.conversation?.channel?.platform)
    : 'Sin chat'
  const leida = alert.is_read
  const calificacion = alert.metadata?.button_pressed

  return (
    <li className={cn(CLASE_CELDA, 'items-start')}>
      <IconoCeldaIos icono={config.icon} color={leida ? 'gris' : config.color} className="mt-3 lg:mt-2.5" />
      <div className={cn(CLASE_CUERPO, 'flex-col items-stretch gap-0.5 py-3 lg:py-2.5')}>
        <div className="flex items-baseline gap-3">
          {!leida && <span aria-hidden className="size-2 shrink-0 self-center rounded-full bg-[var(--wa-accent)]" />}
          <p className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate', leida ? 'text-[var(--wa-text-2)]' : 'font-semibold')}>
            {!leida && <span className="sr-only">Sin leer: </span>}
            {alert.title}
          </p>
          {dia && <span className={cn(TEXTO_TERCIARIO, 'shrink-0 tabular-nums')}>{formatRelativeDate(alert.created_at)}</span>}
        </div>
        <p className={cn(TEXTO_SECUNDARIO, 'truncate')}>
          {clientName} · <span className={leida ? undefined : config.color === 'rojo' ? 'text-[#ff6961]' : config.color === 'naranja' ? 'text-[#ffa733]' : 'text-[#5aaeff]'}>{config.label}</span>
        </p>
        {alert.message && (
          <p className={cn('line-clamp-3 text-[15px] leading-5 lg:text-[13px] lg:leading-[18px]', leida ? 'text-[var(--wa-text-2)]' : 'text-[var(--wa-text)]')}>
            {alert.message}
          </p>
        )}
        {calificacion != null && (
          <p className={TEXTO_TERCIARIO}>Calificación: <span className="text-[var(--wa-text)]">{String(calificacion)}</span></p>
        )}
        {(onResponder || !leida) && (
          <div className="-mb-1.5 mt-0.5 flex items-center gap-4 lg:-mb-1 lg:gap-3">
            {onResponder && (
              <BotonTextoCeldaIos icono={MessageSquare} onClick={onResponder} etiqueta={`Responder a ${clientName}`}>
                Responder
              </BotonTextoCeldaIos>
            )}
            {!leida && (
              <BotonTextoCeldaIos tono="neutro" icono={Check} onClick={onLeida} deshabilitado={marcando}>
                Marcar como leída
              </BotonTextoCeldaIos>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
