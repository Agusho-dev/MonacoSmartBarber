/**
 * POST /api/webhooks/mercadopago/senas?b=<branch_id>
 *
 * La notificación de Mercado Pago que convierte un pago en un turno. Es el
 * punto más delicado del sistema: acá se decide si alguien tiene o no tiene
 * turno, y del otro lado hay un remitente que no controlamos.
 *
 * NO ES EL WEBHOOK DE `/api/webhooks/mercadopago` (ese es el de las
 * suscripciones del SaaS, con su propio secreto y su propia tabla). Se separan
 * a propósito: aquél acepta cualquier POST cuando no hay secreto configurado
 * (`if (!secret) return true`), que para un refresh de estado de suscripción es
 * defendible y acá sería regalar turnos.
 *
 * EL ORDEN, Y POR QUÉ ES ESE
 * --------------------------
 *  1. Body CRUDO y ACOTADO. La firma se calcula sobre headers y query, pero el
 *     body hay que leerlo sin que nadie lo toque antes por si algún día entra
 *     en el manifest. Se corta en `MAX_BODY_BYTES`: una notificación real de
 *     Mercado Pago pesa menos de 1 KB y este endpoint es anónimo por
 *     definición (la firma recién se puede verificar dos pasos más abajo).
 *  2. Medir el CUPO por IP. No rechaza acá: se mide y se decide al final, para
 *     que el tope no pueda voltear una notificación legítima (ver abajo).
 *  3. Resolver la SUCURSAL. Sin sucursal no hay token, y sin token no se puede
 *     ni consultar el pago ni verificar la firma. Dos caminos: el query `?b=`
 *     que horneamos en la `notification_url` de cada preferencia, y como
 *     respaldo el `user_id` del body (el collector de la cuenta que cobró) —
 *     que es lo único que trae una notificación configurada desde el panel de
 *     Mercado Pago en vez de desde la preferencia.
 *  4. Verificar la FIRMA con el secreto de esa cuenta. Falla → 401.
 *  5. Registrar el evento en `payment_webhook_events` (válido o no: es el
 *     registro que permite contestar "¿MP nos avisó?" sin reproducir un pago).
 *  6. Procesar y contestar.
 *
 * EL CUPO NUNCA LE GANA A UNA FIRMA VÁLIDA
 * ----------------------------------------
 * `payment_webhook_events` la escribe un endpoint sin autenticación: sin tope,
 * cualquiera lo usa de tabla de escritura anónima. Pero un rate-limit que
 * conteste 429 antes de mirar la firma es peor que el problema, porque Mercado
 * Pago reintenta una notificación rechazada sólo cada 15 minutos y ráfagas
 * legítimas existen (un lote de pagos acreditándose junto, o MP repitiendo
 * varias notificaciones del mismo pago). Por eso el cupo se mide temprano pero
 * se aplica tarde y sólo sobre lo que NO trae firma válida: una notificación
 * firmada se procesa y se registra siempre. Lo que el tope corta es la
 * ESCRITURA del ruido, no el trabajo real.
 *
 * Del intento con firma inválida se sigue guardando la fila —esa señal es
 * justamente la que avisa que un secreto quedó mal rotado— pero nunca el body
 * completo: sólo los campos que importan (`payloadResumido`).
 *
 * POR QUÉ SE PROCESA ANTES DE CONTESTAR (y no con `after()`)
 * ----------------------------------------------------------
 * Mercado Pago corta a los 22 s y reintenta cada 15 minutos hasta recibir un
 * 200. Ese reintento es el ÚNICO mecanismo gratis de recuperación que tenemos,
 * y sólo sirve si el 200 significa de verdad "ya está". Contestando 200 primero
 * y trabajando después (`after()`), un hipo de red contra la API de Mercado
 * Pago o un error de la base dejarían la seña en `iniciada` con MP convencido
 * de que nos avisó: el cliente se queda mirando "confirmando tu pago" hasta que
 * el cron de conciliación la levante, que es recién cuando el link vence.
 *
 * El trabajo está acotado a una llamada a Mercado Pago (`GET /v1/payments/{id}`,
 * con timeout propio de 15 s en `mercadopago/http.ts`) más la creación del
 * turno por el motor de siempre. `maxDuration = 30` deja margen sobre los 22 s
 * de MP; si alguna vez se pasa, el reintento cae sobre una operación IDEMPOTENTE
 * (UPDATE condicional por estado + índice único sobre `mp_payment_id`), así que
 * lo peor que puede pasar es una notificación repetida, nunca un turno doble.
 *
 * Regla de status: TODO se contesta 200 —incluidos los eventos que no
 * entendemos, los `merchant_order` y los pagos que no referencian ninguna seña—
 * salvo cuatro casos: body descomunal (400), ráfaga sin firma válida (429),
 * firma inválida (401, no hay nada que reintentar) y una excepción de red o de
 * base (503, que es como se le pide a MP que vuelva). Un 500 por un evento que
 * simplemente no nos interesa pone a Mercado Pago a reintentarlo cada 15
 * minutos para siempre; por eso ninguna excepción se escapa sin traducirse.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getClientIP, rateLimit } from '@/lib/rate-limit'
import { verificarFirmaWebhook } from '@/lib/mercadopago/firma'
import {
  resolverProveedor,
  resolverProveedorPorCollector,
  secretoWebhook,
  type ProveedorResuelto,
} from '@/lib/mercadopago/credenciales'
import { acreditarPago } from '@/lib/senas/motor'
import { isValidUUID } from '@/lib/validation'
import type { ResultadoAcreditacion } from '@/lib/senas/contrato'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Lo que MP manda como notificación de un pago (el resto de los campos se ignora). */
interface CuerpoNotificacion {
  type?: string
  topic?: string
  action?: string
  data?: { id?: string | number }
  id?: string | number
  user_id?: string | number
  live_mode?: boolean
}

