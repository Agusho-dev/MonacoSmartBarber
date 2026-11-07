'use server'

/**
 * Ficha de asesoría del cliente (mig 238).
 *
 * El barbero la completa en el panel mientras asesora (cada toque se guarda
 * solo) y la ve la próxima vez que el cliente se sienta. Las tablas son sólo de
 * service role: todo pasa por acá.
 *
 * Puertas:
 * - Leer (`obtenerFichaAsesoria`): la misma que `getUltimosCortesDelCliente`.
 *   Con la cookie del barbero, sólo clientes que estén en la fila de su
 *   sucursal o que se hayan cortado ahí en las últimas 24 h; en el dashboard,
 *   el permiso `clients.view`.
 * - Escribir (`guardarFichaAsesoria`): sólo el panel (cookie FIRMADA + staff
 *   activo, sin exigir fichaje, como `marcarAsesoriaVista`), sobre una entrada
 *   de la fila de su sucursal que sea de ese cliente: esperando, en curso o
 *   cobrada hace menos de 12 h (para terminar la ficha después de cobrar).
 * - La fila (`fichasDeLaFila`): qué clientes de la fila de la sucursal tienen
 *   ficha, para el sello «Ficha» y la receta del que sigue.
 *
 * Interruptor: la ficha se prende POR SUCURSAL con la asesoría
 * (`branches.asesoria_habilitada`, Configuración → «Asesoría en la entrada»).
 * Apagada, sólo se guarda la ficha de quien YA pidió asesoría y la fila no
 * muestra ninguna. Leer no se corta (es el historial del cliente).
 *
 * Todo export de un archivo 'use server' es un endpoint HTTP: cada uno valida
 * lo que recibe. Un error de lectura vuelve como error, nunca como «no tiene
 * ficha» (Known Risk #13).
 */

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { leerBarberSession } from '@/lib/barber-cookie'
import { requireOrgAccessToEntity } from './guard'
import { getScopedBranchIds } from './branch-access'
import { currentUserCan } from './permissions-gate'
import {
  fichaVacia,
  leerDatosFicha,
  limpiarCambiosFicha,
  type FotoDeFicha,
  type PreviaFicha,
  type ResultadoFichaAsesoria,
  type ResultadoFichasDeLaFila,
  type ResultadoGuardadoFicha,
} from '@/lib/asesoria/ficha'

type ClienteAdmin = ReturnType<typeof createAdminClient>

/** Horas hacia atrás en que el panel ve a un cliente que ya se cortó (igual que el historial). */
const HORAS_VISITA_RECIENTE_PANEL = 24
/** Hasta cuánto después de cobrar se puede seguir completando la ficha de esa visita. */
const HORAS_EDICION_TRAS_COBRO = 12
/** Sesiones que se miran para el «antes» y la foto de referencia. */
const SESIONES_A_MIRAR = 12
/** Fotos de referencia que se devuelven. */
const TOPE_FOTOS = 4
/** Clientes por pedido de `fichasDeLaFila`. */
const TOPE_CLIENTES_FILA = 80

const SESION_VENCIDA = 'Tu sesión venció. Volvé a entrar con tu PIN.'
const NO_SE_PUDO_LEER = 'No pudimos cargar la ficha de asesoría.'
const NO_SE_PUDO_GUARDAR = 'No pudimos guardar la ficha.'

/** El staff de la cookie firmada del panel, o null (no hay, no es válida). */
async function staffDeLaCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const valor = cookieStore.get('barber_session')?.value
  const sesion = valor ? leerBarberSession(valor) : null
  return sesion && isValidUUID(sesion.staff_id) ? sesion.staff_id : null
}

/**
 * ¿La sucursal tiene la asesoría prendida? (`branches.asesoria_habilitada`,
 * mig 217: el mismo interruptor prende la ficha en el panel). null = no se pudo
 * leer: cada llamador decide.
 */
async function asesoriaPrendida(supabase: ClienteAdmin, orgId: string, branchId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('asesoria_habilitada')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) {
    console.error('[fichaAsesoria] interruptor de la sucursal', { branchId, message: error.message })
    return null
  }
  return data?.asesoria_habilitada === true
}

