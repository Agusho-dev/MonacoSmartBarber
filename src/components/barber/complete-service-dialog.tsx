'use client'

import { useCallback, useEffect, useState, useRef, useMemo, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cerrarSoloAsesoria, completeService, type CodigoRechazoCobro } from '@/lib/actions/queue'
// `obtenerCuentasDeCobro` y no `getTransferAccountsState`: ésa quedó congelada
// devolviendo la lista pelada para las tablets con el bundle viejo (cambiarle
// la forma rompía su cobro por transferencia sin ningún aviso).
import { obtenerCuentasDeCobro } from '@/lib/actions/paymentAccounts'
import { updateClientNotes } from '@/lib/actions/clients'
import { leerLoyaltyEmbed } from '@/lib/loyalty-embed'
import { cerrarCobroFotos, descartarFotosDelCobro, useFotosCorteStore } from '@/stores/fotos-corte-store'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { invalidarUltimosCortes } from '@/hooks/use-ultimos-cortes'
import { primerNombre } from '@/lib/fotos-corte/textos'
import { vibrate } from '@/lib/barber-feedback'
import { FotosDelCobro } from './fotos-del-cobro'
import { AsesoriaBadge, type TonoAsesoriaBadge } from './asesoria-badge'
import type { QueueEntry, Service, PaymentMethod } from '@/lib/types/database'
import { useProductosDeSucursal } from '@/hooks/use-productos-de-sucursal'
import { lineasVigentes, totalDeLineas } from '@/lib/productos/reglas'
import { SelectorProductos } from './selector-productos'
import { pickTransferAccount, type TransferAccountState } from '@/lib/payment-accounts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  X,
  ArrowRight,
  ArrowLeft,
  TicketPercent,
  ScanLine,
  Check,
  AlertTriangle,
  Users,
  Loader2,
  Link2,
  QrCode,
  UserPlus,
  Package,
  Wallet,
  RefreshCw,
  MessageCircleQuestionMark,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { TransferAccountPicker } from './transfer-account-picker'
import { PaymentMethodButtons, type PaymentOptionValue } from './payment-method-buttons'
import { TipSelector } from './tip-selector'
import { CouponScanDialog, type AppliedCoupon } from './coupon-scan-dialog'
import { ReceiptScanDialog, type ReceiptScanResult } from './receipt-scan-dialog'
import { LoyaltyTierChip } from './loyalty-tier-chip'
import { useLoyaltyResultStore } from '@/stores/loyalty-result-store'
import {
  benefitAppliesToServices,
  servicioQueMatcheaBeneficio,
  benefitDiscountAmount,
  benefitDiscountPct,
  findLoyaltyTier,
  type LoyaltyFinalizeResult,
  type LoyaltyTierLite,
} from '@/lib/loyalty-checkout'
import { getTransferReceiptSettings, linkReceiptToVisit, getOpenJointReceipts, type TransferReceiptSettingsView, type OpenJointReceipt } from '@/lib/actions/receipts'
import { senaDelTurno, type SenaDelTurno } from '@/lib/actions/senas-cobro'

/** Las cuentas de cobro: "no se pudieron traer" no es lo mismo que "no hay". */
type EstadoCuentas =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; cuentas: TransferAccountState[] }

const SIN_CUENTAS: TransferAccountState[] = []

/**
 * Los servicios de la sucursal, partidos en las dos listas del cobro. Igual que
 * las cuentas: "no se pudieron traer" no es lo mismo que "no hay". La lista
 * vacía ante un error dejaba el cobro sin nada que elegir y sin decir por qué.
 */
type EstadoServicios =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'listo'; branchId: string; principales: Service[]; extras: Service[] }

const SIN_SERVICIOS: Service[] = []

/** Hasta cuántos servicios principales se muestran como botones; con más, un desplegable. */
const MAX_CHIPS_PRINCIPALES = 6

/**
 * El texto con el que `completeService` rechaza una asesoría sin servicio (paso
 * 0'). Si llega, el diálogo pasa a modo asesoría aunque la superficie que lo
 * abrió no haya traído `pidio_asesoria`: el servidor manda. La señal es el
 * `codigo` 'asesoria_sin_servicio'; el texto queda como respaldo.
 */
const ERROR_ASESORIA_SIN_SERVICIO = 'Elegí qué le hiciste o cerralo como solo asesoría.'

const NOMBRE_DEL_METODO: Record<PaymentMethod, string> = {
  cash: 'efectivo',
  card: 'tarjeta',
  transfer: 'transferencia',
}

/**
 * Opciones del aviso de un cobro cuyo importe NO quedó guardado: no se va solo
 * y se cierra con «Entendido». Que tenga acción no es decorativo: la recarga
 * por versión no recarga la pantalla mientras haya un aviso con acción a la
 * vista (src/lib/recarga-version.ts), así que nadie lo pierde sin haberlo leído.
 */
function avisoDeImporte(entradaId: string) {
  return {
    id: `cobro-sin-importe-${entradaId}`,
    duration: Infinity,
    action: { label: 'Entendido', onClick: () => {} },
  }
}

/**
 * Cómo terminó el diálogo, para que cada superficie diga lo que corresponde:
 * `/dashboard/fila` anuncia «Corte finalizado» y no lo puede decir de una
 * asesoría cerrada sin cobro, de un cobro que ya estaba registrado ni de uno
 * cuyo importe no quedó guardado (el diálogo ya avisó en los tres casos). Ver
 * `hayQueAnunciarCobro`. El argumento es opcional para el que llama: las
 * superficies que sólo refrescan lo ignoran.
 */
export type ResultadoDelCobro =
  /**
   * `yaRegistrado`: el servidor devolvió `alreadyCompleted` (reintento, otra tablet).
   * `sinImporte`: la entrada se cerró pero el importe no quedó en la visita
   * (`visitaWarning` o el rechazo `visita_sin_importe`): el diálogo ya lo dijo
   * con un error que no se va solo.
   */
  | { tipo: 'cobro'; yaRegistrado: boolean; sinImporte?: boolean }
  /** Se cerró como «solo asesoría»: sin visita, sin cobro. */
  | { tipo: 'solo_asesoria' }

/**
 * ¿La superficie que abrió el cobro tiene que anunciar «Servicio finalizado»?
 * Sólo de un cobro hecho ahora y que quedó bien: todo lo demás ya lo avisó el
 * diálogo, y un éxito al lado de ese aviso lo contradice.
 */
export function hayQueAnunciarCobro(resultado?: ResultadoDelCobro): boolean {
  if (!resultado) return true
  return resultado.tipo === 'cobro' && !resultado.yaRegistrado && !resultado.sinImporte
}

/**
 * Una server action del cobro falló porque esta pantalla quedó con el bundle
 * de un deploy anterior (seguridad-y-despliegue-01): reintentar no sirve. Avisa
 * y recarga (src/lib/recarga-version.ts) y devuelve true; el que llama no
 * muestra su propio error. false = no era eso.
 */
function recargarSiEsVersion(e: unknown): boolean {
  if (!esErrorDeVersion(e)) return false
  // Con id: al abrir el cobro fallan varias acciones juntas y alcanza un aviso.
  if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
  return true
}

/*
 * El tema de la pantalla donde se dibuja el cobro, para el tono del sello de
 * asesoría. El diálogo se usa en el panel del barbero (claro: `barber-theme-root`
 * en <html>, que es lo que también pinta los portales) y en el dashboard
 * (oscuro). No sirve `dark:`: la app nunca pone la clase `.dark`, el oscuro es
 * el default de `:root`.
 */
function suscribirTema(aviso: () => void): () => void {
  const observador = new MutationObserver(aviso)
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observador.disconnect()
}
const temaDelDocumento = (): TonoAsesoriaBadge =>
  document.documentElement.classList.contains('barber-theme-root') ? 'claro' : 'oscuro'
const temaDelServidor = (): TonoAsesoriaBadge => 'oscuro'

interface CompleteServiceDialogProps {
  entry: QueueEntry | null
  branchId: string
  onClose: () => void
  /**
   * Se llama cuando la entrada quedó cerrada: cobrada (o ya cobrada antes) o
   * cerrada como «solo asesoría». Después siempre viene `onClose`.
   */
  onCompleted?: (resultado?: ResultadoDelCobro) => void
  /**
   * Categorías del programa de fidelización (`loyalty_tiers` de la org), para el
   * chip "Oro · 7 visitas recientes" del encabezado. Opcional: las superficies que
   * no las cargan simplemente no muestran el chip.
   */
  tiers?: LoyaltyTierLite[] | null
  /**
   * En el panel del barbero, el staff de la sesión: «Cerrar como solo asesoría»
   * se ofrece sólo si la entrada es suya, que es lo único que el servidor le
   * acepta a la cookie del panel. El dashboard no lo pasa.
   */
  staffIdDelPanel?: string | null
}

