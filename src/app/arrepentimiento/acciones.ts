'use server'

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit, getClientIP } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'

// ─────────────────────────────────────────────────────────────────────
// Dónde se guarda esto, y por qué acá
// ─────────────────────────────────────────────────────────────────────
//
// El pedido de arrepentimiento se registra como una fila de `crm_alerts`.
// No se creó una tabla nueva (no corresponde a este frente) y las candidatas
// obvias no servían:
//
//  · `crm_cases` exige `review_id` NOT NULL con FK a `client_reviews`, más
//    `client_id` y `branch_id` NOT NULL. Un pedido de arrepentimiento lo puede
//    hacer alguien que no tiene reseña, que todavía no es cliente registrado y
//    que no sabe en qué sucursal reservó. Sería inventarle tres datos falsos a
//    un registro legal.
//  · `payment_webhook_events` es auditoría de webhooks: nadie la mira.
//
// `crm_alerts` encaja por lo que ya HACE, no sólo por su forma: es la bandeja
// que el dueño mira en /dashboard/mensajeria → Alertas, tiene Realtime (la
// alerta aparece sola, sin recargar), tiene "sin leer" con contador y "marcar
// leída", y `alert_type` no tiene CHECK — el panel hace
// `ALERT_CONFIG[tipo] || ALERT_CONFIG.info`, así que un tipo desconocido no lo
// rompe. Se usa `urgent` a propósito: el plazo de respuesta es de 24 horas y
// es rojo en la lista.
//
// Lo único que no da es un estado propio de "resuelto": "leída" es lo más
// cerca que hay. Queda anotado como deuda, no como equivalencia.

export interface EntradaArrepentimiento {
  nombre: string
  telefono: string
  /** Número de operación de Mercado Pago, si lo tiene a mano. Opcional. */
  operacion?: string
  detalle?: string
  /** Slug de la sucursal, si el link vino del turnero (`?suc=`). */
  sucursal?: string
}

export type ResultadoArrepentimiento =
  | { ok: true; codigo: string; respuestaAntesDe: string }
  | { ok: false; error: string }

const TZ = 'America/Argentina/Buenos_Aires'

/**
 * Alfabeto sin I, O, L, 0 ni 1: el código se lo van a dictar por teléfono o lo
 * van a tipear desde una captura de pantalla. Es el mismo criterio que el
 * código de referido del programa de fidelización.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generarCodigo(): string {
  const bytes = randomBytes(6)
  let salida = ''
  for (const b of bytes) salida += ALFABETO[b % ALFABETO.length]
  return `ARR-${salida}`
}

/**
 * De qué negocio es este pedido.
 *
 * El botón es una página global —tiene que abrirse sin cuenta, sin sesión y sin
 * contexto— así que la organización se resuelve por descarte, de lo más
 * específico a lo más general:
 *
 *  1. La sucursal del link (`?suc=<slug>`), que el pie del turnero ya conoce.
 *     Es el 99% de los casos reales: el cliente llega desde la pantalla donde
 *     reservó.
 *  2. La cookie de organización pública, que deja el selector de barbería.
 *  3. La organización por defecto del despliegue (`NEXT_PUBLIC_ORG_SLUG`, hoy
 *     "monaco").
 *
 * El último escalón existe porque un pedido de arrepentimiento NO se puede
 * rechazar por un problema nuestro de ruteo: es un derecho con plazo, y decirle
 * "no pudimos registrar tu pedido" a alguien que está ejerciéndolo es
 * exactamente lo que la Disposición 954/2025 quiere evitar. Con una sola marca
 * en producción, adivinar bien es trivial; el día que haya varias, el paso 1 es
 * el que manda y ya está en su lugar.
 */
