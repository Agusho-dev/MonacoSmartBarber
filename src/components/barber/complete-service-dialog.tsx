'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
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
  Gift,
  TicketPercent,
  ScanLine,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { TransferAccountPicker } from './transfer-account-picker'
import { PaymentMethodButtons, type PaymentOptionValue } from './payment-method-buttons'
import { TipSelector } from './tip-selector'
import { CouponScanDialog, type AppliedCoupon } from './coupon-scan-dialog'
import { ReceiptScanDialog, type ReceiptScanResult } from './receipt-scan-dialog'
import { getTransferReceiptSettings, linkReceiptToVisit, type TransferReceiptSettingsView } from '@/lib/actions/receipts'

interface CompleteServiceDialogProps {
  entry: QueueEntry | null
  branchId: string
  onClose: () => void
  onCompleted?: () => void
}

export function CompleteServiceDialog({
  entry,
  branchId,
  onClose,
  onCompleted,
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

  // Cupón de descuento (validado pero todavía no consumido; se consume al cobrar)
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponScanOpen, setCouponScanOpen] = useState(false)

  // Comprobante de transferencia (mig 157)
  const [receiptSettings, setReceiptSettings] = useState<TransferReceiptSettingsView | null>(null)
  const [receiptScan, setReceiptScan] = useState<ReceiptScanResult | null>(null)
  const [scanOpen, setScanOpen] = useState(false)

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

  async function finishService(receiptForLink?: ReceiptScanResult | null) {
    if (!entry || !selectedPayment || loading) return
    setLoading(true)

    try {
      const result = await completeService(
        entry.id,
        selectedPayment === 'points' ? 'cash' : selectedPayment,
        selectedService || undefined,
        selectedPayment === 'points',
        selectedAccountId || null,
        extraServices.length > 0 ? extraServices : undefined,
        selectedProducts.length > 0 ? selectedProducts : undefined,
        tipAmount,
        tipAmount > 0 ? (tipMethod ?? (selectedPayment === 'points' ? 'cash' : selectedPayment)) : null,
        barberNote.trim() || null,
        // No mandamos el cupón si no aplica (canje por puntos, o sin servicio para descontar):
        // así el chip oculto y el valor transmitido nunca divergen.
        (selectedPayment === 'points' || !canUseCoupon) ? null : (appliedCoupon?.qrCode ?? null),
      )

      if ('error' in result) {
        toast.error(result.error)
        setLoading(false)
        return
      }

      // Aviso de cupón: si el canje falló al confirmar (ya usado / vencido / carrera),
      // se cobró a precio lleno. Si se aplicó, confirmamos el descuento.
      if ('couponWarning' in result && result.couponWarning) {
        toast.warning(result.couponWarning)
      } else if ('couponApplied' in result && result.couponApplied) {
        toast.success(`Cupón aplicado: ${formatCurrency(result.couponDiscountAmount ?? 0)} de descuento`)
      }

      if (result.visitId) {
        let paths: string[] = [...qrPhotoPaths]
        if (photoFiles.length > 0) {
          const blobs = await Promise.all(photoFiles.map((f) => compressToWebP(f)))
          const galleryPaths = await uploadVisitPhotos(supabase, result.visitId, blobs)
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
        await updateClientNotes(entry.client_id, clientNotes.trim(), '')
      }

      onCompleted?.()
    } catch {
      toast.error('Error al finalizar el servicio')
    }
    setLoading(false)
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

  // Descuento por cupón: aplica SOLO al subtotal de servicios (no productos ni
  // propina), igual que el servidor (completeService usa serviceSubtotal).
  const serviceSubtotal = mainServicePrice + extrasPrice
  const couponPct = appliedCoupon
    ? (appliedCoupon.isFreeService ? 100 : (appliedCoupon.discountPct ?? 0))
    : 0
  const couponDiscount = couponPct > 0 ? Math.round(serviceSubtotal * (couponPct / 100)) : 0
  const totalAfterDiscount = Math.max(0, totalPrice - couponDiscount)
  // El cupón se vincula a un cliente; sin cliente no se puede ofrecer. Tampoco
  // coexiste con el canje por puntos (reward_claimed), que ya lleva el corte a $0.
  const canUseCoupon = !!entry?.client_id && !entry?.reward_claimed && serviceSubtotal > 0

  // La propina hereda el método del cobro salvo que el barbero elija otro
  // (TipSelector permite propina en efectivo aunque el servicio se cobre por transferencia).
  // El cliente sólo transfiere la propina si ésta también va por transferencia; si no, la
  // deja en mano y NO entra en el monto del comprobante ni en el alias.
  const effectiveTipMethod = tipAmount > 0 ? (tipMethod ?? selectedPayment) : null
  const tipViaTransfer = effectiveTipMethod === 'transfer'
  const transferAmount = totalAfterDiscount + (tipViaTransfer ? tipAmount : 0)

  // Comprobante obligatorio al cobrar por transferencia (si la org lo activó). El monto
  // esperado del comprobante = exactamente lo que el cliente transfiere.
  const chargeAmount = transferAmount
  const needsReceipt =
    !!receiptSettings?.isEnabled && selectedPayment === 'transfer' && !entry?.reward_claimed

  return (
    <>
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6 gap-3 sm:gap-4">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Detalles del corte' : 'Cobro'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Cliente: ${entry?.client?.name}`
              : 'Seleccioná el método de pago'}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <>
          {entry?.reward_claimed && step === 2 && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-4 text-purple-600 dark:text-purple-400 flex items-start gap-3">
              <Gift className="size-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">El cliente solicita canjear un premio</p>
                <p className="text-xs mt-1 opacity-90">Seleccioná &quot;Puntos&quot; como método de pago para registrar el servicio a costo $0 y descontar los puntos.</p>
              </div>
            </div>
          )}

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
              {/* Cupón de descuento — botón → cámara frontal → escanear → aplica el % */}
              {canUseCoupon && (
                appliedCoupon ? (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                    <TicketPercent className="size-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {appliedCoupon.rewardName ?? 'Cupón'} — {appliedCoupon.isFreeService ? 'servicio gratis' : `${couponPct}% OFF`}
                      </p>
                      <p className="text-xs opacity-90">−{formatCurrency(couponDiscount)} en servicios</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAppliedCoupon(null)}
                      className="rounded-md p-1 text-emerald-700/80 hover:bg-emerald-500/20 dark:text-emerald-300/80"
                      aria-label="Quitar cupón"
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
                    <TicketPercent className="mr-2 size-5" />
                    Canjear cupón de descuento
                  </Button>
                )
              )}

              {/* Monto GIGANTE */}
              <div className="-mt-1 rounded-2xl border bg-muted/30 px-4 py-4 sm:px-6 sm:py-5 text-center">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Monto a cobrar
                </p>
                <p className="mt-1 text-[clamp(44px,11vw,80px)] font-black leading-none tracking-tighter tabular-nums break-all">
                  {formatCurrency(totalAfterDiscount + tipAmount)}
                </p>
                {couponDiscount > 0 && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground line-through">{formatCurrency(totalPrice + tipAmount)}</span>
                    <span className="ml-2 font-semibold text-emerald-600 dark:text-emerald-400">−{couponPct}% cupón</span>
                  </p>
                )}
                {tipAmount > 0 && (
                  <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
                    {formatCurrency(totalAfterDiscount)} servicio · <span className="font-semibold text-foreground">{formatCurrency(tipAmount)}</span> propina
                  </p>
                )}
              </div>

              {/* Payment method */}
              <div>
                <p className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Método de pago
                </p>
                <PaymentMethodButtons
                  value={selectedPayment}
                  onChange={setSelectedPayment}
                  allowPoints={!!entry?.reward_claimed}
                />
              </div>

              {/* Transfer: rotación + alias gigante (componente compartido con venta directa) */}
              {selectedPayment === 'transfer' && paymentAccounts.length > 0 && (
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
              {needsReceipt && (
                <div className="space-y-2">
                  {receiptScan ? (
                    receiptScan.status === 'verified' ? (
                      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                        <Check className="size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Comprobante verificado</p>
                          {receiptScan.extracted?.amount != null && (
                            <p className="text-xs opacity-90">{formatCurrency(receiptScan.extracted.amount)} leído</p>
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
                            {receiptScan.status === 'date_mismatch' && 'Comprobante viejo'}
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
                    <Button
                      type="button"
                      onClick={() => setScanOpen(true)}
                      size="lg"
                      className="h-14 w-full bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                    >
                      <ScanLine className="mr-2 size-5" /> Confirmar con escaneo
                    </Button>
                  )}
                  <p className="text-center text-xs text-muted-foreground">
                    Obligatorio para cobrar por transferencia
                  </p>
                </div>
              )}

              {/* Propina */}
              {selectedPayment && selectedPayment !== 'points' && (
                <TipSelector
                  baseAmount={totalAfterDiscount}
                  value={tipAmount}
                  method={tipMethod}
                  onChange={(amt, m) => { setTipAmount(amt); setTipMethod(m) }}
                  serviceMethod={selectedPayment as PaymentMethod}
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
                  disabled={loading || !selectedPayment || (needsReceipt && !receiptScan)}
                >
                  <span className="truncate">
                    {loading
                      ? 'Procesando...'
                      : `Cobrar ${formatCurrency(totalAfterDiscount + tipAmount)}`}
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
      onClose={() => setScanOpen(false)}
      onAccept={(r) => { setReceiptScan(r); setScanOpen(false); finishService(r) }}
    />
    </>
  )
}
