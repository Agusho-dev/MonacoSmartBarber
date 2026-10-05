'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { leerBarberSession } from '@/lib/barber-cookie'
import { getCurrentOrgId, validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import { registrarVentaDirecta, validarLineasDeProductos } from '@/lib/productos/venta'
import type {
  LineaDeProducto,
  ResultadoProductosParaCobro,
  ResultadoVentaDirecta,
} from '@/lib/productos/reglas'

// Capa fina: sesión, alcance de sucursal y quién vende. La venta en sí (validar
// contra la base, detalle, stock, comisión, idempotencia) vive en el motor
// plano `@/lib/productos/venta`, que no es un endpoint.

/**
 * El mensaje de "sesión vencida" depende de por dónde entró: el panel del
 * barbero es PIN + cookie, el dashboard es email y contraseña. Decirle "volvé a
 * entrar con tu PIN" a alguien del dashboard lo deja buscando un PIN que no tiene.
 */
async function mensajeDeSesionVencida(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('barber_session')
    ? 'Tu sesión venció. Volvé a entrar con tu PIN.'
    : 'Tu sesión venció. Volvé a iniciar sesión.'
}

/**
 * La misma puerta para listar y para vender. Admite la cookie firmada del
 * barbero y la sesión del dashboard: el diálogo de cobro se usa en el panel, en
 * /dashboard/fila, en la agenda y en appointment-list. No exige fichada abierta
 * (getBarberSession sí): un barbero sin fichar igual tiene que poder ver la
 * lista; la org la resuelve getCurrentOrgId contra `staff`, que corta a un
 * empleado dado de baja.
 */
async function resolverAccesoASucursal(
  branchId: string,
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  if (!isValidUUID(branchId)) return { ok: false, error: 'Sucursal inválida.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: await mensajeDeSesionVencida() }

  // La sucursal es de la organización activa…
  if (!(await validateBranchAccess(branchId))) return { ok: false, error: 'No tenés acceso a esta sucursal.' }
  // …y el rol (o la cookie del barbero, que vale sólo para su sucursal) la alcanza.
  const permitidas = await getScopedBranchIds()
  if (!permitidas.includes(branchId)) return { ok: false, error: 'No tenés acceso a esta sucursal.' }

  return { ok: true, orgId }
}

/** El staff de la cookie firmada del barbero, si la request viene del panel. */
async function staffDelPanel(): Promise<string | null> {
  const cookieStore = await cookies()
  const valor = cookieStore.get('barber_session')?.value
  if (!valor) return null
  const sesion = leerBarberSession(valor)
  return sesion && isValidUUID(sesion.staff_id) ? sesion.staff_id : null
}

// ─── Lista de productos para el cobro y la venta directa ───────────────────

/**
 * Productos activos de una sucursal, para la tablet. Reemplaza la lectura con
 * la anon key desde el browser, que desde la mig 212 (4/9/2026) fallaba con
 * 42501 y el panel lo tragaba: la sección de productos ni se dibujaba y durante
 * un mes no se registró una sola venta (mig 216).
 *
 * Devuelve id, nombre, precio y stock. NO costo ni comisión: la lista viaja a un
 * browser compartido en el local. Un error vuelve como error, nunca como lista
 * vacía: "esta sucursal no tiene productos" y "no pudimos leerlos" son cosas
 * distintas, y confundirlas es lo que escondió la rotura.
 */
export async function listarProductosParaCobro(branchId: string): Promise<ResultadoProductosParaCobro> {
  const acceso = await resolverAccesoASucursal(branchId)
  if (!acceso.ok) return { ok: false, error: acceso.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sale_price, stock')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name')

  if (error) {
    console.error('[listarProductosParaCobro]', { branchId, message: error.message })
    return { ok: false, error: 'No pudimos cargar los productos de la sucursal.' }
  }

  return {
    ok: true,
    productos: (data ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      sale_price: Number(p.sale_price),
      stock: p.stock == null ? null : Number(p.stock),
    })),
  }
}

// ─── Venta directa de productos (sin corte) ────────────────────────────────

/**
 * Registra una venta de productos sin corte. Desde el panel del barbero la
 * venta va a su nombre (`barberId` = el de la sesión) o como venta de la
 * barbería (`null`, sin comisión); desde el dashboard, a nombre de cualquier
 * personal activo de esa sucursal.
 *
 * `claveIdempotencia`: un uuid por apertura del diálogo (la mandan el panel y,
 * desde esta ola, la venta del dashboard). Con la mig 220, un reintento con la
 * misma clave devuelve la misma venta en vez de duplicar caja, stock y
 * comisión. Sin clave (un browser sin crypto.randomUUID, un bundle viejo) se
 * genera una por llamada y el mensaje de "no pudimos confirmar" no promete nada.
 *
 * Transferencia sin cuenta: se rechaza con `codigo: 'falta_cuenta'` si la
 * sucursal tiene alguna cuenta activa (ver abajo).
 */
