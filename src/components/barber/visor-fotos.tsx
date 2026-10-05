'use client'

import { useRef, useState, type PointerEvent as PointerEventReact } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useGiroCss } from '@/hooks/use-giro-panel'
import { cn } from '@/lib/utils'

export interface FotoDelVisor {
  id: string
  src: string
  /** blob: de una foto que todavía está en la tablet: va con <img>, no por next/image. */
  local?: boolean
  alt: string
  /** "hace 3 semanas · Nico · Corte + Barba". */
  epigrafe?: string | null
}

interface VisorFotosProps {
  fotos: FotoDelVisor[]
  /** Foto abierta; null = cerrado. */
  indice: number | null
  onIndice: (indice: number | null) => void
}

/** Distancia (px) para que un arrastre cuente como "pasar de foto". */
const UMBRAL_SWIPE = 56

/**
 * Visor a pantalla completa con flechas, teclado (← →) y swipe.
 *
 * El swipe es con pointer events, no con touchmove: con el panel girado por
 * CSS el giro corta la propagación de todo touchmove (src/lib/giro-panel). Y
 * con el panel girado, la izquierda del barbero es la DERECHA de la pantalla:
 * el desplazamiento se invierte para que "deslizar hacia la izquierda" sea
 * siempre "la foto siguiente" para quien mira.
 *
 * Es un Dialog de @/components/ui: en el panel portalea solo a #giro-portales.
 */
export function VisorFotos({ fotos, indice, onIndice }: VisorFotosProps) {
  const giro = useGiroCss()
  const [arrastre, setArrastre] = useState(0)
  const inicio = useRef<{ x: number; y: number; id: number } | null>(null)

  const abierto = indice !== null && fotos.length > 0
  const actual = abierto ? Math.min(Math.max(indice ?? 0, 0), fotos.length - 1) : 0
  const foto = abierto ? fotos[actual] : null
  const hayAnterior = actual > 0
  const haySiguiente = actual < fotos.length - 1

  const ir = (delta: number) => {
    const destino = actual + delta
    if (destino < 0 || destino >= fotos.length) return
    onIndice(destino)
  }

  const alApoyar = (e: PointerEventReact<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    inicio.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const alMover = (e: PointerEventReact<HTMLDivElement>) => {
    const i = inicio.current
    if (!i || i.id !== e.pointerId) return
    const dx = (e.clientX - i.x) * (giro ? -1 : 1)
    if (Math.abs(dx) > Math.abs(e.clientY - i.y)) setArrastre(dx)
  }
  const alSoltar = (e: PointerEventReact<HTMLDivElement>) => {
    const i = inicio.current
    inicio.current = null
    if (!i || i.id !== e.pointerId) return
    const dx = (e.clientX - i.x) * (giro ? -1 : 1)
    setArrastre(0)
    if (dx <= -UMBRAL_SWIPE) ir(1)
    else if (dx >= UMBRAL_SWIPE) ir(-1)
  }
  const alCancelar = () => {
    inicio.current = null
    setArrastre(0)
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onIndice(null) }}>
      <DialogContent
        showCloseButton={false}
        className="h-[100dvh] max-h-none w-screen max-w-none gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none"
        onKeyDown={(e) => {
          // Las teclas son lógicas (la flecha izquierda es "anterior" para quien
          // mira, gire o no el panel); sólo el dedo trae coordenadas de pantalla.
          if (e.key === 'ArrowLeft') { e.preventDefault(); ir(-1) }
          if (e.key === 'ArrowRight') { e.preventDefault(); ir(1) }
        }}
      >
        <DialogTitle className="sr-only">
          {foto ? `Foto ${actual + 1} de ${fotos.length}` : 'Foto'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {foto?.epigrafe ?? 'Foto del corte a pantalla completa'}
        </DialogDescription>

        <div className="relative flex h-full w-full flex-col">
          {/* Barra superior */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 pb-8 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <p className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold tabular-nums" aria-hidden>
              {fotos.length > 1 ? `${actual + 1} / ${fotos.length}` : ''}
            </p>
            <button
              type="button"
              onClick={() => onIndice(null)}
              aria-label="Cerrar"
              className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="size-6" aria-hidden />
            </button>
          </div>

          {/* Foto (zona de swipe) */}
          <div
            className="relative flex-1 select-none overflow-hidden"
            style={{ touchAction: 'pan-y pinch-zoom' }}
            onPointerDown={alApoyar}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerCancel={alCancelar}
          >
            {foto && (
              <div
                key={foto.id}
                className={cn(
                  'absolute inset-0 animate-in fade-in-0 duration-200 motion-reduce:animate-none',
                  arrastre === 0 && 'motion-safe:transition-transform motion-safe:duration-200',
                )}
                style={{ transform: `translateX(${arrastre}px)` }}
              >
                {foto.local ? (
                  /* blob: de la tablet: next/image no lo optimiza */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={foto.src} alt={foto.alt} draggable={false} className="h-full w-full object-contain" />
                ) : (
                  <Image
                    src={foto.src}
                    alt={foto.alt}
                    fill
                    sizes="100vw"
                    priority
                    draggable={false}
                    className="object-contain"
                  />
                )}
              </div>
            )}
          </div>

          {/* Flechas */}
          {fotos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => ir(-1)}
                disabled={!hayAnterior}
                aria-label="Foto anterior"
                className="absolute left-2 top-1/2 z-20 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-0"
              >
                <ChevronLeft className="size-7" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => ir(1)}
                disabled={!haySiguiente}
                aria-label="Foto siguiente"
                className="absolute right-2 top-1/2 z-20 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-0"
              >
                <ChevronRight className="size-7" aria-hidden />
              </button>
            </>
          )}

          {/* Epígrafe */}
          {foto?.epigrafe && (
            <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-10">
              <p className="text-center text-sm font-medium text-white/90">{foto.epigrafe}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
