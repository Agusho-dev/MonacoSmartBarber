// =============================================================================
// Motor de la venta de productos (servidor).
//
// Server-only y SIN 'use server' a propósito: en un archivo 'use server' todo
// export es un endpoint HTTP, y estas funciones reciben un cliente con service
// role. Las capas finas que validan la sesión antes de llamarlas son
// `directProductSale` / `listarProductosParaCobro` (actions/sales.ts) y
// `completeService` (actions/queue.ts). Antes `processProductSales` vivía
// exportada en sales.ts: era un endpoint más.
//
// El trabajo pesado lo hacen dos RPC de la mig 220 (`registrar_productos_de_visita`
// y `registrar_venta_directa_productos`): detalle, stock y comisión en UNA
// transacción, y la venta directa además idempotente por clave. Mientras la 220
// no esté aplicada (PGRST202 / 42883) corre el camino TypeScript de abajo, que
// hace lo mismo en pasos separados pero con cada error mirado. Así el deploy no
// depende del orden en que se aplique la migración.
// =============================================================================

import 'server-only'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { isValidUUID } from '@/lib/validation'
import { formatCurrency } from '@/lib/format'
import {
  TOPE_PRODUCTOS_POR_VENTA,
  TOPE_UNIDADES_POR_PRODUCTO,
  type LineaDeProducto,
} from './reglas'

export type MetodoDePago = 'cash' | 'card' | 'transfer'

export const MENSAJE_PRODUCTO_NO_DISPONIBLE =
  'Uno de los productos ya no está disponible en esta sucursal. Actualizá la lista y volvé a elegir.'

const MENSAJE_CANTIDADES = `Revisá las cantidades: van de 1 a ${TOPE_UNIDADES_POR_PRODUCTO} unidades por producto.`
const MENSAJE_LISTA_ROTA = 'La lista de productos llegó mal. Cerrá esta ventana y volvé a abrirla.'
const MENSAJE_NO_SE_REGISTRO = 'No pudimos registrar la venta. Probá de nuevo.'

/** Traducción de los motivos que devuelven las RPC de la mig 220. */
const MENSAJES_RPC: Record<string, string> = {
  sin_productos: 'Elegí al menos un producto.',
  linea_invalida: MENSAJE_LISTA_ROTA,
  demasiados_productos: `Son demasiados productos distintos para una sola venta (máximo ${TOPE_PRODUCTOS_POR_VENTA}).`,
  cantidad_invalida: MENSAJE_CANTIDADES,
  producto_no_disponible: MENSAJE_PRODUCTO_NO_DISPONIBLE,
  precio_invalido: 'Uno de los productos tiene el precio mal cargado. Revisalo en Servicios y Productos.',
  metodo_invalido: 'Elegí cómo pagó el cliente.',
  sucursal_invalida: 'No encontramos la sucursal de la venta.',
  barbero_invalido: 'El barbero elegido no está activo en esta sucursal.',
  cuenta_invalida: 'La cuenta de cobro elegida ya no está disponible. Elegí otra.',
  total_cero: 'El total de la venta da $0. Revisá los precios en Servicios y Productos.',
  clave_reutilizada: 'No pudimos registrar la venta. Cerrala y volvé a abrirla.',
  visita_no_encontrada: 'No encontramos el cobro al que pertenecen los productos.',
}

function mensajeRpc(codigo: string | undefined): string {
  return (codigo && MENSAJES_RPC[codigo]) || MENSAJE_NO_SE_REGISTRO
}

// ─── Validación ─────────────────────────────────────────────────────────────

/** Una línea ya contrastada contra la base: precio y comisión salen de products, no del browser. */
export interface LineaValidada {
  productId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  comisionUnitaria: number
  stock: number | null
}

export type ValidacionDeLineas =
  | { ok: true; lineas: LineaValidada[] }
  | { ok: false; error: string; productosDesactualizados: boolean }

/**
 * Forma de lo que mandó el browser, sin tocar la base: ids válidos, cantidades
 * enteras dentro del tope, repetidas sumadas (el tope se mide sobre la suma,
 * igual que en la RPC). Un browser viejo o manipulado no llega más lejos.
 */
