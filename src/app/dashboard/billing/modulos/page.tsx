import { redirect } from 'next/navigation'
import * as LucideIcons from 'lucide-react'
import { Sparkles } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getEntitlements } from '@/lib/actions/entitlements'
import { Badge } from '@/components/ui/badge'
import { ModulesGrid } from './modules-grid'

export const dynamic = 'force-dynamic'

export default async function ModulesPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const ent = await getEntitlements(orgId)
  if (!ent) redirect('/dashboard/billing')

  const availableAddons = ent.visibleModules.filter(
    (m) => m.price_ars_addon != null && m.price_ars_addon > 0,
  )
  const included = ent.visibleModules.filter(
    (m) => m.unlocked && (m.price_ars_addon == null || m.price_ars_addon === 0),
  )
  const comingSoon = ent.visibleModules.filter((m) => m.status === 'coming_soon')

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold">Módulos y add-ons</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Activá funciones adicionales para tu plan {ent.plan.name}.
        </p>
      </div>

      {/* Add-ons pagables */}
      {availableAddons.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Add-ons disponibles
          </h2>
          <ModulesGrid
            modules={availableAddons.map(m => ({
              id: m.id,
              name: m.name,
              description: m.description,
              icon: m.icon,
              status: m.status,
              teaser_copy: m.teaser_copy,
              estimated_release: m.estimated_release,
              price_ars_addon: m.price_ars_addon,
              unlocked: ent.enabledModuleIds.includes(m.id),
            }))}
            enabledIds={ent.enabledModuleIds}
          />
        </section>
      )}

      {/* Incluidos en el plan */}
      {included.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Incluidos en tu plan
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {included.map((m) => {
              const Icon = (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[m.icon ?? 'Sparkles'] ?? Sparkles
              return (
                <div key={m.id} className="flex items-start gap-3 rounded-lg border bg-card p-4">
                  <Icon className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{m.name}</h3>
                      {m.status === 'beta' && <Badge variant="outline" className="text-[10px]">Beta</Badge>}
                    </div>
                    {m.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{m.description}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Coming soon */}
      {comingSoon.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Próximamente
          </h2>
          <ModulesGrid
            modules={comingSoon.map(m => ({
              id: m.id,
              name: m.name,
              description: m.description,
              icon: m.icon,
              status: m.status,
              teaser_copy: m.teaser_copy,
              estimated_release: m.estimated_release,
              price_ars_addon: m.price_ars_addon,
              unlocked: false,
            }))}
            enabledIds={ent.enabledModuleIds}
          />
        </section>
      )}
    </div>
  )
}
