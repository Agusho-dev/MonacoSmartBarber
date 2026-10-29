'use server'

/**
 * Interruptor de «Corte Final» (el juego de la espera) en /dashboard/configuracion.
 *
 * Prende o apaga, por sucursal, el QR del juego en la tablet de check-in
 * (`branches.juego_qr_kiosko`, mig 233). Lo lee `crearEnlaceJuego` en cada check-in,
 * así que el cambio se ve en la tablet con el próximo cliente, sin recargarla.
 *
 * Mismo criterio que la asesoría en la entrada: `settings.view` para ver la tarjeta,
 * `settings.manage` para cambiarla, y sólo las sucursales que el rol alcanza. Existe
 * sólo para la organización del juego (Monaco): los luchadores son sus barberos y en
 * las otras organizaciones de BarberOS no hay nada que prender.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { orgDelJuego } from '@/lib/juego/servidor'
import { getCurrentOrgId } from './org'
import { getCurrentUserPermissions } from './permissions-gate'
import { assertBranchAccess, getScopedBranchIds } from './branch-access'

/** Una sucursal en la tarjeta del juego. */
export interface SucursalJuego {
  id: string
  name: string
  slug: string
  /** Las inactivas sólo vienen si quedaron con el QR prendido (para poder apagarlo). */
  is_active: boolean
  juego_qr_kiosko: boolean
}

const SESION_VENCIDA = 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.'

/** ¿La org activa es la del juego? null = no se pudo saber (error de lectura). */
async function esOrgDelJuego(orgId: string): Promise<boolean | null> {
  try {
    return (await orgDelJuego(createAdminClient())) === orgId
  } catch (e) {
    console.error('[juego-config] organización del juego:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Sucursales con su interruptor del QR del juego. `sinPermiso` = la tarjeta no se
 * muestra (sin `settings.view`, o la organización no es la del juego).
 */
export async function obtenerJuegoSucursales(): Promise<
  | { ok: true; sucursales: SucursalJuego[]; puedeEditar: boolean }
  | { ok: false; error: string; sinPermiso?: boolean }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: SESION_VENCIDA }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.view'] !== true) {
    return { ok: false, error: 'No tenés permiso para ver la configuración.', sinPermiso: true }
  }
  const puedeEditar = permisos['settings.manage'] === true

  const delJuego = await esOrgDelJuego(orgId)
  if (delJuego === null) return { ok: false, error: 'No pudimos leer la configuración del juego. Probá de nuevo.' }
  if (!delJuego) return { ok: false, error: 'El juego no está disponible para esta organización.', sinPermiso: true }

  const scopedIds = await getScopedBranchIds()
  if (scopedIds.length === 0) return { ok: true, sucursales: [], puedeEditar }

  const { data, error } = await createAdminClient()
    .from('branches')
    .select('id, name, slug, is_active, juego_qr_kiosko')
    .eq('organization_id', orgId)
    .in('id', scopedIds)
    .order('name')
  if (error) {
    console.error('[obtenerJuegoSucursales] branches:', error.message)
    return { ok: false, error: 'No pudimos leer las sucursales. Probá de nuevo.' }
  }

  const sucursales: SucursalJuego[] = ((data ?? []) as Array<Record<string, unknown>>)
    .map((b) => ({
      id: String(b.id),
      name: String(b.name ?? '').trim(),
      slug: String(b.slug ?? ''),
      is_active: b.is_active !== false,
      juego_qr_kiosko: b.juego_qr_kiosko === true,
    }))
    .filter((s) => s.is_active || s.juego_qr_kiosko)

  return { ok: true, sucursales, puedeEditar }
}

/**
 * Prende o apaga el QR del juego en la tablet de UNA sucursal. Escribe sólo
 * `branches.juego_qr_kiosko` y confirma con el rowcount (Known Risk #5/#13): devuelve
 * lo que quedó en la base para que la tarjeta confirme su cambio optimista.
 */
export async function actualizarJuegoSucursal(
  branchId: string,
  activo: boolean,
): Promise<
  | { ok: true; sucursal: { id: string; name: string; juego_qr_kiosko: boolean } }
  | { ok: false; error: string }
> {
  if (typeof branchId !== 'string' || !isValidUUID(branchId) || typeof activo !== 'boolean') {
    return { ok: false, error: 'Datos inválidos.' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: SESION_VENCIDA }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.manage'] !== true) {
    return { ok: false, error: 'No tenés permiso para cambiar la configuración.' }
  }

  const acceso = await assertBranchAccess(branchId)
  if (!acceso.ok || acceso.orgId !== orgId) return { ok: false, error: 'No tenés acceso a esa sucursal.' }

  const delJuego = await esOrgDelJuego(orgId)
  if (delJuego === null) return { ok: false, error: 'No pudimos guardar el cambio. Probá de nuevo.' }
  if (!delJuego) return { ok: false, error: 'El juego no está disponible para esta organización.' }

  const { data, error } = await createAdminClient()
    .from('branches')
    .update({ juego_qr_kiosko: activo })
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .select('id, name, juego_qr_kiosko')
  if (error) {
    console.error('[actualizarJuegoSucursal]', { branchId, activo, error: error.message })
    return { ok: false, error: 'No pudimos guardar el cambio. Probá de nuevo.' }
  }
  const fila = data?.[0]
  if (!fila) return { ok: false, error: 'No encontramos la sucursal: no se guardó nada.' }

  revalidatePath('/dashboard/configuracion')
  return {
    ok: true,
    sucursal: {
      id: String(fila.id),
      name: String(fila.name ?? '').trim(),
      juego_qr_kiosko: fila.juego_qr_kiosko === true,
    },
  }
}
