'use client'

// Estados de pantalla de la conciliación (spec C):
//   - nada conectado: Tex pide ayuda y prioriza las cuentas por plata;
//   - no se pudo calcular: banda roja arriba con Reintentar (y la pantalla en "—");
//   - error de Mercado Pago: banda roja que nombra cada cuenta afectada.

import Link from 'next/link'
import { Loader2, Plug, RefreshCw, TriangleAlert, XCircle } from 'lucide-react'
import type { CuentaConciliacion } from '@/lib/conciliacion-mp/contrato'
import { TexPose } from '@/components/tex/tex-pose'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { horaAR, porcentaje } from './formato'
import { listaSucursales } from './cuentas'
import { cuentasPrioritarias, type CuentaConError } from './logica'

export type { CuentaConError }

export function NadaConectado({
  cuentas,
  puedeGestionar,
  onConectar,
}: {
  cuentas: CuentaConciliacion[]
  puedeGestionar: boolean
  onConectar: (c: CuentaConciliacion) => void
}) {
  const { elegidas, pct } = cuentasPrioritarias(cuentas)
  const n = elegidas.length
  const bajada =
    n === 0
      ? null
      : pct > 0
        ? `Empezá por ${n === 1 ? 'esta' : `estas ${n}`}: ${n === 1 ? 'es' : 'son'} el ${porcentaje(pct)} de lo transferido en 30 días.`
        : `Empezá por ${n === 1 ? 'esta' : `estas ${n}`}:`

  return (
    <section aria-labelledby="nada-conectado" className="rounded-2xl border bg-card p-5 sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <TexPose pose="ayuda" alto={120} halo prioridad className="self-center lg:self-start" />
        <div className="min-w-0 flex-1 space-y-4">
          <h2 id="nada-conectado" className="text-xl leading-snug font-semibold text-balance text-zinc-50 sm:text-2xl">
            Conectá las cuentas donde cobran por transferencia y te digo cada mañana si cuadró la plata.
          </h2>
          {n === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay cuentas de Mercado Pago para conectar. Cargá el alias de cada cuenta en{' '}
              <Link href="/dashboard/finanzas?tab=cuentas" className="text-[var(--tex-texto)] underline-offset-4 hover:underline">
                Cuentas de cobro
              </Link>
              .
            </p>
          ) : (
            <>
              <p className="text-[15px] text-zinc-300">{bajada}</p>
              <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10">
                {elegidas.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold text-zinc-100">{c.alias}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.titular, listaSucursales(c)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {c.pctPlata30d > 0 && (
                      <span className="shrink-0 font-mono text-sm text-zinc-300 tabular-nums">{porcentaje(c.pctPlata30d)}</span>
                    )}
                    {puedeGestionar && (
                      <Button size="sm" variant="secondary" className="h-9 shrink-0 gap-1.5" onClick={() => onConectar(c)}>
                        <Plug className="size-3.5" aria-hidden />
                        Conectar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {!puedeGestionar && (
                <p className="text-sm text-muted-foreground">Pedile a quien administra el sistema que las conecte.</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** La conciliación no se pudo calcular. Va primero: invalida todo lo de abajo. */
export function BannerErrorCarga({
  error,
  generadoEn,
  reintentando,
  onReintentar,
}: {
  error: string
  /** Si lo que queda en pantalla es una lectura anterior del MISMO período, desde cuándo. */
  generadoEn: string | null
  reintentando: boolean
  onReintentar: () => void
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4 sm:p-5">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-500/15">
        <XCircle className="size-6 text-red-400" aria-hidden />
      </div>
      <div className="min-w-[12rem] flex-1">
        <p className="font-semibold text-red-200">
          {generadoEn ? 'No pudimos actualizar la conciliación' : 'No pudimos calcular la conciliación'}
        </p>
        <p className="text-sm text-muted-foreground">
          {error}{' '}
          {generadoEn
            ? `Lo que ves es de las ${horaAR(generadoEn)}: no lo tomes como cerrado.`
            : 'No mostramos números que no pudimos leer.'}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onReintentar}
        disabled={reintentando}
        className="h-10 w-full gap-2 border-red-500/40 text-red-200 hover:bg-red-500/10 hover:text-red-100 sm:w-auto"
      >
        {reintentando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        Reintentar
      </Button>
    </div>
  )
}

/** Una o más cuentas no se pudieron leer: el veredicto es "con lo que pudimos leer". */
export function BannerErrorMP({
  cuentas,
  afectaPeriodo,
  reintentando,
  onReintentar,
}: {
  cuentas: CuentaConError[]
  /** Si la cuenta tiene cobros de este período sin verificar. Si no, lo del período ya estaba leído. */
  afectaPeriodo: boolean
  reintentando: boolean
  onReintentar: (() => void) | null
}) {
  const nombres = cuentas.map((c) => c.alias ?? 'una cuenta sin alias')
  const lista = nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  return (
    <div role="alert" className="flex flex-wrap items-start gap-4 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4 sm:p-5">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-500/15">
        <TriangleAlert className="size-6 text-red-400" aria-hidden />
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1.5">
        <p className="font-semibold text-red-200">
          {afectaPeriodo ? 'No pudimos leer Mercado Pago en ' : 'No pudimos traer lo nuevo de '}
          <span className="font-mono">{lista}</span>.
        </p>
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {cuentas.map((c) => (
            <li key={c.id}>
              <span className="font-mono text-zinc-300">{c.alias ?? 'Sin alias'}</span>: {c.detalle}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {afectaPeriodo
            ? 'Lo de las otras cuentas está al día: el veredicto es con lo que pudimos leer.'
            : 'Lo de este período ya estaba leído: el veredicto no cambia.'}
        </p>
      </div>
      {onReintentar && (
        <Button
          variant="outline"
          onClick={onReintentar}
          disabled={reintentando}
          className={cn('h-10 w-full gap-2 border-red-500/40 text-red-200 hover:bg-red-500/10 hover:text-red-100 sm:w-auto')}
        >
          {reintentando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          Reintentar
        </Button>
      )}
    </div>
  )
}
