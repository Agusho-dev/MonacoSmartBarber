'use client'

// El composer de Tex. La cara (la única viva de la pantalla) asoma por detrás
// del borde superior izquierdo: es el "dock" desde el que Tex habla.
//
// Enter envía con mouse/trackpad; en táctil Enter es nueva línea y se envía con
// el botón (enterKeyHint="send" pone "Enviar" en el teclado). Cmd/Ctrl+Enter
// envía siempre. Esc detiene la respuesta en curso. Tab salta al próximo hueco
// "[período]" de una receta.

import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { ArrowUp, Plus, Square } from 'lucide-react'
import { TEX_MAX_CARACTERES } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TexCara, type TexCaraEstado } from '@/components/tex/tex-cara'
import { punteroFino } from './hooks'
import { TEX_RECETAS, huecoDesde } from './logica'

export interface TexComposerHandle {
  enfocar: () => void
  /** Reemplaza el texto y selecciona el primer hueco "[…]" (o deja el cursor al final). */
  escribir: (texto: string) => void
}

interface Props {
  ref?: Ref<TexComposerHandle>
  compacto: boolean
  ocupado: boolean
  deshabilitado: boolean
  placeholder: string
  orgNombre: string
  puedeConciliacion: boolean
  cara: { visible: boolean; estado: TexCaraEstado; texto: string }
  /** Devuelve false si no se pudo mandar (el texto se conserva). */
  onEnviar: (texto: string) => boolean
  onDetener: () => void
}

const CONTADOR_DESDE = 1800
const ALTO_LINEA = 24
const MAX_LINEAS = 5
const PADDING_VERTICAL = 16
const NUMERO = new Intl.NumberFormat('es-AR')