/**
 * ¿El panel puede ver a este cliente? Está en la fila de una de sus sucursales
 * (esperando o en curso) o se cortó ahí en las últimas 24 h. La misma regla que
 * el historial de cortes (hallazgo fotos-del-corte-04): los ids de cliente se
 * consiguen fácil y la ficha tiene datos de salud.
 */
async function clienteAlAlcanceDelPanel(
  supabase: ClienteAdmin,
  orgId: string,
  clienteId: string,
): Promise<true | { ok: false; motivo: 'acceso' | 'error'; error: string }> {
  const sucursales = await getScopedBranchIds()
  if (sucursales.length === 0) {
    return { ok: false, motivo: 'acceso', error: 'No tenés acceso a la ficha de este cliente.' }
  }
  const desde = new Date(Date.now() - HORAS_VISITA_RECIENTE_PANEL * 3_600_000).toISOString()
  const [enLaFila, visitaReciente] = await Promise.all([
    supabase
      .from('queue_entries')
      .select('id')
      .eq('client_id', clienteId)
      .eq('organization_id', orgId)
      .in('branch_id', sucursales)
      .in('status', ['waiting', 'in_progress'])
      .limit(1),
    supabase
      .from('visits')
      .select('id')
      .eq('client_id', clienteId)
      .eq('organization_id', orgId)
      .in('branch_id', sucursales)
      .gte('completed_at', desde)
      .limit(1),
  ])
  const falla = enLaFila.error ?? visitaReciente.error
  if (falla) {
    console.error('[fichaAsesoria] alcance del panel', { clienteId, message: falla.message })
    return { ok: false, motivo: 'error', error: NO_SE_PUDO_LEER }
  }
  if ((enLaFila.data?.length ?? 0) === 0 && (visitaReciente.data?.length ?? 0) === 0) {
    return {
      ok: false,
      motivo: 'acceso',
      error: 'Sólo podés ver la ficha de los clientes que están en la fila de tu sucursal.',
    }
  }
  return true
}

/**
 * La ficha de asesoría de un cliente, cómo estaba antes de esta visita (para el
 * «antes: …» de cada pregunta) y la foto del corte de la última visita en que
 * se completó.
 *
 * `entradaId` (opcional): la entrada de la fila desde la que se mira. Si en esa
 * visita ya se tocó la ficha, el «antes» es cómo estaba al empezarla; si no, es
 * la ficha tal como está.
 */