function normalizarLineas(items: unknown): { ok: true; lineas: LineaDeProducto[] } | { ok: false; error: string } {
  if (!Array.isArray(items)) return { ok: false, error: MENSAJE_LISTA_ROTA }

  const porId = new Map<string, number>()
  for (const item of items) {
    if (!item || typeof item !== 'object') return { ok: false, error: MENSAJE_LISTA_ROTA }
    const { id, quantity } = item as { id?: unknown; quantity?: unknown }
    if (typeof id !== 'string' || !isValidUUID(id)) return { ok: false, error: MENSAJE_LISTA_ROTA }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, error: MENSAJE_CANTIDADES }
    }
    const clave = id.toLowerCase()
    porId.set(clave, (porId.get(clave) ?? 0) + quantity)
  }

  if (porId.size > TOPE_PRODUCTOS_POR_VENTA) return { ok: false, error: MENSAJES_RPC.demasiados_productos }
  for (const cantidad of porId.values()) {
    if (cantidad > TOPE_UNIDADES_POR_PRODUCTO) return { ok: false, error: MENSAJE_CANTIDADES }
  }
  return { ok: true, lineas: [...porId].map(([id, quantity]) => ({ id, quantity })) }
}

/**
 * Valida las líneas contra la base ANTES de escribir nada: que cada producto
 * exista en ESTA sucursal (un id de otra sucursal u otra organización cuenta
 * como inexistente) y, con `soloActivos`, que esté activo. Un id desconocido es
 * un error con mensaje, nunca "total $0" en silencio, que era lo que hacía
 * processProductSales.
 */
export async function validarLineasDeProductos(
  supabase: SupabaseClient,
  branchId: string,
  items: unknown,
  opciones: { soloActivos: boolean },
): Promise<ValidacionDeLineas> {
  const forma = normalizarLineas(items)
  if (!forma.ok) return { ok: false, error: forma.error, productosDesactualizados: false }
  if (forma.lineas.length === 0) return { ok: true, lineas: [] }

  const { data, error } = await supabase
    .from('products')
    .select('id, name, sale_price, barber_commission, stock, is_active')
    .in('id', forma.lineas.map((l) => l.id))
    .eq('branch_id', branchId)

  if (error) {
    console.error('[validarLineasDeProductos]', error.message)
    return { ok: false, error: 'No pudimos verificar los productos. Probá de nuevo.', productosDesactualizados: false }
  }

  const porId = new Map((data ?? []).map((p) => [String(p.id).toLowerCase(), p]))
  const lineas: LineaValidada[] = []
  for (const l of forma.lineas) {
    const p = porId.get(l.id)
    // is_active NULL cuenta como inactivo: es lo mismo que excluye el listado.
    if (!p || (opciones.soloActivos && p.is_active !== true)) {
      return { ok: false, error: MENSAJE_PRODUCTO_NO_DISPONIBLE, productosDesactualizados: true }
    }
    const precio = Number(p.sale_price)
    const comision = Number(p.barber_commission)
    if (!Number.isFinite(precio) || precio < 0 || !Number.isFinite(comision) || comision < 0) {
      return { ok: false, error: MENSAJES_RPC.precio_invalido, productosDesactualizados: false }
    }
    lineas.push({
      productId: String(p.id),
      nombre: String(p.name),
      cantidad: l.quantity,
      precioUnitario: precio,
      comisionUnitaria: comision,
      stock: p.stock == null ? null : Number(p.stock),
    })
  }
  return { ok: true, lineas }
}

/** Importe y comisión de las líneas, en centavos enteros. Sin barbero (venta de la barbería) no hay comisión. */
export function totalesDeLineas(lineas: LineaValidada[], conComision: boolean): { total: number; comision: number } {
  let total = 0
  let comision = 0
  for (const l of lineas) {
    total += Math.round(l.precioUnitario * 100) * l.cantidad
    if (conComision) comision += Math.round(l.comisionUnitaria * 100) * l.cantidad
  }
  return { total: total / 100, comision: comision / 100 }
}

// ─── Helpers internos ───────────────────────────────────────────────────────

