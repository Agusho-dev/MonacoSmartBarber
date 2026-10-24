'use client'

// Respuestas rápidas, como las de WhatsApp Business para iOS (23/oct/2026,
// tercera ronda): una celda por respuesta (el título, el atajo y el texto);
// tocarla la edita en una hoja (la de iOS de pantalla entera en el celular, el
// diálogo de la Mac en la compu); «Editar» en la barra pasa al modo de ordenar
// y borrar, con el «⊖» rojo de iOS y las flechas, todo de 44 px y con nombre; y
// el «+» abre la hoja vacía. Antes eran flechas y lápices de 12 a 14 px sin
// nombre y un diálogo centrado del dashboard.

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, MessageCircle, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  getQuickReplies, createQuickReply, updateQuickReply,
  deleteQuickReply, reorderQuickReplies,
} from '@/lib/actions/quick-replies'
import { cn } from '@/lib/utils'
import { HojaWhatsApp } from '../dialogs/hoja-whatsapp'
import {
  AccionDeBarraIos, BotonMasIos, BotonPrincipal, BotonSecundario, BotonTextoIos, EncabezadoSeccion,
} from '../navegacion/barra-ios'
import {
  BotonIconoIos, BotonPildoraIos, CargandoIos, CeldaAccionIos, CeldaIos, CLASE_BOTON_CELDA, CLASE_CAMPO_CELDA, CLASE_CELDA, CLASE_CUERPO,
  CLASE_CUERPO_BOTON,
  ConfirmacionIos, ContenidoSeccion, GrupoIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, VacioIos, avisarFalla,
} from '../navegacion/lista-ios'

interface QuickReply {
  id: string
  title: string
  content: string
  shortcut: string | null
  sort_order: number
  created_at: string
}

