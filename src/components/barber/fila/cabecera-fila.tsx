'use client'

import Image from 'next/image'
import {
  Coffee,
  Eye,
  EyeOff,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  Power,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sello } from './sello'

/** Estado del descanso propio, tal como lo resuelve el panel. */
export type EstadoDescansoCabecera =
  /** La sucursal no tiene tipos de descanso configurados: no hay botón. */
  | { estado: 'sin-configurar' }
  | { estado: 'libre'; onPedir: () => void }
  | { estado: 'solicitado'; cargando: boolean; onCancelar: () => void }
  | { estado: 'aprobado' }
  /** En curso: lo muestra la silla, acá no va nada. */
  | { estado: 'en-curso' }

export interface CabeceraFilaProps {
  nombre: string
  sucursal: string
  avatarUrl?: string | null
  cortesHoy: number
  /** Oculto del check-in (el kiosko no lo ofrece). */
  oculto: boolean
  descanso: EstadoDescansoCabecera
  /** Con permiso breaks.grant: los pedidos de descanso de los demás. */
  gestionDescansos: { pendientes: number; onAbrir: () => void } | null
  onVender: () => void
  onEntregarPremio: (() => void) | null
  visibilidad: { cargando: boolean; onAlternar: () => void } | null
  onGestionarBarberos: (() => void) | null
  /** Server action del cierre de sesión (va en un <form action>). */
  accionSalir: () => void | Promise<void>
}

function iniciales(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

const BOTON = 'h-12 touch-manipulation rounded-xl px-4 text-[0.9375rem] font-semibold [&_svg]:size-[1.125rem] max-sm:size-12 max-sm:px-0'

/**
 * Debajo de la hora: de quién es esta tablet y lo que se hace entre corte y
 * corte. Descanso y Vender quedan a la vista (son de todos los días); lo que es
 * de vez en cuando —entregar un premio, ocultarse del check-in, gestionar
 * barberos y descansos ajenos, salir— va en "Más".
 */
export function CabeceraFila({
  nombre,
  sucursal,
  avatarUrl,
  cortesHoy,
  oculto,
  descanso,
  gestionDescansos,
  onVender,
  onEntregarPremio,
  visibilidad,
  onGestionarBarberos,
  accionSalir,
}: CabeceraFilaProps) {
  const pendientes = gestionDescansos?.pendientes ?? 0

  return (
    <header className="flex shrink-0 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-base font-semibold text-primary-foreground max-sm:size-10 max-sm:text-sm">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill sizes="48px" unoptimized className="object-cover" />
          ) : (
            iniciales(nombre)
          )}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-lg font-semibold leading-tight tracking-[-0.01em] max-sm:text-base">{nombre}</p>
            {oculto && (
              <Sello tono="ambar" title="El check-in no te ofrece a los clientes">
                <EyeOff aria-hidden /> Oculto
              </Sello>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {sucursal}
            {cortesHoy > 0 && (
              <>
                {' · '}
                <span className="font-mono font-semibold tabular-nums text-foreground/75">{cortesHoy}</span>{' '}
                {cortesHoy === 1 ? 'corte hoy' : 'cortes hoy'}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {descanso.estado === 'libre' && (
          <Button variant="outline" className={cn(BOTON, 'bg-card')} onClick={descanso.onPedir} aria-label="Descanso">
            <Coffee aria-hidden />
            <span className="max-sm:sr-only">Descanso</span>
          </Button>
        )}
        {descanso.estado === 'solicitado' && (
          <Button
            variant="outline"
            onClick={descanso.onCancelar}
            disabled={descanso.cargando}
            title="Tocá para cancelar el pedido"
            aria-label="Descanso pedido. Tocá para cancelarlo"
            className={cn(BOTON, 'border-amber-500/50 bg-amber-400/15 text-amber-900 hover:bg-amber-400/25 max-sm:w-auto max-sm:px-3')}
          >
            <Coffee aria-hidden />
            <span className="max-sm:sr-only">Descanso pedido</span>
            <X aria-hidden className="opacity-70" />
          </Button>
        )}
        {descanso.estado === 'aprobado' && (
          <span
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-amber-500/55 bg-amber-400/15 px-4 text-[0.9375rem] font-semibold text-amber-900 max-sm:px-3"
            title="Tu descanso arranca solo cuando quedes libre"
          >
            <Coffee aria-hidden className="size-[1.125rem]" />
            <span className="max-sm:sr-only">Descanso aprobado</span>
          </span>
        )}

        {/* Descansos de otros esperando aprobación: a la vista sólo si hay alguno. */}
        {gestionDescansos && pendientes > 0 && (
          <Button
            variant="outline"
            onClick={gestionDescansos.onAbrir}
            aria-label={`${pendientes} ${pendientes === 1 ? 'pedido' : 'pedidos'} de descanso para aprobar`}
            className={cn(BOTON, 'relative border-amber-500/50 bg-amber-400/15 text-amber-900 hover:bg-amber-400/25')}
          >
            <Users aria-hidden />
            <span className="max-sm:sr-only">Aprobar</span>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-1.5 font-mono text-xs font-bold text-amber-950 max-sm:absolute max-sm:-right-1.5 max-sm:-top-1.5">
              {pendientes}
            </span>
          </Button>
        )}

        <Button variant="outline" className={cn(BOTON, 'bg-card')} onClick={onVender} aria-label="Vender productos">
          <ShoppingBag aria-hidden />
          <span className="max-sm:sr-only">Vender</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Más opciones"
              className="size-12 touch-manipulation rounded-xl bg-card [&_svg]:size-5"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-1.5">
            {onEntregarPremio && (
              <DropdownMenuItem onClick={onEntregarPremio} className="h-12 gap-3 rounded-lg text-[0.9375rem]">
                <PackageCheck className="size-5" aria-hidden />
                Entregar premio
              </DropdownMenuItem>
            )}
            {gestionDescansos && (
              <DropdownMenuItem onClick={gestionDescansos.onAbrir} className="h-12 gap-3 rounded-lg text-[0.9375rem]">
                <Coffee className="size-5" aria-hidden />
                Descansos del equipo
                {pendientes > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 font-mono text-xs font-bold text-amber-950">
                    {pendientes}
                  </span>
                )}
              </DropdownMenuItem>
            )}
            {visibilidad && (
              <DropdownMenuItem
                onClick={visibilidad.onAlternar}
                disabled={visibilidad.cargando}
                className="h-12 gap-3 rounded-lg text-[0.9375rem]"
              >
                {oculto ? (
                  <Eye className="size-5" aria-hidden />
                ) : (
                  <EyeOff className="size-5" aria-hidden />
                )}
                {oculto ? 'Volver a aparecer en el check-in' : 'Ocultarme del check-in'}
              </DropdownMenuItem>
            )}
            {onGestionarBarberos && (
              <DropdownMenuItem onClick={onGestionarBarberos} className="h-12 gap-3 rounded-lg text-[0.9375rem]">
                <Power className="size-5" aria-hidden />
                Gestionar barberos
              </DropdownMenuItem>
            )}
            {(onEntregarPremio || gestionDescansos || visibilidad || onGestionarBarberos) && <DropdownMenuSeparator />}
            <form action={accionSalir}>
              <DropdownMenuItem asChild className="h-12 gap-3 rounded-lg text-[0.9375rem]">
                <button type="submit" className="w-full text-destructive focus:text-destructive">
                  <LogOut className="size-5" aria-hidden />
                  Cerrar sesión
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
