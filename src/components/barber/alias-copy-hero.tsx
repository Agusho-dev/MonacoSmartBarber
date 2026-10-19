'use client'

import { Fragment, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { vibrate, playSuccessBeep } from '@/lib/barber-feedback'

interface AliasCopyHeroProps {
  /** Alias / CBU a mostrar y copiar. */
  alias: string
  /** Nombre del titular de la cuenta. */
  accountName?: string
  /** Monto a cobrar (se muestra debajo del alias). */
  amountText?: string
}

/**
 * Un alias largo se parte en los puntos y nunca con un guion: con
 * `hyphens-auto` "un.alias.largo" se leía "un.alias.lar-go", y un guion que el
 * cliente tipea a mano es otro alias (o ninguno). Si un tramo igual no entra
 * (un CBU de 22 dígitos), se corta donde haga falta, sin guion.
 */
function partirEnLosPuntos(alias: string) {
  const tramos = alias.split('.')
  return tramos.map((tramo, i) => (
    <Fragment key={i}>
      {tramo}
      {i < tramos.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </Fragment>
  ))
}

/**
 * El alias para transferir, como un ticket del reloj: cartulina con filete
 * punteado —en el panel, punteado es "todavía no se marcó": la plata no
 * entró— y el alias grande, para dictarlo o para que el cliente lo lea desde
 * la silla. Debajo del troquel, el monto en cifras de medir. Copiar, de un toque.
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
    <section
      aria-label="Alias para transferir"
      className="rounded-[1.5rem] border-2 border-dashed border-foreground/25 bg-card px-5 pb-5 pt-4 text-center"
    >
      <p className="text-[0.9375rem] text-muted-foreground">
        Dictale este alias
        {accountName && (
          <>
            {' · '}
            <span className="font-semibold text-foreground">{accountName}</span>
          </>
        )}
      </p>

      <p
        className="mt-2 select-all text-[clamp(1.75rem,7vw,3rem)] font-bold leading-[1.08] tracking-[-0.02em] hyphens-none [overflow-wrap:anywhere]"
        aria-label={`Alias: ${alias}`}
      >
        {alias ? partirEnLosPuntos(alias) : '—'}
      </p>

      {amountText && (
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t-2 border-dashed border-foreground/15 pt-3 text-left">
          <span className="text-[0.9375rem] text-muted-foreground">Monto a transferir</span>
          <span className="font-mono text-xl font-semibold tabular-nums">{amountText}</span>
        </div>
      )}

      <Button
        type="button"
        size="lg"
        onClick={handleCopy}
        className={cn(
          'mt-4 h-14 w-full rounded-2xl text-lg font-bold [&_svg]:size-5',
          copied && 'bg-emerald-600 text-white hover:bg-emerald-700',
        )}
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check />
            Copiado
          </>
        ) : (
          <>
            <Copy />
            Copiar alias
          </>
        )}
      </Button>
    </section>
  )
}
