'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { completeService } from '@/lib/actions/queue'
import type { QueueEntry, Service, PaymentMethod } from '@/lib/types/database'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Banknote, CreditCard, ArrowRightLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const PAYMENT_OPTIONS: {
  value: PaymentMethod
  label: string
  icon: typeof Banknote
}[] = [
  { value: 'cash', label: 'Efectivo', icon: Banknote },
  { value: 'card', label: 'Tarjeta', icon: CreditCard },
  { value: 'transfer', label: 'Transferencia', icon: ArrowRightLeft },
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
  const [services, setServices] = useState<Service[]>([])
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | null>(
    null
  )
  const [selectedService, setSelectedService] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!entry) {
      setSelectedPayment(null)
      setSelectedService('')
      return
    }

    const supabase = createClient()
    supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .then(({ data }) => {
        if (data) setServices(data as Service[])
      })
  }, [entry, branchId])

  async function handleConfirm() {
    if (!entry || !selectedPayment) return
    setLoading(true)
    const result = await completeService(
      entry.id,
      selectedPayment,
      selectedService || undefined
    )
    if ('error' in result) {
      toast.error(result.error)
    } else {
      onCompleted?.()
    }
    setLoading(false)
    onClose()
  }

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Finalizar servicio</DialogTitle>
          <DialogDescription>
            Cliente: {entry?.client?.name}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-medium">Método de pago</p>
            <div className="grid grid-cols-3 gap-3">
              {PAYMENT_OPTIONS.map((option) => {
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
                    <span className="text-sm font-medium">{option.label}</span>
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
              <Select value={selectedService} onValueChange={setSelectedService}>
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
            onClick={handleConfirm}
            disabled={!selectedPayment || loading}
          >
            {loading ? 'Procesando...' : 'Confirmar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
