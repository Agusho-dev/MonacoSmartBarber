'use client'

// Las etiquetas (Configuración → Etiquetas), como una pantalla de iOS
// (23/oct/2026, tercera ronda): el interruptor de «Etiquetar con IA» y su
// modelo, la etiqueta nueva (nombre, descripción para la IA, si la pone la IA y
// el color) y la lista, donde cada etiqueta se abre para cambiarle la
// descripción, el color o borrarla. Lo que hace es lo de siempre; antes era
// letra de 9 a 11 px, interruptores de 16 px y colores de 20.

import { useState, useTransition } from 'react'
import { Pencil, Plus, Sparkles, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveOrgAiConfig } from '@/lib/actions/ai-config'
import type { OrgAiConfig } from '@/lib/actions/ai-config'
import type { ConversationTag } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { TAG_COLORS } from '../shared/helpers'
import {
  BotonTextoCeldaIos, CeldaAccionIos, CeldaIos, CLASE_BOTON_CELDA, CLASE_CAMPO_CELDA, CLASE_CELDA, CLASE_CUERPO_BOTON,
  ConfirmacionIos, GrupoIos, IconoCeldaIos, InterruptorIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos,
  avisarFalla,
} from '../navegacion/lista-ios'
import { CeldaModeloIos } from './celda-modelo'

