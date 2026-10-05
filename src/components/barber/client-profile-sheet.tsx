'use client'

import { AlertTriangle, Clock, Instagram, NotebookPen, RefreshCw, User, X } from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { Client } from '@/lib/types/database'
import { useUltimosCortes } from '@/hooks/use-ultimos-cortes'
import { haceCuanto, primerNombre } from '@/lib/fotos-corte/textos'
import { ClientHistory } from './client-history'

interface ClientProfileSheetProps {
  /** El cliente de la entrada de la fila (sólo trae id, nombre y teléfono). */
  client: Client | null
  isOpen: boolean
  onClose: () => void
}

/**
 * Ficha de un cliente para el barbero: observaciones, Instagram, la última
 * visita y sus cortes con fotos.
 *
 * Todo sale de UNA server action (getUltimosCortesDelCliente, con service role)
 * y sólo mientras la hoja está abierta. Antes las observaciones y el Instagram
 * se leían del embed de la fila, que no los trae (queue-panel no pide esas
 * columnas a propósito: KR#10/#34), y el historial con la anon key, que no ve
 * ninguna foto. Funciona con la cookie del barbero: `getCurrentOrgId` la lee.
 *
 * La abre el NOMBRE del cliente en las tarjetas de la fila (queue-panel).
 */
export function ClientProfileSheet({ client, isOpen, onClose }: ClientProfileSheetProps) {
  const { estado, reintentar } = useUltimosCortes(isOpen && client ? client.id : null, { limite: 12 })

  if (!client) return null

  const nombre = estado.tipo === 'listo' ? estado.datos.cliente.nombre || client.name : client.name
  const ultimo = estado.tipo === 'listo' ? estado.datos.cortes[0] : undefined
  const barberoUltimo = primerNombre(ultimo?.barbero?.nombre)

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* X propia: la de la hoja compartida es un ícono de 16 px, difícil de
          acertar con el dedo en la tablet. */}
      <SheetContent showCloseButton={false} className="w-full overflow-y-auto pb-8 sm:max-w-md">
        <SheetHeader className="mb-4 flex-row items-start gap-2 pr-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <SheetTitle className="flex items-center gap-2">
              <User className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0">Ficha de {nombre}</span>
            </SheetTitle>
            <SheetDescription>
              {ultimo
                ? `Última visita: ${haceCuanto(ultimo.fecha)}${barberoUltimo ? ` con ${barberoUltimo}` : ''}`
                : estado.tipo === 'listo'
                  ? 'Primera visita'
                  : client.phone}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cerrar la ficha"
              className="-mt-1.5 size-11 shrink-0 touch-manipulation rounded-full"
            >
              <X className="size-5" aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="space-y-5 px-4">
          {estado.tipo === 'error' ? (
            <div role="alert" className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 py-2 pl-3 pr-1.5 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-5 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-sm font-semibold">{estado.error}</p>
              <button
                type="button"
                onClick={reintentar}
                className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:underline"
              >
                <RefreshCw className="size-4" aria-hidden />
                Reintentar
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border bg-card/40 p-4">
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <NotebookPen className="size-3.5" aria-hidden />
                  Observaciones
                </p>
                {estado.tipo === 'listo' ? (
                  <p className="whitespace-pre-wrap text-sm">
                    {estado.datos.cliente.notas ?? <span className="text-muted-foreground">Ninguna</span>}
                  </p>
                ) : (
                  <div className="h-5 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
                )}
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Instagram className="size-3.5" aria-hidden />
                  Instagram
                </p>
                {estado.tipo === 'listo' ? (
                  <p className="text-sm font-medium">
                    {estado.datos.cliente.instagram ?? <span className="font-normal text-muted-foreground">No especificado</span>}
                  </p>
                ) : (
                  <div className="h-5 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* Con error, el aviso de arriba ya lo dice una vez: no se repite acá. */}
          {estado.tipo !== 'error' && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Clock className="size-4" aria-hidden />
                Historial
              </h3>
              {/* Misma clave de caché (cliente + 12) que el hook de arriba: es la
                  MISMA llamada, no una segunda. */}
              <ClientHistory clientId={client.id} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