function itemsParaRpc(lineas: LineaValidada[]) {
  return lineas.map((l) => ({ id: l.productId, quantity: l.cantidad }))
}

/** La RPC todavía no existe en esta base (mig 220 sin aplicar). */
function esFuncionInexistente(error: PostgrestError): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

/**
 * ¿La RPC seguro NO escribió nada? Un error con SQLSTATE o de PostgREST
 * significa que su transacción se revirtió (o ni empezó). Sin código es un
 * corte de red o el timeout de 8 s del cliente (KR#12): la transacción pudo
 * haber terminado igual del otro lado, y hay que mirar antes de compensar.
 */
function seguroNoEscribio(error: PostgrestError): boolean {
  const codigo = error.code ?? ''
  return /^[0-9A-Z]{5}$/.test(codigo) || codigo.startsWith('PGRST')
}

type EstadoComision = 'sumada' | 'sin_comision' | 'liquidado' | 'otra_sucursal' | 'error'

function avisoDeComision(estado: string | undefined, comision: number): string | null {
  if (!estado || estado === 'sumada' || estado === 'sin_comision' || comision <= 0) return null
  const monto = formatCurrency(comision)
  if (estado === 'liquidado') {
    return `La comisión (${monto}) no se sumó al reporte de hoy porque ya estaba liquidado. Avisale al encargado para cargarla en Sueldos.`
  }
  if (estado === 'otra_sucursal') {
    return `La comisión (${monto}) no se sumó: el reporte de hoy es de otra sucursal. Avisale al encargado para cargarla en Sueldos.`
  }
  return `La comisión (${monto}) no se pudo sumar al reporte de hoy. Avisale al encargado para cargarla en Sueldos.`
}

/** Día LOCAL de la sucursal (YYYY-MM-DD): con la fecha UTC, una venta después de las 21:00 iría al reporte de mañana. */
async function fechaLocalDeSucursal(supabase: SupabaseClient, branchId: string): Promise<string> {
  const { data, error } = await supabase.from('branches').select('timezone').eq('id', branchId).maybeSingle()
  if (error) console.error('[fechaLocalDeSucursal]', error.message)
  const tz = (data?.timezone as string | null | undefined) || 'America/Argentina/Buenos_Aires'
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  }
}

/**
 * Suma la comisión de productos al reporte pendiente del día (camino sin RPC).
 * Mismas reglas que `productos_sumar_comision`: el índice único es (staff, día,
 * tipo), así que un reporte ya liquidado o de otra sucursal NO se toca y se
 * avisa — antes el INSERT chocaba con 23505 y la comisión se perdía sin que
 * nadie se enterara. La suma es comparar-y-escribir: si otro cobro sumó en el
 * medio, se relee en vez de pisarlo.
 */
async function sumarComisionDeProductos(
  supabase: SupabaseClient,
  args: { staffId: string | null; branchId: string; monto: number; fecha: string },
): Promise<EstadoComision> {
  if (!args.staffId || args.monto <= 0) return 'sin_comision'

  for (let intento = 0; intento < 3; intento++) {
    const { data: fila, error } = await supabase
      .from('salary_reports')
      .select('id, amount, status, branch_id')
      .eq('staff_id', args.staffId)
      .eq('report_date', args.fecha)
      .eq('type', 'product_commission')
      .maybeSingle()
    if (error) {
      console.error('[sumarComisionDeProductos] lectura', error.message)
      return 'error'
    }

    if (!fila) {
      const { error: errAlta } = await supabase.from('salary_reports').insert({
        staff_id: args.staffId,
        branch_id: args.branchId,
        type: 'product_commission',
        amount: args.monto,
        report_date: args.fecha,
        status: 'pending',
      })
      if (!errAlta) return 'sumada'
      // Otro cobro lo creó recién: se relee y se suma sobre ese.
      if (errAlta.code === '23505') continue
      console.error('[sumarComisionDeProductos] alta', errAlta.message)
      return 'error'
    }

    if (fila.status !== 'pending') return 'liquidado'
    if (fila.branch_id !== args.branchId) return 'otra_sucursal'

    const nuevo = (Math.round(Number(fila.amount) * 100) + Math.round(args.monto * 100)) / 100
    const { data: actualizadas, error: errSuma } = await supabase
      .from('salary_reports')
      .update({ amount: nuevo })
      .eq('id', fila.id)
      .eq('status', 'pending')
      .eq('amount', fila.amount)
      .select('id')
    if (errSuma) {
      console.error('[sumarComisionDeProductos] suma', errSuma.message)
      return 'error'
    }
    if (actualizadas && actualizadas.length > 0) return 'sumada'
  }
  console.error('[sumarComisionDeProductos] no se pudo sumar tras 3 intentos', args)
  return 'error'
}

