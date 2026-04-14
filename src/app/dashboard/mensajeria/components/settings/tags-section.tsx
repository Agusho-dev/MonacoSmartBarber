'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Sparkles, ChevronDown, ChevronRight, Bot, Pencil, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ModelPicker } from '../shared/model-picker'
import { TAG_COLORS } from '../shared/helpers'
import { saveOrgAiConfig } from '@/lib/actions/ai-config'
import { toast } from 'sonner'
import type { ConversationTag } from '@/lib/types/database'
import type { OrgAiConfig } from '@/lib/actions/ai-config'

interface TagsSectionProps {
  tags: ConversationTag[]
  newTagName: string
  setNewTagName: (v: string) => void
  newTagColor: string
  setNewTagColor: (v: string) => void
  handleCreateTag: (name: string, color: string, description?: string, aiAutoAssign?: boolean) => void
  handleDeleteTag: (tagId: string) => void
  handleUpdateTag: (tagId: string, updates: { name?: string; color?: string; description?: string | null; ai_auto_assign?: boolean }) => void
  creatingTag: boolean
  aiConfig: OrgAiConfig | null
  setAiConfig: React.Dispatch<React.SetStateAction<OrgAiConfig | null>>
}

export function TagsSection({
  tags, newTagName, setNewTagName, newTagColor, setNewTagColor,
  handleCreateTag, handleDeleteTag, handleUpdateTag, creatingTag,
  aiConfig, setAiConfig,
}: TagsSectionProps) {
  const [expandedTag, setExpandedTag] = useState<string | null>(null)
  const [editingDescription, setEditingDescription] = useState<{ tagId: string; text: string } | null>(null)
  const [newTagDescription, setNewTagDescription] = useState('')
  const [newTagAi, setNewTagAi] = useState(false)
  const [savingAutoTag, startSavingAutoTag] = useTransition()

  const aiEnabledCount = tags.filter(t => t.ai_auto_assign).length
  const isAutoTagEnabled = aiConfig?.auto_tag_enabled ?? false

  const handleToggleGlobalAutoTag = () => {
    startSavingAutoTag(async () => {
      const newVal = !isAutoTagEnabled
      const result = await saveOrgAiConfig({ auto_tag_enabled: newVal })
      if (result.error) { toast.error(result.error) }
      else {
        toast.success(newVal ? 'Auto-tag activado' : 'Auto-tag desactivado')
        if (result.data) setAiConfig(result.data)
      }
    })
  }

  const handleSaveAutoTagModel = (model: string) => {
    startSavingAutoTag(async () => {
      const result = await saveOrgAiConfig({ auto_tag_model: model })
      if (result.error) { toast.error(result.error) }
      else {
        if (result.data) setAiConfig(result.data)
      }
    })
  }

  const handleSaveDescription = (tagId: string) => {
    if (!editingDescription || editingDescription.tagId !== tagId) return
    handleUpdateTag(tagId, { description: editingDescription.text })
    setEditingDescription(null)
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Etiquetas inteligentes</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Creá etiquetas con descripciones semánticas para que la IA clasifique automáticamente tus conversaciones.
        </p>
      </div>

      {/* ── Global Auto-Tag Switch ── */}
      <div className={`rounded-xl border p-3.5 transition-all duration-300 ${isAutoTagEnabled
        ? 'bg-gradient-to-br from-purple-500/10 via-violet-500/5 to-transparent border-purple-500/30'
        : 'bg-card border-border'
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`size-8 rounded-lg flex items-center justify-center transition-all duration-300 ${isAutoTagEnabled
              ? 'bg-purple-500/20 text-purple-400'
              : 'bg-muted text-muted-foreground'
            }`}>
              <Sparkles className={`size-4 ${isAutoTagEnabled ? 'animate-pulse' : ''}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Auto-tag con IA</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {isAutoTagEnabled
                  ? `${aiEnabledCount} etiqueta${aiEnabledCount !== 1 ? 's' : ''} activa${aiEnabledCount !== 1 ? 's' : ''}`
                  : 'Clasificación automática desactivada'}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleGlobalAutoTag}
            disabled={savingAutoTag}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none disabled:opacity-50 ${
              isAutoTagEnabled ? 'bg-purple-500' : 'bg-muted-foreground/30'
            }`}
          >
            <span className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ${
              isAutoTagEnabled ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {/* Model picker al activar */}
        {isAutoTagEnabled && (
          <div className="mt-3 pt-3 border-t border-purple-500/20 space-y-2">
            <Label className="text-[10px] text-purple-300/70 uppercase tracking-wider">Modelo para auto-tag</Label>
            <ModelPicker
              value={aiConfig?.auto_tag_model || 'gpt-4o-mini'}
              onChange={handleSaveAutoTagModel}
            />
            <p className="text-[10px] text-muted-foreground">
              Recomendado: modelos rápidos y económicos (GPT-4o Mini, Haiku).
            </p>
          </div>
        )}
      </div>

      <Separator className="bg-white/5" />

      {/* ── Crear nueva etiqueta ── */}
      <div className="space-y-3">
        <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Nueva etiqueta</Label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            placeholder="Ej: Consulta precio, VIP, Queja..."
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newTagName.trim()) {
                handleCreateTag(newTagName, newTagColor, newTagDescription || undefined, newTagAi)
                setNewTagName('')
                setNewTagDescription('')
                setNewTagAi(false)
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              handleCreateTag(newTagName, newTagColor, newTagDescription || undefined, newTagAi)
              setNewTagName('')
              setNewTagDescription('')
              setNewTagAi(false)
            }}
            disabled={creatingTag || !newTagName.trim()}
            className="shrink-0 bg-muted hover:bg-muted/80 text-white border-0"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {/* Descripción para IA al crear */}
        <div className="space-y-1.5">
          <textarea
            className="w-full rounded-lg bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-purple-500/40 resize-none border border-transparent focus:border-purple-500/20"
            rows={2}
            placeholder="Descripción para la IA: ¿cuándo debería aplicarse esta etiqueta?"
            value={newTagDescription}
            onChange={e => setNewTagDescription(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewTagAi(!newTagAi)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${newTagAi
                ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                : 'bg-card text-muted-foreground border border-transparent hover:border-border'
              }`}
            >
              <Sparkles className="size-3" />
              Auto-asignar con IA
            </button>
          </div>
        </div>

        {/* Color picker */}
        <div className="flex gap-1.5 flex-wrap">
          {TAG_COLORS.map(color => (
            <button key={color} onClick={() => setNewTagColor(color)}
              className={`size-5 rounded-full transition-all hover:scale-110 ${newTagColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : ''}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        {/* Preview */}
        {newTagName.trim() && (
          <div className="flex items-center gap-2 py-1">
            <span className="text-[10px] text-muted-foreground">Vista previa:</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: newTagColor }}>
              {newTagAi && <Sparkles className="size-2.5" />}
              {newTagName.trim()}
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-white/5" />

      {/* ── Lista de etiquetas ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">
            Etiquetas ({tags.length})
          </Label>
          {aiEnabledCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-purple-400">
              <Sparkles className="size-2.5" />
              {aiEnabledCount} con IA
            </span>
          )}
        </div>

        {tags.length === 0 ? (
          <div className="text-center py-8">
            <div className="size-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-2">
              <Bot className="size-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Todavía no creaste ninguna etiqueta</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">Creá tu primera etiqueta con una descripción para la IA</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tags.map(tag => {
              const isExpanded = expandedTag === tag.id
              const isEditingDesc = editingDescription?.tagId === tag.id

              return (
                <div
                  key={tag.id}
                  className={`rounded-xl border transition-all duration-200 ${isExpanded
                    ? tag.ai_auto_assign
                      ? 'bg-gradient-to-br from-purple-500/5 to-transparent border-purple-500/20'
                      : 'bg-card border-border'
                    : 'bg-card border-transparent hover:border-border'
                  }`}
                >
                  {/* Tag row */}
                  <button
                    onClick={() => setExpandedTag(isExpanded ? null : tag.id)}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-left"
                  >
                    <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 text-sm text-foreground truncate">{tag.name}</span>

                    {tag.ai_auto_assign && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-400 text-[9px] font-medium shrink-0">
                        <Sparkles className="size-2.5" />
                        IA
                      </span>
                    )}

                    {tag.description && !isExpanded && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[100px] hidden sm:block">
                        {tag.description}
                      </span>
                    )}

                    {isExpanded ? (
                      <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/50">
                      {/* Descripción */}
                      <div className="pt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            Descripción para IA
                          </Label>
                          {!isEditingDesc && (
                            <button
                              onClick={() => setEditingDescription({ tagId: tag.id, text: tag.description || '' })}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                        </div>

                        {isEditingDesc ? (
                          <div className="space-y-1.5">
                            <textarea
                              className="w-full rounded-lg bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-purple-500/40 resize-none border"
                              rows={3}
                              placeholder="Ej: Cliente que pregunta por precios, promociones o descuentos disponibles"
                              value={editingDescription.text}
                              onChange={e => setEditingDescription({ ...editingDescription, text: e.target.value })}
                              autoFocus
                            />
                            <div className="flex gap-1.5 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2"
                                onClick={() => setEditingDescription(null)}
                              >
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                className="h-6 text-[10px] px-2 bg-purple-600 hover:bg-purple-500 text-white"
                                onClick={() => handleSaveDescription(tag.id)}
                                disabled={creatingTag}
                              >
                                <Check className="size-2.5 mr-1" />
                                Guardar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className={`text-[11px] leading-relaxed ${tag.description ? 'text-foreground/80' : 'text-muted-foreground italic'}`}>
                            {tag.description || 'Sin descripción — Agregá una para que la IA sepa cuándo aplicar esta etiqueta'}
                          </p>
                        )}
                      </div>

                      {/* AI toggle */}
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-background/50 px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Sparkles className={`size-3.5 ${tag.ai_auto_assign ? 'text-purple-400' : 'text-muted-foreground'}`} />
                          <span className="text-[11px] text-foreground">Auto-asignar con IA</span>
                        </div>
                        <button
                          onClick={() => handleUpdateTag(tag.id, { ai_auto_assign: !tag.ai_auto_assign })}
                          disabled={creatingTag}
                          className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50 ${
                            tag.ai_auto_assign ? 'bg-purple-500' : 'bg-muted-foreground/30'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block size-3 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                            tag.ai_auto_assign ? 'translate-x-3' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>

                      {/* Color picker inline */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground shrink-0">Color:</span>
                        <div className="flex gap-1 flex-wrap">
                          {TAG_COLORS.map(color => (
                            <button
                              key={color}
                              onClick={() => handleUpdateTag(tag.id, { color })}
                              className={`size-4 rounded-full transition-all hover:scale-110 ${tag.color === color ? 'ring-2 ring-white ring-offset-1 ring-offset-background' : ''}`}
                              style={{ backgroundColor: color }}
                              disabled={creatingTag}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Delete */}
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleDeleteTag(tag.id)}
                          disabled={creatingTag}
                          className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                        >
                          Eliminar etiqueta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
