import { getActiveOrganization } from "@/lib/actions/org"
import { OrgHomePage } from "@/components/home/org-home"
import { TenantSelector } from "@/components/home/tenant-selector"

export default async function HomePage() {
  const org = await getActiveOrganization()

  if (org) {
    return <OrgHomePage organization={org} />
  }

  return <TenantSelector />
}
