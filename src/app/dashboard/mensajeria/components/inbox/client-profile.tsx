'use client'

import { X, CheckCircle2, Archive, RotateCcw, Calendar } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Avatar } from '../shared/avatar'
import { StatusBadge } from '../shared/icons'
import { displayName, formatCurrency } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'

export function ClientProfile() {
  const {
    activeConv, showProfile, setShowProfile,
    tags, clientVisits, loadingVisits,
    handleStatusChange, handleToggleTag,
    taggingConv, isActing,
  } = useMensajeria()

  if (!showProfile || !activeConv) return null

  const activeConvName = displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform)

  return (
    <div className="hidden lg:flex h-full min-h-0 flex-col w-72 shrink-0 bg-background border-l border">
      <div className="flex shrink-0 items-center justify-between px-4 py-3 bg-card border-b border">
        <span className="text-sm font-semibold text-foreground">Perfil del cliente</span>
        <button onClick={() => setShowProfile(false)} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="p-4 space-y-5">
          {/* Avatar + nombre */}
          <div className="flex flex-col items-center gap-2 pt-2">
            <Avatar name={activeConvName} size={16} />
            <p className="font-semibold text-foreground text-center">{activeConvName}</p>
            {activeConv.client?.phone && (
              <p className="text-xs text-muted-foreground">{activeConv.client.phone}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={activeConv.status} />
              {activeConv.status === 'open' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">Activo</span>}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Acciones rápidas */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Acciones</p>
            <div className="grid grid-cols-2 gap-2">
              {activeConv.status === 'open' ? (
                <>
                  <button onClick={() => handleStatusChange('closed')}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <CheckCircle2 className="size-3.5" /> Cerrar
                  </button>
                  <button onClick={() => handleStatusChange('archived')}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Archive className="size-3.5" /> Archivar
                  </button>
                </>
              ) : (
                <button onClick={() => handleStatusChange('open')}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-green-600/10 hover:bg-green-600/20 text-xs text-green-400 transition-colors">
                  <RotateCcw className="size-3.5" /> Reabrir conversación
                </button>
              )}
              <button
                className="col-span-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Calendar className="size-3.5" /> Programar mensaje
              </button>
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Etiquetas */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Etiquetas</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => {
                  const assigned = activeConv.tags?.some(t => t.tag_id === tag.id)
                  return (
                    <button key={tag.id} onClick={() => handleToggleTag(activeConv.id, tag.id)}
                      disabled={taggingConv}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all border ${assigned ? 'text-white border-transparent' : 'text-muted-foreground border hover:border'}`}
                      style={assigned ? { backgroundColor: tag.color } : {}}>
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <Separator className="bg-border" />

          {/* Historial de visitas */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Últimas visitas</p>
            {loadingVisits ? (
              <div className="flex justify-center py-4">
                <div className="size-4 animate-spin rounded-full border-2 border border-t-green-400" />
              </div>
            ) : clientVisits.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sin visitas registradas</p>
            ) : (
              <div className="space-y-2">
                {clientVisits.map(visit => (
                  <div key={visit.id} className="rounded-lg bg-card p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-foreground font-medium">{visit.service?.name || 'Servicio'}</span>
                      <span className="text-xs text-green-400 font-semibold">{formatCurrency(visit.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">{visit.barber?.full_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(visit.started_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notas del cliente */}
          {activeConv.client?.notes && (
            <>
              <Separator className="bg-border" />
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notas</p>
                <p className="text-xs text-muted-foreground bg-card rounded-lg p-2.5 leading-relaxed">{activeConv.client.notes}</p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