async function resolverOrganizacion(
  slugSucursal?: string
): Promise<{ id: string; nombre: string } | null> {
  const supabase = createAdminClient()

  if (slugSucursal) {
    const { data } = await supabase
      .from('branches')
      .select('organization_id, organization:organization_id(id, name)')
      .eq('slug', slugSucursal.toLowerCase())
      .eq('is_active', true)
      .maybeSingle()

    const org = data?.organization as { id: string; name: string } | null | undefined
    if (org?.id) return { id: org.id, nombre: org.name }
  }

  const galletas = await cookies()
  const desdeCookie =
    galletas.get('public_organization')?.value ?? galletas.get('active_organization')?.value ?? null

  if (desdeCookie && isValidUUID(desdeCookie)) {
    const { data } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', desdeCookie)
      .eq('is_active', true)
      .maybeSingle()
    if (data) return { id: data.id, nombre: data.name }
  }

  const slugPorDefecto = (process.env.NEXT_PUBLIC_ORG_SLUG || 'monaco').toLowerCase()
  const { data } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slugPorDefecto)
    .eq('is_active', true)
    .maybeSingle()

  return data ? { id: data.id, nombre: data.name } : null
}

/**
 * La seña a la que probablemente se refiere el pedido.
 *
 * Es "probablemente" a propósito: la búsqueda es para que quien atienda el
 * reclamo tenga el dato servido, no para decidir nada. Nunca se le devuelve al
 * que completó el formulario —el endpoint es público y anónimo, y confirmarle a
 * cualquiera que un teléfono tiene una seña de $8.000 es filtrar plata ajena—:
 * viaja sólo dentro de la alerta que ve el dueño.
 */
