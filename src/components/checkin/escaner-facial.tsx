'use client'

/**
 * Escáner facial del kiosko: la lente con la cámara, el anillo y los textos.
 *
 * Todo lo que se mueve 60 veces por segundo lo dibuja el motor
 * (`src/lib/escaneo-facial/`) sobre un canvas y moviendo el video con
 * transforms: React se entera sólo de los cambios de momento (unos diez por
 * lectura), nunca de un cuadro. Así la animación no depende de que React llegue
 * a tiempo en la tablet.
 *
 * El escáner no sabe qué se hace con la cara: le pasa la lectura a `alLeer` y
 * espera un veredicto. FaceCamera la busca entre los clientes o el staff;
 * FaceEnrollment la guarda.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CameraOff, ScanFace } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MotorEscaner } from '@/lib/escaneo-facial/escaner'
import { textoEscaner, type QuienEscanea } from '@/lib/escaneo-facial/textos'
import type {
  EstadoVisible,
  FaseEscaner,
  LecturaFacial,
  ModoEscaner,
  ResultadoEscaner,
  Veredicto,
} from '@/lib/escaneo-facial/tipos'

/** Espacio del anillo entre el borde de la caja y la lente (px). */
const MARGEN = 34

/**
 * Diámetro de la lente: lo más grande que entre en la pantalla junto con el
 * título, los textos y el botón (~360 px). En la Redmi Pad 2 horizontal
 * (800 px de alto) da ~440 px.
 */
const LENTE = 'min(clamp(15rem, calc(100dvh - 22.5rem), 30rem), calc(100vw - 6rem))'

interface EscanerFacialProps {
  modo: ModoEscaner
  quien: QuienEscanea
  esClaro?: boolean
  /** Muestras por intento (default: 2 para identificar, 3 para registrar). */
  muestras?: number
  /** Intentos antes de dar la lectura por fallida (default: 2 para identificar, 1 para registrar). */
  intentos?: number
  alLeer: (lectura: LecturaFacial, intento: number) => Promise<Veredicto>
  alTerminar: (resultado: ResultadoEscaner) => void
  alCambiar?: (estado: EstadoVisible) => void
  /** Cambiarlo vuelve a empezar la lectura (registro que no se pudo guardar → "Probar de nuevo"). */
  reinicio?: number
  /** Acciones debajo del texto. */
  children?: ReactNode
}

function opacidadVelo(fase: FaseEscaner, camara: boolean): number {
  switch (fase) {
    case 'preparando':
      return camara ? 0.55 : 1
    case 'buscando':
      return 0.38
    case 'ajustando':
      return 0.12
    case 'reintento':
      return 0.2
    case 'fallo':
      return 0.45
    case 'error':
      return 0.88
    default:
      return 0
  }
}

function halo(fase: FaseEscaner, esClaro: boolean): string {
  const base = esClaro
    ? '0 24px 60px -24px rgba(24,24,27,0.45)'
    : '0 0 0 1px rgba(255,255,255,0.05), 0 22px 70px -20px rgba(0,0,0,0.7)'
  const color = (() => {
    switch (fase) {
      case 'leyendo':
      case 'consultando':
        return esClaro ? '0 0 60px -6px rgba(8,145,178,0.35)' : '0 0 80px -4px rgba(34,211,238,0.32)'
      case 'exito':
        return esClaro ? '0 0 70px 0 rgba(5,150,105,0.4)' : '0 0 90px 4px rgba(52,211,153,0.42)'
      case 'reintento':
      case 'fallo':
        return esClaro ? '0 0 60px -6px rgba(217,119,6,0.3)' : '0 0 70px -4px rgba(251,191,36,0.26)'
      case 'error':
        return esClaro ? '0 0 50px -8px rgba(220,38,38,0.25)' : '0 0 60px -6px rgba(248,113,113,0.2)'
      default:
        return esClaro ? '0 0 50px -12px rgba(8,145,178,0.2)' : '0 0 70px -10px rgba(34,211,238,0.16)'
    }
  })()
  return `${base}, ${color}`
}