export async function directProductSale(
  branchId: string,
  barberId: string | null,
  paymentMethod: 'cash' | 'card' | 'transfer',
  productsToSell: LineaDeProducto[],
  paymentAccountId?: string | null,
  claveIdempotencia?: string | null,
): Promise<ResultadoVentaDirecta> {
  if (!['cash', 'card', 'transfer'].includes(paymentMethod)) {
    return { error: 'Elegí cómo pagó el cliente.' }
  }
  if (barberId !== null && !isValidUUID(barberId)) {
    return { error: 'El barbero elegido no es válido.' }
  }
  if (!Array.isArray(productsToSell) || productsToSell.length === 0) {
    return { error: 'Elegí al menos un producto.' }
  }

  const acceso = await resolverAccesoASucursal(branchId)
  if (!acceso.ok) return { error: acceso.error }

  // Desde el panel nadie vende a nombre de otro: la comisión es plata del
  // barbero y el browser la podía elegir.
  const staffPanel = await staffDelPanel()
  if (staffPanel && barberId !== null && barberId !== staffPanel) {
    return { error: 'Sólo podés registrar ventas a tu nombre o como venta de la barbería.' }
  }

  const supabase = createAdminClient()

  if (barberId !== null) {
    const { data: staffRow, error: errStaff } = await supabase
      .from('staff')
      .select('id')
      .eq('id', barberId)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .maybeSingle()
    if (errStaff) {
      console.error('[directProductSale] staff', errStaff.message)
      return { error: 'No pudimos registrar la venta. Probá de nuevo.' }
    }
    if (!staffRow) return { error: 'El barbero elegido no está activo en esta sucursal.' }
  }

  // La cuenta sólo cuenta en transferencia: antes se mandaba la preseleccionada
  // con cualquier método y una venta en efectivo quedaba colgada de una cuenta.
  let cuenta: string | null = null
  if (paymentMethod === 'transfer' && paymentAccountId) {
    if (!isValidUUID(paymentAccountId)) return { error: 'La cuenta de cobro elegida ya no está disponible. Elegí otra.' }
    const { data: cuentaRow, error: errCuenta } = await supabase
      .from('payment_accounts')
      .select('id')
      .eq('id', paymentAccountId)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .maybeSingle()
    if (errCuenta) {
      console.error('[directProductSale] cuenta', errCuenta.message)
      return { error: 'No pudimos registrar la venta. Probá de nuevo.' }
    }
    if (!cuentaRow) return { error: 'La cuenta de cobro elegida ya no está disponible. Elegí otra.' }
    cuenta = paymentAccountId
  } else if (paymentMethod === 'transfer') {
    // Transferencia SIN cuenta: sólo vale si la sucursal no tiene ninguna cuenta
    // activa (es la única forma de cobrar por transferencia ahí). Con cuentas, la
    // plata no entraría a ningún destino (KR#30): es lo que mandaba una pantalla
    // que no pudo leer las cuentas o una tablet con el bundle viejo (hallazgo
    // productos-y-fugas-01), y la venta del dashboard, que no elegía cuenta.
    const { count, error: errCuentas } = await supabase
      .from('payment_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .eq('is_active', true)
    if (errCuentas) {
      console.error('[directProductSale] cuentas de la sucursal', errCuentas.message)
      return { error: 'No pudimos verificar las cuentas de cobro. Probá de nuevo.' }
    }
    if ((count ?? 0) > 0) {
      return {
        error: staffPanel
          ? 'Falta la cuenta de cobro: recargá el panel y elegí a qué cuenta transfirió.'
          : 'Falta la cuenta de cobro: recargá la página y elegí a qué cuenta transfirió.',
        codigo: 'falta_cuenta',
      }
    }
  }

  // Todo se valida ANTES de escribir: ids de esta sucursal, activos, cantidades.
  const validacion = await validarLineasDeProductos(supabase, branchId, productsToSell, { soloActivos: true })
  if (!validacion.ok) {
    return { error: validacion.error, productosDesactualizados: validacion.productosDesactualizados }
  }

  // Con la clave de la pantalla (una por apertura del diálogo) un reintento es
  // la MISMA venta. Sin ella se genera una por llamada: la venta sale igual,
  // pero sin la protección contra el reintento (y el mensaje de error lo dice).
  const claveDelCliente = !!claveIdempotencia && isValidUUID(claveIdempotencia)
  const clave = claveDelCliente ? (claveIdempotencia as string) : crypto.randomUUID()

  const resultado = await registrarVentaDirecta(supabase, {
    clave,
    claveDelCliente,
    orgId: acceso.orgId,
    branchId,
    barberId,
    paymentMethod,
    paymentAccountId: cuenta,
    lineas: validacion.lineas,
  })

  if (!resultado.ok) {
    return { error: resultado.error, productosDesactualizados: resultado.productosDesactualizados }
  }

  // La transferencia queda en transfer_logs por el trigger
  // trg_visits_sync_transfer_log (mig 160) al insertar la visita.
  revalidatePath('/barbero/fila')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/servicios')
  revalidatePath('/dashboard/sueldos')

  return {
    success: true,
    visitId: resultado.visitId,
    total: resultado.total,
    yaRegistrada: resultado.yaRegistrada,
    aviso: resultado.aviso,
  }
}
