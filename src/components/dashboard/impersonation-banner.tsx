'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { stopImpersonation } from '@/lib/actions/platform'

export function ImpersonationBanner({ orgName }: { orgName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function exit() {
    startTransition(async () => {
      await stopImpersonation()
      router.push('/platform')
    })
  }

  return (
    <div className="sticky top-0 z-50 border-b border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm text-amber-100">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <span>⚠️ Estás viendo el dashboard como admin de <strong>{orgName}</strong> (modo plataforma).</span>
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
