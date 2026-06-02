'use client'

import { useState, useEffect, useTransition, useCallback, useMemo } from 'react'
import { Frown, Star, MessageSquare, Check, X, Clock, User, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCrmCases, updateCrmCase, type CrmCaseRow, type CrmCaseStatus } from '@/lib/actions/crm-cases'
import { useMensajeria } from '../shared/mensajeria-context'
import { createClient } from '@/lib/supabase/client'
import { displayName } from '../shared/helpers'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

const STATUS_CONFIG: Record<CrmCaseStatus, { label: string; badge: string; dot: string }> = {
  open:      { label: 'Abierto',    badge: 'bg-red-500/10 text-red-400 border-red-500/20',     dot: 'bg-red-500' },
  contacted: { label: 'Contactado', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', dot: 'bg-amber-500' },
  resolved:  { label: 'Resuelto',   badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500' },
  dismissed: { label: 'Descartado', badge: 'bg-muted text-muted-foreground border-border',     dot: 'bg-muted-foreground' },
}

function Stars({ rating }: { rating: number | null }) {
  const r = rating ?? 0
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-3.5 ${i <= r ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  )
}

export function CrmCasesPanel({ onNavigateToInbox }: { onNavigateToInbox?: () => void } = {}) {
  const { conversations, setActiveConv, setShowMobileChat, handleStartConversation } = useMensajeria()
  const [cases, setCases] = useState<CrmCaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [isActing, startActing] = useTransition()

  const loadCases = useCallback(async () => {
    const result = await getCrmCases()
    setCases(result.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getCrmCases()
      if (!cancelled) { setCases(result.data); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: refrescar cuando entra un caso nuevo (review ≤2★) o cambia uno.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('crm-cases-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_cases' }, () => { loadCases() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadCases])

  const handleStatus = (caseId: string, status: CrmCaseStatus) => {
    // Optimista
    setCases(prev => prev.map(c => c.id === caseId
      ? { ...c, status, resolved_at: ['resolved', 'dismissed'].includes(status) ? new Date().toISOString() : null }
      : c))
    startActing(async () => {
      const res = await updateCrmCase(caseId, { status })
      if (res.error) { toast.error(res.error); loadCases() }
    })
  }

  const handleResponder = (clientId: string | null | undefined) => {
    if (!clientId) { toast.error('El caso no tiene un cliente vinculado'); return }
    const conv = conversations.find(c => c.client_id === clientId || c.client?.id === clientId)
    if (conv) {
      setActiveConv(conv)
      setShowMobileChat(true)
      onNavigateToInbox?.()
    } else {
      handleStartConversation(clientId)
      onNavigateToInbox?.()
    }
  }

  const visible = useMemo(
    () => cases.filter(c => showResolved || (c.status !== 'resolved' && c.status !== 'dismissed')),
    [cases, showResolved],
  )
  const pendingCount = useMemo(() => cases.filter(c => c.status === 'open' || c.status === 'contacted').length, [cases])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-full border-2 border-orange-500/30 border-t-orange-500 animate-spin" />
          <span className="text-sm text-muted-foreground">Cargando casos...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border shrink-0 bg-card/50">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-orange-500/15 flex items-center justify-center">
            <Frown className="size-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">Casos de atención</h2>
            <p className="text-[11px] text-muted-foreground">
              {pendingCount > 0 ? `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'} · reseñas de ≤2★` : 'Sin casos pendientes'}
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="min-w-6 h-6 flex items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white px-2">
              {pendingCount}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowResolved(v => !v)}
          className="text-xs h-8 gap-1.5 border-dashed"
        >
          {showResolved ? 'Ocultar cerrados' : 'Ver todos'}
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Frown className="size-8 opacity-30" />
            </div>
            <p className="text-sm font-medium">Sin casos {showResolved ? '' : 'pendientes'}</p>
            <p className="text-xs mt-1 text-center max-w-[240px]">
              Cuando un cliente deja una reseña de 2★ o menos, aparece acá para que puedas hacer seguimiento.
            </p>
          </div>
        ) : (
          visible.map((c) => {
            const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.open
            const name = displayName(c.client?.name || c.client?.phone || 'Cliente', c.client?.instagram ? 'instagram' : 'whatsapp')
            const when = formatDistanceToNow(new Date(c.review?.created_at ?? c.created_at), { addSuffix: true, locale: es })
            const categories = c.review?.improvement_categories ?? []
            const closed = c.status === 'resolved' || c.status === 'dismissed'
            return (
              <div
                key={c.id}
                className={`relative rounded-xl border p-4 transition-all ${closed ? 'opacity-70 bg-card/40 border-border/50' : 'bg-card border shadow-sm'}`}
              >
                <div className="flex gap-4">
                  <div className="shrink-0 mt-0.5">
                    <div className="size-10 rounded-2xl bg-orange-500/10 flex items-center justify-center">
                      <User className="size-5 text-orange-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[13px] font-bold text-foreground truncate">{name}</h4>
                          <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cfg.badge}`}>
                            <span className={`size-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Stars rating={c.review?.rating ?? null} />
                          {c.branch?.name && <span className="text-[11px] text-muted-foreground">· {c.branch.name}</span>}
                        </div>
                      </div>
                      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground whitespace-nowrap shrink-0">
                        <Clock className="size-3 opacity-70" />{when}
                      </span>
                    </div>

                    {/* Comment */}
                    {c.review?.comment && (
                      <p className="text-[13px] text-foreground/90 leading-relaxed bg-background/60 border border-border/40 rounded-lg px-3 py-2">
                        “{c.review.comment}”
                      </p>
                    )}

                    {/* Categories */}
                    {categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {categories.map((cat, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 mt-0.5 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        {c.status !== 'contacted' && !closed && (
                          <button onClick={() => handleStatus(c.id, 'contacted')} disabled={isActing}
                            className="h-7 px-2.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                            Marcar contactado
                          </button>
                        )}
                        {!closed ? (
                          <>
                            <button onClick={() => handleStatus(c.id, 'resolved')} disabled={isActing}
                              className="h-7 px-2.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1 transition-colors">
                              <Check className="size-3" /> Resolver
                            </button>
                            <button onClick={() => handleStatus(c.id, 'dismissed')} disabled={isActing}
                              className="h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1 transition-colors">
                              <X className="size-3" /> Descartar
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleStatus(c.id, 'open')} disabled={isActing}
                            className="h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1 transition-colors">
                            <RotateCcw className="size-3" /> Reabrir
                          </button>
                        )}
                      </div>
                      <button onClick={() => handleResponder(c.client?.id)}
                        className="h-8 px-4 rounded-full inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider bg-green-500 hover:bg-green-600 text-white transition-all shadow-sm hover:shadow-md">
                        <MessageSquare className="size-3.5" /> Contactar
                      </button>
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
