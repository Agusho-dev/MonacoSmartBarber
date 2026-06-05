'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fmtRelative } from '../../_lib/fmt'
import { triggerProdeSync } from '@/lib/actions/prode'

export function SyncBar({ lastSyncAt }: { lastSyncAt: string | null }) {
  const [isPending, start] = useTransition()

  const onSync = () => {
    start(async () => {
      const r = await triggerProdeSync()
      if (r.error) toast.error(r.error)
      else
        toast.success(
          `Sincronizado: ${r.matches ?? 0} partidos, ${r.scored ?? 0} puntuados.`
        )
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Última actualización automática:{' '}
        <span className="font-medium text-foreground">{fmtRelative(lastSyncAt)}</span>
      </span>
      <Button variant="outline" size="sm" onClick={onSync} disabled={isPending} className="h-7 gap-1.5 text-xs">
        <RefreshCw className={isPending ? 'size-3.5 animate-spin' : 'size-3.5'} />
        Sincronizar ahora
      </Button>
    </div>
  )
}
