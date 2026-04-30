'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { Bell, AlertTriangle, Info, AlertCircle, CheckCheck, MessageSquare, X, User, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCrmAlerts, markAlertRead, markAllAlertsRead } from '@/lib/actions/workflows'
import { useMensajeria } from '../shared/mensajeria-context'
import { createClient } from '@/lib/supabase/client'
import type { CrmAlert, CrmAlertType } from '@/lib/types/database'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { displayName } from '../shared/helpers'

type AlertWithConversation = CrmAlert & {
  conversation?: {
    id: string
    platform_user_name: string
    platform_user_id: string
    channel?: { platform: string } | null
    client?: { id: string; name: string; phone: string }
  }
}

const ALERT_CONFIG: Record<CrmAlertType, {
  icon: React.ElementType
  label: string
  bg: string
  border: string
  badge: string
  iconWrapper: string
  iconColor: string
  hover: string
  pulseText: string
}> = {
  urgent: {
    icon: AlertCircle,
    label: 'Urgente',
    bg: 'bg-red-500/5',
    border: 'border-red-500/20',
    badge: 'bg-red-500/10 text-red-500',
    iconWrapper: 'bg-red-500/10',
    iconColor: 'text-red-500',
    hover: 'hover:border-red-500/40 hover:bg-red-500/10',
    pulseText: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Advertencia',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    badge: 'bg-amber-500/10 text-amber-500',
    iconWrapper: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
    hover: 'hover:border-amber-500/40 hover:bg-amber-500/10',
    pulseText: 'bg-amber-500',
  },
  info: {
    icon: Info,
    label: 'Info',
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/20',
    badge: 'bg-blue-500/10 text-blue-500',
    iconWrapper: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
    hover: 'hover:border-blue-500/40 hover:bg-blue-500/10',
    pulseText: 'bg-blue-500',
  },
}

