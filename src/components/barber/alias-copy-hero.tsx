'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { vibrate, playSuccessBeep } from '@/lib/barber-feedback'

interface AliasCopyHeroProps {
  /** Alias / CBU a mostrar y copiar. */
  alias: string
  /** Nombre del titular de la cuenta. */
  accountName?: string
  /** Monto a cobrar (se muestra arriba del alias). */
  amountText?: string
}

/**
 * Hero gigante con el ALIAS para transferencias. Una sola ojeada, copiar con
 * un tap. Diseñado para que el cliente pueda verlo desde el otro lado del
 * mostrador.
 */
export function AliasCopyHero({
  alias,
  accountName,
  amountText,
}: AliasCopyHeroProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2400)
    return () => clearTimeout(id)
  }, [copied])

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(alias)
      } else {
        // Fallback antiguo
        const ta = document.createElement('textarea')
        ta.value = alias
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      vibrate([20, 40, 20])
      playSuccessBeep()
    } catch {
      // noop — el usuario puede copiar manualmente
    }
  }

  return (
    <div
      className={cn(
        'alias-hero relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-7 text-center',
        'shadow-[0_20px_60px_-20px_oklch(0.78_0.12_85/0.4)]',
      )}
    >
      <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-black/55">
        <Wallet className="size-3 sm:size-3.5" />
        Dictale este alias
      </div>

      {accountName && (
        <p className="mt-1 text-xs sm:text-sm font-semibold text-black/70">
          {accountName}
        </p>
      )}

      <p
        className={cn(
          'mt-3 sm:mt-4 font-black tracking-tight text-black',
          'text-[clamp(22px,7vw,48px)] leading-[1.05]',
          'select-all break-words hyphens-auto',
        )}
        style={{ wordBreak: 'break-word' }}
        aria-label={`Alias: ${alias}`}
      >
        {alias || '—'}
      </p>

      {amountText && (
        <p className="mt-2 sm:mt-3 text-sm sm:text-base font-semibold text-black/70">
          Monto: <span className="font-black text-black tabular-nums">{amountText}</span>
        </p>
      )}

      <Button
        type="button"
        size="lg"
        onClick={handleCopy}
        className={cn(
          'mt-4 h-14 sm:h-16 w-full text-base sm:text-lg font-black uppercase tracking-wider border-0',
          'shadow-lg transition-all',
          copied
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
            : 'bg-black text-white hover:bg-black/90',
        )}
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check className="mr-2 size-5 sm:size-6 shrink-0" />
            ¡Copiado!
          </>
        ) : (
          <>
            <Copy className="mr-2 size-5 sm:size-6 shrink-0" />
            Copiar alias
          </>
        )}
      </Button>
    </div>
  )
}
