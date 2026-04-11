'use client'

import { useEffect, useRef } from 'react'
import { X, Plus, Trash2, MessageSquare, Tag, Bell, Image, LayoutGrid, GitBranch, Clock, Send, List as ListIcon, User, MessageCircleReply, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMensajeria } from '../shared/mensajeria-context'
import type { WorkflowNode } from '@/lib/types/database'

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
  onUpdateConfig: (config: Record<string, unknown>) => void
  onUpdateLabel: (label: string) => void
  onClose: () => void
  onDelete: () => void
}

export function WorkflowNodeEditor({ node, onUpdateConfig, onUpdateLabel, onClose, onDelete }: Props) {
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
          <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
            <div className="flex-1 space-y-1">
              <Input className="bg-background border text-foreground text-xs" placeholder="ID (ej: btn_5, r5)"
                value={cond.id} onChange={e => updateCondition(i, 'id', e.target.value)} />
              <Input className="bg-background border text-foreground text-xs" placeholder="Etiqueta visual"
                value={cond.label} onChange={e => updateCondition(i, 'label', e.target.value)} />
            </div>
            <button onClick={() => removeCondition(i)} className="text-muted-foreground hover:text-red-400 shrink-0">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Cada ruta genera un puerto de salida en el nodo. El ID debe coincidir con el ID del botón/opción que activa esa ruta.
        Las conexiones sin match van a la salida "Otro".
      </p>
    </div>
  )
}

function DelayConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tiempo de espera (segundos)</Label>
        <Input
          type="number"
          min={1}
          max={3600}
          className="bg-muted border text-foreground text-sm"
          value={(config.seconds as number) || 5}
          onChange={e => onChange('seconds', parseInt(e.target.value) || 5)}
        />
        <p className="text-[10px] text-muted-foreground">
          Hasta 10 segundos se ejecuta en el mismo request. Más de 10 se procesa en background.
        </p>
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
  }
  const Icon = iconMap[type] ?? MessageSquare
  return <Icon className="size-4 text-muted-foreground" />
}

// Need Zap import for trigger icon
import { Zap } from 'lucide-react'
