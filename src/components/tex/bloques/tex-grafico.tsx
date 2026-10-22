'use client'

// Un gráfico de Tex: el título es la conclusión ("Paraná explica el 41 % del
// crecimiento"), no el tema. "Ver tabla" muestra los mismos datos como tabla
// (accesibilidad, y para copiar una cifra) y "Ampliar" lo abre en el Lienzo.
//
// Alto: 180 px en lo angosto, 240 en lo ancho, 200 en el panel compacto; un
// ranking crece con sus filas. Lo decide el CSS con container queries sobre el
// ancho del bloque (no de la ventana), así la primera pintada ya tiene el alto
// final; después se mide el lugar y recién ahí se dibuja.
//
// `data-sin-swipe`: en el celular el shell cambia de sección deslizando de
// costado, y pasar el dedo por un gráfico para ver el tooltip no es eso.

import dynamic from 'next/dynamic'
import { memo, useId, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { ChartColumnBig, Maximize2, Table2 } from 'lucide-react'
import type { TexGrafico } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { useTexAnimacion } from '../use-tex-animacion'
import { altoFilaHorizontal, igualesProfundo, prepararGrafico, tablaDeGrafico, type GraficoListo } from './formato'
import { TexTablaBloque } from './tex-tabla'
import { useMedidas } from './use-ancho'

const GraficoRecharts = dynamic(() => import('./grafico-recharts'), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-lg bg-white/[0.02]" />,
})

export type VarianteGrafico = 'chat' | 'lienzo' | 'ampliado'

export interface PropsTexGrafico {
  grafico: TexGrafico
  compacto?: boolean
  /**
   * chat:     en el hilo; 180 px (angosto) / 240 px (ancho) / 200 px (compacto), rankings de hasta 10 filas.
   * lienzo:   dentro del informe completo; 260 px, todas las filas.
   * ampliado: el gráfico solo en el Lienzo; más alto, todas las filas.
   */
  variante?: VarianteGrafico
  onAmpliar?: () => void
  /** El título ya está en el encabezado (gráfico ampliado). */
  sinTitulo?: boolean
  className?: string
}

/** Debajo de este ancho (del bloque) la torta pasa a barras ordenadas y los gráficos usan el alto chico. */
const ANCHO_ANGOSTO = 480
const FILAS_EN_CHAT = 10

