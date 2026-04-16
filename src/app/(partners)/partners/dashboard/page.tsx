import { listPartnerBenefits, listPartnerOrgs } from '@/lib/actions/partner-portal'
import { PartnerDashboardClient } from '@/components/partners/partner-dashboard-client'

export default async function PartnerDashboardPage() {
  const [benefits, orgs] = await Promise.all([listPartnerBenefits(), listPartnerOrgs()])
  return <PartnerDashboardClient benefits={benefits as never} orgs={orgs as never} />
}