export function QuickReplySection() {
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [lectura, setLectura] = useState<{ pedido: number; cargando: boolean; error: string | null }>({ pedido: 0, cargando: true, error: null })
  // La hoja: nueva (respuesta null) o para editar una. `vez` la monta de nuevo en cada apertura.
  const [editor, setEditor] = useState<{ abierto: boolean; respuesta: QuickReply | null; vez: number }>({ abierto: false, respuesta: null, vez: 0 })
  const [editando, setEditando] = useState(false)
  // En el modo de edición, la que mostró su «Eliminar» (el primer toque en el «⊖»).
  const [aBorrar, setABorrar] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    getQuickReplies()
      .then(result => {
        if (!vigente) return
        if (result.data) setReplies(result.data as QuickReply[])
        setLectura(l => ({ ...l, cargando: false, error: result.error }))
      })
      .catch(() => {
        if (vigente) setLectura(l => ({ ...l, cargando: false, error: 'No pudimos leer las respuestas rápidas. Revisá la conexión.' }))
      })
    return () => { vigente = false }
  }, [lectura.pedido])

  const openEditor = (reply?: QuickReply) => setEditor(e => ({ abierto: true, respuesta: reply ?? null, vez: e.vez + 1 }))

  const cambiarModo = () => {
    setEditando(!(editando && replies.length > 0))
    setABorrar(null)
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteQuickReply(id)
      if (result.error) { toast.error(result.error); return false }
      setReplies(prev => prev.filter(r => r.id !== id))
      toast.success('Eliminada')
      return true
    } catch (e) {
      avisarFalla(e, 'No se pudo eliminar. Revisá la conexión y probá de nuevo.')
      return false
    }
  }

  const moveReply = async (index: number, direction: 'up' | 'down') => {
    const newReplies = [...replies]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newReplies.length) return
    ;[newReplies[index], newReplies[targetIndex]] = [newReplies[targetIndex], newReplies[index]]
    setReplies(newReplies)
    try {
      await reorderQuickReplies(newReplies.map(r => r.id))
    } catch (e) {
      avisarFalla(e, 'No se pudo guardar el orden. Revisá la conexión y probá de nuevo.')
    }
  }

  const hay = replies.length > 0
  // Sin respuestas no hay nada que ordenar ni borrar: si se borró la última,
  // la pantalla vuelve sola al modo normal (con el «+»).
  const enEdicion = editando && hay

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AccionDeBarraIos>
        {hay && (
          <BotonTextoIos onClick={cambiarModo} negrita={enEdicion}>{enEdicion ? 'Listo' : 'Editar'}</BotonTextoIos>
        )}
        {!enEdicion && <BotonMasIos etiqueta="Nueva respuesta rápida" onClick={() => openEditor()} />}
      </AccionDeBarraIos>
      <EncabezadoSeccion titulo="Respuestas rápidas">
        {hay && <BotonSecundario onClick={cambiarModo} negrita={enEdicion}>{enEdicion ? 'Listo' : 'Editar'}</BotonSecundario>}
        {!enEdicion && (
          <BotonPrincipal onClick={() => openEditor()}>
            <Plus aria-hidden className="size-3.5" strokeWidth={2.5} /> Nueva respuesta
          </BotonPrincipal>
        )}
      </EncabezadoSeccion>

      <ContenidoSeccion>
        {lectura.cargando && !hay ? (
          <CargandoIos texto="Cargando respuestas rápidas…" />
        ) : lectura.error && !hay ? (
          <VacioIos icono={MessageCircle} titulo="No pudimos leer las respuestas rápidas" texto={lectura.error}>
            <BotonPildoraIos icono={RefreshCw} onClick={() => setLectura(l => ({ pedido: l.pedido + 1, cargando: true, error: null }))}>
              Reintentar
            </BotonPildoraIos>
          </VacioIos>
        ) : !hay ? (
          <VacioIos
            icono={MessageCircle}
            titulo="Sin respuestas rápidas"
            texto="Mensajes que usás seguido (horarios, precios, la dirección), listos para mandar con «/» y el atajo."
          >
            <BotonPildoraIos icono={Plus} onClick={() => openEditor()}>Nueva respuesta</BotonPildoraIos>
          </VacioIos>
        ) : (
          <GrupoIos
            pie={
              enEdicion
                ? 'Con las flechas cambiás el orden en que aparecen en el chat.'
                : 'En el chat, escribí «/» y el atajo para usarlas.'
            }
          >
            {replies.map((reply, index) =>
              enEdicion ? (
                <CeldaEnEdicion
                  key={reply.id}
                  reply={reply}
                  primera={index === 0}
                  ultima={index === replies.length - 1}
                  borrando={aBorrar === reply.id}
                  onPedirBorrar={() => setABorrar(b => (b === reply.id ? null : reply.id))}
                  onBorrar={() => {
                    setABorrar(null)
                    void handleDelete(reply.id)
                  }}
                  onSubir={() => void moveReply(index, 'up')}
                  onBajar={() => void moveReply(index, 'down')}
                />
              ) : (
                <li key={reply.id} className={CLASE_CELDA}>
                  <div className={CLASE_CUERPO_BOTON}>
                    <button type="button" onClick={() => openEditor(reply)} className={cn(CLASE_BOTON_CELDA, 'py-3 lg:py-2.5')}>
                      <TextosDeRespuesta reply={reply} />
                    </button>
                  </div>
                </li>
              ),
            )}
          </GrupoIos>
        )}
      </ContenidoSeccion>

      <EditorDeRespuesta
        key={editor.vez}
        open={editor.abierto}
        respuesta={editor.respuesta}
        onOpenChange={(abierto) => setEditor(e => ({ ...e, abierto }))}
        onGuardada={(r, nueva) => setReplies(prev => (nueva ? [...prev, r] : prev.map(x => (x.id === r.id ? r : x))))}
        onBorrar={handleDelete}
      />
    </div>
  )
}

