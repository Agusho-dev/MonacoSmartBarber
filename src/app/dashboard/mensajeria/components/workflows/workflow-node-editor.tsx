'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, MessageSquare, Tag, Bell, Image, LayoutGrid, GitBranch, Clock, Send, List as ListIcon, User, MessageCircleReply, Hash, Bot, UserCheck, Globe, Inbox, CalendarDays, RefreshCw, ChevronDown, Sliders, Brain, AlertTriangle, Sparkles } from 'lucide-react'
import { ModelPicker } from '../shared/model-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMensajeria } from '../shared/mensajeria-context'
import type { WorkflowNode, AutomationWorkflow } from '@/lib/types/database'

// ─── Variables disponibles en mensajes ──────────────────────────

type VariableDef = {
  token: string
  label: string
  description: string
  icon: React.ElementType
  color: string
}

const MESSAGE_VARIABLES: VariableDef[] = [
  { token: '{nombre}', label: 'Nombre', description: 'Primer nombre del cliente', icon: User, color: '#22c55e' },
  { token: '{respuesta}', label: 'Respuesta', description: 'Texto de la última respuesta recibida', icon: MessageCircleReply, color: '#3b82f6' },
  { token: '{last_button}', label: 'Botón', description: 'Último botón presionado', icon: LayoutGrid, color: '#8b5cf6' },
  { token: '{platform}', label: 'Canal', description: 'whatsapp / instagram', icon: Hash, color: '#f59e0b' },
  { token: '{ai_response}', label: 'Respuesta IA', description: 'Última respuesta generada por IA', icon: Bot, color: '#a855f7' },
  { token: '{http_response}', label: 'HTTP Response', description: 'Respuesta del último HTTP request', icon: Globe, color: '#0ea5e9' },
]

/**
 * Inserta texto en un textarea en la posición del cursor actual y dispara el onChange.
 * Usa setRangeText para que el undo stack del navegador siga funcionando.
 */
function insertAtCursor(textarea: HTMLTextAreaElement, text: string, onChange: (val: string) => void) {
  const start = textarea.selectionStart ?? textarea.value.length
  const end = textarea.selectionEnd ?? textarea.value.length
  const next = textarea.value.slice(0, start) + text + textarea.value.slice(end)
  onChange(next)
  // Reposicionar el cursor tras el token insertado en el próximo tick
  requestAnimationFrame(() => {
    textarea.focus()
    const pos = start + text.length
    textarea.setSelectionRange(pos, pos)
  })
}

