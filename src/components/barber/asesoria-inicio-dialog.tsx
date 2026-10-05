'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Info, MessageCircleQuestionMark, NotebookPen, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { vibrate } from '@/lib/barber-feedback'
import { primerNombre } from '@/lib/fotos-corte/textos'
import { useUltimosCortes, type EstadoUltimosCortes } from '@/hooks/use-ultimos-cortes'
import type { QueueEntry } from '@/lib/types/database'
import { TiraUltimosCortes } from './tira-ultimos-cortes'
import { CORTES_EN_TARJETA_ACTIVA } from './active-client-card'

/**
 * · `inicio`: el barbero acaba de tomar a un cliente que pidió asesoría y
 *   todavía no la vio. Sale del ESTADO de la entrada (pidio_asesoria y
 *   asesoria_vista_at NULL), no de un botón: cubre Atender, Reclamar, la alerta
 *   de inactividad y el inicio desde el dashboard. Cualquier cierre la confirma.
 * · `consulta`: la reabrió tocando el sello de la tarjeta del cliente actual.
 */
export type ModoAsesoriaDialog = 'inicio' | 'consulta'

/** Cortes que muestra el pop-up: los más recientes alcanzan para charlar. */
const CORTES_EN_POPUP = 3

interface AsesoriaInicioDialogProps {
  /** La entrada en curso del barbero. */
  entry: QueueEntry | null
  /** null = cerrado. */
  modo: ModoAsesoriaDialog | null
  /**
   * Cualquier cierre: el botón, Escape o tocar afuera. En `inicio` el panel
   * confirma la asesoría (`marcarAsesoriaVista`, optimista).
   */
  onCerrar: () => void
}

/**
 * Pop-up fuerte de «este cliente pidió asesoría» (mig 217), al empezar a
 * atenderlo. Le da al barbero lo que necesita para asesorar sin buscar nada:
 * sus últimos cortes (con fotos) y las observaciones del cliente.
 *
 * Es un Dialog de @/components/ui: en el panel portalea solo a #giro-portales y
 * gira con él 180°. Vibra al abrirse y NO suena: el cliente ya está en la silla.
 */
