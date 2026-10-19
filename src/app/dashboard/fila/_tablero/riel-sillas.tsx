'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { minutosDesde, nombreDePila } from './derivados'
import { FotoBarbero } from './foto-barbero'
import { ANILLO, FichaSilla, TEXTO_ESTADO, minutosEnLaSilla, type SillaProps } from './silla'
import { TextoEspera } from './texto-espera'

/**
 * Las sillas en el celular: un riel que se ve entero de un vistazo. Las libres
 * con alguien para ellas van primero y actúan de un toque ("Atender a Ignacio");
 * el resto son caras con el anillo de su estado y los minutos, y al tocarlas se
 * abre la silla completa en una hoja (Cobrar, descanso, cancelar). Con la tira
 * de tarjetas de antes se veía una silla por pantalla. Para pasarle un cliente a
 * un barbero se arrastra la tarjeta: abajo aparece el dock con los barberos.
 *
 * `onTocando` congela el orden del riel mientras el dedo está encima: una silla
 * que se libera corre a las demás, y el toque caía en la de al lado.
 */
export function RielDeSillas({
  sillas,
  className,
  onTocando,
}: {
  sillas: SillaProps[]
  className?: string
  onTocando?: (tocando: boolean) => void
}) {
  const [abierta, setAbierta] = useState<string | null>(null)
  const silla = sillas.find((s) => s.barbero.id === abierta)

  return (
    <>
      <div
        role="list"
        aria-label="Sillas"
        onPointerDown={() => onTocando?.(true)}
        onPointerUp={() => onTocando?.(false)}
        onPointerCancel={() => onTocando?.(false)}
        onPointerLeave={() => onTocando?.(false)}
        className={cn('-mx-3 flex gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      >
        {sillas.map((s) => {
          if (s.estado === 'libre' && s.siguiente) {
            const siguiente = s.siguiente
            const ocupado = s.ocupadoId !== null && s.ocupadoId === siguiente.id
            return (
              <div role="listitem" key={s.barbero.id} className="shrink-0">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => s.onAtender(siguiente)}
                  className={cn(
                    'flex h-[4.5rem] w-[14rem] items-center gap-2.5 rounded-2xl bg-foreground px-3 text-left text-background outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                    s.aterrizaje && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-background',
                  )}
                >
                  <FotoBarbero barbero={s.barbero} tamano="lg" className="size-8 ring-2 ring-background/30" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium opacity-70">
                      {nombreDePila(s.barbero.full_name)} está libre
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] font-semibold">
                      <Play className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">Atender a {nombreDePila(siguiente.client?.name)}</span>
                    </span>
                    <span className="block truncate text-xs opacity-70">
                      {s.siguienteTurno ? (
                        `Turno de las ${s.siguienteTurno.hora}`
                      ) : (
                        <>
                          {s.siguienteDelPool ? 'Menor espera · ' : ''}
                          <TextoEspera minutos={minutosDesde(siguiente.checked_in_at, s.ahora)} />
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </div>
            )
          }
          const conMinutos = s.estado === 'cortando' || s.estado === 'descanso'
          return (
            <div role="listitem" key={s.barbero.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setAbierta(s.barbero.id)}
                aria-label={`${s.barbero.full_name}: ${TEXTO_ESTADO[s.estado]}`}
                className={cn(
                  'flex h-[4.5rem] w-16 flex-col items-center justify-center gap-1 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  (s.estado === 'sin_entrada' || s.estado === 'fin_de_turno') && 'opacity-60',
                  s.aterrizaje && 'bg-emerald-500/10',
                )}
              >
                <FotoBarbero
                  barbero={s.barbero}
                  tamano="lg"
                  className={cn('size-10 ring-2 ring-offset-2 ring-offset-background', ANILLO[s.estado])}
                />
                <span
                  className={cn(
                    'max-w-full truncate text-[0.6875rem] font-medium leading-none',
                    s.estado === 'descanso' ? 'text-amber-200' : conMinutos ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {conMinutos ? (
                    <TextoEspera minutos={minutosEnLaSilla(s.enCurso, s.ahora)} />
                  ) : (
                    nombreDePila(s.barbero.full_name)
                  )}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      <Sheet open={!!silla} onOpenChange={(open) => { if (!open) setAbierta(null) }}>
        {/* Sin la X de la hoja: caía encima del ⋯ de la silla. Se cierra
            deslizando, tocando afuera o con cualquier acción. */}
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-foreground/20" />
          <SheetHeader className="sr-only">
            <SheetTitle>{silla?.barbero.full_name ?? 'Silla'}</SheetTitle>
            <SheetDescription>Qué pasa en su silla y qué se puede hacer.</SheetDescription>
          </SheetHeader>
          {silla && (
            <FichaSilla
              {...silla}
              // Cada acción cierra la hoja: lo que sigue (cobro, confirmación)
              // abre su propio diálogo.
              onCobrar={(e) => { setAbierta(null); silla.onCobrar(e) }}
              onAtender={(e) => { setAbierta(null); silla.onAtender(e) }}
              onCancelar={(e) => { setAbierta(null); silla.onCancelar(e) }}
              onDescanso={(c) => { setAbierta(null); silla.onDescanso(c) }}
              onVerSuFila={() => { setAbierta(null); silla.onVerSuFila() }}
              className="border-0 bg-transparent px-0 py-0"
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
