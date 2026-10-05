'use client'

import { useEffect, useRef, useState } from 'react'
import { directProductSale } from '@/lib/actions/sales'
import { obtenerCuentasDeCobro } from '@/lib/actions/paymentAccounts'
import type { PaymentMethod } from '@/lib/types/database'
import { pickTransferAccount, type TransferAccountState } from '@/lib/payment-accounts'
import { useProductosDeSucursal } from '@/hooks/use-productos-de-sucursal'
import {
  lineasVigentes,
  totalDeLineas,
  unidadesDeLineas,
  type LineaDeProducto,
} from '@/lib/productos/reglas'
import { TransferAccountPicker } from './transfer-account-picker'
import { PaymentMethodButtons } from './payment-method-buttons'
import { SelectorProductos } from './selector-productos'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { toast } from 'sonner'

interface DirectSaleDialogProps {
  open: boolean
  branchId: string
  barberId: string
  onClose: () => void
  onCompleted?: () => void
}

/**
 * Clave de idempotencia de una apertura del diálogo. `crypto.randomUUID` no
 * existe fuera de un contexto seguro ni en navegadores viejos: sin clave, el
 * servidor genera una por llamada (la venta sale igual, sin la protección
 * contra el reintento), en vez de romper el diálogo.
 */
function nuevaClave(): string | null {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
  } catch {
    return null
  }
}

/** Las cuentas de cobro: "no se pudieron traer" no es lo mismo que "no hay". */
type EstadoCuentas =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'listo'; cuentas: TransferAccountState[] }

/**
 * Venta de productos sin corte ("se lleva una cera y se va"). La lista sale de
 * un server action (antes era una lectura anónima que fallaba en silencio desde
 * el 4/9/2026 y mostraba "No hay productos"), y la venta se registra en una
 * sola transacción idempotente (mig 220): si la respuesta se pierde y el
 * barbero vuelve a tocar el botón, no se duplica.
 */