/**
 * Tope del body. Una notificación de Mercado Pago pesa menos de 1 KB; 16 KB deja
 * lugar de sobra para que MP le agregue campos algún día sin que este endpoint
 * —anónimo hasta el paso de la firma— sirva para empujar megabytes a la base.
 */
const MAX_BODY_BYTES = 16 * 1024

/**
 * Cupo por IP, DELIBERADAMENTE generoso: 300 por minuto.
 *
 * Mercado Pago notifica desde su propio rango de IPs y puede mandar varias
 * notificaciones del mismo pago (`payment` + `merchant_order`, más reintentos):
 * un tope apretado nos dejaría sin la que crea el turno. Y aun así el cupo no
 * bloquea nada firmado — sólo frena la escritura del ruido.
 */
const CUPO_WEBHOOK = { limit: 300, window: 60 } as const

/** Respuesta corta y sin datos: del otro lado hay un remitente que no controlamos. */
function ok(detalle: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, detalle, ...(extra ?? {}) }, { status: 200 })
}

/**
 * Lee el body cortando en `MAX_BODY_BYTES`. Devuelve `null` si se pasa.
 *
 * No alcanza con mirar `content-length` (una request `chunked` no lo trae y es
 * justo la forma en que se manda un body enorme sin anunciarlo), así que se
 * mira el header como atajo y además se cuenta lo que va llegando, cancelando
 * el stream en cuanto se pasa: nunca se materializa en memoria más que el tope.
 */
async function leerCuerpoAcotado(req: NextRequest): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) return null

  const stream = req.body
  if (!stream) return ''

  const reader = stream.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    partes.push(value)
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const parte of partes) {
    buffer.set(parte, offset)
    offset += parte.byteLength
  }
  return new TextDecoder().decode(buffer)
}

/** Recorta un valor del remitente antes de guardarlo. */
function corto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  return String(valor).slice(0, 200)
}

/**
 * Lo ÚNICO que se guarda del body.
 *
 * El resto de la notificación no aporta nada —la fuente de verdad es siempre
 * `GET /v1/payments/{id}`— y guardarla entera convierte a `payment_webhook_events`
 * en un depósito de texto arbitrario escrito por cualquiera.
 */
function payloadResumido(cuerpo: CuerpoNotificacion): Record<string, unknown> {
  return {
    type: corto(cuerpo.type),
    topic: corto(cuerpo.topic),
    action: corto(cuerpo.action),
    data_id: corto(cuerpo.data?.id),
    id: corto(cuerpo.id),
    user_id: corto(cuerpo.user_id),
    live_mode: typeof cuerpo.live_mode === 'boolean' ? cuerpo.live_mode : null,
  }
}

/**
 * Deja la notificación registrada. Devuelve el id de la fila (o null) para
 * poder cerrarla al final con `processed_at`.
 *
 * El índice único parcial `(provider, request_id)` dedupea los reintentos de
 * MP, que repiten el mismo `x-request-id`. Un choque NO es un error: significa
 * "ya la habíamos anotado", y devolvemos la fila existente para saber si aquella
 * vez llegó a procesarse.
 */
