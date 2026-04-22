'use client'

import { useState, useTransition } from 'react'
import { Loader2, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { markAppointmentPayment } from '@/lib/actions/appointments'
import type { Appointment, AppointmentPaymentMethod } from '@/lib/types/database'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment
  staffId?: string
  onDone?: () => void
}

const METHODS: { value: AppointmentPaymentMethod; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'tarjeta_debito', label: 'Tarjeta de débito' },
  { value: 'tarjeta_credito', label: 'Tarjeta de crédito' },
  { value: 'otro', label: 'Otro' },
]

export function AppointmentPaymentDialog({ open, onOpenChange, appointment, staffId, onDone }: Props) {
  const defaultAmount = appointment.service?.price ?? appointment.payment_amount ?? 0
  const [amount, setAmount] = useState<string>(String(defaultAmount))
  const [method, setMethod] = useState<AppointmentPaymentMethod>('efectivo')
  const [status, setStatus] = useState<'paid' | 'partial'>('paid')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Monto inválido')
      return
    }
    startTransition(async () => {
      const res = await markAppointmentPayment({
        appointmentId: appointment.id,
        amount: parsedAmount,
        method,
        status,
        staffId: staffId ?? null,
        notes: notes.trim() || undefined,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Pago registrado')
        onDone?.()
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="size-4" />
            Registrar pago
          </DialogTitle>
          <DialogDescription>
            {appointment.client?.name} · {appointment.service?.name ?? 'Servicio'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Monto</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step={100}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Método de pago</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as AppointmentPaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'paid' | 'partial')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Pagado completo</SelectItem>
                <SelectItem value="partial">Parcial</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comprobante, referencia…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Guardando…</> : 'Registrar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