// Los nombres de los colores de TAG_COLORS (shared/helpers.ts), en el mismo orden: para el lector de pantalla.
const NOMBRES_DE_COLOR = ['Verde', 'Rojo', 'Naranja', 'Amarillo', 'Celeste', 'Azul', 'Violeta', 'Rosa', 'Gris']

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
  // La que se va a borrar: sigue guardada mientras la confirmación se cierra.
  const [aBorrar, setABorrar] = useState<{ tag: ConversationTag; abierta: boolean } | null>(null)

  const aiEnabledCount = tags.filter(t => t.ai_auto_assign).length
  const isAutoTagEnabled = aiConfig?.auto_tag_enabled ?? false

  const handleToggleGlobalAutoTag = () => {
    startSavingAutoTag(async () => {
      const newVal = !isAutoTagEnabled
      try {
        const result = await saveOrgAiConfig({ auto_tag_enabled: newVal })
        if (result.error) { toast.error(result.error) }
        else {
          toast.success(newVal ? 'Etiquetado con IA prendido' : 'Etiquetado con IA apagado')
          if (result.data) setAiConfig(result.data)
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo cambiar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleSaveAutoTagModel = (model: string) => {
    startSavingAutoTag(async () => {
      try {
        const result = await saveOrgAiConfig({ auto_tag_model: model })
        if (result.error) { toast.error(result.error) }
        else if (result.data) setAiConfig(result.data)
      } catch (e) {
        avisarFalla(e, 'No se pudo guardar el modelo. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleSaveDescription = (tagId: string) => {
    if (!editingDescription || editingDescription.tagId !== tagId) return
    handleUpdateTag(tagId, { description: editingDescription.text })
    setEditingDescription(null)
  }

  const crear = () => {
    if (!newTagName.trim()) return
    handleCreateTag(newTagName, newTagColor, newTagDescription || undefined, newTagAi)
    setNewTagName('')
    setNewTagDescription('')
    setNewTagAi(false)
  }

  return (
    <>
      {/* ── Etiquetar con IA ── */}
      <GrupoIos pie="La IA lee los mensajes nuevos y les pone las etiquetas «con IA» cuya descripción coincide.">
        <CeldaIos
          icono={<IconoCeldaIos icono={Sparkles} color="violeta" />}
          derecha={
            <InterruptorIos
              activo={isAutoTagEnabled}
              etiqueta="Etiquetar con IA"
              deshabilitado={savingAutoTag}
              onCambio={handleToggleGlobalAutoTag}
            />
          }
        >
          <div className="min-w-0 flex-1">
            <p className={TEXTO_PRINCIPAL}>Etiquetar con IA</p>
            <p className={cn(TEXTO_TERCIARIO, 'truncate')}>
              {isAutoTagEnabled
                ? `${aiEnabledCount} etiqueta${aiEnabledCount !== 1 ? 's' : ''} con IA`
                : 'Apagado'}
            </p>
          </div>
        </CeldaIos>
        {isAutoTagEnabled && (
          <CeldaModeloIos
            etiqueta="Modelo"
            valor={aiConfig?.auto_tag_model || 'gpt-4o-mini'}
            onCambio={handleSaveAutoTagModel}
          />
        )}
      </GrupoIos>

      {/* ── Nueva etiqueta ── */}
      <GrupoIos titulo="Nueva etiqueta" pie="Por ejemplo, «Consulta de precios». La descripción le dice a la IA cuándo ponerla.">
        <CeldaIos campo>
          <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: newTagColor }} />
          <input
            aria-label="Nombre de la etiqueta nueva"
            placeholder="Nombre"
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') crear()
            }}
            enterKeyHint="done"
            className={CLASE_CAMPO_CELDA}
          />
        </CeldaIos>
        <CeldaIos campo>
          <textarea
            aria-label="Descripción para la IA"
            rows={2}
            placeholder="Descripción para la IA"
            value={newTagDescription}
            onChange={e => setNewTagDescription(e.target.value)}
            className={cn(CLASE_CAMPO_CELDA, 'h-auto min-h-[4.5rem] resize-none py-2.5 leading-[22px] lg:h-auto lg:min-h-14 lg:py-2 lg:leading-5')}
          />
        </CeldaIos>
        <CeldaIos derecha={<InterruptorIos activo={newTagAi} etiqueta="La pone la IA" onCambio={setNewTagAi} />}>
          <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>La pone la IA</span>
        </CeldaIos>
        <li className={CLASE_CELDA}>
          <SelectorDeColor etiqueta="Color de la etiqueta nueva" valor={newTagColor} onCambio={setNewTagColor} />
        </li>
        <CeldaAccionIos icono={Plus} onClick={crear} deshabilitada={creatingTag || !newTagName.trim()}>
          Crear etiqueta
        </CeldaAccionIos>
      </GrupoIos>

      {/* ── Lista de etiquetas ── */}
      {tags.length === 0 ? (
        <VacioIos
          icono={Tag}
          titulo="Todavía no hay etiquetas"
          texto="Creá la primera con una descripción para que la IA sepa cuándo ponerla."
        />
      ) : (
        <GrupoIos titulo={`Etiquetas · ${tags.length}`}>
          {tags.map(tag => {
            const isExpanded = expandedTag === tag.id
            const isEditingDesc = editingDescription?.tagId === tag.id
            return (
              <li key={tag.id} className={cn(CLASE_CELDA, 'items-start')}>
                <div className={cn(CLASE_CUERPO_BOTON, 'flex-col items-stretch gap-0')}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedTag(isExpanded ? null : tag.id)}
                    className={cn(CLASE_BOTON_CELDA, 'flex-row items-center gap-3')}
                  >
                    <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="min-w-0 flex-1">
                      <span className={cn(TEXTO_PRINCIPAL, 'block truncate')}>{tag.name}</span>
                      {tag.description && !isExpanded && (
                        <span className={cn(TEXTO_TERCIARIO, 'block truncate')}>{tag.description}</span>
                      )}
                    </span>
                    {tag.ai_auto_assign && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#a05cdc]/20 px-2 py-0.5 text-[13px] font-medium text-[#d1a8ff] lg:text-[12px]">
                        <Sparkles aria-hidden className="size-3.5" />
                        IA
                      </span>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="space-y-3 pb-3 lg:pb-2.5">
                      {/* Descripción */}
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={TEXTO_TERCIARIO}>Descripción para la IA</p>
                          {!isEditingDesc && (
                            <BotonTextoCeldaIos
                              icono={Pencil}
                              onClick={() => setEditingDescription({ tagId: tag.id, text: tag.description || '' })}
                              etiqueta={`Editar la descripción de «${tag.name}»`}
                            >
                              Editar
                            </BotonTextoCeldaIos>
                          )}
                        </div>
                        {isEditingDesc ? (
                          <div className="mt-1 space-y-1">
                            <textarea
                              aria-label={`Descripción de «${tag.name}» para la IA`}
                              className="w-full resize-none rounded-[12px] bg-[var(--wa-raised-2)] px-3 py-2.5 text-[17px] leading-[22px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-3)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/50 lg:rounded-md lg:py-2 lg:text-[14px] lg:leading-5"
                              rows={3}
                              placeholder="Por ejemplo: el cliente pregunta por precios, promociones o descuentos"
                              value={editingDescription.text}
                              onChange={e => setEditingDescription({ ...editingDescription, text: e.target.value })}
                            />
                            <div className="flex justify-end gap-4 lg:gap-3">
                              <BotonTextoCeldaIos tono="neutro" onClick={() => setEditingDescription(null)}>Cancelar</BotonTextoCeldaIos>
                              <BotonTextoCeldaIos onClick={() => handleSaveDescription(tag.id)} deshabilitado={creatingTag}>
                                Guardar
                              </BotonTextoCeldaIos>
                            </div>
                          </div>
                        ) : (
                          <p className={cn(TEXTO_SECUNDARIO, 'mt-0.5', tag.description && 'text-[var(--wa-text)]')}>
                            {tag.description || 'Sin descripción: agregale una para que la IA sepa cuándo ponerla.'}
                          </p>
                        )}
                      </div>

                      {/* La pone la IA */}
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn(TEXTO_SECUNDARIO, 'text-[var(--wa-text)]')}>La pone la IA</span>
                        <InterruptorIos
                          activo={tag.ai_auto_assign}
                          etiqueta={`«${tag.name}» la pone la IA`}
                          deshabilitado={creatingTag}
                          onCambio={(activa) => handleUpdateTag(tag.id, { ai_auto_assign: activa })}
                        />
                      </div>

                      {/* Color */}
                      <SelectorDeColor
                        etiqueta={`Color de «${tag.name}»`}
                        valor={tag.color}
                        deshabilitado={creatingTag}
                        onCambio={(color) => handleUpdateTag(tag.id, { color })}
                      />

                      {/* Borrar */}
                      <BotonTextoCeldaIos
                        tono="peligro"
                        icono={Trash2}
                        onClick={() => setABorrar({ tag, abierta: true })}
                        deshabilitado={creatingTag}
                      >
                        Eliminar etiqueta
                      </BotonTextoCeldaIos>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </GrupoIos>
      )}

      <ConfirmacionIos
        abierta={!!aBorrar?.abierta}
        onAbiertaCambio={(abierta) => setABorrar(b => (b ? { ...b, abierta } : b))}
        titulo="¿Eliminar la etiqueta?"
        texto={aBorrar ? `«${aBorrar.tag.name}» sale de todas las conversaciones que la tienen. No se puede deshacer.` : ''}
        accion="Eliminar"
        onConfirmar={() => {
          if (!aBorrar) return
          if (expandedTag === aBorrar.tag.id) setExpandedTag(null)
          handleDeleteTag(aBorrar.tag.id)
        }}
      />
    </>
  )
}

/** Los colores de las etiquetas: círculos de 28 px que se tocan en 44, el elegido con el anillo. */
function SelectorDeColor({
  etiqueta,
  valor,
  onCambio,
  deshabilitado,
}: {
  etiqueta: string
  valor: string
  onCambio: (color: string) => void
  deshabilitado?: boolean
}) {
  return (
    // De a cinco por fila en el celular (cinco y cuatro, parejas: con flex-wrap
    // quedaban siete y dos), repartidos de punta a punta; en la compu, las nueve
    // en una fila.
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="-ml-1.5 grid w-full grid-cols-[repeat(5,2.75rem)] justify-between py-1 pr-2.5 lg:-ml-1 lg:grid-cols-[repeat(9,2rem)] lg:pr-2"
    >
      {TAG_COLORS.map((color, i) => {
        const elegido = valor === color
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={elegido}
            aria-label={NOMBRES_DE_COLOR[i] ?? color}
            title={NOMBRES_DE_COLOR[i] ?? color}
            disabled={deshabilitado}
            onClick={() => onCambio(color)}
            className="group/color flex size-11 items-center justify-center rounded-full outline-none [-webkit-tap-highlight-color:transparent] disabled:opacity-50 lg:size-8"
          >
            <span
              aria-hidden
              className={cn(
                'size-7 rounded-full transition-transform duration-150 group-active/color:scale-90 lg:size-6',
                'group-focus-visible/color:ring-2 group-focus-visible/color:ring-[var(--wa-accent)] group-focus-visible/color:ring-offset-2 group-focus-visible/color:ring-offset-[var(--wa-raised)]',
                elegido && 'ring-[2.5px] ring-white ring-offset-2 ring-offset-[var(--wa-raised)]',
              )}
              style={{ backgroundColor: color }}
            />
          </button>
        )
      })}
    </div>
  )
}