export async function obtenerFichaAsesoria(
  clienteId: string,
  entradaId?: string | null,
): Promise<ResultadoFichaAsesoria> {
  if (typeof clienteId !== 'string' || !isValidUUID(clienteId)) {
    return { ok: false, motivo: 'datos', error: 'Cliente inválido.' }
  }
  if (entradaId != null && (typeof entradaId !== 'string' || !isValidUUID(entradaId))) {
    return { ok: false, motivo: 'datos', error: 'Entrada inválida.' }
  }

  const acceso = await requireOrgAccessToEntity('clients', clienteId)
  if (!acceso.ok) {
    switch (acceso.reason) {
      case 'no_session':
        return {
          ok: false,
          motivo: 'sesion',
          error: (await staffDeLaCookie()) ? SESION_VENCIDA : 'Tu sesión venció. Volvé a iniciar sesión.',
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

  if (await staffDeLaCookie()) {
    const alcance = await clienteAlAlcanceDelPanel(supabase, orgId, clienteId)
    if (alcance !== true) return alcance
  } else if (!(await currentUserCan('clients.view'))) {
    return { ok: false, motivo: 'acceso', error: 'No tenés permiso para ver clientes.' }
  }

  const { data: filas, error: errFicha } = await supabase.rpc('asesoria_ficha_de', {
    p_org: orgId,
    p_cliente: clienteId,
  })
  if (errFicha) {
    console.error('[obtenerFichaAsesoria] ficha', { clienteId, code: errFicha.code, message: errFicha.message })
    return { ok: false, motivo: 'error', error: NO_SE_PUDO_LEER }
  }
  type FilaFicha = {
    id: string
    client_id: string
    datos: unknown
    actualizada_por: string | null
    created_at: string
    updated_at: string
  }
  const fila = ((filas ?? []) as FilaFicha[])[0]
  if (!fila) return { ok: true, ficha: null, previa: null, fotos: [] }

  const { data: sesiones, error: errSesiones } = await supabase
    .from('client_asesoria_sesiones')
    .select('queue_entry_id, staff_id, datos_antes, created_at, updated_at')
    .eq('asesoria_id', fila.id)
    .order('created_at', { ascending: false })
    .limit(SESIONES_A_MIRAR)
  if (errSesiones) {
    console.error('[obtenerFichaAsesoria] sesiones', { clienteId, message: errSesiones.message })
    return { ok: false, motivo: 'error', error: NO_SE_PUDO_LEER }
  }
  type FilaSesion = {
    queue_entry_id: string | null
    staff_id: string | null
    datos_antes: unknown
    created_at: string
    updated_at: string
  }
  const lista = (sesiones ?? []) as FilaSesion[]
  const actual = entradaId ? lista.find((s) => s.queue_entry_id === entradaId) : undefined
  const anteriores = lista.filter((s) => s !== actual)
  const ultimaAnterior = anteriores[0]

  const idsStaff = [...new Set([fila.actualizada_por, ultimaAnterior?.staff_id].filter((x): x is string => !!x))]
  const entradasAnteriores = [
    ...new Set(anteriores.map((s) => s.queue_entry_id).filter((x): x is string => !!x)),
  ]

  const [staffRes, visitasRes] = await Promise.all([
    idsStaff.length > 0
      ? supabase.from('staff').select('id, full_name').eq('organization_id', orgId).in('id', idsStaff)
      : null,
    // La foto de referencia: la visita de la última sesión anterior que tenga
    // fotos. Embed por NOMBRE de constraint (KR#15).
    entradasAnteriores.length > 0
      ? supabase
          .from('visits')
          .select('id, completed_at, fotos:visit_photos!visit_photos_visit_id_fkey(id, storage_path, order_index)')
          .eq('organization_id', orgId)
          .in('queue_entry_id', entradasAnteriores)
          .order('completed_at', { ascending: false })
          .limit(SESIONES_A_MIRAR)
      : null,
  ])
  if (staffRes?.error) console.error('[obtenerFichaAsesoria] staff', staffRes.error.message)
  if (visitasRes?.error) {
    // La foto acompaña: sin ella la ficha se muestra igual, y queda en el log.
    console.error('[obtenerFichaAsesoria] fotos', visitasRes.error.message)
  }
  const nombres = new Map(
    ((staffRes?.data ?? []) as Array<{ id: string; full_name: string | null }>).map((s) => [
      s.id,
      (s.full_name ?? '').trim() || 'Barbero',
    ]),
  )

  const datos = leerDatosFicha(fila.datos)
  let previa: PreviaFicha | null
  if (actual) {
    const antes = leerDatosFicha(actual.datos_antes)
    previa = fichaVacia(antes)
      ? null
      : {
          datos: antes,
          fecha: ultimaAnterior?.updated_at ?? null,
          barbero: ultimaAnterior?.staff_id ? (nombres.get(ultimaAnterior.staff_id) ?? null) : null,
        }
  } else {
    previa = fichaVacia(datos)
      ? null
      : {
          datos,
          fecha: fila.updated_at,
          barbero: fila.actualizada_por ? (nombres.get(fila.actualizada_por) ?? null) : null,
        }
  }

  type FilaVisita = {
    id: string
    completed_at: string
    fotos: Array<{ id: string; storage_path: string; order_index: number | null }> | null
  }
  const bucket = supabase.storage.from('visit-photos')
  const conFotos = ((visitasRes?.error ? [] : (visitasRes?.data ?? [])) as unknown as FilaVisita[]).find(
    (v) => (v.fotos?.length ?? 0) > 0,
  )
  const fotos: FotoDeFicha[] = conFotos
    ? [...(conFotos.fotos ?? [])]
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .slice(0, TOPE_FOTOS)
        .map((f) => ({
          id: f.id,
          // getPublicUrl arma el string: no sale a la red.
          url: bucket.getPublicUrl(f.storage_path).data.publicUrl,
          fecha: conFotos.completed_at,
        }))
    : []

  return {
    ok: true,
    ficha: {
      id: fila.id,
      clienteId: fila.client_id,
      datos,
      creadaEn: fila.created_at,
      actualizadaEn: fila.updated_at,
      actualizadaPor: fila.actualizada_por
        ? { id: fila.actualizada_por, nombre: nombres.get(fila.actualizada_por) ?? 'Barbero' }
        : null,
      visitas: Math.max(lista.length, 1),
    },
    previa,
    fotos,
  }
}

/**
 * Guarda un cambio parcial de la ficha (lo que el barbero tocó desde el último
 * guardado). Lo llama el panel con cada toque, de a uno y con un respiro, y
 * reintenta solo si falla: por eso es idempotente (pisar una clave con el mismo
 * valor no cambia nada).
 */
export async function guardarFichaAsesoria(pedido: {
  clienteId: string
  entradaId: string
  cambios: unknown
  quitar: unknown
}): Promise<ResultadoGuardadoFicha> {
  const clienteId = pedido?.clienteId
  const entradaId = pedido?.entradaId
  if (typeof clienteId !== 'string' || !isValidUUID(clienteId) || typeof entradaId !== 'string' || !isValidUUID(entradaId)) {
    return { ok: false, motivo: 'datos', error: 'Datos inválidos.' }
  }
  const limpio = limpiarCambiosFicha(pedido.cambios, pedido.quitar)
  if (!limpio.ok) return { ok: false, motivo: 'datos', error: limpio.error }

  const staffId = await staffDeLaCookie()
  if (!staffId) {
    return { ok: false, motivo: 'sesion', error: 'La ficha de asesoría se completa desde el panel del barbero.' }
  }

  const supabase = createAdminClient()
  const [staffRes, entradaRes] = await Promise.all([
    supabase.from('staff').select('id, organization_id').eq('id', staffId).eq('is_active', true).maybeSingle(),
    supabase
      .from('queue_entries')
      .select('organization_id, branch_id, client_id, status, is_break, pidio_asesoria, completed_at')
      .eq('id', entradaId)
      .maybeSingle(),
  ])
  if (staffRes.error || entradaRes.error) {
    console.error('[guardarFichaAsesoria] lectura', {
      entradaId,
      staff: staffRes.error?.message,
      entrada: entradaRes.error?.message,
    })
    return { ok: false, motivo: 'error', error: NO_SE_PUDO_GUARDAR }
  }
  const staff = staffRes.data
  const entrada = entradaRes.data
  if (!staff) return { ok: false, motivo: 'sesion', error: SESION_VENCIDA }
  if (!entrada || entrada.organization_id !== staff.organization_id || entrada.is_break) {
    return { ok: false, motivo: 'entrada', error: 'No encontramos ese lugar de la fila.' }
  }
  if (entrada.client_id !== clienteId) {
    return { ok: false, motivo: 'entrada', error: 'Ese lugar de la fila es de otro cliente.' }
  }

  const sucursales = await getScopedBranchIds()
  if (!sucursales.includes(entrada.branch_id as string)) {
    return { ok: false, motivo: 'acceso', error: 'Ese cliente está en la fila de otra sucursal.' }
  }

  // La ficha se prende por sucursal con la asesoría. Apagada, sólo se guarda la
  // de quien YA pidió asesoría (un pedido hecho se respeta, como en el kiosko).
  if (entrada.pidio_asesoria !== true) {
    const prendida = await asesoriaPrendida(supabase, staff.organization_id as string, entrada.branch_id as string)
    if (prendida === null) return { ok: false, motivo: 'error', error: NO_SE_PUDO_GUARDAR }
    if (!prendida) {
      return { ok: false, motivo: 'acceso', error: 'La ficha de asesoría todavía no está activada en esta sucursal.' }
    }
  }

  const vigente =
    entrada.status === 'waiting' ||
    entrada.status === 'in_progress' ||
    (entrada.status === 'completed' &&
      !!entrada.completed_at &&
      Date.now() - new Date(entrada.completed_at as string).getTime() < HORAS_EDICION_TRAS_COBRO * 3_600_000)
  if (!vigente) {
    return { ok: false, motivo: 'entrada', error: 'Esa visita ya se cerró: la ficha se actualiza la próxima vez que venga.' }
  }

  const { data, error } = await supabase.rpc('asesoria_guardar', {
    p_org: staff.organization_id,
    p_cliente: clienteId,
    p_entrada: entradaId,
    p_sucursal: entrada.branch_id,
    p_staff: staff.id,
    p_pidio: entrada.pidio_asesoria === true,
    p_cambios: limpio.cambios,
    p_quitar: limpio.quitar,
  })
  if (error) {
    console.error('[guardarFichaAsesoria] guardar', { entradaId, code: error.code, message: error.message })
    return { ok: false, motivo: 'error', error: NO_SE_PUDO_GUARDAR }
  }
  const r = (data ?? {}) as { id?: string | null; datos?: unknown; updated_at?: string | null }
  return {
    ok: true,
    datos: leerDatosFicha(r.datos),
    fichaId: r.id ?? null,
    actualizadaEn: r.updated_at ?? null,
  }
}

/**
 * Qué clientes de la fila de una sucursal tienen ficha de asesoría (con sus
 * datos, que pesan poco): el sello «Ficha» de las tarjetas y la receta del que
 * sigue. Sólo el panel, sólo su sucursal y sólo clientes que están en esa fila.
 */
export async function fichasDeLaFila(branchId: string, clienteIds: string[]): Promise<ResultadoFichasDeLaFila> {
  if (typeof branchId !== 'string' || !isValidUUID(branchId) || !Array.isArray(clienteIds)) {
    return { ok: false, error: 'Datos inválidos.' }
  }
  const ids = [...new Set(clienteIds.filter((id): id is string => typeof id === 'string' && isValidUUID(id)))].slice(
    0,
    TOPE_CLIENTES_FILA,
  )
  if (ids.length === 0) return { ok: true, fichas: {} }

  const staffId = await staffDeLaCookie()
  if (!staffId) return { ok: false, error: SESION_VENCIDA }

  const supabase = createAdminClient()
  const { data: staff, error: errStaff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle()
  if (errStaff) {
    console.error('[fichasDeLaFila] staff', errStaff.message)
    return { ok: false, error: NO_SE_PUDO_LEER }
  }
  if (!staff) return { ok: false, error: SESION_VENCIDA }

  const sucursales = await getScopedBranchIds()
  if (!sucursales.includes(branchId)) return { ok: false, error: 'No tenés acceso a esa sucursal.' }

  // Con la asesoría apagada en la sucursal la fila no muestra fichas.
  const prendida = await asesoriaPrendida(supabase, staff.organization_id as string, branchId)
  if (prendida === null) return { ok: false, error: NO_SE_PUDO_LEER }
  if (!prendida) return { ok: true, fichas: {} }

  const { data: enLaFila, error: errFila } = await supabase
    .from('queue_entries')
    .select('client_id')
    .eq('organization_id', staff.organization_id)
    .eq('branch_id', branchId)
    .in('status', ['waiting', 'in_progress'])
    .in('client_id', ids)
  if (errFila) {
    console.error('[fichasDeLaFila] fila', errFila.message)
    return { ok: false, error: NO_SE_PUDO_LEER }
  }
  const delaFila = [...new Set((enLaFila ?? []).map((e) => e.client_id as string).filter(Boolean))]
  if (delaFila.length === 0) return { ok: true, fichas: {} }

  const { data: fichas, error: errFichas } = await supabase
    .from('client_asesorias')
    .select('client_id, datos, updated_at')
    .eq('organization_id', staff.organization_id)
    .in('client_id', delaFila)
  if (errFichas) {
    console.error('[fichasDeLaFila] fichas', errFichas.message)
    return { ok: false, error: NO_SE_PUDO_LEER }
  }

  const salida: Record<string, { datos: ReturnType<typeof leerDatosFicha>; actualizadaEn: string }> = {}
  for (const f of (fichas ?? []) as Array<{ client_id: string; datos: unknown; updated_at: string }>) {
    const datos = leerDatosFicha(f.datos)
    if (!fichaVacia(datos)) salida[f.client_id] = { datos, actualizadaEn: f.updated_at }
  }
  return { ok: true, fichas: salida }
}
