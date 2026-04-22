import { listModules } from '@/lib/actions/platform-billing'
import { listPlans } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'
import { ModulesManager } from './modules-manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Módulos · Platform' }

export default async function ModulesPage() {
  const [modules, plans] = await Promise.all([listModules(), listPlans()])
  const planIds = plans.map(p => p.id)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Módulos"
        description="Gestioná features del catálogo. Cambiá visibilidad (active, beta, coming_soon, hidden) y controlá qué plan los incluye."
      />
      <ModulesManager modules={modules} planIds={planIds} />
    </div>
  )
}
