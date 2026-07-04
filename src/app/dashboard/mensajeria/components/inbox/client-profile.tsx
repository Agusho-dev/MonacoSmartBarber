'use client'

import { X, CheckCircle2, Archive, RotateCcw, Calendar, ArrowLeft } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar } from '../shared/avatar'
import { StatusBadge } from '../shared/icons'
import { displayName, formatCurrency } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'

export function ClientProfile() {
  const {
    activeConv, showProfile, setShowProfile,
    tags, clientVisits, loadingVisits,
    handleStatusChange, handleToggleTag,
    taggingConv,
  } = useMensajeria()

  if (!showProfile || !activeConv) return null

  const activeConvName = displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform)

  return (
    <div className="fixed inset-0 z-[60] flex h-full min-h-0 flex-col bg-[#111b21] lg:static lg:inset-auto lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-[#222d34]">
      <div className="flex shrink-0 items-center gap-4 px-4 h-16 bg-[#202c33]">
        <button onClick={() => setShowProfile(false)} className="flex items-center text-[#aebac1] hover:text-[#e9edef]" aria-label="Cerrar">
          <span className="lg:hidden"><ArrowLeft className="size-5" /></span>
          <span className="hidden lg:inline"><X className="size-5" /></span>
        </button>
        <span className="text-[16px] font-medium text-[#e9edef]">Info. del contacto</span>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden wa-scroll">
        <div className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {/* Avatar + nombre */}
          <div className="flex flex-col items-center gap-2 py-6 bg-[#111b21]">
            <Avatar name={activeConvName} size={28} avatarUrl={activeConv.platform_user_avatar} />
            <p className="font-medium text-[#e9edef] text-xl text-center px-4 mt-2">{activeConvName}</p>
            {activeConv.client?.phone && (
              <p className="text-sm text-[#8696a0]">{activeConv.client.phone}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={activeConv.status} />
              {activeConv.status === 'open' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#00a884]/15 text-[#00a884]">Activo</span>}
            </div>
          </div>

          {/* Acciones rápidas */}
          <div className="bg-[#182229] px-4 py-3 space-y-2">
            <p className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider">Acciones</p>
            <div className="grid grid-cols-2 gap-2">
              {activeConv.status === 'open' ? (
                <>
                  <button onClick={() => handleStatusChange('closed')}
                    className="flex items-center gap-1.5 px-2 py-2 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-xs text-[#aebac1] hover:text-[#e9edef] transition-colors">
                    <CheckCircle2 className="size-3.5 text-blue-400" /> Cerrar
                  </button>
                  <button onClick={() => handleStatusChange('archived')}
                    className="flex items-center gap-1.5 px-2 py-2 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-xs text-[#aebac1] hover:text-[#e9edef] transition-colors">
                    <Archive className="size-3.5" /> Archivar
                  </button>
                </>
              ) : (
                <button onClick={() => handleStatusChange('open')}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-[#00a884]/15 hover:bg-[#00a884]/25 text-xs text-[#00a884] transition-colors">
                  <RotateCcw className="size-3.5" /> Reabrir conversación
                </button>
              )}
              <button
                className="col-span-2 flex items-center gap-1.5 px-2 py-2 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-xs text-[#aebac1] hover:text-[#e9edef] transition-colors">
                <Calendar className="size-3.5" /> Programar mensaje
              </button>
            </div>
          </div>

          {/* Etiquetas */}
          {tags.length > 0 && (
            <div className="bg-[#182229] mt-2 px-4 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider">Etiquetas</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => {
                  const assigned = activeConv.tags?.some(t => t.tag_id === tag.id)
                  return (
                    <button key={tag.id} onClick={() => handleToggleTag(activeConv.id, tag.id)}
                      disabled={taggingConv}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all border ${assigned ? 'text-white border-transparent' : 'text-[#8696a0] border-[#2a3942] hover:border-[#3b4a54]'}`}
                      style={assigned ? { backgroundColor: tag.color } : {}}>
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historial de visitas */}
          <div className="bg-[#182229] mt-2 px-4 py-3 space-y-2">
            <p className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider">Últimas visitas</p>
            {loadingVisits ? (
              <div className="flex justify-center py-4">
                <div className="size-4 animate-spin rounded-full border-2 border-[#2a3942] border-t-[#00a884]" />
              </div>
            ) : clientVisits.length === 0 ? (
              <p className="text-xs text-[#8696a0] italic">Sin visitas registradas</p>
            ) : (
              <div className="space-y-2">
                {clientVisits.map(visit => (
                  <div key={visit.id} className="rounded-lg bg-[#202c33] p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#e9edef] font-medium">{visit.service?.name || 'Servicio'}</span>
                      <span className="text-xs text-[#00a884] font-semibold">{formatCurrency(visit.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-[#8696a0]">{visit.barber?.full_name}</span>
                      <span className="text-[10px] text-[#8696a0]">
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
            <div className="bg-[#182229] mt-2 px-4 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider">Notas</p>
              <p className="text-xs text-[#8696a0] bg-[#202c33] rounded-lg p-2.5 leading-relaxed">{activeConv.client.notes}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
