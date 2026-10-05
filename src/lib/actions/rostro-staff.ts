'use server'

/*
 * Rostro del staff en el kiosko: identificar a un barbero por la cara, verificar
 * su PIN y registrarle la cara. Todo del lado del servidor, con service role.
 *
 * Por qué existe (revisión del 4/10/2026, hallazgo productos-y-fugas-06): el
 * kiosko guardaba los descriptores faciales en `staff_face_descriptors` con la
 * anon key, la que viaja en el bundle. Las policies de esa tabla dejaban a
 * cualquiera con esa clave:
 *   - LEER los 177 descriptores biométricos de todas las organizaciones
 *     (`staff_face_anon_read`, USING true), y
 *   - CARGAR una cara para cualquier barbero activo de cualquier organización
 *     (`staff_face_insert_active_staff`: sólo pedía que el staff estuviera activo).
 * Y `match_staff_face_descriptor` (SECURITY DEFINER, EXECUTE para anon) recorría
 * TODAS las orgs si no le pasaban una, aceptaba cualquier umbral y cualquier
 * cantidad, y devolvía el teléfono: con un vector en cero y umbral 10 listaba a
 * los 25 barberos con cara, 17 con su teléfono.
 *
 * Cómo queda:
 *   - Identificar: el browser manda el descriptor y la org; el servidor llama a
 *     la RPC con umbral y cantidad FIJOS y devuelve id y nombre, nada más.
 *   - Registrar: hace falta un permiso firmado (HMAC, 5 minutos) que sólo emite
 *     `verificarPinStaffEnKiosko` cuando el PIN es correcto. Sin PIN no hay cara.
 * La migración 223 (con gate) saca a anon y authenticated de la tabla y de la
 * RPC; la 223a (antes del deploy) acota la RPC y corta la lectura anónima sin
 * romper el bundle viejo.
 *
 * Son endpoints públicos (el id de cada action viaja en el bundle del kiosko):
 * todo lo que llega se valida acá, con límite de intentos por IP y por barbero.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { getClientIP, rateLimit } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'

/** Distancia máxima para dar por buena una cara. La misma que usaba el kiosko. */
const UMBRAL_STAFF = 0.48
/** Candidatos que se piden a la base (la 223a acota la RPC a 3). */
const CANDIDATOS = 3
/** Largo de un descriptor de face-api. */
const DIMENSIONES = 128
/** Capturas que acepta un registro: el kiosko manda 3. */
const MAX_DESCRIPTORES = 5
/** Vida del permiso para registrar la cara después del PIN. */
const VIDA_PERMISO_MS = 5 * 60 * 1000
const PROPOSITO = 'rostro-staff'

const DEMASIADOS = 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'
const PIN_INCORRECTO = 'PIN incorrecto'

// ── Permiso firmado ─────────────────────────────────────────────────────────
// Mismo esquema que la cookie `barber_session` (src/lib/barber-cookie.ts):
// base64url(json).hmac, con el mismo secreto (BARBER_SESSION_SECRET o, si no
// está, la service role key). La clave se DERIVA con el propósito para que un
// valor firmado para otra cosa (la cookie del panel) no sirva acá.

interface PermisoRostro {
  v: 1
  p: typeof PROPOSITO
  /** staff */
  s: string
  /** organización */
  o: string
  /** sucursal */
  b: string
  /** vence (epoch ms) */
  e: number
  /** nonce: identifica este permiso para el límite de usos */
  n: string
}

function clavePermiso(): Buffer | null {
  const base = process.env.BARBER_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) return null
  return createHmac('sha256', base).update(`monaco:${PROPOSITO}:v1`).digest()
}

