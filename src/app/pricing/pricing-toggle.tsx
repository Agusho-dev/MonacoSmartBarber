'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

export function PricingToggle({ isYearly }: { isYearly: boolean }) {
  return (
    <div className="inline-flex rounded-full border bg-background p-1 shadow-sm">
      <Link
        href="/pricing"
        prefetch={false}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
          !isYearly ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Mensual
      </Link>
      <Link
        href="/pricing?cycle=yearly"
        prefetch={false}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
          isYearly ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Anual
        <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
          −17%
        </span>
      </Link>
    </div>
  )
}
