'use client'

// "‹ mar 20/10 ›" para moverse de a un día (o de a un rango) + el selector
// segmentado Ayer · Hoy · 7 días · Mes · Elegir. Por defecto Ayer: es el
// control que hoy se hace a mano cada mañana. Las fechas son días argentinos
// y nunca se puede ir al futuro.

import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { es } from 'react-day-picker/locale'
import { Building2, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { diaMes } from './formato'
import {
  MAX_DIAS_PERIODO,
  PRESETS,
  diasDelPeriodo,
  moverPeriodo,
  normalizarElegido,
  presetDe,
  textoDelControl,
  type Periodo,
  type PresetPeriodo,
} from './periodo'
import { useEsAncho } from './use-pantalla'

interface Props {
  periodo: Periodo
  hoy: string
  /** Un atajo (se recuerda para la próxima vez). El rango lo calcula quien recibe, con el "hoy" del momento. */
  onPreset: (preset: PresetPeriodo) => void
  /** Flechas o calendario: un período puntual (no se recuerda). */
  onPeriodo: (p: Periodo) => void
}

function aLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** El primer mes a mostrar: con dos meses, el de `hasta` queda a la derecha (nunca un mes futuro vacío). */
function mesInicial(hasta: string, hoy: string, meses: number): Date {
  const [y, m] = hasta.split('-').map(Number)
  const [yh, mh] = hoy.split('-').map(Number)
  const ultimo = Math.min(y * 12 + (m - 1), yh * 12 + (mh - 1))
  const primero = ultimo - (meses - 1)
  return new Date(Math.floor(primero / 12), primero % 12, 1)
}

function deLocal(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}

export function ControlPeriodo({ periodo, hoy, onPreset, onPeriodo }: Props) {
  const ancho = useEsAncho()
  const [abierto, setAbierto] = useState(false)
  const [seleccion, setSeleccion] = useState<DateRange | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const preset = presetDe(periodo, hoy)
  const atras = moverPeriodo(periodo, -1, hoy)
  const adelante = moverPeriodo(periodo, 1, hoy)
  const { principal, detalle } = textoDelControl(periodo, hoy)

  function abrirCalendario(v: boolean) {
    setAbierto(v)
    if (v) {
      setSeleccion({ from: aLocal(periodo.desde), to: aLocal(periodo.hasta) })
      setError(null)
    }
  }

  function aplicar() {
    if (!seleccion?.from) return
    const r = normalizarElegido(deLocal(seleccion.from), deLocal(seleccion.to ?? seleccion.from), hoy)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setAbierto(false)
    onPeriodo(r)
  }

  const desdeSel = seleccion?.from ? deLocal(seleccion.from) : null
  const hastaSel = seleccion?.to ? deLocal(seleccion.to) : desdeSel
  const textoSel =
    desdeSel && hastaSel
      ? desdeSel === hastaSel
        ? diaMes(desdeSel)
        : `${diaMes(desdeSel < hastaSel ? desdeSel : hastaSel)} – ${diaMes(desdeSel < hastaSel ? hastaSel : desdeSel)} · ${diasDelPeriodo(
            desdeSel < hastaSel ? { desde: desdeSel, hasta: hastaSel } : { desde: hastaSel, hasta: desdeSel },
          )} días`
      : 'Tocá el primer día y después el último.'

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Popover open={abierto} onOpenChange={abrirCalendario}>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Período">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 sm:size-9"
            onClick={() => atras && onPeriodo(atras)}
            disabled={!atras}
            aria-label="Período anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-h-10 min-w-[10.5rem] flex-1 flex-col items-center justify-center rounded-md px-3 py-0.5 transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-9 sm:flex-none"
              aria-label={`Período: ${principal}${detalle ? ` (${detalle})` : ''}. Elegir fechas`}
            >
              <span className="text-sm leading-tight font-semibold tabular-nums">{principal}</span>
              {detalle && <span className="text-[11px] leading-tight text-muted-foreground">{detalle}</span>}
            </button>
          </PopoverTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 sm:size-9"
            onClick={() => adelante && onPeriodo(adelante)}
            disabled={!adelante}
            aria-label="Período siguiente"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            locale={es}
            weekStartsOn={1}
            selected={seleccion}
            onSelect={(r) => {
              setSeleccion(r)
              setError(null)
            }}
            resetOnSelect
            numberOfMonths={ancho ? 2 : 1}
            defaultMonth={mesInicial(periodo.hasta, hoy, ancho ? 2 : 1)}
            endMonth={aLocal(`${hoy.slice(0, 7)}-01`)}
            disabled={{ after: aLocal(hoy) }}
          />
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs tabular-nums text-muted-foreground">{textoSel}</p>
              {error ? (
                <p role="alert" className="text-xs text-red-300">
                  {error}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">Hasta {MAX_DIAS_PERIODO} días.</p>
              )}
            </div>
            <Button size="sm" onClick={aplicar} disabled={!seleccion?.from}>
              Ver estos días
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div
        data-sin-swipe
        className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0"
        role="group"
        aria-label="Atajos de período"
      >
        <div className="flex w-max gap-1 rounded-lg border bg-muted/50 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              onClick={() => onPreset(p.id)}
              className={cn(
                'min-h-9 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                preset === p.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.etiqueta}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={preset === null}
            aria-haspopup="dialog"
            aria-expanded={abierto}
            onClick={() => abrirCalendario(true)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
              preset === null ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CalendarDays className="size-3.5" aria-hidden />
            Elegir
          </button>
        </div>
      </div>
    </div>
  )
}

const TODAS = '__todas__'

/**
 * La sucursal de TODA la pantalla. No es un filtro de la lista: el motor
 * concilia la organización entera y recién después recorta al alcance, así que
 * "Paraná" muestra el veredicto, la tira, las cuentas y los casos de Paraná sin
 * inventar sobrantes de una cuenta compartida con Caseros. Es lo mismo que abre
 * un enlace de Tex con `?sucursal=`.
 */
export function SelectorSucursal({
  sucursales,
  valor,
  onCambiar,
}: {
  sucursales: { id: string; nombre: string }[]
  valor: string | null
  onCambiar: (s: string | null) => void
}) {
  return (
    <Select value={valor ?? TODAS} onValueChange={(v) => onCambiar(v === TODAS ? null : v)}>
      <SelectTrigger
        aria-label="Sucursal"
        className={cn(
          // data-[size=default] del trigger fija h-9: se pisa con la misma variante para igualar el alto del período.
          'h-11 w-full min-w-[12rem] justify-start bg-card data-[size=default]:h-11 lg:w-auto [&>svg:last-child]:ml-auto',
          valor && 'border-white/30',
        )}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={TODAS}>Todas las sucursales</SelectItem>
        {sucursales.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
