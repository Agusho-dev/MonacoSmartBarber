'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { completeService } from '@/lib/actions/queue'
import { saveVisitDetails } from '@/lib/actions/visit-history'
import { updateClientNotes } from '@/lib/actions/clients'
import { compressToWebP, uploadVisitPhotos } from '@/lib/image-utils'
import type { QueueEntry, Service, ServiceTag, PaymentMethod } from '@/lib/types/database'
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
  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | 'points' | null>(null)
  const [selectedService, setSelectedService] = useState<string>('')

  // Step 2
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

  useEffect(() => {
    if (!entry) {
      setStep(1)
      setSelectedPayment(null)
      setSelectedService('')
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
      return
    }

    if (entry.client_id) {
      supabase
        .from('clients')
        .select('notes')
        .eq('id', entry.client_id)
        .single()
        .then(({ data }) => {
          const notes = data?.notes ?? ''
          setClientNotes(notes)
          setOriginalClientNotes(notes)
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

  async function finishService(includeDetails: boolean) {
    if (!entry || !selectedPayment) return
    setLoading(true)

    try {
      const result = await completeService(
        entry.id,
        selectedPayment === 'points' ? 'cash' : selectedPayment, // Backend will handle points separately later, defaults to cash to satisfy db enum for now
        selectedService || undefined,
        selectedPayment === 'points' // pass a flag to the backend action
      )

      if ('error' in result) {
        toast.error(result.error)
        setLoading(false)
        return
      }

      if (includeDetails && result.visitId) {
        let paths: string[] = []
        if (photoFiles.length > 0) {
          const blobs = await Promise.all(
            photoFiles.map((f) => compressToWebP(f))
          )
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

      // Save client notes if changed
      if (clientNotes.trim() !== originalClientNotes) {
        await updateClientNotes(
          entry.client_id,
          clientNotes.trim() || null
        )
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Finalizar servicio' : 'Detalles del corte'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Cliente: ${entry?.client?.name}`
              : 'Opcional: agregá notas, etiquetas o fotos'}
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
        {entry?.reward_claimed && step === 1 && (
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-4 text-purple-600 dark:text-purple-400 flex items-start gap-3">
            <Gift className="size-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">El cliente solicita canjear un premio</p>
              <p className="text-xs mt-1 opacity-90">Seleccioná "Puntos" como método de pago para registrar el servicio a costo $0 y descontar los puntos.</p>
            </div>
          </div>
        )}

        {step === 1 ? (
          <div className="space-y-6">
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
                        'flex flex-col items-center gap-2.5 rounded-xl border-2 p-5 transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                      )}
                    >
                      <Icon className="size-8" />
                      <span className="text-sm font-medium">
                        {option.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {services.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  Servicio realizado{' '}
                  <span className="text-muted-foreground">(opcional)</span>
                </p>
                <Select
                  value={selectedService}
                  onValueChange={setSelectedService}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar servicio" />
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

            <Button
              className="w-full"
              size="lg"
              onClick={() => setStep(2)}
              disabled={!selectedPayment}
            >
              Siguiente
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Service notes */}
            <div>
              <p className="mb-2 text-sm font-medium">Descripción del corte</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Degradé bajo, 2 a los costados..."
                rows={2}
                className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                  <Select
                    value=""
                    onValueChange={(v) => {
                      addTag(v)
                    }}
                  >
                    <SelectTrigger className="flex-1">
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
                  className="flex-1"
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
                  size="sm"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1"
                >
                  <Camera className="mr-2 size-4" />
                  Cámara
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1"
                >
                  <ImagePlus className="mr-2 size-4" />
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
                rows={2}
                className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Face enrollment */}
            {entry && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFaceEnroll(true)}
                  className="w-full gap-2"
                >
                  <ScanFace className="size-4" />
                  {hasFaceData ? 'Actualizar reconocimiento facial' : 'Registrar cara del cliente'}
                </Button>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(1)}
                disabled={loading}
              >
                <ArrowLeft className="mr-1 size-3" />
                Atrás
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => finishService(false)}
                disabled={loading}
              >
                Omitir
              </Button>
              <Button
                className="flex-1"
                size="lg"
                onClick={() => finishService(true)}
                disabled={loading}
              >
                {loading ? 'Procesando...' : 'Confirmar'}
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
