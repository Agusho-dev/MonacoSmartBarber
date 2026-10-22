'use client'

// Las cifras clave de una respuesta. La cifra es la protagonista: grande, en
// Geist Mono con números tabulares, y nunca se corta (si es larga, se achica).
// El delta sólo aparece con su base: "+12 %" sin "vs. qué" es un número que no
// dice nada (o, peor, que se lee contra lo que uno se imagina).
//
// Cada tarjeta es una subgrilla de 3 filas (etiqueta · cifra · delta) alineada
// con sus vecinas: si una etiqueta ocupa dos renglones o una tarjeta no tiene
// delta, las cifras de la fila siguen a la misma altura.

import { memo } from 'react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { TexKpi } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { CLASE_DELTA, claseColumnaKpi, direccionDeDelta, igualesProfundo } from './formato'

interface Props {
  items: TexKpi[]
  titulo?: string
  compacto?: boolean
  className?: string
}

/**
 * El tamaño de la cifra sale del ancho de SU tarjeta (container query units):
 * en 4 por fila o en el celular, "$123.456.789" se achica hasta entrar en vez
 * de desbordar o cortarse. Geist Mono mide ~0,6 em por carácter. Si con 14 px
 * igual no entra ("32 % de 1.200 clientes únicos"), pasa a dos renglones
 * (`line-clamp-2`): antes seguía en uno y se metía en la tarjeta de al lado.
 */
function tamanoValor(valor: string, compacto: boolean): string {
  const caracteres = Math.max(6, valor.length) * 0.62
  return `clamp(14px, calc(100cqi / ${caracteres.toFixed(2)}), ${compacto ? 19 : 22}px)`
}

function Delta({ kpi }: { kpi: TexKpi }) {
  // El color lo decide la herramienta (un gasto que sube viene como 'baja');
  // la flecha, el signo escrito: así "+21 %" de gastos va en rojo pero apunta para arriba.
  const color = CLASE_DELTA[kpi.tono ?? 'neutro']
  const direccion = direccionDeDelta(kpi.delta) ?? (kpi.tono === 'sube' ? 'sube' : kpi.tono === 'baja' ? 'baja' : 'igual')
  const Icono = direccion === 'sube' ? TrendingUp : direccion === 'baja' ? TrendingDown : Minus
  return (
    <p className="mt-1 text-[11px] leading-4">
      <span className={cn('mr-1.5 inline-flex items-center gap-1 align-top font-semibold whitespace-nowrap tabular-nums', color)}>
        <Icono className="size-3.5" aria-hidden />
        {kpi.delta}
      </span>
      <span className="text-muted-foreground">{kpi.base}</span>
    </p>
  )
}

function TexKpisBase({ items, titulo, compacto = false, className }: Props) {
  const lista = (Array.isArray(items) ? items : []).filter((k) => k && (k.etiqueta || k.valor))
  if (lista.length === 0) return null

  return (
    <section className={cn('@container', className)} aria-label={titulo || 'Cifras clave'}>
      {titulo && <h3 className="mb-2 text-[13px] font-semibold text-foreground">{titulo}</h3>}
      <div className="grid grid-cols-12 gap-2">
        {lista.map((k, i) => (
          <div
            key={`${i}-${k.etiqueta}`}
            className={cn(
              'row-span-3 grid min-w-0 grid-rows-subgrid gap-y-0 rounded-xl border border-border bg-card px-3 py-2.5',
              // Entrada escalonada: `both` y no `forwards` (con delay, `forwards`
              // muestra la tarjeta, la esconde y la vuelve a entrar).
              'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
              claseColumnaKpi(i, lista.length, compacto),
            )}
            style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
          >
            <p className="line-clamp-2 self-start text-[11px] leading-4 text-muted-foreground" title={k.etiqueta}>
              {k.etiqueta}
            </p>
            {/* El contenedor de la medida es esta caja y no la tarjeta: con
                `container-type` la tarjeta dejaría de ser subgrilla. */}
            <div className="@container min-w-0 self-end pt-1">
              <p
                className="line-clamp-2 font-mono leading-tight font-semibold tracking-tight break-words text-foreground tabular-nums"
                style={{ fontSize: tamanoValor(k.valor ?? '', compacto) }}
                title={k.valor}
              >
                {k.valor}
              </p>
            </div>
            {k.delta && k.base ? <Delta kpi={k} /> : <span aria-hidden />}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Se compara por contenido: en cada chunk del stream el mensaje llega clonado y sin esto se redibuja todo. */
export const TexKpis = memo(
  TexKpisBase,
  (a, b) => a.compacto === b.compacto && a.titulo === b.titulo && a.className === b.className && igualesProfundo(a.items, b.items),
)
