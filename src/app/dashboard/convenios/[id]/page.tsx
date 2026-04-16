import { getCurrentOrgId } from '@/lib/actions/org'
import { getBenefitById } from '@/lib/actions/agreements'
import { notFound, redirect } from 'next/navigation'
import { BenefitDetailClient } from '@/components/dashboard/agreements/benefit-detail-client'

export default async function BenefitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const { id } = await params
  const benefit = await getBenefitById(id)
  if (!benefit) notFound()

  return <BenefitDetailClient benefit={benefit as never} />
}
