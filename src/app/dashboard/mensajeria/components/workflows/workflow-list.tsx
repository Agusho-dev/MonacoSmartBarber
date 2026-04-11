'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Zap, Plus, Pencil, Trash2, MessageSquare, Clock, CalendarDays, GitBranch,
  Play, Pause, MoreVertical, Bell,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  getWorkflows, createWorkflow, deleteWorkflow, toggleWorkflow,
  getUnreadAlertCount,
} from '@/lib/actions/workflows'
import type { AutomationWorkflow } from '@/lib/types/database'
import { useMensajeria } from '../shared/mensajeria-context'
import { WorkflowBuilder } from './workflow-builder'

const TRIGGER_TYPES = [
  { value: 'keyword', label: 'Palabra clave', icon: MessageSquare, description: 'Responde cuando un mensaje contiene palabras clave' },
  { value: 'template_reply', label: 'Respuesta a template', icon: GitBranch, description: 'Se activa cuando un cliente responde a un template (ej: botones de reseña)' },
  { value: 'post_service', label: 'Post-servicio', icon: Clock, description: 'Envía un mensaje después de completar un servicio' },
  { value: 'days_after_visit', label: 'Seguimiento', icon: CalendarDays, description: 'Envía un mensaje X días después de la última visita' },
]

const CHANNEL_OPTIONS = [
  { value: 'all', label: 'Todos los canales' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
]

export function WorkflowList() {
  const { waTemplates, handleSyncTemplates, syncingTemplates } = useMensajeria()
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [alertCount, setAlertCount] = useState(0)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null)

  // New workflow form
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formTriggerType, setFormTriggerType] = useState('keyword')
  const [formChannel, setFormChannel] = useState('all')
  const [formKeywords, setFormKeywords] = useState('')
  const [formMatchMode, setFormMatchMode] = useState('contains')
  const [formTemplateName, setFormTemplateName] = useState('')
  const [formDelayMinutes, setFormDelayMinutes] = useState(15)
  const [formDelayDays, setFormDelayDays] = useState(7)

  const [isCreating, startCreating] = useTransition()
  const [isToggling, startToggling] = useTransition()

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getUnreadAlertCount(),
    ]).then(([wfResult, alertResult]) => {
      if (wfResult.data) setWorkflows(wfResult.data)
      setAlertCount(alertResult.count)
      setLoading(false)
    })
  }, [])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormTriggerType('keyword')
    setFormChannel('all')
    setFormKeywords('')
    setFormMatchMode('contains')
    setFormTemplateName('')
    setFormDelayMinutes(15)
    setFormDelayDays(7)
  }

  const buildTriggerConfig = () => {
    if (formTriggerType === 'keyword') {
      return {
        keywords: formKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
        match_mode: formMatchMode,
      }
    }
    if (formTriggerType === 'template_reply') {
      return { template_name: formTemplateName }
    }
    if (formTriggerType === 'post_service') {
      return { delay_minutes: formDelayMinutes }
    }
    if (formTriggerType === 'days_after_visit') {
      return { delay_days: formDelayDays }
    }
    return {}
  }

  const handleCreate = () => {
    if (!formName.trim()) { toast.error('El nombre es requerido'); return }
    if (formTriggerType === 'keyword') {
      const kws = formKeywords.split(',').filter(k => k.trim())
      if (kws.length === 0) { toast.error('Las palabras clave son requeridas'); return }
    }
    if (formTriggerType === 'template_reply' && !formTemplateName.trim()) {
      toast.error('El nombre del template es requerido'); return
    }

    startCreating(async () => {
      const result = await createWorkflow({
        name: formName,
        description: formDescription || undefined,
        channels: [formChannel],
        trigger_type: formTriggerType,
        trigger_config: buildTriggerConfig(),
      })
      if (result.error) { toast.error(result.error); return }
      if (result.data) {
        setWorkflows(prev => [result.data!, ...prev])
        setShowNewDialog(false)
        resetForm()
        // Abrir el builder directamente
        setEditingWorkflowId(result.data.id)
        toast.success('Workflow creado. Configurá los pasos.')
      }
    })
  }

  const handleDelete = async (id: string) => {
    const result = await deleteWorkflow(id)
    if (result.error) { toast.error(result.error); return }
    setWorkflows(prev => prev.filter(w => w.id !== id))
    toast.success('Workflow eliminado')
  }

  const handleToggle = (id: string, isActive: boolean) => {
    startToggling(async () => {
      const result = await toggleWorkflow(id, isActive)
      if (result.error) { toast.error(result.error); return }
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, is_active: isActive } : w))
    })
  }

  const triggerIcon = (type: string) => {
    switch (type) {
      case 'template_reply': return <GitBranch className="size-3.5 text-purple-400" />
      case 'post_service': return <Clock className="size-3.5 text-amber-400" />
      case 'days_after_visit': return <CalendarDays className="size-3.5 text-blue-400" />
      default: return <MessageSquare className="size-3.5 text-green-400" />
    }
  }

  const triggerLabel = (type: string) => {
    return TRIGGER_TYPES.find(t => t.value === type)?.label ?? type
  }

  const channelLabel = (channels: string[]) => {
    if (channels.includes('all')) return 'Todos'
    return channels.map(c => c === 'whatsapp' ? 'WPP' : c === 'instagram' ? 'IG' : c).join(', ')
  }

  // Si hay un workflow abierto en el builder, mostrar el builder
  if (editingWorkflowId) {
    return (
      <WorkflowBuilder
        workflowId={editingWorkflowId}
        onBack={() => {
          setEditingWorkflowId(null)
          // Refresh workflows
          getWorkflows().then(r => { if (r.data) setWorkflows(r.data) })
        }}
      />
    )
  }

  return (
    <div className="flex flex-1 min-w-0">
      {/* Lista */}
      <div className="flex flex-col bg-background w-full lg:max-w-md shrink-0 border-r border">
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-400" />
            <span className="font-semibold text-foreground text-sm">Automatizaciones</span>
            {alertCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">
                <Bell className="size-2.5" /> {alertCount}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => setShowNewDialog(true)} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
            <Plus className="size-3 mr-1" /> Nuevo workflow
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-green-400" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Zap className="mb-3 size-10 opacity-20" />
              <p className="text-sm">Sin automatizaciones</p>
              <p className="text-xs mt-1 opacity-60">Creá workflows para automatizar respuestas, reseñas y seguimientos</p>
            </div>
          ) : (
            <div>
              {workflows.map(wf => (
                <div
                  key={wf.id}
                  className="px-4 py-3 border-b border space-y-2 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setEditingWorkflowId(wf.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {triggerIcon(wf.trigger_type)}
                      <span className="text-sm font-medium text-foreground truncate">{wf.name}</span>
                      {!wf.is_active && (
                        <Badge variant="outline" className="text-[10px] border-0 bg-muted text-muted-foreground">Inactivo</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleToggle(wf.id, !wf.is_active)}
                        disabled={isToggling}
                        className={`relative w-9 h-5 rounded-full transition-colors ${wf.is_active ? 'bg-green-500' : 'bg-muted'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${wf.is_active ? 'translate-x-4' : ''}`} />
                      </button>
                      <button onClick={() => setEditingWorkflowId(wf.id)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => handleDelete(wf.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {wf.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{wf.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {triggerLabel(wf.trigger_type)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {channelLabel(wf.channels)}
                    </span>
                    {wf.trigger_type === 'keyword' && (
                      <div className="flex gap-1">
                        {((wf.trigger_config as Record<string, unknown>).keywords as string[] || []).slice(0, 3).map((kw, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">{kw}</span>
                        ))}
                      </div>
                    )}
                    {wf.trigger_type === 'template_reply' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                        {(wf.trigger_config as Record<string, unknown>).template_name as string}
                      </span>
                    )}
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
          <GitBranch className="size-10 text-amber-500/50" />
        </div>
        <div className="text-center max-w-xs">
          <p className="text-sm font-medium text-foreground/70 mb-1">Workflows de automatización</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Creá flujos visuales para responder automáticamente, gestionar reseñas,
            etiquetar conversaciones y crear alertas en el CRM.
          </p>
        </div>
      </div>

      {/* New Workflow Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-4 text-amber-400" />
              Nuevo workflow
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nombre</Label>
              <Input className="bg-muted border text-foreground" placeholder="Ej: Encuesta de satisfacción"
                value={formName} onChange={e => setFormName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Descripción (opcional)</Label>
              <Textarea className="bg-muted border text-foreground resize-none" rows={2}
                placeholder="¿Qué hace este workflow?"
                value={formDescription} onChange={e => setFormDescription(e.target.value)} />
            </div>

            {/* Canal */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Canal</Label>
              <select value={formChannel} onChange={e => setFormChannel(e.target.value)}
                className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
                {CHANNEL_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Trigger type */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo de activación</Label>
              <div className="grid gap-2">
                {TRIGGER_TYPES.map(t => {
                  const Icon = t.icon
                  return (
                    <button key={t.value} onClick={() => {
                        setFormTriggerType(t.value)
                        if ((t.value === 'template_reply') && waTemplates.length === 0) handleSyncTemplates()
                      }}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${
                        formTriggerType === t.value ? 'border-amber-500/50 bg-amber-500/5' : 'border bg-muted hover:border-foreground/20'
                      }`}>
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

            {/* Config según trigger */}
            {formTriggerType === 'keyword' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Palabras clave (separadas por coma)</Label>
                  <Input className="bg-muted border text-foreground" placeholder="horarios, precios, abierto"
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

            {formTriggerType === 'template_reply' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Template de Meta</Label>
                {syncingTemplates ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                    <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-green-400" />
                    <span className="text-xs text-muted-foreground">Cargando templates...</span>
                  </div>
                ) : waTemplates.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">No se encontraron templates.</p>
                    <Button size="sm" variant="outline" onClick={handleSyncTemplates} className="h-7 text-xs">
                      Sincronizar templates
                    </Button>
                  </div>
                ) : (
                  <select
                    value={formTemplateName}
                    onChange={e => setFormTemplateName(e.target.value)}
                    className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
                  >
                    <option value="">Seleccionar template...</option>
                    {waTemplates.filter(t => t.status === 'APPROVED').map(tpl => (
                      <option key={tpl.name} value={tpl.name}>
                        {tpl.name} ({tpl.language}) — {tpl.category}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[10px] text-muted-foreground">
                  El workflow se activa cuando un cliente responde a este template (ej: botones de calificación).
                </p>
              </div>
            )}

            {formTriggerType === 'post_service' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Demora después del servicio</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={1440} className="bg-muted border text-foreground w-24"
                    value={formDelayMinutes} onChange={e => setFormDelayMinutes(parseInt(e.target.value) || 0)} />
                  <span className="text-xs text-muted-foreground">minutos</span>
                </div>
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
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNewDialog(false); resetForm() }}
              className="text-muted-foreground hover:text-foreground">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleCreate} disabled={isCreating}>
              {isCreating ? 'Creando...' : 'Crear y configurar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
