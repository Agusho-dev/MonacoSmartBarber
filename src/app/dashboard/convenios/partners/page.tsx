import { getCurrentOrgId } from '@/lib/actions/org'
import { listOrgPartners } from '@/lib/actions/partners'
import { redirect } from 'next/navigation'
import { PartnersClient } from '@/components/dashboard/agreements/partners-client'

export default async function PartnersPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const partners = await listOrgPartners()

  return <PartnersClient partners={partners as never} />
}
