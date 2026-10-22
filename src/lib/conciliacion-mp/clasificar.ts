// =============================================================================
// src/lib/conciliacion-mp/clasificar.ts
// Un pago crudo de `/v1/payments/search` → la fila de `mp_movimientos`.
//
// LA TIPIFICACIÓN DE LAS TRANSFERENCIAS AL CVU NO ESTÁ DOCUMENTADA
// ----------------------------------------------------------------
// Mercado Pago no dice en ninguna parte "una transferencia recibida al alias
// llega con tal operation_type" (relevamiento del 21/10/2026). Por eso la
// clasificación es defensiva, vive en código y se guardan SIEMPRE los campos
// crudos al lado: si la primera conexión real muestra otra combinación, se
// corrige acá y se reclasifica sin volver a pedirle nada a MP.
//
// El tipo decide poco en el motor: excluye lo que nunca puede ser un cobro
// (rendimientos, devoluciones), deja tarjeta y Point fuera del cruce
// automático con las transferencias (quedan como "podría ser": en 30 días hubo
// 79 cobros con tarjeta de $18.000, cualquiera tapaba una transferencia que no
// llegó) y explica un crédito que quedó sin pareja ("parece un cobro" o "no es
// una transferencia"). Un error de clasificación cambia una etiqueta o deja un
// crédito para vincular a mano; no inventa un "cuadra".
//
// MINIMIZACIÓN (Ley 25.326): del pagador se guarda el nombre (para conciliar) y
// los ÚLTIMOS 4 dígitos del documento. `datos` es un recorte técnico SIN
// nombres, emails ni documentos. Nunca se guarda el payload entero.
//
// PURO: sin `server-only` ni alias, para poder probarlo con `node`.
// =============================================================================

import type { TipoMovimiento } from './contrato'

/** Lo que usamos de un pago de `/v1/payments/search`. Todo opcional: MP no es consistente. */
export interface PagoCrudoMp {
  id?: number | string | null
  status?: string | null
  status_detail?: string | null
  operation_type?: string | null
  payment_type_id?: string | null
  payment_method_id?: string | null
  transaction_amount?: number | null
  transaction_amount_refunded?: number | null
  transaction_details?: { net_received_amount?: number | null } | null
  currency_id?: string | null
  date_created?: string | null
  date_approved?: string | null
  date_last_updated?: string | null
  collector_id?: number | string | null
  description?: string | null
  external_reference?: string | null
  payer?: {
    id?: number | string | null
    first_name?: string | null
    last_name?: string | null
    identification?: { type?: string | null; number?: string | null } | null
  } | null
  point_of_interaction?: {
    type?: string | null
    sub_type?: string | null
    transaction_data?: {
      bank_info?: {
        payer?: {
          account_holder_name?: string | null
          /** OJO: es el nombre del BANCO del pagador, no de la persona. No se usa. */
          long_name?: string | null
        } | null
      } | null
    } | null
  } | null
  order?: { type?: string | null } | null
}

/** La fila para `mp_movimientos` (sin organization_id ni mp_cuenta_id: los pone quien sincroniza). */
export interface FilaMovimiento {
  mp_id: string
  tipo: TipoMovimiento
  operation_type: string | null
  payment_type_id: string | null
  payment_method_id: string | null
  status: string
  status_detail: string | null
  monto: number
  monto_neto: number | null
  moneda: string | null
  fecha: string
  fecha_creacion: string | null
  fecha_actualizacion: string | null
  pagador_nombre: string | null
  pagador_doc_ult4: string | null
  descripcion: string | null
  referencia_externa: string | null
  datos: Record<string, string | number | boolean | null>
}

const TARJETAS = new Set(['credit_card', 'debit_card', 'prepaid_card'])

function bajo(s: unknown): string {
  return typeof s === 'string' ? s.trim().toLowerCase() : ''
}

