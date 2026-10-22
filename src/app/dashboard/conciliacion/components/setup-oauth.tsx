'use client'

// "Cómo configurarla": lo que hay que hacer UNA vez para que los barberos
// puedan autorizar su cuenta con un link. La URL de redirección es la EXACTA que
// usa el servidor (la calcula page.tsx con la misma regla que el callback): si
// no coincide carácter por carácter con la cargada en Mercado Pago, la
// autorización falla. Es una aplicación SEPARADA de la de las señas.

import { useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { copiarTexto } from './llamar'
import { useOrigen } from './use-pantalla'

export function SetupOAuth({ urlRedireccion, abiertoInicial = false }: { urlRedireccion: string; abiertoInicial?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  const [copiado, setCopiado] = useState<string | null>(null)
  const origen = useOrigen()
  let dominioDistinto = false
  try {
    dominioDistinto = origen != null && new URL(urlRedireccion).origin !== origen
  } catch {
    dominioDistinto = false
  }

  async function copiar(texto: string) {
    if (await copiarTexto(texto)) {
      setCopiado(texto)
      toast.success('Copiado.')
      window.setTimeout(() => setCopiado((c) => (c === texto ? null : c)), 2000)
    } else {
      toast.error('No se pudo copiar: seleccioná el texto y copialo a mano.')
    }
  }

  return (
    <div className="rounded-lg border border-white/10">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm text-zinc-200"
      >
        Cómo configurarla
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', abierto && 'rotate-180')} aria-hidden />
      </button>
      {abierto && (
        <div className="space-y-3 border-t border-white/10 px-3 pt-3 pb-3.5 text-xs leading-relaxed text-zinc-300">
          <ol className="list-decimal space-y-2.5 pl-4">
            <li>
              En Mercado Pago Developers, entrá a <em>Tus integraciones</em> y creá una aplicación nueva para la conciliación (no uses la de
              las señas).
            </li>
            <li className="space-y-1.5">
              <p>En «URL de redirección» pegá exactamente esta:</p>
              <Copiable texto={urlRedireccion} copiado={copiado === urlRedireccion} onCopiar={copiar} />
            </li>
            <li className="space-y-1.5">
              <p>En Vercel, cargá estas dos variables con las credenciales de esa aplicación y volvé a desplegar:</p>
              <Copiable texto="MP_CONCILIACION_CLIENT_ID" copiado={copiado === 'MP_CONCILIACION_CLIENT_ID'} onCopiar={copiar} />
              <Copiable texto="MP_CONCILIACION_CLIENT_SECRET" copiado={copiado === 'MP_CONCILIACION_CLIENT_SECRET'} onCopiar={copiar} />
            </li>
          </ol>
          {dominioDistinto && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2 text-amber-200">
              Estás en {origen}. La URL de redirección tiene que ser la del dominio público de producción (la de arriba), no la de este
              navegador.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Copiable({ texto, copiado, onCopiar }: { texto: string; copiado: boolean; onCopiar: (t: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/30 py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 font-mono text-[11px] break-all text-zinc-100 select-all">{texto}</code>
      <button
        type="button"
        onClick={() => onCopiar(texto)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
        aria-label={`Copiar ${texto}`}
      >
        {copiado ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
