'use server'

/**
 * Asesoría sin costo en la tablet de entrada (migración 217).
 *
 * «¿No sabés qué hacerte?»: el cliente pide que el barbero lo asesore antes de
 * empezar. En la tablet la asesoría REEMPLAZA la elección de servicio; el panel
 * del barbero recibe el aviso de llegada (derivado de la fila, sin escrituras) y
 * un pop-up al atenderlo; al cobrar, elegir el servicio es obligatorio, o se
 * cierra como «solo asesoría» sin visita.
 *
 * Dónde vive cada pieza:
 * - Anotarse pidiéndola: `checkinClient` (FormData `asesoria=1`) y
 *   `checkinClientByFace` (quinto parámetro) en `./queue`.
 * - Cobro obligatorio y cierre sin visita: `completeService` y
 *   `cerrarSoloAsesoria` en `./queue`.
 * - Este archivo: pedirla desde «Mi turno», confirmar el pop-up del panel, el
 *   interruptor por sucursal del dashboard y las métricas de la tarjeta
 *   (`obtenerMetricasAsesoria`).
 * - En la base: el trigger de la mig 221 rechaza cerrar como cobrada una
 *   asesoría sin servicio (red para los paneles con el bundle viejo).
 *
 * Todo export de un archivo 'use server' es un endpoint HTTP: cada uno valida lo
 * que recibe y su puerta (pública con prueba de posesión, cookie firmada del
 * barbero o permiso del dashboard). Sin FK nueva a `staff` (Known Risk #15) y
 * sin tocar grants (Known Risk #34): las escrituras van con service role.
 */

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { leerBarberSession } from '@/lib/barber-cookie'
import { getCurrentOrgId } from './org'
import { getCurrentUserPermissions } from './permissions-gate'
import { assertBranchAccess, getScopedBranchIds } from './branch-access'

type ClienteAdmin = ReturnType<typeof createAdminClient>

/** Fondo de la tablet cuando ni la sucursal ni la organización eligieron uno (el mismo del kiosko). */
const FONDO_CHECKIN_POR_DEFECTO = '#3f3f46'

// ═══════════════════════════════════════════════════════════════════════════
// Kiosko (público)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interruptor de la sucursal, con tres valores: `true`/`false` si se pudo leer
 * y `null` si no. Cada llamador decide qué hacer con el `null`: el kiosko no
 * muestra el botón (falla cerrada) y un pedido ya hecho se respeta (falla
 * abierta).
 */
