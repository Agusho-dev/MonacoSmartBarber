import { getCurrentPartner } from '@/lib/partners/session'
import { redirect } from 'next/navigation'
import { PartnerLoginClient } from '@/components/partners/partner-login-client'

export default async function PartnerLoginPage() {
  const partner = await getCurrentPartner()
  if (partner) redirect('/partners/dashboard')
  return <PartnerLoginClient />
}
