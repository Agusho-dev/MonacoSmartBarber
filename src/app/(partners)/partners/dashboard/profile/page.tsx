import { getCurrentPartner } from '@/lib/partners/session'
import { redirect } from 'next/navigation'
import { PartnerProfileClient } from '@/components/partners/partner-profile-client'

export default async function PartnerProfilePage() {
  const partner = await getCurrentPartner()
  if (!partner) redirect('/partners/login')
  return <PartnerProfileClient partner={partner} />
}