export function DirectSaleDialog({
  open,
  branchId,
  barberId,
  onClose,
  onCompleted,
}: DirectSaleDialogProps) {
  const productos = useProductosDeSucursal(branchId, open)

  const [seleccion, setSeleccion] = useState<LineaDeProducto[]>([])
  const [metodo, setMetodo] = useState<PaymentMethod | null>(null)
  const [cuentas, setCuentas] = useState<EstadoCuentas>({ tipo: 'cargando' })
  const [rotatedFrom, setRotatedFrom] = useState<TransferAccountState[]>([])
  const [allAccountsFull, setAllAccountsFull] = useState(false)
  const [cuentaElegida, setCuentaElegida] = useState('')
  const [intentoCuentas, setIntentoCuentas] = useState(0)
  const [enviando, setEnviando] = useState(false)
  // El motivo del último rechazo queda escrito arriba del botón: un toast de
  // cinco segundos se lo pierde quien está mirando al cliente.
  const [error, setError] = useState<string | null>(null)

  // Una clave por apertura del diálogo: la misma venta reintentada es la misma
  // clave, y el servidor devuelve la venta ya registrada en vez de otra.
  const claveRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      // Diferimos los resets para evitar cascading renders.
      queueMicrotask(() => {
        setSeleccion([])
        setMetodo(null)
        setCuentaElegida('')
        setError(null)
      })
      return
    }
    claveRef.current = nuevaClave()
  }, [open])

  // Mismo criterio que el cobro de un servicio: acumulado real del mes desde el
  // ledger y rotación a la primera cuenta con margen (mig 160). Se pide al
  // abrir: si una cuenta se llenó hace un minuto, ya tiene que verse la siguiente.
  useEffect(() => {
    if (!open) return
    let vigente = true
    queueMicrotask(() => {
      if (vigente) setCuentas((prev) => (prev.tipo === 'listo' ? prev : { tipo: 'cargando' }))
    })
    obtenerCuentasDeCobro(branchId)
      .then((r) => {
        if (!vigente) return
        // Un fallo del servidor viene como `{ ok: false }`: antes llegaba como
        // lista vacía y se leía "esta sucursal no tiene cuentas", que deja
        // registrar la transferencia sin cuenta.
        if (!r.ok) {
          console.error('[DirectSaleDialog] cuentas de cobro', r.error)
          setCuentas({ tipo: 'error' })
          return
        }
        setCuentas({ tipo: 'listo', cuentas: r.cuentas })
        const pick = pickTransferAccount(r.cuentas)
        setRotatedFrom(pick.skipped)
        setAllAccountsFull(pick.allFull)
        setCuentaElegida(pick.account?.id ?? '')
      })
      .catch((e: unknown) => {
        // Antes la promesa rechazada quedaba sin manejar y la transferencia se
        // registraba sin cuenta: plata que no aparece en ningún destino (KR#30).
        if (!vigente) return
        console.error('[DirectSaleDialog] cuentas de cobro', e)
        setCuentas({ tipo: 'error' })
        // Deploy nuevo con el panel en el bundle anterior: «Reintentar» no
        // sirve (la acción ya no existe en el servidor) y la venta tampoco va
        // a salir. Se avisa y se recarga (src/lib/recarga-version.ts).
        if (esErrorDeVersion(e)) {
          if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
        }
      })
    return () => {
      vigente = false
    }
  }, [open, branchId, intentoCuentas])

  const lineas = lineasVigentes(productos.productos, seleccion)
  const total = totalDeLineas(productos.productos, lineas)
  const unidades = unidadesDeLineas(lineas)
  const esTransferencia = metodo === 'transfer'
  // Sin saber a qué cuenta entra la plata, una transferencia no se registra:
  // ni mientras las cuentas cargan, ni si fallaron, ni en el instante en que
  // se reabrió el diálogo y la rotación todavía no eligió una.
  const faltaCuenta =
    esTransferencia &&
    (cuentas.tipo !== 'listo' || (cuentas.cuentas.length > 0 && !cuentaElegida))
  const puedeRegistrar = !enviando && lineas.length > 0 && metodo !== null && !faltaCuenta

  async function registrarVenta() {
    if (!puedeRegistrar || !metodo) return
    setEnviando(true)
    setError(null)
    try {
      const resultado = await directProductSale(
        branchId,
        barberId,
        metodo,
        lineas,
        esTransferencia ? cuentaElegida || null : null,
        claveRef.current,
      )

      if (!resultado.success) {
        setError(resultado.error)
        toast.error(resultado.error)
        // Un producto se dio de baja o cambió de sucursal: la lista que se ve
        // quedó vieja. Se recarga y el producto que ya no está deja de sumarse.
        if (resultado.productosDesactualizados) productos.reintentar()
        // La sucursal tiene cuentas y la venta salía sin ninguna (la lista de
        // cuentas quedó vieja o vacía): se vuelven a pedir para elegir una.
        if (resultado.codigo === 'falta_cuenta') setIntentoCuentas((n) => n + 1)
        return
      }

      if (!resultado.yaRegistrada) {
        toast.success(`Venta registrada: ${formatCurrency(resultado.total)}`)
      } else if (Math.abs(resultado.total - total) < 0.01) {
        toast.success(`Esa venta ya había quedado registrada: ${formatCurrency(resultado.total)}`)
      } else {
        // Se perdió la respuesta del primer intento y después cambió la
        // selección: la clave devuelve la venta ORIGINAL, no la de pantalla.
        toast.warning(
          `Esa venta ya había quedado registrada por ${formatCurrency(resultado.total)}. Para vender algo más, abrí una venta nueva.`,
          { duration: 12000 },
        )
      }
      // La venta salió, pero algo no quedó como debía (stock, comisión): se dice
      // con tiempo para leerlo entero.
      if (resultado.aviso) toast.warning(resultado.aviso, { duration: 12000 })
      onCompleted?.()
      onClose()
    } catch (e) {
      console.error('[DirectSaleDialog] registrar venta', e)
      // Deploy nuevo con el panel en el bundle anterior: la acción ya no existe
      // en el servidor, así que la venta NO se registró y reintentar no sirve.
      // Se avisa y se recarga (src/lib/recarga-version.ts). Si la guarda no deja
      // recargar sola, el motivo queda también arriba del botón.
      if (esErrorDeVersion(e)) {
        if (!avisarYRecargarPorVersion()) {
          setError(TEXTO_RECARGA_MANUAL)
          toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
        }
        return
      }
      // El server action rechazó (red, límite de la función). No sabemos si
      // llegó a registrarse: se dice así, sin prometer nada.
      const msg = 'No pudimos confirmar la venta. Revisá la conexión y probá de nuevo.'
      setError(msg)
      toast.error(msg)
    } finally {
      // Pase lo que pase, el botón nunca queda en "Registrando…" (KR#25).
      setEnviando(false)
    }
  }

  const textoBoton = enviando
    ? 'Registrando…'
    : lineas.length === 0
      ? 'Elegí al menos un producto'
      : !metodo
        ? 'Elegí cómo pagó'
        : `Registrar venta · ${formatCurrency(total)}`

  return (
    // Mientras se registra no se puede cerrar (X, overlay ni Escape): una venta
    // a medio camino no puede quedar sin respuesta a la vista.
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !enviando) onClose() }}>
      <DialogContent
        showCloseButton={!enviando}
        className="sm:max-w-xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6 gap-3 sm:gap-4"
      >
        <DialogHeader>
          <DialogTitle>Venta de productos</DialogTitle>
          <DialogDescription>Para cuando alguien se lleva un producto sin cortarse.</DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-5">
          {/* Productos */}
          <section aria-labelledby="venta-directa-productos">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p id="venta-directa-productos" className="text-sm font-medium">
                Productos
              </p>
              {unidades > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                </span>
              )}
            </div>
            <SelectorProductos
              estado={productos.estado}
              seleccion={seleccion}
              onCambiar={(s) => {
                setSeleccion(s)
                setError(null)
              }}
              onReintentar={productos.reintentar}
              deshabilitado={enviando}
            />
          </section>

          {/* Total */}
          <div className="rounded-2xl border bg-muted/30 px-4 py-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Total a cobrar
            </p>
            <p className="mt-1 text-[clamp(40px,10vw,64px)] font-black leading-none tracking-tighter tabular-nums">
              {formatCurrency(total)}
            </p>
          </div>

          {/* Método de pago (el mismo componente que el cobro de un servicio) */}
          <section>
            <p className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Método de pago
            </p>
            <PaymentMethodButtons
              value={metodo}
              onChange={(m) => {
                setMetodo(m)
                setError(null)
              }}
            />
          </section>

          {/* Cuenta de cobro: sólo en transferencia */}
          {esTransferencia &&
            (cuentas.tipo === 'cargando' ? (
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                Buscando la cuenta de cobro…
              </p>
            ) : cuentas.tipo === 'error' ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">No pudimos traer las cuentas de cobro</p>
                  <p className="text-xs opacity-90">
                    Sin saber a qué cuenta entra la transferencia no se puede registrar. Reintentá o cobrá por otro medio.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 shrink-0 border-amber-500/50"
                  onClick={() => setIntentoCuentas((n) => n + 1)}
                >
                  <RefreshCw className="mr-1.5 size-4" aria-hidden />
                  Reintentar
                </Button>
              </div>
            ) : cuentas.cuentas.length === 0 ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Esta sucursal no tiene cuentas de cobro activas: la transferencia queda registrada sin cuenta asignada.
              </p>
            ) : (
              <TransferAccountPicker
                accounts={cuentas.cuentas}
                selectedAccountId={cuentaElegida}
                onSelect={setCuentaElegida}
                rotatedFrom={rotatedFrom}
                allFull={allAccountsFull}
                amountText={formatCurrency(total)}
                showAliasHero={false}
              />
            ))}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive animate-in fade-in duration-200 motion-reduce:animate-none"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">{error}</p>
            </div>
          )}

          <Button
            className="h-16 w-full text-lg font-black"
            size="lg"
            onClick={registrarVenta}
            disabled={!puedeRegistrar}
          >
            {enviando && <Loader2 className="mr-2 size-5 animate-spin motion-reduce:animate-none" aria-hidden />}
            <span className="truncate">{textoBoton}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
