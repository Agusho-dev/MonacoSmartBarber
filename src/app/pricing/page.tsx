import Link from 'next/link'
import { Check, Sparkles, Crown } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PricingToggle } from './pricing-toggle'

export const dynamic = 'force-dynamic'

type PlanRow = {
  id: string
  name: string
  tagline: string | null
  price_ars_monthly: number
  price_ars_yearly: number
  trial_days: number
  features: Record<string, boolean>
  limits: Record<string, number>
  is_public: boolean
  sort_order: number
}

type ModuleRow = {
  id: string
  name: string
  description: string | null
  included_in_plans: string[]
  feature_key: string
  status: 'active' | 'beta' | 'coming_soon' | 'hidden'
}

function formatArs(centavos: number): string {
  return `AR$ ${(centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>
}) {
  const supabase = createAdminClient()
  const { cycle } = await searchParams
  const isYearly = cycle === 'yearly'

  const [{ data: plans }, { data: modules }] = await Promise.all([
    supabase
      .from('plans')
      .select('*')
      .eq('is_public', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('modules')
      .select('id, name, description, included_in_plans, feature_key, status')
      .neq('status', 'hidden')
      .order('sort_order', { ascending: true }),
  ])

  const visiblePlans = (plans ?? []) as PlanRow[]
  const visibleModules = (modules ?? []) as ModuleRow[]

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-background via-background to-primary/5 py-12 lg:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="size-3" />
            14 días de prueba gratis
          </span>
          <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Un plan para cada etapa de tu barbería
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Sin tarjeta durante el trial. Cambiá, subí o bajá tu plan cuando quieras.
          </p>
        </div>

        <div className="mt-10 flex justify-center">
          <PricingToggle isYearly={isYearly} />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {visiblePlans.map((plan, i) => {
            const isFeatured = plan.id === 'pro'
            const price = isYearly ? plan.price_ars_yearly : plan.price_ars_monthly
            const perMonthLabel = isYearly
              ? `${formatArs(Math.round(plan.price_ars_yearly / 12))}/mes`
              : `${formatArs(price)}/mes`
            const planModules = visibleModules.filter(m => m.included_in_plans.includes(plan.id))

            return (
              <div
                key={plan.id}
                className={[
                  'relative flex flex-col rounded-2xl border p-6 shadow-sm',
                  isFeatured
                    ? 'border-primary bg-card shadow-lg ring-1 ring-primary'
                    : 'border-border bg-card',
                ].join(' ')}
              >
                {isFeatured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Más popular
                  </span>
                )}

                <div className="flex items-center gap-2">
                  {plan.id === 'enterprise' ? (
                    <Crown className="size-5 text-amber-500" />
                  ) : plan.id === 'pro' ? (
                    <Sparkles className="size-5 text-primary" />
                  ) : null}
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                </div>
                {plan.tagline && <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>}

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">{perMonthLabel.split('/')[0]}</span>
                  <span className="text-sm text-muted-foreground">/mes</span>
                </div>
                {isYearly && price > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Facturado anual: {formatArs(price)}
                  </p>
                )}

                <Button
                  asChild
                  className="mt-6 w-full"
                  variant={isFeatured ? 'default' : 'outline'}
                >
                  <Link href={`/register?plan=${plan.id}&cycle=${isYearly ? 'yearly' : 'monthly'}`}>
                    Empezar {plan.trial_days > 0 ? `con ${plan.trial_days} días gratis` : 'ahora'}
                  </Link>
                </Button>

                <ul className="mt-6 space-y-2 text-sm">
                  <PlanLimitRow label="Sucursales" value={plan.limits.branches} />
                  <PlanLimitRow label="Empleados" value={plan.limits.staff} />
                  <PlanLimitRow label="Clientes" value={plan.limits.clients} />
                  <PlanLimitRow label="Broadcasts mensuales" value={plan.limits.broadcasts_monthly} hideIfZero />
                  {planModules.slice(0, 12).map((m) => (
                    <li key={m.id} className="flex items-start gap-2 text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                      <span>
                        {m.name}
                        {m.status === 'beta' && (
                          <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-500">BETA</span>
                        )}
                        {m.status === 'coming_soon' && (
                          <span className="ml-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">Pronto</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Sort anchor — ayuda al orden visual */}
                <span className="sr-only">{i}</span>
              </div>
            )
          })}
        </div>

        <div className="mt-16 rounded-2xl border bg-card p-8 text-center">
          <h3 className="text-xl font-semibold">¿Más de 10 sucursales?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Contactanos para armar un plan a medida con descuentos por volumen, onboarding dedicado y SLA.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="mailto:hola@monacosmartbarber.com?subject=Plan%20cadena">Escribinos</Link>
          </Button>
        </div>

        <div className="mt-12 text-center text-xs text-muted-foreground">
          Precios en Pesos Argentinos. IVA no incluido.
          <br />
          Podés cancelar tu suscripción cuando quieras. No te cobramos si seguís usando el plan Free.
        </div>
      </div>
    </div>
  )
}

function PlanLimitRow({ label, value, hideIfZero }: { label: string; value: number; hideIfZero?: boolean }) {
  if (value === 0 && hideIfZero) return null
  const display = value === -1 ? 'Ilimitado' : value.toLocaleString('es-AR')
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      <span>
        <strong className="font-medium text-foreground">{display}</strong>{' '}
        <span className="text-muted-foreground">{label.toLowerCase()}</span>
      </span>
    </li>
  )
}