function VariableChips({
  textareaRef,
  onChange,
  value,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onChange: (val: string) => void
  value: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MESSAGE_VARIABLES.map(v => {
        const Icon = v.icon
        return (
          <button
            key={v.token}
            type="button"
            draggable
            title={`${v.description} — arrastrá o clickeá para insertar ${v.token}`}
            onDragStart={e => {
              // El navegador inserta nativamente text/plain al soltar en un textarea
              e.dataTransfer.setData('text/plain', v.token)
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
            onClick={() => {
              const ta = textareaRef.current
              if (ta) insertAtCursor(ta, v.token, onChange)
              else onChange(value + v.token)
            }}
            className="group flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 bg-muted/50 hover:bg-muted hover:border-border cursor-grab active:cursor-grabbing transition-colors"
          >
            <div
              className="size-4 rounded flex items-center justify-center shrink-0"
              style={{ backgroundColor: v.color + '20' }}
            >
              <Icon className="size-2.5" style={{ color: v.color }} />
            </div>
            <span className="text-[10px] font-medium text-foreground">{v.label}</span>
          </button>
        )
      })}
    </div>
  )
}

interface Props {
  node: WorkflowNode
  workflow?: AutomationWorkflow | null
  onUpdateConfig: (config: Record<string, unknown>) => void
  onUpdateLabel: (label: string) => void
  onClose: () => void
  onDelete: () => void
}

export function WorkflowNodeEditor({ node, workflow, onUpdateConfig, onUpdateLabel, onClose, onDelete }: Props) {
  const { tags } = useMensajeria()
  const config = node.config

  const updateField = (key: string, value: unknown) => {
    onUpdateConfig({ ...config, [key]: value })
  }

  return (
    <div className="w-80 shrink-0 border-l border bg-card overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border">
        <div className="flex items-center gap-2 min-w-0">
          <NodeIcon type={node.node_type} />
          <span className="text-sm font-semibold text-foreground truncate">Configurar nodo</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Nombre del paso</Label>
          <Input
            className="bg-muted border text-foreground text-sm"
            value={node.label}
            onChange={e => onUpdateLabel(e.target.value)}
          />
        </div>

        {/* Node-specific config */}
        {node.node_type === 'trigger' && (
          <TriggerConfig nodeId={node.id} config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'send_message' && (
          <SendMessageConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'send_media' && (
          <SendMediaConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'send_buttons' && (
          <SendButtonsConfig config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'send_list' && (
          <SendListConfig config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'send_template' && (
          <SendTemplateConfig config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'condition' && (
          <ConditionConfig config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'wait_reply' && (
          <div className="text-xs text-muted-foreground">
            El workflow se pausará hasta que el usuario responda. La respuesta (texto o botón) se almacena en el contexto.
          </div>
        )}

        {node.node_type === 'delay' && (
          <DelayConfig config={config} onChange={updateField} />
        )}

        {(node.node_type === 'add_tag' || node.node_type === 'remove_tag') && (
          <TagConfig config={config} onChange={updateField} tags={tags} isRemove={node.node_type === 'remove_tag'} />
        )}

        {node.node_type === 'crm_alert' && (
          <CrmAlertConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'ai_response' && (
          <AiResponseConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'handoff_human' && (
          <HandoffHumanConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'loop' && (
          <LoopConfig config={config} onChange={updateField} />
        )}

        {node.node_type === 'http_request' && (
          <HttpRequestConfig config={config} onUpdateConfig={onUpdateConfig} />
        )}

        {node.node_type === 'ai_auto_tag' && (
          <AiAutoTagConfig />
        )}

        {/* Delete button */}
        {!node.is_entry_point && (
          <div className="pt-4 border-t border">
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-400 hover:text-red-300 hover:bg-red-400/10 w-full">
              <Trash2 className="size-3.5 mr-1.5" /> Eliminar nodo
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Node type configs ───────────────────────────────────────────

function SendMessageConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const value = (config.text as string) || ''
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Mensaje</Label>
        <Textarea
          ref={taRef}
          className="bg-muted border text-foreground resize-none text-sm"
          rows={4}
          placeholder="Escribí el mensaje que se enviará..."
          value={value}
          onChange={e => onChange('text', e.target.value)}
        />
        <div className="pt-1 space-y-1.5">
          <p className="text-[10px] text-muted-foreground">Arrastrá o clickeá para insertar:</p>
          <VariableChips textareaRef={taRef} value={value} onChange={v => onChange('text', v)} />
        </div>
      </div>
    </div>
  )
}

function SendMediaConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const captionValue = (config.caption as string) || ''
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tipo de multimedia</Label>
        <select
          value={(config.media_type as string) || 'image'}
          onChange={e => onChange('media_type', e.target.value)}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="image">Imagen</option>
          <option value="video">Video</option>
          <option value="document">Documento</option>
          <option value="audio">Audio</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">URL del archivo</Label>
        <Input
          className="bg-muted border text-foreground text-sm"
          placeholder="https://..."
          value={(config.media_url as string) || ''}
          onChange={e => onChange('media_url', e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Debe ser una URL pública accesible por Meta.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto / Caption (opcional)</Label>
        <Textarea
          ref={captionRef}
          className="bg-muted border text-foreground resize-none text-sm"
          rows={2}
          placeholder="Descripción del archivo..."
          value={captionValue}
          onChange={e => onChange('caption', e.target.value)}
        />
        <VariableChips textareaRef={captionRef} value={captionValue} onChange={v => onChange('caption', v)} />
      </div>
    </div>
  )
}

function SendButtonsConfig({ config, onUpdateConfig }: { config: Record<string, unknown>; onUpdateConfig: (config: Record<string, unknown>) => void }) {
  const buttons = (config.buttons as Array<{ id: string; title: string }>) ?? []
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const bodyValue = (config.body as string) || ''

  const updateButton = (index: number, field: string, value: string) => {
    const newButtons = [...buttons]
    newButtons[index] = { ...newButtons[index], [field]: value }
    onUpdateConfig({ ...config, buttons: newButtons })
  }

  const addButton = () => {
    if (buttons.length >= 3) return // WPP max 3 botones
    const newBtn = { id: `btn_${buttons.length + 1}`, title: `Opción ${buttons.length + 1}` }
    onUpdateConfig({ ...config, buttons: [...buttons, newBtn] })
  }

  const removeButton = (index: number) => {
    onUpdateConfig({ ...config, buttons: buttons.filter((_, i) => i !== index) })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto del mensaje</Label>
        <Textarea
          ref={bodyRef}
          className="bg-muted border text-foreground resize-none text-sm"
          rows={3}
          placeholder="¿Cómo fue tu experiencia?"
          value={bodyValue}
          onChange={e => onUpdateConfig({ ...config, body: e.target.value })}
        />
        <VariableChips textareaRef={bodyRef} value={bodyValue} onChange={v => onUpdateConfig({ ...config, body: v })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Botones (máx. 3)</Label>
          {buttons.length < 3 && (
            <button onClick={addButton} className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5">
              <Plus className="size-3" /> Agregar
            </button>
          )}
        </div>
        {buttons.map((btn, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="bg-muted border text-foreground text-xs flex-1"
              placeholder="ID del botón"
              value={btn.id}
              onChange={e => updateButton(i, 'id', e.target.value)}
            />
            <Input
              className="bg-muted border text-foreground text-xs flex-1"
              placeholder="Título (máx 20 chars)"
              maxLength={20}
              value={btn.title}
              onChange={e => updateButton(i, 'title', e.target.value)}
            />
            <button onClick={() => removeButton(i)} className="text-muted-foreground hover:text-red-400 shrink-0">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Después de enviar botones, el workflow esperará la respuesta automáticamente.
        Conectá un nodo "Condición" para bifurcar según el botón presionado.
      </p>
    </div>
  )
}

function SendListConfig({ config, onUpdateConfig }: { config: Record<string, unknown>; onUpdateConfig: (config: Record<string, unknown>) => void }) {
  const sections = (config.sections as Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) ?? []
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const bodyValue = (config.body as string) || ''

  const updateRow = (sectionIdx: number, rowIdx: number, field: string, value: string) => {
    const newSections = structuredClone(sections)
    ;(newSections[sectionIdx].rows[rowIdx] as Record<string, string>)[field] = value
    onUpdateConfig({ ...config, sections: newSections })
  }

  const addRow = (sectionIdx: number) => {
    const newSections = structuredClone(sections)
    const totalRows = newSections.reduce((sum, s) => sum + s.rows.length, 0)
    if (totalRows >= 10) return
    newSections[sectionIdx].rows.push({
      id: `opt_${totalRows + 1}`,
      title: `Opción ${totalRows + 1}`,
      description: '',
    })
    onUpdateConfig({ ...config, sections: newSections })
  }

  const removeRow = (sectionIdx: number, rowIdx: number) => {
    const newSections = structuredClone(sections)
    newSections[sectionIdx].rows.splice(rowIdx, 1)
    onUpdateConfig({ ...config, sections: newSections })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto del mensaje</Label>
        <Textarea
          ref={bodyRef}
          className="bg-muted border text-foreground resize-none text-sm"
          rows={2}
          value={bodyValue}
          onChange={e => onUpdateConfig({ ...config, body: e.target.value })}
        />
        <VariableChips textareaRef={bodyRef} value={bodyValue} onChange={v => onUpdateConfig({ ...config, body: v })} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto del botón de lista</Label>
        <Input
          className="bg-muted border text-foreground text-sm"
          value={(config.button_text as string) || 'Ver opciones'}
          onChange={e => onUpdateConfig({ ...config, button_text: e.target.value })}
        />
      </div>

      {sections.map((section, si) => (
        <div key={si} className="space-y-2">
          <Label className="text-xs text-muted-foreground">Opciones (máx. 10 total)</Label>
          {section.rows.map((row, ri) => (
            <div key={ri} className="flex items-start gap-1.5">
              <div className="flex-1 space-y-1">
                <Input className="bg-muted border text-foreground text-xs" placeholder="Título"
                  value={row.title} onChange={e => updateRow(si, ri, 'title', e.target.value)} />
                <Input className="bg-muted border text-foreground text-xs" placeholder="Descripción (opcional)"
                  value={row.description || ''} onChange={e => updateRow(si, ri, 'description', e.target.value)} />
              </div>
              <button onClick={() => removeRow(si, ri)} className="text-muted-foreground hover:text-red-400 mt-2 shrink-0">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          <button onClick={() => addRow(si)} className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5">
            <Plus className="size-3" /> Agregar opción
          </button>
        </div>
      ))}

      <p className="text-[10px] text-muted-foreground">
        WPP soporta hasta 10 opciones en una lista. El workflow esperará la respuesta automáticamente.
      </p>
    </div>
  )
}

function SendTemplateConfig({ config, onUpdateConfig }: { config: Record<string, unknown>; onUpdateConfig: (config: Record<string, unknown>) => void }) {
  const { waTemplates, handleSyncTemplates, syncingTemplates } = useMensajeria()

  useEffect(() => {
    if (waTemplates.length === 0) handleSyncTemplates()
  }, [])

  const approvedTemplates = waTemplates.filter(t => t.status === 'APPROVED')

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Template de Meta</Label>
        {syncingTemplates ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
            <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-green-400" />
            <span className="text-xs text-muted-foreground">Cargando templates...</span>
          </div>
        ) : approvedTemplates.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">No se encontraron templates aprobados.</p>
            <Button size="sm" variant="outline" onClick={handleSyncTemplates} className="h-7 text-xs">
              Sincronizar templates
            </Button>
          </div>
        ) : (
          <select
            value={(config.template_name as string) || ''}
            onChange={e => {
              const selected = approvedTemplates.find(t => t.name === e.target.value)
              onUpdateConfig({
                ...config,
                template_name: e.target.value,
                language_code: selected?.language ?? (config.language_code as string) ?? 'es_AR',
              })
            }}
            className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
          >
            <option value="">Seleccionar template...</option>
            {approvedTemplates.map(tpl => (
              <option key={`${tpl.name}-${tpl.language}`} value={tpl.name}>
                {tpl.name} ({tpl.language}) — {tpl.category}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Código de idioma</Label>
        <Input
          className="bg-muted border text-foreground text-sm"
          placeholder="es_AR"
          value={(config.language_code as string) || 'es_AR'}
          onChange={e => onUpdateConfig({ ...config, language_code: e.target.value })}
          readOnly={!!((config.template_name as string))}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        El template debe estar aprobado en Meta Business. Los templates funcionan fuera de la ventana de 24h.
      </p>
    </div>
  )
}

function ConditionConfig({ config, onUpdateConfig }: { config: Record<string, unknown>; onUpdateConfig: (config: Record<string, unknown>) => void }) {
  const conditions = (config.conditions as Array<{ id: string; label: string; value?: string }>) ?? []

  const addCondition = () => {
    const newCond = { id: `cond_${conditions.length + 1}`, label: `Ruta ${conditions.length + 1}`, value: '' }
    onUpdateConfig({ ...config, conditions: [...conditions, newCond] })
  }

  const updateCondition = (index: number, field: string, value: string) => {
    const newConds = [...conditions]
    newConds[index] = { ...newConds[index], [field]: value }
    onUpdateConfig({ ...config, conditions: newConds })
  }

  const removeCondition = (index: number) => {
    onUpdateConfig({ ...config, conditions: conditions.filter((_, i) => i !== index) })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tipo de condición</Label>
        <select
          value={(config.type as string) || 'button_response'}
          onChange={e => onUpdateConfig({ ...config, type: e.target.value })}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="button_response">Respuesta de botón</option>
          <option value="text_match">Texto del mensaje</option>
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Rutas condicionales</Label>
          <button onClick={addCondition} className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5">
            <Plus className="size-3" /> Agregar ruta
          </button>
        </div>
        {conditions.map((cond, i) => (
          <div key={`${cond.id}-${i}`} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
            <div className="flex-1 space-y-1">
              <Label className="text-[9px] text-muted-foreground">ID (igual que en el nodo &quot;Enviar botones&quot;, ej. btn_1)</Label>
              <Input className="bg-background border text-foreground text-xs" placeholder="btn_1"
                value={cond.id} onChange={e => updateCondition(i, 'id', e.target.value)} />
              <Label className="text-[9px] text-muted-foreground">Etiqueta en el diagrama</Label>
              <Input className="bg-background border text-foreground text-xs" placeholder="Si"
                value={cond.label} onChange={e => updateCondition(i, 'label', e.target.value)} />
            </div>
            <button onClick={() => removeCondition(i)} className="text-muted-foreground hover:text-red-400 shrink-0">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Cada ruta genera un puerto de salida. Lo ideal es que el ID sea el mismo que el del botón en WhatsApp (btn_1, btn_2…).
        Si dejás el texto del botón (ej. Si), también puede coincidir. Las rutas sin match van a &quot;Otro&quot;. No repetir el mismo ID en dos rutas.
      </p>
    </div>
  )
}

function DelayConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const seconds = (config.seconds as number) || 5
  const isInline = seconds <= 10
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tiempo de espera (segundos)</Label>
        <Input
          type="number"
          min={1}
          max={3600}
          className="bg-muted border text-foreground text-sm"
          value={seconds}
          onChange={e => onChange('seconds', parseInt(e.target.value) || 5)}
        />
        <div className={`rounded-md border px-2.5 py-2 text-[10px] leading-relaxed ${isInline ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
          {isInline ? (
            <>⚡ <strong>Inline:</strong> hasta 10s se ejecuta dentro del mismo request — funciona siempre.</>
          ) : (
            <>⏱ <strong>Diferido:</strong> se reanuda cuando llega el próximo mensaje del cliente o cuando corre el cron <code className="text-foreground">/api/cron/process-workflow-delays</code>. Sin cron configurado, usá valores ≤ 10s.</>
          )}
        </div>
      </div>
    </div>
  )
}

function TagConfig({ config, onChange, tags, isRemove }: {
  config: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  tags: Array<{ id: string; name: string; color: string }>
  isRemove: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {isRemove ? 'Etiqueta a quitar' : 'Etiqueta a asignar'}
        </Label>
        <select
          value={(config.tag_id as string) || ''}
          onChange={e => onChange('tag_id', e.target.value)}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="">Seleccionar etiqueta...</option>
          {tags.map(tag => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>
      </div>
      {tags.length === 0 && (
        <p className="text-[10px] text-amber-400">
          No hay etiquetas creadas. Creá etiquetas en la sección de configuración.
        </p>
      )}
    </div>
  )
}

function CrmAlertConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tipo de alerta</Label>
        <select
          value={(config.alert_type as string) || 'info'}
          onChange={e => onChange('alert_type', e.target.value)}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="info">Informativa</option>
          <option value="warning">Advertencia</option>
          <option value="urgent">Urgente</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Título de la alerta</Label>
        <Input
          className="bg-muted border text-foreground text-sm"
          placeholder="Ej: Cliente insatisfecho"
          value={(config.title as string) || ''}
          onChange={e => onChange('title', e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Mensaje (opcional)</Label>
        <Textarea
          className="bg-muted border text-foreground resize-none text-sm"
          rows={2}
          placeholder="Detalles adicionales..."
          value={(config.message as string) || ''}
          onChange={e => onChange('message', e.target.value)}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        La alerta aparecerá en el panel de mensajería para que un operador tome acción manualmente.
      </p>
    </div>
  )
}

// ─── Trigger config ─────────────────────────────────────────────

const TRIGGER_TYPE_OPTIONS = [
  { value: 'message_received', label: 'Cualquier mensaje', icon: Inbox, description: 'Se activa con cualquier mensaje recibido' },
  { value: 'keyword', label: 'Palabra clave', icon: MessageSquare, description: 'Responde cuando un mensaje contiene palabras clave' },
  { value: 'template_reply', label: 'Respuesta a template', icon: GitBranch, description: 'Se activa cuando un cliente responde a un template' },
  { value: 'post_service', label: 'Post-servicio', icon: Clock, description: 'Envía mensaje después de completar un servicio' },
  { value: 'days_after_visit', label: 'Seguimiento', icon: CalendarDays, description: 'Envía mensaje X días después de la última visita' },
  { value: 'conversation_reopened', label: 'Conversación reabierta', icon: Inbox, description: 'Se activa cuando el cliente escribe tras X horas de inactividad' },
]

function TriggerConfig({
  nodeId,
  config,
  onUpdateConfig,
}: {
  nodeId: string
  config: Record<string, unknown>
  onUpdateConfig: (config: Record<string, unknown>) => void
}) {
  const { waTemplates, handleSyncTemplates, syncingTemplates } = useMensajeria()
  const triggerType = (config.trigger_type as string) || 'message_received'
  const configRef = useRef(config)
  configRef.current = config

  const keywordsJoined = ((config.keywords as string[]) ?? []).join(', ')
  const [keywordDraft, setKeywordDraft] = useState(keywordsJoined)
  const keywordDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setKeywordDraft(((config.keywords as string[]) ?? []).join(', '))
  }, [nodeId])

  useEffect(() => () => {
    if (keywordDebounceRef.current) clearTimeout(keywordDebounceRef.current)
  }, [])

  const flushKeywordsToConfig = (raw: string) => {
    const c = configRef.current
    const tt = (c.trigger_type as string) || 'message_received'
    const keywords = raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    onUpdateConfig({ ...c, keywords, trigger_type: tt })
  }

  const setTriggerType = (type: string) => {
    // Inyectar defaults al cambiar de trigger type para que se persistan
    const defaults: Record<string, Record<string, unknown>> = {
      conversation_reopened: {
        reopen_mode: 'inactivity',
        min_hours_since_client_msg: 12,
        exclude_first_ever_contact: false,
      },
    }
    onUpdateConfig({ ...config, trigger_type: type, ...defaults[type] })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tipo de activación</Label>
        <div className="grid gap-1.5">
          {TRIGGER_TYPE_OPTIONS.map(t => {
            const Icon = t.icon
            const isSelected = triggerType === t.value
            return (
              <button key={t.value} onClick={() => setTriggerType(t.value)}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors text-left ${
                  isSelected ? 'border-amber-500/50 bg-amber-500/5' : 'border-transparent bg-muted hover:border-border'
                }`}>
                <Icon className={`size-3.5 mt-0.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-muted-foreground'}`} />
                <div>
                  <p className={`text-xs font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>{t.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {triggerType === 'keyword' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Palabras clave (separadas por coma)</Label>
            <Input
              className="bg-muted border text-foreground text-sm"
              placeholder="horarios, precios, abierto"
              value={keywordDraft}
              onChange={e => {
                const v = e.target.value
                setKeywordDraft(v)
                if (keywordDebounceRef.current) clearTimeout(keywordDebounceRef.current)
                keywordDebounceRef.current = setTimeout(() => flushKeywordsToConfig(v), 350)
              }}
              onBlur={() => {
                if (keywordDebounceRef.current) {
                  clearTimeout(keywordDebounceRef.current)
                  keywordDebounceRef.current = null
                }
                flushKeywordsToConfig(keywordDraft)
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Modo de coincidencia</Label>
            <select value={(config.match_mode as string) || 'contains'}
              onChange={e => onUpdateConfig({ ...config, match_mode: e.target.value, trigger_type: triggerType })}
              className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
              <option value="contains">Contiene la palabra</option>
              <option value="exact">Coincidencia exacta</option>
            </select>
          </div>
        </>
      )}

      {triggerType === 'template_reply' && (
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
              value={(config.template_name as string) || ''}
              onChange={e => onUpdateConfig({ ...config, template_name: e.target.value, trigger_type: triggerType })}
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
        </div>
      )}

      {triggerType === 'post_service' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Demora después del servicio</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={1440} className="bg-muted border text-foreground text-sm w-24"
              value={(config.delay_minutes as number) ?? 15}
              onChange={e => onUpdateConfig({ ...config, delay_minutes: parseInt(e.target.value) || 0, trigger_type: triggerType })} />
            <span className="text-xs text-muted-foreground">minutos</span>
          </div>
        </div>
      )}

      {triggerType === 'days_after_visit' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Días después de la última visita</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={1} max={365} className="bg-muted border text-foreground text-sm w-24"
              value={(config.delay_days as number) ?? 7}
              onChange={e => onUpdateConfig({ ...config, delay_days: parseInt(e.target.value) || 1, trigger_type: triggerType })} />
            <span className="text-xs text-muted-foreground">días</span>
          </div>
        </div>
      )}

      {triggerType === 'message_received' && (
        <p className="text-[10px] text-muted-foreground">
          El workflow se activará con cualquier mensaje entrante. Los workflows con triggers más específicos (palabra clave, template) tienen prioridad.
        </p>
      )}

      {triggerType === 'conversation_reopened' && (
        <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Modo de reapertura</Label>
            <select value={(config.reopen_mode as string) || 'inactivity'}
              onChange={e => onUpdateConfig({ ...config, reopen_mode: e.target.value, trigger_type: triggerType })}
              className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border">
              <option value="inactivity">Por inactividad (horas sin contacto)</option>
              <option value="status_closed">Solo si estaba inactiva/cerrada</option>
              <option value="either">Cualquiera de las dos</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Horas mínimas desde el último mensaje del cliente</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={720} className="bg-muted border text-foreground text-sm w-24"
                value={(config.min_hours_since_client_msg as number) ?? 12}
                onChange={e => onUpdateConfig({ ...config, min_hours_since_client_msg: parseInt(e.target.value) || 12, trigger_type: triggerType })} />
              <span className="text-xs text-muted-foreground">horas</span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={(config.exclude_first_ever_contact as boolean) ?? false}
              onChange={e => onUpdateConfig({ ...config, exclude_first_ever_contact: e.target.checked, trigger_type: triggerType })} />
            No disparar en el primer contacto del cliente
          </label>
        </div>
      )}
    </div>
  )
}

// ─── AI Response config ─────────────────────────────────────────

function AiResponseConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const promptValue = (config.system_prompt as string) || ''
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showFallback, setShowFallback] = useState(!!(config.fallback_message as string))

  const temperature = (config.temperature as number) ?? 0.7
  const maxTokens = (config.max_tokens as number) ?? 500
  const memory = (config.memory_messages as number) ?? 10
  const modelValue = (config.model as string) || 'gpt-4o-mini'

  // Heat label según temperatura — feedback visual
  const tempLabel = temperature < 0.4 ? 'Preciso' : temperature < 0.9 ? 'Balanceado' : temperature < 1.4 ? 'Creativo' : 'Muy creativo'
  const tempColor = temperature < 0.4 ? 'text-blue-400' : temperature < 0.9 ? 'text-emerald-400' : temperature < 1.4 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-4">
      {/* Modelo — lo más importante, arriba y grande */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Brain className="size-3.5 text-purple-400" />
          <Label className="text-xs font-medium text-foreground">Modelo de IA</Label>
        </div>
        <ModelPicker value={modelValue} onChange={id => onChange('model', id)} />
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Prompt del sistema</Label>
          <span className="text-[10px] text-muted-foreground tabular-nums">{promptValue.length} chars</span>
        </div>
        <Textarea
          ref={promptRef}
          className="bg-muted border text-foreground resize-none text-sm transition-colors focus:border-purple-500/50"
          rows={5}
          placeholder="Sos un asistente de la barbería Monaco. Respondé consultas sobre horarios, servicios y precios..."
          value={promptValue}
          onChange={e => onChange('system_prompt', e.target.value)}
        />
        <div className="pt-1 space-y-1.5">
          <p className="text-[10px] text-muted-foreground">Arrastrá o clickeá para insertar:</p>
          <VariableChips textareaRef={promptRef} value={promptValue} onChange={v => onChange('system_prompt', v)} />
        </div>
      </div>

      {/* Advanced — collapsible con animación */}
      <div className="rounded-lg border border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(s => !s)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors">
          <Sliders className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Ajustes avanzados</span>
          <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className={tempColor}>{tempLabel}</span>
            <span>· {maxTokens} tok</span>
            <span>· mem {memory}</span>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
          </div>
        </button>

        <div className={`grid transition-all duration-200 ease-out ${showAdvanced ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="px-3 pb-3 pt-2 space-y-3 border-t border/60">
              {/* Temperatura como slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Temperatura</Label>
                  <span className={`text-xs font-mono ${tempColor}`}>{temperature.toFixed(1)} · {tempLabel}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={e => onChange('temperature', parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>preciso</span><span>balanceado</span><span>creativo</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max tokens</Label>
                  <Input
                    type="number" min={50} max={4000} step={50}
                    className="bg-muted border text-foreground text-sm"
                    value={maxTokens}
                    onChange={e => onChange('max_tokens', parseInt(e.target.value) || 500)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Memoria (msgs)</Label>
                  <Input
                    type="number" min={0} max={30} step={1}
                    className="bg-muted border text-foreground text-sm"
                    value={memory}
                    onChange={e => onChange('memory_messages', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                La memoria define cuántos mensajes previos de la conversación recibe la IA como contexto. 0 = sin memoria.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fallback — collapsible separado */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFallback(s => !s)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-500/10 transition-colors">
          <AlertTriangle className="size-3.5 text-amber-400" />
          <span className="text-xs font-medium text-foreground">Fallback si la IA falla</span>
          <span className="ml-auto text-[10px] text-amber-300/80">
            {(config.fallback_message as string)?.trim() ? 'Configurado' : 'Sin configurar'}
          </span>
          <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-200 ${showFallback ? 'rotate-180' : ''}`} />
        </button>
        <div className={`grid transition-all duration-200 ease-out ${showFallback ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="px-3 pb-3 pt-2 border-t border-amber-500/20">
              <Textarea
                className="bg-muted border text-foreground resize-none text-sm"
                rows={2}
                placeholder="Disculpá, no pude procesar tu consulta. Un agente te va a responder pronto."
                value={(config.fallback_message as string) || ''}
                onChange={e => onChange('fallback_message', e.target.value)}
              />
              <p className="text-[10px] text-amber-300/80 mt-1.5 leading-relaxed">
                Si el modelo falla (API caída, rate limit, modelo inválido) se envía este mensaje.
                Revisá el error exacto en <strong>Config → Logs</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        La respuesta de la IA se envía automáticamente al cliente y queda disponible como {'{ai_response}'} en nodos siguientes.
      </p>
    </div>
  )
}

// ─── Loop config ────────────────────────────────────────────────

function LoopConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Repeticiones máximas</Label>
        <Input
          type="number"
          min={1}
          max={50}
          step={1}
          className="bg-muted border text-foreground text-sm"
          value={(config.max_iterations as number) ?? 3}
          onChange={e => onChange('max_iterations', parseInt(e.target.value) || 3)}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        El nodo tiene dos salidas: &quot;continuar&quot; (repite el cuerpo del bucle) y &quot;listo&quot; (sale del bucle al siguiente paso). Conectá cada salida al nodo correspondiente.
      </p>
    </div>
  )
}

// ─── Handoff to human config ────────────────────────────────────

function HandoffHumanConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  const msgRef = useRef<HTMLTextAreaElement>(null)
  const msgValue = (config.client_message as string) || ''

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Asignar a</Label>
        <select
          value={(config.assign_to as string) || 'auto'}
          onChange={e => onChange('assign_to', e.target.value)}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="auto">Automático (primer operador disponible)</option>
        </select>
        <p className="text-[10px] text-muted-foreground">
          La asignación automática crea una alerta para que cualquier operador tome la conversación.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Mensaje al cliente</Label>
        <Textarea
          ref={msgRef}
          className="bg-muted border text-foreground resize-none text-sm"
          rows={3}
          placeholder="Te estamos transfiriendo con un agente..."
          value={msgValue}
          onChange={e => onChange('client_message', e.target.value)}
        />
        <VariableChips textareaRef={msgRef} value={msgValue} onChange={v => onChange('client_message', v)} />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Crear alerta CRM</Label>
        <button
          onClick={() => onChange('create_alert', !(config.create_alert ?? true))}
          className={`relative w-9 h-5 rounded-full transition-colors ${(config.create_alert ?? true) ? 'bg-green-500' : 'bg-muted'}`}
        >
          <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${(config.create_alert ?? true) ? 'translate-x-4' : ''}`} />
        </button>
      </div>

      {(config.create_alert ?? true) && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo de alerta</Label>
          <select
            value={(config.alert_type as string) || 'urgent'}
            onChange={e => onChange('alert_type', e.target.value)}
            className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
          >
            <option value="info">Informativa</option>
            <option value="warning">Advertencia</option>
            <option value="urgent">Urgente</option>
          </select>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Al derivar, el workflow se detiene y un operador toma el control de la conversación manualmente.
      </p>
    </div>
  )
}

// ─── HTTP Request config ────────────────────────────────────────

function HttpRequestConfig({ config, onUpdateConfig }: { config: Record<string, unknown>; onUpdateConfig: (config: Record<string, unknown>) => void }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const bodyValue = (config.body_template as string) || ''

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">URL</Label>
        <Input
          className="bg-muted border text-foreground text-sm"
          placeholder="https://api.ejemplo.com/webhook"
          value={(config.url as string) || ''}
          onChange={e => onUpdateConfig({ ...config, url: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Método</Label>
        <select
          value={(config.method as string) || 'POST'}
          onChange={e => onUpdateConfig({ ...config, method: e.target.value })}
          className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none border"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Body (JSON)</Label>
        <Textarea
          ref={bodyRef}
          className="bg-muted border text-foreground resize-none text-sm font-mono"
          rows={4}
          placeholder='{"message": "{respuesta}", "client": "{nombre}"}'
          value={bodyValue}
          onChange={e => onUpdateConfig({ ...config, body_template: e.target.value })}
        />
        <VariableChips textareaRef={bodyRef} value={bodyValue} onChange={v => onUpdateConfig({ ...config, body_template: v })} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Variable de respuesta</Label>
        <Input
          className="bg-muted border text-foreground text-sm font-mono"
          placeholder="http_response"
          value={(config.response_variable as string) || 'http_response'}
          onChange={e => onUpdateConfig({ ...config, response_variable: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground">
          La respuesta del servidor se guarda en esta variable y se puede usar en nodos siguientes como {'{http_response}'}.
        </p>
      </div>
    </div>
  )
}

// ─── AI Auto-tag config ─────────────────────────────────────────

function AiAutoTagConfig() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-purple-400" />
          <span className="text-xs font-medium text-foreground">Auto-etiquetado con IA</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Este nodo analiza la conversación y asigna automáticamente las etiquetas que tengan <strong className="text-purple-300">auto-asignar con IA</strong> activado.
        </p>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Configurá las etiquetas y sus descripciones en <strong>Config → Tags</strong>. La IA lee la descripción de cada etiqueta para decidir si aplica a la conversación.
      </p>
      <div className="rounded-md border border-dashed border-muted-foreground/20 p-2.5">
        <p className="text-[10px] text-muted-foreground">
          💡 <strong>Ejemplo:</strong> Si tenés una etiqueta <em>&quot;Consulta precio&quot;</em> con descripción <em>&quot;Cliente pregunta por precios o promociones&quot;</em>, la IA la asignará cuando detecte mensajes sobre costos.
        </p>
      </div>
    </div>
  )
}

// ─── Node icon helper ────────────────────────────────────────────

function NodeIcon({ type }: { type: string }) {
  const iconMap: Record<string, React.ElementType> = {
    trigger: Zap,
    send_message: MessageSquare,
    send_media: Image,
    send_buttons: LayoutGrid,
    send_list: ListIcon,
    send_template: Send,
    condition: GitBranch,
    wait_reply: Clock,
    delay: Clock,
    add_tag: Tag,
    remove_tag: Tag,
    crm_alert: Bell,
    ai_response: Bot,
    ai_auto_tag: Sparkles,
    handoff_human: UserCheck,
    http_request: Globe,
    loop: RefreshCw,
  }
  const Icon = iconMap[type] ?? MessageSquare
  return <Icon className="size-4 text-muted-foreground" />
}

// Need Zap import for trigger icon
import { Zap } from 'lucide-react'
