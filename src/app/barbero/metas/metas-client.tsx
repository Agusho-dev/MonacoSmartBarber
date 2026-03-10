'use client'

import { Target, Trophy, CheckCircle2 } from 'lucide-react'

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
    }[]
    achievements: {
        id: string
        rule_id: string
        amount_earned: number
    }[]
    currentCuts: number
    currentPeriod: string
}

interface MetasClientProps {
    session: { staff_id: string; full_name: string; branch_id: string; role: string }
    goals: GoalsData
}

function formatCurrency(n: number) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export function MetasClient({ session, goals }: MetasClientProps) {
    const achievedRuleIds = new Set(goals.achievements.map((a) => a.rule_id))

    return (
        <div className="min-h-dvh bg-background">
            <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="px-4 py-3">
                    <h1 className="font-semibold text-lg">Mis Metas</h1>
                    <p className="text-xs text-muted-foreground">
                        {session.full_name} · Período {goals.currentPeriod}
                    </p>
                </div>
            </div>

            <div className="space-y-4 p-4">
                {goals.rules.length === 0 ? (
                    <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        <Target className="size-10 mx-auto mb-3 opacity-30" />
                        <p>No hay metas activas para este período.</p>
                    </div>
                ) : (
                    goals.rules.map((rule) => {
                        const isAchieved = achievedRuleIds.has(rule.id)
                        const progress =
                            rule.metric === 'haircut_count'
                                ? Math.min(goals.currentCuts, rule.threshold)
                                : 0
                        const progressPct = rule.threshold > 0 ? (progress / rule.threshold) * 100 : 0

                        return (
                            <div
                                key={rule.id}
                                className={`rounded-xl border p-5 space-y-3 ${isAchieved
                                        ? 'border-emerald-500/30 bg-emerald-500/5'
                                        : 'bg-card'
                                    }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`rounded-lg p-2 ${isAchieved ? 'bg-emerald-500/10' : 'bg-amber-500/10'
                                                }`}
                                        >
                                            {isAchieved ? (
                                                <Trophy className="size-5 text-emerald-400" />
                                            ) : (
                                                <Target className="size-5 text-amber-400" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="font-semibold">{rule.name}</p>
                                            {rule.description && (
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {rule.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-sm font-bold text-emerald-400">
                                        {formatCurrency(rule.reward_amount)}
                                    </span>
                                </div>

                                {rule.metric === 'haircut_count' && (
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">
                                                {progress} / {rule.threshold} cortes
                                            </span>
                                            {isAchieved ? (
                                                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                                                    <CheckCircle2 className="size-3.5" />
                                                    ¡Logrado!
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    {Math.round(progressPct)}%
                                                </span>
                                            )}
                                        </div>
                                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${isAchieved ? 'bg-emerald-500' : 'bg-amber-500'
                                                    }`}
                                                style={{ width: `${Math.min(progressPct, 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
