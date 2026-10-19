'use client'

import { Check, Target } from 'lucide-react'
import { EncabezadoPantalla } from '@/components/barber/encabezado-pantalla'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface GoalsData {
    rules: {
        id: string
        name: string
        description: string | null
        metric: string
        threshold: number
        reward_amount: number
        period: string
        is_active: boolean
        /** Cortes que cuentan para esta meta, ya acotados a su umbral (ver fetchBarberGoals). */
        progreso: number
    }[]
    achievements: {
        id: string
        rule_id: string
        amount_earned: number
    }[]
    currentPeriod: string
}

interface MetasClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    goals: GoalsData
}

/** "2026-10" → "octubre de 2026". */
function periodoLegible(periodo: string) {
    const [anio, mes] = periodo.split('-').map(Number)
    if (!anio || !mes) return periodo
    return new Date(anio, mes - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

/**
 * Hasta acá la meta se dibuja como una tarjeta de fichar: un agujero por corte,
 * y cada corte lo perfora. Más agujeros ya no se cuentan de un vistazo: barra.
 */
const MAX_AGUJEROS = 60

export function MetasClient({ session, goals }: MetasClientProps) {
    const achievedRuleIds = new Set(goals.achievements.map((a) => a.rule_id))

    return (
        <div>
            <EncabezadoPantalla
                titulo="Mis metas"
                detalle={`${session.full_name} · ${periodoLegible(goals.currentPeriod)}`}
            />

            <div className="px-4 py-5 sm:px-6 sm:py-6">
                {/* Sin el total de cortes del mes: el dueño no quiere que el barbero
                    lo vea. Cada meta dice cuánto le falta para ella y nada más. */}
                <div className="mx-auto max-w-3xl space-y-5">
                    {goals.rules.length === 0 ? (
                        <div className="rounded-[1.25rem] border-2 border-dashed border-foreground/15 px-6 py-12 text-center">
                            <Target className="mx-auto size-9 text-muted-foreground/60" aria-hidden />
                            <p className="mt-3 text-lg font-semibold">No hay metas este mes</p>
                            <p className="mt-1 text-[0.9375rem] text-muted-foreground">
                                Cuando el local cargue una, la vas a ver acá con lo que te falta.
                            </p>
                        </div>
                    ) : (
                        goals.rules.map((rule) => {
                            const isAchieved = achievedRuleIds.has(rule.id)
                            const cuentaCortes = rule.metric === 'haircut_count' && rule.threshold > 0
                            const progress = cuentaCortes ? Math.min(rule.progreso, rule.threshold) : 0
                            const faltan = Math.max(0, rule.threshold - progress)
                            // Lograda (el local registró el logro): la tarjeta va completa
                            // aunque el conteo del mes diga otra cosa (cortes anulados).
                            const llenos = isAchieved ? rule.threshold : progress

                            return (
                                <article
                                    key={rule.id}
                                    className={cn(
                                        'rounded-[1.25rem] border p-5 shadow-[0_8px_22px_-18px_oklch(0.2_0.012_260/0.5)] sm:p-6',
                                        isAchieved ? 'border-emerald-600/30 bg-emerald-50' : 'border-border/80 bg-card',
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <h2 className="text-xl font-semibold leading-tight tracking-[-0.01em]">{rule.name}</h2>
                                            {rule.description && (
                                                <p className="mt-1 text-[0.9375rem] text-muted-foreground">{rule.description}</p>
                                            )}
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="font-mono text-xl font-semibold tabular-nums">
                                                {formatCurrency(rule.reward_amount)}
                                            </p>
                                            <p className="text-[0.8125rem] text-muted-foreground">de premio</p>
                                        </div>
                                    </div>

                                    {cuentaCortes && (
                                        <>
                                            {rule.threshold <= MAX_AGUJEROS ? (
                                                <TarjetaPerforada total={rule.threshold} hechos={llenos} lograda={isAchieved} />
                                            ) : (
                                                <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-muted">
                                                    <div
                                                        className={cn('h-full rounded-full', isAchieved ? 'bg-emerald-600' : 'bg-primary')}
                                                        style={{ width: `${(llenos / rule.threshold) * 100}%` }}
                                                    />
                                                </div>
                                            )}
                                            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                                                {isAchieved ? (
                                                    <p className="flex items-center gap-1.5 text-lg font-semibold text-emerald-700">
                                                        <Check className="size-5" aria-hidden />
                                                        ¡Lograda!
                                                    </p>
                                                ) : faltan === 0 ? (
                                                    // Los cortes ya están; el premio se acredita cuando el
                                                    // local registra el logro.
                                                    <p className="flex items-center gap-1.5 text-lg font-semibold">
                                                        <Check className="size-5" aria-hidden />
                                                        Llegaste a la meta
                                                    </p>
                                                ) : (
                                                    <p className="text-lg font-semibold">
                                                        Te {faltan === 1 ? 'falta' : 'faltan'}{' '}
                                                        <span className="font-mono tabular-nums">{faltan}</span>{' '}
                                                        {faltan === 1 ? 'corte' : 'cortes'}
                                                    </p>
                                                )}
                                                {!isAchieved && (
                                                    <p className="font-mono text-[0.9375rem] font-semibold tabular-nums text-muted-foreground">
                                                        {progress} / {rule.threshold}
                                                    </p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </article>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}

/** Un agujero por corte de la meta; los hechos, perforados. */
function TarjetaPerforada({ total, hechos, lograda }: { total: number; hechos: number; lograda: boolean }) {
    return (
        <div
            role="img"
            aria-label={`${hechos} de ${total} cortes`}
            className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(1.75rem,1fr))] gap-2 rounded-2xl bg-muted/60 p-3"
        >
            {Array.from({ length: total }).map((_, i) => (
                <span
                    key={i}
                    className={cn(
                        'mx-auto size-6 rounded-full',
                        i < hechos
                            ? lograda
                                ? 'bg-emerald-600 shadow-[inset_0_2px_3px_oklch(0_0_0/0.35)]'
                                : 'bg-primary shadow-[inset_0_2px_3px_oklch(0_0_0/0.45)]'
                            : 'bg-card shadow-[inset_0_1px_3px_oklch(0.2_0.012_260/0.25)]',
                    )}
                />
            ))}
        </div>
    )
}
