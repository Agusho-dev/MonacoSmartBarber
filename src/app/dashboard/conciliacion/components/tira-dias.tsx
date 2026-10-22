'use client'

// Los últimos 30 días de un vistazo: una celda por día con el color de su
// veredicto (verde cuadró, ámbar para revisar, gris no se sabe, rojo no se pudo
// leer), rayada si la cobertura fue parcial, con un punto si hay casos para
// revisar. Tocar una celda elige ese día. Se carga aparte del veredicto.
//
// Sin el Tooltip de shadcn (no hay provider y queda debajo de los diálogos):
// el detalle del día al que apuntás aparece en una línea debajo de la tira.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { RefreshCw, X } from 'lucide-react'
import type { ResumenDia } from '@/lib/conciliacion-mp/contrato'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { diaDeSemana, diaLargo, plata, plural } from './formato'
import type { Periodo } from './periodo'
import { COLOR_RAYADO, rayado } from './visual'

interface Props {
  estado: 'cargando' | 'ok' | 'error'
  dias: ResumenDia[]
  error: string | null
  periodo: Periodo
  onElegirDia: (ymd: string) => void
  onReintentar: () => void
}

const CLASE_TIPO: Record<ResumenDia['tipo'], string> = {
  cuadra: 'bg-emerald-500/75 border-emerald-300/30',
  no_cuadra: 'bg-amber-500/75 border-amber-300/30',
  no_se_sabe: 'bg-zinc-600/70 border-zinc-400/25',
  error: 'bg-red-500/70 border-red-300/30',
  sin_movimientos: 'bg-white/[0.03] border-white/10',
}

function resumenDelDia(d: ResumenDia): string {
  const partes: string[] = []
  switch (d.tipo) {
    case 'cuadra':
      partes.push('Cuadró')
      break
    case 'no_cuadra':
      if (d.faltante > 0) partes.push(`Faltan ${plata(d.faltante)}`)
      if (d.sobrante > 0) partes.push(`Sobran ${plata(d.sobrante)}`)
      if (!d.faltante && !d.sobrante) partes.push('Para revisar')
      break
    case 'no_se_sabe':
      partes.push('Todavía no se sabe')
      break
    case 'error':
      partes.push('No se pudo leer Mercado Pago')
      break
    case 'sin_movimientos':
      partes.push('Sin transferencias')
      break
  }
  if (d.paraRevisar > 0) partes.push(`${d.paraRevisar} para revisar`)
  if (d.cobros > 0) partes.push(plural(d.cobros, 'cobro'))
  if (d.tipo !== 'sin_movimientos' && d.cobertura === 'parcial') partes.push('cobertura parcial')
  if (d.tipo !== 'sin_movimientos' && d.cobertura === 'nula') partes.push('sin cuentas conectadas')
  return partes.join(' · ')
}

