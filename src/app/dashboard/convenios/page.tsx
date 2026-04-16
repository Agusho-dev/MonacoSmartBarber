import { getCurrentOrgId } from '@/lib/actions/org'
import { listOrgBenefits, getOrgBenefitsStats } from '@/lib/actions/agreements'
import { listOrgPartners } from '@/lib/actions/partners'
import { redirect } from 'next/navigation'
import { ConveniosClient } from '@/components/dashboard/agreements/convenios-client'

export default async function ConveniosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const [benefits, partners, stats] = await Promise.all([
    listOrgBenefits('all'),
    listOrgPartners(),
    getOrgBenefitsStats(),
  ])

  return (
    <ConveniosClient
      benefits={benefits as never}
      partners={partners as never}
      stats={stats}
    />
  )
}