function colorTitulo(fase: FaseEscaner, esClaro: boolean): string {
  switch (fase) {
    case 'exito':
      return esClaro ? 'text-emerald-700' : 'text-emerald-300'
    case 'reintento':
    case 'fallo':
      return esClaro ? 'text-amber-700' : 'text-amber-300'
    case 'error':
      return esClaro ? 'text-rose-700' : 'text-rose-300'
    default:
      return esClaro ? 'text-zinc-900' : 'text-white'
  }
}

const ESTILOS = `
@keyframes escaner-sello {
  0% { opacity: 0; transform: scale(0.35) rotate(-20deg); }
  60% { opacity: 1; transform: scale(1.12) rotate(4deg); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}
@keyframes escaner-tilde {
  from { stroke-dashoffset: 24; }
  to { stroke-dashoffset: 0; }
}
.escaner-sello { animation: escaner-sello 420ms cubic-bezier(0.2, 0.9, 0.3, 1.25) 640ms both; }
.escaner-tilde { stroke-dasharray: 24; animation: escaner-tilde 320ms cubic-bezier(0.65, 0, 0.35, 1) 860ms both; }
@media (prefers-reduced-motion: reduce) {
  .escaner-sello, .escaner-tilde { animation: none; }
}
`

export function EscanerFacial(props: EscanerFacialProps) {
  const { modo, quien, esClaro = false, reinicio = 0, children } = props
  const muestras = props.muestras ?? (modo === 'registrar' ? 3 : 2)
  const intentos = props.intentos ?? (modo === 'registrar' ? 1 : 2)

  const contenedorRef = useRef<HTMLDivElement>(null)
  const lienzoRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const vinetaRef = useRef<HTMLDivElement>(null)
  const motorRef = useRef<MotorEscaner | null>(null)
  // Los callbacks más recientes, sin reiniciar el motor cada vez que el padre re-renderiza.
  const propsRef = useRef(props)
  useEffect(() => {
    propsRef.current = props
  })

  const [estado, setEstado] = useState<EstadoVisible>({
    fase: 'preparando',
    guia: null,
    muestras: 0,
    total: muestras,
    intento: 1,
    camara: false,
  })

  useEffect(() => {
    const contenedor = contenedorRef.current
    const lienzo = lienzoRef.current
    const video = videoRef.current
    if (!contenedor || !lienzo || !video) return
    const motor = new MotorEscaner({
      modo,
      video,
      lienzo,
      contenedor,
      vineta: vinetaRef.current,
      tema: esClaro ? 'claro' : 'oscuro',
      margen: MARGEN,
      muestras,
      intentos,
      alCambiar: (e) => {
        setEstado(e)
        propsRef.current.alCambiar?.(e)
      },
      alLeer: (lectura, intento) => propsRef.current.alLeer(lectura, intento),
      alTerminar: (resultado) => propsRef.current.alTerminar(resultado),
    })
    motorRef.current = motor
    void motor.iniciar()
    return () => {
      motor.destruir()
      motorRef.current = null
    }
    // El motor vive lo que vive la pantalla: modo, tema y cantidades no cambian en el medio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reinicio > 0) motorRef.current?.reiniciar()
  }, [reinicio])

  const texto = textoEscaner(estado, quien)
  const { fase } = estado

  return (
    <div className="relative flex w-full flex-col items-center">
      <style>{ESTILOS}</style>

      <div
        ref={contenedorRef}
        className="relative shrink-0"
        style={
          {
            '--lente': LENTE,
            width: `calc(var(--lente) + ${2 * MARGEN}px)`,
            height: `calc(var(--lente) + ${2 * MARGEN}px)`,
          } as CSSProperties
        }
      >
        {/* Halo: el color del momento, detrás de la lente. */}
        <div
          aria-hidden
          className="absolute rounded-full transition-[box-shadow] duration-700 ease-out"
          style={{ inset: MARGEN, boxShadow: halo(fase, esClaro) }}
        />

        {/* Lente */}
        <div
          className={cn('absolute isolate overflow-hidden rounded-full', esClaro ? 'bg-zinc-900' : 'bg-zinc-950')}
          style={{ inset: MARGEN }}
        >
          <video
            ref={videoRef}
            aria-hidden
            muted
            playsInline
            className={cn(
              'absolute left-0 top-0 max-w-none origin-top-left transition-opacity duration-500',
              estado.camara ? 'opacity-100' : 'opacity-0',
            )}
            style={{ willChange: 'transform' }}
          />
          {/* Foco sobre la cara: lo mueve el motor. La zona clara mide 0,56 × radio a escala 1. */}
          <div
            ref={vinetaRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 transition-opacity duration-500"
            style={{
              width: 'calc(var(--lente) * 2)',
              height: 'calc(var(--lente) * 2)',
              opacity: 0,
              willChange: 'transform',
              background:
                'radial-gradient(closest-side, transparent 28%, rgba(9,9,11,0.42) 58%, rgba(9,9,11,0.64) 100%)',
            }}
          />
          {/* Velo: apaga la imagen mientras no hay nadie, y la enciende cuando hay una cara. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-zinc-950 transition-opacity duration-500"
            style={{ opacity: opacidadVelo(fase, estado.camara) }}
          />
          {fase === 'preparando' && !estado.camara && (
            <div className="absolute inset-0 flex items-center justify-center">
              <ScanFace className="size-14 animate-pulse text-white/25 motion-reduce:animate-none" strokeWidth={1.25} />
            </div>
          )}
          {fase === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-300">
              <CameraOff className="size-14 text-white/40" strokeWidth={1.25} />
            </div>
          )}
        </div>

        {/* Reflejo de vidrio sobre la lente. */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            inset: MARGEN,
            background:
              'radial-gradient(130% 90% at 28% 0%, rgba(255,255,255,0.13), rgba(255,255,255,0.03) 36%, transparent 54%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 -40px 70px -50px rgba(0,0,0,0.75)',
          }}
        />

        <canvas ref={lienzoRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

        {/* Sello de "verificado": aparece cuando la navaja terminó de pasar. */}
        {fase === 'exito' && (
          <div
            aria-hidden
            className={cn(
              'escaner-sello pointer-events-none absolute z-10 flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white',
              esClaro
                ? 'shadow-[0_0_0_5px_rgba(255,255,255,0.95),0_10px_30px_-6px_rgba(5,150,105,0.6)]'
                : 'shadow-[0_0_0_5px_rgba(9,9,11,0.9),0_0_36px_rgba(52,211,153,0.55)]',
            )}
            style={{
              left: `calc(${MARGEN}px + var(--lente) * 0.8536 - 2rem)`,
              top: `calc(${MARGEN}px + var(--lente) * 0.8536 - 2rem)`,
            }}
          >
            <svg viewBox="0 0 24 24" className="size-9" fill="none">
              <path
                d="M5 12.5l4.2 4.2L19 7"
                className="escaner-tilde"
                stroke="currentColor"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Lo que tiene que hacer la persona, en grande y de a una idea. */}
      <div className="mt-1 flex min-h-[4.75rem] w-full flex-col items-center px-4 text-center md:min-h-[5.5rem]" aria-live="polite">
        <p
          key={`t-${texto.titulo}`}
          className={cn(
            'text-2xl font-semibold leading-tight tracking-tight text-balance animate-in fade-in slide-in-from-bottom-1 duration-300 md:text-[2rem]',
            colorTitulo(fase, esClaro),
          )}
        >
          {texto.titulo}
        </p>
        {texto.detalle && (
          <p
            key={`d-${texto.detalle}`}
            className={cn(
              'mt-1 text-base animate-in fade-in duration-500 md:text-lg',
              esClaro ? 'text-zinc-600' : 'text-white/60',
            )}
          >
            {texto.detalle}
          </p>
        )}
      </div>

      {children}
    </div>
  )
}
