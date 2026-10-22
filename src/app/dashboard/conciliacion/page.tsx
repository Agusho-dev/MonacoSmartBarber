import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getCurrentUserPermissions } from '@/lib/actions/permissions-gate'
import { hasFeature } from '@/lib/actions/entitlements'
import { obtenerConciliacion } from '@/lib/actions/conciliacion-mp'
import type { RespuestaConciliacion } from '@/lib/conciliacion-mp/contrato'
import { redirectUriConciliacion } from '@/lib/conciliacion-mp/oauth'
import { oauthDisponible } from '@/lib/conciliacion-mp/servicio'
import { createAdminClient } from '@/lib/supabase/server'
import { puedeUsarTex } from '@/lib/tex/contexto'
import { isValidUUID } from '@/lib/validation'
import { ConciliacionClient } from './conciliacion-client'
import { COOKIE_PRESET, hoyEnArgentina, limitesISO, periodoInicial } from './components/periodo'

// /dashboard/conciliacion — la conciliación de transferencias con Mercado Pago.
//
// El servidor resuelve permisos, el período inicial (URL → último preset
// elegido → Ayer, en hora argentina), la sucursal (`?sucursal=`, la que manda
// Tex en sus enlaces; por defecto todas las del alcance) y precarga la
// conciliación de ese período; todo lo demás (tira de 30 días, lectura
// automática de Mercado Pago, casos, conexión) lo maneja el cliente.
//
// URL: `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (días argentinos, AMBOS inclusive),
// `&sucursal=<id>`, `&caso=<id>` (abre ese caso).
//
// maxDuration: las server actions que corren desde esta página (leer una cuenta
// de Mercado Pago, hasta ~45 s cada una) heredan el límite de este segmento.

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const metadata: Metadata = { title: 'Conciliación | BarberOS' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function uno(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v[0] ?? null
  return null
}

/** Sólo sirve para el selector: si falla, no hay selector (y todo se ve con "todas", que es el alcance). */
async function sucursalesDelAlcance(orgId: string): Promise<{ id: string; nombre: string }[]> {
  try {
    const ids = await getScopedBranchIds()
    if (!ids.length) return []
    const { data, error } = await createAdminClient()
      .from('branches')
      .select('id, name, is_active')
      .eq('organization_id', orgId)
      .in('id', ids)
      .order('name')
    if (error) {
      console.error('[conciliacion] sucursales', error.message)
      return []
    }
    return (data ?? []).map((b) => ({ id: b.id as string, nombre: b.is_active ? (b.name as string) : `${b.name} (inactiva)` }))
  } catch (e) {
    console.error('[conciliacion] sucursales', e)
    return []
  }
}

export default async function ConciliacionPage({ searchParams }: { searchParams: SearchParams }) {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  // Una sola lectura de permisos (corta al staff dado de baja, Known Risk #19).
  const permisos = await getCurrentUserPermissions()
  if (permisos['conciliacion.view'] !== true) redirect('/dashboard')
  const puedeGestionar = permisos['conciliacion.manage'] === true

  const sp = await searchParams
  const hoy = hoyEnArgentina()
  const presetGuardado = (await cookies()).get(COOKIE_PRESET)?.value ?? null
  const periodo = periodoInicial({ desde: uno(sp.desde), hasta: uno(sp.hasta) }, presetGuardado, hoy)
  const { desde, hasta } = limitesISO(periodo)

  // Las sucursales del alcance (un encargado de Caseros ve sólo Caseros), para el selector.
  const sucursales = await sucursalesDelAlcance(orgId)
  const pedida = uno(sp.sucursal)
  const sucursalId = pedida && sucursales.some((s) => s.id === pedida) ? pedida : null

  const [respuesta, iaHabilitada] = await Promise.all([
    obtenerConciliacion({ desde, hasta, sucursalId }).catch(
      (e: unknown): RespuestaConciliacion => {
        console.error('[conciliacion] precarga', e)
        return { ok: false, error: 'No pudimos leer la conciliación.' }
      },
    ),
    hasFeature('ai.enabled').catch(() => false),
  ])
  // "Preguntale a Tex" sólo si el panel de Tex existe para esta persona: si no, sería un botón muerto.
  const texDisponible = iaHabilitada && puedeUsarTex({ esDuenoOAdmin: false, permisos })

  // Vuelta del OAuth hecho desde el dashboard (callback de conciliación).
  const conectada = uno(sp.conectada)
  const mpError = uno(sp.mp) === 'error' ? { motivo: uno(sp.motivo) } : null

  // La app de OAuth de conciliación (separada de la de señas). La URL de redirección es la MISMA
  // que usa el callback (se muestra para copiarla tal cual: Mercado Pago la compara letra por letra).
  const urlRedireccion = redirectUriConciliacion()
  const oauthEntorno = oauthDisponible()

  return (
    <ConciliacionClient
      inicial={{
        periodo,
        hoy,
        sucursalId,
        respuesta,
        conectadaId: conectada && isValidUUID(conectada) ? conectada : null,
        mpError,
      }}
      sucursales={sucursales}
      puedeGestionar={puedeGestionar}
      texDisponible={texDisponible}
      oauthEntorno={oauthEntorno}
      urlRedireccion={urlRedireccion}
    />
  )
}
