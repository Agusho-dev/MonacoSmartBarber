'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import { getActiveTimezone } from '@/lib/i18n'
import { isValidUUID } from '@/lib/validation'
import { formatCurrency } from '@/lib/format'
import { leerBarberSession } from '@/lib/barber-cookie'
import { getBarberSession } from './auth'
import type { MotivoPedidoAsesoria } from './asesoria'
import {
  asTierChange,
  couponErrorMessage,
  parseReferralQr,
  referralErrorMessage,
  type CouponErrorExtra,
  type LoyaltyFinalizeResult,
} from '@/lib/loyalty-checkout'
import { consumirSenaEnCobro } from '@/lib/senas/motor'
import {
  registrarProductosDeVisita,
  validarLineasDeProductos,
  type LineaValidada,
} from '@/lib/productos/venta'
import { vincularFotosDelCobro } from '@/lib/fotos-corte/servidor'

/**
 * Resuelve si el cliente ya tiene lugar en la fila, distinguiendo **esta** sucursal
 * de las otras. La distinción no es cosmética.
 *
 * El chequeo original preguntaba por `client_id` sin filtrar `branch_id`, así que un
 * cliente con una entrada viva en OTRA sucursal recibía `alreadyInQueue` y la tablet
 * lo mandaba a la pantalla "ya tenés lugar, puesto 29" — con la posición y la espera
 * de un local en el que no estaba parado. El cliente se sentaba a esperar un turno
 * que ningún barbero de ESTA sucursal podía ver, hasta que alguien le cancelaba la
 * entrada vieja y recién ahí podía anotarse. Es exactamente el "me registré y no
 * estoy en la fila" que reportó el dueño (caso Rodrigo Greco, 4/9/2026: entrada viva
 * en Paraná a las 14:18, atendido en Rondeau recién 74 minutos después).
 *
 * El índice único que de verdad existe es `idx_queue_unique_active_client` sobre
 * (client_id, **branch_id**): dos sucursales nunca chocaron entre sí. El pre-chequeo
 * era más estricto que la base.
 *
 * La entrada de la otra sucursal se cancela: la persona está físicamente acá, así
 * que allá es un fantasma que le va a hacer perder un llamado a un barbero. Queda
 * auditada con `cancel_reason = 'moved_to_other_branch'`.
 */
async function resolverEntradaActiva(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  branchId: string,
) {
  const { data: activas } = await supabase
    .from('queue_entries')
    .select('id, position, status, barber_id, branch_id, appointment_id')
    .eq('client_id', clientId)
    .in('status', ['waiting', 'in_progress'])
    .order('checked_in_at', { ascending: false })

  const filas = activas ?? []
  const enEstaSucursal = filas.find(e => e.branch_id === branchId) ?? null
  const enOtras = filas.filter(e => e.branch_id !== branchId)

  if (!enEstaSucursal && enOtras.length > 0) {
    // Sólo las que ESPERAN: si en la otra sucursal ya lo están atendiendo, el dato
    // raro es éste y no aquél — no le cortamos un corte en curso desde otro local.
    const aCancelar = enOtras.filter(e => e.status === 'waiting').map(e => e.id)
    if (aCancelar.length > 0) {
      const { error } = await supabase
        .from('queue_entries')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'moved_to_other_branch',
        })
        .in('id', aCancelar)
        .eq('status', 'waiting')
      if (error) console.error('[resolverEntradaActiva] cancelar fantasma:', error.message)
    }
  }

  return { enEstaSucursal, enOtras }
}

// ─── Asesoría sin costo (mig 217) ───────────────────────────────────────────
//
// «¿No sabés qué hacerte?»: el cliente pide que el barbero lo asesore antes de
// empezar. En la tablet REEMPLAZA la elección de servicio (la entrada nace con
// `service_id` NULL y `pidio_asesoria = true`), el panel le avisa al barbero y,
// al cobrar, el servicio pasa a ser obligatorio — o se cierra como «solo
// asesoría», sin visita (`cerrarSoloAsesoria`). Las acciones propias de la
// asesoría (pedirla desde «Mi turno», confirmar el pop-up, el interruptor del
// dashboard) viven en `./asesoria`.

/** `queue_entries.cancel_reason` de una asesoría que se cerró sin hacer nada. */
const MOTIVO_SOLO_ASESORIA = 'solo_asesoria'

/**
 * ¿La sucursal ofrece asesoría? Revalida en el servidor el interruptor que la
 * tablet ya leyó con `getCheckinData`: si el dueño la apagó mientras el cliente
 * elegía, la marca se descarta y el check-in sigue igual que siempre.
 *
 * Falla ABIERTA a propósito: si no se puede leer el interruptor, se respeta el
 * pedido (con el error en el log). El check-in nunca se bloquea por la
 * asesoría, y lo peor que puede pasar es un aviso de más en el panel de una
 * sucursal que la tenía apagada — contra un cliente que pidió ayuda y ningún
 * barbero se enteró.
 */
async function asesoriaPermitidaEnSucursal(
  supabase: ReturnType<typeof createAdminClient>,
  branchId: string,
  contexto: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('asesoria_habilitada')
      .eq('id', branchId)
      .maybeSingle()
    if (error) {
      console.error(`[${contexto}] no se pudo leer el interruptor de asesoría; se respeta el pedido:`, error.message)
      return true
    }
    if (!data) {
      console.error(`[${contexto}] la sucursal no apareció al leer el interruptor de asesoría; se respeta el pedido`, { branchId })
      return true
    }
    return data.asesoria_habilitada === true
  } catch (err) {
    console.error(
      `[${contexto}] excepción al leer el interruptor de asesoría; se respeta el pedido:`,
      err instanceof Error ? err.message : String(err),
    )
    return true
  }
}

/**
 * El cliente que YA tenía lugar en esta sucursal se vuelve a anotar pidiendo
 * asesoría (la tablet lo reconoce y lo manda a «Mi turno»). Mientras espera, la
 * marca se le suma a la entrada que ya tiene; si ya lo están atendiendo no se
 * toca nada y la tablet le dice que se lo avise al barbero.
 *
 * `asesoriaPedida` = la pidió en ESTE check-in; `asesoriaSumada` = quedó en su
 * entrada. Con las dos claves el kiosko distingue «Sumamos tu pedido…» de
 * «Avisale a tu barbero…» sin adivinar. `asesoriaMotivo` dice por qué NO se
 * sumó (null = se sumó o no la pidió), con los mismos valores que
 * `pedirAsesoriaDesdeMiTurno`.
 *
 * Una entrada de TURNO no la recibe (motivo `turno`): un turno no tiene la
 * salida «solo asesoría» (cancelarlo lo pasa a no_show y pierde la seña), así
 * que la marca dejaría al barbero sin forma de cerrarlo si no se hizo nada.
 *
 * Esta escritura también pasa por el bucket `kiosk_asesoria` (10 por minuto por
 * IP y sucursal, el mismo de «Mi turno»): antes se podía marcar cualquier
 * entrada en espera a través de `checkinClientByFace`, que no tenía ningún límite.
 */
async function sumarAsesoriaAEntradaActiva(
  supabase: ReturnType<typeof createAdminClient>,
  entrada: { id: string; status: string; appointment_id?: string | null } | null,
  pedido: { pidio: boolean; permitida: boolean },
  branchId: string,
  contexto: string,
): Promise<{ asesoriaPedida: boolean; asesoriaSumada: boolean; asesoriaMotivo: MotivoPedidoAsesoria | null }> {
  if (!pedido.pidio) return { asesoriaPedida: false, asesoriaSumada: false, asesoriaMotivo: null }
  const noSumada = (motivo: MotivoPedidoAsesoria) => ({ asesoriaPedida: true, asesoriaSumada: false, asesoriaMotivo: motivo })

  if (!entrada) return noSumada('no_activa')
  if (entrada.status === 'in_progress') return noSumada('en_curso')
  if (entrada.status !== 'waiting') return noSumada('no_activa')
  if (!pedido.permitida) return noSumada('deshabilitada')
  if (entrada.appointment_id) return noSumada('turno')

  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskAsesoria(branchId)
  if (!gate.allowed) return noSumada('limite')

  // Condicionada a 'waiting' y a que no sea un turno: si en el medio lo
  // empezaron a atender (el pop-up del panel lo dispararía a mitad del corte) o
  // un check-in de turno adoptó la entrada, no se le cambia nada.
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ pidio_asesoria: true })
    .eq('id', entrada.id)
    .eq('status', 'waiting')
    .eq('is_break', false)
    .is('appointment_id', null)
    .select('id')
  if (error) {
    console.error(`[${contexto}] no se pudo sumar la asesoría a la entrada que ya tenía:`, error.message)
    return noSumada('error')
  }
  const sumada = (data?.length ?? 0) > 0
  if (!sumada) return noSumada('no_activa')
  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { asesoriaPedida: true, asesoriaSumada: true, asesoriaMotivo: null }
}

/**
 * Quién hace una acción sobre la fila, para `cancelled_by` (mig 211): la X de
 * «no se presentó» y el cierre «solo asesoría».
 *
 * En el panel del barbero el actor sale de la cookie FIRMADA `barber_session`
 * (no hay usuario de Supabase Auth ahí) y se confirma contra `staff` activo de
 * la organización. No se usa `getBarberSession` porque exige un fichaje de
 * entrada vigente: después del cron de auto-clockout las acciones de la fila
 * siguen andando (validateBranchAccess no mira el fichaje) y la salida quedaba
 * anotada con `cancelled_by` NULL, que la mig 211 reserva para los procesos
 * automáticos. En el dashboard, el `staff` del usuario logueado en ESA
 * organización. Si no se puede resolver queda NULL: el `cancelled_at` y el
 * motivo igual se estampan.
 */
async function resolverActorStaffId(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const valorCookie = cookieStore.get('barber_session')?.value
    if (valorCookie) {
      const sesion = leerBarberSession(valorCookie)
      if (sesion && isValidUUID(sesion.staff_id)) {
        const { data: staffPanel, error: errPanel } = await supabase
          .from('staff')
          .select('id')
          .eq('id', sesion.staff_id)
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .maybeSingle()
        if (errPanel) console.error('[resolverActorStaffId] staff del panel:', errPanel.message)
        if (staffPanel?.id) return staffPanel.id as string
      }
    }

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      const { data: staffRow, error: errStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (errStaff) console.error('[resolverActorStaffId] staff del dashboard:', errStaff.message)
      return (staffRow?.id as string | undefined) ?? null
    }
  } catch (err) {
    console.error('[resolverActorStaffId]', err instanceof Error ? err.message : String(err))
  }
  return null
}

/**
 * Por qué no se puede cobrar una entrada que ya salió de la fila. Distingue la
 * asesoría cerrada sin cobro (la otra tablet ya la resolvió) de la X de «no se
 * presentó»: son dos cosas que el barbero resuelve distinto.
 */
function mensajeDeEntradaCancelada(cancelReason: string | null | undefined): string {
  return cancelReason === MOTIVO_SOLO_ASESORIA
    ? 'Esta asesoría se cerró sin cobro desde otro dispositivo.'
    : 'Este cliente salió de la fila: no se puede cobrar.'
}

const MENSAJE_CORTE_SIN_EMPEZAR = 'El corte de este cliente todavía no empezó: inicialo antes de cobrar.'

/** Rechazo del cobro de una asesoría sin servicio PRINCIPAL (paso 0' de completeService). */
const MENSAJE_ASESORIA_SIN_SERVICIO = 'Elegí qué le hiciste o cerralo como solo asesoría.'

/** Transferencia sin cuenta en una sucursal que tiene cuentas activas (paso 0c). */
const MENSAJE_FALTA_CUENTA = 'Falta la cuenta de cobro: recargá el panel y elegí a qué cuenta transfirió.'

/** Extras por cobro. Uno real tiene uno o dos; esto es sólo una defensa del endpoint. */
const TOPE_EXTRAS_POR_COBRO = 20

const NOMBRE_DEL_METODO: Record<'cash' | 'card' | 'transfer', string> = {
  cash: 'efectivo',
  card: 'tarjeta',
  transfer: 'transferencia',
}

/**
 * Código máquina de los rechazos de `completeService`, para que la pantalla no
 * dependa de comparar textos:
 * - `asesoria_sin_servicio`: pidió asesoría y no vino un servicio principal.
 * - `servicio_invalido`: un servicio que no existe, es de otra sucursal o está
 *   dado de baja (la lista de la pantalla quedó vieja).
 * - `falta_cuenta`: transferencia sin cuenta de cobro en una sucursal con cuentas.
 * - `cuenta_invalida`: la cuenta elegida no es de esta sucursal.
 * - `lectura`: no se pudo leer un dato del cobro; la entrada quedó intacta.
 * - `visita_sin_importe`: la entrada se cerró pero no se pudo leer la visita
 *   para escribirle el importe (NO cobrar de nuevo).
 */
export type CodigoRechazoCobro =
  | 'asesoria_sin_servicio'
  | 'servicio_invalido'
  | 'falta_cuenta'
  | 'cuenta_invalida'
  | 'lectura'
  | 'visita_sin_importe'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * El staff de la cookie FIRMADA del panel (`barber_session`), o null si la
 * request no viene del panel. Mismo criterio que `getCurrentOrgId`: con la
 * cookie válida, manda la cookie. Que ese staff esté activo y sea de la org ya
 * lo exige `validateBranchAccess` (resuelve la org contra `staff` activo).
 */
async function staffDeLaCookieDelPanel(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const valor = cookieStore.get('barber_session')?.value
    if (!valor) return null
    const sesion = leerBarberSession(valor)
    return sesion && isValidUUID(sesion.staff_id) ? sesion.staff_id : null
  } catch {
    return null
  }
}

/**
 * Arranca el descanso del barbero si estaba esperando a que termine este
 * cliente. Es el paso 6 de completeService, compartido con cerrarSoloAsesoria:
 * los dos dejan al barbero libre, y un descanso aprobado no tiene por qué
 * esperar a que alguien toque nada.
 *
 * Rollback intencional del push-on-complete (estaba en mig 131): arrancar
 * automáticamente el siguiente CLIENTE rompía el flujo natural de barbería — el
 * cronómetro disparaba aunque el cliente no estuviera todavía en la silla,
 * generando "cortes fantasma" que el supervisor tenía que cancelar (incidente
 * Fabrizio/Santino vela, 2026-05-09 22:14). El descanso SÍ debe arrancar solo:
 * el barbero ya lo solicitó y se lo aprobaron, no requiere presencia física del
 * cliente. El siguiente cliente se inicia con tap manual de "Atender".
 *
 * Política: el ghost arranca si NO hay clientes ASIGNADOS específicamente a este
 * barbero antes de él (priority menor). Los dinámicos no bloquean. Si el
 * barbero ya tomó a otro cliente, idx_queue_one_in_progress_per_barber rechaza
 * el arranque y no pasa nada.
 */