async function registrarEvento(params: {
  branchId: string | null
  eventType: string | null
  action: string | null
  resourceId: string
  requestId: string | null
  mpUserId: string | null
  signatureOk: boolean
  payload: unknown
  error: string | null
}): Promise<{ id: string | null; yaProcesado: boolean }> {
  const supabase = createAdminClient()
  const fila = {
    provider: 'mercadopago',
    branch_id: params.branchId,
    event_type: params.eventType,
    action: params.action,
    resource_id: params.resourceId,
    request_id: params.requestId,
    mp_user_id: params.mpUserId,
    signature_ok: params.signatureOk,
    payload: params.payload,
    error: params.error,
  }

  const { data, error } = await supabase
    .from('payment_webhook_events')
    .insert(fila)
    .select('id')
    .maybeSingle<{ id: string }>()

  if (!error) return { id: data?.id ?? null, yaProcesado: false }

  // 23505 = ya existe una fila con ese request_id: es un reintento de MP.
  if (error.code === '23505' && params.requestId) {
    const { data: previa } = await supabase
      .from('payment_webhook_events')
      .select('id, processed_at')
      .eq('provider', 'mercadopago')
      .eq('request_id', params.requestId)
      .maybeSingle<{ id: string; processed_at: string | null }>()
    return { id: previa?.id ?? null, yaProcesado: !!previa?.processed_at }
  }

  // No poder auditar no puede impedir acreditar un pago: se registra el fallo
  // y se sigue. El pago es lo que importa; la auditoría se reconstruye después
  // desde `booking_deposits` (que sí guarda el `mp_payment_id`).
  console.error('[mp-webhook-senas] no pudimos registrar el evento:', error.message)
  return { id: null, yaProcesado: false }
}

/**
 * Cierra la fila del evento. Nunca tira: quien la llama ya contestó lo suyo.
 *
 * `procesado = false` anota el error pero DEJA `processed_at` en NULL, y esa
 * distinción es todo el mecanismo de recuperación de este endpoint: cuando
 * `acreditarPago` se cae por red o por base se contesta 503 para que Mercado
 * Pago vuelva, y MP reintenta con el MISMO `x-request-id`. Con `processed_at`
 * estampado, ese reintento choca contra el índice único, entra por
 * `evento.yaProcesado` y se contesta 200 "ya procesado" SIN HACER NADA: la
 * seña se queda `iniciada` con la plata cobrada y MP no vuelve nunca más.
 */
async function cerrarEvento(id: string | null, error: string | null, procesado = true): Promise<void> {
  if (!id) return
  try {
    const supabase = createAdminClient()
    const { error: e } = await supabase
      .from('payment_webhook_events')
      .update({
        ...(procesado ? { processed_at: new Date().toISOString() } : {}),
        error: error?.slice(0, 500) ?? null,
      })
      .eq('id', id)
    if (e) console.error('[mp-webhook-senas] no pudimos cerrar el evento:', e.message)
  } catch (e) {
    console.error('[mp-webhook-senas] no pudimos cerrar el evento:', e)
  }
}

/**
 * ¿De qué sucursal es esta notificación?
 *
 * El `?b=` sale de la `notification_url` que horneamos en cada preferencia (y
 * que PISA a la configurada en el panel de MP, por eso es el camino normal).
 * El `user_id` del body es el respaldo para una notificación que MP haya
 * disparado por su cuenta.
 */
async function resolverSucursal(
  branchQuery: string | null,
  collectorId: string | null,
): Promise<ProveedorResuelto | null> {
  if (branchQuery && isValidUUID(branchQuery)) {
    const p = await resolverProveedor(branchQuery)
    if (p) return p
  }
  if (collectorId) return await resolverProveedorPorCollector(collectorId)
  return null
}

/**
 * El handler de verdad. `POST` lo envuelve para que ninguna excepción se
 * escape: una excepción sin atajar sale como el 500 de Next (una página HTML,
 * encima) y ese status es el que le pide a MP que reintente. Reintentar está
 * bien, pero tiene que salir de una decisión nuestra y con un cuerpo que la app
 * y los logs puedan leer.
 */