export function TexComposer({
  ref,
  compacto,
  ocupado,
  deshabilitado,
  placeholder,
  orgNombre,
  puedeConciliacion,
  cara,
  onEnviar,
  onDetener,
}: Props) {
  const [valor, setValor] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const seleccionRef = useRef<[number, number] | null>(null)
  const recetaElegidaRef = useRef(false)

  // Crece hasta 5 líneas; desde ahí scrollea adentro.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = ALTO_LINEA * MAX_LINEAS + PADDING_VERTICAL
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [valor])

  /** Enfoca y aplica la selección pendiente, cuando React ya dibujó el texto nuevo. */
  function enfocarConSeleccion() {
    requestAnimationFrame(() => {
      const el = areaRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      const sel = seleccionRef.current
      if (sel) {
        seleccionRef.current = null
        el.setSelectionRange(sel[0], sel[1])
      }
    })
  }

  function escribir(texto: string) {
    const t = texto.slice(0, TEX_MAX_CARACTERES)
    seleccionRef.current = huecoDesde(t) ?? [t.length, t.length]
    setValor(t)
    enfocarConSeleccion()
  }

  useImperativeHandle(ref, () => ({
    enfocar: () => areaRef.current?.focus({ preventScroll: true }),
    escribir,
  }))

  function insertarReceta(plantilla: string) {
    const base = valor.trimEnd()
    const nuevo = (base ? `${base} ${plantilla}` : plantilla).slice(0, TEX_MAX_CARACTERES)
    const desde = base ? base.length + 1 : 0
    seleccionRef.current = huecoDesde(nuevo, desde) ?? [nuevo.length, nuevo.length]
    recetaElegidaRef.current = true
    setValor(nuevo)
    enfocarConSeleccion()
  }

  function enviar() {
    const t = valor.trim()
    if (!t || deshabilitado || ocupado || t.length > TEX_MAX_CARACTERES) return
    if (onEnviar(t)) setValor('')
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && ocupado) {
      // Que no cierre también el panel: Esc acá es "detener".
      e.preventDefault()
      e.stopPropagation()
      onDetener()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.metaKey || e.ctrlKey || punteroFino()) {
        e.preventDefault()
        enviar()
      }
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const el = e.currentTarget
      const siguiente = huecoDesde(el.value, el.selectionEnd) ?? huecoDesde(el.value, 0)
      if (siguiente && !(siguiente[0] === el.selectionStart && siguiente[1] === el.selectionEnd)) {
        e.preventDefault()
        el.setSelectionRange(siguiente[0], siguiente[1])
      }
    }
  }

  const recetas = TEX_RECETAS.filter((r) => !r.conciliacion || puedeConciliacion)
  const largo = valor.length
  const puedeEnviar = valor.trim() !== '' && !deshabilitado && largo <= TEX_MAX_CARACTERES

  return (
    <div
      data-sin-swipe
      className={cn('shrink-0 px-3 pt-5', compacto ? 'pb-3' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-4')}
    >
      <div className={cn('relative mx-auto w-full', !compacto && 'max-w-[720px]')}>
        {cara.visible && (
          // Detrás del recuadro (z-0 vs z-10): asoma sobre el borde, no lo tapa.
          // 40 px en la compu y 36 en el celular con `zoom` (CSS puro: medirlo
          // con JS haría saltar la cara al hidratar).
          <span className="pointer-events-none absolute -top-[21px] left-4 z-0 max-lg:[zoom:0.9]">
            <TexCara tamano={40} estado={cara.estado} texto={cara.texto} />
          </span>
        )}

        <div
          className={cn(
            // 48 px en el celular y 52 en la compu, con el borde: 1 + 3 + 40 + 3 + 1 / 1 + 5 + 40 + 5 + 1.
            'relative z-10 flex items-end gap-1 rounded-[16px] border bg-card p-[3px] transition-[box-shadow,border-color] lg:p-[5px]',
            'focus-within:border-[color:var(--tex)]/40 focus-within:ring-2 focus-within:ring-[color:var(--tex)]/45',
            deshabilitado && 'opacity-70',
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={deshabilitado}
                aria-label="Pedidos guiados"
                title="Pedidos guiados"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/50 disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus className="size-5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={8}
              className="w-72"
              onCloseAutoFocus={(e) => {
                // Con una receta elegida el foco va al texto (con el hueco seleccionado), no al botón.
                if (recetaElegidaRef.current) {
                  recetaElegidaRef.current = false
                  e.preventDefault()
                  enfocarConSeleccion()
                }
              }}
            >
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Elegí uno y completá lo que está entre corchetes
              </DropdownMenuLabel>
              {recetas.map((r) => (
                <DropdownMenuItem key={r.id} className="min-h-10 flex-col items-start gap-0.5" onSelect={() => insertarReceta(r.plantilla)}>
                  <span className="text-sm font-medium">{r.etiqueta}</span>
                  <span className="text-xs text-muted-foreground">{r.plantilla}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={areaRef}
            rows={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={alTeclear}
            maxLength={TEX_MAX_CARACTERES}
            enterKeyHint="send"
            disabled={deshabilitado}
            placeholder={placeholder}
            aria-label="Mensaje para Tex"
            autoComplete="off"
            // 16 px en el celular: con menos, iOS hace zoom al enfocar.
            className="min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed lg:text-[15px]"
          />

          {ocupado ? (
            <button
              type="button"
              onClick={onDetener}
              aria-label="Detener"
              title="Detener (Esc)"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-transform hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 active:scale-95 motion-reduce:active:scale-100"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={enviar}
              disabled={!puedeEnviar}
              aria-label="Enviar"
              title="Enviar"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[transform,opacity] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 active:scale-95 disabled:pointer-events-none disabled:opacity-30 motion-reduce:active:scale-100"
            >
              <ArrowUp className="size-5" aria-hidden />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-3 px-1 text-[11px] leading-4 text-muted-foreground">
          <p className={cn('min-w-0', compacto && 'truncate')}>
            Tex trabaja con los datos reales de {orgNombre}. Revisá las cifras antes de decidir.
          </p>
          {largo >= CONTADOR_DESDE && (
            <span className={cn('shrink-0 tabular-nums', largo >= TEX_MAX_CARACTERES ? 'text-red-400' : 'text-amber-300')}>
              {NUMERO.format(largo)}/{NUMERO.format(TEX_MAX_CARACTERES)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
