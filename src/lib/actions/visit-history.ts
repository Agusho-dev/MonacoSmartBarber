'use server'

import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import { requireOrgAccessToEntity } from './guard'
import { currentUserCan } from './permissions-gate'
import { isValidUUID } from '@/lib/validation'
import { leerBarberSession } from '@/lib/barber-cookie'
import type { CorteDelCliente, UltimosCortesResultado } from '@/lib/types/fotos-corte'

/**
 * ¿La request viene del panel del barbero? (cookie FIRMADA `barber_session`).
 * Con la cookie válida manda la cookie, igual que en getCurrentOrgId y
 * getAllowedBranchIds: el alcance de sucursal sale de ella.
 */
async function vieneDelPanel(): Promise<boolean> {
  const cookieStore = await cookies()
  const valor = cookieStore.get('barber_session')?.value
  const sesion = valor ? leerBarberSession(valor) : null
  return !!sesion && isValidUUID(sesion.staff_id)
}

/**
 * Horas hacia atrás en las que una visita en la sucursal del barbero lo habilita
 * a ver el historial de ese cliente. Todas las pantallas del panel que llaman a
 * getUltimosCortesDelCliente (la tarjeta del corte en curso, el pop-up de la
 * asesoría y la ficha que se abre desde la fila) muestran clientes que ESTÁN en
 * la fila; la visita reciente sólo cubre el rato después del cobro (el
 * reintento, el Realtime que tarda en sacar la tarjeta, la ficha que quedó
 * abierta) y el cambio de día de un corte de las 23:55. Un día alcanza para eso
 * sin abrirle al panel toda la base de la sucursal: con 30 días serían los
 * ~2.500 clientes del mes de Rondeau.
 */
const HORAS_VISITA_RECIENTE_PANEL = 24

// ─── Últimos cortes de un cliente (panel del barbero, ficha, asesoría) ───────

/**
 * Los últimos cortes de un cliente, con sus fotos: fecha, servicio (y extras),
 * barbero, sucursal y las fotos en orden. Sirve también para cortes SIN fotos,
 * que hoy son casi todos: "Corte + Barba · con Nico · hace 3 semanas" ya le
 * dice algo al barbero.
 *
 * Reemplaza a getClientProfile, que leía con el cliente de Supabase del que
 * llama: en el panel del barbero eso es anon (PIN + cookie, sin Supabase
 * Auth) y desde la mig 049 anon lee 0 fotos. El panel decía "No hay fotos aún"
 * o "Primera visita" de clientes que tenían las dos cosas.
 *
 * Con service role y `requireOrgAccessToEntity('clients')`, que admite la
 * cookie firmada del barbero y la sesión del dashboard. Nunca devuelve [] ante
 * un error: `{ ok: false }` y la pantalla ofrece reintentar (KR#5/#13).
 *
 * ALCANCE (hallazgo fotos-del-corte-04): el chequeo de organización no
 * alcanza, porque devuelve observaciones, Instagram, el historial de sucursales
 * y las fotos de la cara del cliente, y los ids de cliente se consiguen fácil
 * (searchClients acepta la cookie; lookupClientByPhone es pública).
 *   - Panel (cookie del barbero): sólo un cliente que esté en la fila de SU
 *     sucursal (esperando o en curso) o que tenga una visita ahí en las últimas
 *     HORAS_VISITA_RECIENTE_PANEL horas. Antes, con la lectura anónima, el panel
 *     ya veía sólo a los que estaban en la fila.
 *   - Dashboard: el permiso `clients.view`.
 * Si no corresponde: `{ ok: false, motivo: 'acceso' }`.
 *
 * `limite`: entre 1 y 12 (6 por defecto). `totalVisitas` cuenta todos los
 * cortes del cliente en la organización, no sólo los devueltos.
 */
