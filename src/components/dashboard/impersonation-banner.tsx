'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { stopImpersonation } from '@/lib/actions/platform'
import { useHayPantallaInmersiva } from './pantalla-inmersiva'

export function ImpersonationBanner({ orgName }: { orgName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // z-40, como el del plan de prueba: una capa de Mensajería en el celular
  // (fixed, z-41) lo tiene que tapar. En z-50 quedaba encima y tapaba el «‹» de
  // la capa. Tapado queda inerte, como el encabezado y la barra.
  const tapado = useHayPantallaInmersiva()

  function exit() {
    startTransition(async () => {
      await stopImpersonation()
      router.push('/platform')
    })
  }

  return (
    <div
      inert={tapado}
      aria-hidden={tapado || undefined}
      className="sticky top-0 z-40 border-b border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <span className="flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span>Estás viendo el dashboard como admin de <strong>{orgName}</strong> (modo plataforma).</span>
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={pending}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
        >
          {pending ? 'Saliendo…' : 'Salir del modo plataforma'}
        </button>
      </div>
    </div>
  )
}