async function arrancarDescansoPendiente(
  supabase: AdminClient,
  barberId: string | null,
  branchId: string,
): Promise<boolean> {
  if (!barberId) return false

  const { data: nextGhosts, error: errGhosts } = await supabase
    .from('queue_entries')
    .select('id, priority_order')
    .eq('barber_id', barberId)
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .eq('is_break', true)
    .order('priority_order', { ascending: true })
    .limit(1)
  if (errGhosts) console.error('[arrancarDescansoPendiente] leer descansos:', errGhosts.message)
  if (!nextGhosts || nextGhosts.length === 0) return false

  const nextGhost = nextGhosts[0]
  const { data: realWaitingBeforeBreak, error: errAntes } = await supabase
    .from('queue_entries')
    .select('id')
    .eq('barber_id', barberId)
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .eq('is_break', false)
    .lt('priority_order', nextGhost.priority_order)
    .limit(1)
  if (errAntes) {
    console.error('[arrancarDescansoPendiente] leer clientes antes del descanso:', errAntes.message)
    return false
  }
  if (realWaitingBeforeBreak && realWaitingBeforeBreak.length > 0) return false

  const { error: ghostStartError } = await supabase
    .from('queue_entries')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', nextGhost.id)
    .eq('status', 'waiting')
  if (ghostStartError) {
    console.error('[arrancarDescansoPendiente] arrancar el descanso:', ghostStartError.message)
    return false
  }
  return true
}

const BUCKET_FOTOS_DEL_CORTE = 'visit-photos'

/**
 * Cierra las sesiones de fotos de una entrada que terminó SIN visita («solo
 * asesoría») y borra lo que se subió: la fila de qr_photo_uploads y el objeto
 * del bucket. Sin esto, la sesión seguía aceptando fotos 45 minutos y todo lo
 * que subía el celular quedaba huérfano, con la cara del cliente en un bucket
 * público y sin visita a la que pertenecer (hallazgo asesoria-06).
 *
 * Orden, y por qué:
 *   1. Se cierran las sesiones abiertas (is_active = false). Desde ahí
 *      fotos_registrar_subida rechaza cualquier foto nueva (lee la sesión con
 *      el advisory lock de la entrada tomado).
 *   2. BARRERA: fotos_quitar_foto con un id que no existe toma ese MISMO lock y
 *      no toca nada. Si una confirmación del celular estaba en vuelo (leyó la
 *      sesión abierta antes del paso 1), la barrera espera a que termine; las
 *      que lleguen después ya ven la sesión cerrada. Sin la barrera, esa foto
 *      podía registrarse DESPUÉS de juntar la lista y quedar huérfana.
 *   3. Se borran las filas (la fila primero y el objeto después, igual que
 *      fotos_quitar_foto: un objeto sin fila es un archivo de más que no se
 *      muestra en ningún lado —la limpieza de huérfanos está planeada, todavía
 *      no existe: por eso ese caso vuelve como aviso—; una fila sin objeto es
 *      una foto rota en la ficha).
 *   4. Se borran los objetos, pero SÓLO los que tienen la forma que firma el
 *      servidor: `<organization_id>/<id de SU sesión>/…`. Defensa en
 *      profundidad: una fila plantada con la ruta de una foto ajena (o de otro
 *      corte) no puede hacer que borremos un objeto real. Esa fila se quita
 *      igual, pero su objeto no se toca (mismo criterio que
 *      descartarFotosDeEntrada en src/lib/fotos-corte/servidor.ts).
 *
 * Best-effort: nunca lanza ni hace fallar el cierre. Devuelve un aviso para la
 * pantalla si algo quedó a medias (null si no había fotos o salió todo).
 */
