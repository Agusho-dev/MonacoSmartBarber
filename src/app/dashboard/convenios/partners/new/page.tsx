import { getCurrentOrgId } from '@/lib/actions/org'
import { redirect } from 'next/navigation'
import { InvitePartnerClient } from '@/components/dashboard/agreements/invite-partner-client'

export default async function NewPartnerPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  return <InvitePartnerClient />
}