async function leerInterruptor(
  supabase: ClienteAdmin,
  branchId: string,
  contexto: string,
): Promise<{ habilitada: boolean | null; activa: boolean | null }> {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('is_active, asesoria_habilitada')
      .eq('id', branchId)
      .maybeSingle()
    if (error) {
      console.error(`[${contexto}] interruptor de asesoría:`, { branchId, error: error.message })
      return { habilitada: null, activa: null }
    }
    if (!data) return { habilitada: false, activa: false }
    return { habilitada: data.asesoria_habilitada === true, activa: data.is_active !== false }
  } catch (err) {
    console.error(`[${contexto}] interruptor de asesoría:`, {
      branchId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { habilitada: null, activa: null }
  }
}

/**
 * ¿La tablet de esta sucursal ofrece asesoría? Pública (el kiosko no tiene
 * sesión) y sólo devuelve el booleano. Falla CERRADA: id inválido, sucursal
 * inactiva o error de lectura dan `false` — sin el interruptor confirmado la
 * tablet no muestra el botón. (`getCheckinData` ya lo trae en `asesoria`; esto
 * sirve para releerlo sin recargar toda la fila.)
 */
export async function asesoriaHabilitadaEnSucursal(branchId: string): Promise<boolean> {
  if (typeof branchId !== 'string' || !isValidUUID(branchId)) return false
  const { habilitada, activa } = await leerInterruptor(createAdminClient(), branchId, 'asesoriaHabilitadaEnSucursal')
  return habilitada === true && activa === true
}

/** Por qué no se pudo sumar el pedido desde «Mi turno». */
export type MotivoPedidoAsesoria =
  /** Ids mal formados. */
  | 'invalida'
  /** La entrada no existe o no es de este cliente (mensaje genérico a propósito). */
  | 'no_encontrada'
  /** Ya lo están atendiendo: que se lo diga al barbero. */
  | 'en_curso'
  /** La entrada ya se cerró (cobrada o fuera de la fila). */
  | 'no_activa'
  /** La sucursal apagó la asesoría (o la sucursal está inactiva). */
  | 'deshabilitada'
  /**
   * Es la entrada de un TURNO: no se le suma la marca. Un turno no tiene la
   * salida «solo asesoría» (cancelarlo lo pasa a no_show y pierde la seña), así
   * que el kiosko no tiene que ofrecérsela: que lo hable con su barbero.
   */
  | 'turno'
  /** Demasiados pedidos seguidos desde esta tablet. */
  | 'limite'
  /** Falló la base: se puede reintentar. */
  | 'error'

export type ResultadoPedirAsesoria =
  | { success: true; yaLaHabiaPedido: boolean }
  | { error: string; motivo: MotivoPedidoAsesoria }

const NO_SE_PUDO_PEDIR = 'No pudimos sumar tu pedido de asesoría. Probá de nuevo.'
const AVISALE_AL_BARBERO = 'Avisale a tu barbero que querés asesoría.'
const ES_UN_TURNO = 'Como tenés turno, pedile la asesoría a tu barbero cuando te atienda.'

/**
 * «Pedir asesoría» desde «Mi turno»: el cliente que YA espera se suma la marca.
 *
 * Misma puerta que `reassignMyBarber`: prueba de posesión (el kiosko conoce el
 * `client_id` de SU entrada; mensaje genérico si no coincide, para no revelar
 * si existe) y rate-limit por IP+sucursal (bucket propio, mismos 10 por minuto:
 * así no le come el cupo a los cambios de barbero, y todos los clientes del
 * local comparten la IP de la tablet). Sólo entradas `waiting` de ese cliente,
 * nunca un descanso.
 *
 * El interruptor de la sucursal se revalida, con falla ABIERTA si no se puede
 * leer: el cliente ya vio el botón, y negarle la ayuda por un error nuestro es
 * peor que un aviso de más.
 *
 * Si ya lo están atendiendo devuelve `motivo: 'en_curso'` con el texto
 * «Avisale a tu barbero que querés asesoría.»: no se toca un corte en curso.
 * Si la entrada es de un turno devuelve `motivo: 'turno'` sin escribir nada
 * (hallazgo asesoria-04: la asesoría de un turno no tiene cierre sin cobro).
 *
 * Riesgo conocido y anotado: la «prueba de posesión» es el `client_id`, que la
 * anon key lee de cualquier entrada en espera (queue_entries_anon_read). Atarla
 * a un token firmado que sólo tenga el kiosko que identificó al cliente queda
 * pendiente; hoy la acotan el rate limit y que la sucursal tenga la asesoría
 * prendida.
 */
export async function pedirAsesoriaDesdeMiTurno(
  entryId: string,
  ownerClientId: string,
): Promise<ResultadoPedirAsesoria> {
  if (
    typeof entryId !== 'string' ||
    typeof ownerClientId !== 'string' ||
    !isValidUUID(entryId) ||
    !isValidUUID(ownerClientId)
  ) {
    return { error: 'Datos inválidos', motivo: 'invalida' }
  }

  const supabase = createAdminClient()

  const { data: entry, error: errEntry } = await supabase
    .from('queue_entries')
    .select('branch_id, client_id, status, is_break, pidio_asesoria, appointment_id')
    .eq('id', entryId)
    .maybeSingle()

  if (errEntry) {
    console.error('[pedirAsesoriaDesdeMiTurno] leer la entrada:', { entryId, error: errEntry.message })
    return { error: NO_SE_PUDO_PEDIR, motivo: 'error' }
  }
  // Prueba de posesión. Un descanso no tiene cliente, así que tampoco pasa.
  if (!entry || entry.client_id !== ownerClientId || entry.is_break) {
    return { error: 'Entrada no encontrada', motivo: 'no_encontrada' }
  }

  if (entry.status === 'in_progress') return { error: AVISALE_AL_BARBERO, motivo: 'en_curso' }
  if (entry.status !== 'waiting') {
    return { error: 'Tu lugar en la fila ya no está activo.', motivo: 'no_activa' }
  }
  if (entry.appointment_id) return { error: ES_UN_TURNO, motivo: 'turno' }
  // Ya la había pedido (al anotarse o con un toque anterior): nada que escribir.
  if (entry.pidio_asesoria === true) return { success: true, yaLaHabiaPedido: true }

  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskAsesoria(entry.branch_id)
  if (!gate.allowed) {
    return { error: 'Demasiados pedidos en poco tiempo. Esperá un momento.', motivo: 'limite' }
  }

  const interruptor = await leerInterruptor(supabase, entry.branch_id, 'pedirAsesoriaDesdeMiTurno')
  if (interruptor.habilitada === null) {
    // Falla abierta: ver el comentario de la función.
    console.error('[pedirAsesoriaDesdeMiTurno] sin interruptor confirmado; se respeta el pedido', { entryId })
  } else if (!interruptor.activa) {
    return { error: 'Sucursal no encontrada o inactiva', motivo: 'deshabilitada' }
  } else if (!interruptor.habilitada) {
    return { error: 'La asesoría no está disponible en esta sucursal.', motivo: 'deshabilitada' }
  }

  // Condicionada a todo lo que se validó: si en el medio lo empezaron a atender,
  // no se le cambia nada a un corte en curso; si un check-in de turno adoptó la
  // entrada, tampoco.
  const { data: marcadas, error: errUpdate } = await supabase
    .from('queue_entries')
    .update({ pidio_asesoria: true })
    .eq('id', entryId)
    .eq('client_id', ownerClientId)
    .eq('status', 'waiting')
    .eq('is_break', false)
    .eq('pidio_asesoria', false)
    .is('appointment_id', null)
    .select('id')

  if (errUpdate) {
    console.error('[pedirAsesoriaDesdeMiTurno] marcar la entrada:', { entryId, error: errUpdate.message })
    return { error: NO_SE_PUDO_PEDIR, motivo: 'error' }
  }

  if (!marcadas || marcadas.length === 0) {
    // Cambió entre la lectura y la escritura: se pregunta qué pasó.
    const { data: ahora, error: errAhora } = await supabase
      .from('queue_entries')
      .select('status, pidio_asesoria, appointment_id')
      .eq('id', entryId)
      .maybeSingle()
    if (errAhora) {
      console.error('[pedirAsesoriaDesdeMiTurno] releer la entrada:', { entryId, error: errAhora.message })
      return { error: NO_SE_PUDO_PEDIR, motivo: 'error' }
    }
    if (ahora?.status === 'waiting' && ahora.pidio_asesoria === true) {
      return { success: true, yaLaHabiaPedido: true }
    }
    if (ahora?.status === 'in_progress') return { error: AVISALE_AL_BARBERO, motivo: 'en_curso' }
    if (ahora?.status === 'waiting' && ahora.appointment_id) return { error: ES_UN_TURNO, motivo: 'turno' }
    return { error: 'Tu lugar en la fila ya no está activo.', motivo: 'no_activa' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true, yaLaHabiaPedido: false }
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel del barbero
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El barbero confirmó el pop-up de asesoría («Entendido» o cualquier cierre).
 *
 * Puerta: la cookie FIRMADA `barber_session` + `staff` activo + misma
 * organización que la entrada. NO `getBarberSession`: exige un fichaje de
 * entrada vigente y, después del cron de auto-clockout, el pop-up no se podría
 * confirmar mientras cobrar sigue andando.
 *
 * Sólo marca la entrada del PROPIO barbero (`barber_id` = el de la sesión), que
 * pidió asesoría y todavía no la tenía vista. Idempotente: si no hay nada que
 * marcar (ya vista, reasignada a otro, doble toque) devuelve `{ ok: true }`.
 * El pop-up es optimista: con `{ ok: false }` muestra el aviso y, como la
 * entrada sigue sin `asesoria_vista_at`, al recargar vuelve a aparecer.
 */
export async function marcarAsesoriaVista(
  queueEntryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof queueEntryId !== 'string' || !isValidUUID(queueEntryId)) {
    return { ok: false, error: 'Entrada inválida.' }
  }

  const cookieStore = await cookies()
  const valorCookie = cookieStore.get('barber_session')?.value
  const sesion = valorCookie ? leerBarberSession(valorCookie) : null
  if (!sesion || !isValidUUID(sesion.staff_id)) {
    return { ok: false, error: 'Tu sesión venció. Volvé a entrar con tu PIN.' }
  }

  const supabase = createAdminClient()
  const [staffRes, entradaRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id, organization_id')
      .eq('id', sesion.staff_id)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('queue_entries')
      .select('organization_id, barber_id, pidio_asesoria, asesoria_vista_at')
      .eq('id', queueEntryId)
      .maybeSingle(),
  ])

  if (staffRes.error || entradaRes.error) {
    console.error('[marcarAsesoriaVista] lectura:', {
      queueEntryId,
      staff: staffRes.error?.message,
      entrada: entradaRes.error?.message,
    })
    return { ok: false, error: 'No pudimos registrar la asesoría.' }
  }
  const staff = staffRes.data
  const entrada = entradaRes.data
  if (!staff) return { ok: false, error: 'Tu sesión venció. Volvé a entrar con tu PIN.' }
  if (!entrada || entrada.organization_id !== staff.organization_id) {
    return { ok: false, error: 'Entrada no encontrada.' }
  }

  // Nada que marcar: ya vista, no pidió asesoría o ya no es de este barbero.
  if (entrada.pidio_asesoria !== true || entrada.asesoria_vista_at || entrada.barber_id !== staff.id) {
    return { ok: true }
  }

  const { error } = await supabase
    .from('queue_entries')
    .update({ asesoria_vista_at: new Date().toISOString() })
    .eq('id', queueEntryId)
    .eq('pidio_asesoria', true)
    .is('asesoria_vista_at', null)
    .eq('barber_id', staff.id)

  if (error) {
    console.error('[marcarAsesoriaVista] marcar:', { queueEntryId, error: error.message })
    return { ok: false, error: 'No pudimos registrar la asesoría.' }
  }

  // Sin revalidatePath: el panel se entera por Realtime (y ya cerró el pop-up
  // de forma optimista).
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard: interruptor por sucursal (/dashboard/configuracion)
// ═══════════════════════════════════════════════════════════════════════════

/** Una sucursal en la tarjeta «Asesoría en la entrada». */
export interface SucursalAsesoria {
  id: string
  name: string
  /** Las inactivas sólo vienen si quedaron con la asesoría prendida (para poder apagarla). */
  is_active: boolean
  asesoria_habilitada: boolean
  /** Color propio de la sucursal para la tablet; null = usa el de la organización. */
  checkin_bg_color: string | null
  /**
   * El fondo que la tablet usa DE VERDAD (para «Así la ve el cliente»): el de la
   * sucursal o, si no tiene, el de la organización (`#3f3f46` por defecto) —
   * la misma regla que `/checkin`.
   */
  fondo_checkin: string
}

/**
 * Sucursales de la organización con su interruptor de asesoría, para la tarjeta
 * de `/dashboard/configuracion`. Sólo las que el usuario puede ver (un encargado
 * de una sucursal no ve las otras), activas o con la asesoría prendida.
 *
 * `sinPermiso` = sin `settings.view`: la página no muestra la tarjeta (un
 * «Reintentar» no arregla un permiso). `puedeEditar` = tiene `settings.manage`.
 */
export async function obtenerAsesoriaSucursales(): Promise<
  | { ok: true; sucursales: SucursalAsesoria[]; puedeEditar: boolean }
  | { ok: false; error: string; sinPermiso?: boolean }
> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.view'] !== true) {
    return { ok: false, error: 'No tenés permiso para ver la configuración.', sinPermiso: true }
  }
  const puedeEditar = permisos['settings.manage'] === true

  const scopedIds = await getScopedBranchIds()
  if (scopedIds.length === 0) return { ok: true, sucursales: [], puedeEditar }

  const supabase = createAdminClient()
  const [sucursalesRes, ajustesRes] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name, is_active, asesoria_habilitada, checkin_bg_color')
      .eq('organization_id', orgId)
      .in('id', scopedIds)
      .order('name'),
    // `app_settings` siempre por organización (anon ve las 14 filas, y acá corre
    // con service role: sin el filtro sería la de cualquiera).
    supabase
      .from('app_settings')
      .select('checkin_bg_color')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (sucursalesRes.error) {
    console.error('[obtenerAsesoriaSucursales] branches:', sucursalesRes.error.message)
    return { ok: false, error: 'No pudimos leer las sucursales. Probá de nuevo.' }
  }
  // El fondo sólo ilustra la vista previa: si no se puede leer, el por defecto.
  if (ajustesRes.error) {
    console.error('[obtenerAsesoriaSucursales] app_settings:', ajustesRes.error.message)
  }
  const colorOrg = ajustesRes.error ? null : (ajustesRes.data?.checkin_bg_color as string | null | undefined)
  const fondoOrganizacion =
    typeof colorOrg === 'string' && colorOrg.trim() ? colorOrg.trim() : FONDO_CHECKIN_POR_DEFECTO

  const sucursales: SucursalAsesoria[] = ((sucursalesRes.data ?? []) as Array<Record<string, unknown>>)
    .map((b) => {
      const color = typeof b.checkin_bg_color === 'string' ? b.checkin_bg_color : null
      return {
        id: String(b.id),
        name: String(b.name ?? '').trim(),
        is_active: b.is_active !== false,
        asesoria_habilitada: b.asesoria_habilitada === true,
        checkin_bg_color: color,
        fondo_checkin: color?.trim() || fondoOrganizacion,
      }
    })
    .filter((s) => s.is_active || s.asesoria_habilitada)

  return { ok: true, sucursales, puedeEditar }
}