async function descartarFotosSinVisita(supabase: AdminClient, queueEntryId: string): Promise<string | null> {
  const AVISO = 'La asesoría quedó cerrada, pero no pudimos borrar las fotos que se sacaron. Avisale al encargado.'
  try {
    const { error: errCerrar } = await supabase
      .from('qr_photo_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('queue_entry_id', queueEntryId)
      .eq('proposito', 'fotos')
      .is('visit_id', null)
      .eq('is_active', true)
    if (errCerrar) {
      console.error('[descartarFotosSinVisita] cerrar sesiones:', { queueEntryId, error: errCerrar.message })
    }

    const { data: sesiones, error: errSesiones } = await supabase
      .from('qr_photo_sessions')
      .select('id, organization_id')
      .eq('queue_entry_id', queueEntryId)
      .eq('proposito', 'fotos')
      .is('visit_id', null)
    if (errSesiones) {
      console.error('[descartarFotosSinVisita] leer sesiones:', { queueEntryId, error: errSesiones.message })
      return AVISO
    }
    // Sesión → organización: la ruta de cada foto se valida contra la de SU sesión.
    const orgDeSesion = new Map((sesiones ?? []).map((s) => [s.id as string, s.organization_id as string]))
    const idsSesiones = [...orgDeSesion.keys()]
    if (idsSesiones.length === 0) return errCerrar ? AVISO : null

    // Barrera (ver el comentario de arriba). Un error acá no corta: la limpieza
    // sigue y, en el peor caso, una foto en vuelo queda para la limpieza de
    // sesiones vencidas sin visita.
    const { error: errBarrera } = await supabase.rpc('fotos_quitar_foto', {
      p_queue_entry_id: queueEntryId,
      p_upload_id: crypto.randomUUID(),
    })
    if (errBarrera) {
      console.error('[descartarFotosSinVisita] barrera:', { queueEntryId, error: errBarrera.message })
    }

    const { data: borradas, error: errBorrar } = await supabase
      .from('qr_photo_uploads')
      .delete()
      .in('session_id', idsSesiones)
      .select('storage_path, session_id')
    if (errBorrar) {
      console.error('[descartarFotosSinVisita] borrar filas:', { queueEntryId, error: errBorrar.message })
      return AVISO
    }

    // Sólo se borran del bucket las rutas `<org>/<su sesión>/…`. Las demás (una
    // fila plantada, o la forma `qr-<token>/…` del flujo viejo) ya no tienen
    // fila, pero su objeto no se toca: no hay forma de saber de quién es.
    const rutasPropias = new Set<string>()
    const rutasAjenas: string[] = []
    for (const fila of borradas ?? []) {
      const ruta = String(fila.storage_path ?? '')
      if (!ruta) continue
      const sesionId = String(fila.session_id ?? '')
      const org = orgDeSesion.get(sesionId)
      if (org && ruta.startsWith(`${org}/${sesionId}/`)) rutasPropias.add(ruta)
      else rutasAjenas.push(ruta)
    }
    if (rutasAjenas.length > 0) {
      console.warn('[descartarFotosSinVisita] rutas que no son de su sesión: se quitó la fila, el objeto no se borra', {
        queueEntryId,
        rutas: rutasAjenas,
      })
    }

    const rutas = [...rutasPropias]
    if (rutas.length > 0) {
      const { error: errStorage } = await supabase.storage.from(BUCKET_FOTOS_DEL_CORTE).remove(rutas)
      if (errStorage) {
        console.error('[descartarFotosSinVisita] borrar objetos:', { queueEntryId, rutas, error: errStorage.message })
        return AVISO
      }
    }
    return errCerrar ? AVISO : null
  } catch (err) {
    console.error('[descartarFotosSinVisita]', { queueEntryId, error: err instanceof Error ? err.message : String(err) })
    return AVISO
  }
}

/**
 * Respuesta de un cobro que YA estaba hecho (reintento tras el timeout de 8 s,
 * doble toque, otro dispositivo). Sin efectos sobre la plata, pero CON la
 * visita: el diálogo todavía tiene que colgarle las fotos. Trae además el
 * método y el importe que quedaron registrados (hallazgo asesoria-07): si otro
 * dispositivo cobró primero, el diálogo NO tiene que colgarle su comprobante
 * de transferencia a una visita en efectivo — ese comprobante suelto es justo
 * la señal del doble cobro en /dashboard/comprobantes. Si la visita no aparece
 * (o no se pudo leer), van null.
 */
async function respuestaCobroYaRegistrado(supabase: AdminClient, queueEntryId: string) {
  console.warn(`[completeService] entry ${queueEntryId} ya no estaba in_progress; retorno idempotente`)
  const { data: visitaPrevia, error: errVisitaPrevia } = await supabase
    .from('visits')
    .select('id, payment_method, amount')
    .eq('queue_entry_id', queueEntryId)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (errVisitaPrevia) {
    console.error('[completeService] visita del reintento idempotente:', errVisitaPrevia.message)
  }
  const visitaPreviaId = (visitaPrevia?.id as string | undefined) ?? null
  // Fotos del corte: el reintento también las ata (idempotente). Si la primera
  // llamada cerró el cobro y se perdió la respuesta, acá quedan en la ficha.
  const fotos = visitaPreviaId
    ? await vincularFotosDelCobro(supabase, queueEntryId, visitaPreviaId)
    : { guardadas: 0 }
  const metodo = visitaPrevia?.payment_method as string | undefined
  return {
    success: true as const,
    alreadyCompleted: true as const,
    visitId: visitaPreviaId,
    /** Cómo quedó cobrada la visita existente (null si no se pudo leer). */
    paymentMethod: metodo === 'cash' || metodo === 'card' || metodo === 'transfer' ? metodo : null,
    /** Importe final registrado en la visita existente (null si no se pudo leer). */
    amount: visitaPrevia ? Number(visitaPrevia.amount) : null,
    fotos,
  }
}

export async function checkinClient(formData: FormData) {
  const supabase = createAdminClient()
  const rawName = ((formData.get('name') as string | null) ?? '').trim()
  const rawPhone = ((formData.get('phone') as string | null) ?? '').trim()
  const branchId = formData.get('branch_id') as string
  const barberId = (formData.get('barber_id') as string | null) || null
  const serviceId = (formData.get('service_id') as string | null) || null
  const specialFlag = formData.get('special')
  const isSpecialRequested = specialFlag === '1' || specialFlag === 'true'

  // Asesoría sin costo (mig 217): el cliente tocó «¿No sabés qué hacerte?» EN VEZ
  // de elegir un servicio. Es un pedido, no una bandera de confianza: abajo se
  // revalida contra el interruptor de la sucursal. Vale igual para el registro
  // manual del dashboard (`origen = 'staff'`).
  const pidioAsesoria = formData.get('asesoria') === '1'

  // De dónde viene el alta, para `clients.signup_source` (mig 210). El default es
  // la tablet porque es quien más clientes crea; el alta manual del dashboard
  // manda 'staff'. NO es una bandera de confianza —no habilita ni saltea nada—:
  // es procedencia, y por eso se valida contra una lista blanca en vez de
  // guardarse cruda.
  const origenPedido = (formData.get('origen') as string | null) ?? ''
  const signupSource: 'kiosk' | 'staff' = origenPedido === 'staff' ? 'staff' : 'kiosk'

  // "Cliente especial": walk-in sin teléfono (un niño, un invitado, alguien que no
  // deja su número). El staff lo marca con el toggle del registro manual; por compat
  // histórica también lo inferimos si tipea un teléfono placeholder degenerado (todos
  // ceros / un solo dígito repetido, de cualquier largo). Un placeholder así no
  // identifica a nadie y, peor, choca contra el UNIQUE (organization_id, phone) en
  // cuanto entra el segundo del día → "Error al registrar cliente". Igual que el
  // kiosko, a cada uno le damos un teléfono virtual ÚNICO 00XXXXXXXX para que sea su
  // propio registro, y nos salteamos el dedup por teléfono.
  const phoneDigits = rawPhone.replace(/\D/g, '')
  const isDegeneratePhone = phoneDigits.length > 0 && /^(.)\1*$/.test(phoneDigits)
  const isSpecial = isSpecialRequested || isDegeneratePhone

  const name = isSpecial ? (rawName || 'Cliente especial') : rawName
  const phone = rawPhone

  if (!branchId) {
    return { error: 'Falta la sucursal' }
  }
  if (!isSpecial && (!name || !phone)) {
    return { error: 'Nombre y teléfono son obligatorios' }
  }

  // Rate limit: 20 check-ins por IP+branch cada 60s (permisivo para uso real, restrictivo contra bots)
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskCheckin(branchId)
  if (!gate.allowed) {
    return { error: 'Demasiados check-ins en poco tiempo. Esperá un momento.' }
  }

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su organización
  const { data: branchResult } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .single()

  if (!branchResult?.organization_id) {
    return { error: 'Sucursal no encontrada o inactiva' }
  }

  // El interruptor de asesoría se lee en paralelo con la búsqueda del cliente, y
  // sólo si la pidió. Nunca rechaza (falla abierta): se puede esperar más abajo
  // sin try/catch.
  const asesoriaPermitidaP = pidioAsesoria
    ? asesoriaPermitidaEnSucursal(supabase, branchId, 'checkinClient')
    : Promise.resolve(false)

  let clientId: string

  // Cliente especial: NO buscamos duplicado. Cada walk-in sin teléfono es una persona
  // distinta y merece su propio registro (con teléfono virtual único). El dedup por
  // teléfono no aplica acá (y find_client_id_by_phone ya descarta degenerados, mig 150).
  let existingClient: { id: string } | null = null
  if (!isSpecial) {
    // Buscar cliente existente por teléfono NORMALIZADO (últimos 10 dígitos), no por
    // string exacto: Prode y el check-in guardan el mismo número en formatos distintos
    // (con/sin prefijo país) y el match exacto creaba un cliente DUPLICADO por persona
    // → el cupón de bienvenida quedaba en una fila y las visitas en otra, rompiendo el
    // canje ("pertenece a otro cliente"). Ver mig 149 / find_client_id_by_phone.
    const { data: matchedClientId, error: matchErr } = await supabase.rpc('find_client_id_by_phone', {
      p_org: branchResult.organization_id,
      p_phone: phone,
    })
    if (matchErr) {
      // Fail-closed: ante un fallo transitorio de la RPC NO seguimos al insert, porque
      // crearía un cliente DUPLICADO (un reintento del cliente es barato; una identidad
      // partida no). Ver mig 149 y CLAUDE.md riesgo #5/#12.
      console.error('[checkinClient] find_client_id_by_phone:', matchErr.message)
      return { error: 'No se pudo verificar el cliente, intentá de nuevo' }
    }
    existingClient = matchedClientId ? { id: matchedClientId as string } : null
  }

  if (existingClient) {
    clientId = existingClient.id
    await supabase.from('clients').update({ name }).eq('id', clientId).eq('organization_id', branchResult.organization_id)

    const activo = await resolverEntradaActiva(supabase, clientId, branchId)
    if (activo.enEstaSucursal) {
      const asesoriaExistente = await sumarAsesoriaAEntradaActiva(
        supabase,
        activo.enEstaSucursal,
        { pidio: pidioAsesoria, permitida: await asesoriaPermitidaP },
        branchId,
        'checkinClient',
      )
      return {
        alreadyInQueue: true,
        position: activo.enEstaSucursal.position,
        queueEntryId: activo.enEstaSucursal.id,
        // Propiedades explícitas, no spread: las pantallas leen `result.alreadyInQueue`
        // sobre la unión inferida y TypeScript sólo completa con `?: undefined` las
        // claves que vienen de literales.
        asesoriaPedida: asesoriaExistente.asesoriaPedida,
        asesoriaSumada: asesoriaExistente.asesoriaSumada,
        asesoriaMotivo: asesoriaExistente.asesoriaMotivo,
      }
    }
  } else if (isSpecial) {
    // Teléfono virtual único 00XXXXXXXX (mismo formato que el kiosko). Reintentamos si
    // por casualidad astronómica choca con el UNIQUE (organization_id, phone).
    let inserted: { id: string } | null = null
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const virtualPhone = `00${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({
          name,
          phone: virtualPhone,
          organization_id: branchResult.organization_id,
          signup_source: signupSource,
        })
        .select('id')
        .single()
      if (newClient) {
        inserted = newClient
      } else if (error?.code !== '23505') {
        console.error('[checkinClient] insert cliente especial:', error?.message)
        return { error: 'Error al registrar cliente' }
      }
      // 23505 → colisión rarísima del teléfono virtual: reintenta con otro número.
    }
    if (!inserted) {
      return { error: 'No se pudo registrar el cliente, intentá de nuevo' }
    }
    clientId = inserted.id
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        name,
        phone,
        organization_id: branchResult.organization_id,
        signup_source: signupSource,
      })
      .select('id')
      .single()

    if (error || !newClient) {
      return { error: 'Error al registrar cliente' }
    }
    clientId = newClient.id
  }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  // La asesoría queda si la pidió y la sucursal la ofrece (o no se pudo saber:
  // falla abierta). Si queda, REEMPLAZA al servicio: la entrada nace sin él y el
  // barbero lo elige al cobrar.
  const asesoriaQueda = pidioAsesoria && (await asesoriaPermitidaP)

  // Modelo pool (mig 134): si el cliente eligió "Menor espera", la entry
  // entra con barber_id = NULL y vive en el pool compartido — la reclama el
  // primer barbero libre vía claim_next_for_barber (FIFO por priority_order,
  // sin binding sticky). La pre-asignación visual la hace el cliente
  // (assignDynamicBarbers) y es solo un hint informativo, no vincula nada.
  const now = new Date().toISOString()
  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      client_id: clientId,
      // null = dinámico de pool ("Menor espera"); seteado = barbero específico
      barber_id: barberId,
      service_id: asesoriaQueda ? null : serviceId,
      pidio_asesoria: asesoriaQueda,
      position: position ?? 1,
      status: 'waiting',
      // !barberId = eligió "Menor espera" → dinámico de pool
      is_dynamic: !barberId,
      priority_order: now,
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    // Unique constraint violation: client already in queue (race condition)
    if (queueError?.code === '23505') {
      const { data: existing } = await supabase
        .from('queue_entries')
        .select('id, position, status, appointment_id')
        .eq('client_id', clientId)
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .single()
      const asesoriaExistente = await sumarAsesoriaAEntradaActiva(
        supabase,
        existing ?? null,
        { pidio: pidioAsesoria, permitida: await asesoriaPermitidaP },
        branchId,
        'checkinClient',
      )
      return {
        alreadyInQueue: true,
        position: existing?.position ?? 1,
        queueEntryId: existing?.id ?? '',
        asesoriaPedida: asesoriaExistente.asesoriaPedida,
        asesoriaSumada: asesoriaExistente.asesoriaSumada,
        asesoriaMotivo: asesoriaExistente.asesoriaMotivo,
      }
    }
    console.error('Insert queue entry error:', queueError)
    return { error: 'Error al agregar a la fila: ' + (queueError?.message || 'Error desconocido') }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  return { success: true, position, queueEntryId: queueEntry.id, clientId, asesoria: asesoriaQueda }
}

export async function startService(queueEntryId: string, barberId: string) {
  if (!isValidUUID(queueEntryId) || !isValidUUID(barberId)) {
    return { error: 'Datos inválidos' }
  }
  const supabase = createAdminClient()

  // Obtener la entrada para validar que la sucursal pertenece a la org activa
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // `.select('id')` da el rowcount: la UPDATE está condicionada a 'waiting', y
  // con 0 filas el cliente ya no estaba esperando (otro barbero lo tomó, lo
  // sacaron de la fila, doble toque). Antes eso volvía como éxito: el dashboard
  // decía «Corte iniciado» sobre un corte que no había empezado.
  const { data: iniciadas, error } = await supabase
    .from('queue_entries')
    .update({
      barber_id: barberId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      is_dynamic: false,
    })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')
    .select('id')

  if (error) {
    console.error('[startService]', { queueEntryId, error: error.message })
    return { error: 'Error al iniciar servicio' }
  }

  if (!iniciadas || iniciadas.length === 0) {
    return { error: 'El cliente ya no está esperando: otro barbero lo tomó o salió de la fila.' }
  }

  revalidatePath('/barbero/fila')
  return { success: true }
}

/**
 * Asigna atómicamente el próximo cliente al barbero e inicia el servicio.
 * Usa el RPC `claim_next_for_barber` (mig 131, modelo pool desde mig 134):
 * un único round trip que decide entre ghost de descanso listo, cliente
 * específico mío o dinámico de pool (FIFO global por priority_order), y deja
 * el entry en `in_progress` con `started_at = NOW()`.
 *
 * Pool NO bloqueante: cualquier barbero libre puede reclamar cualquier
 * dinámico — sin binding sticky ni fairness gate. La atomicidad la garantiza
 * FOR UPDATE SKIP LOCKED en Postgres.
 */
export async function attendNextClient(barberId: string, branchId: string, preferredEntryId?: string) {
  if (!isValidUUID(barberId) || !isValidUUID(branchId)) {
    return { error: 'Datos inválidos' }
  }
  if (preferredEntryId && !isValidUUID(preferredEntryId)) {
    preferredEntryId = undefined
  }
  const supabase = createAdminClient()

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { data, error } = await supabase.rpc('claim_next_for_barber', {
    p_barber_id: barberId,
    p_branch_id: branchId,
    p_preferred_entry_id: preferredEntryId ?? null,
  })

  if (error) {
    return { error: 'Error al asignar próximo cliente: ' + error.message }
  }

  const claim = (data as Array<{ entry_id: string; is_break: boolean; was_dynamic: boolean }> | null)?.[0]

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')

  if (!claim) {
    return { success: true as const, entryId: null }
  }

  if (claim.is_break) {
    return { success: true as const, entryId: null, breakStarted: true }
  }

  return { success: true as const, entryId: claim.entry_id, wasDynamic: claim.was_dynamic }
}

export async function completeService(
  queueEntryId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  serviceId?: string,
  paymentAccountId?: string | null,
  extraServiceIds?: string[],
  productsToSell?: { id: string; quantity: number }[],
  tipAmount: number = 0,
  tipPaymentMethod: 'cash' | 'card' | 'transfer' | null = null,
  barberNote: string | null = null,
  // Cupón de descuento (client_rewards.qr_code) escaneado en el cobro. Se valida
  // sin consumir al escanear; acá se consume atómicamente al confirmar la venta.
  couponQrCode: string | null = null,
  // Cobro conjunto (mig 164): id del comprobante-ancla con el que se pagó ESTE corte
  // junto con otro(s) en una sola transferencia. Cuando viene, el corte no escanea su
  // propio comprobante: se cuelga del ancla y su transfer_log acredita la cuenta del ancla.
  coveringReceiptId: string | null = null,
) {
  if (!isValidUUID(queueEntryId)) return { error: 'queueEntryId inválido' }
  // Llega del browser: un método fuera de la lista fallaba recién en el UPDATE de
  // la visita (enum), con la entrada ya cerrada y la visita en $0.
  if (!['cash', 'card', 'transfer'].includes(paymentMethod)) return { error: 'Elegí cómo pagó el cliente.' }
  if (serviceId && !isValidUUID(serviceId)) {
    return { error: 'serviceId inválido', codigo: 'servicio_invalido' as CodigoRechazoCobro }
  }
  if (paymentAccountId && !isValidUUID(paymentAccountId)) return { error: 'paymentAccountId inválido' }
  if (coveringReceiptId && !isValidUUID(coveringReceiptId)) return { error: 'coveringReceiptId inválido' }
  if (!Number.isFinite(tipAmount) || tipAmount < 0) return { error: 'tipAmount inválido' }
  if (tipPaymentMethod && !['cash','card','transfer'].includes(tipPaymentMethod)) {
    return { error: 'tipPaymentMethod inválido' }
  }

  // Extras: uuids, sin repetir y acotados. Antes no se validaban: un id inválido
  // hacía fallar la consulta de precios (22P02) y también el UPDATE de la visita
  // (extra_services es uuid[]), y el corte quedaba cerrado en $0 sin servicio.
  let extrasPedidos: string[] = []
  if (extraServiceIds != null) {
    if (
      !Array.isArray(extraServiceIds) ||
      extraServiceIds.length > TOPE_EXTRAS_POR_COBRO ||
      extraServiceIds.some((id) => typeof id !== 'string' || !isValidUUID(id))
    ) {
      return {
        error: 'Los servicios elegidos llegaron mal. Cerrá el cobro y volvé a abrirlo.',
        codigo: 'servicio_invalido' as CodigoRechazoCobro,
      }
    }
    extrasPedidos = [...new Set(extraServiceIds.map((id) => id.toLowerCase()))]
  }

  // Use admin client because barber pin authentications do not set a Supabase Auth session
  // This causes RLS on visits and client_points to fail when the queue trigger fires using SECURITY INVOKER
  const supabase = createAdminClient()

  // Obtener la entrada para validar que la sucursal pertenece a la org activa.
  // También trae el estado, el servicio del check-in, la marca de asesoría y el
  // barbero: los pasos 0 a 0c deciden con ellos ANTES de tocar nada.
  const { data: entryForValidation, error: errEntrada } = await supabase
    .from('queue_entries')
    .select('branch_id, appointment_id, status, cancel_reason, service_id, pidio_asesoria, barber_id, is_break')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (errEntrada) {
    console.error('[completeService] leer la entrada:', { queueEntryId, error: errEntrada.message })
    return { error: 'No pudimos leer el corte. Probá de nuevo.', codigo: 'lectura' as CodigoRechazoCobro }
  }
  if (!entryForValidation) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entryForValidation.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // 0. Una entrada que no está en curso no se cobra, y se dice por qué ANTES de
  //    la seña: seguir de largo consumía la seña de un turno que nadie iba a
  //    cobrar y después devolvía `alreadyCompleted`, o sea un «cobrado» sobre un
  //    cliente que ya no estaba (o que todavía no había empezado).
  if (entryForValidation.status === 'cancelled') {
    return { error: mensajeDeEntradaCancelada(entryForValidation.cancel_reason as string | null) }
  }
  if (entryForValidation.status === 'waiting') {
    return { error: MENSAJE_CORTE_SIN_EMPEZAR }
  }
  // Una entrada ya 'completed' es el reintento idempotente: se contesta acá,
  // sin validar nada de lo que se iba a escribir (no se escribe nada) y sin
  // tocar la seña ni los productos.
  if (entryForValidation.status === 'completed') {
    return respuestaCobroYaRegistrado(supabase, queueEntryId)
  }
  if (entryForValidation.is_break === true) return { error: 'Un descanso no se cobra.' }

  // Servicio principal del cobro: el que eligió el barbero o, si no mandó
  // ninguno, el que la entrada trae del check-in. Es el MISMO criterio con el que
  // se calcula el importe (paso 3) y se escribe la visita (paso 4): un guard que
  // contara el de la entrada mientras el importe lo ignoraba dejaría pasar una
  // visita sin servicio y en $0.
  const servicioDelCheckin = ((entryForValidation.service_id as string | null) ?? '').toLowerCase() || null
  const servicioPrincipalId: string | null = serviceId?.toLowerCase() || servicioDelCheckin
  // El principal no se cobra dos veces aunque venga también como extra.
  const extrasUnicos = extrasPedidos.filter((id) => id !== servicioPrincipalId)

  // 0'. Asesoría (mig 217): si el cliente pidió asesoría, el servicio PRINCIPAL
  //     es obligatorio (el elegido en el cobro o el que la entrada traiga): los
  //     extras solos no alcanzan, porque una «Barba (Adiciónalas)» de $4.000 no
  //     es lo que se cobra por el corte que se le terminó haciendo. Si no se hizo
  //     nada, el camino es `cerrarSoloAsesoria` (sin visita). La base tiene la
  //     misma regla como red (trigger de la mig 221) para los paneles viejos.
  if (entryForValidation.pidio_asesoria === true && !servicioPrincipalId) {
    return { error: MENSAJE_ASESORIA_SIN_SERVICIO, codigo: 'asesoria_sin_servicio' as CodigoRechazoCobro }
  }

  // 0c. Precios, comisiones y cuenta de cobro: se leen y se validan ANTES de
  //     cerrar la entrada (hallazgo seguridad-y-despliegue-06). Antes se leían
  //     después, sin mirar el error: con la base lenta (el timeout de 8 s) la
  //     visita quedaba en $0 y el barbero veía «cobrado». Ahora cualquier falla
  //     de lectura devuelve un error con la entrada, la seña y los productos
  //     intactos, y el barbero reintenta.
  const idsDeServicios = [...new Set([...(servicioPrincipalId ? [servicioPrincipalId] : []), ...extrasUnicos])]
  const barberoDeLaEntrada = (entryForValidation.barber_id as string | null) ?? null
  const esTransferencia = paymentMethod === 'transfer'
  const cuentaPedida = paymentAccountId ? paymentAccountId.toLowerCase() : null
  const hayServicios = idsDeServicios.length > 0

  const [serviciosRes, overridesRes, salarioRes, cuentasRes] = await Promise.all([
    hayServicios
      ? supabase
          .from('services')
          .select('id, branch_id, is_active, price, default_commission_pct')
          .in('id', idsDeServicios)
      : null,
    hayServicios && barberoDeLaEntrada
      ? supabase
          .from('staff_service_commissions')
          .select('service_id, commission_pct')
          .eq('staff_id', barberoDeLaEntrada)
          .in('service_id', idsDeServicios)
      : null,
    // salary_configs.staff_id es UNIQUE: maybeSingle no puede dar "varias filas".
    hayServicios && barberoDeLaEntrada
      ? supabase
          .from('salary_configs')
          .select('scheme, commission_pct')
          .eq('staff_id', barberoDeLaEntrada)
          .maybeSingle()
      : null,
    // Las cuentas de la sucursal (activas o no), sólo para una transferencia que
    // trae cuenta (hay que ver que sea de acá) o que no trae ni cuenta ni
    // comprobante-ancla (hay que ver si la sucursal tiene cuentas).
    esTransferencia && (cuentaPedida || !coveringReceiptId)
      ? supabase.from('payment_accounts').select('id, is_active').eq('branch_id', entryForValidation.branch_id)
      : null,
  ])

  const errorDeLectura = serviciosRes?.error ?? overridesRes?.error ?? salarioRes?.error ?? cuentasRes?.error
  if (errorDeLectura) {
    console.error('[completeService] leer precios/comisiones/cuentas:', {
      queueEntryId,
      code: errorDeLectura.code,
      message: errorDeLectura.message,
    })
    return { error: 'No pudimos calcular el cobro. Probá de nuevo.', codigo: 'lectura' as CodigoRechazoCobro }
  }

  type ServicioDelCobro = {
    id: string
    branch_id: string | null
    is_active: boolean
    price: number
    default_commission_pct: number
  }
  const serviciosPorId = new Map<string, ServicioDelCobro>()
  for (const s of (serviciosRes?.data ?? []) as ServicioDelCobro[]) serviciosPorId.set(String(s.id).toLowerCase(), s)
  for (const id of idsDeServicios) {
    const s = serviciosPorId.get(id)
    if (!s) {
      return {
        error: 'Uno de los servicios elegidos ya no existe. Actualizá la lista y volvé a elegir.',
        codigo: 'servicio_invalido' as CodigoRechazoCobro,
      }
    }
    // branch_id NULL = servicio global (legado, hoy no hay ninguno): se acepta
    // igual que en la lista del cobro y en services.ts.
    if (s.branch_id && s.branch_id !== entryForValidation.branch_id) {
      return {
        error: 'Uno de los servicios elegidos es de otra sucursal. Actualizá la lista y volvé a elegir.',
        codigo: 'servicio_invalido' as CodigoRechazoCobro,
      }
    }
    // Dado de baja: sólo pasa el que la entrada trae del check-in (el cliente se
    // anotó con él y lo dieron de baja durante el día: igual se hizo y se cobra).
    if (s.is_active !== true && id !== servicioDelCheckin) {
      return {
        error: 'Uno de los servicios elegidos está dado de baja. Elegí otro.',
        codigo: 'servicio_invalido' as CodigoRechazoCobro,
      }
    }
  }

  if (cuentasRes) {
    const cuentasDeLaSucursal = (cuentasRes.data ?? []) as Array<{ id: string; is_active: boolean | null }>
    if (cuentaPedida) {
      // Una cuenta desactivada en el medio se acepta: el cliente ya transfirió ahí.
      if (!cuentasDeLaSucursal.some((c) => String(c.id).toLowerCase() === cuentaPedida)) {
        return {
          error: 'La cuenta de cobro elegida no es de esta sucursal. Recargá el panel y elegí a qué cuenta transfirió.',
          codigo: 'cuenta_invalida' as CodigoRechazoCobro,
        }
      }
    } else if (cuentasDeLaSucursal.some((c) => c.is_active === true)) {
      // Transferencia sin cuenta (y sin comprobante-ancla) en una sucursal que
      // tiene cuentas: la plata no entraría a ningún destino (KR#30). Es lo que
      // mandaría un diálogo viejo que no pudo leer las cuentas (hallazgo
      // productos-y-fugas-01). Sin cuentas activas sí se acepta: es la única
      // forma de cobrar por transferencia en esa sucursal.
      return { error: MENSAJE_FALTA_CUENTA, codigo: 'falta_cuenta' as CodigoRechazoCobro }
    }
  }

  const overridePorServicio = new Map<string, number>()
  for (const o of (overridesRes?.data ?? []) as Array<{ service_id: string; commission_pct: number }>) {
    overridePorServicio.set(String(o.service_id).toLowerCase(), Number(o.commission_pct))
  }
  const barberSalaryConfig = (salarioRes?.data ?? null) as { scheme: string | null; commission_pct: number | null } | null

  // 0a. Productos: se validan ANTES de tocar nada (seña, entrada, visita).
  //     Antes se completaba la entrada y recién después se procesaban: un id de
  //     otra sucursal, un producto dado de baja o una cantidad rota dejaban el
  //     corte cerrado con `amount` sin los productos — y el cliente ya los había
  //     pagado: caja corta y sin forma de reintentar (el guard del paso 1 devuelve
  //     `alreadyCompleted`). Acá un rechazo no cambió nada: el barbero saca el
  //     producto y vuelve a cobrar sobre la entrada intacta.
  let lineasDeProductos: LineaValidada[] = []
  if (productsToSell != null) {
    const validacion = await validarLineasDeProductos(supabase, entryForValidation.branch_id, productsToSell, {
      soloActivos: true,
    })
    if (validacion.ok) {
      lineasDeProductos = validacion.lineas
    } else {
      // Si en el medio la entrada se cerró (otro dispositivo, o la primera
      // llamada de este mismo cobro que terminó mientras ésta validaba), no
      // puede trabarse porque un producto se dio de baja: sigue de largo sin
      // productos y el guard del paso 1 la devuelve como `alreadyCompleted`.
      const { data: estadoEntrada, error: errEstado } = await supabase
        .from('queue_entries')
        .select('status')
        .eq('id', queueEntryId)
        .maybeSingle()
      if (errEstado || !estadoEntrada || estadoEntrada.status === 'in_progress') {
        return { error: validacion.error, productosDesactualizados: validacion.productosDesactualizados }
      }
    }
  }

  // 0b. La seña (mig 207). Se resuelve ANTES de tocar la fila, y a propósito:
  //     si acá falla algo, no se completó nada y el barbero puede reintentar sobre
  //     un entry intacto. Resolviéndola más abajo —después de que el trigger ya
  //     creó la visita— un fallo dejaría el corte cerrado con amount=0 y el guard
  //     idempotente del paso 1 haría que el reintento retorne `alreadyCompleted`
  //     sin volver a calcular nada: una visita en cero, para siempre.
  //
  //     FALLA CERRADA: cobrar de más es peor que no cobrar. Si no podemos saber
  //     cuánto señó el cliente, no se cobra. (El bloque 3.6 anterior hacía lo
  //     contrario: logueaba el error y dejaba `amount` en el precio de lista, o
  //     sea le cobraba el turno entero a alguien que ya había pagado la mitad.)
  //
  //     `consumirSenaEnCobro` es idempotente HACIA ADELANTE: la seña se mueve a
  //     `consumida` acá, antes del UPDATE de abajo, así que todo lo que falle
  //     después (el UPDATE, el AbortError del timeout de 8s, la tablet sin wifi)
  //     hace que el barbero reintente sobre una seña YA consumida. Ese reintento
  //     recibe el MISMO monto, no cero — si no, el cliente pagaría la seña dos
  //     veces: una por Mercado Pago y otra en el mostrador.
  let prepaidAmount = 0
  let depositId: string | null = null
  if (entryForValidation.appointment_id) {
    try {
      const sena = await consumirSenaEnCobro(entryForValidation.appointment_id)
      prepaidAmount = sena.prepaidAmount
      depositId = sena.depositId
      // El turno tenía seña y NO se descontó (se devolvió, se dio por perdida o
      // cambió de estado durante el cobro). El cobro sigue —el precio completo
      // es el correcto en esos casos— pero queda dicho por qué: "0" es la
      // respuesta a dos preguntas distintas y sin esto nadie puede reconstruir
      // cuál fue tres meses después.
      if (sena.advertencia) {
        console.warn('[completeService] seña no imputada:', {
          queueEntryId,
          appointmentId: entryForValidation.appointment_id,
          motivo: sena.advertencia,
        })
      }
    } catch (err) {
      console.error('[completeService] consumirSenaEnCobro:', err)
      return { error: 'No pudimos verificar la seña de este turno. Probá de nuevo.' }
    }
  }

  // 1. Complete the queue entry – this fires the on_queue_completed trigger
  //    which creates a visit record with amount=0 as placeholder.
  //    `.select('id')` nos da el rowcount: si la UPDATE matchea 0 filas
  //    significa que el entry YA no estaba en 'in_progress' (doble-tap,
  //    reintento de red tras AbortError de 8s, dos pestañas/dispositivos). En
  //    ese caso el trigger NO disparó de nuevo (es idempotente vía
  //    OLD.status='in_progress'), pero el RESTO de este server action SÍ correría
  //    sus efectos colaterales (recordTransfer, registrarProductosDeVisita, redención
  //    de puntos, salary_reports, mensajes post-servicio) sobre la visita ya
  //    existente, duplicándolos. Cortamos acá ANTES de cualquier efecto.
  //    (Auditoría jun-2026: este doble-disparo infló caja en +272.000 ARS.)
  //
  //    Una asesoría (mig 217) deja escrito en la entrada el servicio que se le
  //    hizo, en la MISMA UPDATE que la cierra: el trigger de la mig 221 rechaza
  //    cerrar como cobrada una asesoría sin service_id (la red para los paneles
  //    con el bundle viejo), y así este camino nunca choca con él.
  const cierreDeLaEntrada: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  }
  if (entryForValidation.pidio_asesoria === true && servicioPrincipalId) {
    cierreDeLaEntrada.service_id = servicioPrincipalId
  }
  const { data: completedRows, error } = await supabase
    .from('queue_entries')
    .update(cierreDeLaEntrada)
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')
    .select('id')

  if (error) {
    console.error('completeService error:', error)
    if (error.hint === 'asesoria_sin_servicio') {
      return { error: MENSAJE_ASESORIA_SIN_SERVICIO, codigo: 'asesoria_sin_servicio' as CodigoRechazoCobro }
    }
    return { error: 'Error al completar servicio: ' + error.message }
  }

  if (!completedRows || completedRows.length === 0) {
    // ¿Por qué no se cerró? Se relee: entre la lectura del paso 0 y la UPDATE la
    // otra tablet pudo cerrarla como «solo asesoría» o sacarla de la fila, y eso
    // NO es un cobro hecho — devolver `alreadyCompleted` le decía «cobrado» al
    // barbero sobre un cliente sin visita.
    const { data: estadoActual, error: errEstadoActual } = await supabase
      .from('queue_entries')
      .select('status, cancel_reason')
      .eq('id', queueEntryId)
      .maybeSingle()
    if (errEstadoActual) {
      console.error('[completeService] releer la entrada que no se cerró:', errEstadoActual.message)
    }
    if (estadoActual?.status === 'cancelled') {
      return { error: mensajeDeEntradaCancelada(estadoActual.cancel_reason as string | null) }
    }
    if (estadoActual?.status === 'waiting') {
      return { error: MENSAJE_CORTE_SIN_EMPEZAR }
    }

    // Ya fue completado por una llamada previa: retorno idempotente, sin efectos.
    return respuestaCobroYaRegistrado(supabase, queueEntryId)
  }

  // 1b. Si la queue entry proviene de un turno, marcarlo como completado.
  //     El appointment_id ya lo trajo la lectura de validación: era una segunda
  //     query a la misma fila.
  if (entryForValidation.appointment_id) {
    await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', entryForValidation.appointment_id)
  }

  // 2. La visita que creó el trigger (en la misma transacción que la UPDATE del
  //    paso 1, así que existe). Si la lectura falla (timeout) se reintenta una
  //    vez; si vuelve a fallar, la entrada ya está cerrada y el importe no se
  //    pudo escribir: se dice con todas las letras en vez de un «cobrado» con la
  //    visita en $0, y queda en el log con todo lo necesario para corregirla.
  type VisitaDelCobro = {
    id: string
    client_id: string | null
    branch_id: string
    barber_id: string | null
    commission_pct: number
    service_id: string | null
  }
  const leerVisitaDelCobro = async (): Promise<VisitaDelCobro | null> => {
    const { data, error: errVisita } = await supabase
      .from('visits')
      .select('id, client_id, branch_id, barber_id, commission_pct, service_id')
      .eq('queue_entry_id', queueEntryId)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (errVisita) console.error('[completeService] leer la visita del cobro:', { queueEntryId, error: errVisita.message })
    return (data as VisitaDelCobro | null) ?? null
  }
  const visit = (await leerVisitaDelCobro()) ?? (await leerVisitaDelCobro())

  if (!visit) {
    console.error('[completeService] VISITA_SIN_IMPORTE: la entrada se cerró y no se pudo leer la visita', {
      queueEntryId,
      paymentMethod,
      servicioPrincipalId,
      extras: extrasUnicos,
      productos: lineasDeProductos.map((l) => ({ id: l.productId, cantidad: l.cantidad })),
      prepaidAmount,
      depositId,
    })
    return {
      error:
        'El corte quedó cerrado, pero no pudimos registrar el importe. No lo cobres de nuevo: avisale al encargado para que lo cargue en el historial.',
      codigo: 'visita_sin_importe' as CodigoRechazoCobro,
    }
  }
  if (visit.barber_id !== barberoDeLaEntrada) {
    // El trigger copia el barber_id de la entrada: no debería pasar nunca. Las
    // comisiones por servicio se leyeron (paso 0c) para el barbero de la entrada.
    console.warn('[completeService] la visita quedó con otro barbero que la entrada', {
      queueEntryId,
      visitId: visit.id,
      barberoEntrada: barberoDeLaEntrada,
      barberoVisita: visit.barber_id,
    })
  }

  // 2b. Fotos del corte (mig 219): ata la sesión de fotos de esta entrada a la
  //     visita y copia TODAS sus fotos (las de la tablet y las del celular). Las
  //     que lleguen en los próximos minutos se suman solas a la visita. Corre en
  //     paralelo con el resto del cobro (toca otras tablas y nunca lanza) y se
  //     espera recién al devolver: la plata no espera a las fotos.
  const fotosPromesa = vincularFotosDelCobro(supabase, queueEntryId, visit.id)

  // 3. Importe y comisión de los servicios, con lo que se leyó y validó en el
  //    paso 0c (ninguna consulta acá: nada puede fallar en silencio).
  //    Comisión: staff_service_commissions → services.default_commission_pct →
  //    salary_configs → staff.commission_pct (el que el trigger copió a la visita).
  //    Los barberos con sueldo 'fixed' sólo cobran comisión sobre productos.
  let amount = 0
  let commissionAmount = 0
  const isFixedSalary = barberSalaryConfig?.scheme === 'fixed'
  const globalCommPct = barberSalaryConfig?.commission_pct != null
    ? Number(barberSalaryConfig.commission_pct)
    : Number(visit.commission_pct)

  // Cada servicio una vez (el principal y los extras sin repetir), igual que antes.
  for (const id of idsDeServicios) {
    const s = serviciosPorId.get(id)
    if (!s) continue // imposible: el paso 0c ya rechazó los que no existen
    const price = Number(s.price)
    amount += price

    // Sueldo fijo → 0 comisión por servicio, independientemente de overrides
    // por-servicio o por-barbero. La única vía de comisión para este
    // esquema es la venta de productos (ver bloque 3.5).
    if (isFixedSalary) continue

    let commPct: number
    if (overridePorServicio.has(id)) {
      commPct = overridePorServicio.get(id)!
    } else if (Number(s.default_commission_pct) > 0) {
      commPct = Number(s.default_commission_pct)
    } else {
      commPct = globalCommPct
    }

    commissionAmount += price * (commPct / 100)
  }

  // Subtotal de servicios (principal + extras). Es la base del descuento por cupón:
  // el 20% se aplica SOLO a servicios, no a productos ni a la propina.
  const serviceSubtotal = amount

  // 3.5 Productos (validados en el paso 0a): detalle con el método REAL del
  //     cobro, stock y comisión del día, en una transacción (RPC
  //     registrar_productos_de_visita, mig 220; sin ella, el camino TS con cada
  //     error mirado). La comisión de productos va al reporte del día ACÁ, no en
  //     el paso 8. Si algo falla, el importe y la comisión se suman igual —el
  //     cliente ya pagó y la caja tiene que cerrar— y el barbero recibe
  //     `productWarning` con qué no quedó registrado. Antes un fallo se ignoraba:
  //     `amount` quedaba sin los productos y nadie se enteraba.
  let productCommissionAmount = 0
  let productWarning: string | null = null
  if (lineasDeProductos.length > 0) {
    const productos = await registrarProductosDeVisita(supabase, {
      visitId: visit.id,
      branchId: visit.branch_id,
      barberId: visit.barber_id,
      paymentMethod,
      lineas: lineasDeProductos,
    })
    amount += productos.total
    productCommissionAmount = productos.comision
    commissionAmount += productCommissionAmount
    productWarning = productos.aviso
    if (productWarning) {
      console.warn('[completeService] productos con aviso', { queueEntryId, visitId: visit.id, productWarning })
    }
  }

  // 3.6 La seña NO se resta de `amount` (mig 207).
  //     `visits.amount` es SIEMPRE el precio completo del servicio: de ahí salen la
  //     comisión, los puntos, el comprobante de ARCA, el ticket promedio y el
  //     conteo de cortes. Una visita "neta de seña" partía el ticket al medio y
  //     hacía que ARCA facturara la mitad de lo vendido.
  //     Lo que se registra es la PARTICIÓN del cobro: `prepaid_amount` es lo que
  //     el barbero NO recibió en el mostrador, y de eso se ocupan caja y el ledger
  //     (`fn_sync_transfer_log_from_visit` proyecta `amount - prepaid_amount`).
  //
  //     El neteo legacy que vivía acá —visitas de prepago con `queue_entry_id IS
  //     NULL` y el mismo `appointment_id`, que creaba `confirmAppointmentPrepayment`—
  //     se borró: ese camino nunca escribió una sola fila en prod (verificado el
  //     3/9/2026: 0 filas) y murió con la mig 207. La seña no crea visita propia.

  // 4. Update the visit with correct data (amount = precio completo; SIN cupón
  //    todavía — el descuento del cupón lo aplica la RPC abajo, atómico con el consumo).
  const visitUpdate: Record<string, unknown> = {
    payment_method: paymentMethod,
    amount,
    commission_amount: commissionAmount,
    // Lo ya pagado por adelantado. Va en cada cobro (también en 0) para que un
    // reintento no deje el valor de una corrida anterior.
    prepaid_amount: prepaidAmount,
    deposit_id: depositId,
  }
  if (servicioPrincipalId) visitUpdate.service_id = servicioPrincipalId
  // La cuenta de cobro va SÓLO con transferencia. El diálogo ya lo filtra (antes
  // mandaba la preseleccionada con cualquier método: 1.442 cobros en efectivo o
  // tarjeta quedaron imputados a una cuenta bancaria en 60 días), pero la regla
  // vive acá para que ninguna superficie la vuelva a romper. El ledger no se
  // ensuciaba —el trigger sólo proyecta transferencias—; la visita sí.
  if (cuentaPedida) {
    if (paymentMethod === 'transfer') {
      // Validada contra la sucursal en el paso 0c.
      visitUpdate.payment_account_id = cuentaPedida
    } else {
      console.warn('[completeService] cuenta de cobro con un método que no es transferencia; se ignora', {
        queueEntryId,
        paymentMethod,
        paymentAccountId,
      })
    }
  }
  if (extrasUnicos.length > 0) visitUpdate.extra_services = extrasUnicos
  if (tipAmount > 0) {
    visitUpdate.tip_amount = tipAmount
    visitUpdate.tip_payment_method = tipPaymentMethod ?? paymentMethod
  }
  if (barberNote && barberNote.trim().length > 0) {
    visitUpdate.barber_note = barberNote.trim().slice(0, 500)
  }
  // OJO: el cobro conjunto (covering_receipt_id + cuenta del ancla) NO se setea acá.
  // Se cuelga en un write APARTE más abajo, después del cupón, para que: (a) el monto que
  // valida el guard de cobertura sea el neto final, y (b) si el guard (mig 165) rechaza por
  // falta de saldo, el corte quede como transfer normal (no se rompe el cierre).

  // La entrada ya está cerrada: si este UPDATE no entra, la visita queda en $0.
  // Se reintenta una vez (los valores son absolutos y los triggers de visits son
  // idempotentes, así que repetirlo no duplica nada). Si igual falla, el barbero
  // recibe `visitaWarning` con el importe y el método, en vez de un éxito pelado.
  let { error: visitUpdateError } = await supabase
    .from('visits')
    .update(visitUpdate)
    .eq('id', visit.id)
  if (visitUpdateError) {
    console.error('[completeService] error al actualizar la visita; se reintenta:', visitUpdateError.message)
    ;({ error: visitUpdateError } = await supabase
      .from('visits')
      .update(visitUpdate)
      .eq('id', visit.id))
  }
  let visitaWarning: string | null = null
  if (visitUpdateError) {
    console.error('[completeService] VISITA_SIN_IMPORTE: no se pudo escribir el cobro en la visita', {
      queueEntryId,
      visitId: visit.id,
      visitUpdate,
      code: visitUpdateError.code,
      message: visitUpdateError.message,
    })
    visitaWarning =
      `No pudimos guardar el importe de este cobro (${formatCurrency(amount)}, ${NOMBRE_DEL_METODO[paymentMethod]}). ` +
      'El corte quedó cerrado: no lo cobres de nuevo y avisale al encargado para que lo cargue en el historial.'
  }

  // 4.5 Canje de cupón de descuento (client_rewards) al confirmar el cobro.
  //     La RPC redeem_coupon_for_visit hace EN UNA SOLA TRANSACCIÓN: validar
  //     (dueño/org/vigencia), consumir (lock + guarda anti-doble-canje) y escribir el
  //     descuento sobre la visita (amount/discount_amount/client_reward_id). Así
  //     consumo y descuento NUNCA divergen. No usa auth.uid → sirve en el panel PIN.
  //     Va DESPUÉS del write base de la visita (la RPC necesita leer el amount bruto)
  //     y DESPUÉS del guard idempotente (un reintento sobre un entry ya completado
  //     retorna antes y nunca re-consume). El descuento aplica solo a servicios; la
  //     comisión queda sobre el bruto (el cupón no recorta la paga del barbero).
  //     FAIL-OPEN: si el cupón ya no es canjeable o si el write base falló, NO se
  //     consume y se cobra a precio lleno con un aviso para el barbero.
  //     Desde la mig 196/197 el MISMO parámetro trae dos cosas distintas, que se
  //     distinguen por prefijo: el hex de un beneficio de la app (client_rewards) o
  //     "MNC-REF:<código>", la invitación de un amigo (referidos). Y un beneficio
  //     puede ser merch/especial: una ENTREGA que no toca el importe.
  let couponClientRewardId: string | null = null
  let couponDiscountAmount = 0
  let couponWarning: string | null = null
  // Merch/especial entregado: nombre del premio para que la tablet lo diga.
  let couponDelivered: string | null = null
  // Invitación aplicada: quién invitó y cuánto se descontó, para el toast.
  let referralApplied: { referrerFirstName: string | null; discountAmount: number } | null = null
  if (couponQrCode) {
    const referralCode = parseReferralQr(couponQrCode)
    const cleanCoupon = couponQrCode.trim().toLowerCase()
    if (visitUpdateError) {
      couponWarning = 'No se pudo registrar el cobro; el beneficio no se aplicó'
    } else if (referralCode) {
      // ── Invitación de un amigo ──
      //    apply_referral_for_visit re-valida TODO (promo vigente, código, cliente
      //    nuevo, no auto-referido, sin otro beneficio en la visita), escribe el
      //    descuento sobre la visita y deja el referido `pending`; el trigger de
      //    loyalty lo completa y acredita los puntos a los dos. Mismo fail-open
      //    que el cupón: si no aplica, se cobra a precio lleno y se avisa.
      if (serviceSubtotal <= 0) {
        couponWarning = 'No hay servicio para aplicar el descuento; la invitación no se usó'
      } else {
        // Quién escaneó (para auditoría del referido). El panel se autentica por
        // PIN + cookie: si no hay sesión de barbero (cobro desde el dashboard), va null.
        const barberSession = await getBarberSession()
        const { data: refData, error: refErr } = await supabase.rpc('apply_referral_for_visit', {
          p_code: referralCode,
          p_visit_id: visit.id,
          p_service_subtotal: serviceSubtotal,
          p_staff_id: barberSession?.staff_id ?? null,
        })
        const row = (refData ?? {}) as {
          success?: boolean
          error?: string
          discount_amount?: number | null
          net_amount?: number | null
          referrer_first_name?: string | null
        }
        if (refErr || !row.success) {
          if (refErr) console.error('[completeService] apply_referral_for_visit error:', refErr.message)
          couponWarning = referralErrorMessage(row.error) + '; se cobró sin descuento'
        } else {
          couponDiscountAmount = Number(row.discount_amount ?? 0)
          referralApplied = { referrerFirstName: row.referrer_first_name ?? null, discountAmount: couponDiscountAmount }
          // La RPC ya escribió el amount neto en la visita; usamos ese neto para caja/transfer.
          amount = Number(row.net_amount ?? amount)
        }
      }
    } else if (!/^[0-9a-f-]{8,64}$/.test(cleanCoupon)) {
      couponWarning = 'El código del beneficio no es válido; se cobró sin descuento'
    } else {
      const { data: redeemData, error: redeemErr } = await supabase.rpc('redeem_coupon_for_visit', {
        p_qr_code: cleanCoupon,
        p_visit_id: visit.id,
        p_service_subtotal: serviceSubtotal,
      })
      const row = (redeemData ?? {}) as CouponErrorExtra & {
        success?: boolean
        error?: string
        kind?: string | null
        reward_name?: string | null
        discount_amount?: number | null
        net_amount?: number | null
        client_reward_id?: string
      }
      if (redeemErr || !row.success) {
        if (redeemErr) console.error('[completeService] redeem_coupon_for_visit error:', redeemErr.message)
        // `row` trae allowed_weekdays / service_name cuando el rechazo los tiene: el
        // mensaje se arma con lo que dijo la RPC, no con un texto fijo.
        couponWarning = couponErrorMessage(row.error, row) + '; se cobró sin descuento'
      } else {
        couponClientRewardId = row.client_reward_id ?? null
        if (row.kind === 'merch' || row.kind === 'especial') {
          // Entrega: la RPC marcó el beneficio como usado sin tocar el importe.
          couponDelivered = row.reward_name ?? 'Beneficio'
          couponDiscountAmount = 0
        } else {
          couponDiscountAmount = Number(row.discount_amount ?? 0)
          // La RPC ya escribió el amount neto en la visita; usamos ese neto para caja/transfer.
          amount = Number(row.net_amount ?? amount)
        }
      }
    }
  }

  // 4.5b LA SEÑA QUEDÓ POR ENCIMA DEL PRECIO FINAL.
  //
  //      `redeem_coupon_for_visit` baja `visits.amount` (`GREATEST(amount -
  //      descuento, 0)`) y NO mira `prepaid_amount`: un corte gratis o un
  //      descuento grande sobre un turno señado deja al cliente habiendo pagado
  //      por Mercado Pago más de lo que terminó costando el servicio. La plata
  //      NO se descuadra —toda lectura acota (`LEAST(prepaid, amount)` en caja,
  //      `GREATEST(amount - prepaid, 0)` en el ledger y en el cierre)— así que
  //      el mostrador cobra 0 y nadie rinde de menos. Lo que falta es que
  //      alguien SE ENTERE: el cliente tiene un saldo a favor que sólo se
  //      resuelve devolviéndoselo desde Turnos → Señas.
  //
  //      No se toca `prepaid_amount` para "cuadrarlo": esa columna dice cuánto
  //      cobró Mercado Pago de verdad, y pisarla borraría justamente la prueba
  //      de que hay que devolver algo. Tampoco se bloquea el cobro — el
  //      descuento puede ser deliberado y el cliente está en el mostrador.
  let senaWarning: string | null = null
  if (prepaidAmount > amount) {
    const aFavor = Math.round((prepaidAmount - amount) * 100) / 100
    senaWarning =
      `El cliente pagó $${prepaidAmount} de seña y el servicio quedó en $${amount}: ` +
      `le quedan $${aFavor} a favor. Devolveselos desde Turnos → Señas.`
    console.warn('[completeService] seña mayor al precio final del cobro', {
      queueEntryId,
      visitId: visit.id,
      depositId,
      prepaidAmount,
      amountFinal: amount,
      aFavor,
    })
  }

  // El registro en transfer_logs (el ledger de las cuentas de cobro) NO se escribe
  // acá: lo mantiene el trigger trg_visits_sync_transfer_log a partir de la visita
  // (mig 160), con el monto YA neto de cupón y con la propina transferida incluida.
  // Así ningún camino que toque una visita puede olvidarse de actualizar el ledger.

  // 4.6 Cobro conjunto (mig 164/165): colgar el corte del comprobante-ancla en un write
  //     APARTE, ya con el monto neto. La cuenta pasa a ser la del ancla (donde entró la
  //     plata) → el transfer_log de este corte acredita esa cuenta. El guard de cobertura
  //     (mig 165, con lock del ancla) rechaza si la suma del grupo supera el comprobante:
  //     en ese caso el corte queda como transfer normal a su cuenta y se avisa (no se rompe
  //     el cierre). Exigimos que el ancla tenga visita propia (el que recibió la plata ya
  //     cerró su corte) y sea de la misma sucursal.
  let jointWarning: string | null = null
  if (coveringReceiptId && !visitUpdateError) {
    const { data: anchor } = await supabase
      .from('payment_receipts')
      .select('id, branch_id, payment_account_id, covers_group, visit_id')
      .eq('id', coveringReceiptId)
      .maybeSingle()
    if (
      anchor && anchor.covers_group && anchor.visit_id &&
      anchor.branch_id === entryForValidation.branch_id && anchor.payment_account_id
    ) {
      const { error: attachErr } = await supabase
        .from('visits')
        .update({ covering_receipt_id: coveringReceiptId, payment_account_id: anchor.payment_account_id })
        .eq('id', visit.id)
      if (attachErr) {
        // Guard de cobertura (mig 165) u otro error → NO se cuelga; queda transfer normal.
        console.error('[completeService] no pude colgar el corte del comprobante conjunto:', attachErr.message)
        jointWarning = 'El comprobante conjunto ya no alcanzaba para este corte; se registró como transferencia normal. Escaneá el comprobante de este cobro.'
      }
    } else {
      console.error('[completeService] covering receipt inválido (no es pago conjunto, sin visita propia, o de otra sucursal):', coveringReceiptId)
      jointWarning = 'No se pudo vincular al cobro conjunto; se registró como transferencia normal.'
    }
  }

  // (El bloque 5 —canje por puntos legacy, isRewardClaim— se borró junto con la
  //  mig 204: leía rewards_config/client_points, dos tablas que el programa de
  //  fidelización dejó inertes, y su point_transaction sin `remaining` era
  //  invisible para loyalty_points_balance. Si el canje de puntos en el local
  //  vuelve, va por las RPC del programa nuevo, nunca por acá.)

  // 6. Auto-start SOLO del ghost de descanso si está listo (nunca del próximo
  //    cliente). La regla y su historia viven en `arrancarDescansoPendiente`,
  //    que comparte cerrarSoloAsesoria.
  const breakAutoStarted = await arrancarDescansoPendiente(supabase, visit.barber_id, visit.branch_id)

  // 7. Reglas post-servicio: buscar reglas con trigger_type='post_service' y programar mensajes
  if (visit.client_id) {
    try {
      const { data: branch, error: branchErr } = await supabase
        .from('branches')
        .select('organization_id')
        .eq('id', visit.branch_id)
        .single()
      if (branchErr) {
        console.error(`[PostService visit=${visit.id}] branch lookup error:`, branchErr.message)
      }

      const visitOrgId = branch?.organization_id
      if (!visitOrgId) {
        console.warn(`[PostService visit=${visit.id}] skip: sucursal sin organization_id (branch=${visit.branch_id})`)
      }
      if (visitOrgId) {
        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .select('name, phone')
          .eq('id', visit.client_id)
          .single()
        if (clientErr) {
          console.error(`[PostService visit=${visit.id}] client lookup error:`, clientErr.message)
        }

        if (!client?.phone) {
          console.warn(`[PostService visit=${visit.id}] skip: cliente sin teléfono (client=${visit.client_id})`)
        }
        if (client?.phone) {
          // Paralelizar: reglas post_service y app_settings son independientes entre sí
          const [{ data: postServiceRules }, { data: settings }] = await Promise.all([
            supabase
              .from('auto_reply_rules')
              .select('*')
              .eq('organization_id', visitOrgId)
              .eq('trigger_type', 'post_service')
              .eq('is_active', true)
              .order('priority', { ascending: false }),
            supabase
              .from('app_settings')
              .select('review_auto_send, review_delay_minutes, review_template_name')
              .eq('organization_id', visitOrgId)
              .maybeSingle(),
          ])

          // Ejecutar reglas post_service (auto_reply_rules legacy)
          if (postServiceRules && postServiceRules.length > 0) {
            for (const rule of postServiceRules) {
              const delayMinutes = (rule.trigger_config as { delay_minutes?: number } | null)?.delay_minutes ?? 10
              const scheduledFor = new Date()
              scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

              if (rule.response_type === 'template' && rule.response_template_name) {
                const { error: schedErr } = await supabase.from('scheduled_messages').insert({
                  client_id: visit.client_id,
                  template_name: rule.response_template_name,
                  template_language: rule.response_template_language || 'es_AR',
                  scheduled_for: scheduledFor.toISOString(),
                  phone: client.phone,
                  status: 'pending',
                })
                if (schedErr) {
                  console.error('[PostService] Error programando template:', schedErr.message)
                } else {
                  console.log('[PostService] Template programado para', client.phone, 'regla:', rule.name)
                }
              } else if (rule.response_text) {
                const { error: schedErr } = await supabase.from('scheduled_messages').insert({
                  client_id: visit.client_id,
                  content: rule.response_text,
                  scheduled_for: scheduledFor.toISOString(),
                  phone: client.phone,
                  status: 'pending',
                })
                if (schedErr) {
                  console.error('[PostService] Error programando texto:', schedErr.message)
                } else {
                  console.log('[PostService] Texto programado para', client.phone, 'regla:', rule.name)
                }
              }
            }
          }

          // Paralelizar: workflows y canales WA son independientes entre sí.
          // orgChannels se resuelve aquí para que, si hay workflows, el convId
          // ya esté disponible sin un RTT extra.
          const phoneSuffix = (client.phone ?? '').replace(/\D/g, '').slice(-10)
          const [
            { data: postServiceWorkflows, error: wfLookupErr },
            { data: orgChannels },
          ] = await Promise.all([
            supabase
              .from('automation_workflows')
              .select('id, name, trigger_config, branch_id, overlap_policy, category')
              .eq('organization_id', visitOrgId)
              .eq('trigger_type', 'post_service')
              .eq('is_active', true)
              .order('priority', { ascending: false }),
            phoneSuffix
              ? supabase
                  .from('social_channels')
                  .select('id')
                  .eq('platform', 'whatsapp')
                  .eq('is_active', true)
                  .eq('organization_id', visitOrgId)
              : Promise.resolve({ data: null, error: null }),
          ])

          if (wfLookupErr) {
            console.error('[PostService:Workflow] lookup error visit=' + visit.id + ':', wfLookupErr.message)
          }

          // Resolver convId: depende de orgChannels (ya disponible)
          let clientConvId: string | null = null
          if (phoneSuffix) {
            const channelIds = orgChannels?.map((c: { id: string }) => c.id) ?? []
            if (channelIds.length > 0) {
              const { data: convRow } = await supabase
                .from('conversations')
                .select('id')
                .in('channel_id', channelIds)
                .ilike('platform_user_id', `%${phoneSuffix}`)
                .order('last_message_at', { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle()
              clientConvId = convRow?.id ?? null
            }
          }

          if (postServiceWorkflows && postServiceWorkflows.length > 0) {
            for (const wf of postServiceWorkflows) {
              const wfTag = `[PostService:Workflow wf=${wf.id} name="${wf.name}" visit=${visit.id}]`
              if (wf.branch_id && wf.branch_id !== visit.branch_id) {
                console.log(`${wfTag} skip: branch_id mismatch (wf=${wf.branch_id} visit=${visit.branch_id})`)
                continue
              }

              // Respetar overlap_policy del workflow.
              // skip_if_active: si ya hay scheduled_message pending o workflow_execution
              // activa para este cliente+workflow, no re-encolar (evita el solape).
              if (wf.overlap_policy === 'skip_if_active') {
                const { count: pendingCount } = await supabase
                  .from('scheduled_messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('workflow_id', wf.id)
                  .eq('client_id', visit.client_id)
                  .eq('status', 'pending')
                if ((pendingCount ?? 0) > 0) {
                  console.log(`${wfTag} skip_if_active: ya hay pending para este cliente`)
                  continue
                }
                if (clientConvId) {
                  const { count: activeCount } = await supabase
                    .from('workflow_executions')
                    .select('id', { count: 'exact', head: true })
                    .eq('workflow_id', wf.id)
                    .eq('conversation_id', clientConvId)
                    .in('status', ['active', 'waiting_reply'])
                  if ((activeCount ?? 0) > 0) {
                    console.log(`${wfTag} skip_if_active: ya hay execution activa conv=${clientConvId}`)
                    continue
                  }
                }
              }

              const delayMinutes = (wf.trigger_config as { delay_minutes?: number } | null)?.delay_minutes ?? 10
              const scheduledFor = new Date()
              scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

              const [entryRes, edgesRes] = await Promise.all([
                supabase
                  .from('workflow_nodes')
                  .select('id')
                  .eq('workflow_id', wf.id)
                  .eq('is_entry_point', true)
                  .limit(1)
                  .maybeSingle(),
                supabase
                  .from('workflow_edges')
                  .select('source_node_id, target_node_id')
                  .eq('workflow_id', wf.id)
                  .order('sort_order')
              ])

              if (entryRes.error) {
                console.error(`${wfTag} entry node lookup error:`, entryRes.error.message)
                continue
              }
              if (edgesRes.error) {
                console.error(`${wfTag} edges lookup error:`, edgesRes.error.message)
                continue
              }
              const entryNode = entryRes.data
              const edges = edgesRes.data
              if (!entryNode) {
                console.warn(`${wfTag} skip: workflow sin entry_point (marcá un nodo como is_entry_point=true)`)
                continue
              }
              if (!edges || edges.length === 0) {
                console.warn(`${wfTag} skip: workflow sin edges (grafo vacío — ¿se guardó correctamente?)`)
                continue
              }

              const firstEdge = edges.find((e: { source_node_id: string; target_node_id: string }) => e.source_node_id === entryNode.id)
              if (!firstEdge) {
                console.warn(`${wfTag} skip: entry_point ${entryNode.id} sin edge saliente`)
                continue
              }
              const { data: firstActionNode, error: firstActionErr } = await supabase
                .from('workflow_nodes')
                .select('id, node_type, config')
                .eq('id', firstEdge.target_node_id)
                .maybeSingle()

              if (firstActionErr) {
                console.error(`${wfTag} first action lookup error:`, firstActionErr.message)
                continue
              }
              if (!firstActionNode) {
                console.warn(`${wfTag} skip: primer nodo de acción no encontrado (target=${firstEdge.target_node_id})`)
                continue
              }

              // Buscar el nodo siguiente al primer action (para workflow_trigger_data)
              const { data: nextEdges } = await supabase
                .from('workflow_edges')
                .select('target_node_id')
                .eq('workflow_id', wf.id)
                .eq('source_node_id', firstActionNode.id)
                .order('sort_order')
                .limit(1)

              const nextNodeId = nextEdges?.[0]?.target_node_id ?? null

              const insertData: Record<string, unknown> = {
                client_id: visit.client_id,
                phone: client.phone,
                organization_id: visitOrgId,
                scheduled_for: scheduledFor.toISOString(),
                status: 'pending',
                workflow_id: wf.id,
                workflow_trigger_data: {
                  client_name: client.name,
                  branch_id: visit.branch_id,
                  visit_id: visit.id,
                  entry_node_id: entryNode.id,
                  first_action_node_id: firstActionNode.id,
                  next_node_id: nextNodeId,
                },
              }

              const actionConfig = firstActionNode.config as Record<string, unknown>
              if (firstActionNode.node_type === 'send_template') {
                insertData.template_name = actionConfig.template_name as string
                insertData.template_language = (actionConfig.language_code as string) || 'es_AR'
                if (!insertData.template_name) {
                  console.error(`${wfTag} skip: send_template sin template_name configurado`)
                  continue
                }
              } else if (firstActionNode.node_type === 'send_message') {
                insertData.content = actionConfig.text as string
                if (!insertData.content) {
                  console.error(`${wfTag} skip: send_message sin texto configurado`)
                  continue
                }
              } else {
                console.warn(`${wfTag} primer nodo de acción de tipo no soportado: ${firstActionNode.node_type}`)
                continue
              }

              const { error: schedErr } = await supabase
                .from('scheduled_messages')
                .insert(insertData)

              if (schedErr) {
                console.error(`${wfTag} insert scheduled_message error:`, schedErr.message)
              } else {
                console.log(`${wfTag} programado (phone=${client.phone}, delay=${delayMinutes}min, action=${firstActionNode.node_type})`)
              }
            }
          } else if (
            !(postServiceRules && postServiceRules.length > 0) &&
            settings?.review_auto_send && settings.review_template_name
          ) {
            // Fallback legacy: usar app_settings si no hay reglas ni workflows post_service
            const delayMinutes = settings.review_delay_minutes ?? 15
            const scheduledFor = new Date()
            scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

            const { error: schedErr } = await supabase.from('scheduled_messages').insert({
              client_id: visit.client_id,
              template_name: settings.review_template_name,
              template_language: 'es_AR',
              scheduled_for: scheduledFor.toISOString(),
              phone: client.phone,
              status: 'pending',
            })
            if (schedErr) {
              console.error('[AutoSend] Error creando scheduled_message:', schedErr.message)
            } else {
              console.log('[AutoSend] Legacy template programado para', client.phone)
            }
          }
        }
      }
    } catch (err) {
      // NO re-throw: el servicio ya se completó, un fallo acá no debe romper
      // la finalización de la visita. Pero logueamos con detalle para que
      // cualquier error silencioso sea detectable en logs de Vercel.
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      console.error(`[PostService visit=${visit.id}] excepción inesperada:`, msg)
    }
  } else {
    console.log(`[PostService visit=${visit.id}] skip: visita sin client_id`)
  }

  // 8. Generar/actualizar el salary_report de comisión por SERVICIO. La de
  //    productos ya la sumó registrarProductosDeVisita en el paso 3.5, en la misma
  //    transacción que el detalle: acá se sumaba con lectura-modificación-escritura
  //    sin mirar el error, y contra el índice único (staff, día, tipo) un reporte
  //    ya liquidado ese día hacía perder la comisión en silencio.
  const serviceCommissionAmount = commissionAmount - productCommissionAmount
  try {
    const tz = await getActiveTimezone()
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

    const [existingServiceReport] = await Promise.all([
      serviceCommissionAmount > 0
        ? supabase
            .from('salary_reports')
            .select('id, amount')
            .eq('staff_id', visit.barber_id)
            .eq('branch_id', visit.branch_id)
            .eq('type', 'commission')
            .eq('report_date', todayStr)
            .eq('status', 'pending')
            .maybeSingle()
            .then(r => r.data)
        : Promise.resolve(null),
    ])

    // 8a. Reporte de comisión por servicio
    if (serviceCommissionAmount > 0) {
      if (existingServiceReport) {
        await supabase
          .from('salary_reports')
          .update({ amount: Number(existingServiceReport.amount) + serviceCommissionAmount })
          .eq('id', existingServiceReport.id)
      } else {
        await supabase
          .from('salary_reports')
          .insert({
            staff_id: visit.barber_id,
            branch_id: visit.branch_id,
            type: 'commission',
            amount: serviceCommissionAmount,
            report_date: todayStr,
            status: 'pending',
          })
      }
    }
  } catch (err) {
    console.error('[SalaryReport] Error al generar reportes de comisión:', err)
  }

  // 9. Programa de fidelización (mig 197/203): cierre EXPLÍCITO de la visita.
  //    El trigger trg_loyalty_on_visit ya corrió con cada UPDATE de amount (y ya
  //    acreditó/recalculó); esta llamada manda las notificaciones que dependen
  //    del importe FINAL y devuelve el resumen que la tablet le muestra al
  //    barbero (puntos, categoría, cambio). Best-effort: NUNCA rompe el cobro.
  //    `tier_changed` NO es "lo que hizo esta llamada": la transición ya la había
  //    consumido el trigger antes de que finalize corriera, así que desde la mig
  //    203 la RPC lo deriva de los eventos de la visita ('up' | 'enrolled' |
  //    'grace' | 'down' | 'recovered' | null). Acá no se deriva nada: se toma lo
  //    que dice la RPC y sólo se normaliza a los valores conocidos.
  //    Sin client_id no hay programa que cerrar (walk-in anónimo / cliente especial).
  let loyalty: LoyaltyFinalizeResult | null = null
  if (visit.client_id) {
    try {
      const { data: loyaltyData, error: loyaltyErr } = await supabase.rpc('loyalty_finalize_visit', {
        p_visit_id: visit.id,
      })
      if (loyaltyErr) {
        console.error('[completeService] loyalty_finalize_visit', loyaltyErr.message)
      } else if (loyaltyData && typeof loyaltyData === 'object') {
        loyalty = loyaltyData as LoyaltyFinalizeResult
        loyalty.tier_changed = asTierChange(loyalty.tier_changed)
        // La RPC no devuelve la fecha límite de la gracia y la tablet tiene que decir
        // "le quedan X días para mantener Oro": se lee del estado del cliente.
        if (loyalty.enabled && loyalty.tier_changed === 'grace') {
          const { data: st } = await supabase
            .from('client_loyalty_state')
            .select('grace_until')
            .eq('client_id', visit.client_id)
            .not('grace_until', 'is', null)
            .limit(1)
          const graceUntil = st?.[0]?.grace_until as string | null | undefined
          if (graceUntil) {
            loyalty.grace_until = graceUntil
            loyalty.grace_days_left = Math.max(0, Math.ceil((new Date(graceUntil).getTime() - Date.now()) / 86_400_000))
          }
        }
      }
    } catch (err) {
      console.error('[completeService] loyalty_finalize_visit', err)
    }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  return {
    success: true as const,
    visitId: visit.id,
    breakAutoStarted,
    couponApplied: couponClientRewardId != null,
    couponDiscountAmount,
    couponWarning,
    // Merch/especial entregado con este cobro (nombre del premio) — mig 196.
    couponDelivered,
    // Invitación de un amigo aplicada (referidos) — mig 197.
    referralApplied,
    jointWarning,
    // Resumen del programa de fidelización para la tablet; null si no aplica.
    loyalty,
    // Seña consumida en este cobro (mig 207). La tablet lo usa para decir
    // "cobrá $8.000: los otros $8.000 ya están señados". null = no hubo seña.
    prepaid: depositId ? { amount: prepaidAmount, depositId } : null,
    // La seña terminó siendo mayor que el precio final (cupón/premio aplicado
    // sobre un turno señado): hay saldo a favor del cliente. Ver 4.5b.
    senaWarning,
    // Los productos se cobraron pero algo no quedó registrado (detalle, stock o
    // comisión del día). Ver 3.5. null = todo registrado o no hubo productos.
    productWarning,
    // La entrada se cerró pero el importe no quedó escrito en la visita (el
    // UPDATE del paso 4 falló dos veces). Hay que mostrarlo SIEMPRE: la visita
    // quedó en $0 y sólo el encargado la puede corregir. null = quedó bien.
    visitaWarning,
    // Fotos del corte que quedaron en la visita al cerrar (ver 2b).
    fotos: await fotosPromesa,
  }
}

export async function cancelQueueEntry(
  queueEntryId: string,
  options?: { allowInProgress?: boolean },
) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  // Obtener la entrada para validar la sucursal y decidir qué estados son cancelables.
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, is_break, break_request_id, appointment_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Override de admin (solo dashboard): permitir cancelar un corte YA iniciado
  // (in_progress). Se exige sesión de Supabase Auth — el panel del barbero usa cookie
  // PIN (barber_session) y NO tiene auth user, así que NUNCA puede forzar esto y
  // conserva la protección de abajo. El cobro de ese corte se pierde a propósito:
  // es una decisión explícita del admin, confirmada en la UI del dashboard.
  let adminCanCancelInProgress = false
  if (options?.allowInProgress) {
    try {
      const authClient = await createClient()
      const { data: { user } } = await authClient.auth.getUser()
      adminCanCancelInProgress = !!user
    } catch {
      adminCanCancelInProgress = false
    }
  }

  // Guard de estado: para CLIENTES sólo se cancela 'waiting'. Sin esto, un tap en
  // la X ("No se presentó") sobre un cliente que OTRO barbero ya pasó a in_progress
  // (carrera de UI por lag de realtime) pisaba ese in_progress y dejaba el corte
  // sin poder cobrarse. Para DESCANSOS sí permitimos cancelar también el que ya
  // arrancó (in_progress): no hay corte que cobrar y el descanso pudo crearse por
  // error o el barbero quiere volver antes (createBreakEntry lo arranca solo si el
  // barbero no tenía corte activo, así que la X tiene que poder cancelarlo). El
  // admin del dashboard también puede cancelar in_progress vía override explícito.
  const cancelableStatuses =
    entry.is_break || adminCanCancelInProgress ? ['waiting', 'in_progress'] : ['waiting']

  // Quién saca al cliente de la fila (mig 211). Hasta el 4/9/2026 una cancelación no
  // dejaba NINGÚN rastro —ni cuándo, ni quién, ni por qué— y eso hizo que meses de
  // clientes que se anotaban y desaparecían fueran indistinguibles de clientes que se
  // iban solos. Cookie del panel o sesión del dashboard: ver `resolverActorStaffId`.
  const actorStaffId = await resolverActorStaffId(supabase, orgAccess)

  const { data: cancelledRows, error } = await supabase
    .from('queue_entries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actorStaffId,
      cancel_reason: entry.is_break ? 'break_cancelado' : 'no_show',
    })
    .eq('id', queueEntryId)
    .in('status', cancelableStatuses)
    .select('id')

  if (error) {
    return { error: 'Error al cancelar' }
  }

  if (!cancelledRows || cancelledRows.length === 0) {
    // El entry ya no estaba en un estado cancelable (lo empezaron a atender,
    // se completó, o el descanso ya había terminado).
    return {
      error: entry.is_break
        ? 'El descanso ya finalizó'
        : 'El cliente ya está siendo atendido o fue completado',
    }
  }

  // Si el descanso provenía de una solicitud formal (break_request), cerrarla para
  // no dejarla huérfana en estado 'approved' — BreakRequestStatus no tiene 'cancelled'.
  if (entry.is_break && entry.break_request_id) {
    await supabase
      .from('break_requests')
      .update({ status: 'completed', actual_completed_at: new Date().toISOString() })
      .eq('id', entry.break_request_id)
  }

  // Sincronizar el turno de origen. La X de "no se presentó" cancelaba sólo la
  // entrada de fila: el turno quedaba en `checked_in` para siempre, seguía
  // ocupando su rango en la exclusión de solapamiento (nadie podía reservar ese
  // horario) y no contaba como ausente en ninguna métrica.
  if (entry.appointment_id) {
    const { error: apptError } = await supabase
      .from('appointments')
      .update({
        status: 'no_show',
        no_show_marked_at: new Date().toISOString(),
        queue_entry_id: null,
      })
      .eq('id', entry.appointment_id)
      .in('status', ['checked_in', 'in_progress'])

    if (apptError) {
      console.error('[cancelQueueEntry] sync turno:', apptError.message)
    }
    revalidatePath('/dashboard/turnos/agenda')
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

/**
 * «No se hizo nada · Cerrar como solo asesoría» (mig 217).
 *
 * El cliente pidió asesoría, el barbero lo asesoró y no se hizo ningún servicio.
 * La entrada se cierra SIN visita: `status = 'cancelled'` con
 * `cancel_reason = 'solo_asesoria'`, `cancelled_at` y `cancelled_by` (el actor).
 * Como no hay visita no cuenta como corte, ni como visita de fidelización, ni
 * genera comprobante de ARCA ni pedido de reseña. Tampoco es un abandono: la
 * vista `queue_abandonos` sólo mira entradas que nunca empezaron
 * (`started_at IS NULL`) y ésta estuvo en curso.
 *
 * Sólo desde `in_progress`, sólo si pidió asesoría, nunca un descanso y nunca un
 * turno (`appointment_id`): cancelar una entrada de turno la pasa a `no_show` por
 * trigger, y un turno que vino se cobra con el servicio que se hizo.
 *
 * Idempotente: si ya estaba cerrada así (doble toque, reintento tras un timeout,
 * la otra tablet) devuelve `{ success: true, yaCerrada: true }`.
 *
 * Quién puede (hallazgo asesoria-05): con la cookie del panel, SÓLO el barbero
 * que la está atendiendo (`staff_id` de la cookie = `barber_id` de la entrada);
 * antes cualquier panel de la sucursal cerraba sin visita el corte de otro. Sin
 * cookie, un usuario del dashboard con acceso a la sucursal (la X de un corte en
 * curso en /dashboard/fila).
 *
 * Después de cerrar (hallazgo asesoria-06):
 *   - las sesiones de fotos de la entrada se cierran y lo que se subió se borra
 *     (filas y objetos): no hay visita en la que guardarlo. Best-effort: si algo
 *     queda a medias, el cierre igual vale y vuelve `aviso`;
 *   - arranca el descanso pendiente del barbero, igual que después de cobrar
 *     (`breakAutoStarted`).
 */
export async function cerrarSoloAsesoria(
  queueEntryId: string,
): Promise<
  | { success: true; yaCerrada: boolean; aviso: string | null; breakAutoStarted: boolean }
  | { error: string }
> {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  const { data: entry, error: errEntry } = await supabase
    .from('queue_entries')
    .select('branch_id, barber_id, status, is_break, pidio_asesoria, appointment_id, cancel_reason')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (errEntry) {
    console.error('[cerrarSoloAsesoria] leer la entrada:', { queueEntryId, error: errEntry.message })
    return { error: 'No pudimos cerrar la asesoría. Probá de nuevo.' }
  }
  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Quién la cierra. Con la cookie del panel manda la cookie (mismo criterio que
  // getCurrentOrgId): aunque la tablet tenga una sesión del dashboard residual.
  const staffPanel = await staffDeLaCookieDelPanel()
  if (staffPanel) {
    if (!entry.barber_id || entry.barber_id !== staffPanel) {
      return { error: 'Sólo el barbero que lo está atendiendo puede cerrarlo como solo asesoría.' }
    }
  } else {
    const permitidas = await getScopedBranchIds()
    if (!permitidas.includes(entry.branch_id)) return { error: 'No tenés acceso a esta sucursal.' }
  }

  if (entry.status === 'cancelled' && entry.cancel_reason === MOTIVO_SOLO_ASESORIA) {
    // Reintento u otro dispositivo: la limpieza de fotos es idempotente y se
    // repite por si la primera quedó a medias. El descanso no: ya lo decidió el
    // cierre que sí cerró (y el barbero pudo haber tomado a otro).
    const aviso = await descartarFotosSinVisita(supabase, queueEntryId)
    return { success: true, yaCerrada: true, aviso, breakAutoStarted: false }
  }
  if (entry.status === 'completed') return { error: 'Esta asesoría ya se cobró.' }
  if (entry.is_break || entry.pidio_asesoria !== true) {
    return { error: 'Este cliente no pidió asesoría: cobralo con el servicio que se hizo.' }
  }
  if (entry.appointment_id) return { error: 'Es un turno: cobralo con el servicio que se hizo.' }
  if (entry.status !== 'in_progress') return { error: 'La asesoría no está en curso.' }

  const actorStaffId = await resolverActorStaffId(supabase, orgAccess)

  // Las mismas condiciones en la UPDATE: entre la lectura y acá la otra tablet
  // pudo cobrarla, o un check-in de turno pudo adoptar la entrada. Desde el
  // panel, además, que siga siendo de este barbero.
  let cierre = supabase
    .from('queue_entries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actorStaffId,
      cancel_reason: MOTIVO_SOLO_ASESORIA,
    })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')
    .eq('pidio_asesoria', true)
    .is('appointment_id', null)
  if (staffPanel) cierre = cierre.eq('barber_id', staffPanel)
  const { data: cerradas, error } = await cierre.select('id')

  if (error) {
    console.error('[cerrarSoloAsesoria] cerrar:', { queueEntryId, error: error.message })
    return { error: 'No pudimos cerrar la asesoría. Probá de nuevo.' }
  }

  if (!cerradas || cerradas.length === 0) {
    const { data: ahora, error: errAhora } = await supabase
      .from('queue_entries')
      .select('status, cancel_reason, appointment_id')
      .eq('id', queueEntryId)
      .maybeSingle()
    if (errAhora) {
      console.error('[cerrarSoloAsesoria] releer la entrada:', { queueEntryId, error: errAhora.message })
      return { error: 'No pudimos cerrar la asesoría. Probá de nuevo.' }
    }
    if (ahora?.status === 'cancelled' && ahora.cancel_reason === MOTIVO_SOLO_ASESORIA) {
      const aviso = await descartarFotosSinVisita(supabase, queueEntryId)
      return { success: true, yaCerrada: true, aviso, breakAutoStarted: false }
    }
    if (ahora?.status === 'completed') return { error: 'Esta asesoría ya se cobró.' }
    if (ahora?.appointment_id) return { error: 'Es un turno: cobralo con el servicio que se hizo.' }
    return { error: 'La asesoría no está en curso.' }
  }

  // Después del cierre: nada de esto lo deshace ni lo hace fallar.
  const [aviso, breakAutoStarted] = await Promise.all([
    descartarFotosSinVisita(supabase, queueEntryId),
    arrancarDescansoPendiente(supabase, (entry.barber_id as string | null) ?? null, entry.branch_id),
  ])
  if (aviso) console.warn('[cerrarSoloAsesoria] cierre con aviso', { queueEntryId, aviso })

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true, yaCerrada: false, aviso, breakAutoStarted }
}

export async function reassignBarber(
  queueEntryId: string,
  newBarberId: string | null
) {
  if (!isValidUUID(queueEntryId)) return { error: 'queueEntryId inválido' }
  if (newBarberId !== null && !isValidUUID(newBarberId)) return { error: 'barberId inválido' }
  const supabase = createAdminClient()

  // Obtener branch_id de la entrada para validar acceso
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .eq('status', 'waiting')
    .single()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId, is_dynamic: !newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al reasignar barbero' }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function checkinClientByFace(
  clientId: string,
  branchId: string,
  barberId: string | null,
  serviceId: string | null = null,
  // Asesoría sin costo (mig 217): `true` = tocó «¿No sabés qué hacerte?» en vez de
  // un servicio. Misma lógica y mismas claves de respuesta que `checkinClient`.
  asesoria: boolean = false,
) {
  if (!isValidUUID(clientId) || !isValidUUID(branchId)) return { error: 'Datos inválidos' }
  if (barberId !== null && !isValidUUID(barberId)) barberId = null
  if (serviceId !== null && !isValidUUID(serviceId)) serviceId = null
  // Llega del browser: sólo `true` cuenta como pedido.
  const pidioAsesoria = asesoria === true

  // Rate limit: el MISMO de checkinClient (20 por IP+sucursal cada 60 s). Esta
  // action es pública y su id viaja en el bundle del kiosko: sin límite servía
  // para anotar clientes arbitrarios en cualquier fila y, con `asesoria`, para
  // marcar como «quiere asesoría» a quien ya estaba esperando (hallazgos
  // asesoria-02 y seguridad-y-despliegue-07).
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskCheckin(branchId)
  if (!gate.allowed) {
    return { error: 'Demasiados check-ins en poco tiempo. Esperá un momento.' }
  }

  const supabase = createAdminClient()

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su organización
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck?.organization_id) return { error: 'Sucursal no encontrada o inactiva' }

  // Mismo criterio que `checkinClient`: se revalida el interruptor (falla
  // abierta, nunca rechaza) en paralelo con la búsqueda del cliente.
  const asesoriaPermitidaP = pidioAsesoria
    ? asesoriaPermitidaEnSucursal(supabase, branchId, 'checkinClientByFace')
    : Promise.resolve(false)

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .eq('organization_id', branchCheck.organization_id)
    .single()

  if (!client) {
    return { error: 'Cliente no encontrado' }
  }

  // Mismo criterio que `checkinClient`: el "ya estás en la fila" es POR SUCURSAL.
  // Sin el scope, la cámara reconocía al cliente y lo rebotaba a "ya tenés lugar"
  // mostrándole la posición de otro local. Ver `resolverEntradaActiva`.
  const activoFace = await resolverEntradaActiva(supabase, clientId, branchId)
  if (activoFace.enEstaSucursal) {
    const asesoriaExistente = await sumarAsesoriaAEntradaActiva(
      supabase,
      activoFace.enEstaSucursal,
      { pidio: pidioAsesoria, permitida: await asesoriaPermitidaP },
      branchId,
      'checkinClientByFace',
    )
    return {
      alreadyInQueue: true,
      position: activoFace.enEstaSucursal.position,
      queueEntryId: activoFace.enEstaSucursal.id,
      asesoriaPedida: asesoriaExistente.asesoriaPedida,
      asesoriaSumada: asesoriaExistente.asesoriaSumada,
      asesoriaMotivo: asesoriaExistente.asesoriaMotivo,
    }
  }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  // Si la asesoría queda, reemplaza al servicio (ver `checkinClient`).
  const asesoriaQueda = pidioAsesoria && (await asesoriaPermitidaP)

  // Modelo pool (mig 134): dinámico entra con barber_id = NULL. Ver checkinClient.
  const nowFace = new Date().toISOString()
  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      client_id: clientId,
      barber_id: barberId,
      service_id: asesoriaQueda ? null : serviceId,
      pidio_asesoria: asesoriaQueda,
      position: position ?? 1,
      status: 'waiting',
      is_dynamic: !barberId,
      priority_order: nowFace,
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    if (queueError?.code === '23505') {
      const { data: existing } = await supabase
        .from('queue_entries')
        .select('id, position, status, appointment_id')
        .eq('client_id', clientId)
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .single()
      const asesoriaExistente = await sumarAsesoriaAEntradaActiva(
        supabase,
        existing ?? null,
        { pidio: pidioAsesoria, permitida: await asesoriaPermitidaP },
        branchId,
        'checkinClientByFace',
      )
      return {
        alreadyInQueue: true,
        position: existing?.position ?? 1,
        queueEntryId: existing?.id ?? '',
        asesoriaPedida: asesoriaExistente.asesoriaPedida,
        asesoriaSumada: asesoriaExistente.asesoriaSumada,
        asesoriaMotivo: asesoriaExistente.asesoriaMotivo,
      }
    }
    console.error('[checkinClientByFace] insert queue entry:', queueError?.message)
    return { error: 'Error al agregar a la fila' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  return { success: true, position, queueEntryId: queueEntry.id, asesoria: asesoriaQueda }
}

export async function reassignMyBarber(
  queueEntryId: string,
  newBarberId: string | null,
  clientId: string
) {
  if (!isValidUUID(queueEntryId)) return { error: 'Datos inválidos' }
  // newBarberId null = volver al pool dinámico ("Menor espera"). El UPDATE de abajo
  // ya setea is_dynamic: !newBarberId. Sólo validamos el UUID si se eligió un barbero
  // específico (antes esta guarda rechazaba null y rompía el CTA "Menor espera").
  if (newBarberId !== null && !isValidUUID(newBarberId)) return { error: 'Datos inválidos' }
  // Prueba de posesión: el cliente debe conocer el client_id de SU entry. Es el
  // único ownership factible sin sesión de cliente en el kiosk compartido.
  // Sin esto, cualquier anónimo con un queueEntryId (visible vía RLS pública)
  // podía reasignar el barbero de OTRO cliente (IDOR — auditoría jun-2026).
  if (!isValidUUID(clientId)) return { error: 'Datos inválidos' }
  const supabase = createAdminClient()

  // Operación pública del kiosko: traer también client_id y status para ownership.
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, client_id, status')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  // Ownership: el client_id provisto debe coincidir con el dueño del entry.
  // Mensaje genérico para no filtrar si el entry existe o no.
  if (entry.client_id !== clientId) return { error: 'Entrada no encontrada' }

  // Sólo se puede reasignar mientras se espera (no en in_progress/completed).
  if (entry.status !== 'waiting') return { error: 'El cliente ya está siendo atendido' }

  // Rate-limit por IP+branch contra fuerza bruta del IDOR.
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskReassign(entry.branch_id)
  if (!gate.allowed) {
    return { error: 'Demasiados cambios en poco tiempo. Esperá un momento.' }
  }

  // Verificar que la sucursal esté activa (validación mínima para operaciones públicas)
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id')
    .eq('id', entry.branch_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck) return { error: 'Sucursal no encontrada o inactiva' }

  // Verificar que el nuevo barbero pertenece a la misma sucursal.
  // Si newBarberId es null (pool dinámico / "Menor espera") se omite el chequeo.
  if (newBarberId) {
    const { data: barberCheck } = await supabase
      .from('staff')
      .select('id')
      .eq('id', newBarberId)
      .eq('branch_id', entry.branch_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!barberCheck) return { error: 'Barbero no disponible en esta sucursal' }
  }

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId, is_dynamic: !newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al cambiar barbero' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function updateQueueOrder(
  updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean; priority_order?: string }[]
) {
  if (updates.length === 0) return { success: true }
  // Validar que todos los IDs son UUIDs válidos antes de consultar DB
  if (updates.some(u => !isValidUUID(u.id))) return { error: 'IDs inválidos' }
  if (updates.some(u => u.barber_id != null && !isValidUUID(u.barber_id))) {
    return { error: 'barberId inválido' }
  }

  const supabase = createAdminClient()

  // Cargar branch_id de TODOS los IDs y validar que todos pertenecen a la misma org
  const allIds = updates.map(u => u.id)
  const { data: allEntries } = await supabase
    .from('queue_entries')
    .select('id, branch_id')
    .in('id', allIds)

  if (!allEntries || allEntries.length !== allIds.length) {
    return { error: 'Una o más entradas no encontradas' }
  }

  // Validar la primera sucursal (todas deben pertenecer a la misma org)
  const orgAccess = await validateBranchAccess(allEntries[0].branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Verificar que todas las entradas pertenecen al scope del usuario (org + sucursal permitida)
  const scopedBranchIds = await getScopedBranchIds()
  const foreignEntry = allEntries.find(e => !scopedBranchIds.includes(e.branch_id))
  if (foreignEntry) return { error: 'Acceso denegado: entradas fuera de tu alcance' }

  // Usar RPC para hacer todas las actualizaciones en una sola transacción
  const payload = updates.map((u) => ({
    id: u.id,
    position: u.position,
    ...(u.barber_id !== undefined && { barber_id: u.barber_id ?? '' }),
    ...(u.is_dynamic !== undefined && { is_dynamic: u.is_dynamic }),
    ...(u.priority_order !== undefined && { priority_order: u.priority_order }),
  }))

  const { error } = await supabase.rpc('batch_update_queue_entries', {
    p_updates: payload,
  })

  if (error) {
    return { error: 'Error al actualizar el orden de la fila' }
  }

  // No revalidatePath: la UI ya se actualizó optimísticamente
  // y Realtime sincroniza a los demás clientes
  return { success: true }
}

/**
 * Pausa el corte activo: marca `paused_at = now()` si no está ya pausado.
 * La duración total de la pausa se acumula en `paused_duration_seconds` al reanudar.
 */
export async function pauseActiveService(queueEntryId: string) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, status, is_break, paused_at')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }
  if (entry.is_break) return { error: 'No se pueden pausar descansos' }
  if (entry.status !== 'in_progress') return { error: 'El corte no está activo' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  if (entry.paused_at) return { success: true, alreadyPaused: true }

  const { error } = await supabase
    .from('queue_entries')
    .update({ paused_at: new Date().toISOString() })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')
    .is('paused_at', null)

  if (error) return { error: 'Error al pausar: ' + error.message }

  revalidatePath('/barbero/fila')
  return { success: true }
}

/**
 * Reanuda el corte: acumula en `paused_duration_seconds` el tiempo que estuvo
 * pausado y setea `paused_at = null`.
 */
export async function resumeActiveService(queueEntryId: string) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, status, is_break, paused_at, paused_duration_seconds')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }
  if (entry.is_break) return { error: 'Operación inválida para descansos' }
  if (entry.status !== 'in_progress') return { error: 'El corte no está activo' }
  if (!entry.paused_at) return { success: true, alreadyRunning: true }

  const pausedMs = Date.now() - new Date(entry.paused_at).getTime()
  const additionalSec = Math.max(0, Math.floor(pausedMs / 1000))
  const newTotal = (entry.paused_duration_seconds ?? 0) + additionalSec

  const { error } = await supabase
    .from('queue_entries')
    .update({
      paused_at: null,
      paused_duration_seconds: newTotal,
    })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')

  if (error) return { error: 'Error al reanudar: ' + error.message }

  revalidatePath('/barbero/fila')
  return { success: true }
}

export async function createBreakEntry(branchId: string, barberId: string, _breakConfigName: string) {
  const supabase = createAdminClient()

  // Validar que la sucursal pertenece a la org activa
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  // Si el barbero no tiene un servicio activo, el descanso empieza de inmediato
  const { data: currentService } = await supabase
    .from('queue_entries')
    .select('id')
    .eq('barber_id', barberId)
    .eq('status', 'in_progress')
    .eq('is_break', false)
    .maybeSingle()

  const shouldStartImmediately = !currentService

  const nowBreak = new Date().toISOString()
  const { data: queueEntry, error } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      position: position ?? 1,
      status: shouldStartImmediately ? 'in_progress' : 'waiting',
      started_at: shouldStartImmediately ? nowBreak : null,
      is_break: true,
      is_dynamic: false,
      priority_order: nowBreak,
    })
    .select('id')
    .single()

  if (error || !queueEntry) {
    return { error: 'Error al asignar descanso' }
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/barbero/fila')
  return { success: true, queueEntryId: queueEntry.id, position }
}
