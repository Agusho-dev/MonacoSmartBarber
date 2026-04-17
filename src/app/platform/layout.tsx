import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/actions/platform'

export const dynamic = 'force-dynamic'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin().catch(() => null)
  if (!admin) redirect('/login?reason=platform_unauthorized')

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/platform" className="text-lg font-semibold">
              BarberOS Platform
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-400">
              <Link href="/platform" className="hover:text-zinc-100">Organizaciones</Link>
              <Link href="/platform/actions" className="hover:text-zinc-100">Audit log</Link>
            </nav>
          </div>
          <div className="text-sm text-zinc-400">
            {admin.full_name ?? 'Admin'} · <span className="uppercase tracking-wider text-xs">{admin.role}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
