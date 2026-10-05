/**
 * Reglas de la venta de productos que comparten la tablet y el servidor.
 *
 * Sin 'use server' ni 'server-only' a propósito: las importan el selector de la
 * tablet (para dibujar el tope y el total) y el motor del servidor (para
 * validar). Si el tope viviera en dos lugares, el stepper dejaría elegir 25 y el
 * servidor rechazaría el cobro con el cliente parado en el mostrador.
 */

/** Unidades máximas de un mismo producto por venta. El mismo tope valida la base (mig 220). */
export const TOPE_UNIDADES_POR_PRODUCTO = 20

/** Productos distintos por venta. Una venta real tiene uno o dos; esto es sólo una defensa. */
export const TOPE_PRODUCTOS_POR_VENTA = 30

/**
 * Lo que la tablet necesita para elegir un producto y mostrar su precio.
 * NO trae costo ni comisión: la lista viaja a un browser compartido en el local.
 */
export interface ProductoParaCobro {
  id: string
  name: string
  sale_price: number
  /** null = el producto no lleva control de stock. */
  stock: number | null
}

/** Una línea elegida en la tablet. El precio NUNCA viaja del browser: lo pone el servidor. */
export interface LineaDeProducto {
  id: string
  quantity: number
}

/** Resultado de `listarProductosParaCobro`: un error se distingue de una sucursal sin productos. */
export type ResultadoProductosParaCobro =
  | { ok: true; productos: ProductoParaCobro[] }
  | { ok: false; error: string }

/**
 * Código máquina de un rechazo de la venta directa:
 * - `falta_cuenta`: transferencia sin cuenta de cobro en una sucursal que tiene
 *   cuentas activas (la pantalla tiene que volver a pedir las cuentas y elegir una).
 */
export type CodigoRechazoVenta = 'falta_cuenta'

/**
 * Resultado de `directProductSale`. Las propiedades `?: undefined` mantienen
 * válido el `if (result.error)` de los llamadores que ya existían (dashboard).
 */
export type ResultadoVentaDirecta =
  | {
      success: true
      visitId: string
      /** Lo que quedó registrado, que es lo que hay que decirle al barbero. */
      total: number
      /** La misma venta ya estaba registrada (reintento con la misma clave). */
      yaRegistrada: boolean
      /** La venta salió, pero algo no quedó como debía (stock, comisión). */
      aviso: string | null
      error?: undefined
      productosDesactualizados?: undefined
      codigo?: undefined
    }
  | {
      success?: undefined
      error: string
      /** La lista de la tablet quedó vieja: conviene recargarla antes de reintentar. */
      productosDesactualizados?: boolean
      /** Rechazo con código máquina; sin código = mensaje para mostrar tal cual. */
      codigo?: CodigoRechazoVenta
    }

/**
 * Las líneas cuyo producto sigue en la lista. Si un refresco sacó un producto
 * que estaba elegido, deja de sumarse al total y de mandarse: lo que el
 * barbero ve en pantalla es exactamente lo que se cobra.
 */
export function lineasVigentes(
  productos: ProductoParaCobro[],
  seleccion: LineaDeProducto[],
): LineaDeProducto[] {
  const ids = new Set(productos.map((p) => p.id))
  return seleccion.filter((l) => ids.has(l.id) && l.quantity > 0)
}

/** Total en pesos de las líneas, sumado en centavos enteros (sin errores de punto flotante). */
export function totalDeLineas(productos: ProductoParaCobro[], lineas: LineaDeProducto[]): number {
  const precio = new Map(productos.map((p) => [p.id, p.sale_price]))
  let centavos = 0
  for (const l of lineas) {
    const unitario = precio.get(l.id)
    if (unitario == null) continue
    centavos += Math.round(unitario * 100) * l.quantity
  }
  return centavos / 100
}

/** Unidades totales elegidas (para "3 productos" en los resúmenes). */
export function unidadesDeLineas(lineas: LineaDeProducto[]): number {
  return lineas.reduce((n, l) => n + l.quantity, 0)
}
