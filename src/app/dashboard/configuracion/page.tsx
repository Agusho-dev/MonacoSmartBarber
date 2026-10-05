import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { obtenerMenorEspera } from '@/lib/actions/menor-espera'
import { obtenerAsesoriaSucursales, obtenerMetricasAsesoria } from '@/lib/actions/asesoria'
import { redirect } from 'next/navigation'
import { ConfiguracionClient } from './configuracion-client'
import { CheckinPinCard } from '@/components/dashboard/checkin-pin-card'
import { MenorEsperaCard } from '@/components/dashboard/menor-espera-card'
import { AsesoriaCard } from '@/components/dashboard/asesoria-card'

export default async function ConfiguracionPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const supabase = createAdminClient()
  const scopedIds = await getScopedBranchIds()

  const [{ data: appSettings }, { data: branches }, { data: org }, menorEspera, asesoria, metricasAsesoria] = await Promise.all([
    supabase.from('app_settings').select('*').eq('organization_id', orgId).single(),
    scopedIds.length > 0
      ? supabase.from('branches').select('id, name, checkin_bg_color').eq('organization_id', orgId).in('id', scopedIds).order('name')
      : Promise.resolve({ data: [] }),
    supabase
      .from('organizations')
      .select('id, name, logo_url, checkin_pin_hash')
      .eq('id', orgId)
      .single(),
    // Un error (p. ej. la migración 218 sin aplicar, o la base lenta) vuelve
    // como texto y la card lo muestra con un «Reintentar»: nunca tumba la página.
    obtenerMenorEspera().catch((e: unknown) => ({
      data: null,
      error: `No pudimos cargar el aviso de Menor espera: ${e instanceof Error ? e.message : String(e)}`,
    })),
    // Asesoría en la entrada (mig 217): mismo criterio, el error viaja como
    // texto y la card ofrece «Reintentar».
    obtenerAsesoriaSucursales().catch((e: unknown) => ({
      ok: false as const,
      error: `No pudimos cargar la asesoría en la entrada: ${e instanceof Error ? e.message : String(e)}`,
    })),
    // «Cómo le va» de la asesoría (hallazgo asesoria-05), últimos 30 días. Un
    // error se muestra como error con «Reintentar» dentro de la card, nunca
    // como ceros.
    obtenerMetricasAsesoria({ dias: 30 }).catch((e: unknown) => ({
      ok: false as const,
      error: `No pudimos calcular cómo le va a la asesoría: ${e instanceof Error ? e.message : String(e)}`,
    })),
  ])

  const hasCheckinPin = !!(org as { checkin_pin_hash?: string | null } | null)?.checkin_pin_hash
  // Sin `settings.view` la card no se muestra: un «Reintentar» no arregla un permiso.
  const asesoriaSinPermiso = !asesoria.ok && 'sinPermiso' in asesoria && asesoria.sinPermiso === true

  return (
    <div className="space-y-6">
      <ConfiguracionClient
        appSettings={appSettings}
        branches={branches ?? []}
        org={org ? { name: org.name, logo_url: org.logo_url } : null}
      />
      {!('sinPermiso' in menorEspera && menorEspera.sinPermiso) && (
        <MenorEsperaCard inicial={menorEspera.data} errorInicial={menorEspera.error} />
      )}
      {!asesoriaSinPermiso && (
        <AsesoriaCard
          inicial={asesoria.ok ? { sucursales: asesoria.sucursales, puedeEditar: asesoria.puedeEditar } : null}
          errorInicial={asesoria.ok ? null : asesoria.error}
          metricasIniciales={metricasAsesoria}
        />
      )}
      <CheckinPinCard hasPin={hasCheckinPin} />
    </div>
  )
}
