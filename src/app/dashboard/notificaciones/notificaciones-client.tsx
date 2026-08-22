'use client'

// =============================================================================
// /dashboard/notificaciones — orquestador. Tres pestañas: Campañas (push a
// medida a una audiencia), Automáticas (recordatorios, cancelaciones, premios)
// y Dispositivos (quién tiene la app). Las mutaciones viven en
// `src/lib/actions/push-notifications.ts`.
// =============================================================================

import { useCallback, useState, useTransition } from 'react'
import { BellRing, Loader2, Plus, RefreshCw, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  getPushOverview, listPushCampaigns,
  type PushCampaignRow, type PushEnvioResultado, type PushOverview, type PushSettingsData,
} from '@/lib/actions/push-notifications'
import type { AudienceBranch, AudienceTag } from './audience-filters'
import { CampaignSheet, type CampaignPrefill } from './campaign-sheet'
import { CampaniasPanel } from './campanias-panel'
import { AutomaticasPanel } from './automaticas-panel'
import { DispositivosPanel } from './dispositivos-panel'

interface Props {
  canManage: boolean
  timezone: string
  org: { name: string; logoUrl: string | null }
  branches: AudienceBranch[]
  tags: AudienceTag[]
  initialCampaigns: PushCampaignRow[]
  campaignsError: string | null
  initialOverview: PushOverview
  initialSettings: PushSettingsData
  settingsError: string | null
  /**
   * Dentro de `/dashboard/app-movil` (pestaña Notificaciones): sin título
   * propio ni padding de página — el encabezado ya lo pone App Móvil. Es la
   * única forma en que se usa hoy; `/dashboard/notificaciones` redirige ahí.
   */
  embedded?: boolean
}

type Pestania = 'campanias' | 'automaticas' | 'dispositivos'

export function NotificacionesClient({
  canManage, timezone, org, branches, tags,
  initialCampaigns, campaignsError, initialOverview, initialSettings, settingsError,
  embedded = false,
}: Props) {
  const [pestania, setPestania] = useState<Pestania>('campanias')
  const [campaigns, setCampaigns] = useState<PushCampaignRow[]>(initialCampaigns)
  const [campaignsErr, setCampaignsErr] = useState<string | null>(campaignsError)
  const [overview, setOverview] = useState<PushOverview>(initialOverview)
  const [refrescando, startRefresh] = useTransition()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetKey, setSheetKey] = useState(0)
  const [prefill, setPrefill] = useState<CampaignPrefill | null>(null)

  const refrescar = useCallback(() => {
    startRefresh(async () => {
      const [c, o] = await Promise.all([listPushCampaigns(), getPushOverview()])
      setCampaigns(c.data)
      setCampaignsErr(c.error)
      setOverview(o)
      if (c.error || o.error) toast.error(c.error ?? o.error ?? 'No pudimos actualizar')
    })
  }, [])

  const abrirNueva = (pre?: CampaignPrefill | null) => {
    setPrefill(pre ?? null)
    setSheetKey(k => k + 1) // remonta la hoja: estado limpio o con el prefill
    setSheetOpen(true)
  }

  const onCreated = (c: PushCampaignRow, envio: PushEnvioResultado | null) => {
    setCampaigns(prev => [c, ...prev])
    if (envio) {
      setOverview(o => ({
        ...o,
        campaigns: {
          ...o.campaigns,
          total: o.campaigns.total + 1,
          scheduled: o.campaigns.scheduled + (envio.estado === 'scheduled' ? 1 : 0),
        },
        outboxPending: o.outboxPending + envio.encolados,
      }))
    } else {
      setOverview(o => ({ ...o, campaigns: { ...o.campaigns, total: o.campaigns.total + 1 } }))
    }
  }

  const onChanged = (c: PushCampaignRow) => {
    setCampaigns(prev => prev.map(x => (x.id === c.id ? c : x)))
    // Los contadores finos los trae el próximo refresh; acá sólo lo evidente.
    refrescar()
  }

  const onDeleted = (id: string) => {
    setCampaigns(prev => prev.filter(x => x.id !== id))
    setOverview(o => ({ ...o, campaigns: { ...o.campaigns, total: Math.max(0, o.campaigns.total - 1) } }))
  }

  const PESTANIAS: { id: Pestania; etiqueta: string; badge?: number }[] = [
    { id: 'campanias', etiqueta: 'Campañas', badge: campaigns.length || undefined },
    { id: 'automaticas', etiqueta: 'Automáticas' },
    { id: 'dispositivos', etiqueta: 'Dispositivos', badge: overview.clientsWithApp || undefined },
  ]

  return (
    <div className={embedded ? 'w-full space-y-6' : 'mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6'}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {embedded ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <BellRing className="size-4" />
              Mandá avisos push a la app de tus clientes y configurá los que salen solos.
            </p>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <BellRing className="size-6 text-muted-foreground" />
                Notificaciones
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Mandá avisos push a la app de tus clientes y configurá los que salen solos.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Smartphone className="size-3.5" />
            {overview.clientsWithApp.toLocaleString('es-AR')} {overview.clientsWithApp === 1 ? 'cliente con la app' : 'clientes con la app'}
          </span>
          <Button variant="outline" size="sm" onClick={refrescar} disabled={refrescando}>
            {refrescando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Actualizar
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => abrirNueva()}>
              <Plus className="size-4" /> Nueva campaña
            </Button>
          )}
        </div>
      </header>

      {/* Pestañas tipo pill con borde inferior: el patrón del resto del dashboard. */}
      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Secciones de notificaciones">
        {PESTANIAS.map(p => {
          const activa = pestania === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestania(p.id)}
              aria-current={activa ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                activa ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.etiqueta}
              {p.badge != null && <span className="ml-1.5 text-xs text-muted-foreground">{p.badge.toLocaleString('es-AR')}</span>}
            </button>
          )
        })}
      </nav>

      {pestania === 'campanias' && (
        <CampaniasPanel
          campaigns={campaigns}
          error={campaignsErr}
          overview={overview}
          canManage={canManage}
          timezone={timezone}
          branches={branches}
          tags={tags}
          onNueva={() => abrirNueva()}
          onDuplicar={c => abrirNueva({
            name: `${c.name} (copia)`,
            title: c.title,
            body: c.body,
            imageUrl: c.image_url,
            deepLink: c.deep_link,
            audienceFilters: c.audience_filters,
          })}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      )}

      {pestania === 'automaticas' && (
        <AutomaticasPanel initial={initialSettings} error={settingsError} canManage={canManage} org={org} />
      )}

      {pestania === 'dispositivos' && (
        <DispositivosPanel overview={overview} timezone={timezone} />
      )}

      {canManage && (
        <CampaignSheet
          key={sheetKey}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          timezone={timezone}
          org={org}
          branches={branches}
          tags={tags}
          prefill={prefill}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}
