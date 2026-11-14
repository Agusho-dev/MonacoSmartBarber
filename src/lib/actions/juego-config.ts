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
 *
 * Además, «Jugar como dueño» (`crearPaseDuenos`): el link al juego con el pase que
 * deja ver y elegir a los personajes de los dueños (src/lib/juego/pase.ts). Y el PIN de
 * dueños (mig 239, `obtenerPinDuenos` / `guardarPinDuenos` / `quitarPinDuenos`): en el
 * juego, 5 toques al logo de Monaco y el PIN dan el mismo pase (src/lib/juego/pin-duenos.ts).
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { isValidUUID } from '@/lib/validation'
import { firmarPaseDuenos } from '@/lib/juego/pase'
import { SIN_TABLA, esFormatoPin, hashearPin } from '@/lib/juego/pin-duenos'
import { orgDelJuego, urlDelJuego } from '@/lib/juego/servidor'
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

/**
 * «Jugar como dueño»: el link al juego con el pase de dueños (`?d=`, src/lib/juego/pase.ts), que
 * lleva la organización, quién lo pidió y el vencimiento (90 días). Lo pide quien ve la tarjeta del
 * juego: `settings.view` y la organización del juego. El juego lo valida en el servidor
 * (`validarPaseDuenos`, src/lib/actions/juego.ts) y lo guarda en el celular donde se abre; mientras
 * valga, ese celular ve y elige a los personajes de los dueños (`soloDuenos`). No escribe nada en la
 * base: cada pedido firma uno nuevo (anularlos todos = subir la versión de la clave en pase.ts).
 */
export async function crearPaseDuenos(): Promise<
  { ok: true; url: string; venceEn: number } | { ok: false; error: string }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: SESION_VENCIDA }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.view'] !== true) {
    return { ok: false, error: 'No tenés permiso para ver la configuración.' }
  }

  const delJuego = await esOrgDelJuego(orgId)
  if (delJuego === null) return { ok: false, error: 'No pudimos armar el pase. Probá de nuevo.' }
  if (!delJuego) return { ok: false, error: 'El juego no está disponible para esta organización.' }

  const usuario = await getCachedAuthUser()
  if (!usuario) return { ok: false, error: SESION_VENCIDA }

  const firmado = firmarPaseDuenos({ orgId, usuarioId: usuario.id })
  if (!firmado) return { ok: false, error: 'No pudimos armar el pase. Probá de nuevo.' }

  try {
    const url = await urlDelJuego(`d=${firmado.pase}`)
    // Queda en el log quién lo pidió (el pase no se guarda en ninguna tabla).
    console.info('[crearPaseDuenos] pase de dueños', { usuario: usuario.id, vence: new Date(firmado.venceEn * 1000).toISOString() })
    return { ok: true, url, venceEn: firmado.venceEn }
  } catch (e) {
    console.error('[crearPaseDuenos]', e instanceof Error ? e.message : String(e))
    return { ok: false, error: 'No pudimos armar el pase. Probá de nuevo.' }
  }
}

// ── El PIN de dueños (mig 239) ──────────────────────────────────────────────

const ERROR_SIN_TABLA = 'El PIN de dueños todavía no está disponible: falta aplicar la migración 239.'

/** Estado del PIN de dueños para la tarjeta: si hay y desde cuándo. El PIN (y su hash) nunca sale. */
export type EstadoPinDuenos =
  | { ok: true; configurado: boolean; desde: string | null }
  | { ok: false; error: string }

/** Permiso y organización del juego para el PIN: el orgId si pasa, si no el error para mostrar. */
async function accesoPin(permiso: 'settings.view' | 'settings.manage'): Promise<{ orgId: string } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: SESION_VENCIDA }
  const permisos = await getCurrentUserPermissions()
  if (permisos[permiso] !== true) {
    return {
      error: permiso === 'settings.manage' ? 'No tenés permiso para cambiar la configuración.' : 'No tenés permiso para ver la configuración.',
    }
  }
  const delJuego = await esOrgDelJuego(orgId)
  if (delJuego === null) return { error: 'No pudimos leer la configuración del juego. Probá de nuevo.' }
  if (!delJuego) return { error: 'El juego no está disponible para esta organización.' }
  return { orgId }
}

