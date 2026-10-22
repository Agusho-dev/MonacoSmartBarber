'use client'

// El veredicto de la conciliación con Mercado Pago, en chico, para el chat.
// Verde sólo si cuadra con todo leído; "todavía no se sabe" es gris y un error
// de lectura es rojo, nunca verde (Known Risk #15). Lo que falta y lo que
// sobra ya vienen separados en el titular: nunca se netean.

import { memo } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, ListChecks, MinusCircle, Scale, XCircle, type LucideIcon } from 'lucide-react'
import type { TexVeredictoConciliacion } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { CLASES_TONO, enlaceSeguro, igualesProfundo, type TonoBloque } from './formato'

const META: Record<TexVeredictoConciliacion['tipo'], { tono: TonoBloque; Icono: LucideIcon; titular: string }> = {
  cuadra: { tono: 'ok', Icono: CheckCircle2, titular: 'text-emerald-300' },
  no_cuadra: { tono: 'revisar', Icono: AlertTriangle, titular: 'text-amber-200' },
  no_se_sabe: { tono: 'desconocido', Icono: CircleDashed, titular: 'text-zinc-200' },
  error: { tono: 'error', Icono: XCircle, titular: 'text-red-300' },
  sin_movimientos: { tono: 'desconocido', Icono: MinusCircle, titular: 'text-zinc-300' },
}

function TexVeredictoMiniBase({ veredicto, compacto = false }: { veredicto: TexVeredictoConciliacion; compacto?: boolean }) {
  const meta = META[veredicto.tipo] ?? META.no_se_sabe
  const clases = CLASES_TONO[meta.tono]
  const enlace = enlaceSeguro(veredicto.enlace)
  const { Icono } = meta

  return (
    <section className={cn('@container rounded-2xl border p-4', clases.caja)} aria-label="Conciliación con Mercado Pago">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4">
        <Icono className={cn('size-4 shrink-0', clases.icono)} aria-hidden />
        <span className="font-medium text-zinc-200">Conciliación con Mercado Pago</span>
        {veredicto.periodo && <span className="text-muted-foreground">· {veredicto.periodo}</span>}
      </p>
      <p
        className={cn(
          'mt-2 font-mono leading-tight font-semibold tracking-tight text-balance tabular-nums',
          compacto ? 'text-[20px]' : 'text-[22px] @md:text-[24px]',
          meta.titular,
        )}
      >
        {veredicto.titular}
      </p>
      {veredicto.detalle && <p className="mt-1.5 text-[13px] leading-5 text-zinc-300">{veredicto.detalle}</p>}

      {(veredicto.paraRevisar > 0 || veredicto.cobertura) && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {veredicto.paraRevisar > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[12px] text-amber-200">
              <ListChecks className="size-3.5" aria-hidden />
              {veredicto.paraRevisar.toLocaleString('es-AR')} para revisar
            </li>
          )}
          {veredicto.cobertura && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-zinc-300">
              <Scale className="size-3.5" aria-hidden />
              {veredicto.cobertura}
            </li>
          )}
        </ul>
      )}

      {enlace && (
        <Link
          href={enlace.href}
          target={enlace.interno ? undefined : '_blank'}
          rel={enlace.interno ? undefined : 'noreferrer'}
          className="mt-3.5 inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none sm:h-9"
        >
          Ver la conciliación
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      )}
    </section>
  )
}

export const TexVeredictoMini = memo(TexVeredictoMiniBase, (a, b) => a.compacto === b.compacto && igualesProfundo(a.veredicto, b.veredicto))