function firmarPermiso(datos: PermisoRostro): string | null {
  const clave = clavePermiso()
  if (!clave) {
    console.error('[rostro-staff] Sin BARBER_SESSION_SECRET ni SUPABASE_SERVICE_ROLE_KEY: no se puede firmar el permiso')
    return null
  }
  const json = JSON.stringify(datos)
  const firma = createHmac('sha256', clave).update(json).digest('base64url')
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${firma}`
}

function leerPermiso(valor: unknown): PermisoRostro | null {
  const clave = clavePermiso()
  if (!clave || typeof valor !== 'string' || valor.length > 2048) return null
  const punto = valor.lastIndexOf('.')
  if (punto <= 0) return null
  let json: string
  try {
    json = Buffer.from(valor.slice(0, punto), 'base64url').toString('utf8')
  } catch {
    return null
  }
  const esperada = Buffer.from(createHmac('sha256', clave).update(json).digest('base64url'))
  const recibida = Buffer.from(valor.slice(punto + 1))
  if (esperada.length !== recibida.length) return null
  try {
    if (!timingSafeEqual(esperada, recibida)) return null
  } catch {
    return null
  }
  let datos: PermisoRostro
  try {
    datos = JSON.parse(json) as PermisoRostro
  } catch {
    return null
  }
  const ahora = Date.now()
  if (
    !datos ||
    datos.v !== 1 ||
    datos.p !== PROPOSITO ||
    !isValidUUID(datos.s) ||
    !isValidUUID(datos.o) ||
    !isValidUUID(datos.b) ||
    typeof datos.n !== 'string' ||
    typeof datos.e !== 'number' ||
    datos.e <= ahora ||
    // Un vencimiento más lejano que la vida del permiso no lo emitimos nosotros.
    datos.e - ahora > VIDA_PERMISO_MS + 60_000
  ) {
    return null
  }
  return datos
}

// ── Validaciones ────────────────────────────────────────────────────────────

/** Un descriptor de face-api: 128 números finitos y acotados. */
function esDescriptor(valor: unknown): valor is number[] {
  return (
    Array.isArray(valor) &&
    valor.length === DIMENSIONES &&
    valor.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 2)
  )
}

function pinIgual(ingresado: string, guardado: string): boolean {
  try {
    const a = Buffer.from(ingresado)
    const b = Buffer.from(guardado)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Identificar ─────────────────────────────────────────────────────────────

/**
 * ¿De qué barbero de esta organización es esta cara?
 *
 * Devuelve id y nombre (los mismos datos que la tablet ya muestra en la lista de
 * barberos), nunca el teléfono. La org es obligatoria: sin ella la RPC recorría
 * todas. `branchId`, si viene, tiene que ser una sucursal activa de esa org.
 */
export async function identificarStaffPorRostro(entrada: {
  descriptor: number[]
  orgId: string
  branchId?: string | null
}): Promise<
  | { ok: true; staff: { id: string; nombre: string; distancia: number } | null }
  | { ok: false; error: string }
> {
  const descriptor = entrada?.descriptor
  const orgId = entrada?.orgId
  const branchId = entrada?.branchId ?? null
  if (!esDescriptor(descriptor) || !isValidUUID(orgId) || (branchId !== null && !isValidUUID(branchId))) {
    return { ok: false, error: 'Datos inválidos' }
  }

  const ip = await getClientIP()
  const gate = await rateLimit('rostro_staff_identificar', `${ip}:${orgId}`, { limit: 60, window: 60 })
  if (!gate.allowed) return { ok: false, error: DEMASIADOS }

  const supabase = createAdminClient()

  if (branchId) {
    const { data: sucursal, error: errSucursal } = await supabase
      .from('branches')
      .select('organization_id, is_active')
      .eq('id', branchId)
      .maybeSingle()
    if (errSucursal) {
      console.error('[identificarStaffPorRostro] sucursal:', errSucursal.message)
      return { ok: false, error: 'No pudimos identificarte. Probá de nuevo.' }
    }
    if (!sucursal?.is_active || sucursal.organization_id !== orgId) {
      return { ok: false, error: 'Sucursal no encontrada' }
    }
  }

  const { data, error } = await supabase.rpc('match_staff_face_descriptor', {
    query_descriptor: JSON.stringify(descriptor),
    match_threshold: UMBRAL_STAFF,
    max_results: CANDIDATOS,
    p_org_id: orgId,
  })
  if (error) {
    console.error('[identificarStaffPorRostro] rpc:', error.message)
    return { ok: false, error: 'No pudimos identificarte. Probá de nuevo.' }
  }

  const candidatos = ((data ?? []) as Array<{ client_id: string; distance: number }>)
    .filter((c) => isValidUUID(c?.client_id) && typeof c.distance === 'number' && c.distance < UMBRAL_STAFF)
    .sort((a, b) => a.distance - b.distance)
  if (candidatos.length === 0) return { ok: true, staff: null }

  // La org y que siga activo se vuelven a mirar acá: no dependen de que la
  // migración que acota la RPC ya esté aplicada.
  const { data: vigentes, error: errStaff } = await supabase
    .from('staff')
    .select('id, full_name')
    .in('id', candidatos.map((c) => c.client_id))
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (errStaff) {
    console.error('[identificarStaffPorRostro] staff:', errStaff.message)
    return { ok: false, error: 'No pudimos identificarte. Probá de nuevo.' }
  }

  const nombres = new Map((vigentes ?? []).map((s) => [s.id as string, s.full_name as string]))
  const mejor = candidatos.find((c) => nombres.has(c.client_id))
  if (!mejor) return { ok: true, staff: null }
  return {
    ok: true,
    staff: { id: mejor.client_id, nombre: nombres.get(mejor.client_id)!, distancia: mejor.distance },
  }
}

// ── PIN ─────────────────────────────────────────────────────────────────────

/**
 * Verifica el PIN del barbero en la tablet y, si es correcto, emite el permiso
 * para registrarle la cara (`registrarRostroStaff`).
 *
 * Reemplaza a `verifyBarberPin` (ya borrada de auth.ts), que no tenía límite de intentos:
 * con 10.000 PINs posibles, un endpoint público sin límite es un oráculo para
 * adivinarlo. Acá van dos topes: por IP y barbero (el mismo de `loginWithPin`) y
 * por barbero desde cualquier IP, para que repartir el ataque no alcance.
 *
 * El barbero tiene que ser de la sucursal de la tablet: es la lista que muestra
 * el kiosko y la misma regla que aplica el fichaje (`registerBarberClockIn`).
 */
export async function verificarPinStaffEnKiosko(entrada: {
  staffId: string
  pin: string
  branchId: string
}): Promise<
  | { ok: true; staffId: string; staffName: string; permiso: string }
  | { ok: false; error: string }
> {
  const staffId = entrada?.staffId
  const branchId = entrada?.branchId
  const pin = entrada?.pin
  if (!isValidUUID(staffId) || !isValidUUID(branchId)) return { ok: false, error: 'Datos inválidos' }
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return { ok: false, error: PIN_INCORRECTO }

  const ip = await getClientIP()
  const [porIp, porBarbero] = await Promise.all([
    rateLimit('pin_kiosko_staff', `${ip}:${staffId}`, { limit: 5, window: 60 }),
    rateLimit('pin_kiosko_staff_global', staffId, { limit: 20, window: 600 }),
  ])
  if (!porIp.allowed || !porBarbero.allowed) return { ok: false, error: DEMASIADOS }

  const supabase = createAdminClient()

  const { data: sucursal, error: errSucursal } = await supabase
    .from('branches')
    .select('organization_id, is_active')
    .eq('id', branchId)
    .maybeSingle()
  if (errSucursal) {
    console.error('[verificarPinStaffEnKiosko] sucursal:', errSucursal.message)
    return { ok: false, error: 'No pudimos verificar el PIN. Probá de nuevo.' }
  }
  if (!sucursal?.is_active || !sucursal.organization_id) return { ok: false, error: 'Sucursal no encontrada' }

  const { data: staff, error: errStaff } = await supabase
    .from('staff')
    .select('id, full_name, pin')
    .eq('id', staffId)
    .eq('organization_id', sucursal.organization_id)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (errStaff) {
    console.error('[verificarPinStaffEnKiosko] staff:', errStaff.message)
    return { ok: false, error: 'No pudimos verificar el PIN. Probá de nuevo.' }
  }
  // Barbero inexistente, de otra sucursal o sin PIN: la misma respuesta que un
  // PIN equivocado, para no confirmar qué ids existen.
  if (!staff?.pin || !pinIgual(pin, staff.pin as string)) return { ok: false, error: PIN_INCORRECTO }

  const permiso = firmarPermiso({
    v: 1,
    p: PROPOSITO,
    s: staff.id as string,
    o: sucursal.organization_id as string,
    b: branchId,
    e: Date.now() + VIDA_PERMISO_MS,
    n: randomUUID(),
  })
  if (!permiso) return { ok: false, error: 'No pudimos iniciar el registro. Avisale al administrador.' }

  return { ok: true, staffId: staff.id as string, staffName: staff.full_name as string, permiso }
}

// ── Registrar ───────────────────────────────────────────────────────────────

/**
 * Guarda las capturas de la cara del barbero que acaba de verificar su PIN.
 *
 * El staff, la org y la sucursal salen del permiso firmado, nunca del browser.
 * Un permiso sirve para 3 envíos (el registro y dos reintentos) durante sus 5
 * minutos; además hay un tope por barbero, para que ni con el PIN se pueda
 * llenar la tabla.
 */
export async function registrarRostroStaff(entrada: {
  permiso: string
  descriptores: number[][]
  /** Calidad de la mejor captura (0 a 1); va en la primera fila, como antes. */
  calidad?: number
  origen?: 'checkin' | 'barber'
}): Promise<{ ok: true; guardados: number } | { ok: false; error: string }> {
  const datos = leerPermiso(entrada?.permiso)
  if (!datos) return { ok: false, error: 'Pasó demasiado tiempo desde que ingresaste el PIN. Volvé a ingresarlo.' }

  const descriptores = entrada?.descriptores
  if (
    !Array.isArray(descriptores) ||
    descriptores.length === 0 ||
    descriptores.length > MAX_DESCRIPTORES ||
    !descriptores.every(esDescriptor)
  ) {
    return { ok: false, error: 'No pudimos leer bien tu cara. Probá de nuevo.' }
  }
  const calidad =
    typeof entrada?.calidad === 'number' && Number.isFinite(entrada.calidad)
      ? Math.min(Math.max(entrada.calidad, 0), 1)
      : 0
  const origen = entrada?.origen === 'barber' ? 'barber' : 'checkin'

  const [porPermiso, porBarbero] = await Promise.all([
    rateLimit('rostro_staff_registro', datos.n, { limit: 3, window: 600 }),
    rateLimit('rostro_staff_registro_staff', datos.s, { limit: 10, window: 3600 }),
  ])
  if (!porPermiso.allowed || !porBarbero.allowed) return { ok: false, error: DEMASIADOS }

  const supabase = createAdminClient()

  // Puede haber cambiado algo en los 5 minutos del permiso (lo dieron de baja,
  // lo pasaron a otra sucursal).
  const { data: staff, error: errStaff } = await supabase
    .from('staff')
    .select('id')
    .eq('id', datos.s)
    .eq('organization_id', datos.o)
    .eq('branch_id', datos.b)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (errStaff) {
    console.error('[registrarRostroStaff] staff:', errStaff.message)
    return { ok: false, error: 'No pudimos guardar tu rostro. Probá de nuevo.' }
  }
  if (!staff) return { ok: false, error: 'Barbero no encontrado en esta sucursal' }

  const filas = descriptores.map((d, i) => ({
    staff_id: datos.s,
    descriptor: JSON.stringify(d),
    quality_score: i === 0 ? calidad : 0,
    source: origen,
  }))
  const { error } = await supabase.from('staff_face_descriptors').insert(filas)
  if (error) {
    console.error('[registrarRostroStaff] insert:', error.message)
    return { ok: false, error: 'No pudimos guardar tu rostro. Probá de nuevo.' }
  }
  return { ok: true, guardados: filas.length }
}