/**
 * Descuenta el stock DESPUÉS de registrar el detalle (camino sin RPC), con
 * comparar-y-escribir: el UPDATE sólo pega si el stock sigue siendo el que se
 * leyó, así dos ventas simultáneas no se pisan un descuento. Nunca baja de 0 y
 * un producto sin control de stock (NULL) no se toca. Devuelve los nombres de
 * los productos que no se pudieron descontar.
 */
async function descontarStock(supabase: SupabaseClient, branchId: string, lineas: LineaValidada[]): Promise<string[]> {
  const fallidos: string[] = []
  for (const l of lineas) {
    let listo = false
    for (let intento = 0; intento < 3 && !listo; intento++) {
      const { data: actual, error } = await supabase
        .from('products')
        .select('stock')
        .eq('id', l.productId)
        .eq('branch_id', branchId)
        .maybeSingle()
      if (error || !actual) {
        if (error) console.error('[descontarStock] lectura', error.message)
        break
      }
      if (actual.stock == null) {
        listo = true
        break
      }
      const stock = Number(actual.stock)
      const { data: actualizadas, error: errStock } = await supabase
        .from('products')
        .update({ stock: Math.max(0, stock - l.cantidad) })
        .eq('id', l.productId)
        .eq('branch_id', branchId)
        .eq('stock', stock)
        .select('id')
      if (errStock) {
        console.error('[descontarStock] escritura', errStock.message)
        break
      }
      listo = !!actualizadas && actualizadas.length > 0
    }
    if (!listo) fallidos.push(l.nombre)
  }
  return fallidos
}

function avisoDeStock(fallidos: string[]): string | null {
  if (fallidos.length === 0) return null
  return `No se pudo descontar el stock de ${fallidos.join(', ')}. Avisale al encargado para corregirlo.`
}

function filasDeDetalle(
  args: { visitId: string; branchId: string; barberId: string | null; paymentMethod: MetodoDePago },
  lineas: LineaValidada[],
) {
  return lineas.map((l) => ({
    visit_id: args.visitId,
    product_id: l.productId,
    barber_id: args.barberId,
    branch_id: args.branchId,
    quantity: l.cantidad,
    unit_price: l.precioUnitario,
    // Venta de la barbería (sin barbero) = sin comisión.
    commission_amount: args.barberId ? (Math.round(l.comisionUnitaria * 100) * l.cantidad) / 100 : 0,
    // El método REAL del cobro. Antes no se mandaba y las 212 filas históricas
    // decían 'cash' (154 eran transferencias); lo corrigió el backfill de la 216.
    payment_method: args.paymentMethod,
  }))
}

// ─── Productos de un COBRO (completeService) ────────────────────────────────

export interface ResultadoProductosDeVisita {
  /** Lo que se suma a visits.amount: lo registrado o, si el registro falló, lo
   *  validado — la plata ya está en el cajón y la caja tiene que cerrar. */
  total: number
  /** Lo que se suma a visits.commission_amount (el barbero vendió igual). */
  comision: number
  /** Algo no quedó como debía. Va al barbero tal cual; null = todo registrado. */
  aviso: string | null
}

interface ArgsProductosDeVisita {
  visitId: string
  branchId: string
  barberId: string | null
  paymentMethod: MetodoDePago
  lineas: LineaValidada[]
}

const AVISO_SIN_DETALLE =
  'Los productos se cobraron, pero no quedaron en el detalle de ventas ni se descontó el stock. No los vuelvas a cargar: avisale al encargado.'

