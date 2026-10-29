'use client'

import { QRCodeSVG } from 'qrcode.react'
import { Smartphone, Swords } from 'lucide-react'
import { cn } from '@/lib/utils'
import { terminalGlassCard, terminalH1Gradient } from '@/components/checkin/terminal-theme'

/**
 * Tarjeta «¿Esperando? Jugá CORTE FINAL» del cartel de éxito y de «Mi turno»
 * del kiosko: el QR lleva a /juego con el token firmado de la entrada
 * (`crearEnlaceJuego`, src/lib/actions/juego.ts).
 *
 * Apaisada en columna (QR a la izquierda, texto a la derecha) y vertical desde
 * `lg`, donde va AL LADO del cartel: la tablet del local (Redmi Pad 2
 * horizontal) tiene 800 px de alto y abajo no entra sin scroll.
 *
 * El QR va siempre oscuro sobre blanco, con su margen: invertido o sin margen
 * muchos celulares no lo leen. La URL mide ~220 caracteres (versión 11 con
 * nivel M): medido sobre capturas a densidad 1, se lee desde ~200 px de lado y
 * a 165 px ya no. Por eso 224 px desde `md` y 240 px en `lg`.
 */
export function QrJuego({
  url,
  claro,
  className,
}: {
  url: string
  /** Fondo claro del kiosko (`isLightBg`). */
  claro: boolean
  className?: string
}) {
  return (
    <section
      aria-label="Corte Final: jugá mientras esperás tu turno"
      className={cn(
        'w-full max-w-xl p-4 md:p-6 flex flex-row items-center gap-4 md:gap-6 lg:flex-col lg:justify-center lg:gap-5 lg:text-center animate-in fade-in zoom-in-95 duration-500',
        claro ? 'rounded-2xl md:rounded-3xl border border-zinc-200 bg-white shadow-lg' : terminalGlassCard,
        className,
      )}
    >
      <div
        className={cn(
          'shrink-0 rounded-xl md:rounded-2xl bg-white p-2 md:p-2.5 size-36 md:size-56 lg:size-60 lg:order-2',
          claro ? 'border border-zinc-200' : 'shadow-[0_0_32px_rgba(34,211,238,0.18)]',
        )}
      >
        <QRCodeSVG
          value={url}
          size={256}
          level="M"
          marginSize={1}
          bgColor="#ffffff"
          fgColor="#000000"
          title="Código QR para jugar Corte Final"
          className="block size-full"
        />
      </div>

      {/* En `lg` los dos bloques se reparten alrededor del QR (título arriba, aviso abajo). */}
      <div className="min-w-0 flex flex-col gap-2 md:gap-3 lg:contents">
        <div className="flex flex-col gap-1 lg:order-1 lg:items-center">
          <p
            className={cn(
              'flex items-center gap-1.5 text-xs md:text-sm font-semibold uppercase tracking-[0.18em]',
              claro ? 'text-cyan-700' : 'text-cyan-200/80',
            )}
          >
            <Swords className="size-3.5 md:size-4 shrink-0" strokeWidth={2} aria-hidden />
            ¿Esperando?
          </p>
          <p
            className={cn(
              'text-2xl md:text-4xl font-bold leading-[0.95] tracking-tight text-balance',
              claro ? 'text-zinc-900' : 'text-white',
            )}
          >
            Jugá{' '}
            {/* El nombre del juego nunca se parte en dos renglones. */}
            <span className={cn('whitespace-nowrap font-black italic uppercase', claro ? 'text-zinc-900' : terminalH1Gradient)}>
              Corte Final
            </span>
          </p>
        </div>

        {/* Al costado del texto en la tarjeta apaisada; centrado y en línea con el texto en `lg`. */}
        <p
          className={cn(
            'flex items-start gap-2 text-sm md:text-lg leading-snug lg:order-3 lg:block lg:max-w-[18rem]',
            claro ? 'text-zinc-600' : 'text-cyan-100/70',
          )}
        >
          <Smartphone
            className={cn(
              'mt-0.5 size-4 md:size-5 shrink-0 lg:mt-0 lg:mr-1.5 lg:inline-block lg:align-[-0.2em]',
              claro ? 'text-cyan-700' : 'text-cyan-300',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <span>Escaneá con tu celu. Te avisamos cuando sea tu turno.</span>
        </p>
      </div>
    </section>
  )
}