function TextosDeRespuesta({ reply }: { reply: QuickReply }) {
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn(TEXTO_PRINCIPAL, 'min-w-0 truncate font-semibold')}>{reply.title}</span>
        {reply.shortcut && (
          <span className="shrink-0 text-[15px] text-[var(--wa-accent)] lg:text-[13px]">/{reply.shortcut}</span>
        )}
      </span>
      <span className={cn(TEXTO_SECUNDARIO, 'mt-0.5 line-clamp-2 block')}>{reply.content}</span>
    </>
  )
}

/**
 * Una celda en el modo de edición de iOS: el «⊖» rojo a la izquierda (el primer
 * toque muestra «Eliminar»; el segundo borra) y, a la derecha, subir y bajar.
 */
function CeldaEnEdicion({
  reply,
  primera,
  ultima,
  borrando,
  onPedirBorrar,
  onBorrar,
  onSubir,
  onBajar,
}: {
  reply: QuickReply
  primera: boolean
  ultima: boolean
  borrando: boolean
  onPedirBorrar: () => void
  onBorrar: () => void
  onSubir: () => void
  onBajar: () => void
}) {
  return (
    <li className={cn(CLASE_CELDA, 'gap-1 pl-1.5 lg:pl-1')}>
      <button
        type="button"
        onClick={onPedirBorrar}
        aria-label={`Borrar «${reply.title}»`}
        aria-expanded={borrando}
        className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:size-8"
      >
        <span aria-hidden className={cn('flex size-[22px] items-center justify-center rounded-full bg-[#ff3b30] transition-transform duration-200 lg:size-[18px]', borrando && '-rotate-90')}>
          <span className="h-[2.5px] w-3 rounded-full bg-white lg:w-2.5" />
        </span>
      </button>
      <div className={cn(CLASE_CUERPO, 'py-3 pr-1.5 lg:py-2.5 lg:pr-2')}>
        <div className="min-w-0 flex-1">
          <TextosDeRespuesta reply={reply} />
        </div>
        {borrando ? (
          <button
            type="button"
            onClick={onBorrar}
            className="relative z-10 flex h-11 shrink-0 items-center rounded-[12px] bg-[#ff3b30] px-4 text-[17px] font-semibold text-white outline-none transition-colors active:bg-[#d92f25] focus-visible:ring-2 focus-visible:ring-white/70 lg:h-8 lg:rounded-md lg:px-3 lg:text-[13px] lg:hover:bg-[#e8352b]"
          >
            Eliminar
          </button>
        ) : (
          <span className="flex shrink-0 items-center">
            <BotonIconoIos etiqueta={`Subir «${reply.title}»`} icono={ArrowUp} onClick={onSubir} deshabilitado={primera} />
            <BotonIconoIos etiqueta={`Bajar «${reply.title}»`} icono={ArrowDown} onClick={onBajar} deshabilitado={ultima} />
          </span>
        )}
      </div>
    </li>
  )
}