export function AsesoriaInicioDialog({ entry, modo, onCerrar }: AsesoriaInicioDialogProps) {
  // Lo último que se mostró. Mientras el diálogo anima la salida el contenido
  // queda quieto: no se vacía si la entrada dejó de estar en curso (la cobraron
  // desde el dashboard) ni el botón pasa de «Entendido» a «Cerrar».
  const [mostrado, setMostrado] = useState<{ entry: QueueEntry; modo: ModoAsesoriaDialog } | null>(null)
  if (modo !== null && entry !== null && (mostrado?.entry.id !== entry.id || mostrado.modo !== modo)) {
    setMostrado({ entry, modo })
  }
  const abierto = modo !== null && entry !== null
  const vista = modo !== null && entry !== null ? { entry, modo } : mostrado

  // Misma clave de caché que la tarjeta del cliente actual, que se monta a la
  // vez: UNA server action para las dos (Next 16 las ejecuta de a una, y la
  // del cobro espera detrás). Se muestran los primeros tres.
  const clienteId = vista?.entry.client?.id ?? vista?.entry.client_id ?? null
  const { estado, reintentar } = useUltimosCortes(clienteId, { limite: CORTES_EN_TARJETA_ACTIVA })
  const estadoTira = useMemo<EstadoUltimosCortes>(
    () =>
      estado.tipo === 'listo'
        ? { tipo: 'listo', datos: { ...estado.datos, cortes: estado.datos.cortes.slice(0, CORTES_EN_POPUP) } }
        : estado,
    [estado],
  )

  // Vibra una vez por entrada, al abrirse en modo inicio. Sin sonido.
  const vibrarPor = modo === 'inicio' && entry ? entry.id : null
  useEffect(() => {
    if (vibrarPor) vibrate([30, 70, 30])
  }, [vibrarPor])

  const botonRef = useRef<HTMLButtonElement>(null)

  const nombre = primerNombre(vista?.entry.client?.name) ?? 'Tu cliente'
  const enInicio = vista?.modo === 'inicio'
  const primeraVez =
    estado.tipo === 'listo' && (estado.datos.totalVisitas === 0 || estado.datos.cortes.length === 0)
  const notas = estado.tipo === 'listo' ? estado.datos.cliente.notas?.trim() || null : null

  return (
    <Dialog open={abierto} onOpenChange={(open) => { if (!open) onCerrar() }}>
      <DialogContent
        showCloseButton={false}
        // El foco arranca en la acción ("Entendido"), no en la primera foto.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          botonRef.current?.focus()
        }}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-3xl border-fuchsia-500/30 p-0 sm:max-w-lg"
      >
        {vista && (
          <>
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-fuchsia-700 via-fuchsia-600 to-pink-600 px-6 pb-6 pt-7 text-white">
              {/* Brillo de fondo: decorativo. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-white/15 blur-2xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-20 -left-10 size-40 rounded-full bg-pink-300/20 blur-2xl"
              />
              <div className="relative flex flex-col items-center text-center">
                {/* Borde y no `ring`: el ring de Tailwind es box-shadow y el halo
                    de `.asesoria-respira` (globals.css) también. */}
                <span
                  aria-hidden
                  className="asesoria-respira flex size-16 items-center justify-center rounded-full border border-white/35 bg-white/15"
                >
                  <MessageCircleQuestionMark className="size-8" />
                </span>
                <DialogTitle className="mt-4 text-2xl font-black leading-tight tracking-tight">
                  {nombre} pidió asesoría
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-sm text-[15px] leading-snug text-white/90">
                  No sabe qué hacerse. Es sin costo: charlá antes de arrancar y recomendale lo que mejor le quede.
                </DialogDescription>
              </div>
            </div>

            {clienteId && (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                {primeraVez ? (
                  <section aria-labelledby="asesoria-cortes-titulo">
                    <h3
                      id="asesoria-cortes-titulo"
                      className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Sus últimos cortes
                    </h3>
                    <p className="flex items-start gap-2.5 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] px-3.5 py-3 text-sm leading-snug">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-fuchsia-600" aria-hidden />
                      <span>Es su primera vez. Preguntale cómo se peina y qué le gustaría cambiar.</span>
                    </p>
                  </section>
                ) : (
                  <TiraUltimosCortes
                    estado={estadoTira}
                    onReintentar={reintentar}
                    variante="completa"
                    tono="neutro"
                    titulo="Sus últimos cortes"
                    sucursalActualId={vista.entry.branch_id}
                  />
                )}

                {notas && (
                  <section aria-labelledby="asesoria-notas-titulo">
                    <h3
                      id="asesoria-notas-titulo"
                      className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      <NotebookPen className="size-3.5" aria-hidden />
                      Observaciones
                    </h3>
                    <p className="whitespace-pre-wrap rounded-2xl border bg-muted/40 px-3.5 py-3 text-sm leading-snug">
                      {notas}
                    </p>
                  </section>
                )}
              </div>
            )}

            <div className="shrink-0 border-t bg-muted/30 px-5 pb-5 pt-4 sm:px-6">
              <Button
                ref={botonRef}
                size="lg"
                variant={enInicio ? 'default' : 'outline'}
                onClick={onCerrar}
                className={cn(
                  'h-14 w-full touch-manipulation rounded-2xl text-base font-bold motion-safe:active:scale-[0.98]',
                  enInicio &&
                    'bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/25 hover:bg-fuchsia-700 focus-visible:ring-fuchsia-500/50',
                )}
              >
                {enInicio ? 'Entendido' : 'Cerrar'}
              </Button>
              <p className="mt-3 flex items-start gap-2 text-xs leading-snug text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                {/* Un turno no tiene la salida «Solo asesoría» (cerrarla lo pasaría
                    a ausente y perdería la seña): ni el cobro ni el servidor la
                    ofrecen, así que el pop-up tampoco la promete (hallazgo
                    asesoria-04). */}
                {vista.entry.appointment_id ? (
                  <span>Es un turno: al cobrar, elegí lo que se le hizo.</span>
                ) : (
                  <span>
                    Al cobrar, elegí el servicio que le hiciste. Si no se hizo nada, cerralo como{' '}
                    <span className="font-semibold text-foreground">Solo asesoría</span>.
                  </span>
                )}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
