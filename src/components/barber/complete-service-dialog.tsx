'use client'

import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { completeService } from '@/lib/actions/queue'
import { getTransferAccountsState } from '@/lib/actions/paymentAccounts'
import { saveVisitDetails } from '@/lib/actions/visit-history'
import { updateClientNotes } from '@/lib/actions/clients'
import { compressToWebP, uploadVisitPhotos } from '@/lib/image-utils'
import { QrPhotoButton } from '@/components/barber/qr-photo-button'
import type { QueueEntry, Service, PaymentMethod, Product } from '@/lib/types/database'
import { pickTransferAccount, type TransferAccountState } from '@/lib/payment-accounts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
  ImagePlus,
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

interface CompleteServiceDialogProps {
  entry: QueueEntry | null
  branchId: string
  onClose: () => void
  onCompleted?: () => void
  /**
   * Categorías del programa de fidelización (`loyalty_tiers` de la org), para el
   * chip "Oro · 7 visitas recientes" del encabezado. Opcional: las superficies que
   * no las cargan simplemente no muestran el chip.
   */
  tiers?: LoyaltyTierLite[] | null
}

export function CompleteServiceDialog({
  entry,
  branchId,
  onClose,
  onCompleted,
  tiers,
}: CompleteServiceDialogProps) {
  const supabase = useMemo(() => createClient(), [])

  const [services, setServices] = useState<Service[]>([])
  // Servicio principal pre-seleccionado, traído por id sin filtros (ver effect).
  const [preselectedService, setPreselectedService] = useState<Service | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<TransferAccountState[]>([])
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
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // QR photo paths (already uploaded to storage from mobile)
  const [qrPhotoPaths, setQrPhotoPaths] = useState<string[]>([])
  const [qrPhotoPreviews, setQrPhotoPreviews] = useState<string[]>([])
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
      setPhotoFiles([])
      setQrPhotoPaths([])
      setQrPhotoPreviews([])
      photoPreviews.forEach(URL.revokeObjectURL)
      setPhotoPreviews([])
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
      return
    }

    if (entry.service_id) {
      setSelectedService(entry.service_id)
      // El servicio principal pre-seleccionado puede tener availability 'checkin' (que NO
      // aparece en la lista de upsell/both de abajo) y, según la superficie que abre el
      // diálogo, entry.service puede no venir joineado (la fila del dashboard no lo trae).
      // Lo buscamos por id —sin filtrar availability/is_active— para resolver SIEMPRE su
      // precio; si no, el corte se mostraba como "$0" (bug solo visible en sucursales cuyos
      // servicios principales son 'checkin', ej. Caseros).
      supabase
        .from('services')
        .select('*')
        .eq('id', entry.service_id)
        .maybeSingle()
        .then(({ data }) => { if (data) setPreselectedService(data as Service) })
    } else {
      setPreselectedService(null)
    }

    getTransferReceiptSettings().then(setReceiptSettings)

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

    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .in('availability', ['upsell', 'both'])
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .then(({ data }) => {
        if (data) setServices(data as Service[])
      })

    supabase
      .from('products')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setProducts(data as Product[])
      })

    // Cuentas de cobro con su acumulado REAL del mes (server action que valida la sesión
    // de barbero y lee transfer_logs con service_role — NO exponemos la RPC a anon).
    // Se pide al abrir el cobro, no al cargar el panel: si la cuenta se llenó hace un
    // minuto, el barbero tiene que ver ya la siguiente. La rotación por tope la decide
    // pickTransferAccount, la misma regla que muestra el dashboard.
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

    getTransferAccountsState(branchId).then((accs) => {
      setPaymentAccounts(accs)
      const pick = pickTransferAccount(accs)
      setRotatedFrom(pick.skipped)
      setAllAccountsFull(pick.allFull)
      if (pick.account) setSelectedAccountId(pick.account.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, branchId])

  function handlePhotos(files: FileList | null) {
    if (!files) return
    const newFiles = Array.from(files)
    setPhotoFiles((prev) => [...prev, ...newFiles])
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f))
    setPhotoPreviews((prev) => [...prev, ...newPreviews])
  }

  function removePhoto(index: number) {
    URL.revokeObjectURL(photoPreviews[index])
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index))
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  // Cobro conjunto — el 2º barbero carga las transferencias-ancla abiertas de la sucursal.
  async function loadJointOptions() {
    setJointLoading(true)
    const opts = await getOpenJointReceipts(branchId)
    setJointLoading(false)
    setJointOptions(opts)
    // El estado vacío se comunica inline en el picker (no disparamos toast: se apilaba
    // al refrescar y duplicaba el mensaje ya visible).
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

  async function finishService(receiptForLink?: ReceiptScanResult | null) {
    if (!entry || !selectedPayment || loading) return
    setLoading(true)

    // Se captura acá y se muestra recién al final: si se montara apenas vuelve
    // completeService, la tarjeta arrancaría su temporizador debajo del modal
    // mientras siguen las fotos, el comprobante y las notas.
    let loyaltyToShow: { result: LoyaltyFinalizeResult; clientName: string | null } | null = null

    try {
      const result = await completeService(
        entry.id,
        selectedPayment,
        selectedService || undefined,
        selectedAccountId || null,
        extraServices.length > 0 ? extraServices : undefined,
        selectedProducts.length > 0 ? selectedProducts : undefined,
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

      if ('error' in result) {
        toast.error(result.error)
        setLoading(false)
        return
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

      if (result.visitId) {
        let paths: string[] = [...qrPhotoPaths]
        if (photoFiles.length > 0) {
          const imagenes = await Promise.all(photoFiles.map((f) => compressToWebP(f)))
          const galleryPaths = await uploadVisitPhotos(supabase, result.visitId, imagenes)
          paths = [...paths, ...galleryPaths]
        }

        const detailResult = await saveVisitDetails(
          result.visitId,
          null,
          null,
          paths
        )
        if (detailResult.error) {
          toast.error(detailResult.error)
        }
      }

      // Vincular el comprobante de transferencia escaneado a la visita creada.
      const scanForLink = receiptForLink ?? receiptScan
      if (result.visitId && scanForLink?.receiptId) {
        await linkReceiptToVisit(scanForLink.receiptId, result.visitId)
      }

      if (entry.client_id && clientNotes.trim() !== originalClientNotes) {
        // Sin tercer argumento: el Instagram del cliente NO se toca. Antes se
        // mandaba '' y se lo borraba en cada cierre de servicio.
        await updateClientNotes(entry.client_id, clientNotes.trim())
      }

      onCompleted?.()
    } catch {
      toast.error('Error al finalizar el servicio')
    }
    setLoading(false)
    // La tarjeta se muestra recién cuando el cobro cerró del todo, en el mismo
    // batch en que se cierra el diálogo: el temporizador arranca con el barbero
    // mirándola y la X responde desde el primer frame. Va fuera del try a
    // propósito: si falló la subida de fotos, los puntos igual se acreditaron.
    if (loyaltyToShow) showLoyaltyResult(loyaltyToShow.result, loyaltyToShow.clientName)
    onClose()
  }

  // Resolución del servicio principal, en orden de confiabilidad:
  //   1) entry.service joineado (si la superficie lo trajo)
  //   2) preselectedService traído por id (cualquier availability/estado)
  //   3) la lista de upsell/both (caso dropdown editable, sin pre-selección)
  const mainService =
    (entry?.service_id && selectedService === entry.service_id
      ? (entry.service ?? preselectedService)
      : null)
    ?? services.find((s) => s.id === selectedService)

  const mainServicePrice = mainService?.price ?? 0

  const extrasPrice = extraServices.reduce((total, id) => {
    return total + (services.find(s => s.id === id)?.price ?? 0)
  }, 0)

  const productsPrice = selectedProducts.reduce((total, p) => {
    return total + ((products.find(x => x.id === p.id)?.sale_price ?? 0) * p.quantity)
  }, 0)

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
    ...extraServices
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
      .map((s) => ({ id: s.id, name: s.name, price: s.price != null ? Number(s.price) : null })),
  ]
  const couponServiceOk = benefitAppliesToServices(appliedCoupon, selectedService || null, extraServices, serviciosDelCobro)
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
  const clientLoyalty = entry?.client?.loyalty?.[0] ?? null
  const clientTier = findLoyaltyTier(tiers, clientLoyalty?.tier_code)

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

  return (
    <>
    {/* Mientras el cobro está en vuelo no se puede salir (X, overlay ni Escape):
        `entry` sólo pasa a null desde finishService, así que ninguna superficie
        puede abrir otro cliente con una promesa pendiente ni heredar `loading`. */}
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open && !loading) onClose() }}>
      <DialogContent showCloseButton={!loading} className="sm:max-w-xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6 gap-3 sm:gap-4">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Detalles del corte' : 'Cobro'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Cliente: ${entry?.client?.name}`
              : 'Seleccioná el método de pago'}
          </DialogDescription>
          {clientTier && (
            <div className="flex items-center gap-2 pt-0.5">
              <LoyaltyTierChip tier={clientTier} visits={clientLoyalty?.visits_in_window ?? null} size="md" />
            </div>
          )}
        </DialogHeader>

        <Separator />

        <>
          {step === 1 ? (
            <div className="space-y-5">
              {/* Service */}
              {services.length > 0 && (
                <div>
                  {/* Service label */}
                  <p className="mb-2 text-sm font-medium">
                    Servicio principal{' '}
                    {!entry?.service_id && <span className="text-muted-foreground">(opcional)</span>}
                  </p>
                  {/* Locked service from terminal */}
                  {entry?.service_id ? (
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
                  ) : (
                    /* Editable dropdown when no service was pre-selected */
                    <Select value={selectedService} onValueChange={setSelectedService}>
                      <SelectTrigger className="h-14 w-full text-lg">
                        <SelectValue placeholder="Seleccionar servicio principal" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name} — ${service.price}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Extra Services/Products */}
              {services.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Servicios Extra / Productos{' '}
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

              {/* Products */}
              {products.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Productos <span className="text-muted-foreground">(opcional)</span>
                  </p>
                  {selectedProducts.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {selectedProducts.map((p) => {
                        const prod = products.find((x) => x.id === p.id)
                        if (!prod) return null
                        return (
                          <div key={p.id} className="flex items-center justify-between rounded-lg border bg-white/5 border-white/10 p-2">
                            <span className="text-sm font-medium">{prod.name} (+${prod.sale_price * p.quantity})</span>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 rounded-md bg-black/20 px-2 py-1">
                                <button type="button" onClick={() => setSelectedProducts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} className="text-muted-foreground hover:text-white">-</button>
                                <span className="text-sm w-4 text-center">{p.quantity}</span>
                                <button type="button" onClick={() => setSelectedProducts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: x.quantity + 1 } : x))} className="text-muted-foreground hover:text-white">+</button>
                              </div>
                              <button type="button" onClick={() => setSelectedProducts((prev) => prev.filter((x) => x.id !== p.id))} className="text-red-400 hover:text-red-300 p-1">
                                <X className="size-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Select
                    value=""
                    onValueChange={(id) => {
                      if (id && !selectedProducts.find(x => x.id === id)) {
                        setSelectedProducts((prev) => [...prev, { id, quantity: 1 }])
                      }
                    }}
                  >
                    <SelectTrigger className="h-14 w-full text-lg">
                      <SelectValue placeholder="Agregar producto..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products
                        .filter((p) => !selectedProducts.find(x => x.id === p.id))
                        .map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} — ${product.sale_price} 
                            {product.stock !== null ? ` (Stock: ${product.stock})` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Photos */}
              <div>
                <p className="mb-2 text-sm font-medium">Fotos</p>
                {photoPreviews.length > 0 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {photoPreviews.map((url, i) => (
                      <div key={i} className="group relative shrink-0">
                        {/* Blob URL de URL.createObjectURL — Image no soporta blobs eficientemente */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Foto ${i + 1}`}
                          className="size-20 rounded-lg border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* QR photo previews */}
                {qrPhotoPreviews.length > 0 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {qrPhotoPreviews.map((url, i) => (
                      <div key={`qr-${i}`} className="group relative shrink-0">
                        <Image
                          src={url}
                          alt={`QR Foto ${i + 1}`}
                          width={80}
                          height={80}
                          className="size-20 rounded-lg border border-emerald-500/30 object-cover"
                          unoptimized
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setQrPhotoPaths((prev) => prev.filter((_, idx) => idx !== i))
                            setQrPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i))
                          }}
                          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handlePhotos(e.target.files)}
                  />
                  <QrPhotoButton
                    onPhotoReceived={(photo) => {
                      setQrPhotoPaths((prev) => [...prev, photo.storagePath])
                      setQrPhotoPreviews((prev) => [...prev, photo.publicUrl])
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-14 flex-1 text-base"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-2 size-5" />
                    Galería
                  </Button>
                </div>
              </div>

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

              <Button
                className="h-14 w-full text-lg"
                size="lg"
                onClick={() => setStep(2)}
              >
                Continuar al cobro
                <ArrowRight className="ml-2 size-5" />
              </Button>
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

              {/* Transfer: rotación + alias gigante (componente compartido con venta directa) */}
              {selectedPayment === 'transfer' && paymentAccounts.length > 0 && !isJointCovered && (
                <TransferAccountPicker
                  accounts={paymentAccounts}
                  selectedAccountId={selectedAccountId}
                  onSelect={setSelectedAccountId}
                  rotatedFrom={rotatedFrom}
                  allFull={allAccountsFull}
                  amountText={formatCurrency(transferAmount)}
                />
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
                  disabled={loading || !selectedPayment || (needsReceipt && !receiptScan) || jointOverAssigned}
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
