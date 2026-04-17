import { redirect } from 'next/navigation'
import { getCurrentPartner } from '@/lib/partners/session'
import { PartnerTopbar } from '@/components/partners/partner-topbar'

export const dynamic = 'force-dynamic'

export default async function PartnerDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const partner = await getCurrentPartner()
  if (!partner) redirect('/partners/login')

  return (
    <div className="min-h-screen">
      <PartnerTopbar
        partner={{
          id: partner.id,
          businessName: partner.business_name,
          logoUrl: partner.logo_url,
          contactEmail: partner.contact_email,
        }}
      />
      <main className="mx-auto max-w-6xl">{children}</main>
    </div>
  )
}