export function TiraDias({ estado, dias, error, periodo, onElegirDia, onReintentar }: Props) {
  const [apuntado, setApuntado] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // En el celular la tira scrollea: arranca mostrando los días más recientes.
  const cantidad = dias.length
  useEffect(() => {
    const el = scrollRef.current
    if (el && cantidad > 0) el.scrollLeft = el.scrollWidth
  }, [cantidad])

  const unDia = periodo.desde === periodo.hasta
  const detalle = apuntado ? dias.find((d) => d.dia === apuntado) : null

  return (
    <section aria-labelledby="tira-titulo" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="tira-titulo" className="text-sm font-semibold">
          Últimos 30 días
        </h2>
        <Leyenda />
      </div>

      {estado === 'error' && dias.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3 py-2.5">
          <p className="flex-1 text-sm text-red-200">
            No pudimos cargar los últimos 30 días.{error ? <span className="text-red-200/70"> {error}</span> : null}
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onReintentar}>
            <RefreshCw className="size-3.5" aria-hidden />
            Reintentar
          </Button>
        </div>
      ) : (
        <div ref={scrollRef} data-sin-swipe className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
          {estado === 'cargando' && dias.length === 0 ? (
            <div className="flex w-max gap-1" aria-label="Cargando los últimos 30 días" role="status">
              {Array.from({ length: 30 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="h-9 w-7 animate-pulse rounded-[5px] bg-white/[0.06] lg:h-8 lg:w-6" />
                  <div className="h-2.5 w-3 rounded bg-white/[0.04]" />
                </div>
              ))}
            </div>
          ) : (
            <ol className="flex w-max gap-1" aria-label="Veredicto de cada día">
              {dias.map((d) => {
                const dentro = d.dia >= periodo.desde && d.dia <= periodo.hasta
                const elegido = unDia && d.dia === periodo.desde
                const lunes = diaDeSemana(d.dia) === 1
                const rayada = d.tipo !== 'sin_movimientos' && d.cobertura !== 'total'
                return (
                  <li key={d.dia} className={cn('flex flex-col items-center gap-1', lunes && 'ml-1.5')}>
                    <button
                      type="button"
                      onClick={() => onElegirDia(d.dia)}
                      onPointerEnter={() => setApuntado(d.dia)}
                      onPointerLeave={() => setApuntado((a) => (a === d.dia ? null : a))}
                      onFocus={() => setApuntado(d.dia)}
                      onBlur={() => setApuntado((a) => (a === d.dia ? null : a))}
                      aria-label={`${diaLargo(d.dia)}: ${resumenDelDia(d)}`}
                      aria-current={elegido ? 'date' : undefined}
                      className={cn(
                        'relative grid h-9 w-7 place-items-center rounded-[5px] border transition-transform focus-visible:outline-none lg:h-8 lg:w-6',
                        CLASE_TIPO[d.tipo],
                        'hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/70',
                        elegido && 'ring-2 ring-white/85 ring-offset-2 ring-offset-card',
                        dentro && !unDia && 'ring-1 ring-white/50',
                      )}
                    >
                      {rayada && (
                        <span aria-hidden className="absolute inset-0 rounded-[4px]" style={rayado(COLOR_RAYADO.gris)} />
                      )}
                      {d.tipo === 'error' && <X className="relative size-3 text-red-50" aria-hidden />}
                      {d.paraRevisar > 0 && (
                        <span aria-hidden className="absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-amber-50" />
                      )}
                    </button>
                    <span
                      aria-hidden
                      className={cn('text-[10px] tabular-nums', elegido || dentro ? 'text-zinc-200' : 'text-muted-foreground/70')}
                    >
                      {Number(d.dia.slice(8))}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      <p className="mt-2 min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {detalle ? (
          <>
            <span className="font-medium text-zinc-200">{diaLargo(detalle.dia)}</span> · {resumenDelDia(detalle)}
          </>
        ) : estado === 'ok' && dias.length > 0 ? (
          'Tocá un día para verlo.'
        ) : estado === 'error' && dias.length > 0 ? (
          <span className="text-red-300">No pudimos actualizar la tira: lo que ves puede estar viejo.</span>
        ) : null}
      </p>
    </section>
  )
}

function Leyenda() {
  const item = (clase: string, texto: string, estilo?: CSSProperties) => (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block size-2.5 rounded-[3px] border', clase)} style={estilo} />
      {texto}
    </li>
  )
  return (
    <ul className="hidden flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:flex">
      {item(CLASE_TIPO.cuadra, 'Cuadró')}
      {item(CLASE_TIPO.no_cuadra, 'Para revisar')}
      {item(CLASE_TIPO.no_se_sabe, 'No se sabe')}
      {item(CLASE_TIPO.error, 'No se pudo leer')}
      {item('border-zinc-400/25 bg-zinc-600/70', 'Cobertura parcial', rayado(COLOR_RAYADO.gris))}
    </ul>
  )
}