export function CompleteServiceDialog({
  entry,
  branchId,
  onClose,
  onCompleted,
  tiers,
  staffIdDelPanel = null,
}: CompleteServiceDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  // Claro en el panel del barbero, oscuro en el dashboard (ver suscribirTema).
  const tono = useSyncExternalStore(suscribirTema, temaDelDocumento, temaDelServidor)

  // Servicios activos de la sucursal (una sola lectura, dos listas):
  //  · principales = availability 'checkin' | 'both' — lo que se elige como el
  //    corte. Antes el desplegable traía 'upsell' | 'both', y en Caseros y
  //    Paraná —donde TODOS los principales son 'checkin'— el barbero no podía
  //    cargar «Corte» (bug del 13/6): sólo le aparecía la barba adicional.
  //  · extras = availability 'upsell' | 'both' — lo que se suma al principal.
  const [catalogo, setCatalogo] = useState<EstadoServicios>({ tipo: 'cargando' })
  const [intentoServicios, setIntentoServicios] = useState(0)
  // Una lista de OTRA sucursal (el cobro anterior) no se ofrece ni un instante.
  const catalogoListo = catalogo.tipo === 'listo' && catalogo.branchId === branchId ? catalogo : null
  const services = catalogoListo?.extras ?? SIN_SERVICIOS
  const principales = catalogoListo?.principales ?? SIN_SERVICIOS
  // Servicio principal pre-seleccionado, traído por id sin filtros (ver effect).
  const [preselectedService, setPreselectedService] = useState<Service | null>(null)
  // Asesoría (mig 217) detectada por el rechazo del servidor cuando la entrada
  // que recibió el diálogo no traía `pidio_asesoria` (ver ERROR_ASESORIA_SIN_SERVICIO).
  // Guarda el id de la entrada: si el diálogo pasa a otro cliente, no se hereda.
  const [asesoriaPorServidorDe, setAsesoriaPorServidorDe] = useState<string | null>(null)
  // «No se hizo nada · Cerrar como solo asesoría»: de qué entrada está abierta la
  // confirmación (mismo motivo) y si el cierre está en vuelo.
  const [confirmarSoloAsesoriaDe, setConfirmarSoloAsesoriaDe] = useState<string | null>(null)
  const [cerrandoAsesoria, setCerrandoAsesoria] = useState(false)
  // Cuántas fotos de ESTE cobro se descartarían al cerrarlo como solo asesoría
  // (store global; las que fallaron nunca se guardaron). El selector devuelve un
  // número: el diálogo no se vuelve a dibujar con cada 5 % de progreso de subida.
  const fotosADescartar = useFotosCorteStore((s) => {
    const fotos = entry ? s.cobros[entry.id]?.fotos : undefined
    if (!fotos) return 0
    let n = 0
    for (const f of fotos) if (f.estado !== 'error') n++
    return n
  })
  // Productos de la sucursal por server action, con sus estados (cargando /
  // error / vacío / listo). Antes era una lectura con la anon key que fallaba
  // desde el 4/9/2026 y se tragaba: la sección ni se dibujaba.
  const productos = useProductosDeSucursal(branchId, !!entry)
  // Cuentas de cobro: "no se pudieron traer" no es lo mismo que "no hay". Con
  // la lista vacía ante un error, la transferencia se registraba sin cuenta.
  const [cuentas, setCuentas] = useState<EstadoCuentas>({ tipo: 'cargando' })
  const [intentoCuentas, setIntentoCuentas] = useState(0)
  const paymentAccounts = cuentas.tipo === 'listo' ? cuentas.cuentas : SIN_CUENTAS
  // Cuentas que el sistema salteó por haber llegado a su tope del mes, y si NO quedó
  // ninguna con margen (ahí el cobro sigue, pero hay que avisar).
  const [rotatedFrom, setRotatedFrom] = useState<TransferAccountState[]>([])
  const [allAccountsFull, setAllAccountsFull] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)

  // Step 1 — service details
  const [selectedService, setSelectedService] = useState<string>('')
  const [extraServices, setExtraServices] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<{ id: string, quantity: number }[]>([])
  // Las fotos del corte viven en el store global (fotos-corte-store): se suben
  // solas y siguen subiendo aunque el diálogo se cierre con el cobro.
  const [clientNotes, setClientNotes] = useState('')
  const [originalClientNotes, setOriginalClientNotes] = useState('')

  // Step 2 — payment
  const [selectedPayment, setSelectedPayment] = useState<PaymentOptionValue | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [tipAmount, setTipAmount] = useState<number>(0)
  const [tipMethod, setTipMethod] = useState<PaymentMethod | null>(null)
  const [barberNote, setBarberNote] = useState<string>('')

  // Beneficio (cupón de la app o invitación de un amigo): validado pero todavía no
  // consumido; se consume/aplica al cobrar. Uno solo por cobro.
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponScanOpen, setCouponScanOpen] = useState(false)

  // Resultado del programa de fidelización tras el cobro (tarjeta a pantalla completa).
  // Va a un store GLOBAL (`LoyaltyResultHost` en los layouts): varias superficies
  // desmontan este diálogo apenas termina el cobro y una tarjeta local moría con él.
  const showLoyaltyResult = useLoyaltyResultStore((s) => s.show)

  // Comprobante de transferencia (mig 157)
  const [receiptSettings, setReceiptSettings] = useState<TransferReceiptSettingsView | null>(null)
  const [receiptScan, setReceiptScan] = useState<ReceiptScanResult | null>(null)
  const [scanOpen, setScanOpen] = useState(false)

  // Cobro conjunto (mig 164): una transferencia paga varios cortes.
  //  • scanAsGroup: el barbero que RECIBIÓ la transferencia escanea el comprobante-ancla.
  //  • jointCovering: el 2º barbero cuelga su corte de un ancla ya existente (sin escanear).
  const [scanAsGroup, setScanAsGroup] = useState(false)
  const [jointMode, setJointMode] = useState(false)
  const [jointOptions, setJointOptions] = useState<OpenJointReceipt[]>([])
  const [jointLoading, setJointLoading] = useState(false)
  const [jointCovering, setJointCovering] = useState<OpenJointReceipt | null>(null)
  // Seña ya pagada por Mercado Pago (mig 207). Si esto no se muestra, el barbero
  // cobra el total y el cliente termina pagando 150% del servicio.
  const [sena, setSena] = useState<SenaDelTurno | null>(null)
  // No pudimos leer la seña de un turno. NO es lo mismo que "no tiene seña":
  // sin el dato, el número grande de esta pantalla puede estar de más y el
  // barbero no tiene forma de saberlo. Se dice, con un botón para reintentar.
  const [senaError, setSenaError] = useState(false)
  const [senaCargando, setSenaCargando] = useState(false)
  // Turno cuya seña se está pidiendo. Una respuesta que llega tarde, después de
  // que el diálogo pasó a otro cliente, no puede pisar el estado del actual:
  // sería la seña de otra persona descontada de este cobro.
  const senaPedidaRef = useRef<string | null>(null)

  const cargarSena = useCallback((appointmentId: string) => {
    senaPedidaRef.current = appointmentId
    setSenaCargando(true)
    setSenaError(false)
    senaDelTurno(appointmentId, branchId)
      .then(({ sena: s, error }) => {
        if (senaPedidaRef.current !== appointmentId) return
        // `error` distingue "no tiene seña" de "no pudimos leerla". Antes la
        // action devolvía `null` para las dos cosas y un fallo de base se
        // pintaba como "sin seña": el barbero cobraba el total a alguien que
        // ya había pagado la mitad.
        if (error) {
          console.error('[senaDelTurno]', error)
          setSena(null)
          setSenaError(true)
          return
        }
        setSena(s)
        setSenaError(false)
      })
      .catch((e) => {
        // Un corte de red rechaza la promesa del server action. Sin este catch
        // quedaba una promesa sin manejar y el cobro seguía como si el turno no
        // tuviera seña: el cliente pagaba dos veces la misma mitad.
        if (senaPedidaRef.current !== appointmentId) return
        console.error('[senaDelTurno]', e)
        setSena(null)
        setSenaError(true)
        // Con el bundle de un deploy anterior tampoco va a cobrar: mejor
        // recargar ahora, antes de que el barbero cargue todo el cobro.
        recargarSiEsVersion(e)
      })
      .finally(() => {
        if (senaPedidaRef.current !== appointmentId) return
        setSenaCargando(false)
      })
  }, [branchId])

  useEffect(() => {
    if (!entry) {
      setStep(1)
      setSelectedPayment(null)
      setSelectedService('')
      setPreselectedService(null)
      setExtraServices([])
      setSelectedProducts([])
      setClientNotes('')
      setOriginalClientNotes('')
      setSelectedAccountId('')
      setTipAmount(0)
      setTipMethod(null)
      setBarberNote('')
      setAppliedCoupon(null)
      setCouponScanOpen(false)
      setReceiptScan(null)
      setScanOpen(false)
      setScanAsGroup(false)
      setJointMode(false)
      setJointOptions([])
      setJointCovering(null)
      setSena(null)
      setSenaError(false)
      setSenaCargando(false)
      senaPedidaRef.current = null
      // Sin cuentas viejas a la vista: el próximo cobro puede ser de otra sucursal.
      setCuentas({ tipo: 'cargando' })
      setRotatedFrom([])
      setAllAccountsFull(false)
      // Ni servicios ni estado de asesoría del cobro anterior.
      setCatalogo({ tipo: 'cargando' })
      setAsesoriaPorServidorDe(null)
      setConfirmarSoloAsesoriaDe(null)
      setCerrandoAsesoria(false)
      return
    }

    if (entry.service_id) {
      setSelectedService(entry.service_id)
      // Según la superficie que abre el diálogo, entry.service puede no venir
      // joineado (la fila del dashboard no lo trae), y el servicio puede no estar en
      // las listas de abajo (se dio de baja o cambió de disponibilidad después del
      // check-in). Lo buscamos por id —sin filtrar availability/is_active— para
      // resolver SIEMPRE su precio; si no, el corte se mostraba como "$0" (bug del
      // 13/6, visible en las sucursales cuyos principales son 'checkin', ej. Caseros).
      supabase
        .from('services')
        .select('*')
        .eq('id', entry.service_id)
        .maybeSingle()
        .then(({ data }) => { if (data) setPreselectedService(data as Service) })
    } else {
      setPreselectedService(null)
    }

    getTransferReceiptSettings()
      .then(setReceiptSettings)
      .catch((e: unknown) => {
        // Sin esto quedaba una promesa sin manejar. Sin la configuración, el
        // comprobante no se exige (lo mismo que hace el servidor si no la lee).
        console.error('[CompleteServiceDialog] configuración de comprobantes', e)
        recargarSiEsVersion(e)
      })

    if (entry.client_id) {
      supabase
        .from('clients')
        .select('notes')
        .eq('id', entry.client_id)
        .single()
        .then(({ data }) => {
          const n = data?.notes ?? ''
          setClientNotes(n)
          setOriginalClientNotes(n)
        })
    }

    // (Los servicios los pide su propio efecto, más abajo.)
    // (Los productos los pide useProductosDeSucursal al abrir el cobro.)

    // (Las cuentas de cobro las pide su propio efecto, más abajo.)
    // La seña se busca por el turno del que salió esta entrada de fila. Un
    // walk-in no tiene turno y por lo tanto no puede tener seña.
    if (entry.appointment_id) {
      cargarSena(entry.appointment_id)
    } else {
      senaPedidaRef.current = null
      setSena(null)
      setSenaError(false)
      setSenaCargando(false)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, branchId])

  // Cuentas de cobro con su acumulado REAL del mes (server action con service
  // role). Se piden al abrir el cobro: si la cuenta se llenó hace un minuto, el
  // barbero tiene que ver ya la siguiente. La rotación la decide
  // pickTransferAccount, la misma regla que muestra el dashboard.
  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!entryId) return
    let vigente = true
    queueMicrotask(() => {
      if (vigente) setCuentas((prev) => (prev.tipo === 'listo' ? prev : { tipo: 'cargando' }))
    })
    obtenerCuentasDeCobro(branchId)
      .then((r) => {
        if (!vigente) return
        if (!r.ok) {
          console.error('[CompleteServiceDialog] cuentas de cobro', r.error)
          setCuentas({ tipo: 'error', mensaje: r.error })
          return
        }
        setCuentas({ tipo: 'listo', cuentas: r.cuentas })
        const pick = pickTransferAccount(r.cuentas)
        setRotatedFrom(pick.skipped)
        setAllAccountsFull(pick.allFull)
        setSelectedAccountId(pick.account?.id ?? '')
      })
      .catch((e: unknown) => {
        // Un corte de red rechaza la promesa del server action: sin esto la
        // sección quedaba "cargando" y la transferencia salía sin cuenta.
        if (!vigente) return
        console.error('[CompleteServiceDialog] cuentas de cobro', e)
        setCuentas({ tipo: 'error', mensaje: 'No pudimos traer las cuentas de cobro.' })
        recargarSiEsVersion(e)
      })
    return () => {
      vigente = false
    }
  }, [entryId, branchId, intentoCuentas])

  // Servicios de la sucursal: los principales ('checkin' | 'both', con el mismo
  // criterio que la tablet de check-in) y los extras ('upsell' | 'both'). Una
  // sola lectura con la key pública (los servicios activos son de lectura
  // pública: el panel no tiene sesión de Supabase). Lo que se elige acá es lo que
  // se cobra: `completeService` recalcula el importe por id en el servidor.
  useEffect(() => {
    if (!entryId) return
    let vigente = true
    queueMicrotask(() => {
      if (vigente) setCatalogo((prev) => (prev.tipo === 'listo' && prev.branchId === branchId ? prev : { tipo: 'cargando' }))
    })
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .in('availability', ['checkin', 'both', 'upsell'])
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order('name')
      .then(
        ({ data, error }) => {
          if (!vigente) return
          if (error) {
            console.error('[CompleteServiceDialog] servicios', error.message)
            setCatalogo({ tipo: 'error' })
            return
          }
          const lista = (data ?? []) as Service[]
          setCatalogo({
            tipo: 'listo',
            branchId,
            principales: lista.filter((s) => s.availability === 'checkin' || s.availability === 'both'),
            extras: lista.filter((s) => s.availability === 'upsell' || s.availability === 'both'),
          })
        },
        (e: unknown) => {
          if (!vigente) return
          console.error('[CompleteServiceDialog] servicios', e)
          setCatalogo({ tipo: 'error' })
        },
      )
    return () => {
      vigente = false
    }
  }, [entryId, branchId, intentoServicios, supabase])

  // Cobro conjunto — el 2º barbero carga las transferencias-ancla abiertas de la sucursal.
  async function loadJointOptions() {
    setJointLoading(true)
    try {
      const opts = await getOpenJointReceipts(branchId)
      setJointOptions(opts)
      // El estado vacío se comunica inline en el picker (no disparamos toast: se apilaba
      // al refrescar y duplicaba el mensaje ya visible).
    } catch (e) {
      // Sin esto el picker quedaba en «Buscando transferencias…» para siempre.
      console.error('[CompleteServiceDialog] transferencias conjuntas', e)
      if (!recargarSiEsVersion(e)) {
        toast.error('No pudimos traer las transferencias conjuntas. Tocá «Actualizar» para reintentar.')
      }
    } finally {
      setJointLoading(false)
    }
  }

  function pickJointCovering(o: OpenJointReceipt) {
    // El comprobante-ancla tiene que alcanzar para cubrir este corte.
    if (o.remaining + 1 < chargeAmount) {
      toast.error(`Ese comprobante ya casi no tiene saldo (quedan ${formatCurrency(o.remaining)}). No alcanza para este corte.`)
      return
    }
    setReceiptScan(null)
    setJointCovering(o)
    setJointMode(false)
  }

  /**
   * Las notas del cliente, si el barbero las cambió. Son del CLIENTE y no del
   * corte: se guardan también cuando el cobro ya estaba registrado o cuando el
   * importe no quedó. Nunca lanza: el cobro ya está hecho.
   */
  async function guardarNotasDelCliente(clienteId: string | null) {
    if (!clienteId || clientNotes.trim() === originalClientNotes) return
    try {
      // Sin tercer argumento: el Instagram del cliente NO se toca. Antes se
      // mandaba '' y se lo borraba en cada cierre de servicio.
      const notas = await updateClientNotes(clienteId, clientNotes.trim())
      if (notas && 'error' in notas && notas.error) {
        toast.warning('Las notas del cliente no se guardaron', { description: notas.error, duration: 10000 })
      }
    } catch (e) {
      console.error('[CompleteServiceDialog] notas del cliente', e)
      toast.warning('Las notas del cliente no se guardaron', {
        description: 'Se cortó la conexión antes de guardarlas. El cobro quedó registrado igual.',
        duration: 10000,
      })
    }
  }

  async function finishService(receiptForLink?: ReceiptScanResult | null) {
    if (!entry || !selectedPayment || loading || cerrandoAsesoria) return
    // Una asesoría se cobra con el servicio principal que se le hizo (el
    // servidor lo rechaza igual, paso 0' de completeService).
    if (faltaServicioAsesoria) {
      toast.error(ERROR_ASESORIA_SIN_SERVICIO)
      setStep(1)
      return
    }
    // El escaneo del comprobante llama acá directo (no pasa por el botón
    // deshabilitado): sin saber a qué cuenta entra la transferencia, no se cobra.
    if (faltaCuenta) {
      toast.error('Falta la cuenta de cobro: reintentá traer las cuentas o cobrá por otro medio.')
      return
    }
    setLoading(true)

    // Se captura acá y se muestra recién al final: si se montara apenas vuelve
    // completeService, la tarjeta arrancaría su temporizador debajo del modal
    // mientras siguen las fotos, el comprobante y las notas.
    let loyaltyToShow: { result: LoyaltyFinalizeResult; clientName: string | null } | null = null

    // 1) El cobro. Si la llamada no vuelve (corte de red, la tablet sin wifi) el
    //    diálogo queda ABIERTO con todo lo cargado. Antes se cerraba con «Error al
    //    finalizar el servicio» y el barbero no sabía si había cobrado ni tenía
    //    cómo reintentar sin volver a cargar todo. Reintentar es seguro: si la
    //    primera llamada sí cerró el corte, el servidor devuelve `alreadyCompleted`
    //    sin volver a cobrar.
    let result: Awaited<ReturnType<typeof completeService>>
    try {
      result = await completeService(
        entry.id,
        selectedPayment,
        servicioElegido || undefined,
        // La cuenta va SÓLO con transferencia. Antes se mandaba la preseleccionada
        // con cualquier método: en 60 días, 1.442 cobros en efectivo o tarjeta
        // quedaron imputados a una cuenta bancaria.
        selectedPayment === 'transfer' ? (selectedAccountId || null) : null,
        extrasElegidos.length > 0 ? extrasElegidos : undefined,
        // Sólo los productos que siguen en la lista: lo que se manda es lo que
        // el barbero ve sumado en pantalla.
        lineasDeProductos.length > 0 ? lineasDeProductos : undefined,
        tipAmount,
        tipAmount > 0 ? (tipMethod ?? selectedPayment) : null,
        barberNote.trim() || null,
        // No mandamos el cupón si no aplica (sin servicio para descontar, o premio
        // acotado a un servicio que no está en el cobro): así el chip oculto y el
        // valor transmitido nunca divergen, y el beneficio no se consume ni dispara el
        // `wrong_service` tardío de la RPC después de haberle dicho el precio al cliente.
        (!canUseCoupon || !couponServiceOk) ? null : (appliedCoupon?.qrCode ?? null),
        // Cobro conjunto: si este corte se cuelga de otro pago, mandamos el comprobante-ancla.
        jointCovering?.id ?? null,
      )
    } catch (e) {
      console.error('[CompleteServiceDialog] completeService', e)
      setLoading(false)
      // Deploy nuevo con esta pantalla en el bundle anterior: la acción ya no
      // existe en el servidor, así que el cobro NO se registró y reintentar no
      // sirve. Se avisa y se recarga (seguridad-y-despliegue-01).
      if (recargarSiEsVersion(e)) return
      toast.error('No pudimos confirmar el cobro', {
        description: 'Revisá la conexión y volvé a tocar Cobrar: si ya se había registrado, no se cobra dos veces.',
        duration: 12000,
      })
      return
    }

    // 2) El servidor lo rechazó. Salvo `visita_sin_importe`, sin tocar nada: el
    //    diálogo sigue abierto y se reintenta. La reacción va por el `codigo`, no
    //    por comparar el texto.
    if ('error' in result) {
      const codigo: CodigoRechazoCobro | undefined = 'codigo' in result ? result.codigo : undefined

      if (codigo === 'visita_sin_importe') {
        // La entrada YA se cerró pero el importe no quedó en la visita: reintentar
        // sólo devolvería «ya estaba cobrado». Se cierra el diálogo con un error
        // que no se va solo, porque sólo el encargado lo puede corregir.
        toast.error(result.error, avisoDeImporte(entry.id))
        // Las fotos no quedaron atadas a la visita (el servidor cortó antes): el
        // aviso de fotos ofrece Reintentar, que las ata a la visita de esta
        // entrada. Sin fotos en esta tablet, el cobro de fotos sólo se suelta.
        const hayFotos = (useFotosCorteStore.getState().cobros[entry.id]?.fotos.length ?? 0) > 0
        cerrarCobroFotos(entry.id, {
          visitId: null,
          clienteNombre: entry.client?.name ?? null,
          fotos: hayFotos ? { guardadas: 0, error: 'Tocá Reintentar para guardarlas.' } : null,
        })
        invalidarUltimosCortes(entry.client_id)
        await guardarNotasDelCliente(entry.client_id)
        onCompleted?.({ tipo: 'cobro', yaRegistrado: false, sinImporte: true })
        setLoading(false)
        onClose()
        return
      }

      toast.error(result.error)
      // Un producto elegido se dio de baja o cambió de sucursal: se recarga la
      // lista —el que ya no está deja de sumarse— y se vuelve a los productos.
      if ('productosDesactualizados' in result && result.productosDesactualizados) {
        productos.reintentar()
        setStep(1)
      }
      // Pidió asesoría y la superficie que abrió el cobro no lo sabía: se pasa a
      // modo asesoría (servicio principal obligatorio + «Cerrar como solo asesoría»).
      if (codigo === 'asesoria_sin_servicio' || result.error === ERROR_ASESORIA_SIN_SERVICIO) {
        setAsesoriaPorServidorDe(entry.id)
        setStep(1)
      }
      // La sucursal tiene cuentas y la transferencia iba sin ninguna, o con una
      // que no es de esta sucursal (la lista quedó vieja): se vuelven a pedir y la
      // rotación elige de nuevo, con el cobro abierto.
      if (codigo === 'falta_cuenta' || codigo === 'cuenta_invalida') {
        setIntentoCuentas((n) => n + 1)
      }
      // Un servicio elegido no existe, es de otra sucursal o se dio de baja: se
      // recarga la lista (el que ya no está deja de mandarse) y se vuelve a elegir.
      if (codigo === 'servicio_invalido') {
        setIntentoServicios((n) => n + 1)
        setStep(1)
      }
      // `lectura`: no se pudo leer un dato y la entrada quedó intacta; el toast
      // lo dice y Cobrar sigue disponible para reintentar.
      setLoading(false)
      return
    }

    // 3) El cobro quedó registrado. Nada de lo que sigue lo deshace: si algo
    //    falla se avisa, pero la entrada ya está cerrada y el diálogo se cierra.
    const yaRegistrado = 'alreadyCompleted' in result && result.alreadyCompleted === true
    // El cobro que ya estaba (reintento, otro dispositivo): cómo y por cuánto
    // quedó registrado. null = no se pudo leer.
    const metodoCrudo: string | null = 'alreadyCompleted' in result ? result.paymentMethod : null
    const metodoPrevio: PaymentMethod | null =
      metodoCrudo === 'cash' || metodoCrudo === 'card' || metodoCrudo === 'transfer' ? metodoCrudo : null
    const montoPrevio = 'alreadyCompleted' in result ? result.amount : null
    const visitaWarning = 'visitaWarning' in result ? result.visitaWarning : null
    const scanForLink = receiptForLink ?? receiptScan
    // El comprobante escaneado acá se cuelga de una visita que cobró OTRO pedido
    // sólo si esa visita es por transferencia y este diálogo también cobraba por
    // transferencia (hallazgo asesoria-07). Si no, queda suelto en
    // /dashboard/comprobantes: es justo la señal del doble cobro, y colgado de
    // una visita en efectivo desaparecía de la conciliación.
    const comprobanteAjeno = yaRegistrado && !(metodoPrevio === 'transfer' && selectedPayment === 'transfer')
    try {
      // Reintento sobre un cobro que ya estaba hecho (doble toque, la respuesta
      // anterior se perdió, otro dispositivo): se dice en vez de cerrar callado.
      if (yaRegistrado) {
        const nombreMetodoPrevio = metodoPrevio ? NOMBRE_DEL_METODO[metodoPrevio] : null
        const otroMetodo = nombreMetodoPrevio !== null && metodoPrevio !== selectedPayment
        const comprobanteSuelto = comprobanteAjeno && !!scanForLink?.receiptId
        if (!otroMetodo && !comprobanteSuelto) {
          toast.info('Este cobro ya se había registrado', {
            description: 'No se volvió a cobrar: queda el registro anterior.',
          })
        } else {
          toast.warning(
            otroMetodo
              ? `Este corte ya lo había cobrado otro dispositivo (${nombreMetodoPrevio})`
              : 'Este corte ya estaba cobrado',
            {
              description: [
                'No se volvió a cobrar: queda ese registro.',
                comprobanteSuelto ? 'El comprobante queda suelto para conciliar en Comprobantes.' : null,
                otroMetodo ? 'Si el cliente te pagó a vos, avisale al encargado.' : null,
              ]
                .filter(Boolean)
                .join(' '),
              duration: 12000,
            },
          )
        }
        // Una visita en $0 para un cobro que valía algo: el importe se perdió
        // en la primera llamada (ver `visitaWarning`). Sólo el encargado lo carga.
        if (montoPrevio === 0 && totalAfterDiscount > 0) {
          toast.error('Ese cobro quedó registrado en $0', {
            ...avisoDeImporte(entry.id),
            description: 'Si no fue un servicio gratis, avisale al encargado para que cargue el importe en el historial.',
          })
        }
      }

      // La entrada se cerró pero el importe no quedó en la visita (el UPDATE
      // falló dos veces): el corte está en $0 y sólo el encargado lo corrige.
      // Error que no se va solo: es plata y no puede pasar de largo.
      if (visitaWarning) {
        toast.error(visitaWarning, avisoDeImporte(entry.id))
      }

      // Aviso de beneficio: si el canje falló al confirmar (ya usado / vencido / carrera),
      // se cobró a precio lleno. Si se aplicó, confirmamos qué pasó: entrega de merch,
      // invitación de un amigo, o descuento.
      if ('couponWarning' in result && result.couponWarning) {
        toast.warning(result.couponWarning)
      } else if ('couponDelivered' in result && result.couponDelivered) {
        toast.success(`Entregado: ${result.couponDelivered}`)
      } else if ('referralApplied' in result && result.referralApplied) {
        const quien = result.referralApplied.referrerFirstName ?? 'un amigo'
        toast.success(`Invitación de ${quien} aplicada: −${formatCurrency(result.referralApplied.discountAmount)}`)
      } else if ('couponApplied' in result && result.couponApplied) {
        toast.success(`Beneficio aplicado: ${formatCurrency(result.couponDiscountAmount ?? 0)} de descuento`)
      }

      // Programa de fidelización: resultado VISIBLE (puntos, categoría, cambio) para
      // que el barbero se lo diga al cliente. Sólo si el programa está habilitado.
      if ('loyalty' in result && result.loyalty?.enabled) {
        loyaltyToShow = { result: result.loyalty, clientName: entry.client?.name ?? null }
      }

      // Aviso de cobro conjunto: si el guard de cobertura rechazó el cuelgue (el comprobante
      // ya no alcanzaba), el corte quedó como transfer normal y hay que respaldarlo aparte.
      if ('jointWarning' in result && result.jointWarning) {
        toast.warning(result.jointWarning)
      }

      // La seña quedó por encima del precio final (un premio o cupón se aplicó
      // sobre un turno ya señado): el mostrador cobró $0 y el cliente tiene
      // saldo a favor. Va con duración larga porque es plata de otro y el
      // barbero tiene que poder leerlo entero antes de llamar al siguiente.
      if ('senaWarning' in result && result.senaWarning) {
        toast.warning(result.senaWarning, { duration: 12000 })
      }

      // Los productos se cobraron (el importe está en la visita) pero algo no
      // quedó registrado: el detalle, el stock o la comisión del día. Largo por
      // la misma razón: el barbero tiene que poder leerlo entero.
      if ('productWarning' in result && result.productWarning) {
        toast.warning(result.productWarning, { duration: 15000 })
      }

      // Fotos del corte: el servidor ya las ató a la visita adentro de
      // completeService (también en el reintento idempotente). Las que siguen
      // subiendo terminan solas desde el store global, con su aviso: el
      // diálogo se cierra YA, la plata nunca espera a las fotos.
      cerrarCobroFotos(entry.id, {
        visitId: result.visitId ?? null,
        clienteNombre: entry.client?.name ?? null,
        fotos: 'fotos' in result ? result.fotos : null,
      })
      invalidarUltimosCortes(entry.client_id)

      // Vincular el comprobante de transferencia escaneado a la visita del cobro.
      if (result.visitId && scanForLink?.receiptId && !comprobanteAjeno) {
        const vinculo = await linkReceiptToVisit(scanForLink.receiptId, result.visitId)
        if ('error' in vinculo) {
          toast.warning('El comprobante no quedó vinculado al cobro', {
            description: 'El cobro se registró bien. Avisale al encargado para conciliarlo en Comprobantes.',
            duration: 12000,
          })
        }
      }
    } catch (e) {
      // El vínculo del comprobante no volvió (corte de red, o el sistema se
      // actualizó en el medio). El cobro YA está registrado: decir «error al
      // finalizar» haría que el barbero lo cobre de nuevo.
      console.error('[CompleteServiceDialog] después del cobro', e)
      toast.warning('El cobro quedó registrado', {
        description: esErrorDeVersion(e)
          ? 'Pero el sistema se actualizó en el medio: revisá en Comprobantes que el comprobante haya quedado vinculado.'
          : 'Pero se cortó la conexión antes de terminar: revisá en Comprobantes que el comprobante haya quedado vinculado.',
        duration: 12000,
      })
    }

    await guardarNotasDelCliente(entry.client_id)

    onCompleted?.({ tipo: 'cobro', yaRegistrado, sinImporte: !!visitaWarning })
    setLoading(false)
    // La tarjeta se muestra recién cuando el cobro cerró del todo, en el mismo
    // batch en que se cierra el diálogo: el temporizador arranca con el barbero
    // mirándola y la X responde desde el primer frame. Va fuera del try a
    // propósito: si algo de lo posterior al cobro falló, los puntos igual se
    // acreditaron.
    if (loyaltyToShow) showLoyaltyResult(loyaltyToShow.result, loyaltyToShow.clientName)
    onClose()
  }

  /**
   * «No se hizo nada · Cerrar como solo asesoría» (mig 217): la entrada se cierra
   * SIN visita (no cuenta como corte, ni visita, ni abandono). Ante un error el
   * diálogo de cobro queda abierto.
   */
  async function cerrarComoSoloAsesoria() {
    if (!entry || loading || cerrandoAsesoria) return
    const entradaId = entry.id
    setCerrandoAsesoria(true)
    let r: Awaited<ReturnType<typeof cerrarSoloAsesoria>>
    try {
      r = await cerrarSoloAsesoria(entradaId)
    } catch (e) {
      console.error('[CompleteServiceDialog] cerrarSoloAsesoria', e)
      setCerrandoAsesoria(false)
      setConfirmarSoloAsesoriaDe(null)
      if (!recargarSiEsVersion(e)) {
        toast.error('No pudimos cerrar la asesoría. Revisá la conexión y probá de nuevo.')
      }
      return
    }
    setCerrandoAsesoria(false)
    setConfirmarSoloAsesoriaDe(null)

    if ('error' in r) {
      toast.error(r.error)
      return
    }

    // Las fotos de este corte no van a ninguna ficha: lo que sube se cancela y
    // lo registrado se borra, también lo que subió el celular (un solo pedido;
    // si falla, UN aviso con Reintentar). El servidor ya intentó borrarlas al
    // cerrar; su `aviso` no se muestra porque esto lo reintenta y avisa sólo si
    // vuelve a fallar: serían dos avisos por lo mismo, y uno quizás ya resuelto.
    if (r.aviso) console.warn('[CompleteServiceDialog] cerrarSoloAsesoria con aviso (lo reintenta descartarFotosDelCobro):', r.aviso)
    void descartarFotosDelCobro(entradaId)

    vibrate(12)
    toast.success('Asesoría cerrada sin cobro', {
      description: r.yaCerrada
        ? 'Ya se había cerrado desde otro dispositivo.'
        : r.breakAutoStarted
          ? 'Arrancó el descanso que estaba pendiente.'
          : undefined,
    })
    onCompleted?.({ tipo: 'solo_asesoria' })
    onClose()
  }

  // Opciones del principal: los de la sucursal y, si la entrada trae uno que ya
  // no está en la lista (dado de baja, cambió de disponibilidad), ése también:
  // lo que vino preseleccionado tiene que verse elegido.
  const preseleccionado = entry?.service_id ? (entry.service ?? preselectedService ?? null) : null
  const opcionesPrincipales =
    preseleccionado && !principales.some((s) => s.id === preseleccionado.id)
      ? [preseleccionado, ...principales]
      : principales

  // Lo elegido que SIGUE en las listas: es lo que se suma, lo que se manda y lo
  // que cuenta para la asesoría. Cuando el servidor rechaza un servicio (dado de
  // baja, de otra sucursal: `servicio_invalido`) se recarga el catálogo, y uno
  // que ya no está tiene que dejar de mandarse; si no, quedaba elegido sin verse
  // y cada reintento volvía a chocar contra el mismo rechazo.
  const servicioElegido =
    !!selectedService &&
    (selectedService === entry?.service_id || opcionesPrincipales.some((s) => s.id === selectedService))
      ? selectedService
      : ''
  const extrasElegidos = extraServices.filter((id) => services.some((s) => s.id === id))

  // Resolución del servicio principal, en orden de confiabilidad:
  //   1) entry.service joineado (si la superficie lo trajo)
  //   2) preselectedService traído por id (cualquier availability/estado)
  //   3) la lista de principales ('checkin' | 'both'): lo que se elige en el cobro
  //   4) la de extras ('upsell' | 'both'), por las dudas
  const mainService =
    (entry?.service_id && servicioElegido === entry.service_id
      ? (entry.service ?? preselectedService)
      : null)
    ?? principales.find((s) => s.id === servicioElegido)
    ?? services.find((s) => s.id === servicioElegido)

  const mainServicePrice = mainService?.price ?? 0

  const extrasPrice = extrasElegidos.reduce((total, id) => {
    return total + (services.find(s => s.id === id)?.price ?? 0)
  }, 0)

  // Sólo cuentan los productos que siguen en la lista (si un refresco sacó uno
  // elegido, deja de sumarse y de mandarse). Sumado en centavos enteros.
  const lineasDeProductos = lineasVigentes(productos.productos, selectedProducts)
  const productsPrice = totalDeLineas(productos.productos, lineasDeProductos)

  const totalPrice = mainServicePrice + extrasPrice + productsPrice

  // Descuento por beneficio: aplica SOLO al subtotal de servicios (no productos ni
  // propina), igual que el servidor (completeService usa serviceSubtotal). Para una
  // invitación es el % de referidos; para merch/especial es 0 (es una entrega).
  const serviceSubtotal = mainServicePrice + extrasPrice
  const couponPct = benefitDiscountPct(appliedCoupon)
  // Pre-check del servicio acotado (mismo guard `wrong_service` de la RPC): si el
  // premio es para Corte y el corte no está en el cobro, la previa no descuenta nada
  // y el bloque lo dice; el barbero vuelve con "Atrás" y agrega el servicio.
  // Servicios del cobro con nombre y precio: los HOMÓNIMOS de otra sucursal
  // cuentan como el mismo servicio (mig 205), así que el guard y la base del
  // descuento se resuelven contra el servicio local que matchea.
  // El principal va desde mainService (ya resuelto arriba) y PRIMERO en el array:
  // `services` sólo trae upsell/both, así que un principal 'checkin' nunca
  // aparecería vía services.find (falso ámbar y base equivocada vs la RPC), y el
  // orden espeja el ORDER BY (s2.id = v_visit.service_id) DESC de la mig 205:
  // ante homónimos gana el servicio principal, no un extra.
  const serviciosDelCobro = [
    ...(mainService
      ? [{ id: mainService.id, name: mainService.name, price: mainService.price != null ? Number(mainService.price) : null }]
      : []),
    ...extrasElegidos
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
      .map((s) => ({ id: s.id, name: s.name, price: s.price != null ? Number(s.price) : null })),
  ]
  const couponServiceOk = benefitAppliesToServices(appliedCoupon, servicioElegido || null, extrasElegidos, serviciosDelCobro)
  const servicioMatcheado = servicioQueMatcheaBeneficio(appliedCoupon, serviciosDelCobro)
  // Base del descuento: el precio del servicio local que matchea → el precio del
  // servicio del catálogo (mig 203) → el subtotal — idéntico a la RPC (mig 205).
  const couponDiscount = couponServiceOk
    ? benefitDiscountAmount(appliedCoupon, serviceSubtotal, servicioMatcheado?.price ?? null)
    : 0
  const totalAfterDiscount = Math.max(0, totalPrice - couponDiscount)

  // Seña: lo que el cliente ya pagó por Mercado Pago al reservar. NO se resta de
  // `visits.amount` —eso lo decide el servidor y ahí el importe sigue siendo el
  // precio completo, que es de donde salen comisión, puntos, ARCA y el ticket
  // promedio (mig 207)—; lo que cambia es lo que el barbero cobra EN EL
  // MOSTRADOR, y eso es lo único que esta pantalla tiene que decir.
  //
  // El tope con `min` no es defensivo por gusto: un beneficio que baje el total
  // por debajo de la seña dejaría el remanente en negativo, y es exactamente el
  // `GREATEST(..., 0)` que hace el trigger `fn_sync_transfer_log_from_visit` al
  // proyectar el ledger. Si acá diera otra cosa, la caja y el ledger dirían
  // números distintos sobre el mismo cobro.
  const senaPagada = sena?.monto ?? 0
  const senaAplicada = Math.min(senaPagada, totalAfterDiscount)
  const aCobrarAhora = Math.max(0, totalAfterDiscount - senaAplicada)
  // El beneficio se vincula a un cliente; sin cliente no se puede ofrecer.
  // El Prode terminó (jul-2026) y el escáner quedó apagado; desde el programa de
  // fidelización (mig 196/197, ago-2026) vuelve a estar prendido: por acá entran
  // los beneficios canjeados en la app y las invitaciones de un amigo.
  const COUPONS_ENABLED: boolean = true
  const canUseCoupon = COUPONS_ENABLED && !!entry?.client_id && serviceSubtotal > 0

  // Categoría del cliente (chip del encabezado). Sin categoría o sin tiers → nada.
  // `client_loyalty_state` tiene UNIQUE (client_id): PostgREST la embebe como
  // OBJETO y `loyalty?.[0]` daba siempre undefined (el chip nunca salía).
  const clientLoyalty = leerLoyaltyEmbed(entry?.client?.loyalty)
  const clientTier = findLoyaltyTier(tiers, clientLoyalty?.tier_code)

  // ── Asesoría sin costo (mig 217) ──────────────────────────────────────────
  // El cliente pidió que lo asesoren antes de empezar: al cobrar, elegir lo que
  // se le hizo es OBLIGATORIO (el servidor lo exige igual, paso 0' de
  // completeService) o se cierra como «solo asesoría», sin visita.
  const esAsesoria = entry?.pidio_asesoria === true || (!!entry && asesoriaPorServidorDe === entry.id)
  // El principal se elige en el cobro si la entrada no lo trae (para TODA
  // entrada sin servicio, no sólo las asesorías) o si es una asesoría aunque
  // traiga uno: lo que se cobra es lo que se le terminó haciendo.
  const servicioEditable = !!entry && (!entry.service_id || esAsesoria)
  // El mismo criterio que el guard del servidor (paso 0' y trigger de la mig
  // 221): hace falta el servicio PRINCIPAL. Los extras solos no alcanzan: una
  // «Barba (Adiciónalas)» de $4.000 no es lo que se cobra por el corte que se le
  // terminó haciendo.
  const faltaServicioAsesoria = esAsesoria && !servicioElegido
  // Las mismas condiciones que `cerrarSoloAsesoria`: en curso, sin turno (cancelar
  // una entrada de turno la pasa a no_show por trigger) y sin ser un descanso. En
  // el panel, además, sólo la entrada del barbero de la sesión: a otro el
  // servidor se lo rechaza.
  const puedeCerrarSoloAsesoria =
    !!entry &&
    esAsesoria &&
    !entry.appointment_id &&
    entry.status === 'in_progress' &&
    !entry.is_break &&
    (!staffIdDelPanel || entry.barber_id === staffIdDelPanel)
  const cargandoServicios = !catalogoListo && catalogo.tipo !== 'error'
  const errorServicios = catalogo.tipo === 'error'
  const nombreCliente = primerNombre(entry?.client?.name) ?? 'El cliente'
  // Con un cobro o un cierre en vuelo no se toca nada ni se sale del diálogo.
  const ocupado = loading || cerrandoAsesoria

  function elegirPrincipal(id: string) {
    vibrate(8)
    if (selectedService === id) {
      // Tocar el elegido lo saca, salvo en una asesoría: ahí el servicio es
      // obligatorio y quedarse sin ninguno sólo deja el cobro trabado.
      if (!esAsesoria) setSelectedService('')
      return
    }
    setSelectedService(id)
    // El que pasa a principal deja de sumarse como extra: se cobraba dos veces.
    setExtraServices((prev) => prev.filter((x) => x !== id))
  }

  // Cómo se lee el beneficio aplicado en el bloque verde/celeste.
  const benefitView = (() => {
    if (!appliedCoupon) return null
    if (appliedCoupon.kind === 'referral') {
      return {
        tone: 'referral' as const,
        title: `Invitación de ${appliedCoupon.referrerFirstName ?? 'un amigo'}`,
        detail: `${couponPct} % OFF · −${formatCurrency(couponDiscount)} en servicios`,
      }
    }
    if (appliedCoupon.rewardKind !== 'descuento') {
      return {
        tone: 'delivery' as const,
        title: `Entregar: ${appliedCoupon.rewardName ?? 'Beneficio'}`,
        detail: 'sin descuento',
      }
    }
    if (!couponServiceOk) {
      return {
        tone: 'mismatch' as const,
        title: appliedCoupon.rewardName ?? 'Beneficio',
        detail: `Es para ${appliedCoupon.serviceName ?? 'otro servicio'} · no aplica a los servicios elegidos`,
      }
    }
    const sobre = appliedCoupon.serviceName ? ` en ${appliedCoupon.serviceName}` : ' en servicios'
    return {
      tone: 'discount' as const,
      title: appliedCoupon.rewardName ?? 'Beneficio',
      detail: `${appliedCoupon.isFreeService ? 'Servicio gratis' : `${couponPct} % OFF`} · −${formatCurrency(couponDiscount)}${sobre}`,
    }
  })()

  // El estado de la lectura de la seña, en los DOS pasos y antes que cualquier
  // número: de él depende si el número que sigue está bien. "Todavía no sé" y
  // "no pude leer" son cosas distintas de "no tiene seña", y las tres terminan
  // en un importe distinto. El cobro NO se bloquea —una tablet sin señal tiene
  // que poder seguir cobrando—, pero nadie puede decir después que no se avisó.
  const avisoSena = !entry?.appointment_id ? null : senaCargando && !sena ? (
    // Mientras el dato viaja, el número grande todavía puede estar de más. Se
    // dice en una línea: no bloquea nada, pero el barbero sabe que falta un dato.
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      Verificando si este turno tiene seña…
    </p>
  ) : senaError ? (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">No pudimos verificar si este turno tiene seña</p>
        <p className="text-xs opacity-90">
          Si el cliente señó por Mercado Pago, cobrarle el total sería cobrarle de más. Reintentá antes de cerrar.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 border-amber-500/50"
        disabled={senaCargando}
        onClick={() => { if (entry?.appointment_id) cargarSena(entry.appointment_id) }}
      >
        {senaCargando
          ? <Loader2 className="size-4 animate-spin" />
          : <><RefreshCw className="mr-1.5 size-3.5" />Reintentar</>}
      </Button>
    </div>
  ) : null

  // La propina hereda el método del cobro salvo que el barbero elija otro
  // (TipSelector permite propina en efectivo aunque el servicio se cobre por transferencia).
  // El cliente sólo transfiere la propina si ésta también va por transferencia; si no, la
  // deja en mano y NO entra en el monto del comprobante ni en el alias.
  const effectiveTipMethod = tipAmount > 0 ? (tipMethod ?? selectedPayment) : null
  const tipViaTransfer = effectiveTipMethod === 'transfer'
  // Lo que el cliente transfiere ahora va NETO de la seña: el alias que ve y el
  // comprobante que escanea tienen que coincidir con la plata que se mueve.
  const transferAmount = aCobrarAhora + (tipViaTransfer ? tipAmount : 0)

  // Comprobante obligatorio al cobrar por transferencia (si la org lo activó). El monto
  // esperado del comprobante = exactamente lo que el cliente transfiere.
  const chargeAmount = transferAmount
  // Cobro conjunto: si este corte se cuelga de un pago que ya hizo otro (jointCovering),
  // NO exige comprobante propio → deja de estar bloqueado. El respaldo es el comprobante-ancla.
  const isJointCovered = !!jointCovering
  // El comprobante-ancla elegido puede quedar corto si el monto crece DESPUÉS de elegirlo
  // (agregar un servicio/producto desde "Atrás", o sumar propina por transferencia). Lo
  // re-chequeamos contra el chargeAmount actual (el server igual lo valida en mig 165).
  const jointOverAssigned = isJointCovered && (jointCovering!.remaining + 1 < chargeAmount)
  const showTransferReceipt =
    !!receiptSettings?.isEnabled && selectedPayment === 'transfer'
  const needsReceipt = showTransferReceipt && !isJointCovered
  // Transferencia sin saber a qué cuenta entra: no se cobra (ni cargando, ni con
  // error, ni con cuentas pero ninguna elegida). Un cobro conjunto usa la del ancla.
  const faltaCuenta =
    selectedPayment === 'transfer' &&
    !isJointCovered &&
    (cuentas.tipo !== 'listo' || (cuentas.cuentas.length > 0 && !selectedAccountId))

  return (
    <>
    {/* Mientras el cobro (o el cierre sin cobro) está en vuelo no se puede salir
        (X, overlay ni Escape): `entry` sólo pasa a null desde finishService o
        cerrarComoSoloAsesoria, así que ninguna superficie puede abrir otro
        cliente con una promesa pendiente ni heredar `loading`. */}
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open && !ocupado) onClose() }}>
      <DialogContent showCloseButton={!ocupado} className="sm:max-w-xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6 gap-3 sm:gap-4">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Detalles del corte' : 'Cobro'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Cliente: ${entry?.client?.name}`
              : 'Seleccioná el método de pago'}
          </DialogDescription>
          {(esAsesoria || clientTier) && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 sm:justify-start">
              {esAsesoria && <AsesoriaBadge tono={tono} tamano="md" />}
              {clientTier && (
                <LoyaltyTierChip tier={clientTier} visits={clientLoyalty?.visits_in_window ?? null} size="md" />
              )}
            </div>
          )}
        </DialogHeader>

        <Separator />

        <>
          {step === 1 ? (
            <div className="space-y-5">
              {/* Servicio principal. Se dibuja SIEMPRE: antes vivía adentro de
                  `services.length > 0` (la lista de EXTRAS), así que en una
                  sucursal sin extras no se veía ni el servicio del check-in. */}
              <section
                aria-labelledby="cobro-servicio-principal"
                aria-describedby={esAsesoria ? 'cobro-servicio-ayuda' : undefined}
              >
                {esAsesoria ? (
                  <div className="mb-3">
                    <p id="cobro-servicio-principal" className="text-base font-semibold leading-tight">
                      ¿Qué le hiciste?
                    </p>
                    <p id="cobro-servicio-ayuda" className="mt-1 text-xs text-muted-foreground">
                      Pidió asesoría: elegí el servicio principal que le terminaste haciendo.
                    </p>
                  </div>
                ) : (
                  <p id="cobro-servicio-principal" className="mb-2 text-sm font-medium">
                    Servicio principal{' '}
                    {servicioEditable && <span className="text-muted-foreground">(opcional)</span>}
                  </p>
                )}

                {!servicioEditable ? (
                  /* Lo eligió en la tablet de check-in: queda fijo. */
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3">
                    <span className="text-base font-medium">
                      {mainService?.name ?? 'Servicio seleccionado'}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      — ${mainServicePrice}
                    </span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      Pre-seleccionado
                    </Badge>
                  </div>
                ) : opcionesPrincipales.length > 0 ? (
                  opcionesPrincipales.length <= MAX_CHIPS_PRINCIPALES ? (
                    /* Pocos servicios (el caso de todas las sucursales): un toque,
                       sin abrir un desplegable. */
                    <div role="group" aria-labelledby="cobro-servicio-principal" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {opcionesPrincipales.map((s) => {
                        const elegido = selectedService === s.id
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={elegido}
                            disabled={ocupado}
                            onClick={() => elegirPrincipal(s.id)}
                            className={cn(
                              'relative flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-2xl border-2 px-3 py-2.5 text-left outline-none',
                              'motion-safe:transition-[background-color,border-color,color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.98]',
                              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                              'disabled:cursor-not-allowed disabled:opacity-50',
                              elegido
                                ? 'border-primary bg-primary text-primary-foreground shadow-md'
                                : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5',
                            )}
                          >
                            <span className="line-clamp-2 pr-5 text-sm font-bold leading-tight">{s.name}</span>
                            <span className={cn('text-xs tabular-nums', elegido ? 'opacity-80' : 'text-muted-foreground')}>
                              {formatCurrency(Number(s.price) || 0)}
                            </span>
                            {elegido && <Check className="absolute right-2.5 top-2.5 size-4" aria-hidden />}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <Select value={selectedService} onValueChange={elegirPrincipal} disabled={ocupado}>
                      <SelectTrigger className="h-14 w-full text-lg" aria-labelledby="cobro-servicio-principal">
                        <SelectValue placeholder={esAsesoria ? 'Elegí lo que le hiciste' : 'Seleccionar servicio principal'} />
                      </SelectTrigger>
                      <SelectContent>
                        {opcionesPrincipales.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} — {formatCurrency(Number(s.price) || 0)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                ) : cargandoServicios ? (
                  /* El lugar de los botones, para que nada salte cuando llegan. */
                  <div role="status" aria-label="Cargando servicios" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-2xl border-2 border-border bg-muted/40 motion-safe:animate-pulse" />
                    ))}
                  </div>
                ) : !errorServicios ? (
                  <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    Esta sucursal no tiene servicios principales activos.
                  </p>
                ) : null}

                {/* No se pudieron traer los servicios: se dice, con salida. Sin
                    esto el cobro quedaba sin nada que elegir y sin explicación. */}
                {errorServicios && (
                  <div
                    role="alert"
                    className={cn(
                      'mt-2 flex items-start gap-3 rounded-xl border p-3',
                      tono === 'claro'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-800'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                    )}
                  >
                    <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">No pudimos traer los servicios de la sucursal</p>
                      <p className="text-xs opacity-90">Revisá la conexión y reintentá.</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11 shrink-0 border-amber-500/50"
                      onClick={() => setIntentoServicios((n) => n + 1)}
                    >
                      <RefreshCw className="mr-1.5 size-4" aria-hidden />
                      Reintentar
                    </Button>
                  </div>
                )}

                {/* Se asesoró y no se hizo nada: se cierra SIN visita. Va pegado
                    a la pregunta porque es su otra respuesta posible. */}
                {puedeCerrarSoloAsesoria && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      vibrate(8)
                      if (entry) setConfirmarSoloAsesoriaDe(entry.id)
                    }}
                    className={cn(
                      'mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm font-medium text-muted-foreground outline-none',
                      'border-fuchsia-500/40 hover:border-fuchsia-500/70 hover:bg-fuchsia-500/5 hover:text-foreground',
                      'focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors',
                    )}
                  >
                    <MessageCircleQuestionMark
                      className={cn('size-4 shrink-0', tono === 'claro' ? 'text-fuchsia-700' : 'text-fuchsia-300')}
                      aria-hidden
                    />
                    No se hizo nada · Cerrar como solo asesoría
                  </button>
                )}
              </section>

              {/* Extra Services */}
              {services.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Servicios extra{' '}
                    <span className="text-muted-foreground">(opcional)</span>
                  </p>
                  {extraServices.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {extraServices.map((id) => {
                        const s = services.find((x) => x.id === id)
                        if (!s) return null
                        return (
                          <Badge key={id} variant="secondary" className="gap-1 px-2 py-1 text-sm bg-white/5 border-white/10 hover:bg-white/10">
                            {s.name} (+${s.price})
                            <button type="button" onClick={() => setExtraServices((prev) => prev.filter((x) => x !== id))} className="ml-1 text-muted-foreground hover:text-white">
                              <X className="size-3" />
                            </button>
                          </Badge>
                        )
                      })}
                    </div>
                  )}
                  <Select
                    value=""
                    onValueChange={(id) => {
                      if (id && !extraServices.includes(id) && id !== selectedService) {
                        setExtraServices((prev) => [...prev, id])
                      }
                    }}
                  >
                    <SelectTrigger className="h-14 w-full text-lg">
                      <SelectValue placeholder="Agregar extra..." />
                    </SelectTrigger>
                    <SelectContent>
                      {services
                        .filter((s) => s.id !== selectedService && !extraServices.includes(s.id))
                        .map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name} — +${service.price}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Productos — la sección se ve SIEMPRE, con sus estados. Antes se
                  ocultaba si la lista venía vacía, y eso escondió durante un mes
                  que la lectura estaba rota: nadie vio un error, sólo dejó de
                  haber productos. */}
              <section aria-labelledby="cobro-productos">
                <p id="cobro-productos" className="mb-2 text-sm font-medium">
                  Productos <span className="text-muted-foreground">(opcional)</span>
                </p>
                <SelectorProductos
                  variante="compacta"
                  estado={productos.estado}
                  seleccion={selectedProducts}
                  onCambiar={setSelectedProducts}
                  onReintentar={productos.reintentar}
                  deshabilitado={ocupado}
                />
              </section>

              {/* Fotos del corte: se suben solas apenas se eligen y el cobro no
                  las espera (key: cada cobro tiene su propio estado de QR). */}
              {entry && (
                <FotosDelCobro key={entry.id} entradaId={entry.id} abierto={!!entry} deshabilitado={ocupado} />
              )}

              {/* Client notes */}
              <div>
                <p className="mb-2 text-sm font-medium">Notas del cliente</p>
                <textarea
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                  placeholder="Ej: Prefiere degradé bajo, alérgico a ciertos productos..."
                  rows={3}
                  className="min-h-[100px] w-full resize-none rounded-lg border bg-transparent p-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Subtotal */}
              <div className="flex justify-between items-center py-2 px-1 border-t mt-4">
                <span className="font-semibold text-lg">Subtotal</span>
                <span className="font-bold text-xl">${totalPrice}</span>
              </div>

              {/* La seña se avisa desde el PASO 1. El bloque grande vive en el
                  paso 2, junto al monto, pero para entonces el barbero ya armó
                  el ticket y —si sumó extras— ya le dijo un precio al cliente.
                  Acá va discreto: informa, no interrumpe. */}
              {senaAplicada > 0 && (
                <div className="-mt-2 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-300">
                  <Wallet className="size-4 shrink-0" />
                  <p className="text-xs leading-snug">
                    <span className="font-semibold">Ya pagó {formatCurrency(senaAplicada)} de seña</span> al reservar.
                    En el mostrador se cobran {formatCurrency(aCobrarAhora)}.
                  </p>
                </div>
              )}

              {avisoSena}

              {/* Con asesoría no se pasa al cobro sin el servicio principal que
                  se le hizo: el servidor lo rechazaría igual, y es mejor decirlo
                  acá. Los extras solos no alcanzan, y se dice si eso es lo que
                  pasa (si no, el barbero ve una barba elegida y el botón apagado). */}
              <div className="space-y-2">
                <Button
                  className="h-14 w-full text-lg"
                  size="lg"
                  disabled={ocupado || faltaServicioAsesoria}
                  aria-describedby={faltaServicioAsesoria ? 'cobro-falta-servicio' : undefined}
                  onClick={() => {
                    if (!faltaServicioAsesoria) setStep(2)
                  }}
                >
                  Continuar al cobro
                  <ArrowRight className="ml-2 size-5" />
                </Button>
                {faltaServicioAsesoria && (
                  <p id="cobro-falta-servicio" className="text-center text-xs text-muted-foreground">
                    {extrasElegidos.length > 0
                      ? 'Los extras solos no alcanzan: elegí arriba el servicio principal que le hiciste.'
                      : 'Elegí qué le hiciste para seguir'}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Beneficio — UN solo escáner: QR de la app (descuento / merch / especial)
                  o invitación de un amigo (MNC-REF:). Un solo beneficio por cobro: con
                  uno aplicado el botón desaparece y queda la X para quitarlo. */}
              {canUseCoupon && (
                appliedCoupon && benefitView ? (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3',
                      benefitView.tone === 'referral'
                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : benefitView.tone === 'mismatch'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {benefitView.tone === 'referral'
                      ? <UserPlus className="size-5 shrink-0" />
                      : benefitView.tone === 'delivery'
                        ? <Package className="size-5 shrink-0" />
                        : <TicketPercent className="size-5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{benefitView.title}</p>
                      <p className="text-xs opacity-90">{benefitView.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAppliedCoupon(null)}
                      className="rounded-md p-1 opacity-80 hover:bg-black/10 hover:opacity-100"
                      aria-label="Quitar beneficio"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-12 w-full border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                    onClick={() => setCouponScanOpen(true)}
                  >
                    <QrCode className="mr-2 size-5" />
                    Escanear QR · Beneficio o invitación
                  </Button>
                )
              )}

              {avisoSena}

              {/* Seña ya pagada. Va ARRIBA del monto y no como una línea chica
                  debajo: si el barbero no la ve antes de mirar el número
                  grande, cobra el total y el cliente paga una vez y media el
                  servicio. */}
              {senaAplicada > 0 && (
                <div className="rounded-2xl border-2 border-sky-500/50 bg-sky-500/10 px-4 py-3 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                    <Wallet className="size-3.5" />
                    Ya pagó seña
                  </p>
                  <p className="mt-1 text-2xl font-black leading-none tabular-nums text-sky-700 dark:text-sky-300">
                    {formatCurrency(senaAplicada)}
                  </p>
                  <p className="mt-1 text-xs text-sky-700/90 dark:text-sky-300/90">
                    Lo pagó por Mercado Pago al reservar el turno. No se lo cobres de nuevo.
                  </p>
                  {senaPagada > senaAplicada && (
                    <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      Había señado {formatCurrency(senaPagada)}, más de lo que sale este cobro. Avisá en el mostrador
                      para devolverle la diferencia.
                    </p>
                  )}
                </div>
              )}

              {/* Monto GIGANTE */}
              <div className="-mt-1 rounded-2xl border bg-muted/30 px-4 py-4 sm:px-6 sm:py-5 text-center">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {senaAplicada > 0 ? 'A cobrar ahora' : 'Monto a cobrar'}
                </p>
                <p className="mt-1 text-[clamp(44px,11vw,80px)] font-black leading-none tracking-tighter tabular-nums break-all">
                  {formatCurrency(aCobrarAhora + tipAmount)}
                </p>
                {couponDiscount > 0 && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground line-through">{formatCurrency(totalPrice + tipAmount)}</span>
                    <span className="ml-2 font-semibold text-emerald-600 dark:text-emerald-400">
                      −{couponPct}% {appliedCoupon?.kind === 'referral' ? 'invitación' : 'beneficio'}
                    </span>
                  </p>
                )}
                {/* Con seña, la cuenta se muestra ENTERA y en filas. Antes eran
                    dos líneas sueltas que usaban la palabra "servicio" para dos
                    números distintos —el precio completo en una, el resto en la
                    otra— apiladas debajo del número grande: el barbero tenía que
                    adivinar cuál de los tres importes era el que le pedía al
                    cliente. Acá cada renglón dice qué es, y el último es el
                    mismo `aCobrarAhora + propina` del número grande y del botón. */}
                {senaAplicada > 0 ? (
                  <div className="mx-auto mt-3 max-w-[280px] space-y-1 text-xs sm:text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Precio total</span>
                      <span className="tabular-nums">{formatCurrency(totalAfterDiscount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sky-700 dark:text-sky-300">
                      <span>Seña ya pagada</span>
                      <span className="font-semibold tabular-nums">−{formatCurrency(senaAplicada)}</span>
                    </div>
                    {tipAmount > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Propina</span>
                        <span className="tabular-nums">+{formatCurrency(tipAmount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t pt-1 font-semibold">
                      <span>A cobrar ahora</span>
                      <span className="tabular-nums">{formatCurrency(aCobrarAhora + tipAmount)}</span>
                    </div>
                  </div>
                ) : tipAmount > 0 ? (
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    {formatCurrency(aCobrarAhora)} servicio · <span className="font-semibold text-foreground">{formatCurrency(tipAmount)}</span> propina
                  </p>
                ) : null}
              </div>

              {/* Payment method */}
              <div>
                <p className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Método de pago
                </p>
                <PaymentMethodButtons
                  value={selectedPayment}
                  onChange={(m) => {
                    // Cambiar de método descarta cualquier estado de comprobante/cobro conjunto
                    // (no arrastramos un comprobante ni un ancla a un cobro de otro método).
                    if (m !== 'transfer') {
                      setReceiptScan(null); setJointCovering(null); setJointMode(false); setScanAsGroup(false)
                    }
                    setSelectedPayment(m)
                  }}
                />
              </div>

              {/* Transfer: rotación + alias gigante (componente compartido con venta directa).
                  Sin saber a qué cuenta entra la plata no se cobra por transferencia:
                  ni mientras las cuentas cargan, ni si no se pudieron traer. */}
              {selectedPayment === 'transfer' && !isJointCovered && (
                cuentas.tipo === 'cargando' ? (
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
                        Sin saber a qué cuenta entra la transferencia no se puede cobrar así. Reintentá o cobrá por otro medio.
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
                ) : paymentAccounts.length === 0 ? (
                  <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Esta sucursal no tiene cuentas de cobro activas: la transferencia queda registrada sin cuenta asignada.
                  </p>
                ) : (
                  <TransferAccountPicker
                    accounts={paymentAccounts}
                    selectedAccountId={selectedAccountId}
                    onSelect={setSelectedAccountId}
                    rotatedFrom={rotatedFrom}
                    allFull={allAccountsFull}
                    amountText={formatCurrency(transferAmount)}
                  />
                )
              )}

              {/* Comprobante de transferencia (obligatorio si la org lo activó) */}
              {showTransferReceipt && (
                <div className="space-y-2">
                  {isJointCovered ? (
                    /* El corte se cuelga de una transferencia que pagó otro → sin escaneo. */
                    <div className={cn('rounded-xl border p-3',
                      jointOverAssigned
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300')}>
                      <div className="flex items-center gap-3">
                        <Link2 className="size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Cobrado junto a otra transferencia</p>
                          <p className="truncate text-xs opacity-90">
                            {formatCurrency(jointCovering!.amount)}
                            {jointCovering!.barberName ? ` · ${jointCovering!.barberName}` : ''}
                            {jointCovering!.accountName ? ` · ${jointCovering!.accountName}` : ''}
                          </p>
                        </div>
                        <button type="button" onClick={() => setJointCovering(null)} className="shrink-0 text-xs underline opacity-80">
                          Cambiar
                        </button>
                      </div>
                      {jointOverAssigned && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          Ese comprobante ya no alcanza para {formatCurrency(chargeAmount)} (quedan {formatCurrency(jointCovering!.remaining)}). Cambiá de comprobante o escaneá el de este cobro.
                        </p>
                      )}
                    </div>
                  ) : receiptScan ? (
                    receiptScan.status === 'verified' ? (
                      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                        <Check className="size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {scanAsGroup ? 'Comprobante conjunto verificado' : 'Comprobante verificado'}
                          </p>
                          {receiptScan.extracted?.amount != null && (
                            <p className="text-xs opacity-90">
                              {formatCurrency(receiptScan.extracted.amount)} leído{scanAsGroup ? ' · cubre varios cortes' : ''}
                            </p>
                          )}
                        </div>
                        <button type="button" onClick={() => setScanOpen(true)} className="shrink-0 text-xs underline opacity-80">
                          Re-escanear
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {receiptScan.status === 'duplicate' && 'Comprobante ya usado'}
                            {receiptScan.status === 'amount_mismatch' && 'El monto no coincide'}
                            {receiptScan.status === 'needs_review' && 'Comprobante en revisión'}
                          </p>
                          <p className="text-xs opacity-90">Se registrará igual para conciliar.</p>
                        </div>
                        <button type="button" onClick={() => setScanOpen(true)} className="shrink-0 text-xs underline opacity-80">
                          Re-escanear
                        </button>
                      </div>
                    )
                  ) : (
                    <>
                      <Button
                        type="button"
                        onClick={() => { setScanAsGroup(false); setScanOpen(true) }}
                        disabled={faltaCuenta}
                        size="lg"
                        className="h-14 w-full bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                      >
                        <ScanLine className="mr-2 size-5" /> Confirmar con escaneo
                      </Button>

                      {/* Cobro conjunto: una transferencia paga varios cortes */}
                      {!jointMode ? (
                        <button
                          type="button"
                          onClick={() => { setJointMode(true); void loadJointOptions() }}
                          className="mx-auto flex items-center gap-1.5 py-0.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          <Users className="size-3.5" /> Se pagó junto a otro corte
                        </button>
                      ) : (
                        <div className="space-y-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-3">
                          <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                            Una transferencia, varios cortes
                          </p>

                          {/* Rol A: este barbero recibió la transferencia */}
                          <Button
                            type="button" variant="outline"
                            className="h-auto w-full justify-start gap-2 py-2.5"
                            onClick={() => { setScanAsGroup(true); setScanOpen(true) }}
                            disabled={faltaCuenta}
                          >
                            <ScanLine className="size-4 shrink-0 text-emerald-600" />
                            <span className="text-left text-[13px] font-semibold leading-tight">
                              Recibí yo la transferencia
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                Escaneo el comprobante (cubre los dos cortes)
                              </span>
                            </span>
                          </Button>

                          {/* Rol B: lo pagó otro corte → elegir de la lista */}
                          <div className="space-y-1.5">
                            <p className="px-0.5 text-[11px] font-medium text-muted-foreground">…o ya lo pagó otro corte:</p>
                            {jointLoading ? (
                              <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" /> Buscando transferencias…
                              </div>
                            ) : jointOptions.length === 0 ? (
                              <p className="px-1 py-1 text-[11px] text-muted-foreground">
                                No hay transferencias conjuntas abiertas. El que recibió la plata tiene que cerrar su corte primero.
                              </p>
                            ) : (
                              jointOptions.map((o) => {
                                const enough = o.remaining + 1 >= chargeAmount
                                return (
                                  <button
                                    key={o.id} type="button" disabled={!enough}
                                    onClick={() => pickJointCovering(o)}
                                    className={cn(
                                      'flex w-full items-center gap-2 rounded-lg border border-border p-2.5 text-left transition-colors',
                                      enough ? 'hover:bg-sky-500/10' : 'cursor-not-allowed opacity-50',
                                    )}
                                  >
                                    <Link2 className="size-4 shrink-0 text-sky-600" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[13px] font-semibold tabular-nums">
                                        {formatCurrency(o.amount)}{' '}
                                        <span className="font-normal text-muted-foreground">· quedan {formatCurrency(o.remaining)}</span>
                                      </p>
                                      <p className="truncate text-[11px] text-muted-foreground">
                                        {o.barberName ?? 'Barbero'}{o.accountName ? ` · ${o.accountName}` : ''}
                                      </p>
                                    </div>
                                    {enough
                                      ? <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                                      : <span className="shrink-0 text-[10px] text-muted-foreground">no alcanza</span>}
                                  </button>
                                )
                              })
                            )}
                          </div>

                          <div className="flex items-center justify-between">
                            <button type="button" onClick={loadJointOptions} className="text-[11px] text-muted-foreground underline underline-offset-2">
                              Actualizar
                            </button>
                            <button type="button" onClick={() => setJointMode(false)} className="text-[11px] text-muted-foreground">
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {!isJointCovered && (
                    <p className="text-center text-xs text-muted-foreground">
                      Obligatorio para cobrar por transferencia
                    </p>
                  )}
                </div>
              )}

              {/* Propina */}
              {selectedPayment && (
                <TipSelector
                  baseAmount={totalAfterDiscount}
                  value={tipAmount}
                  method={tipMethod}
                  onChange={(amt, m) => { setTipAmount(amt); setTipMethod(m) }}
                  serviceMethod={selectedPayment}
                />
              )}

              {/* Nota del barbero para esta visita */}
              {selectedPayment && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Nota para este corte <span className="normal-case font-normal">(opcional — solo vos la ves)</span>
                  </p>
                  <textarea
                    value={barberNote}
                    onChange={(e) => setBarberNote(e.target.value.slice(0, 500))}
                    placeholder="Ej: quiso un poco más corto de lo habitual, probar producto X la próxima..."
                    rows={2}
                    className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              <div className="flex gap-2 sm:gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-14 sm:h-16 w-14 sm:w-auto sm:px-5 sm:text-base shrink-0"
                  onClick={() => setStep(1)}
                  disabled={loading}
                  aria-label="Volver a detalles"
                >
                  <ArrowLeft className="size-5" />
                  <span className="hidden sm:inline ml-2">Atrás</span>
                </Button>
                <Button
                  className="h-14 sm:h-16 flex-1 text-base sm:text-lg font-black uppercase tracking-wide min-w-0"
                  size="lg"
                  onClick={() => finishService()}
                  disabled={loading || !selectedPayment || (needsReceipt && !receiptScan) || jointOverAssigned || faltaCuenta}
                >
                  <span className="truncate">
                    {/* El botón dice EXACTAMENTE lo que hay que pedirle al cliente ahora.
                        Con `totalAfterDiscount` decía el precio de lista aunque el cliente
                        ya hubiera señado la mitad por Mercado Pago: el número gigante de
                        arriba y el alias de transferencia iban netos y este no, así que el
                        barbero leía el último que veía —el del botón que estaba tocando— y
                        le cobraba dos veces la seña. Es el mismo `aCobrarAhora` que se
                        imputa en `visits.prepaid_amount` y que proyecta el ledger. */}
                    {loading
                      ? 'Procesando...'
                      : `Cobrar ${formatCurrency(aCobrarAhora + tipAmount)}`}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </>
      </DialogContent>
    </Dialog >

    {/* Confirmación de «Cerrar como solo asesoría». Es un AlertDialog: Radix no lo
        cierra con un toque afuera (tampoco con uno en un aviso) y le da el foco a
        «Volver». Va en el mismo plano que el cobro (z-[110]), así que manda el
        orden del DOM: se abre después y queda arriba, con su velo sobre el cobro.
        Antes era un Dialog con rol de alertdialog porque el AlertDialog iba en
        z-50 y se dibujaba DEBAJO del cobro. Portalea igual que el resto (en el
        panel, a #giro-portales: gira con él). Mientras cierra, ni Escape lo saca. */}
    <AlertDialog
      open={!!entry && confirmarSoloAsesoriaDe === entry.id && puedeCerrarSoloAsesoria}
      onOpenChange={(open) => { if (!open && !cerrandoAsesoria) setConfirmarSoloAsesoriaDe(null) }}
    >
      <AlertDialogContent className="gap-4 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cerrar como solo asesoría?</AlertDialogTitle>
          <AlertDialogDescription>
            {nombreCliente} se asesoró y no se hizo ningún servicio. Se cierra sin cobro: no cuenta como corte
            ni como visita. ¿Se llevó un producto? Después vendelo desde Vender.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {fotosADescartar > 0 && (
          <p
            className={cn(
              'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm',
              tono === 'claro'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {fotosADescartar === 1
              ? 'La foto que sacaste no se guarda en la ficha.'
              : `Las ${fotosADescartar} fotos que sacaste no se guardan en la ficha.`}
          </p>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-12 sm:min-w-28" disabled={cerrandoAsesoria}>
            Volver
          </AlertDialogCancel>
          {/* Button y no AlertDialogAction: Action cierra el diálogo al tocarlo,
              y éste tiene que quedar abierto («Cerrando…») hasta que el servidor
              conteste. */}
          <Button
            type="button"
            className="h-12 sm:min-w-40"
            disabled={cerrandoAsesoria}
            onClick={() => void cerrarComoSoloAsesoria()}
          >
            {cerrandoAsesoria ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Cerrando…
              </>
            ) : (
              'Cerrar sin cobro'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <CouponScanDialog
      open={couponScanOpen}
      branchId={branchId}
      clientId={entry?.client_id ?? null}
      onClose={() => setCouponScanOpen(false)}
      onApplied={(coupon) => {
        setAppliedCoupon(coupon)
        setCouponScanOpen(false)
      }}
    />

    <ReceiptScanDialog
      open={scanOpen}
      engine={receiptSettings?.engine ?? 'ai'}
      expectedAmount={chargeAmount}
      branchId={branchId}
      barberId={entry?.barber_id ?? null}
      paymentAccountId={selectedAccountId || null}
      clientId={entry?.client_id ?? null}
      coversGroup={scanAsGroup}
      onClose={() => setScanOpen(false)}
      onAccept={(r) => { setReceiptScan(r); setScanOpen(false); finishService(r) }}
    />
    </>
  )
}
