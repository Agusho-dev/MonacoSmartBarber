'use client'

import Link from 'next/link'
import { Check, TriangleAlert, ArrowRight, ExternalLink, CircleDashed, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ItemEstado {
  id: string
  titulo: string
  /** Qué falta, con nombres propios cuando aplica ("Simón y Chipi sin días"). */
  detalle?: string
  ok: boolean
  /** El ítem ya está resuelto en pantalla pero todavía no se guardó. */
  pendiente?: boolean
  /**
   * Informativo: el turnero funciona, pero el dueño tiene que enterarse de algo
   * (ej. que la sucursal todavía no definió quién atiende cada día). No cuenta
   * como pendiente — pintarlo en rojo diría que no se puede reservar, y sí se
   * puede — pero muestra la acción igual.
   */
  aviso?: boolean
  accion?: {
    etiqueta: string
    href?: string
    onClick?: () => void
  }
}

interface Props {
  items: ItemEstado[]
  /** Link público del turnero, para probarlo apenas queda listo. */
  linkPublico: string | null
  hayCambiosSinGuardar: boolean
}

/**
 * Checklist de "¿esto realmente funciona?".
 *
 * Para que un cliente pueda reservar hacen falta varias cosas independientes
 * (modo de la sucursal, turnero prendido, barberos habilitados, días cargados,
 * servicios con duración). Antes no había forma de saber cuál faltaba salvo
 * abrir el link público y probar.
 */
export function EstadoTurnero({ items, linkPublico, hayCambiosSinGuardar }: Props) {
  const pendientes = items.filter(i => !i.ok)
  const listo = pendientes.length === 0
  const resueltosSinGuardar = items.filter(i => i.ok && i.pendiente).length

  return (
    <Card
      id="seccion-estado"
      className={cn(
        'scroll-mt-24 overflow-hidden border-l-4',
        listo ? 'border-l-emerald-500' : 'border-l-amber-500'
      )}
    >
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl',
                listo ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'
              )}
            >
              {listo ? <Check className="size-6" strokeWidth={2.5} /> : <TriangleAlert className="size-5" />}
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight">
                {listo ? 'Los clientes pueden reservar' : pendientes.length === 1 ? 'Falta 1 cosa para recibir turnos' : `Faltan ${pendientes.length} cosas para recibir turnos`}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {listo
                  ? 'Todo lo necesario está configurado. Probá el link como si fueras un cliente.'
                  : 'Mientras alguno de estos puntos esté en rojo, el turnero no muestra horarios.'}
              </p>
            </div>
          </div>

          {linkPublico && (
            <Button asChild variant={listo ? 'default' : 'outline'} size="sm" className="shrink-0">
              <a href={linkPublico} target="_blank" rel="noopener noreferrer">
                Probar el turnero
                <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </Button>
          )}
        </div>

        {(hayCambiosSinGuardar || resueltosSinGuardar > 0) && (
          <p className="flex items-center gap-1.5 text-xs text-amber-500">
            <CircleDashed className="size-3.5" />
            Lo que ves acá incluye cambios que todavía no guardaste.
          </p>
        )}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map(item => (
            <li key={item.id} className="flex items-start gap-3 p-3">
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                  item.ok
                    ? item.aviso || item.pendiente
                      ? 'bg-amber-500/20 text-amber-500'
                      : 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-destructive/15 text-destructive'
                )}
              >
                {!item.ok ? (
                  <span className="size-1.5 rounded-full bg-current" />
                ) : item.aviso ? (
                  <Info className="size-3.5" />
                ) : (
                  <Check className="size-3.5" strokeWidth={3} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className={cn('text-sm leading-tight', item.ok ? 'text-foreground' : 'font-medium text-foreground')}>
                  {item.titulo}
                </p>
                {item.detalle && (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.detalle}</p>
                )}
              </div>

              {(!item.ok || item.aviso) && item.accion && (
                item.accion.href ? (
                  <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 text-xs">
                    <Link href={item.accion.href}>
                      {item.accion.etiqueta}
                      <ArrowRight className="ml-1 size-3" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={item.accion.onClick}
                  >
                    {item.accion.etiqueta}
                    <ArrowRight className="ml-1 size-3" />
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
