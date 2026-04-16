import { redirect } from 'next/navigation'
import { getCurrentPartner } from '@/lib/partners/session'

export default async function PartnersRootPage() {
  const partner = await getCurrentPartner()
  if (partner) redirect('/partners/dashboard')
  redirect('/partners/login')
}
