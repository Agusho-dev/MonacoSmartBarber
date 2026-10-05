'use client'

import { useRef, useState } from 'react'
import { Check, Delete, Keyboard, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { vibrate } from '@/lib/barber-feedback'
import { cn } from '@/lib/utils'

/*
 * Campos de plata y de cantidad para el panel GIRADO por CSS.
 *
 * El teclado de Android no gira con el panel: dado vuelta, el 6 se lee como 9 y
 * al revés, y eso es plata mal cargada. Con html[data-giro="css"] estos campos
 * muestran un teclado propio (el mismo estilo que el del PIN); sin él, muestran
 * EXACTAMENTE el input de siempre (children).
 *
 * Se renderizan las dos versiones y las alterna el CSS (.giro-solo-normal /
 * .giro-solo-css en globals.css), no React: el script pre-paint fija el modo
 * antes del primer paint, así que una recarga de "Caja" con la tablet girada ya
 * sale con el teclado del panel, sin pasar un instante por el input de Android.
 * Además el input queda en display:none en ese modo: no se puede enfocar y su
 * autoFocus no levanta el teclado del sistema.
 *
 * El valor vive en el padre (string de dígitos): cambiar de modo con el campo
 * abierto no pierde nada.
 */

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'] as const
const MANTENER_PARA_VACIAR_MS = 550

/** Suma dígitos sin ceros a la izquierda y respetando el máximo. */
function agregarDigitos(valor: string, tecla: string, maxDigitos: number): string {
  if (valor === '' && tecla === '000') return valor
  const combinado = (valor + tecla).replace(/^0+(?=\d)/, '')
  return combinado.length > maxDigitos ? valor : combinado
}

interface CampoMontoTabletProps {
  /** Dígitos, sin formato ('' = vacío). */
  valor: string
  onCambiar: (valor: string) => void
  /** Para lectores de pantalla y el aria del teclado. */
  etiqueta: string
  /** Abre el teclado de entrada (la propina personalizada: ya se pidió escribir). */
  autoAbrir?: boolean
  maxDigitos?: number
  /** Si viene, el teclado trae su botón de confirmar (propina). */
  onConfirmar?: () => void
  textoConfirmar?: string
  /** Clases del bloque del modo girado (el modo normal no se toca). */
  className?: string
  /** El input de siempre. */
  children: React.ReactNode
}

export function CampoMontoTablet({
  valor,
  onCambiar,
  etiqueta,
  autoAbrir = false,
  maxDigitos = 9,
  onConfirmar,
  textoConfirmar = 'Confirmar',
  className,
  children,
}: CampoMontoTabletProps) {
  const [abierto, setAbierto] = useState(autoAbrir)
  const numero = valor === '' ? null : Number(valor)

  return (
    <div data-slot="campo-monto-tablet">
      <div className="giro-solo-normal">{children}</div>
      <div className="giro-solo-css">
        <div className={cn('space-y-2.5', className)}>
          <button
            type="button"
            onClick={() => {
              vibrate(8)
              setAbierto((a) => !a)
            }}
            aria-expanded={abierto}
            aria-label={`${etiqueta}: ${numero === null ? 'sin cargar' : formatCurrency(numero)}. ${abierto ? 'Tocá para esconder el teclado' : 'Tocá para cargar el monto'}`}
            className={cn(
              'flex h-14 w-full items-center justify-between gap-3 rounded-xl border bg-background px-4 text-left shadow-xs transition-colors',
              abierto ? 'border-foreground/40 ring-[3px] ring-ring/15' : 'hover:bg-muted/40',
            )}
          >
            {numero === null && abierto ? (
              <span className="text-2xl font-black tracking-tight text-muted-foreground/45 tabular-nums">
                {formatCurrency(0)}
              </span>
            ) : numero === null ? (
              <span className="text-base font-medium text-muted-foreground">Tocá para cargar el monto</span>
            ) : (
              <span className="text-2xl font-black tracking-tight tabular-nums">{formatCurrency(numero)}</span>
            )}
            <Keyboard aria-hidden className={cn('size-5 shrink-0', abierto ? 'text-foreground' : 'text-muted-foreground')} />
          </button>

          {abierto && (
            <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200">
              <TecladoNumerico
                etiqueta={etiqueta}
                onTecla={(t) => {
                  const siguiente = agregarDigitos(valor, t, maxDigitos)
                  if (siguiente === valor) {
                    vibrate([10, 30, 10]) // tope de dígitos: el toque no suma nada
                    return
                  }
                  vibrate(8)
                  onCambiar(siguiente)
                }}
                onBorrar={() => {
                  if (!valor) return
                  vibrate(8)
                  onCambiar(valor.slice(0, -1))
                }}
                onVaciar={() => {
                  if (!valor) return
                  vibrate(25)
                  onCambiar('')
                }}
                puedeBorrar={valor !== ''}
              />
              {onConfirmar && (
                <Button
                  type="button"
                  size="lg"
                  onClick={() => {
                    if (!numero) return
                    vibrate(10)
                    onConfirmar()
                  }}
                  disabled={!numero}
                  className="mt-2.5 h-14 w-full text-base font-bold"
                >
                  <Check aria-hidden className="size-5" />
                  {textoConfirmar}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TecladoNumerico({
  etiqueta,
  onTecla,
  onBorrar,
  onVaciar,
  puedeBorrar,
}: {
  etiqueta: string
  onTecla: (tecla: string) => void
  onBorrar: () => void
  onVaciar: () => void
  puedeBorrar: boolean
}) {
  // Mantener apretado "Borrar" vacía el campo. El timer vive en un ref (sólo se
  // toca desde los handlers) y la marca evita que el click que sigue al soltar
  // borre un dígito más.
  const temporizador = useRef<number | null>(null)
  const vacio = useRef(false)
  const cancelar = () => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    temporizador.current = null
  }

  return (
    <div role="group" aria-label={`Teclado numérico: ${etiqueta}`} className="grid grid-cols-3 gap-2">
      {TECLAS.map((t) => (
        <Button
          key={t}
          type="button"
          variant="outline"
          onClick={() => onTecla(t)}
          className="h-14 text-2xl font-medium tabular-nums active:scale-[0.97] motion-safe:transition-transform"
        >
          {t}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        disabled={!puedeBorrar}
        aria-label="Borrar (mantené apretado para borrar todo)"
        onPointerDown={() => {
          vacio.current = false
          cancelar()
          temporizador.current = window.setTimeout(() => {
            vacio.current = true
            temporizador.current = null
            onVaciar()
          }, MANTENER_PARA_VACIAR_MS)
        }}
        onPointerUp={cancelar}
        onPointerLeave={cancelar}
        onPointerCancel={cancelar}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (vacio.current) {
            vacio.current = false
            return
          }
          onBorrar()
        }}
        className="h-14 active:scale-[0.97] motion-safe:transition-transform"
      >
        <Delete aria-hidden className="size-6" />
      </Button>
    </div>
  )
}

interface CampoContadorTabletProps {
  /** Número como string (lo que guardaba el input). */
  valor: string
  onCambiar: (valor: string) => void
  etiqueta: string
  min?: number
  max?: number
  className?: string
  /** El input de siempre. */
  children: React.ReactNode
}

/** Cantidades chicas (cortes antes de un descanso): un stepper − n + en modo girado. */
export function CampoContadorTablet({
  valor,
  onCambiar,
  etiqueta,
  min = 0,
  max = 20,
  className,
  children,
}: CampoContadorTabletProps) {
  const leido = Number.parseInt(valor, 10)
  const n = Math.min(max, Math.max(min, Number.isFinite(leido) ? leido : min))
  const cambiar = (delta: number) => {
    const siguiente = Math.min(max, Math.max(min, n + delta))
    if (siguiente === n) return
    vibrate(8)
    onCambiar(String(siguiente))
  }

  return (
    <div data-slot="campo-contador-tablet">
      <div className="giro-solo-normal">{children}</div>
      <div className="giro-solo-css">
        <div role="group" aria-label={etiqueta} className={cn('inline-flex items-center gap-1.5', className)}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => cambiar(-1)}
            disabled={n <= min}
            aria-label="Restar uno"
            className="size-11 rounded-full active:scale-[0.95] motion-safe:transition-transform"
          >
            <Minus aria-hidden className="size-5" />
          </Button>
          <output aria-live="polite" className="min-w-10 text-center text-xl font-black tabular-nums">
            {n}
          </output>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => cambiar(1)}
            disabled={n >= max}
            aria-label="Sumar uno"
            className="size-11 rounded-full active:scale-[0.95] motion-safe:transition-transform"
          >
            <Plus aria-hidden className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
