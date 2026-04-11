'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { Bell, AlertTriangle, Info, AlertCircle, CheckCheck, MessageSquare, ExternalLink, Flame, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCrmAlerts, markAlertRead, markAllAlertsRead } from '@/lib/actions/workflows'
import { useMensajeria } from '../shared/mensajeria-context'
import { createClient } from '@/lib/supabase/client'
import type { CrmAlert, CrmAlertType } from '@/lib/types/database'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

type AlertWithConversation = CrmAlert & {
  conversation?: {
    id: string
    platform_user_name: string
    client?: { id: string; name: string; phone: string }
  }
}

const ALERT_CONFIG: Record<CrmAlertType, {
  icon: React.ElementType
  label: string
  gradient: string
  iconBg: string
  iconColor: string
  accentBorder: string
  badgeBg: string
  badgeText: string
  glow: string
}> = {
  urgent: {
    icon: Flame,
    label: 'URGENTE',
    gradient: 'bg-gradient-to-r from-red-500/20 via-red-500/10 to-transparent',
    iconBg: 'bg-red-500',
    iconColor: 'text-white',
    accentBorder: 'border-l-red-500',
    badgeBg: 'bg-red-500/15',
    badgeText: 'text-red-400',
    glow: 'shadow-red-500/20 shadow-lg',
  },
  warning: {
    icon: AlertTriangle,
    label: 'ADVERTENCIA',
    gradient: 'bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent',
    iconBg: 'bg-amber-500',
    iconColor: 'text-white',
    accentBorder: 'border-l-amber-500',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-400',
    glow: 'shadow-amber-500/20 shadow-lg',
  },
  info: {
    icon: Info,
    label: 'INFO',
    gradient: 'bg-gradient-to-r from-blue-500/15 via-blue-500/5 to-transparent',
    iconBg: 'bg-blue-500',
    iconColor: 'text-white',
    accentBorder: 'border-l-blue-500',
    badgeBg: 'bg-blue-500/15',
    badgeText: 'text-blue-400',
    glow: 'shadow-blue-500/20 shadow-lg',
  },
}

export function CrmAlertsPanel() {
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
    loadAlerts()
  }, [loadAlerts])

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
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
            const clientName = alert.conversation?.client?.name || alert.conversation?.platform_user_name || 'Desconocido'
            const phone = alert.conversation?.client?.phone || ''
            const timeAgo = formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: es })

            return (
              <div
                key={alert.id}
                className={`
                  relative rounded-xl border border-l-4 ${config.accentBorder} overflow-hidden
                  transition-all duration-300
                  ${alert.is_read
                    ? 'opacity-50 hover:opacity-75 bg-card/30'
                    : `${config.gradient} ${config.glow} hover:scale-[1.01]`
                  }
                `}
              >
                <div className="px-4 py-4">
                  <div className="flex items-start gap-3.5">
                    {/* Icon */}
                    <div className={`shrink-0 size-10 rounded-xl ${config.iconBg} flex items-center justify-center ${!alert.is_read ? 'animate-bounce' : ''}`}
                      style={{ animationDuration: '2s', animationIterationCount: alert.is_read ? '0' : '3' }}>
                      <Icon className={`size-5 ${config.iconColor}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: badge + time */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-widest ${config.badgeBg} ${config.badgeText}`}>
                            {config.label}
                          </span>
                          {!alert.is_read && (
                            <span className="relative flex size-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full size-2.5 bg-red-500" />
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo}</span>
                      </div>

                      {/* Title */}
                      <h3 className="text-[15px] font-semibold mt-1.5 leading-tight">{alert.title}</h3>

                      {/* Message */}
                      {alert.message && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{alert.message}</p>
                      )}

                      {/* Client & metadata card */}
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {alert.conversation_id && (
                          <button
                            onClick={() => handleGoToConversation(alert.conversation_id!)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs font-medium text-green-400 hover:bg-green-500/20 hover:border-green-500/30 transition-all"
                          >
                            <MessageSquare className="size-3.5" />
                            <span>{clientName}</span>
                            {phone && <span className="text-green-400/60">({phone})</span>}
                            <ExternalLink className="size-3 ml-0.5" />
                          </button>
                        )}
                        {alert.metadata?.button_pressed != null && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted/80 border text-[11px] font-medium text-muted-foreground">
                            Calificacion: <strong className="text-foreground">{String(alert.metadata.button_pressed)}</strong>
                          </span>
                        )}
                      </div>

                      {/* Mark as read */}
                      {!alert.is_read && (
                        <button
                          onClick={() => handleMarkRead(alert.id)}
                          disabled={isMarking}
                          className="inline-flex items-center gap-1 mt-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="size-3" />
                          Descartar
                        </button>
                      )}
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
