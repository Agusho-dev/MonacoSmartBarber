import Link from 'next/link'
import { Lock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Props = {
  featureName: string
  description?: string
  minPlan?: 'start' | 'pro' | 'enterprise'
}

const PLAN_LABEL: Record<string, string> = {
  start: 'Start',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

/**
 * Wrapper server-side para páginas completas bloqueadas por plan.
 * Se usa en pages de /dashboard/* cuando la feature no está incluída.
 */
export function LockedFeatureCard({
  featureName,
  description,
  minPlan = 'pro',
}: Props) {
  const planLabel = PLAN_LABEL[minPlan] ?? 'Pro'
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-dashed bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="size-7 text-primary" />
        </div>
        <Badge variant="secondary" className="mb-3">Plan {planLabel}</Badge>
        <h2 className="mb-2 text-xl font-semibold">{featureName}</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {description ?? `Esta sección está disponible a partir del plan ${planLabel}. Actualizá para acceder.`}
        </p>
        <Button asChild className="w-full">
          <Link href={`/dashboard/billing?target=${minPlan}`}>
            Actualizar a {planLabel}
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