export function BotonChico({ className, children, ...props }: ComponentProps<'button'> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        // 32 px a la vista, ~44 px al dedo (el ::after agranda la zona de toque).
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors',
        'after:absolute after:-inset-x-0.5 after:-inset-y-1.5 hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Alto en lo angosto y en lo ancho (el CSS elige con un container query). */
function altos(
  grafico: TexGrafico,
  variante: VarianteGrafico,
  compacto: boolean,
): { angosto: number; ancho: number; filasAngosto: number; filasAncho: number } {
  const enAngosto = prepararGrafico(grafico, { estrecho: true })
  const enAncho = prepararGrafico(grafico, { estrecho: compacto })
  const tope = (g: GraficoListo) => (variante === 'chat' ? Math.min(g.etiquetas.length, FILAS_EN_CHAT) : g.etiquetas.length)
  const medir = (g: GraficoListo, angosto: boolean): number => {
    if (g.dibujo === 'barras_horizontales') return tope(g) * altoFilaHorizontal(g.series.length) + 4
    if (g.dibujo === 'torta') return variante === 'chat' ? 216 : variante === 'lienzo' ? 260 : 300
    if (variante === 'lienzo') return 260
    if (variante === 'ampliado') return angosto ? 300 : 360
    return compacto ? 200 : angosto ? 180 : 240
  }
  return {
    angosto: medir(enAngosto, true),
    ancho: medir(enAncho, false),
    filasAngosto: enAngosto.dibujo === 'barras_horizontales' ? tope(enAngosto) : 0,
    filasAncho: enAncho.dibujo === 'barras_horizontales' ? tope(enAncho) : 0,
  }
}

function TexGraficoBase({ grafico, compacto = false, variante = 'chat', onAmpliar, sinTitulo = false, className }: PropsTexGrafico) {
  const [verTabla, setVerTabla] = useState(false)
  const [ref, medidas] = useMedidas<HTMLDivElement>()
  const animar = useTexAnimacion() === 'completa'
  const idTitulo = useId()

  const angosto = compacto || (medidas != null && medidas.ancho < ANCHO_ANGOSTO)
  const g = prepararGrafico(grafico, { estrecho: medidas == null ? true : angosto })
  const h = altos(grafico, variante, compacto)
  const filas = angosto || medidas == null ? h.filasAngosto : h.filasAncho
  const titulo = g.titulo || 'Gráfico'
  const recortado = g.dibujo === 'barras_horizontales' && filas > 0 && filas < g.etiquetas.length
  const leyenda = g.series.length > 1 && !g.porciones

  return (
    <figure
      data-sin-swipe
      aria-labelledby={sinTitulo ? undefined : idTitulo}
      aria-label={sinTitulo ? titulo : undefined}
      className={cn('@container min-w-0 rounded-xl border border-border bg-card p-3 @md:p-4', className)}
    >
      <div className="flex items-start gap-2">
        {sinTitulo ? (
          <span className="flex-1" />
        ) : (
          <p id={idTitulo} className="min-w-0 flex-1 pt-1 text-[14px] leading-5 font-semibold text-pretty text-foreground">
            {titulo}
          </p>
        )}
        {!g.vacio && (
          <div className="-mt-0.5 -mr-1 flex shrink-0 items-center gap-0.5">
            <BotonChico onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>
              {verTabla ? <ChartColumnBig aria-hidden /> : <Table2 aria-hidden />}
              {verTabla ? 'Ver gráfico' : 'Ver tabla'}
            </BotonChico>
            {onAmpliar && (
              <BotonChico onClick={onAmpliar} aria-label="Ampliar el gráfico">
                <Maximize2 aria-hidden />
                <span className="hidden @md:inline">Ampliar</span>
              </BotonChico>
            )}
          </div>
        )}
      </div>

      {leyenda && !verTabla && (
        <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1" aria-label="Series">
          {g.series.map((s, k) => (
            <li key={k} className="flex items-center gap-1.5 text-[12px] text-zinc-300">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden />
              {s.nombre}
            </li>
          ))}
        </ul>
      )}

      {g.vacio ? (
        <p className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[13px] text-muted-foreground">
          No hay datos para graficar.
        </p>
      ) : verTabla ? (
        <TexTablaBloque tabla={tablaDeGrafico(grafico)} modo="completa" sinTitulo claseScroll="max-h-[320px]" className="mt-3" />
      ) : (
        <div
          ref={ref}
          className="mt-3 h-(--alto-angosto) w-full @[480px]:h-(--alto-ancho)"
          style={{ '--alto-angosto': `${h.angosto}px`, '--alto-ancho': `${h.ancho}px` } as CSSProperties}
        >
          {medidas != null && (
            <GraficoRecharts g={g} ancho={medidas.ancho} alto={medidas.alto} animar={animar} filas={filas || undefined} />
          )}
        </div>
      )}

      {(g.nota || (recortado && !verTabla)) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
          {g.nota && <span>{g.nota}</span>}
          {recortado && !verTabla && (
            <span>
              Se ven {filas} de {g.etiquetas.length}.{' '}
              <button
                type="button"
                onClick={onAmpliar ?? (() => setVerTabla(true))}
                className="font-medium text-[color:var(--tex-texto)] underline-offset-2 hover:underline"
              >
                {onAmpliar ? 'Ver todo' : 'Ver la tabla'}
              </button>
            </span>
          )}
        </p>
      )}
    </figure>
  )
}

/**
 * Comparado por contenido: en cada chunk del stream el mensaje llega clonado y
 * sin esto recharts se redibujaría 20 veces por segundo mientras Tex escribe.
 * `onAmpliar` se compara por presencia (abre el mismo gráfico: es igual campo por campo).
 */
export const TexGraficoBloque = memo(
  TexGraficoBase,
  (a, b) =>
    a.compacto === b.compacto &&
    a.variante === b.variante &&
    a.sinTitulo === b.sinTitulo &&
    a.className === b.className &&
    !!a.onAmpliar === !!b.onAmpliar &&
    igualesProfundo(a.grafico, b.grafico),
)
