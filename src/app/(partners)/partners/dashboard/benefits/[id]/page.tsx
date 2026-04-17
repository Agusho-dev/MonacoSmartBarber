import { notFound } from 'next/navigation'
import { getCurrentPartner } from '@/lib/partners/session'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PartnerBenefitDetailClient } from '@/components/partners/partner-benefit-detail-client'
import { listPartnerOrgs } from '@/lib/actions/partner-portal'

export default async function PartnerBenefitDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const partner = await getCurrentPartner()
  if (!partner) redirect('/partners/login')

  const { id } = await params
  const supabase = createAdminClient()
  const { data: benefit } = await supabase
    .from('partner_benefits')
    .select('*, organization:organizations(id, name, logo_url)')
    .eq('id', id)
    .eq('partner_id', partner.id)
    .maybeSingle()

  if (!benefit) notFound()

  const orgs = await listPartnerOrgs()
  const activeOrgs = (orgs as unknown as Array<{ status: string; organization: { id: string; name: string; logo_url: string | null } | null }>)
    .filter((o) => o.status === 'active' && o.organization)
    .map((o) => o.organization!)

  return <PartnerBenefitDetailClient benefit={benefit as never} orgs={activeOrgs} />
}