export function CrmAlertsPanel({ onNavigateToInbox }: { onNavigateToInbox?: () => void } = {}) {
  const { conversations, setActiveConv, setShowMobileChat } = useMensajeria()
  const [alerts, setAlerts] = useState<AlertWithConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [isMarking, startMarking] = useTransition()

  const loadAlerts = useCallback(async () => {
    const result = await getCrmAlerts()
    setAlerts(result.data as AlertWithConversation[])
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getCrmAlerts()
      if (cancelled) return
      setAlerts(result.data as AlertWithConversation[])
      setLoading(false)
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
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAlerts])

  const handleMarkRead = (alertId: string) => {
    startMarking(async () => {
      await markAlertRead(alertId)
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a))
    })
  }

  const handleMarkAllRead = () => {
    startMarking(async () => {
      await markAllAlertsRead()
      setAlerts(prev => prev.map(a => ({ ...a, is_read: true, read_at: new Date().toISOString() })))
    })
  }

  const handleGoToConversation = (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (conv) {
      setActiveConv(conv)
      setShowMobileChat(true)
      onNavigateToInbox?.()
    }
  }

  const unreadCount = alerts.filter(a => !a.is_read).length

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
          <span className="text-sm text-muted-foreground">Cargando alertas...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border shrink-0 bg-card/50">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-red-500/15 flex items-center justify-center">
            <Bell className="size-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">Alertas CRM</h2>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al día'}
            </p>
          </div>
          {unreadCount > 0 && (
            <span className="min-w-6 h-6 flex items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white px-2 animate-pulse">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isMarking}
            className="text-xs h-8 gap-1.5 border-dashed"
          >
            <CheckCheck className="size-3.5" />
            Marcar todas leídas
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Bell className="size-8 opacity-30" />
            </div>
            <p className="text-sm font-medium">Sin alertas pendientes</p>
            <p className="text-xs mt-1 text-center max-w-[220px]">Las alertas generadas por tus workflows aparecerán acá</p>
          </div>
        ) : (
          alerts.map(alert => {
            const config = ALERT_CONFIG[alert.alert_type] || ALERT_CONFIG.info
            const Icon = config.icon
            const rawAlertName =
              alert.conversation?.client?.name
              || alert.conversation?.platform_user_name
              || alert.conversation?.platform_user_id
            const clientName = rawAlertName
              ? displayName(rawAlertName, alert.conversation?.channel?.platform)
              : 'Desconocido'
            const timeAgo = formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: es })

            return (
              <div
                key={alert.id}
                className={`
                  relative rounded-xl border transition-all duration-300 text-left w-full overflow-hidden
                  ${alert.is_read
                    ? 'opacity-75 bg-card/40 border-border/50 grayscale-[0.2]'
                    : `${config.bg} ${config.border} shadow-sm hover:shadow-md`
                  }
                `}
              >
                <div className="p-4">
                  <div className="flex gap-4">
                    {/* Icon */}
                    <div className="shrink-0 mt-0.5">
                      <div className={`size-10 rounded-2xl flex items-center justify-center shadow-sm ${alert.is_read ? 'bg-muted text-muted-foreground' : config.iconWrapper}`}>
                        <Icon className={`size-5 ${alert.is_read ? 'text-muted-foreground' : config.iconColor}`} />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                      
                      {/* Header: Name, Badge, Time */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 shrink min-w-0 max-w-[60%] lg:max-w-[70%]">
                            <User className="size-3.5 shrink-0 text-muted-foreground/80" />
                            <h4 className="text-[13px] font-bold text-foreground truncate leading-none">
                              {clientName}
                            </h4>
                          </div>
                          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${alert.is_read ? 'bg-muted text-muted-foreground' : config.badge}`}>
                            {config.label}
                          </span>
                          {!alert.is_read && (
                            <span className="shrink-0 relative flex size-2">
                              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.pulseText}`} />
                              <span className={`relative inline-flex rounded-full size-2 ${config.pulseText}`} />
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                            <Clock className="size-3 opacity-70" />
                            {timeAgo}
                          </span>
                          {!alert.is_read ? (
                            <button
                              onClick={() => handleMarkRead(alert.id)}
                              disabled={isMarking}
                              className="size-6 -my-1 -mr-1.5 rounded-md flex items-center justify-center text-muted-foreground/50 hover:bg-background/80 hover:text-foreground transition-all"
                              title="Marcar como leída"
                            >
                              <X className="size-4" />
                            </button>
                          ) : (
                            <div className="size-6 -my-1 -mr-1.5" />
                          )}
                        </div>
                      </div>

                      {/* Body: Title & Message */}
                      <div className="pr-2 space-y-1">
                        <h3 className={`text-[14px] font-semibold leading-tight ${alert.is_read ? 'text-muted-foreground' : 'text-foreground/90'}`}>
                          {alert.title}
                        </h3>
                        {alert.message && (
                          <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">
                            {alert.message}
                          </p>
                        )}
                      </div>

                      {/* Footer: Metadata & Action */}
                      <div className="flex items-center justify-between mt-0.5">
                        <div className="flex items-center gap-2">
                          {alert.metadata?.button_pressed != null && (
                            <div className="flex items-center gap-1.5 bg-background/60 border border-border/40 px-2.5 py-1 rounded-md shadow-sm">
                              <span className="text-[10px] font-medium text-muted-foreground">Calificación:</span>
                              <span className="text-[11px] font-bold text-foreground">{String(alert.metadata.button_pressed)}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {alert.conversation_id && (
                            <button
                              onClick={() => handleGoToConversation(alert.conversation_id!)}
                              className={`
                                h-8 px-4 rounded-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider transition-all shadow-sm
                                ${alert.is_read 
                                  ? 'bg-muted text-muted-foreground hover:bg-muted/80' 
                                  : 'bg-green-500 hover:bg-green-600 text-white hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'}
                              `}
                              title={`Responder a ${clientName}`}
                            >
                              <MessageSquare className="size-3.5 shrink-0" />
                              Responder
                            </button>
                          )}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
