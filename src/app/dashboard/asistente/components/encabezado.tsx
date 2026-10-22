'use client'

// Encabezado de la columna de Tex. En la compu, 56 px: la cara quieta, "Tex"
// y la línea de estado (aria-live) · Nueva conversación · menú "⋯". En el
// celular, una subbarra de 44 px debajo del header del shell: [Historial] ·
// estado · [Nueva]. El modelo no se nombra acá: sólo en Configurar Tex.

import Link from 'next/link'
import { Activity, History, MoreHorizontal, Settings, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { TexIcono } from '@/components/tex/tex-icono'
import { guardarTexAnimacion, useTexAnimacion, useTexAnimacionPreferida } from '@/components/tex/use-tex-animacion'
import type { TexChatInfo } from '@/components/tex/chat/tex-chat'
import { useEnCliente } from '@/components/tex/chat/hooks'

export const RUTA_CONFIGURAR = '/dashboard/asistente/configuracion'

interface Props {
  info: TexChatInfo
  puedeConfigurar: boolean
  onNueva: () => void
  onAbrirHistorial: () => void
}

export function EncabezadoTex({ info, puedeConfigurar, onNueva, onAbrirHistorial }: Props) {
  return (
    <>
      <header className="hidden h-14 shrink-0 items-center gap-3 border-b px-6 lg:flex">
        <TexIcono className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-5 text-[color:var(--tex-texto)]">Tex</p>
          <p aria-live="polite" className="h-4 truncate text-xs leading-4 text-muted-foreground">
            {info.linea}
          </p>
        </div>
        <Button variant="ghost" className="h-9 gap-2 text-muted-foreground hover:text-foreground" onClick={onNueva} disabled={info.vacia}>
          <SquarePen className="size-4" aria-hidden />
          Nueva conversación
        </Button>
        <MenuTex puedeConfigurar={puedeConfigurar} />
      </header>

      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-1.5 lg:hidden">
        <button
          type="button"
          onClick={onAbrirHistorial}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
        >
          <History className="size-[18px]" aria-hidden />
          Historial
        </button>
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">
          {info.linea}
        </p>
        <button
          type="button"
          onClick={onNueva}
          disabled={info.vacia}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 disabled:pointer-events-none disabled:opacity-40"
        >
          <SquarePen className="size-[18px]" aria-hidden />
          Nueva
        </button>
      </div>
    </>
  )
}

function MenuTex({ puedeConfigurar }: { puedeConfigurar: boolean }) {
  const preferida = useTexAnimacionPreferida()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Más opciones de Tex" className="text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Animaciones de Tex</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preferida}
          onValueChange={(v) => guardarTexAnimacion(v === 'quieta' ? 'quieta' : 'completa')}
        >
          <DropdownMenuRadioItem value="completa">Completas</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="quieta">Quietas</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {puedeConfigurar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`${RUTA_CONFIGURAR}#uso`}>
                <Activity aria-hidden />
                Uso del mes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={RUTA_CONFIGURAR}>
                <Settings aria-hidden />
                Configurar Tex
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** En el celular el menú "⋯" no entra en la subbarra: sus opciones van al pie del historial. */
export function OpcionesTexMovil({ puedeConfigurar }: { puedeConfigurar: boolean }) {
  const preferida = useTexAnimacionPreferida()
  const efectiva = useTexAnimacion()
  const enCliente = useEnCliente()
  return (
    <div className="shrink-0 space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Animaciones de Tex</span>
        <div role="radiogroup" aria-label="Animaciones de Tex" className="flex gap-1 rounded-lg border bg-muted/50 p-0.5">
          {(['completa', 'quieta'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={preferida === v}
              onClick={() => guardarTexAnimacion(v)}
              className={cn(
                'h-9 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60',
                preferida === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'completa' ? 'Completas' : 'Quietas'}
            </button>
          ))}
        </div>
      </div>
      {enCliente && preferida === 'completa' && efectiva === 'quieta' && (
        <p className="text-[11px] text-muted-foreground">Tu teléfono pide reducir el movimiento: Tex queda quieto igual.</p>
      )}
      {puedeConfigurar && (
        <Link
          href={RUTA_CONFIGURAR}
          className="flex h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="size-4" aria-hidden />
          Configurar Tex
        </Link>
      )}
    </div>
  )
}