/**
 * Registra las líneas de productos de un cobro YA cerrado: el server action
 * validó todo antes de completar la entrada, así que acá un fallo nunca
 * descuadra la caja: el importe y la comisión se suman igual y el detalle que
 * no se pudo guardar se avisa. Nunca duplica: la RPC es una vez por visita, y
 * ante un error ambiguo se mira lo que quedó escrito antes de compensar.
 */
export async function registrarProductosDeVisita(
  supabase: SupabaseClient,
  args: ArgsProductosDeVisita,
): Promise<ResultadoProductosDeVisita> {
  const esperados = totalesDeLineas(args.lineas, args.barberId != null)

  const { data, error } = await supabase.rpc('registrar_productos_de_visita', {
    p_visit_id: args.visitId,
    p_items: itemsParaRpc(args.lineas),
    p_payment_method: args.paymentMethod,
  })

  if (!error) {
    const r = (data ?? {}) as { success?: boolean; error?: string; total?: number | string; comision?: number | string; comision_estado?: string }
    if (r.success) {
      const comision = Number(r.comision ?? esperados.comision)
      return { total: Number(r.total ?? esperados.total), comision, aviso: avisoDeComision(r.comision_estado, comision) }
    }
    // Rechazo de la RPC (p. ej. el producto se borró en el medio): no escribió nada.
    console.error('[registrarProductosDeVisita] la RPC rechazó', { visitId: args.visitId, motivo: r.error })
    return cobradoSinDetalle(supabase, args, esperados)
  }

  if (esFuncionInexistente(error)) return registrarProductosDeVisitaSinRpc(supabase, args, esperados)

  console.error('[registrarProductosDeVisita] RPC', { visitId: args.visitId, code: error.code, message: error.message })
  if (seguroNoEscribio(error)) return cobradoSinDetalle(supabase, args, esperados)

  // Error ambiguo (red / timeout): la transacción pudo haber terminado igual.
  const registrados = await leerDetalleDeVisita(supabase, args.visitId)
  if (registrados) return { ...registrados, aviso: null }
  return {
    ...esperados,
    aviso:
      'No pudimos confirmar que los productos quedaran registrados (se cortó la conexión). El cobro quedó bien: avisale al encargado para que lo revise.',
  }
}

/** Lo que ya quedó en product_sales para la visita, o null si no hay nada (o no se pudo leer). */
async function leerDetalleDeVisita(
  supabase: SupabaseClient,
  visitId: string,
): Promise<{ total: number; comision: number } | null> {
  const { data, error } = await supabase
    .from('product_sales')
    .select('quantity, unit_price, commission_amount')
    .eq('visit_id', visitId)
  if (error) {
    console.error('[leerDetalleDeVisita]', error.message)
    return null
  }
  if (!data || data.length === 0) return null
  let total = 0
  let comision = 0
  for (const f of data) {
    total += Math.round(Number(f.unit_price) * 100) * Number(f.quantity)
    comision += Math.round(Number(f.commission_amount) * 100)
  }
  return { total: total / 100, comision: comision / 100 }
}

/**
 * El detalle no se guardó y seguro no hay nada escrito. El importe y la
 * comisión se imputan igual a la visita; la comisión además va al reporte del
 * día, para que lo que diga Sueldos coincida con lo que devengó la visita.
 */
async function cobradoSinDetalle(
  supabase: SupabaseClient,
  args: ArgsProductosDeVisita,
  esperados: { total: number; comision: number },
): Promise<ResultadoProductosDeVisita> {
  const fecha = await fechaLocalDeSucursal(supabase, args.branchId)
  const estado = await sumarComisionDeProductos(supabase, {
    staffId: args.barberId,
    branchId: args.branchId,
    monto: esperados.comision,
    fecha,
  })
  const avisos = [AVISO_SIN_DETALLE, avisoDeComision(estado, esperados.comision)].filter(Boolean)
  return { ...esperados, aviso: avisos.join(' ') }
}

