'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { completeService } from '@/lib/actions/queue'
import { saveVisitDetails } from '@/lib/actions/visit-history'
import { updateClientNotes } from '@/lib/actions/clients'
import { compressToWebP, uploadVisitPhotos } from '@/lib/image-utils'
import type { QueueEntry, Service, ServiceTag, PaymentMethod, PaymentAccount } from '@/lib/types/database'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Banknote,
  CreditCard,
  ArrowRightLeft,
  Camera,
  ImagePlus,
  X,
  ArrowRight,
  ArrowLeft,
  Gift,
  ScanFace,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'

const PAYMENT_OPTIONS: {
  value: PaymentMethod | 'points'
  label: string
  icon: React.ElementType
}[] = [
    { value: 'cash', label: 'Efectivo', icon: Banknote },
    { value: 'card', label: 'Tarjeta', icon: CreditCard },
    { value: 'transfer', label: 'Transferencia', icon: ArrowRightLeft },
    { value: 'points', label: 'Puntos', icon: Gift },
  ]

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
  const [tags, setTags] = useState<ServiceTag[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)

  // Step 1 — service details
  const [selectedService, setSelectedService] = useState<string>('')
  const [extraServices, setExtraServices] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [clientNotes, setClientNotes] = useState('')
  const [originalClientNotes, setOriginalClientNotes] = useState('')
  const [showFaceEnroll, setShowFaceEnroll] = useState(false)
  const [hasFaceData, setHasFaceData] = useState(false)

  // Step 2 — payment
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | 'points' | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  useEffect(() => {
    if (!entry) {
      setStep(1)
      setSelectedPayment(null)
      setSelectedService('')
      setExtraServices([])
      setNotes('')
      setSelectedTags([])
      setCustomTag('')
      setPhotoFiles([])
      photoPreviews.forEach(URL.revokeObjectURL)
      setPhotoPreviews([])
      setClientNotes('')
      setOriginalClientNotes('')
      setShowFaceEnroll(false)
      setHasFaceData(false)
      setSelectedAccountId('')
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

      supabase
        .from('client_face_descriptors')
        .select('id')
        .eq('client_id', entry.client_id)
        .limit(1)
        .then(({ data }) => {
          setHasFaceData(!!(data && data.length > 0))
        })
    }

    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .then(({ data }) => {
        if (data) setServices(data as Service[])
      })

    supabase
      .from('service_tags')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setTags(data as ServiceTag[])
      })

    supabase
      .from('payment_accounts')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setPaymentAccounts(data as PaymentAccount[])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, branchId])

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed])
    }
  }

  function removeTag(tag: string) {
    setSelectedTags((prev) => prev.filter((t) => t !== tag))
  }

  function handleCustomTagKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(customTag)
      setCustomTag('')
    }
  }

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
        extraServices.length > 0 ? extraServices : undefined
      )

      if ('error' in result) {
        toast.error(result.error)
        setLoading(false)
        return
      }

      if (result.visitId) {
        let paths: string[] = []
        if (photoFiles.length > 0) {
          const blobs = await Promise.all(photoFiles.map((f) => compressToWebP(f)))
          paths = await uploadVisitPhotos(supabase, result.visitId, blobs)
        }

        const detailResult = await saveVisitDetails(
          result.visitId,
          notes.trim() || null,
          selectedTags.length > 0 ? selectedTags : null,
          paths
        )
        if (detailResult.error) {
          toast.error(detailResult.error)
        }
      }

      if (clientNotes.trim() !== originalClientNotes) {
        await updateClientNotes(entry.client_id, clientNotes.trim() || null, '')
      }

      onCompleted?.()
    } catch {
      toast.error('Error al finalizar el servicio')
    }
    setLoading(false)
    onClose()
  }

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
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

        {showFaceEnroll && entry ? (
          <div className="py-2">
            <FaceEnrollment
              clientId={entry.client_id}
              clientName={entry.client?.name ?? 'Cliente'}
              source="barber"
              onComplete={() => {
                setShowFaceEnroll(false)
                setHasFaceData(true)
                toast.success('Cara registrada correctamente')
              }}
              onSkip={() => setShowFaceEnroll(false)}
            />
          </div>
        ) : (
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
                    <p className="mb-2 text-sm font-medium">
                      Servicio principal{' '}
                      <span className="text-muted-foreground">(opcional)</span>
                    </p>
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

                {/* Service notes */}
                <div>
                  <p className="mb-2 text-sm font-medium">Descripción del corte</p>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej: Degradé bajo, 2 a los costados..."
                    rows={3}
                    className="min-h-[100px] w-full resize-none rounded-lg border bg-transparent p-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Tags */}
                <div>
                  <p className="mb-2 text-sm font-medium">Etiquetas</p>
                  {selectedTags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {selectedTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1">
                          {tag}
                          <button type="button" onClick={() => removeTag(tag)}>
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {tags.length > 0 && (
                      <Select value="" onValueChange={(v) => addTag(v)}>
                        <SelectTrigger className="h-14 flex-1 text-base">
                          <SelectValue placeholder="Predefinidas..." />
                        </SelectTrigger>
                        <SelectContent>
                          {tags
                            .filter((t) => !selectedTags.includes(t.name))
                            .map((t) => (
                              <SelectItem key={t.id} value={t.name}>
                                {t.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      value={customTag}
                      onChange={(e) => setCustomTag(e.target.value)}
                      onKeyDown={handleCustomTagKey}
                      placeholder="Personalizada..."
                      className="h-14 flex-1 text-base"
                    />
                  </div>
                </div>

                {/* Photos */}
                <div>
                  <p className="mb-2 text-sm font-medium">Fotos</p>
                  {photoPreviews.length > 0 && (
                    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                      {photoPreviews.map((url, i) => (
                        <div key={i} className="group relative shrink-0">
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
                  <div className="flex gap-2">
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => handlePhotos(e.target.files)}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handlePhotos(e.target.files)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-14 flex-1 text-base"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="mr-2 size-5" />
                      Cámara
                    </Button>
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

                {/* Face enrollment */}
                {entry && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-14 w-full gap-2 text-base"
                      onClick={() => setShowFaceEnroll(true)}
                    >
                      <ScanFace className="size-5" />
                      {hasFaceData ? 'Actualizar reconocimiento facial' : 'Registrar cara del cliente'}
                    </Button>
                  </div>
                )}

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
              <div className="space-y-6">
                {/* Payment method */}
                <div>
                  <p className="mb-3 text-sm font-medium">Método de pago</p>
                  <div className="grid grid-cols-3 gap-3">
                    {PAYMENT_OPTIONS.map((option) => {
                      if (option.value === 'points' && !entry?.reward_claimed) return null
                      const Icon = option.icon
                      const selected = selectedPayment === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setSelectedPayment(option.value)}
                          className={cn(
                            'flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-colors',
                            selected
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                          )}
                        >
                          <Icon className="size-10" />
                          <span className="text-base font-semibold">{option.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Payment account */}
                {paymentAccounts.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium flex items-center gap-1.5">
                      <Wallet className="size-4" />
                      Cuenta de cobro{' '}
                      <span className="text-muted-foreground">(opcional)</span>
                    </p>
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger className="h-14 w-full text-lg">
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

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-16 px-6 text-lg"
                    onClick={() => setStep(1)}
                    disabled={loading}
                  >
                    <ArrowLeft className="mr-2 size-5" />
                    Atrás
                  </Button>
                  <Button
                    className="h-16 flex-1 text-xl"
                    size="lg"
                    onClick={finishService}
                    disabled={loading || !selectedPayment}
                  >
                    {loading ? 'Procesando...' : 'Confirmar cobro'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
