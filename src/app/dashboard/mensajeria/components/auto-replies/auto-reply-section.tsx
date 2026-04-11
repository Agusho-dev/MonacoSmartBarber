'use client'

import { useState, useEffect, useTransition } from 'react'
import { Zap, Plus, Pencil, Trash2, Clock, MessageSquare, CalendarDays, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  getAutoReplyRules, createAutoReplyRule, updateAutoReplyRule,
  deleteAutoReplyRule, toggleAutoReplyRule,
} from '@/lib/actions/auto-replies'
import { useMensajeria } from '../shared/mensajeria-context'

interface AutoReplyRule {
  id: string
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  keywords: string[]
  match_mode: string
  response_type: string
  response_text: string | null
  response_template_name: string | null
  is_active: boolean
  platform: string
  priority: number
  tag_client_id: string | null
  tag?: { id: string; name: string; color: string } | null
  created_at: string
}

const TRIGGER_TYPES = [
  { value: 'keyword', label: 'Palabra clave', icon: MessageSquare, description: 'Responde cuando un mensaje contiene palabras clave' },
  { value: 'post_service', label: 'Post-servicio', icon: Clock, description: 'Envía un mensaje después de completar un servicio' },
  { value: 'days_after_visit', label: 'Seguimiento', icon: CalendarDays, description: 'Envía un mensaje X días después de la última visita' },
]