/** Camino sin la mig 220: detalle → stock → comisión, con cada error mirado. */
async function registrarProductosDeVisitaSinRpc(
  supabase: SupabaseClient,
  args: ArgsProductosDeVisita,
  esperados: { total: number; comision: number },
): Promise<ResultadoProductosDeVisita> {
  const { error } = await supabase.from('product_sales').insert(filasDeDetalle(args, args.lineas))
  if (error) {
    console.error('[registrarProductosDeVisita] detalle', { visitId: args.visitId, code: error.code, message: error.message })
    // Un INSERT es atómico, pero sin código (corte de red) pudo haber entrado.
    const yaEstaba = !seguroNoEscribio(error) ? await leerDetalleDeVisita(supabase, args.visitId) : null
    if (!yaEstaba) return cobradoSinDetalle(supabase, args, esperados)
  }

  // El stock baja DESPUÉS del detalle: si el detalle no se guarda, el stock no se toca.
  const sinStock = await descontarStock(supabase, args.branchId, args.lineas)
  const fecha = await fechaLocalDeSucursal(supabase, args.branchId)
  const estado = await sumarComisionDeProductos(supabase, {
    staffId: args.barberId,
    branchId: args.branchId,
    monto: esperados.comision,
    fecha,
  })
  const avisos = [avisoDeStock(sinStock), avisoDeComision(estado, esperados.comision)].filter(Boolean)
  return { ...esperados, aviso: avisos.length > 0 ? avisos.join(' ') : null }
}

// ─── Venta directa (sin corte) ──────────────────────────────────────────────

export type ResultadoMotorVentaDirecta =
  | { ok: true; visitId: string; total: number; yaRegistrada: boolean; aviso: string | null }
  | { ok: false; error: string; productosDesactualizados: boolean }

interface ArgsVentaDirecta {
  /** Un uuid por apertura del diálogo: misma clave = la misma venta. */
  clave: string
  /**
   * La clave la mandó la pantalla (una por apertura del diálogo) y no la
   * inventó el servidor para esta llamada. Sólo así un reintento es la MISMA
   * venta: con una clave del servidor, volver a cargarla duplica.
   */
  claveDelCliente: boolean
  orgId: string
  branchId: string
  /** null = venta de la barbería, sin comisión. */
  barberId: string | null
  paymentMethod: MetodoDePago
  /** Sólo en transferencia; ya validada contra la sucursal. */
  paymentAccountId: string | null
  lineas: LineaValidada[]
}

/**
 * Registra una venta de productos sin corte: la visita "fantasma" (sin
 * cliente, sin servicio, sin queue_entry_id: `esCorte()` la cuenta como venta
 * de producto), el detalle, el stock y la comisión del día. Con la mig 220 es
 * una sola transacción idempotente: un reintento tras el timeout devuelve la
 * misma venta en vez de duplicar caja, stock y comisión.
 */
export async function registrarVentaDirecta(
  supabase: SupabaseClient,
  args: ArgsVentaDirecta,
): Promise<ResultadoMotorVentaDirecta> {
  const { data, error } = await supabase.rpc('registrar_venta_directa_productos', {
    p_clave: args.clave,
    p_branch_id: args.branchId,
    p_barber_id: args.barberId,
    p_payment_method: args.paymentMethod,
    p_payment_account_id: args.paymentAccountId,
    p_items: itemsParaRpc(args.lineas),
  })

  if (!error) return desdeRespuestaRpc(data)
  if (esFuncionInexistente(error)) return registrarVentaDirectaSinRpc(supabase, args)

  console.error('[registrarVentaDirecta] RPC', { code: error.code, message: error.message })
  // ¿Quedó registrada igual (timeout con la transacción ya confirmada, o una
  // segunda llamada con la misma clave que esperó a la primera)? La clave lo dice.
  const { data: previa, error: errPrevia } = await supabase
    .from('ventas_directas_claves')
    .select('visit_id, respuesta')
    .eq('clave', args.clave)
    .maybeSingle()
  if (errPrevia) console.error('[registrarVentaDirecta] clave', errPrevia.message)
  if (previa?.visit_id) return desdeRespuestaRpc(previa.respuesta)

  return {
    ok: false,
    // Prometer «no se duplica» sólo es cierto si el reintento trae la MISMA
    // clave, o sea si la mandó la pantalla. Con una clave del servidor cada
    // intento es una venta nueva (hallazgo productos-y-fugas-05).
    error: args.claveDelCliente
      ? 'No pudimos confirmar la venta. Probá de nuevo: si ya había quedado registrada, no se duplica.'
      : 'No pudimos confirmar la venta. Antes de volver a cargarla, fijate en el historial si quedó registrada: si la cargás de nuevo, puede quedar dos veces.',
    productosDesactualizados: false,
  }
}

