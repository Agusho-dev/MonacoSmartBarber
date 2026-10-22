// El vocabulario visual de la conciliación: cuatro colores, SIEMPRE con ícono y
// palabra (spec C). Verde = cuadra, ámbar = revisar, gris = todavía no se sabe,
// rojo = no se pudo leer. El azul de Tex no es un color de estado.
//
// El dashboard es siempre oscuro y `dark:` no aplica en esta app: los tonos van
// directos para fondo oscuro (texto -300/-400, fondos /10, bordes /30).

import type { ComponentType, CSSProperties } from 'react'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CheckCheck,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Diff,
  FileQuestion,
  Hourglass,
  Landmark,
  MinusCircle,
  Moon,
  ShieldQuestion,
  TriangleAlert,
  Unplug,
  XCircle,
} from 'lucide-react'
import {
  ETIQUETA_ESTADO,
  TONO_DE_ESTADO,
  esEmparejamientoDudoso,
  type CasoConciliacion,
  type EstadoCaso,
  type EstadoCuenta,
  type TipoVeredicto,
  type TonoCaso,
} from '@/lib/conciliacion-mp/contrato'
import { cn } from '@/lib/utils'
import { etiquetaDeCaso, tonoDeCaso } from './logica'

type Icono = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

export interface EstiloTono {
  texto: string
  fondo: string
  borde: string
  /** Relleno lleno (filete, celdas de la tira, puntos). */
  solido: string
}

export const TONO: Record<TonoCaso, EstiloTono> = {
  ok: { texto: 'text-emerald-400', fondo: 'bg-emerald-500/10', borde: 'border-emerald-500/30', solido: 'bg-emerald-400' },
  revisar: { texto: 'text-amber-300', fondo: 'bg-amber-500/10', borde: 'border-amber-500/30', solido: 'bg-amber-400' },
  desconocido: { texto: 'text-zinc-400', fondo: 'bg-white/5', borde: 'border-white/10', solido: 'bg-zinc-500' },
  error: { texto: 'text-red-400', fondo: 'bg-red-500/10', borde: 'border-red-500/30', solido: 'bg-red-400' },
}

export const ICONO_ESTADO: Record<EstadoCaso, Icono> = {
  conciliado: CheckCircle2,
  solo_mp: ArrowDownToLine,
  solo_sistema: FileQuestion,
  monto_mayor: Diff,
  monto_menor: Diff,
  otra_cuenta: ArrowLeftRight,
  pendiente: Hourglass,
  sin_verificar: CircleDashed,
  ajeno: Moon,
  revisado: CheckCheck,
}

/** El ícono de UN caso: un emparejamiento dudoso lleva el signo de pregunta, no la tilde de "Cuadra". */
export function iconoDeCaso(c: CasoConciliacion): Icono {
  return esEmparejamientoDudoso(c) ? CircleHelp : ICONO_ESTADO[c.estado]
}

/** El ícono de un caso, como componente (para usarlo en JSX sin "crear un componente" al dibujar). */
export function IconoCaso({ caso, className }: { caso: CasoConciliacion; className?: string }) {
  if (esEmparejamientoDudoso(caso)) return <CircleHelp className={className} aria-hidden />
  const Icon = ICONO_ESTADO[caso.estado]
  return <Icon className={className} aria-hidden />
}

function Chip({ tono, icono: Icon, texto, className, corta }: { tono: TonoCaso; icono: Icono; texto: string; className?: string; corta?: boolean }) {
  const t = TONO[tono]
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        t.fondo,
        t.borde,
        t.texto,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={cn(corta && 'truncate')}>{texto}</span>
    </span>
  )
}

/** Píldora de estado: ícono + palabra en su color. */
export function ChipEstado({ estado, className, corta }: { estado: EstadoCaso; className?: string; corta?: boolean }) {
  return <Chip tono={TONO_DE_ESTADO[estado]} icono={ICONO_ESTADO[estado]} texto={ETIQUETA_ESTADO[estado]} className={className} corta={corta} />
}

/**
 * La píldora de UN caso: como ChipEstado, pero un emparejamiento dudoso dice
 * "Para confirmar" en gris (nunca "Cuadra" en verde) y un crédito que espera su
 * cobro dice "Esperando el cobro".
 */
export function ChipCaso({ caso, className, corta }: { caso: CasoConciliacion; className?: string; corta?: boolean }) {
  return <Chip tono={tonoDeCaso(caso)} icono={iconoDeCaso(caso)} texto={etiquetaDeCaso(caso)} className={className} corta={corta} />
}

export const VEREDICTO: Record<TipoVeredicto, { tono: TonoCaso; icono: Icono; palabra: string }> = {
  cuadra: { tono: 'ok', icono: CheckCircle2, palabra: 'Cuadra' },
  no_cuadra: { tono: 'revisar', icono: TriangleAlert, palabra: 'Para revisar' },
  no_se_sabe: { tono: 'desconocido', icono: CircleDashed, palabra: 'Todavía no se sabe' },
  error: { tono: 'error', icono: XCircle, palabra: 'No se pudo leer' },
  sin_movimientos: { tono: 'desconocido', icono: MinusCircle, palabra: 'Sin movimientos' },
}

export interface EstiloCuenta {
  tono: TonoCaso
  icono: Icono
  etiqueta: string
}

/** El estado de una tarjeta de cuenta, en palabras. "Al día" no es "cuadra": va en gris claro, no en verde. */
export function estiloCuenta(estado: EstadoCuenta, confirmada: boolean, conectada: boolean): EstiloCuenta {
  if (estado === 'error') return { tono: 'error', icono: XCircle, etiqueta: 'Error' }
  if (estado === 'revocada') return { tono: 'error', icono: Unplug, etiqueta: 'Sin permiso' }
  if (conectada && !confirmada) return { tono: 'revisar', icono: ShieldQuestion, etiqueta: 'Confirmá la cuenta' }
  switch (estado) {
    case 'al_dia':
      return { tono: 'ok', icono: CheckCircle2, etiqueta: 'Al día' }
    case 'atrasada':
      return { tono: 'desconocido', icono: Hourglass, etiqueta: 'Atrasada' }
    case 'sin_conectar':
      return { tono: 'desconocido', icono: CircleDashed, etiqueta: 'Sin conectar' }
    case 'banco':
      return { tono: 'desconocido', icono: Landmark, etiqueta: 'Banco' }
    default:
      return { tono: 'desconocido', icono: CircleSlash, etiqueta: 'Sin alias' }
  }
}

/** Rayado diagonal (lo que falta, lo sin conectar). Inline: no depende de ningún CSS global. */
export function rayado(color: string, fondo = 'transparent'): CSSProperties {
  return { backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 3px, ${fondo} 3px 6px)` }
}

export const COLOR_RAYADO = {
  ambar: 'rgb(251 191 36 / 0.85)',
  ambarFondo: 'rgb(251 191 36 / 0.18)',
  gris: 'rgb(161 161 170 / 0.55)',
  grisFondo: 'rgb(161 161 170 / 0.10)',
}
