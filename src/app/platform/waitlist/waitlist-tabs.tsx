'use client'

import { Children, isValidElement, useState, type ReactNode } from 'react'
import { Package, UserRound } from 'lucide-react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export type WaitlistTab = 'landing' | 'modules'

export function WaitlistTabs({
  initial,
  landingCount,
  modulesCount,
  children,
}: {
  initial: WaitlistTab
  landingCount: number
  modulesCount: number
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<WaitlistTab>(initial)

  const change = (next: WaitlistTab) => {
    if (next === tab) return
    setTab(next)
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    sp.set('tab', next)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  const panels = Children.toArray(children).filter(isValidElement) as Array<
    React.ReactElement<{ 'data-tab'?: string }>
  >
  const active = panels.find(p => p.props['data-tab'] === tab)

  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
        <TabButton
          active={tab === 'landing'}
          onClick={() => change('landing')}
          icon={<UserRound className="size-3.5" />}
          label="Leads del landing"
          count={landingCount}
        />
        <TabButton
          active={tab === 'modules'}
          onClick={() => change('modules')}
          icon={<Package className="size-3.5" />}
          label="Módulos coming_soon"
          count={modulesCount}
        />
      </div>
      {active}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-zinc-100 text-zinc-900 shadow-sm'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 text-[10px] font-semibold tabular-nums',
          active ? 'bg-zinc-900/10 text-zinc-700' : 'bg-zinc-800/80 text-zinc-400'
        )}
      >
        {count}
      </span>
    </button>
  )
}