function desdeRespuestaRpc(data: unknown): ResultadoMotorVentaDirecta {
  const r = (data ?? {}) as {
    success?: boolean
    error?: string
    visit_id?: string
    total?: number | string
    comision?: number | string
    comision_estado?: string
    ya_registrada?: boolean
  }
  if (r.success && r.visit_id) {
    return {
      ok: true,
      visitId: r.visit_id,
      total: Number(r.total ?? 0),
      yaRegistrada: r.ya_registrada === true,
      aviso: avisoDeComision(r.comision_estado, Number(r.comision ?? 0)),
    }
  }
  return {
    ok: false,
    error: mensajeRpc(r.error),
    productosDesactualizados: r.error === 'producto_no_disponible',
  }
}

/**
 * Camino sin la mig 220: mismos pasos, en orden y con compensación. Sin la
 * tabla de claves no hay idempotencia: un reintento tras un timeout puede
 * duplicar. Es transitorio, hasta que se aplique la 220.
 */
async function registrarVentaDirectaSinRpc(
  supabase: SupabaseClient,
  args: ArgsVentaDirecta,
): Promise<ResultadoMotorVentaDirecta> {
  const { total, comision } = totalesDeLineas(args.lineas, args.barberId != null)
  if (total <= 0) return { ok: false, error: MENSAJES_RPC.total_cero, productosDesactualizados: false }

  const ahora = new Date().toISOString()
  const { data: visita, error: errVisita } = await supabase
    .from('visits')
    .insert({
      branch_id: args.branchId,
      organization_id: args.orgId,
      barber_id: args.barberId,
      amount: total,
      commission_amount: comision,
      commission_pct: 0,
      payment_method: args.paymentMethod,
      payment_account_id: args.paymentAccountId,
      started_at: ahora,
      completed_at: ahora,
    })
    .select('id')
    .single()

  if (errVisita || !visita) {
    console.error('[registrarVentaDirecta] visita', errVisita?.message)
    return { ok: false, error: MENSAJE_NO_SE_REGISTRO, productosDesactualizados: false }
  }

  const { error: errDetalle } = await supabase
    .from('product_sales')
    .insert(filasDeDetalle({ ...args, visitId: visita.id }, args.lineas))

  if (errDetalle) {
    console.error('[registrarVentaDirecta] detalle', errDetalle.message)
    // Compensación: una visita fantasma sin detalle es plata sin explicación en
    // caja. El INSERT del detalle es atómico, así que no quedó ninguna fila que
    // bloquee el borrado (product_sales_visit_id_fkey es NO ACTION).
    const { error: errBorrado } = await supabase.from('visits').delete().eq('id', visita.id)
    if (errBorrado) {
      console.error('[registrarVentaDirecta] visita huérfana sin detalle', { visitId: visita.id, error: errBorrado.message })
      return {
        ok: false,
        error: 'La venta quedó registrada a medias (sin el detalle de productos). No la repitas: avisale al encargado.',
        productosDesactualizados: false,
      }
    }
    return { ok: false, error: MENSAJE_NO_SE_REGISTRO, productosDesactualizados: false }
  }

  const sinStock = await descontarStock(supabase, args.branchId, args.lineas)
  const fecha = await fechaLocalDeSucursal(supabase, args.branchId)
  const estado = await sumarComisionDeProductos(supabase, {
    staffId: args.barberId,
    branchId: args.branchId,
    monto: comision,
    fecha,
  })
  const avisos = [avisoDeStock(sinStock), avisoDeComision(estado, comision)].filter(Boolean)

  return {
    ok: true,
    visitId: visita.id,
    total,
    yaRegistrada: false,
    aviso: avisos.length > 0 ? avisos.join(' ') : null,
  }
}