/**
 * Prende o apaga la asesoría en la tablet de UNA sucursal. Escribe sólo
 * `branches.asesoria_habilitada` y confirma con el rowcount: si no tocó
 * ninguna fila lo dice, en vez de devolver un éxito vacío (Known Risk #5/#13).
 *
 * Devuelve el estado que quedó en la base, para que la tarjeta confirme su
 * cambio optimista con el dato real.
 */
export async function actualizarAsesoriaSucursal(
  branchId: string,
  habilitada: boolean,
): Promise<
  | { ok: true; sucursal: { id: string; name: string; asesoria_habilitada: boolean } }
  | { ok: false; error: string }
> {
  if (typeof branchId !== 'string' || !isValidUUID(branchId) || typeof habilitada !== 'boolean') {
    return { ok: false, error: 'Datos inválidos.' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.manage'] !== true) {
    return { ok: false, error: 'No tenés permiso para cambiar la configuración.' }
  }

  // La sucursal es de la organización activa y el rol la alcanza.
  const acceso = await assertBranchAccess(branchId)
  if (!acceso.ok || acceso.orgId !== orgId) return { ok: false, error: 'No tenés acceso a esa sucursal.' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('branches')
    .update({ asesoria_habilitada: habilitada })
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .select('id, name, asesoria_habilitada')

  if (error) {
    console.error('[actualizarAsesoriaSucursal]', { branchId, habilitada, error: error.message })
    return { ok: false, error: 'No pudimos guardar el cambio. Probá de nuevo.' }
  }
  const fila = data?.[0]
  if (!fila) {
    return { ok: false, error: 'No encontramos la sucursal: no se guardó nada.' }
  }

  revalidatePath('/dashboard/configuracion')
  revalidatePath('/checkin')
  return {
    ok: true,
    sucursal: {
      id: String(fila.id),
      name: String(fila.name ?? '').trim(),
      asesoria_habilitada: fila.asesoria_habilitada === true,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard: cómo le va a la asesoría (tarjeta de /dashboard/configuracion)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las cuentas de la asesoría en un período. Siempre cierran:
 * `pidieron = cobradas + soloAsesoria + pendientes + salieron`.
 */
export interface MetricasAsesoria {
  /** Entradas que pidieron asesoría (al anotarse o desde «Mi turno»). */
  pidieron: number
  /** Terminaron en un cobro (la entrada se completó: hay visita). */
  cobradas: number
  /** Se asesoraron y no se hicieron nada: cerradas sin visita (`solo_asesoria`). */
  soloAsesoria: number
  /** Todavía en la fila: esperando o en curso. */
  pendientes: number
  /** Se fueron sin atenderse: «no se presentó», vencidas a la noche, otra sucursal… */
  salieron: number
  /** Suma de `visits.amount` de las cobradas (importe final, con descuentos). */
  montoCobradas: number
  /** Ticket promedio de las cobradas con visita; null si no hubo ninguna. */
  ticketPromedio: number | null
}

export interface MetricasAsesoriaBarbero extends MetricasAsesoria {
  /** null = todavía sin barbero (esperando en «Menor espera»). */
  barberoId: string | null
  nombre: string
}

export interface MetricasAsesoriaSucursal extends MetricasAsesoria {
  branchId: string
  nombre: string
  /** De más pedidos a menos. */
  barberos: MetricasAsesoriaBarbero[]
}

export type ResultadoMetricasAsesoria =
  | {
      ok: true
      /** Ventana móvil hacia atrás desde ahora, por fecha de anotación. */
      dias: number
      /** ISO del comienzo de la ventana. */
      desde: string
      total: MetricasAsesoria
      /** Sólo las sucursales con algún pedido en la ventana. */
      sucursales: MetricasAsesoriaSucursal[]
    }
  | { ok: false; error: string; sinPermiso?: boolean }

/** Acumulador interno: suma cantidades e importe, y cuenta las cobradas con visita. */
type Acumulado = Omit<MetricasAsesoria, 'ticketPromedio'> & { conVisita: number }

function acumuladoVacio(): Acumulado {
  return { pidieron: 0, cobradas: 0, soloAsesoria: 0, pendientes: 0, salieron: 0, montoCobradas: 0, conVisita: 0 }
}

function cerrarAcumulado(a: Acumulado): MetricasAsesoria {
  return {
    pidieron: a.pidieron,
    cobradas: a.cobradas,
    soloAsesoria: a.soloAsesoria,
    pendientes: a.pendientes,
    salieron: a.salieron,
    montoCobradas: Math.round(a.montoCobradas * 100) / 100,
    ticketPromedio: a.conVisita > 0 ? Math.round((a.montoCobradas / a.conVisita) * 100) / 100 : null,
  }
}

const DIAS_METRICAS_POR_DEFECTO = 30
const DIAS_METRICAS_MAXIMO = 90
const PAGINA_METRICAS = 1000
const LOTE_VISITAS_METRICAS = 100

/**
 * Cómo le va a la asesoría en los últimos `dias` días (30 por defecto, de 1 a
 * 90), por sucursal y por barbero: cuántos la pidieron, cuántos terminaron
 * cobrados (con su ticket promedio), cuántos se cerraron como «solo asesoría»
 * sin visita, cuántos siguen en la fila y cuántos se fueron (hallazgo
 * asesoria-05: hasta ahora ningún tablero mostraba los cierres sin cobro, y el
 * dueño no podía medir la función ni ver un abuso por barbero).
 *
 * Permiso `settings.view` (la tarjeta vive en /dashboard/configuracion) y sólo
 * las sucursales que el rol alcanza. La organización la pone el servidor, nunca
 * el browser. Un error de lectura vuelve como error, nunca como ceros (KR#5/#13).
 *
 * El barbero de una entrada es el que la atendió (`queue_entries.barber_id`):
 * para un «solo asesoría», el que la cerró sin cobro. `cancelled_by` dice quién
 * tocó el botón (el barbero o alguien del dashboard) y queda en la base.
 */
export async function obtenerMetricasAsesoria(opciones?: { dias?: number }): Promise<ResultadoMetricasAsesoria> {
  const pedido = Math.floor(Number(opciones?.dias ?? DIAS_METRICAS_POR_DEFECTO))
  const dias = Number.isFinite(pedido) && pedido >= 1 ? Math.min(pedido, DIAS_METRICAS_MAXIMO) : DIAS_METRICAS_POR_DEFECTO

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }

  const permisos = await getCurrentUserPermissions()
  if (permisos['settings.view'] !== true) {
    return { ok: false, error: 'No tenés permiso para ver la configuración.', sinPermiso: true }
  }

  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const scopedIds = await getScopedBranchIds()
  if (scopedIds.length === 0) {
    return { ok: true, dias, desde, total: cerrarAcumulado(acumuladoVacio()), sucursales: [] }
  }

  const supabase = createAdminClient()
  const FALLA = 'No pudimos calcular cómo le va a la asesoría. Probá de nuevo.'

  // 1) Las entradas que pidieron asesoría en la ventana (paginado: PostgREST
  //    corta en 1000 filas sin avisar).
  type Entrada = {
    id: string
    branch_id: string
    barber_id: string | null
    status: string
    cancel_reason: string | null
    is_break: boolean | null
  }
  const entradas: Entrada[] = []
  for (let desdeFila = 0; ; desdeFila += PAGINA_METRICAS) {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('id, branch_id, barber_id, status, cancel_reason, is_break')
      .eq('organization_id', orgId)
      .in('branch_id', scopedIds)
      .eq('pidio_asesoria', true)
      .gte('checked_in_at', desde)
      .order('checked_in_at', { ascending: true })
      .order('id', { ascending: true })
      .range(desdeFila, desdeFila + PAGINA_METRICAS - 1)
    if (error) {
      console.error('[obtenerMetricasAsesoria] entradas:', error.message)
      return { ok: false, error: FALLA }
    }
    const filas = (data ?? []) as Entrada[]
    entradas.push(...filas.filter((e) => e.is_break !== true))
    if (filas.length < PAGINA_METRICAS) break
  }

  if (entradas.length === 0) {
    return { ok: true, dias, desde, total: cerrarAcumulado(acumuladoVacio()), sucursales: [] }
  }

  // 2) El importe de las cobradas, por visita (de a lotes: la URL tiene tope).
  const cobradas = entradas.filter((e) => e.status === 'completed').map((e) => e.id)
  const importePorEntrada = new Map<string, number>()
  for (let i = 0; i < cobradas.length; i += LOTE_VISITAS_METRICAS) {
    const lote = cobradas.slice(i, i + LOTE_VISITAS_METRICAS)
    const { data, error } = await supabase
      .from('visits')
      .select('queue_entry_id, amount')
      .eq('organization_id', orgId)
      .in('queue_entry_id', lote)
    if (error) {
      console.error('[obtenerMetricasAsesoria] visitas:', error.message)
      return { ok: false, error: FALLA }
    }
    for (const v of (data ?? []) as Array<{ queue_entry_id: string | null; amount: number | string }>) {
      if (v.queue_entry_id) importePorEntrada.set(v.queue_entry_id, Number(v.amount ?? 0))
    }
  }

  // 3) Nombres: sucursales y barberos (una consulta cada uno).
  const idsSucursales = [...new Set(entradas.map((e) => e.branch_id))]
  const idsBarberos = [...new Set(entradas.map((e) => e.barber_id).filter((id): id is string => !!id))]
  const [sucursalesRes, barberosRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', idsSucursales),
    idsBarberos.length > 0
      ? supabase.from('staff').select('id, full_name').eq('organization_id', orgId).in('id', idsBarberos)
      : null,
  ])
  if (sucursalesRes.error || barberosRes?.error) {
    console.error('[obtenerMetricasAsesoria] nombres:', sucursalesRes.error?.message ?? barberosRes?.error?.message)
    return { ok: false, error: FALLA }
  }
  const nombreSucursal = new Map(
    ((sucursalesRes.data ?? []) as Array<{ id: string; name: string | null }>).map((b) => [b.id, String(b.name ?? '').trim()]),
  )
  const nombreBarbero = new Map(
    ((barberosRes?.data ?? []) as Array<{ id: string; full_name: string | null }>).map((s) => [
      s.id,
      String(s.full_name ?? '').trim() || 'Barbero',
    ]),
  )

  // 4) Cuentas.
  const sumar = (a: Acumulado, e: Entrada) => {
    a.pidieron += 1
    if (e.status === 'completed') {
      a.cobradas += 1
      const importe = importePorEntrada.get(e.id)
      if (importe !== undefined) {
        a.montoCobradas += importe
        a.conVisita += 1
      }
    } else if (e.status === 'cancelled') {
      if (e.cancel_reason === 'solo_asesoria') a.soloAsesoria += 1
      else a.salieron += 1
    } else {
      a.pendientes += 1
    }
  }

  const total = acumuladoVacio()
  const porSucursal = new Map<string, { acumulado: Acumulado; barberos: Map<string, Acumulado> }>()
  for (const e of entradas) {
    sumar(total, e)
    let suc = porSucursal.get(e.branch_id)
    if (!suc) {
      suc = { acumulado: acumuladoVacio(), barberos: new Map() }
      porSucursal.set(e.branch_id, suc)
    }
    sumar(suc.acumulado, e)
    const claveBarbero = e.barber_id ?? ''
    let barb = suc.barberos.get(claveBarbero)
    if (!barb) {
      barb = acumuladoVacio()
      suc.barberos.set(claveBarbero, barb)
    }
    sumar(barb, e)
  }

  const sucursales: MetricasAsesoriaSucursal[] = [...porSucursal.entries()]
    .map(([branchId, s]) => ({
      branchId,
      nombre: nombreSucursal.get(branchId) || 'Sucursal',
      ...cerrarAcumulado(s.acumulado),
      barberos: [...s.barberos.entries()]
        .map(([clave, a]) => ({
          barberoId: clave || null,
          nombre: clave ? nombreBarbero.get(clave) ?? 'Barbero' : 'Sin barbero asignado',
          ...cerrarAcumulado(a),
        }))
        .sort((x, y) => y.pidieron - x.pidieron || x.nombre.localeCompare(y.nombre, 'es')),
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))

  return { ok: true, dias, desde, total: cerrarAcumulado(total), sucursales }
}