/** La hoja de una respuesta: nueva o para editar (y borrar). */
function EditorDeRespuesta({
  open,
  respuesta,
  onOpenChange,
  onGuardada,
  onBorrar,
}: {
  open: boolean
  respuesta: QuickReply | null
  onOpenChange: (abierto: boolean) => void
  onGuardada: (respuesta: QuickReply, nueva: boolean) => void
  onBorrar: (id: string) => Promise<boolean>
}) {
  const [formTitle, setFormTitle] = useState(respuesta?.title ?? '')
  const [formContent, setFormContent] = useState(respuesta?.content ?? '')
  const [formShortcut, setFormShortcut] = useState(respuesta?.shortcut ?? '')
  const [isSaving, startSaving] = useTransition()
  const [borrando, startBorrando] = useTransition()
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)

  const handleSave = () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error('Título y contenido son requeridos'); return
    }
    startSaving(async () => {
      try {
        if (respuesta) {
          const result = await updateQuickReply(respuesta.id, {
            title: formTitle,
            content: formContent,
            shortcut: formShortcut || undefined,
          })
          if (result.error) { toast.error(result.error); return }
          onGuardada({ ...respuesta, title: formTitle, content: formContent, shortcut: formShortcut || null }, false)
          toast.success('Respuesta rápida actualizada')
        } else {
          const result = await createQuickReply({
            title: formTitle,
            content: formContent,
            shortcut: formShortcut || undefined,
          })
          if (result.error) { toast.error(result.error); return }
          onGuardada(result.data as QuickReply, true)
          toast.success('Respuesta rápida creada')
        }
        onOpenChange(false)
      } catch (e) {
        avisarFalla(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  return (
    <HojaWhatsApp
      open={open}
      onOpenChange={onOpenChange}
      titulo={respuesta ? 'Editar respuesta' : 'Nueva respuesta'}
      descripcion="El título, el mensaje y el atajo con el que la usás en el chat."
      // En la compu, el foco al título; con pantalla táctil va a la hoja.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        document.getElementById('respuesta-titulo')?.focus()
      }}
      accion={{
        texto: 'Guardar',
        textoCargando: 'Guardando…',
        onClick: handleSave,
        deshabilitada: !formTitle.trim() || !formContent.trim() || borrando,
        cargando: isSaving,
      }}
    >
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)] lg:px-5 lg:pb-6 lg:pt-4">
        <GrupoIos titulo="Título">
          <CeldaIos campo>
            <input
              id="respuesta-titulo"
              aria-label="Título"
              placeholder="Horarios de atención"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              className={CLASE_CAMPO_CELDA}
            />
          </CeldaIos>
        </GrupoIos>

        <GrupoIos titulo="Mensaje">
          <CeldaIos campo>
            <textarea
              aria-label="Mensaje"
              rows={5}
              placeholder="Nuestros horarios de atención son…"
              value={formContent}
              onChange={e => setFormContent(e.target.value)}
              className={cn(CLASE_CAMPO_CELDA, 'h-auto min-h-[7.5rem] resize-none py-2.5 leading-[22px] lg:h-auto lg:min-h-24 lg:py-2 lg:leading-5')}
            />
          </CeldaIos>
        </GrupoIos>

        <GrupoIos
          titulo="Atajo"
          pie={formShortcut ? <>Escribí <Atajo>/{formShortcut}</Atajo> en el chat para usarla.</> : 'Opcional: una palabra corta para encontrarla rápido en el chat.'}
        >
          <CeldaIos campo>
            <span aria-hidden className="text-[17px] text-[var(--wa-text-2)] lg:text-[14px]">/</span>
            <input
              aria-label="Atajo"
              placeholder="horarios"
              value={formShortcut}
              onChange={e => setFormShortcut(e.target.value.replace(/\s/g, ''))}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(CLASE_CAMPO_CELDA, '-ml-1')}
            />
          </CeldaIos>
        </GrupoIos>

        {respuesta && (
          <GrupoIos>
            <CeldaAccionIos
              tono="peligro"
              centrada
              deshabilitada={borrando || isSaving}
              onClick={() => setConfirmarBorrar(true)}
            >
              {borrando ? 'Eliminando…' : 'Eliminar respuesta'}
            </CeldaAccionIos>
          </GrupoIos>
        )}
      </div>

      {respuesta && (
        <ConfirmacionIos
          abierta={confirmarBorrar}
          onAbiertaCambio={setConfirmarBorrar}
          titulo="¿Eliminar la respuesta?"
          texto={`«${respuesta.title}» deja de estar en el chat. No se puede deshacer.`}
          accion="Eliminar"
          onConfirmar={() =>
            startBorrando(async () => {
              if (await onBorrar(respuesta.id)) onOpenChange(false)
            })
          }
        />
      )}
    </HojaWhatsApp>
  )
}

function Atajo({ children }: { children: ReactNode }) {
  return <span className="text-[var(--wa-accent)]">{children}</span>
}
