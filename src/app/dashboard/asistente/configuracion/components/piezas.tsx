'use client'

// Piezas de Configurar Tex: la tarjeta de cada sección, el chip de estado y el
// campo de clave enmascarado.

import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Seccion({
  id,
  icono: Icono,
  titulo,
  descripcion,
  extra,
  children,
}: {
  id: string
  icono: LucideIcon
  titulo: string
  descripcion?: ReactNode
  /** A la derecha del título (chip de estado). */
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-20 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
          <Icono className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`${id}-titulo`} className="text-[15px] font-semibold leading-6">
              {titulo}
            </h2>
            {extra}
          </div>
          {descripcion && <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{descripcion}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export type TonoEstado = 'ok' | 'revisar' | 'neutro'

const TONO_CHIP: Record<TonoEstado, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  revisar: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  neutro: 'border-white/10 bg-white/[0.04] text-muted-foreground',
}

const TONO_PUNTO: Record<TonoEstado, string> = {
  ok: 'bg-emerald-400',
  revisar: 'bg-amber-300',
  neutro: 'bg-zinc-400',
}

export function ChipEstado({ tono, children }: { tono: TonoEstado; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', TONO_CHIP[tono])}>
      <span className={cn('size-1.5 rounded-full', TONO_PUNTO[tono])} aria-hidden />
      {children}
    </span>
  )
}

export function CampoClave({
  id,
  valor,
  onCambio,
  placeholder,
  deshabilitado,
  invalido,
  etiqueta,
}: {
  id: string
  valor: string
  onCambio: (valor: string) => void
  placeholder: string
  deshabilitado?: boolean
  invalido?: boolean
  etiqueta: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={placeholder}
        aria-label={etiqueta}
        aria-invalid={invalido || undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={deshabilitado}
        className="h-11 w-full min-w-0 rounded-lg border bg-transparent pl-3 pr-11 font-mono text-base outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-[color:var(--tex)]/50 focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/30 disabled:opacity-50 aria-invalid:border-red-500/60 sm:text-sm"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar la clave' : 'Mostrar la clave'}
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
