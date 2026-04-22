import { listPlans } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'
import { PlansManager } from './plans-manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planes · Platform' }

export default async function PlansPage() {
  const plans = await listPlans()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Planes comerciales"
        description="Editá precios, límites y features de cada plan. Los cambios se reflejan en /pricing y en el gating sin deploy."
      />
      <PlansManager plans={plans} />
    </div>
  )
}