export async function getUltimosCortesDelCliente(
  clientId: string,
  opciones?: { limite?: number },
): Promise<UltimosCortesResultado> {
  const limite = Math.min(12, Math.max(1, Math.floor(Number(opciones?.limite ?? 6)) || 6))

  const acceso = await requireOrgAccessToEntity('clients', clientId)
  if (!acceso.ok) {
    switch (acceso.reason) {
      case 'no_session': {
        const cookieStore = await cookies()
        return {
          ok: false,
          motivo: 'sesion',
          error: cookieStore.get('barber_session')
            ? 'Tu sesión venció. Volvé a entrar con tu PIN.'
            : 'Tu sesión venció. Volvé a iniciar sesión.',
        }
      }
      case 'invalid_id':
        return { ok: false, motivo: 'datos', error: 'Cliente inválido.' }
      case 'cross_org':
        return { ok: false, motivo: 'acceso', error: 'Ese cliente no es de tu organización.' }
      default:
        return { ok: false, motivo: 'no_existe', error: 'No encontramos a ese cliente.' }
    }
  }
  const orgId = acceso.orgId
  const supabase = createAdminClient()

  if (await vieneDelPanel()) {
    // El alcance de la cookie: su sucursal (getScopedBranchIds la resuelve igual
    // que el resto del panel).
    const sucursales = await getScopedBranchIds()
    if (sucursales.length === 0) {
      return { ok: false, motivo: 'acceso', error: 'No tenés acceso al historial de este cliente.' }
    }
    const desde = new Date(Date.now() - HORAS_VISITA_RECIENTE_PANEL * 3_600_000).toISOString()
    const [enLaFila, visitaReciente] = await Promise.all([
      supabase
        .from('queue_entries')
        .select('id')
        .eq('client_id', clientId)
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        .in('status', ['waiting', 'in_progress'])
        .limit(1),
      supabase
        .from('visits')
        .select('id')
        .eq('client_id', clientId)
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        .gte('completed_at', desde)
        .limit(1),
    ])
    const fallaAlcance = enLaFila.error ?? visitaReciente.error
    if (fallaAlcance) {
      console.error('[getUltimosCortesDelCliente] alcance del panel', { clientId, message: fallaAlcance.message })
      return { ok: false, motivo: 'error', error: 'No pudimos cargar su historial.' }
    }
    if ((enLaFila.data?.length ?? 0) === 0 && (visitaReciente.data?.length ?? 0) === 0) {
      return {
        ok: false,
        motivo: 'acceso',
        error: 'Sólo podés ver el historial de los clientes que están en la fila de tu sucursal.',
      }
    }
  } else if (!(await currentUserCan('clients.view'))) {
    return { ok: false, motivo: 'acceso', error: 'No tenés permiso para ver clientes.' }
  }

  // Un "corte" es lo mismo que en Estadísticas y Finanzas (KR#31): una venta
  // de productos sola no es un corte del cliente.
  const ES_CORTE = 'service_id.not.is.null,queue_entry_id.not.is.null'

  const [cliente, visitas, conteo] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, notes, instagram')
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    // Embeds por NOMBRE de constraint (KR#15/#17): visits tiene una sola FK a
    // cada una de estas tablas, pero así una FK nueva no rompe esta consulta.
    supabase
      .from('visits')
      .select(
        'id, completed_at, extra_services, ' +
          'barber:staff!visits_barber_id_fkey(id, full_name), ' +
          'service:services!visits_service_id_fkey(name), ' +
          'branch:branches!visits_branch_id_fkey(id, name), ' +
          'fotos:visit_photos!visit_photos_visit_id_fkey(id, storage_path, order_index)',
      )
      .eq('client_id', clientId)
      .eq('organization_id', orgId)
      .or(ES_CORTE)
      .order('completed_at', { ascending: false })
      .limit(limite),
    supabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('organization_id', orgId)
      .or(ES_CORTE),
  ])

  const falla = cliente.error ?? visitas.error ?? conteo.error
  if (falla || !cliente.data) {
    if (falla) console.error('[getUltimosCortesDelCliente]', { clientId, code: falla.code, message: falla.message })
    return falla
      ? { ok: false, motivo: 'error', error: 'No pudimos cargar su historial.' }
      : { ok: false, motivo: 'no_existe', error: 'No encontramos a ese cliente.' }
  }

  type FilaVisita = {
    id: string
    completed_at: string
    extra_services: string[] | null
    barber: { id: string; full_name: string | null } | null
    service: { name: string | null } | null
    branch: { id: string; name: string | null } | null
    fotos: { id: string; storage_path: string; order_index: number | null }[] | null
  }
  const filas = (visitas.data ?? []) as unknown as FilaVisita[]

  // Los extras viajan como ids: una sola consulta para todos sus nombres. Si
  // falla, los cortes se muestran igual (sin los extras) y queda en el log.
  const idsExtras = [...new Set(filas.flatMap((f) => f.extra_services ?? []))]
  const nombresExtras = new Map<string, string>()
  if (idsExtras.length > 0) {
    const { data, error } = await supabase.from('services').select('id, name').in('id', idsExtras)
    if (error) console.error('[getUltimosCortesDelCliente] extras', error.message)
    for (const s of data ?? []) nombresExtras.set(s.id as string, String(s.name).trim())
  }

  const bucket = supabase.storage.from('visit-photos')
  const cortes: CorteDelCliente[] = filas.map((f) => ({
    visitId: f.id,
    fecha: f.completed_at,
    servicio: f.service?.name?.trim() || null,
    extras: (f.extra_services ?? []).map((id) => nombresExtras.get(id)).filter((n): n is string => !!n),
    barbero: f.barber ? { id: f.barber.id, nombre: (f.barber.full_name ?? '').trim() || 'Barbero' } : null,
    sucursal: f.branch ? { id: f.branch.id, nombre: (f.branch.name ?? '').trim() } : null,
    fotos: [...(f.fotos ?? [])]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      .map((foto, i) => ({
        id: foto.id,
        // getPublicUrl arma el string: no sale a la red.
        url: bucket.getPublicUrl(foto.storage_path).data.publicUrl,
        orden: foto.order_index ?? i,
      })),
  }))

  return {
    ok: true,
    cliente: {
      id: cliente.data.id as string,
      nombre: String(cliente.data.name ?? '').trim(),
      notas: ((cliente.data.notes as string | null) ?? '').trim() || null,
      instagram: ((cliente.data.instagram as string | null) ?? '').trim() || null,
    },
    totalVisitas: conteo.count ?? cortes.length,
    cortes,
  }
}

