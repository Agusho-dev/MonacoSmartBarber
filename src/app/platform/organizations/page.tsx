import { listOrganizationsForPlatform } from '@/lib/actions/platform'
import { PageHeader } from '@/components/platform/page-header'
import { OrganizationsTable } from './organizations-table'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Organizaciones · Platform' }

export default async function OrganizationsPage() {
  const orgs = await listOrganizationsForPlatform()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizaciones"
        description={`${orgs.length} cuentas en total.`}
      />
      <OrganizationsTable orgs={orgs} />
    </div>
  )
}
