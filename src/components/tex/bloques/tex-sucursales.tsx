'use client'

// Las sucursales que leyó Tex (listar_sucursales): una tarjeta por sucursal.

import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TexSucursales({ items, className }: { items: { nombre: string; direccion?: string | null }[]; className?: string }) {
  const lista = (Array.isArray(items) ? items : []).filter((s) => s && s.nombre)
  if (lista.length === 0) return null
  return (
    <ul className={cn('@container grid grid-cols-1 gap-2 @md:grid-cols-2', className)} aria-label="Sucursales">
      {lista.map((s, i) => (
        <li key={`${i}-${s.nombre}`} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
          <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-[14px] leading-5 font-medium text-foreground" title={s.nombre}>
              {s.nombre}
            </p>
            {s.direccion ? (
              <p className="truncate text-[12px] leading-4 text-muted-foreground" title={s.direccion}>
                {s.direccion}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