export interface ClientProfileVisit {
  id: string
  completed_at: string
  amount: number
  notes: string | null
  tags: string[] | null
  service_name: string | null
  barber_name: string
  barber_id: string
  branch_id: string
  photos: Array<{ id: string; storage_path: string; order_index: number }>
}

export async function createManualVisit(params: {
  branchId: string
  clientId: string | null
  barberId: string
  serviceId: string
  paymentMethod: 'cash' | 'card' | 'transfer'
  paymentAccountId?: string | null
  amount: number
  completedAt: string
  notes?: string | null
  tags?: string[] | null
}): Promise<{ success: true; visitId: string } | { error: string }> {
  // Usamos el cliente admin igual que completeService — las visitas manuales
  // se registran desde el panel de administración, sin sesión de barber PIN
  const supabase = createAdminClient()

  if (
    !isValidUUID(params?.branchId) ||
    !isValidUUID(params?.barberId) ||
    !isValidUUID(params?.serviceId) ||
    (params.clientId != null && !isValidUUID(params.clientId)) ||
    (params.paymentAccountId != null && params.paymentAccountId !== '' && !isValidUUID(params.paymentAccountId))
  ) {
    return { error: 'Datos inválidos' }
  }
  if (!['cash', 'card', 'transfer'].includes(params.paymentMethod)) return { error: 'Elegí cómo pagó el cliente.' }
  if (!Number.isFinite(params.amount) || params.amount < 0) return { error: 'El importe no es válido.' }
  if (!params.completedAt || Number.isNaN(new Date(params.completedAt).getTime())) {
    return { error: 'La fecha no es válida.' }
  }

  // Es una carga del dashboard: la cookie del panel del barbero no carga visitas
  // a mano (con ella un barbero podía inventarse cortes y comisión). Y la
  // sucursal tiene que estar en el alcance del rol, no sólo en la organización.
  if (await vieneDelPanel()) {
    return { error: 'Las visitas manuales se cargan desde el dashboard, con tu usuario.' }
  }

  // Validar que el branch pertenece a la organización del usuario
  const orgId = await validateBranchAccess(params.branchId)
  if (!orgId) return { error: 'No autorizado' }
  const permitidas = await getScopedBranchIds()
  if (!permitidas.includes(params.branchId)) return { error: 'No tenés acceso a esta sucursal.' }

  // La cuenta de cobro: sólo con transferencia y sólo una de ESTA sucursal (la
  // misma regla que el cobro: una cuenta de otra sucursal consume el tope y el
  // saldo donde no corresponde).
  let cuentaDeLaVisita: string | null = null
  if (params.paymentMethod === 'transfer' && params.paymentAccountId) {
    const { data: cuenta, error: errCuenta } = await supabase
      .from('payment_accounts')
      .select('id')
      .eq('id', params.paymentAccountId)
      .eq('branch_id', params.branchId)
      .maybeSingle()
    if (errCuenta) {
      console.error('createManualVisit: error verificando la cuenta', errCuenta.message)
      return { error: 'No se pudo verificar la cuenta de cobro. Probá de nuevo.' }
    }
    if (!cuenta) return { error: 'La cuenta de cobro elegida no es de esta sucursal.' }
    cuentaDeLaVisita = cuenta.id as string
  }

  // El cliente (si viene) es de esta organización.
  if (params.clientId) {
    const { data: cliente, error: errCliente } = await supabase
      .from('clients')
      .select('id')
      .eq('id', params.clientId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (errCliente) {
      console.error('createManualVisit: error verificando el cliente', errCliente.message)
      return { error: 'No se pudo verificar el cliente. Probá de nuevo.' }
    }
    if (!cliente) return { error: 'Ese cliente no es de tu organización.' }
  }

  // 1. Obtener comisión global: salary_configs → staff.commission_pct como fallback
  const { data: salaryConfig } = await supabase
    .from('salary_configs')
    .select('commission_pct')
    .eq('staff_id', params.barberId)
    .single()

  // El barbero, de ESTA organización (antes cualquier staff_id servía).
  const { data: barber, error: barberError } = await supabase
    .from('staff')
    .select('commission_pct')
    .eq('id', params.barberId)
    .eq('organization_id', orgId)
    .single()

  if (barberError || !barber) {
    console.error('createManualVisit: error obteniendo barbero', barberError)
    return { error: 'No se pudo obtener la información del barbero' }
  }

  // Usar salary_configs como fuente primaria, staff como fallback
  const globalCommissionPct = salaryConfig?.commission_pct ?? barber.commission_pct

  // 2. Obtener comisión por defecto del servicio
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('default_commission_pct, branch_id')
    .eq('id', params.serviceId)
    .single()

  if (serviceError || !service) {
    console.error('createManualVisit: error obteniendo servicio', serviceError)
    return { error: 'No se pudo obtener la información del servicio' }
  }
  // El servicio es de una sucursal de esta organización (los globales, sin
  // sucursal, son legado y se aceptan como en services.ts).
  if (service.branch_id) {
    const { data: sucursalDelServicio } = await supabase
      .from('branches')
      .select('id')
      .eq('id', service.branch_id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!sucursalDelServicio) return { error: 'Ese servicio no es de tu organización.' }
  }

  // 3. Buscar override específico barbero+servicio en staff_service_commissions
  const { data: override } = await supabase
    .from('staff_service_commissions')
    .select('commission_pct')
    .eq('staff_id', params.barberId)
    .eq('service_id', params.serviceId)
    .maybeSingle()

  // 4. Resolver comisión: override → default del servicio → salary_configs → staff
  let commissionPct: number
  if (override) {
    commissionPct = Number(override.commission_pct)
  } else if (Number(service.default_commission_pct) > 0) {
    commissionPct = Number(service.default_commission_pct)
  } else {
    commissionPct = Number(globalCommissionPct)
  }

  const commissionAmount = params.amount * (commissionPct / 100)

  // 5. Insertar la visita manual (sin queue_entry_id).
  //    `prepaid_amount` queda en su default 0 y no se setea a mano: una visita
  //    manual no sale de un turno, así que no hay seña que imputar. Si algún día
  //    se carga a mano el cobro de un turno señado, el camino correcto NO es
  //    escribir esta columna suelta —dejaría la seña en `pagada` para siempre—
  //    sino pasar por `consumirSenaEnCobro` como hace `completeService`.
  const { data: newVisit, error: insertError } = await supabase
    .from('visits')
    .insert({
      branch_id: params.branchId,
      client_id: params.clientId,
      barber_id: params.barberId,
      service_id: params.serviceId,
      queue_entry_id: null,
      payment_method: params.paymentMethod,
      payment_account_id: cuentaDeLaVisita,
      amount: params.amount,
      commission_pct: commissionPct,
      commission_amount: commissionAmount,
      notes: params.notes ?? null,
      tags: params.tags ?? null,
      started_at: params.completedAt,
      completed_at: params.completedAt,
    })
    .select('id')
    .single()

  if (insertError || !newVisit) {
    console.error('createManualVisit: error insertando visita', insertError)
    return { error: 'No se pudo registrar la visita manual' }
  }

  // 6. Programa de fidelización (mig 197): cierre explícito, best-effort. El trigger
  //    del INSERT ya acreditó y recalculó la categoría; esta llamada manda las
  //    notificaciones que dependen del importe final. NUNCA rompe el alta.
  if (params.clientId) {
    try {
      const { error: loyaltyErr } = await supabase.rpc('loyalty_finalize_visit', { p_visit_id: newVisit.id })
      if (loyaltyErr) console.error('[createManualVisit] loyalty_finalize_visit', loyaltyErr.message)
    } catch (err) {
      console.error('[createManualVisit] loyalty_finalize_visit', err)
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/servicios')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/clientes')

  return { success: true, visitId: newVisit.id }
}

export interface ClientVisitPage {
  visits: ClientProfileVisit[]
  totalCount: number
  hasMore: boolean
}

/**
 * Carga paginada del historial de visitas de un cliente.
 * Diseñada para lazy load desde el sheet de detalle — NO se llama en el
 * initial fetch de la página de clientes.
 */
export async function getClientVisits(
  clientId: string,
  opts?: { limit?: number; offset?: number }
): Promise<ClientVisitPage> {
  const orgAccess = await requireOrgAccessToEntity('clients', clientId)
  if (!orgAccess.ok) return { visits: [], totalCount: 0, hasMore: false }

  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0

  const supabase = await createClient()

  const { data: visits, error } = await supabase
    .from('visits')
    .select(
      'id, completed_at, amount, notes, tags, barber_id, branch_id, barber:staff(full_name), service:services(name)'
    )
    .eq('client_id', clientId)
    .order('completed_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('[getClientVisits] error fetching visits', error.message)
    return { visits: [], totalCount: 0, hasMore: false }
  }

  const visitIds = (visits ?? []).map((v) => v.id)

  let photos: Array<{
    visit_id: string
    id: string
    storage_path: string
    order_index: number
  }> = []
  if (visitIds.length > 0) {
    const { data } = await supabase
      .from('visit_photos')
      .select('id, visit_id, storage_path, order_index')
      .in('visit_id', visitIds)
      .order('order_index')
    photos = data ?? []
  }

  const photoMap = new Map<string, typeof photos>()
  for (const p of photos) {
    const arr = photoMap.get(p.visit_id) ?? []
    arr.push(p)
    photoMap.set(p.visit_id, arr)
  }

  const { count } = await supabase
    .from('visits')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const totalCount = count ?? 0

  return {
    visits: (visits ?? []).map((v) => ({
      id: v.id,
      completed_at: v.completed_at,
      amount: v.amount,
      notes: v.notes,
      tags: v.tags,
      service_name:
        (v.service as unknown as { name: string } | null)?.name ?? null,
      barber_name:
        (v.barber as unknown as { full_name: string } | null)?.full_name ?? '?',
      barber_id: v.barber_id,
      branch_id: (v as unknown as { branch_id: string }).branch_id,
      photos: photoMap.get(v.id) ?? [],
    })),
    totalCount,
    hasMore: offset + limit < totalCount,
  }
}

export interface StaffServiceVisit {
  id: string
  amount: number
  payment_method: string
  commission_amount: number
  started_at: string | null
  completed_at: string
  branch_id: string
  service: { name: string } | null
  client: { name: string } | null
  barber: { id: string; full_name: string } | null
}

/**
 * Historial de servicios de un barbero para lazy load en el perfil.
 * Cubre monthsBack meses hacia atrás para soportar el selector de período
 * del panel de detalle (máx. 12 meses).
 */
export async function getStaffServiceHistory(
  staffId: string,
  monthsBack: number = 3
): Promise<{ visits: StaffServiceVisit[]; error?: string }> {
  const orgAccess = await requireOrgAccessToEntity('staff', staffId)
  if (!orgAccess.ok) return { visits: [], error: 'Acceso denegado' }

  const from = new Date()
  from.setMonth(from.getMonth() - (monthsBack - 1))
  from.setDate(1)
  from.setHours(0, 0, 0, 0)

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('visits')
    .select(
      'id, amount, payment_method, commission_amount, started_at, completed_at, branch_id, service:services(name), client:clients(name), barber:staff(id, full_name)'
    )
    .eq('barber_id', staffId)
    .eq('organization_id', orgAccess.orgId)
    .gte('completed_at', from.toISOString())
    .order('completed_at', { ascending: false })

  if (error) {
    console.error('[getStaffServiceHistory] error', error.message)
    return { visits: [], error: error.message }
  }

  return { visits: (data ?? []) as unknown as StaffServiceVisit[] }
}

const BUCKET_FOTOS_DE_VISITAS = 'visit-photos'

/** Quién borra, para el registro: el staff del usuario del dashboard en esta org. */
async function actorDelDashboard(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<{ authUserId: string | null; staffId: string | null; nombre: string | null }> {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return { authUserId: null, staffId: null, nombre: null }
    const { data: staff } = await supabase
      .from('staff')
      .select('id, full_name')
      .eq('auth_user_id', user.id)
      .eq('organization_id', orgId)
      .limit(1)
      .maybeSingle()
    return {
      authUserId: user.id,
      staffId: (staff?.id as string | undefined) ?? null,
      nombre: (staff?.full_name as string | undefined) ?? user.email ?? null,
    }
  } catch {
    return { authUserId: null, staffId: null, nombre: null }
  }
}

/**
 * Borra una visita del historial (dashboard → Servicios y Productos →
 * Historial). Hallazgos fotos-del-corte-05, seguridad-y-despliegue-05 y
 * fotos-del-corte-09:
 *
 * - Permiso explícito `history.delete` (dueños y administradores lo tienen
 *   siempre; un rol, sólo si se lo dan). Antes alcanzaba con ver la sucursal:
 *   cualquier rol del dashboard —y la cookie del barbero, para su sucursal—
 *   podía hacer desaparecer un cobro de Caja, Estadísticas y Finanzas.
 * - La cookie del panel del barbero NUNCA borra visitas.
 * - Una visita con productos vendidos NO se borra: el borrado no sabe devolver
 *   el stock ni descontar la comisión de productos del reporte del día (ni la
 *   del servicio), así que la plata desaparecía y la comisión quedaba pagada.
 *   Vuelve el rechazo explícito hasta que exista esa reversión.
 * - Las fotos se borran del bucket público: visit_photos se iba en CASCADE pero
 *   los objetos quedaban accesibles por URL para siempre, y la limpieza
 *   planeada no los encuentra (tienen fila en qr_photo_uploads y su sesión
 *   tiene visit_id). Se juntan las rutas ANTES del DELETE y se borran después;
 *   también las filas de qr_photo_uploads de esas sesiones.
 * - Queda registro de quién la borró y qué se borró (console.info estructurado,
 *   `[deleteVisit] VISITA_BORRADA`): no hay tabla de auditoría para el
 *   dashboard (panel_activity_logs es del panel, exige staff y su CHECK de
 *   eventos no tiene uno de borrado).
 *
 * La forma de la respuesta no cambia (`{ error?: string }`); `aviso` es nuevo y
 * opcional: el borrado salió pero algo de las fotos quedó a medias.
 */
export async function deleteVisit(
  visitId: string
): Promise<{ error?: string; aviso?: string }> {
  if (!isValidUUID(visitId)) return { error: 'Visita inválida' }

  if (await vieneDelPanel()) {
    return {
      error:
        'Las visitas se borran desde el dashboard, con tu usuario. Si en este navegador está abierto el panel del barbero, cerrá esa sesión primero.',
    }
  }
  // Sin sesión del dashboard, currentUserCan da false: también corta acá.
  if (!(await currentUserCan('history.delete'))) {
    return { error: 'No tenés permiso para borrar visitas del historial. Pedíselo al dueño.' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Tu sesión venció. Volvé a iniciar sesión.' }

  const supabase = createAdminClient()

  const { data: visit, error: errVisita } = await supabase
    .from('visits')
    .select(
      'id, organization_id, branch_id, client_id, barber_id, service_id, queue_entry_id, payment_method, amount, tip_amount, commission_amount, completed_at',
    )
    .eq('id', visitId)
    .maybeSingle()

  if (errVisita) {
    console.error('[deleteVisit] leer visita', errVisita.message)
    return { error: 'No pudimos leer la visita. Probá de nuevo.' }
  }
  if (!visit || visit.organization_id !== orgId) return { error: 'Visita no encontrada' }

  const orgBranchIds = await getScopedBranchIds()
  if (!orgBranchIds.includes(visit.branch_id as string)) return { error: 'No autorizado' }

  // Productos: product_sales.visit_id es NO ACTION a propósito. Se rechaza ANTES
  // de tocar nada (ver el comentario de la función).
  const { count: lineasDeProductos, error: errLineas } = await supabase
    .from('product_sales')
    .select('id', { count: 'exact', head: true })
    .eq('visit_id', visitId)
  if (errLineas) {
    console.error('[deleteVisit] leer productos', errLineas.message)
    return { error: 'No pudimos leer los productos de la visita. Probá de nuevo.' }
  }
  if ((lineasDeProductos ?? 0) > 0) {
    return {
      error:
        'Esta visita tiene productos vendidos: no se puede borrar, porque el sistema todavía no sabe devolver el stock ni descontar la comisión del día. Si fue un error de carga, corregí el importe desde Editar.',
    }
  }

  // Las fotos, ANTES del DELETE: después visit_photos ya no está (CASCADE).
  const [fotosDeVisita, sesionesDeFotos] = await Promise.all([
    supabase.from('visit_photos').select('storage_path').eq('visit_id', visitId),
    supabase.from('qr_photo_sessions').select('id').eq('visit_id', visitId),
  ])
  if (fotosDeVisita.error || sesionesDeFotos.error) {
    console.error('[deleteVisit] leer fotos', fotosDeVisita.error?.message ?? sesionesDeFotos.error?.message)
    return { error: 'No pudimos leer las fotos de la visita. Probá de nuevo.' }
  }
  const idsSesiones = (sesionesDeFotos.data ?? []).map((s) => s.id as string)
  let subidas: Array<{ id: string; storage_path: string }> = []
  if (idsSesiones.length > 0) {
    const { data, error } = await supabase
      .from('qr_photo_uploads')
      .select('id, storage_path')
      .in('session_id', idsSesiones)
    if (error) {
      console.error('[deleteVisit] leer subidas', error.message)
      return { error: 'No pudimos leer las fotos de la visita. Probá de nuevo.' }
    }
    subidas = (data ?? []) as Array<{ id: string; storage_path: string }>
  }
  const rutas = [
    ...new Set(
      [
        ...((fotosDeVisita.data ?? []) as Array<{ storage_path: string }>).map((f) => f.storage_path),
        ...subidas.map((s) => s.storage_path),
      ].filter((r): r is string => typeof r === 'string' && r.length > 0),
    ),
  ]

  const actor = await actorDelDashboard(supabase, orgId)

  const { error } = await supabase.from('visits').delete().eq('id', visitId)
  if (error) {
    console.error('[deleteVisit] borrar visita', { visitId, code: error.code, message: error.message })
    // Otra referencia NO ACTION: un premio canjeado o un pedido de reseña de esa visita.
    if (error.code === '23503') {
      return { error: 'Esta visita tiene un premio canjeado o un pedido de reseña asociado: no se puede borrar desde acá.' }
    }
    return { error: 'No pudimos eliminar la visita. Probá de nuevo.' }
  }

  // Registro: quién, cuándo y qué (la fila ya no existe en la base).
  console.info('[deleteVisit] VISITA_BORRADA', {
    visitId,
    orgId,
    branchId: visit.branch_id,
    clientId: visit.client_id,
    barberId: visit.barber_id,
    serviceId: visit.service_id,
    queueEntryId: visit.queue_entry_id,
    paymentMethod: visit.payment_method,
    amount: Number(visit.amount),
    tipAmount: Number(visit.tip_amount ?? 0),
    commissionAmount: Number(visit.commission_amount ?? 0),
    completedAt: visit.completed_at,
    fotos: rutas.length,
    borradoPor: actor,
    borradoEn: new Date().toISOString(),
  })

  // Fotos: las filas de qr_photo_uploads de las sesiones de esta visita y los
  // objetos del bucket que ninguna OTRA visita use. Nada de esto deshace el
  // borrado: un fallo se loguea y vuelve como aviso.
  let aviso: string | undefined
  if (subidas.length > 0) {
    const { error: errSubidas } = await supabase
      .from('qr_photo_uploads')
      .delete()
      .in('id', subidas.map((s) => s.id))
    if (errSubidas) {
      console.error('[deleteVisit] borrar subidas', { visitId, message: errSubidas.message })
      aviso = 'La visita se borró, pero no pudimos borrar todas sus fotos. Avisale al dueño.'
    }
  }
  if (rutas.length > 0) {
    const { data: enUso, error: errEnUso } = await supabase
      .from('visit_photos')
      .select('storage_path')
      .in('storage_path', rutas)
    if (errEnUso) {
      console.error('[deleteVisit] fotos en uso por otras visitas', { visitId, message: errEnUso.message })
      aviso = 'La visita se borró, pero no pudimos borrar sus fotos. Avisale al dueño.'
    } else {
      const usadas = new Set(((enUso ?? []) as Array<{ storage_path: string }>).map((f) => f.storage_path))
      const aBorrar = rutas.filter((r) => !usadas.has(r))
      if (aBorrar.length > 0) {
        const { error: errStorage } = await supabase.storage.from(BUCKET_FOTOS_DE_VISITAS).remove(aBorrar)
        if (errStorage) {
          console.error('[deleteVisit] borrar objetos', { visitId, rutas: aBorrar, message: errStorage.message })
          aviso = 'La visita se borró, pero no pudimos borrar sus fotos. Avisale al dueño.'
        }
      }
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/servicios')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/clientes')

  return aviso ? { aviso } : {}
}
