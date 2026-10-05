'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle, MessageCircleQuestionMark, Scissors } from 'lucide-react'

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
 * Overlay fullscreen que alerta al barbero inactivo cuando tiene clientes
 * esperando hace más que el umbral configurado. Gigante, pulsante,
 * con CTA claro para que no haya excusa.
 */
export function NextClientAlert({ clientName, pidioAsesoria = false, onStart, starting }: NextClientAlertProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-300"
      role="alertdialog"
      // Sólo muestra estado del servidor (la fila): después de recargar vuelve a
      // salir solo si sigue habiendo clientes esperando, así que no frena la
      // recarga por versión (src/lib/recarga-version.ts). Sin esto, la tablet
      // de un barbero libre con clientes esperando no se recargaba sola mientras
      // estaba el aviso.
      data-recarga-permitida
      aria-labelledby="next-client-alert-title"
    >
      <div className="mx-4 w-full max-w-md space-y-6 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-8 shadow-2xl shadow-amber-500/20 backdrop-blur-xl animate-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-amber-500/20 animate-pulse">
            <AlertTriangle className="size-10 text-amber-500" />
          </div>
          <div>
            <h2 id="next-client-alert-title" className="text-2xl font-bold text-amber-500">
              ¡Tu cliente te está esperando!
            </h2>
            <p className="mt-2 text-base text-amber-200/80">
              {clientName
                ? <><strong>{clientName}</strong> está en la fila</>
                : 'Tenés clientes en espera'}
            </p>
            {/* Fucsia = asesoría en todo el panel. Sobre el fondo oscuro del
                overlay va en tono claro. */}
            {pidioAsesoria && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-3 py-1 text-sm font-semibold text-fuchsia-200 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
                <MessageCircleQuestionMark className="size-4 shrink-0" aria-hidden />
                Pidió asesoría
              </p>
            )}
          </div>
        </div>
        <Button
          size="lg"
          className="h-16 w-full text-xl bg-amber-500 hover:bg-amber-600 text-black font-bold"
          onClick={onStart}
          disabled={starting}
        >
          <Scissors className="mr-3 size-6" />
          {starting ? 'Iniciando...' : 'Empezar a cortar'}
        </Button>
      </div>
    </div>
  )
}
