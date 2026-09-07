'use client'

// =============================================================================
// src/app/dashboard/fidelizacion/fidelizacion-client.tsx
// Orquestador del módulo de fidelización: sub-navegación pegajosa con ?tab= y
// el estado compartido (settings, categorías, premios, reglas) que las
// pestañas van actualizando cuando guardan, para no recargar la página entera.
// =============================================================================

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Gift } from 'lucide-react'
import type {
  LoyaltyNotificationRule, LoyaltyOverview, LoyaltyReward, LoyaltyService, LoyaltySettings, LoyaltyTier, Referral,
} from '@/lib/types/loyalty'
import { FidelizacionSubnav } from './components/subnav'
import { ResumenTab } from './components/resumen-tab'
import { CategoriasTab } from './components/categorias-tab'
import { PuntosTab } from './components/puntos-tab'
import { PremiosTab } from './components/premios-tab'
import { ReferidosTab } from './components/referidos-tab'
import { NotificacionesTab } from './components/notificaciones-tab'
import { ClientesTab } from './components/clientes-tab'
import { TABS, type Tab } from './components/helpers'

interface Props {
  initialTab?: string
  overview: LoyaltyOverview
  settings: LoyaltySettings
  tiers: LoyaltyTier[]
  rewards: LoyaltyReward[]
  services: LoyaltyService[]
  rules: LoyaltyNotificationRule[]
  referrals: Referral[]
  canManage: boolean
  timezone: string
  org: { name: string; logoUrl: string | null }
  /** Errores de carga parciales: la pantalla se muestra igual y los avisa. */
  errores: string[]
}

export function FidelizacionClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tabInicial = (TABS as readonly string[]).includes(props.initialTab ?? '') ? (props.initialTab as Tab) : 'resumen'
  const [tab, setTab] = useState<Tab>(tabInicial)

  const [settings, setSettings] = useState(props.settings)
  const [tiers, setTiers] = useState(props.tiers)
  const [rewards, setRewards] = useState(props.rewards)
  const [rules, setRules] = useState(props.rules)

  function cambiarTab(t: Tab) {
    setTab(t)
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('tab', t)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
          <Gift className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="bg-gradient-to-b from-zinc-50 to-zinc-300 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">Fidelización</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Categorías por frecuencia, puntos con vencimiento, premios, referidos y notificaciones. Todo se configura acá; la app sólo lo muestra.</p>
        </div>
      </header>

      <FidelizacionSubnav active={tab} onChange={cambiarTab} alerta={props.overview.errors_7d > 0} />

      {props.errores.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Parte de la información no se pudo cargar.</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-200/80">{props.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        </div>
      )}

      {/*
        Las siete pestañas quedan MONTADAS y se ocultan con `hidden`: cada una
        inicializa su formulario desde props al montar, así que renderizarlas
        condicionalmente tiraba los cambios sin guardar al cambiar de pestaña
        (ir a Puntos a mirar los pts base y volver a Categorías perdía los
        umbrales, nombres y colores editados) sin ningún aviso. Cada pestaña
        escribe un conjunto de campos distinto, así que no se pisan entre sí.
      */}
      <div className="pt-1">
        <div hidden={tab !== 'resumen'}>
          <ResumenTab overview={props.overview} settings={settings} tiers={tiers} canManage={props.canManage} timezone={props.timezone} onSettingsChange={setSettings} />
        </div>
        <div hidden={tab !== 'categorias'}>
          <CategoriasTab settings={settings} tiers={tiers} canManage={props.canManage} activa={tab === 'categorias'} onSaved={(s, t) => { setSettings(s); setTiers(t) }} />
        </div>
        <div hidden={tab !== 'puntos'}>
          <PuntosTab settings={settings} tiers={tiers} services={props.services} canManage={props.canManage} onSaved={setSettings} />
        </div>
        <div hidden={tab !== 'premios'}>
          <PremiosTab rewards={rewards} tiers={tiers} services={props.services} settings={settings} canManage={props.canManage} onChange={setRewards} />
        </div>
        <div hidden={tab !== 'referidos'}>
          <ReferidosTab settings={settings} referrals={props.referrals} canManage={props.canManage} timezone={props.timezone} onSaved={setSettings} />
        </div>
        <div hidden={tab !== 'notificaciones'}>
          <NotificacionesTab rules={rules} canManage={props.canManage} org={props.org} expiringSoonDays={settings.expiring_soon_days} onChange={setRules} />
        </div>
        <div hidden={tab !== 'clientes'}>
          <ClientesTab tiers={tiers} rewards={rewards} settings={settings} canManage={props.canManage} timezone={props.timezone} />
        </div>
      </div>
    </div>
  )
}