function alto(s: unknown): string {
  return typeof s === 'string' ? s.trim().toUpperCase() : ''
}

function texto(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** Qué tipo de crédito es. El orden de las reglas importa: lo más específico primero. */
export function clasificarPago(p: PagoCrudoMp): TipoMovimiento {
  const op = bajo(p.operation_type)
  const tipoPago = bajo(p.payment_type_id)
  const medio = bajo(p.payment_method_id)
  const poi = `${alto(p.point_of_interaction?.type)} ${alto(p.point_of_interaction?.sub_type)}`

  // Lo que nunca es un cobro va primero: un rendimiento pagado "con dinero en
  // cuenta" no tiene que caer en la regla de account_money de más abajo.
  if (op === 'investment') return 'rendimiento'
  if (op.includes('refund') || op.includes('cashback')) return 'devolucion'

  // Posnet y QR antes que "transferencia": un pago con QR pagado con saldo de MP
  // trae payment_type_id = account_money y no es una transferencia al alias.
  if (poi.includes('POINT')) return 'point'
  if (op === 'pos_payment') return TARJETAS.has(tipoPago) ? 'point' : 'qr'
  if (poi.includes('QR') || poi.includes('INSTORE')) return 'qr'

  // Las señales de transferencia que aparecen en la referencia y en el código
  // de terceros: medio CVU/DEBIN, envío de dinero o fondeo, o tipo bank_transfer.
  if (medio === 'cvu' || medio === 'debin_transfer') return 'transferencia'
  if (op === 'money_transfer' || op === 'account_fund') return 'transferencia'
  if (tipoPago === 'bank_transfer') return 'transferencia'

  if (TARJETAS.has(tipoPago)) return 'tarjeta'

  if (
    op === 'regular_payment' &&
    (poi.includes('CHECKOUT') || bajo(p.order?.type) === 'mercadopago' || !!texto(p.external_reference, 200))
  ) {
    return 'link'
  }

  // De cuenta de MP a cuenta de MP llega como account_money (comunidad; no
  // documentado). Va después del link para que un checkout pagado con saldo
  // no se confunda con una transferencia.
  if (tipoPago === 'account_money') return 'transferencia'

  return 'otro'
}

/**
 * ¿Es plata que ENTRÓ y se quedó? Sólo `approved`. Un pago devuelto o
 * contracargado no cuenta: si antes cuadraba, ahora su cobro queda "no está en
 * Mercado Pago", y es correcto — la plata se fue.
 */
export function cuentaComoPlataRecibida(status: string | null | undefined): boolean {
  return bajo(status) === 'approved'
}

/** ¿Es un crédito de esta cuenta? Los débitos (pagos que hizo el titular) ni se guardan. */
export function esCreditoDe(p: PagoCrudoMp, mpUserId: string): boolean {
  return p.collector_id !== undefined && p.collector_id !== null && String(p.collector_id) === String(mpUserId)
}

/**
 * Nombre de quien pagó. En las transferencias CVU y en los fondeos, Mercado
 * Pago a veces informa como "payer" a la propia cuenta: si el payer es el
 * collector, ese nombre es el del TITULAR y no sirve (se descarta).
 */
export function pagadorDe(p: PagoCrudoMp): { nombre: string | null; docUlt4: string | null } {
  const payerEsTitular =
    p.payer?.id !== undefined &&
    p.payer?.id !== null &&
    p.collector_id !== undefined &&
    p.collector_id !== null &&
    String(p.payer.id) === String(p.collector_id)

  let nombre: string | null = null
  if (!payerEsTitular) {
    const partes = [texto(p.payer?.first_name, 80), texto(p.payer?.last_name, 80)].filter(Boolean)
    nombre = partes.length ? partes.join(' ') : null
  }
  if (!nombre) {
    nombre = texto(p.point_of_interaction?.transaction_data?.bank_info?.payer?.account_holder_name, 120)
  }

  let docUlt4: string | null = null
  if (!payerEsTitular) {
    const digitos = (p.payer?.identification?.number ?? '').replace(/\D/g, '')
    docUlt4 = digitos.length >= 4 ? digitos.slice(-4) : null
  }
  return { nombre, docUlt4 }
}

function numero(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function fechaValida(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null
  return Number.isFinite(new Date(s).getTime()) ? s : null
}

/**
 * Lo que quedó del pago después de las devoluciones: `transaction_amount −
 * transaction_amount_refunded`, nunca menos de 0. Una devolución PARCIAL deja
 * el pago `approved` (status_detail `partially_refunded`) con el
 * transaction_amount original intacto: usar el bruto daría por recibida plata
 * que se devolvió. Centavos redondeados (la resta de dos números con coma
 * puede dar 50.050000000000004).
 */
export function montoNeto(p: Pick<PagoCrudoMp, 'transaction_amount' | 'transaction_amount_refunded'>): number | null {
  const bruto = numero(p.transaction_amount)
  if (bruto === null) return null
  const devuelto = numero(p.transaction_amount_refunded) ?? 0
  return Math.max(0, Math.round((bruto - Math.max(0, devuelto)) * 100) / 100)
}

/**
 * La fila de `mp_movimientos`, o null si al pago le falta lo mínimo para
 * conciliarlo (id, monto o fecha). Quien sincroniza cuenta esos descartes.
 *
 * `monto` es el NETO de devoluciones (`montoNeto`): es lo que el motor cuenta
 * como plata recibida. Un neto de 0 no es elegible para cuadrar un cobro. El
 * bruto queda en `datos.monto_bruto`. Cuando MP registra una devolución
 * actualiza `date_last_updated`, así que la próxima lectura vuelve a traer el
 * pago y el upsert reescribe el monto.
 */
export function filaDeMovimiento(p: PagoCrudoMp): FilaMovimiento | null {
  const id = p.id === undefined || p.id === null ? '' : String(p.id).trim()
  const bruto = numero(p.transaction_amount)
  const monto = montoNeto(p)
  const fecha = fechaValida(p.date_approved) ?? fechaValida(p.date_created)
  if (!id || bruto === null || monto === null || !fecha) return null

  const { nombre, docUlt4 } = pagadorDe(p)
  const payerEsTitular =
    p.payer?.id !== undefined && p.payer?.id !== null && String(p.payer.id) === String(p.collector_id ?? '')

  return {
    mp_id: id,
    tipo: clasificarPago(p),
    operation_type: texto(p.operation_type, 60),
    payment_type_id: texto(p.payment_type_id, 60),
    payment_method_id: texto(p.payment_method_id, 60),
    status: texto(p.status, 40) ?? 'desconocido',
    status_detail: texto(p.status_detail, 80),
    monto,
    monto_neto: numero(p.transaction_details?.net_received_amount),
    moneda: texto(p.currency_id, 10),
    fecha,
    fecha_creacion: fechaValida(p.date_created),
    fecha_actualizacion: fechaValida(p.date_last_updated),
    pagador_nombre: nombre,
    pagador_doc_ult4: docUlt4,
    descripcion: texto(p.description, 200),
    referencia_externa: texto(p.external_reference, 200),
    // Recorte técnico para auditar la clasificación. NADA personal acá.
    datos: {
      operation_type: texto(p.operation_type, 60),
      payment_type_id: texto(p.payment_type_id, 60),
      payment_method_id: texto(p.payment_method_id, 60),
      status_detail: texto(p.status_detail, 80),
      poi_type: texto(p.point_of_interaction?.type, 60),
      poi_sub_type: texto(p.point_of_interaction?.sub_type, 60),
      external_reference: texto(p.external_reference, 200),
      monto_bruto: bruto,
      monto_devuelto: numero(p.transaction_amount_refunded),
      payer_es_titular: payerEsTitular,
    },
  }
}
