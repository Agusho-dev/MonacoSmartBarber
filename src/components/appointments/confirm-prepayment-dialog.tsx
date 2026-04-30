'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, HandCoins } from 'lucide-react'
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
import { confirmAppointmentPrepayment } from '@/lib/actions/appointments'
import { getPaymentAccounts } from '@/lib/actions/paymentAccounts'
import type { Appointment, AppointmentPaymentMethod, PaymentAccount } from '@/lib/types/database'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment
  staffId?: string
  /** Monto pre-calculado según settings (fixed o percentage). */
  defaultAmount: number
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

export function ConfirmPrepaymentDialog({ open, onOpenChange, appointment, staffId, defaultAmount, onDone }: Props) {
  const [amount, setAmount] = useState<string>(String(defaultAmount || appointment.service?.price || 0))
  const [method, setMethod] = useState<AppointmentPaymentMethod>('efectivo')
  const [paymentAccountId, setPaymentAccountId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [accounts, setAccounts] = useState<PaymentAccount[]>([])
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || !appointment.branch_id) return
    getPaymentAccounts(appointment.branch_id).then((res) => {
      setAccounts((res.data as PaymentAccount[] | null) ?? [])
    }).catch(() => setAccounts([]))
  }, [open, appointment.branch_id])

  // Sincronizar `amount` cuando cambian los inputs derivados.
  // Diferimos el setState con queueMicrotask para evitar cascading renders.
  useEffect(() => {
    queueMicrotask(() => {
      setAmount(String(defaultAmount || appointment.service?.price || 0))
    })
  }, [defaultAmount, appointment.service?.price])

  const needsAccount = method === 'transferencia' || method === 'mercadopago'

  function handleSave() {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Monto inválido')
      return
    }
    startTransition(async () => {
      const res = await confirmAppointmentPrepayment({
        appointmentId: appointment.id,
        method,
        amount: parsedAmount,
        paymentAccountId: needsAccount && paymentAccountId ? paymentAccountId : null,
        staffId: staffId ?? null,
        notes: notes.trim() || undefined,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        const msg = res.paymentStatus === 'paid'
          ? 'Pago confirmado · turno activo'
          : 'Seña registrada · turno activo'
        toast.success(msg)
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
            <HandCoins className="size-4" />
            Confirmar prepago
          </DialogTitle>
          <DialogDescription>
            {appointment.client?.name} · {appointment.service?.name ?? 'Servicio'}
            {appointment.service?.price ? ` · ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(appointment.service.price))}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Monto recibido</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step={100}
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              Default según configuración. Si es menor al precio del servicio, queda como seña (parcial).
            </p>
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

          {needsAccount && accounts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Cuenta</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cuenta…" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
            {isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Guardando…</> : 'Confirmar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
