'use client'

// [Continuar a Mercado Pago]: pide la URL de autorización (crea el `state`
// de un uso) y sale a Mercado Pago. Si algo falla, lo dice acá mismo.

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { iniciarAutorizacionDesdeLink } from './acciones'

export function ContinuarAMercadoPago({ token, habilitado }: { token: string; habilitado: boolean }) {
  const [yendo, setYendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Volver con "atrás" desde Mercado Pago restaura la página del caché del
  // navegador con el botón todavía girando: se lo devuelve a su estado.
  useEffect(() => {
    const alMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) setYendo(false)
    }
    window.addEventListener('pageshow', alMostrar)
    return () => window.removeEventListener('pageshow', alMostrar)
  }, [])

  async function continuar() {
    setYendo(true)
    setError(null)
    try {
      const r = await iniciarAutorizacionDesdeLink(token)
      if (r.ok) {
        window.location.href = r.url
        return
      }
      setError(r.error)
    } catch {
      setError('No pudimos conectarnos. Revisá la conexión y probá de nuevo.')
    }
    setYendo(false)
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => void continuar()}
        disabled={!habilitado || yendo}
        className={cn(
          'flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-[15px] font-semibold text-white transition-colors',
          'hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500',
        )}
      >
        {yendo ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Abriendo Mercado Pago…
          </>
        ) : (
          <>
            Continuar a Mercado Pago
            <ArrowRight className="size-5" aria-hidden />
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