async function buscarSena(
  orgId: string,
  telefono: string,
  operacion?: string
): Promise<Record<string, unknown> | null> {
  const supabase = createAdminClient()

  // El número de operación es el vínculo fuerte: si lo trajo, gana.
  if (operacion) {
    const { data } = await supabase
      .from('booking_deposits')
      .select('id, amount, status, appointment_date, start_time, branch_id, mp_payment_id, paid_at')
      .eq('organization_id', orgId)
      .eq('mp_payment_id', operacion)
      .maybeSingle()
    if (data) return { ...data, encontrada_por: 'operacion' }
  }

  const { data: clientId } = await supabase.rpc('find_client_id_by_phone', {
    p_org: orgId,
    p_phone: telefono,
  })
  if (!clientId) return null

  const { data } = await supabase
    .from('booking_deposits')
    .select('id, amount, status, appointment_date, start_time, branch_id, mp_payment_id, paid_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId as string)
    .in('status', ['pagada', 'consumida', 'perdida', 'sin_cupo'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ? { ...data, encontrada_por: 'telefono' } : null
}

/**
 * Registra un pedido de arrepentimiento y devuelve el código de seguimiento.
 *
 * Sin cuenta, sin sesión y sin registro previo, que es justamente lo que exige
 * la Disposición 954/2025. Lo único que se pide es el teléfono, porque es el
 * medio por el que se responde: no es un registro, es una dirección de
 * respuesta.
 */
export async function registrarArrepentimiento(
  entrada: EntradaArrepentimiento
): Promise<ResultadoArrepentimiento> {
  const nombre = entrada.nombre.trim()
  const telefono = entrada.telefono.trim().replace(/\s+/g, '')
  const operacion = (entrada.operacion ?? '').trim().replace(/\D/g, '').slice(0, 32)
  const detalle = (entrada.detalle ?? '').trim().slice(0, 2000)
  const sucursal = (entrada.sucursal ?? '').trim().slice(0, 100)

  if (nombre.length < 2) {
    return { ok: false, error: 'Escribí tu nombre para que sepamos con quién hablamos.' }
  }
  if (telefono.replace(/\D/g, '').length < 8) {
    return { ok: false, error: 'Necesitamos un teléfono válido: es por donde te respondemos.' }
  }

  // Generoso a propósito. Este formulario NO se puede volver difícil de usar:
  // el límite es contra un bot, no contra alguien que se equivocó de tecla y
  // reenvía. Cinco pedidos por hora desde la misma conexión es mucho más de lo
  // que una persona necesita.
  const ip = await getClientIP()
  const gate = await rateLimit('arrepentimiento', ip, { limit: 5, window: 3600 })
  if (!gate.allowed) {
    return {
      ok: false,
      error:
        'Recibimos varios pedidos desde esta conexión. Esperá un momento, o escribinos por WhatsApp a la sucursal: tu pedido vale igual desde el momento en que nos lo comunicás.',
    }
  }

  const org = await resolverOrganizacion(sucursal || undefined)
  if (!org) {
    console.error('[arrepentimiento] no pudimos resolver la organización', { sucursal })
    return {
      ok: false,
      error:
        'No pudimos registrar el pedido por un problema nuestro. Escribinos por WhatsApp a tu sucursal o a ignacio.baldovino@hotmail.com y lo resolvemos igual: tu derecho corre desde que nos lo comunicás, no desde que el formulario funcione.',
    }
  }

  // Que no se pueda enganchar la seña no invalida nada: el pedido se registra
  // igual y alguien lo busca a mano. Por eso va con catch y no aborta.
  const sena = await buscarSena(org.id, telefono, operacion || undefined).catch(e => {
    console.error('[arrepentimiento] buscarSena:', e)
    return null
  })

  const codigo = generarCodigo()
  const ahora = new Date()
  const vence = new Date(ahora.getTime() + 24 * 60 * 60 * 1000)

  const limite = vence.toLocaleString('es-AR', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  // El orden importa: la tarjeta de la bandeja recorta el mensaje con
  // `line-clamp-2`, así que lo accionable —a quién, por dónde y hasta cuándo—
  // va primero y el contexto después. Separadores con " · " y no saltos de
  // línea, que en un `<p>` colapsan igual.
  const partes = [
    `Devolvé la seña completa a ${nombre} y respondele por WhatsApp al ${telefono} antes del ${limite}.`,
    sena
      ? `Seña: $${sena.amount} (${sena.status}) del turno ${sena.appointment_date} ${String(sena.start_time).slice(0, 5)}.`
      : 'No encontramos la seña automáticamente: hay que buscarla a mano.',
    operacion ? `Operación de Mercado Pago: ${operacion}.` : null,
    detalle ? `Dice: "${detalle}"` : null,
  ].filter(Boolean)

  const supabase = createAdminClient()
  const { error } = await supabase.from('crm_alerts').insert({
    organization_id: org.id,
    // Rojo en la bandeja. El plazo legal de respuesta es de 24 horas y la
    // devolución es total: no es una consulta más.
    alert_type: 'urgent',
    title: `Botón de arrepentimiento · ${codigo}`,
    message: partes.join(' · '),
    metadata: {
      origen: 'boton_arrepentimiento',
      codigo,
      nombre,
      telefono,
      operacion: operacion || null,
      detalle: detalle || null,
      sucursal_slug: sucursal || null,
      deposit_id: sena?.id ?? null,
      responder_antes_de: vence.toISOString(),
      // Base legal, para que quien lo lea sepa que no es discrecional.
      base_legal: 'Arts. 1110-1116 CCyC y art. 34 Ley 24.240. Disp. 954/2025.',
    },
  })

  // Acá NO se puede loguear y seguir. Si la fila no se escribió, el código que
  // le mostraríamos al cliente no existe en ningún lado y el pedido se pierde
  // en silencio — que es exactamente el bug de años del Known Risk #13, pero
  // sobre un plazo legal de 24 horas.
  if (error) {
    console.error('[arrepentimiento] crm_alerts.insert:', error.message)
    return {
      ok: false,
      error:
        'No pudimos registrar el pedido. Escribinos por WhatsApp a tu sucursal o a ignacio.baldovino@hotmail.com: tu derecho corre desde que nos lo comunicás, no desde que el formulario funcione.',
    }
  }

  return {
    ok: true,
    codigo,
    respuestaAntesDe: vence.toLocaleString('es-AR', {
      timeZone: TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}
