import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TvClient } from './tv-client'
import { TV_QUEUE_SELECT } from '@/lib/tv-queue-select'

export const dynamic = 'force-dynamic'

/**
 * Mismo criterio que el kiosko `(tablet)`: título neutro, sin marca.
 *
 * El TV es la pantalla de la fila colgada en el local del cliente. Heredaba
 * "Monaco Barber Studio", que es la marca de UNA organización sobre una
 * superficie multi-tenant; y "BarberOS" sería el nombre del proveedor delante
 * del cliente final. "Pantalla de fila" describe qué es, vale para cualquier
 * organización y hace distinguibles las dos pestañas cuando el mismo equipo
 * tiene abierto el TV y el check-in.
 */
export const metadata: Metadata = {
  title: 'Pantalla de fila',
}


export default async function TvPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>
}) {
  const supabase = createAdminClient()
  const cookieStore = await cookies()
  // TV es ruta pública — prioriza public_organization (kiosk/TV) sobre active_organization (dashboard)
  const orgId = cookieStore.get('public_organization')?.value
    ?? cookieStore.get('active_organization')?.value

  // Si no hay cookie de organización, redirigir según haya o no slug en la URL.
  // El route handler /api/tv/setup setea la cookie y vuelve acá.
  if (!orgId) {
    const { slug } = await searchParams
    if (slug) {
      redirect(`/api/tv/setup?slug=${encodeURIComponent(slug)}`)
    }
    redirect('/')
  }

  // Obtener branches filtradas por org
  // `timezone` viaja al cliente porque la hora de un turno es hora de PARED de
  // la sucursal: sin ella, la TV la formatearía en la TZ del navegador.
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, organization_id, timezone')
    .eq('is_active', true)
    .eq('organization_id', orgId)

  const branchIds = (branches ?? []).map(b => b.id)

  // Obtener organización activa (para logo y nombre en el header del TV)
  let orgInfo: { name: string; logo_url: string | null } | null = null
  const { data: orgData } = await supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (orgData) orgInfo = orgData as { name: string; logo_url: string | null }

  // Fetch inicial filtrado por branches de la org
  const [entriesRes, barbersRes] = await Promise.all([
    branchIds.length > 0
      ? supabase
          .from('queue_entries')
          // Lo que viaja acá llega como props al browser de una pantalla pública:
          // sólo el nombre del cliente y nombre y foto del barbero, nunca `*` de
          // `clients` ni de `staff` (PIN, teléfono, `face_embedding`…). Embeds por
          // nombre de constraint (Known Risk #15). Ver `TV_QUEUE_SELECT`.
          .select(TV_QUEUE_SELECT)
          .in('status', ['waiting', 'in_progress'])
          .in('branch_id', branchIds)
          // La TV es la única pantalla donde el CLIENTE ve su lugar en la fila, así
          // que tiene que mostrar el orden que el motor va a ejecutar. `position` se
          // recicla y se duplica entre entradas vivas (medido en Rondeau: 64 pares
          // con la misma `position` y vidas solapadas en un solo día); el FIFO real
          // es `priority_order`, que es por lo que ordena `claim_next_for_barber`.
          .order('priority_order')
          .order('position')
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? supabase
          .from('staff')
          .select('id, full_name, branch_id, status, is_active, avatar_url')
          .or('role.eq.barber,is_also_barber.eq.true')
          .eq('is_active', true)
          .in('branch_id', branchIds)
          .order('full_name')
      : Promise.resolve({ data: [] }),
  ])

  // La TV arranca vacía y el primer refresco del cliente (al montar) vuelve a
  // pedir la fila; lo que no puede pasar es que la falla no quede en ningún lado.
  if (entriesRes.error) console.error('[tv] fila inicial', entriesRes.error.message)

  return (
    <TvClient
      initialEntries={entriesRes.data || []}
      barbers={barbersRes.data || []}
      branches={(branches ?? []).map(b => ({ id: b.id, name: b.name, timezone: b.timezone }))}
      orgBranchIds={branchIds}
      orgId={orgId}
      orgName={orgInfo?.name ?? 'BarberOS'}
      orgLogoUrl={orgInfo?.logo_url ?? '/logo-barberos.png'}
    />
  )
}