async function procesar(req: NextRequest): Promise<NextResponse> {
  // 1. El body crudo primero, siempre. Acotado: ver `leerCuerpoAcotado`.
  const crudo = await leerCuerpoAcotado(req)
  if (crudo === null) {
    // Se corta ANTES de tocar la base. No se registra el intento a propósito:
    // registrar un body descomunal es exactamente lo que se está evitando.
    return NextResponse.json({ ok: false, detalle: 'body demasiado grande' }, { status: 400 })
  }

  let cuerpo: CuerpoNotificacion = {}
  try {
    cuerpo = crudo ? (JSON.parse(crudo) as CuerpoNotificacion) : {}
  } catch {
    // Un body que no es JSON no es de Mercado Pago. Se registra abajo con lo
    // que haya en el query y se contesta 200: no hay nada que reintentar.
  }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) cuerpo = {}

  const url = new URL(req.url)
  const q = url.searchParams
  // MP manda `?type=payment&data.id=…` en el webhook moderno y `?topic=payment&id=…`
  // en el IPN viejo. Se aceptan los dos: la misma cuenta puede tener las dos
  // configuradas y perder una notificación de pago no es una opción.
  const eventType = (q.get('type') ?? q.get('topic') ?? cuerpo.type ?? cuerpo.topic ?? '').trim()
  // El id que entra al MANIFEST de la firma sale SÓLO del query, que es de
  // donde lo toma Mercado Pago para calcularla. Si se tomara del body cuando el
  // query no lo trae, el manifest quedaría con un segmento `id:` que del otro
  // lado no existe y toda firma legítima daría inválida.
  const dataIdQuery = (q.get('data.id') ?? q.get('id') ?? '').trim()
  // Para CONSULTAR el pago, en cambio, sirve cualquiera de los dos.
  const dataId = dataIdQuery || String(cuerpo.data?.id ?? cuerpo.id ?? '').trim()
  const requestId = req.headers.get('x-request-id')
  const signature = req.headers.get('x-signature')
  const branchQuery = q.get('b')
  const collectorId = cuerpo.user_id !== undefined && cuerpo.user_id !== null ? String(cuerpo.user_id) : null

  // 2. El cupo. Se MIDE acá y se APLICA al final, y nunca sobre algo firmado:
  //    ver el encabezado. `rateLimit` ya falla abierto ante un error de base,
  //    que es lo correcto para un tope que sólo protege de ruido.
  let hayCupo = true
  try {
    const ip = await getClientIP()
    const gate = await rateLimit('mp_webhook_senas', ip, CUPO_WEBHOOK)
    hayCupo = gate.allowed
  } catch (e) {
    console.error('[mp-webhook-senas] no pudimos medir el cupo:', e)
  }

  // 3. La sucursal. Sin ella no hay secreto con el que verificar la firma.
  let proveedor: ProveedorResuelto | null = null
  try {
    proveedor = await resolverSucursal(branchQuery, collectorId)
  } catch (e) {
    // Error de base: esto SÍ es reintentable.
    console.error('[mp-webhook-senas] no pudimos resolver la sucursal:', e)
    return NextResponse.json({ ok: false, detalle: 'no disponible' }, { status: 503 })
  }

  if (!proveedor) {
    // Cuenta desconocida. Puede ser una notificación vieja de una sucursal que
    // se desconectó (la fila queda con su `mp_user_id` justamente para poder
    // atribuirla) o ruido. Se registra y se contesta 200: reintentarlo no lo
    // va a volver conocido, y un 401 pondría a MP a insistir cada 15 minutos.
    //
    // Sin sucursal no hay secreto, así que acá NINGUNA firma puede ser válida:
    // es puro ruido y el cupo lo puede frenar sin riesgo de perder un pago. Lo
    // único que se pierde al pasarse del tope es la fila de auditoría.
    if (hayCupo) {
      await registrarEvento({
        branchId: null,
        eventType: corto(eventType || null),
        action: corto(cuerpo.action),
        resourceId: corto(dataId) || '(sin id)',
        requestId,
        mpUserId: collectorId,
        signatureOk: false,
        payload: payloadResumido(cuerpo),
        error: 'No hay ninguna sucursal con esa cuenta de Mercado Pago conectada.',
      })
    }
    return ok('cuenta desconocida')
  }

  // 4. La firma, con el secreto de ESA cuenta. Falla cerrada: sin secreto
  //    configurado, `verificarFirmaWebhook` devuelve ok:false.
  let secreto: string | null = null
  try {
    secreto = await secretoWebhook(proveedor.id)
  } catch (e) {
    console.error('[mp-webhook-senas] no pudimos leer el secreto:', e)
    return NextResponse.json({ ok: false, detalle: 'no disponible' }, { status: 503 })
  }

  const firma = verificarFirmaWebhook({ signature, requestId, dataId: dataIdQuery, secret: secreto })

  // Acá se aplica el cupo, y sólo acá: una notificación FIRMADA nunca se
  // rechaza por tope. Lo que se corta es la ráfaga de intentos sin firma, que
  // es la que podría llenar `payment_webhook_events` de filas anónimas.
  if (!firma.ok && !hayCupo) {
    return NextResponse.json({ ok: false, detalle: 'demasiadas notificaciones' }, { status: 429 })
  }

  // 5. Registrar. Válida o no: el evento rechazado es justamente el que hay que
  //    poder mirar cuando alguien dice "pagué y no me llegó el turno". Del body
  //    sólo van los campos que importan (`payloadResumido`).
  const evento = await registrarEvento({
    branchId: proveedor.branchId,
    eventType: corto(eventType || null),
    action: corto(cuerpo.action),
    resourceId: corto(dataId) || '(sin id)',
    requestId,
    mpUserId: collectorId ?? proveedor.mpUserId,
    signatureOk: firma.ok,
    payload: payloadResumido(cuerpo),
    error: firma.ok ? null : (firma.motivo ?? 'firma inválida'),
  })

  if (!firma.ok) {
    // 401 y no 200: si el secreto quedó mal configurado, los reintentos de MP
    // son la ventana para arreglarlo sin perder el pago. El motivo NO viaja en
    // la respuesta (le diría a quien esté probando firmas exactamente qué
    // ajustar); queda en `payment_webhook_events.error`.
    return NextResponse.json({ ok: false, detalle: 'firma inválida' }, { status: 401 })
  }

  if (evento.yaProcesado) {
    return ok('ya procesado')
  }

  // 6. Sólo los pagos. Un `merchant_order` queda registrado y no se procesa: la
  //    orden no dice si el pago se acreditó, y el pago llega por su propia
  //    notificación.
  if (eventType !== 'payment') {
    await cerrarEvento(evento.id, null)
    return ok('evento ignorado', { tipo: corto(eventType) })
  }

  if (!dataId) {
    await cerrarEvento(evento.id, 'La notificación no trae el id del pago.')
    return ok('sin id de pago')
  }

  // 7. Acreditar. La fuente de verdad es `GET /v1/payments/{id}`, nunca el body
  //    de la notificación.
  let resultado: ResultadoAcreditacion
  try {
    resultado = await acreditarPago(dataId, proveedor)
  } catch (e) {
    // Red contra Mercado Pago o error de base: es transitorio y se contesta
    // 5xx a propósito, para que MP reintente en 15 minutos. La seña queda
    // `iniciada` y el cron de conciliación es la segunda red.
    const detalle = e instanceof Error ? e.message : String(e)
    console.error('[mp-webhook-senas] acreditarPago falló:', detalle)
    // `false` = anotá el error pero NO lo des por procesado: el reintento de MP
    // llega con el mismo `x-request-id` y tiene que volver a entrar acá.
    await cerrarEvento(evento.id, detalle, false)
    return NextResponse.json({ ok: false, detalle: 'reintentar' }, { status: 503 })
  }

  const motivo = 'motivo' in resultado ? resultado.motivo : null
  await cerrarEvento(evento.id, resultado.resultado === 'rechazado' ? motivo : null)

  // Todos los resultados —incluido `ignorado` y `sin_cupo`— son 200: el trabajo
  // se hizo, aunque el desenlace no sea el feliz. Volver a intentarlo daría
  // exactamente lo mismo.
  return ok(resultado.resultado)
}

/**
 * La red final. Todo lo que `procesar` no atajó —un body que se corta a mitad,
 * un fallo del runtime— sale como 503 y no como el 500 de Next: los dos hacen
 * que Mercado Pago reintente, pero el 500 se lo lleva una página HTML que no
 * dice nada en los logs y que además queda registrada como error de la app.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await procesar(req)
  } catch (e) {
    console.error('[mp-webhook-senas] excepción no controlada:', e)
    return NextResponse.json({ ok: false, detalle: 'reintentar' }, { status: 503 })
  }
}

/**
 * Mercado Pago manda un GET de prueba desde el panel al guardar la URL. No hace
 * nada, pero tiene que contestar 200 o la configuración no se puede guardar.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, detalle: 'webhook de señas activo' }, { status: 200 })
}
