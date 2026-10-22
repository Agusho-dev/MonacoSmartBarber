'use client'

// Una tabla de Tex. En el chat muestra lo justo (5 filas en lo angosto, 10 en
// lo ancho, decidido por el ancho del bloque con container queries) y ofrece
// "Ver las N filas" en el Lienzo; sin Lienzo, se expande en el lugar.
//
// Encabezado y primera columna fijos: en el celular la tabla se corre de
// costado y la primera columna (el barbero, el día) no se pierde. Por eso
// `border-separate` (con `collapse` los bordes de las celdas fijas se van con
// el scroll) y fondos sólidos en lo que queda fijo.

import { memo, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import type { TexTabla } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { alineacionesDeTabla, formatosDeTabla, igualesProfundo, textoDeCelda } from './formato'

export interface PropsTexTabla {
  tabla: TexTabla
  compacto?: boolean
  /**
   * chat:     5/10 filas y "Ver las N filas".
   * completa: todas las filas; el contenedor de scroll lo limita quien la monta
   *           (`claseScroll`, p. ej. `max-h-full`) para que el encabezado quede fijo.
   */
  modo?: 'chat' | 'completa'
  /** Abre la tabla entera en el Lienzo. Sin esto, "Ver las N filas" la expande acá. */
  onVerTodas?: () => void
  sinTitulo?: boolean
  claseScroll?: string
  className?: string
}

const FILAS_ANGOSTO = 5
const FILAS_ANCHO = 10

function TexTablaBase({ tabla, compacto = false, modo = 'chat', onVerTodas, sinTitulo = false, claseScroll, className }: PropsTexTabla) {
  const [expandida, setExpandida] = useState(false)
  const columnas = Array.isArray(tabla?.columnas) ? tabla.columnas.map((c) => String(c ?? '')) : []
  const filas = Array.isArray(tabla?.filas) ? tabla.filas.filter(Array.isArray) : []
  if (columnas.length === 0) return null
  const alinear = alineacionesDeTabla(tabla)
  // Un año o un DNI van sin separador de miles ("2026", no "2.026").
  const formatos = formatosDeTabla(tabla)

  const total = filas.length
  const todas = modo === 'completa' || expandida
  // Compacto: siempre 5. Si no, se dibujan 10 y las 5 de abajo sólo se ven
  // cuando el bloque es ancho (≥ 576 px): sin JS, sin saltos al hidratar.
  const tope = todas ? total : compacto ? FILAS_ANGOSTO : FILAS_ANCHO
  const visibles = filas.slice(0, tope)
  const ocultasEnAngosto = !todas && !compacto
  const hayMas = !todas && total > FILAS_ANGOSTO
  // Entre 6 y 10 filas, en lo ancho ya se ven todas: el botón sólo hace falta en lo angosto.
  const botonSoloAngosto = hayMas && !compacto && total <= FILAS_ANCHO
  const titulo = tabla.titulo?.trim()

  return (
    <section className={cn('@container min-w-0', className)} aria-label={titulo || 'Tabla'}>
      {titulo && !sinTitulo && <h3 className="mb-2 text-[13px] font-semibold text-foreground">{titulo}</h3>}
      {total === 0 ? (
        <p className="rounded-xl border border-border bg-card px-3 py-4 text-center text-[13px] text-muted-foreground">
          No hay filas para mostrar.
        </p>
      ) : (
        <div
          data-sin-swipe
          role="region"
          aria-label={titulo || 'Tabla'}
          tabIndex={0}
          className={cn(
            'overflow-auto overscroll-x-contain rounded-xl border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-white/20',
            claseScroll,
          )}
        >
          <table className="w-full border-separate border-spacing-0 text-[13px] leading-5">
            <thead>
              <tr>
                {columnas.map((c, j) => (
                  <th
                    key={j}
                    scope="col"
                    className={cn(
                      'sticky top-0 z-10 border-b border-border bg-[#111111] px-3 py-2 text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase',
                      alinear[j] === 'der' ? 'text-right' : 'text-left',
                      j === 0 && 'left-0 z-20',
                    )}
                  >
                    {c || <span className="sr-only">Categoría</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((fila, i) => (
                <tr
                  key={i}
                  className={cn(
                    'group',
                    ocultasEnAngosto && i >= FILAS_ANGOSTO && 'hidden @xl:table-row',
                    // En lo angosto la quinta es la última que se ve: sin filete abajo.
                    ocultasEnAngosto && i === FILAS_ANGOSTO - 1 && visibles.length > FILAS_ANGOSTO && '@max-xl:[&>td]:border-b-0',
                  )}
                >
                  {columnas.map((_, j) => {
                    const crudo = fila[j]
                    const texto = textoDeCelda(crudo, formatos[j])
                    const vacio = crudo == null || texto === '—'
                    const largo = alinear[j] === 'izq' && texto.length > 42
                    return (
                      <td
                        key={j}
                        className={cn(
                          'border-b border-white/[0.06] px-3 py-2 align-top group-last:border-b-0',
                          j === 0 && 'sticky left-0 z-[1] bg-card font-medium text-foreground',
                          j !== 0 && 'text-zinc-300',
                          alinear[j] === 'der' ? 'text-right whitespace-nowrap tabular-nums' : largo ? 'min-w-[14rem] whitespace-normal' : 'whitespace-nowrap',
                          vacio && 'text-zinc-600',
                        )}
                      >
                        {texto}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(hayMas || expandida) && modo === 'chat' && (
        <div className={cn('mt-1.5', botonSoloAngosto && !expandida && '@xl:hidden')}>
          {expandida ? (
            <button
              type="button"
              onClick={() => setExpandida(false)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <ChevronUp className="size-4" aria-hidden />
              Ver menos
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (onVerTodas ? onVerTodas() : setExpandida(true))}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {onVerTodas ? <Maximize2 className="size-3.5" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
              Ver las {total.toLocaleString('es-AR')} filas
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Comparada por contenido (en cada chunk del stream el mensaje llega clonado).
 * `onVerTodas` se compara por presencia: el que llega abre el mismo contenido
 * porque la tabla es igual campo por campo.
 */
export const TexTablaBloque = memo(
  TexTablaBase,
  (a, b) =>
    a.compacto === b.compacto &&
    a.modo === b.modo &&
    a.sinTitulo === b.sinTitulo &&
    a.claseScroll === b.claseScroll &&
    a.className === b.className &&
    !!a.onVerTodas === !!b.onVerTodas &&
    igualesProfundo(a.tabla, b.tabla),
)
