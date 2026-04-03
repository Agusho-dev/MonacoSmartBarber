'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface MobileBottomNavProps {
  orderedItems: NavItem[]
  currentIndex: number
}

export function MobileBottomNav({ orderedItems, currentIndex }: MobileBottomNavProps) {
  const router = useRouter()
  const total = orderedItems.length
  const currentItem = orderedItems[currentIndex]

  const maxDots = 7

  function getVisibleDots() {
    if (total <= maxDots) return orderedItems.map((_, i) => i)
    const half = Math.floor(maxDots / 2)
    let start = Math.max(0, currentIndex - half)
    const end = Math.min(total - 1, start + maxDots - 1)
    if (end - start < maxDots - 1) start = Math.max(0, end - maxDots + 1)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }

  const visibleDotIndices = getVisibleDots()

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border">
      <div className="flex items-center justify-between px-3 py-1.5" style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}>
        <button
          onClick={() => currentIndex > 0 && router.push(orderedItems[currentIndex - 1].href)}
          disabled={currentIndex === 0}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-full transition-all',
            currentIndex === 0
              ? 'text-muted-foreground/30 cursor-not-allowed'
              : 'text-foreground hover:bg-muted active:scale-90'
          )}
          aria-label="Sección anterior"
        >
          <ChevronLeft className="size-5" />
        </button>

        <div className="flex flex-col items-center gap-1.5 flex-1 px-2">
          <span className="text-xs font-medium text-foreground/70 truncate max-w-[160px]">
            {currentItem?.label ?? ''}
          </span>
          <div className="flex items-center gap-1">
            {visibleDotIndices.map((dotIndex) => (
              <button
                key={dotIndex}
                onClick={() => router.push(orderedItems[dotIndex].href)}
                className={cn(
                  'rounded-full transition-all duration-200',
                  dotIndex === currentIndex
                    ? 'w-4 h-1.5 bg-foreground'
                    : 'w-1.5 h-1.5 bg-foreground/25 hover:bg-foreground/50'
                )}
                aria-label={`Ir a ${orderedItems[dotIndex].label}`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={() => currentIndex < total - 1 && router.push(orderedItems[currentIndex + 1].href)}
          disabled={currentIndex === total - 1}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-full transition-all',
            currentIndex === total - 1
              ? 'text-muted-foreground/30 cursor-not-allowed'
              : 'text-foreground hover:bg-muted active:scale-90'
          )}
          aria-label="Siguiente sección"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  )
}