export function AutoReplySection() {
  const { tags } = useMensajeria()
  const [rules, setRules] = useState<AutoReplyRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<AutoReplyRule | null>(null)

  // Form
  const [formName, setFormName] = useState('')
  const [formTriggerType, setFormTriggerType] = useState('keyword')
  const [formKeywords, setFormKeywords] = useState('')
  const [formMatchMode, setFormMatchMode] = useState('contains')
  const [formResponseType, setFormResponseType] = useState('text')
  const [formResponseText, setFormResponseText] = useState('')
  const [formResponseTemplateName, setFormResponseTemplateName] = useState('')
  const [formPlatform, setFormPlatform] = useState('all')
  const [formPriority, setFormPriority] = useState(0)
  const [formDelayMinutes, setFormDelayMinutes] = useState(10)
  const [formDelayDays, setFormDelayDays] = useState(7)
  const [formTagClientId, setFormTagClientId] = useState<string>('')

  const [isSaving, startSaving] = useTransition()
  const [isToggling, startToggling] = useTransition()

  useEffect(() => {
    getAutoReplyRules().then(result => {
      if (result.data) setRules(result.data as AutoReplyRule[])
      setLoading(false)
    })
  }, [])

  const resetForm = () => {
    setFormName('')
    setFormTriggerType('keyword')
    setFormKeywords('')
    setFormMatchMode('contains')
    setFormResponseType('text')
    setFormResponseText('')
    setFormResponseTemplateName('')
    setFormPlatform('all')
    setFormPriority(0)
    setFormDelayMinutes(10)
    setFormDelayDays(7)
    setFormTagClientId('')
    setEditingRule(null)
  }

  const openEditor = (rule?: AutoReplyRule) => {
    if (rule) {
      setEditingRule(rule)
      setFormName(rule.name)
      setFormTriggerType(rule.trigger_type || 'keyword')
      setFormKeywords((rule.keywords ?? []).join(', '))
      setFormMatchMode(rule.match_mode)
      setFormResponseType(rule.response_type)
      setFormResponseText(rule.response_text || '')
      setFormResponseTemplateName(rule.response_template_name || '')
      setFormPlatform(rule.platform)
      setFormPriority(rule.priority)
      setFormDelayMinutes((rule.trigger_config as any)?.delay_minutes ?? 10)
      setFormDelayDays((rule.trigger_config as any)?.delay_days ?? 7)
      setFormTagClientId(rule.tag_client_id || '')
    } else {
      resetForm()
    }
    setShowEditor(true)
  }

  const buildTriggerConfig = () => {
    if (formTriggerType === 'post_service') return { delay_minutes: formDelayMinutes }
    if (formTriggerType === 'days_after_visit') return { delay_days: formDelayDays }
    return {}
  }

  const handleSave = () => {
    const keywords = formKeywords.split(',').map(k => k.trim()).filter(Boolean)
    if (!formName.trim()) {
      toast.error('El nombre es requerido'); return
    }
    if (formTriggerType === 'keyword' && keywords.length === 0) {
      toast.error('Las palabras clave son requeridas para este tipo de regla'); return
    }

    startSaving(async () => {
      const payload = {
        name: formName,
        triggerType: formTriggerType,
        triggerConfig: buildTriggerConfig(),
        keywords,
        matchMode: formMatchMode,
        responseType: formResponseType,
        responseText: formResponseText || undefined,
        responseTemplateName: formResponseTemplateName || undefined,
        platform: formPlatform,
        priority: formPriority,
        tagClientId: formTagClientId || null,
      }

      if (editingRule) {
        const result = await updateAutoReplyRule(editingRule.id, payload)
        if (result.error) { toast.error(result.error); return }
        // Refresh rules to get tag join
        const refreshed = await getAutoReplyRules()
        if (refreshed.data) setRules(refreshed.data as AutoReplyRule[])
        toast.success('Regla actualizada')
      } else {
        const result = await createAutoReplyRule(payload)
        if (result.error) { toast.error(result.error); return }
        // Refresh rules to get tag join
        const refreshed = await getAutoReplyRules()
        if (refreshed.data) setRules(refreshed.data as AutoReplyRule[])
        toast.success('Regla creada')
      }
      setShowEditor(false)
      resetForm()
    })
  }

  const handleDelete = async (id: string) => {
    const result = await deleteAutoReplyRule(id)
    if (result.error) { toast.error(result.error); return }
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('Regla eliminada')
  }

  const handleToggle = (id: string, isActive: boolean) => {
    startToggling(async () => {
      const result = await toggleAutoReplyRule(id, isActive)
      if (result.error) { toast.error(result.error); return }
      setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: isActive } : r))
    })
  }

  const triggerLabel = (type: string) => {
    const t = TRIGGER_TYPES.find(tt => tt.value === type)
    return t?.label ?? type
  }

  const triggerIcon = (type: string) => {
    if (type === 'post_service') return <Clock className="size-3 text-amber-400" />
    if (type === 'days_after_visit') return <CalendarDays className="size-3 text-blue-400" />
    return <MessageSquare className="size-3 text-green-400" />
  }

  return (
    <div className="flex flex-1 min-w-0">
      {/* Lista */}
      <div className="flex flex-col bg-background w-full lg:max-w-md shrink-0 border-r border">
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-400" />
            <span className="font-semibold text-foreground text-sm">Reglas de automatización</span>
          </div>
          <Button size="sm" onClick={() => openEditor()} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
            <Plus className="size-3 mr-1" /> Nueva
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-green-400" />
            </div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Zap className="mb-3 size-10 opacity-20" />
              <p className="text-sm">Sin reglas de automatización</p>
              <p className="text-xs mt-1 opacity-60">Creá reglas para responder automáticamente o hacer seguimiento</p>
            </div>
          ) : (
            <div>
              {rules.map(rule => (
                <div key={rule.id} className="px-4 py-3 border-b border space-y-2 hover:bg-muted transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {triggerIcon(rule.trigger_type)}
                      <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
                      {!rule.is_active && (
                        <Badge variant="outline" className="text-[10px] border-0 bg-muted text-muted-foreground">Inactiva</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggle(rule.id, !rule.is_active)}
                        disabled={isToggling}
                        className={`relative w-9 h-5 rounded-full transition-colors ${rule.is_active ? 'bg-green-500' : 'bg-muted'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${rule.is_active ? 'translate-x-4' : ''}`} />
                      </button>
                      <button onClick={() => openEditor(rule)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => handleDelete(rule.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Trigger info */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {triggerLabel(rule.trigger_type)}
                    </span>
                    {rule.trigger_type === 'post_service' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                        {(rule.trigger_config as any)?.delay_minutes ?? 10} min después
                      </span>
                    )}
                    {rule.trigger_type === 'days_after_visit' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                        {(rule.trigger_config as any)?.delay_days ?? 7} días después
                      </span>
                    )}
                    {rule.tag && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white flex items-center gap-1"
                        style={{ backgroundColor: rule.tag.color }}>
                        <Tag className="size-2.5" /> {rule.tag.name}
                      </span>
                    )}
                  </div>

                  {/* Keywords for keyword type */}
                  {rule.trigger_type === 'keyword' && rule.keywords && rule.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {rule.keywords.map((kw, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {rule.response_text && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{rule.response_text}</p>
                  )}
                  {rule.response_template_name && (
                    <p className="text-xs text-muted-foreground">Template: <span className="text-green-400">{rule.response_template_name}</span></p>
                  )}

                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    {rule.trigger_type === 'keyword' && (
                      <span>Modo: {rule.match_mode === 'contains' ? 'Contiene' : 'Exacto'}</span>
                    )}
                    <span>Plataforma: {rule.platform === 'all' ? 'Todas' : rule.platform}</span>
                    <span>Prioridad: {rule.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info panel */}
      <div className="hidden lg:flex flex-1 min-w-0 bg-background flex-col items-center justify-center gap-4">
        <div className="flex size-20 items-center justify-center rounded-full bg-muted border">
          <Zap className="size-10 text-amber-500/50" />
        </div>
        <div className="text-center max-w-xs">
          <p className="text-sm font-medium text-foreground/70 mb-1">Automatización inteligente</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Configurá reglas para responder automáticamente por palabra clave,
            enviar mensajes después de un servicio, o hacer seguimiento días después de una visita.
          </p>
        </div>
      </div>

      {/* Editor dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-4 text-amber-400" />
              {editingRule ? 'Editar regla' : 'Nueva regla'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Nombre */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nombre</Label>
              <Input className="bg-muted border text-foreground" placeholder="Ej: Bienvenida post-servicio"
                value={formName} onChange={e => setFormName(e.target.value)} />
            </div>

            {/* Tipo de trigger */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo de activación</Label>
              <div className="grid gap-2">
                {TRIGGER_TYPES.map(t => {
                  const Icon = t.icon
                  return (
                    <button key={t.value} onClick={() => setFormTriggerType(t.value)}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${formTriggerType === t.value ? 'border-amber-500/50 bg-amber-500/5' : 'border bg-muted hover:border-foreground/20'}`}>
                      <Icon className={`size-4 mt-0.5 shrink-0 ${formTriggerType === t.value ? 'text-amber-400' : 'text-muted-foreground'}`} />
                      <div>
                        <p className={`text-sm font-medium ${formTriggerType === t.value ? 'text-foreground' : 'text-muted-foreground'}`}>{t.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Config según trigger type */}
            {formTriggerType === 'keyword' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Palabras clave (separadas por coma)</Label>
                  <Input className="bg-muted border text-foreground" placeholder="horarios, horario, abierto"
                    value={formKeywords} onChange={e => setFormKeywords(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Modo de coincidencia</Label>
                  <select value={formMatchMode} onChange={e => setFormMatchMode(e.target.value)}
                    className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
                    <option value="contains">Contiene la palabra</option>
                    <option value="exact">Coincidencia exacta</option>
                  </select>
                </div>
              </>
            )}

            {formTriggerType === 'post_service' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Demora después del servicio</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={1440} className="bg-muted border text-foreground w-24"
                    value={formDelayMinutes} onChange={e => setFormDelayMinutes(parseInt(e.target.value) || 0)} />
                  <span className="text-xs text-muted-foreground">minutos</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Recomendado: 10-30 min. Da tiempo a que el cliente salga del local.</p>
              </div>
            )}

            {formTriggerType === 'days_after_visit' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Días después de la última visita</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min={1} max={365} className="bg-muted border text-foreground w-24"
                    value={formDelayDays} onChange={e => setFormDelayDays(parseInt(e.target.value) || 1)} />
                  <span className="text-xs text-muted-foreground">días</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Ej: 7 días para recordar turno, 30 días para reactivar.</p>
              </div>
            )}

            {/* Respuesta */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo de respuesta</Label>
              <select value={formResponseType} onChange={e => setFormResponseType(e.target.value)}
                className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
                <option value="text">Texto libre</option>
                <option value="template">Template de Meta</option>
              </select>
            </div>

            {formResponseType === 'text' ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Mensaje de respuesta</Label>
                <Textarea className="bg-muted border text-foreground placeholder:text-muted-foreground resize-none" rows={3}
                  placeholder="El texto que se envía automáticamente..."
                  value={formResponseText} onChange={e => setFormResponseText(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nombre del template</Label>
                <Input className="bg-muted border text-foreground" placeholder="nombre_template"
                  value={formResponseTemplateName} onChange={e => setFormResponseTemplateName(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">El template debe estar aprobado en Meta. Los templates funcionan fuera de la ventana de 24h.</p>
              </div>
            )}

            {/* Tag assignment */}
            {tags.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Etiquetar conversación al activarse</Label>
                <select value={formTagClientId} onChange={e => setFormTagClientId(e.target.value)}
                  className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
                  <option value="">Sin etiqueta</option>
                  {tags.map(tag => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">Se asigna automáticamente esta etiqueta a la conversación cuando la regla se activa.</p>
              </div>
            )}

            {/* Platform + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Plataforma</Label>
                <select value={formPlatform} onChange={e => setFormPlatform(e.target.value)}
                  className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
                  <option value="all">Todas</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Prioridad</Label>
                <Input type="number" className="bg-muted border text-foreground"
                  value={formPriority} onChange={e => setFormPriority(parseInt(e.target.value) || 0)} />
                <p className="text-[10px] text-muted-foreground">Mayor = se evalúa primero</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowEditor(false); resetForm() }} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Guardando...' : editingRule ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
