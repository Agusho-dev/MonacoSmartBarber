import { listPartnerOrgs } from '@/lib/actions/partner-portal'
import { redirect } from 'next/navigation'
import { BenefitFormClient } from '@/components/partners/benefit-form-client'

export default async function NewBenefitPage() {
  const orgs = await listPartnerOrgs()
  const activeOrgs = (orgs as unknown as Array<{ status: string; organization: { id: string; name: string; logo_url: string | null } | null }>)
    .filter((o) => o.status === 'active' && o.organization)
    .map((o) => o.organization!)

  if (activeOrgs.length === 0) {
    redirect('/partners/dashboard')
  }

  return <BenefitFormClient mode="create" orgs={activeOrgs} />
}
