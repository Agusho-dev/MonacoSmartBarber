'use client'

import { Button } from '@/components/ui/button'
import { BellRing, MessageCircleQuestionMark, Scissors } from 'lucide-react'

interface NextClientAlertProps {
  /** Nombre del próximo cliente en espera. */
  clientName?: string | null
  /**
   * El próximo cliente pidió asesoría (mig 217): se avisa ya acá, antes de
   * empezar, para que el barbero llegue a la silla sabiendo que tiene que
   * asesorarlo. Al tocar "Empezar a cortar" se abre el pop-up completo.
   */
  pidioAsesoria?: boolean
  /** Handler del CTA "Empezar". */
  onStart: () => void
  /** Si está iniciando (loading) el servicio. */
  starting?: boolean
}

/**
 * Aviso a pantalla completa para el barbero libre que tiene clientes esperando
 * hace más que el umbral configurado. Es la ficha del que espera, en cartulina
 * ámbar (ámbar = demora en todo el panel), con su nombre grande y un solo botón.
 * Ámbar anaranjado y no amarillo: el amarillo es la etapa 35–45 min del
 * semáforo, y los dos no se pueden confundir de reojo.
 */
export function NextClientAlert({ clientName, pidioAsesoria = false, onStart, starting }: NextClientAlertProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[oklch(0.2_0.012_260/0.72)] p-4 animate-in fade-in duration-300"
      role="alertdialog"
      // Sólo muestra estado del servidor (la fila): después de recargar vuelve a
      // salir solo si sigue habiendo clientes esperando, así que no frena la
      // recarga por versión (src/lib/recarga-version.ts). Sin esto, la tablet
      // de un barbero libre con clientes esperando no se recargaba sola mientras
      // estaba el aviso.
      data-recarga-permitida
      aria-labelledby="next-client-alert-title"
      aria-describedby="next-client-alert-desc"
    >
      <div className="w-full max-w-lg rounded-[2rem] bg-[oklch(0.86_0.12_70)] p-7 text-amber-950 shadow-[0_30px_80px_-30px_oklch(0_0_0/0.7)] animate-in zoom-in-95 slide-in-from-bottom-2 duration-300 sm:p-9">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-950/10">
            <BellRing className="size-7 motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]" aria-hidden />
          </span>
          <h2 id="next-client-alert-title" className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em]">
            Tu cliente te está esperando
          </h2>
        </div>
        <p id="next-client-alert-desc" className="mt-5 text-xl leading-snug">
          {clientName ? (
            <>
              <span className="text-[2rem] font-bold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">
                {clientName}
              </span>
              <br />
              está en tu fila
            </>
          ) : (
            'Tenés clientes en espera'
          )}
        </p>
        {/* Fucsia = asesoría en todo el panel: sobre el ámbar va sólido. */}
        {pidioAsesoria && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-fuchsia-600 px-3.5 py-1.5 text-[0.9375rem] font-semibold text-white motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
            <MessageCircleQuestionMark className="size-4 shrink-0" aria-hidden />
            Pidió asesoría
          </p>
        )}
        <Button
          size="lg"
          className="mt-7 h-[4.5rem] w-full rounded-2xl border-0 bg-black text-xl font-bold text-white hover:bg-black/90 active:scale-[0.99] [&_svg]:size-6"
          onClick={onStart}
          disabled={starting}
        >
          <Scissors aria-hidden />
          {starting ? 'Empezando…' : 'Empezar a cortar'}
        </Button>
      </div>
    </div>
  )
}
