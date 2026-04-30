'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { completeService } from '@/lib/actions/queue'
import { saveVisitDetails } from '@/lib/actions/visit-history'
import { updateClientNotes } from '@/lib/actions/clients'
import { compressToWebP, uploadVisitPhotos } from '@/lib/image-utils'
import { QrPhotoButton } from '@/components/barber/qr-photo-button'
import type { QueueEntry, Service, PaymentMethod, PaymentAccount, Product } from '@/lib/types/database'
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
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { AliasCopyHero } from './alias-copy-hero'
import { PaymentMethodButtons, type PaymentOptionValue } from './payment-method-buttons'
import { TipSelector } from './tip-selector'

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
  const [products, setProducts] = useState<Product[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
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

  useEffect(() => {
    if (!entry) {
      setStep(1)
      setSelectedPayment(null)
      setSelectedService('')
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
      return
    }

    if (entry.service_id) {
      setSelectedService(entry.service_id)
    }

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

    supabase
      .from('payment_accounts')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const accs = data as PaymentAccount[]
          setPaymentAccounts(accs)

          let selected = accs[0]
          for (const acc of accs) {
            if (acc.daily_limit === null) {
              selected = acc
              break
            }
            if ((acc.accumulated_today ?? 0) < acc.daily_limit) {
              selected = acc
              break
            }
          }
          setSelectedAccountId(selected.id)
        }
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

  async function finishService() {
    if (!entry || !selectedPayment) return
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
      )

      if ('error' in result) {
        toast.error(result.error)
        setLoading(false)
        return
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

  const mainService = selectedService === entry?.service_id && entry?.service
    ? entry.service
    : services.find((s) => s.id === selectedService)

  const mainServicePrice = mainService?.price ?? 0

  const extrasPrice = extraServices.reduce((total, id) => {
    return total + (services.find(s => s.id === id)?.price ?? 0)
  }, 0)

  const productsPrice = selectedProducts.reduce((total, p) => {
    return total + ((products.find(x => x.id === p.id)?.sale_price ?? 0) * p.quantity)
  }, 0)

  const totalPrice = mainServicePrice + extrasPrice + productsPrice

  return (
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
              {/* Monto GIGANTE */}
              <div className="-mt-1 rounded-2xl border bg-muted/30 px-4 py-4 sm:px-6 sm:py-5 text-center">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Monto a cobrar
                </p>
                <p className="mt-1 text-[clamp(44px,11vw,80px)] font-black leading-none tracking-tighter tabular-nums break-all">
                  {formatCurrency(totalPrice + tipAmount)}
                </p>
                {tipAmount > 0 && (
                  <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
                    {formatCurrency(totalPrice)} servicio · <span className="font-semibold text-foreground">{formatCurrency(tipAmount)}</span> propina
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

              {/* Transfer: alias gigante */}
              {selectedPayment === 'transfer' && paymentAccounts.length > 0 && (
                <div className="space-y-3">
                  {paymentAccounts.length > 1 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Wallet className="size-3.5" />
                        Cuenta de cobro
                      </p>
                      <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                        <SelectTrigger className="h-11 w-full text-sm">
                          <SelectValue placeholder="Seleccionar cuenta..." />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentAccounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                              <span className="font-medium">{acc.name}</span>
                              {acc.alias_or_cbu && (
                                <span className="ml-2 text-muted-foreground text-xs">
                                  {acc.alias_or_cbu}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {(() => {
                    const selectedAccount = paymentAccounts.find(a => a.id === selectedAccountId) ?? paymentAccounts[0]
                    if (!selectedAccount?.alias_or_cbu) {
                      return (
                        <div className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-center text-sm text-amber-700 dark:text-amber-400">
                          Esta cuenta no tiene alias configurado. Avisá a tu admin.
                        </div>
                      )
                    }
                    return (
                      <AliasCopyHero
                        alias={selectedAccount.alias_or_cbu}
                        accountName={selectedAccount.name}
                        amountText={formatCurrency(totalPrice + tipAmount)}
                      />
                    )
                  })()}
                </div>
              )}

              {/* Propina */}
              {selectedPayment && selectedPayment !== 'points' && (
                <TipSelector
                  baseAmount={totalPrice}
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
                  onClick={finishService}
                  disabled={loading || !selectedPayment}
                >
                  <span className="truncate">
                    {loading
                      ? 'Procesando...'
                      : `Cobrar ${formatCurrency(totalPrice + tipAmount)}`}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </>
      </DialogContent>
    </Dialog >
  )
}
