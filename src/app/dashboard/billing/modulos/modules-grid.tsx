'use client'

import { useState, useTransition } from 'react'
import * as LucideIcons from 'lucide-react'
import { Sparkles, Check, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { activateModule, deactivateModule } from '@/lib/actions/billing'
import { ComingSoonDialog } from '@/components/billing/coming-soon-dialog'

type ModuleItem = {
  id: string
  name: string
  description: string | null
  icon: string | null
  status: 'active' | 'beta' | 'coming_soon' | 'hidden'
  teaser_copy: string | null
  estimated_release: string | null
  price_ars_addon: number | null
  unlocked: boolean
}

export function ModulesGrid({
  modules,
  enabledIds,
}: {
  modules: ModuleItem[]
  enabledIds: string[]
}) {
  const [isPending, startTransition] = useTransition()
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comingSoonTarget, setComingSoonTarget] = useState<ModuleItem | null>(null)

  const handleActivate = (mod: ModuleItem) => {
    if (mod.status === 'coming_soon') { setComingSoonTarget(mod); return }
    setError(null)
    setWorkingId(mod.id)
    startTransition(async () => {
      const action = enabledIds.includes(mod.id) ? deactivateModule : activateModule
      const res = await action(mod.id)
      if ('error' in res) setError(res.message ?? 'No pudimos procesar la acción')
      setWorkingId(null)
      window.location.reload()
    })
  }

  const formatArs = (cents: number) =>
    `AR$ ${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const Icon = (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[m.icon ?? 'Sparkles'] ?? Sparkles
          const isComingSoon = m.status === 'coming_soon'
          const enabled = enabledIds.includes(m.id)
          return (
            <div key={m.id} className="flex flex-col rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Icon className={isComingSoon ? 'size-5 shrink-0 text-amber-500' : 'size-5 shrink-0 text-primary'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium">{m.name}</h3>
                    {enabled && <Badge variant="secondary"><Check className="mr-1 size-3" /> Activo</Badge>}
                    {m.status === 'beta' && <Badge variant="outline">Beta</Badge>}
                    {isComingSoon && <Badge variant="outline" className="border-amber-500/50 text-amber-500"><Clock className="mr-1 size-3" /> Pronto</Badge>}
                  </div>
                  {m.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-end justify-between gap-2">
                {m.price_ars_addon != null && m.price_ars_addon > 0 ? (
                  <span className="text-sm">
                    <strong>{formatArs(m.price_ars_addon)}</strong>
                    <span className="text-muted-foreground">/mes</span>
                  </span>
                ) : <span />}
                <Button
                  size="sm"
                  variant={enabled ? 'outline' : isComingSoon ? 'outline' : 'default'}
                  onClick={() => handleActivate(m)}
                  disabled={isPending && workingId === m.id}
                >
                  {isPending && workingId === m.id ? (
                    <><Loader2 className="mr-1 size-3 animate-spin" />...</>
                  ) : isComingSoon ? (
                    'Avisarme'
                  ) : enabled ? (
                    'Desactivar'
                  ) : (
                    'Activar'
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {comingSoonTarget && (
        <ComingSoonDialog
          open={!!comingSoonTarget}
          onOpenChange={(open) => !open && setComingSoonTarget(null)}
          moduleId={comingSoonTarget.id}
          name={comingSoonTarget.name}
          teaserCopy={comingSoonTarget.teaser_copy}
          estimatedRelease={comingSoonTarget.estimated_release}
        />
      )}
    </>
  )
}
