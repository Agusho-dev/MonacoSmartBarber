'use client'

import { useState, useEffect, useTransition } from 'react'
import { Megaphone, Plus, Send, Users, Clock, X, ChevronRight, ChevronLeft, Check, AlertCircle, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { getBroadcasts, createBroadcast, sendBroadcast, cancelBroadcast } from '@/lib/actions/broadcasts'
import { previewAudience } from '@/lib/actions/client-segments'
import { useMensajeria } from '../shared/mensajeria-context'
import type { AudienceFilters } from '@/lib/actions/client-segments'

interface Broadcast {
  id: string
  name: string
  status: string
  template_name: string | null
  audience_count: number
  sent_count: number
  delivered_count: number
  failed_count: number
  scheduled_for: string | null
  created_at: string
}

const SEGMENTS = [
  { key: 'nuevo', label: 'Nuevo', color: 'bg-blue-500' },
  { key: 'regular', label: 'Regular', color: 'bg-green-500' },
  { key: 'vip', label: 'VIP', color: 'bg-amber-500' },
  { key: 'en_riesgo', label: 'En riesgo', color: 'bg-orange-500' },
  { key: 'perdido', label: 'Perdido', color: 'bg-red-500' },
]

const CONTACT_RANGES = [
  { label: 'Sin filtro', maxDays: undefined, minDays: undefined },
  { label: 'Esta semana', maxDays: 7, minDays: undefined },
  { label: 'Este mes', maxDays: 30, minDays: undefined },
  { label: '1-3 meses', maxDays: 90, minDays: 30 },
  { label: '+3 meses', maxDays: undefined, minDays: 90 },
]

export function BroadcastSection() {
  const { waTemplates, handleSyncTemplates, syncingTemplates, tags } = useMensajeria()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)

  // Wizard state
  const [name, setName] = useState('')
  const [selectedSegments, setSelectedSegments] = useState<string[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [contactRange, setContactRange] = useState(0)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [isCreating, startCreating] = useTransition()
  const [isSending, startSending] = useTransition()

  // Load broadcasts
  useEffect(() => {
    getBroadcasts().then(result => {
      if (result.data) setBroadcasts(result.data as Broadcast[])
      setLoading(false)
    })
  }, [])

  // Sync templates on wizard open
  useEffect(() => {
    if (showWizard && waTemplates.length === 0) {
      handleSyncTemplates()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWizard])

  // Preview audience
  useEffect(() => {
    if (!showWizard || wizardStep !== 1) return
    const filters: AudienceFilters = {
      segments: selectedSegments.length > 0 ? selectedSegments : undefined,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      lastContactDays: CONTACT_RANGES[contactRange].maxDays,
      lastContactMin: CONTACT_RANGES[contactRange].minDays,
      hasPhone: true,
    }
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      previewAudience(filters).then(result => {
        setAudienceCount(result.count)
        setPreviewLoading(false)
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [showWizard, wizardStep, selectedSegments, selectedTagIds, contactRange])

  const handleCreate = () => {
    if (!name.trim()) { toast.error('Nombre requerido'); return }
    if (!selectedTemplate) { toast.error('Seleccioná un template'); return }
    startCreating(async () => {
      const filters: AudienceFilters = {
        segments: selectedSegments.length > 0 ? selectedSegments : undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        lastContactDays: CONTACT_RANGES[contactRange].maxDays,
        lastContactMin: CONTACT_RANGES[contactRange].minDays,
        hasPhone: true,
      }
      const result = await createBroadcast({
        name: name.trim(),
        templateName: selectedTemplate,
        audienceFilters: filters,
        scheduledFor: scheduledFor || undefined,
      })
      if (result.error) { toast.error(result.error); return }
      toast.success('Difusión creada')
      setBroadcasts(prev => [result.data as Broadcast, ...prev])
      resetWizard()
    })
  }

  const handleSend = (id: string) => {
    startSending(async () => {
      const result = await sendBroadcast(id)
      if (result.error) { toast.error(result.error); return }
      toast.success(`Enviando a ${result.recipientCount} destinatarios`)
      setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, status: 'sending', audience_count: result.recipientCount ?? b.audience_count } : b))
    })
  }

  const handleCancel = async (id: string) => {
    const result = await cancelBroadcast(id)
    if (result.error) { toast.error(result.error); return }
    toast.success('Difusión cancelada')
    setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b))
  }

  const resetWizard = () => {
    setShowWizard(false)
    setWizardStep(1)
    setName('')
    setSelectedSegments([])
    setSelectedTagIds([])
    setContactRange(0)
    setSelectedTemplate('')
    setScheduledFor('')
    setAudienceCount(null)
  }

  const toggleSegment = (seg: string) => {
    setSelectedSegments(prev => prev.includes(seg) ? prev.filter(s => s !== seg) : [...prev, seg])
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'draft': return { text: 'Borrador', cls: 'bg-white/10 text-muted-foreground' }
      case 'scheduled': return { text: 'Programada', cls: 'bg-blue-500/10 text-blue-400' }
      case 'sending': return { text: 'Enviando', cls: 'bg-yellow-500/10 text-yellow-400' }
      case 'sent': return { text: 'Enviada', cls: 'bg-green-500/10 text-green-400' }
      case 'cancelled': return { text: 'Cancelada', cls: 'bg-red-500/10 text-red-400' }
      default: return { text: status, cls: 'bg-white/10 text-muted-foreground' }
    }
  }

  return (
    <div className="flex flex-1 min-w-0">
      {/* Lista */}
      <div className={`flex flex-col border-r border bg-background w-full ${showWizard ? 'hidden lg:flex lg:w-[340px]' : ''} lg:max-w-sm shrink-0`}>
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-green-400" />
            <span className="font-semibold text-white text-sm">Difusiones</span>
          </div>
          <Button size="sm" onClick={() => setShowWizard(true)} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
            <Plus className="size-3 mr-1" /> Nueva
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border border-t-green-400" />
            </div>
          ) : broadcasts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Megaphone className="mb-3 size-10 opacity-20" />
              <p className="text-sm">Sin difusiones</p>
              <p className="text-xs mt-1 opacity-60">Creá tu primera campaña masiva</p>
            </div>
          ) : (
            <div>
              {broadcasts.map(b => {
                const { text, cls } = statusLabel(b.status)
                return (
                  <div key={b.id} className="px-4 py-3 border-b border space-y-2 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white truncate">{b.name}</span>
                      <Badge variant="outline" className={`shrink-0 text-[10px] border-0 ${cls}`}>{text}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {b.template_name && <span>📋 {b.template_name}</span>}
                      {b.audience_count > 0 && <span className="flex items-center gap-1"><Users className="size-3" /> {b.audience_count}</span>}
                    </div>
                    {b.status === 'sent' && (
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-green-400">Enviados: {b.sent_count}</span>
                        <span className="text-blue-400">Entregados: {b.delivered_count}</span>
                        {b.failed_count > 0 && <span className="text-red-400">Fallidos: {b.failed_count}</span>}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="flex gap-1.5">
                        {b.status === 'draft' && (
                          <button onClick={() => handleSend(b.id)} disabled={isSending}
                            className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5">
                            <Send className="size-2.5" /> Enviar
                          </button>
                        )}
                        {['draft', 'scheduled', 'sending'].includes(b.status) && (
                          <button onClick={() => handleCancel(b.id)}
                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5">
                            <X className="size-2.5" /> Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Wizard / Detalle */}
      <div className={`flex-1 min-w-0 bg-background ${!showWizard ? 'hidden lg:flex' : 'flex'} flex-col`}>
        {!showWizard ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-20 items-center justify-center rounded-full bg-white/5 border border">
              <Megaphone className="size-10 text-green-500/50" />
            </div>
            <p className="text-sm text-muted-foreground">Seleccioná una difusión o creá una nueva</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Wizard header */}
            <div className="flex items-center justify-between px-6 py-3 bg-card border-b border">
              <div className="flex items-center gap-3">
                <button onClick={resetWizard} className="text-muted-foreground hover:text-white">
                  <X className="size-4" />
                </button>
                <span className="font-semibold text-white text-sm">Nueva difusión</span>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map(s => (
                  <div key={s} className={`size-2 rounded-full ${wizardStep >= s ? 'bg-green-400' : 'bg-white/10'}`} />
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Step 1: Audiencia */}
              {wizardStep === 1 && (
                <div className="space-y-6 max-w-lg">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Nombre de la difusión</Label>
                    <Input
                      className="bg-card border text-white"
                      placeholder="Ej: Promo invierno VIP"
                      value={name} onChange={e => setName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Segmentos de clientes</Label>
                    <div className="flex flex-wrap gap-2">
                      {SEGMENTS.map(({ key, label, color }) => (
                        <button key={key} onClick={() => toggleSegment(key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            selectedSegments.includes(key)
                              ? 'text-white border-transparent bg-green-600'
                              : 'text-muted-foreground border hover:border-foreground/20'
                          }`}>
                          <span className={`size-2 rounded-full ${color}`} />
                          {label}
                        </button>
                      ))}
                    </div>
                    {selectedSegments.length === 0 && (
                      <p className="text-[10px] text-muted-foreground">Sin filtro = todos los segmentos</p>
                    )}
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider">Etiquetas</Label>
                      <div className="flex flex-wrap gap-2">
                        {tags.map(tag => (
                          <button key={tag.id}
                            onClick={() => setSelectedTagIds(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                              selectedTagIds.includes(tag.id)
                                ? 'text-white border-transparent'
                                : 'text-muted-foreground border hover:border-foreground/20'
                            }`}
                            style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.color } : {}}>
                            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Último contacto</Label>
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_RANGES.map((range, i) => (
                        <button key={i} onClick={() => setContactRange(i)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            contactRange === i
                              ? 'text-white border-transparent bg-green-600'
                              : 'text-muted-foreground border hover:border-foreground/20'
                          }`}>
                          {range.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Audience count */}
                  <div className="rounded-lg bg-card border border p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="size-5 text-green-400" />
                      <span className="text-sm text-white">Audiencia estimada</span>
                    </div>
                    {previewLoading ? (
                      <div className="size-4 animate-spin rounded-full border-2 border border-t-green-400" />
                    ) : (
                      <span className="text-lg font-bold text-green-400">{audienceCount ?? '—'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Mensaje */}
              {wizardStep === 2 && (
                <div className="space-y-6 max-w-lg">
                  <div>
                    <p className="text-xs font-semibold text-white mb-1">Seleccioná un template</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      WhatsApp requiere templates aprobados por Meta para envíos masivos fuera de la ventana de 24h.
                    </p>
                  </div>
                  {syncingTemplates ? (
                    <div className="flex justify-center py-8">
                      <div className="size-5 animate-spin rounded-full border-2 border border-t-green-400" />
                    </div>
                  ) : waTemplates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-xs">No se encontraron templates</p>
                      <button onClick={handleSyncTemplates} className="mt-2 text-xs text-green-400 hover:underline">
                        Sincronizar desde Meta
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {waTemplates.map(tpl => (
                        <button key={tpl.id} onClick={() => setSelectedTemplate(tpl.name)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selectedTemplate === tpl.name
                              ? 'border-green-500 bg-green-500/5'
                              : 'border bg-white/5 hover:bg-white/10'
                          }`}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-white">{tpl.name}</p>
                            {selectedTemplate === tpl.name && <Check className="size-4 text-green-400" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">{tpl.language}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{tpl.category}</span>
                          </div>
                          {tpl.components?.map((comp: any, i: number) => (
                            comp.type === 'BODY' && comp.text ? (
                              <p key={i} className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{comp.text}</p>
                            ) : null
                          ))}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Confirmar */}
              {wizardStep === 3 && (
                <div className="space-y-6 max-w-lg">
                  <p className="text-xs font-semibold text-white">Resumen de la difusión</p>
                  <div className="space-y-3 rounded-lg bg-card border border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Nombre</span>
                      <span className="text-sm text-white font-medium">{name || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Audiencia</span>
                      <span className="text-sm text-green-400 font-bold">{audienceCount ?? '—'} clientes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Template</span>
                      <span className="text-sm text-white">{selectedTemplate || '—'}</span>
                    </div>
                    {selectedSegments.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Segmentos</span>
                        <div className="flex gap-1">
                          {selectedSegments.map(s => (
                            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Programar (opcional)</Label>
                    <Input
                      type="datetime-local"
                      className="bg-card border text-white"
                      value={scheduledFor}
                      onChange={e => setScheduledFor(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Dejá vacío para enviar ahora</p>
                  </div>

                  {audienceCount === 0 && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                      <p className="text-xs text-red-400">No hay clientes que coincidan con los filtros seleccionados</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Wizard footer */}
            <div className="flex items-center justify-between px-6 py-3 bg-card border-t border">
              <Button variant="ghost" onClick={() => wizardStep > 1 ? setWizardStep(s => s - 1) : resetWizard()}
                className="text-muted-foreground hover:text-white">
                <ChevronLeft className="size-4 mr-1" />
                {wizardStep > 1 ? 'Anterior' : 'Cancelar'}
              </Button>
              {wizardStep < 3 ? (
                <Button onClick={() => setWizardStep(s => s + 1)}
                  disabled={wizardStep === 2 && !selectedTemplate}
                  className="bg-green-600 hover:bg-green-500 text-white">
                  Siguiente <ChevronRight className="size-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={isCreating || audienceCount === 0}
                  className="bg-green-600 hover:bg-green-500 text-white">
                  {isCreating ? 'Creando...' : scheduledFor ? 'Programar' : 'Crear y enviar'}
                  <Send className="size-3.5 ml-1.5" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