/** ¿Hay PIN de dueños y desde cuándo? Pide `settings.view` y la organización del juego. */
export async function obtenerPinDuenos(): Promise<EstadoPinDuenos> {
  const acceso = await accesoPin('settings.view')
  if ('error' in acceso) return { ok: false, error: acceso.error }
  const { data, error } = await createAdminClient()
    .from('juego_pin_duenos')
    .select('updated_at')
    .eq('organization_id', acceso.orgId)
    .maybeSingle()
  if (error) {
    console.error('[obtenerPinDuenos]', error.code, error.message)
    return { ok: false, error: SIN_TABLA.has(error.code ?? '') ? ERROR_SIN_TABLA : 'No pudimos leer el PIN de dueños. Probá de nuevo.' }
  }
  const desde = (data as { updated_at?: string | null } | null)?.updated_at ?? null
  return { ok: true, configurado: data !== null, desde }
}

/**
 * Pone o cambia el PIN de dueños (uno por organización, compartido por los 4). Pide
 * `settings.manage` y la organización del juego; 4 a 8 dígitos, iguales en «PIN» y «Repetir PIN».
 * Guarda sólo el hash (scrypt con sal propia) y confirma con la fila que quedó. Cambiarlo NO anula
 * los pases que ya se dieron (ver src/lib/juego/pase.ts).
 */
export async function guardarPinDuenos(
  pin: string,
  repetir: string,
): Promise<{ ok: true; desde: string } | { ok: false; error: string }> {
  if (!esFormatoPin(pin)) return { ok: false, error: 'El PIN tiene que tener de 4 a 8 números.' }
  if (pin !== repetir) return { ok: false, error: 'Los dos PIN no coinciden.' }

  const acceso = await accesoPin('settings.manage')
  if ('error' in acceso) return { ok: false, error: acceso.error }
  const usuario = await getCachedAuthUser()
  if (!usuario) return { ok: false, error: SESION_VENCIDA }

  let pinHash: string
  try {
    pinHash = await hashearPin(pin)
  } catch (e) {
    console.error('[guardarPinDuenos] hash:', e instanceof Error ? e.message : String(e))
    return { ok: false, error: 'No pudimos guardar el PIN. Probá de nuevo.' }
  }

  const { data, error } = await createAdminClient()
    .from('juego_pin_duenos')
    .upsert(
      { organization_id: acceso.orgId, pin_hash: pinHash, actualizado_por: usuario.id, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
    .select('updated_at')
  if (error) {
    console.error('[guardarPinDuenos]', error.code, error.message)
    return { ok: false, error: SIN_TABLA.has(error.code ?? '') ? ERROR_SIN_TABLA : 'No pudimos guardar el PIN. Probá de nuevo.' }
  }
  const fila = (data as Array<{ updated_at?: string | null }> | null)?.[0]
  if (!fila?.updated_at) return { ok: false, error: 'No pudimos confirmar el PIN guardado. Probá de nuevo.' }

  console.info('[guardarPinDuenos] PIN de dueños actualizado', { usuario: usuario.id })
  return { ok: true, desde: fila.updated_at }
}

/** Quita el PIN de dueños: el gesto del logo deja de servir. Pide `settings.manage`. */
export async function quitarPinDuenos(): Promise<{ ok: true } | { ok: false; error: string }> {
  const acceso = await accesoPin('settings.manage')
  if ('error' in acceso) return { ok: false, error: acceso.error }
  const usuario = await getCachedAuthUser()
  if (!usuario) return { ok: false, error: SESION_VENCIDA }

  const { error } = await createAdminClient()
    .from('juego_pin_duenos')
    .delete()
    .eq('organization_id', acceso.orgId)
    .select('organization_id')
  if (error) {
    console.error('[quitarPinDuenos]', error.code, error.message)
    return { ok: false, error: SIN_TABLA.has(error.code ?? '') ? ERROR_SIN_TABLA : 'No pudimos quitar el PIN. Probá de nuevo.' }
  }
  console.info('[quitarPinDuenos] PIN de dueños quitado', { usuario: usuario.id })
  return { ok: true }
}
