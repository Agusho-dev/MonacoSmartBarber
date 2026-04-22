import { redirect } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/actions/platform'
import { PlatformSidebar } from '@/components/platform/platform-sidebar'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Platform · BarberOS' }

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin().catch(() => null)
  if (!admin) redirect('/login?reason=platform_unauthorized')

  return (
    <div className="relative flex min-h-screen bg-zinc-950 text-zinc-100">
      <PlatformSidebar
        adminName={admin.full_name ?? 'Admin'}
        adminRole={admin.role}
      />
      <main className="flex-1 lg:ml-60 min-h-screen">
        <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
