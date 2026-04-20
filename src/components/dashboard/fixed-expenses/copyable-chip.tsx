'use client'

import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface CopyableChipProps {
    label: string
    value: string
    className?: string
}

/**
 * Chip compacto con el patrón "tap para copiar" del repo (ver alias-copy-hero).
 * Optimizado para tablets en la barbería: target táctil generoso, feedback
 * instantáneo (icon swap + toast + vibrate), accesibilidad via aria-live.
 */
export function CopyableChip({ label, value, className }: CopyableChipProps) {
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!copied) return
        const id = setTimeout(() => setCopied(false), 2000)
        return () => clearTimeout(id)
    }, [copied])

    const handleCopy = async () => {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(value)
            } else {
                const ta = document.createElement('textarea')
                ta.value = value
                document.body.appendChild(ta)
                ta.select()
                document.execCommand('copy')
                document.body.removeChild(ta)
            }
            setCopied(true)
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(20)
            }
            toast.success(`${label} copiado`, { duration: 1800 })
        } catch {
            toast.error('No se pudo copiar')
        }
    }

    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label={`Copiar ${label}: ${value}`}
            className={cn(
                'group relative w-full text-left rounded-lg border bg-muted/40 px-3 py-2.5 transition-all',
                'hover:bg-muted hover:border-foreground/20 active:scale-[0.98]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                copied && 'border-emerald-500/40 bg-emerald-500/10',
                className,
            )}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className={cn(
                        'text-[10px] font-medium uppercase tracking-wider transition-colors',
                        copied ? 'text-emerald-500' : 'text-muted-foreground',
                    )}>
                        {label}
                    </div>
                    <div className={cn(
                        'mt-0.5 font-mono text-sm font-semibold truncate transition-colors',
                        copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
                    )}>
                        {value}
                    </div>
                </div>
                <div className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md transition-all',
                    copied
                        ? 'bg-emerald-500 text-white scale-110'
                        : 'bg-background text-muted-foreground group-hover:text-foreground group-hover:scale-105',
                )}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </div>
            </div>
            <span className="sr-only" aria-live="polite">
                {copied ? `${label} copiado al portapapeles` : ''}
            </span>
        </button>
    )
}
