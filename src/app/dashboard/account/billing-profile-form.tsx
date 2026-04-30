'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updateBillingProfile, type BillingProfileInput } from '@/lib/actions/billing'

export function BillingProfileForm({ defaults }: { defaults: Required<{
  billing_email: string
  billing_legal_name: string
  billing_tax_id: string
  billing_address: string
  billing_whatsapp: string
}> }) {
  const [form, setForm] = useState(defaults)
  const [pending, startTransition] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const input: BillingProfileInput = {
        billing_email: form.billing_email || null,
        billing_legal_name: form.billing_legal_name || null,
        billing_tax_id: form.billing_tax_id || null,
        billing_address: form.billing_address || null,
        billing_whatsapp: form.billing_whatsapp || null,
      }
      const res = await updateBillingProfile(input)
      if ('error' in res) {
        toast.error(res.message)
        return
      }
      toast.success('Datos actualizados')
    })
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="billing_email">Email de facturación</Label>
          <Input id="billing_email" type="email" value={form.billing_email} onChange={set('billing_email')} placeholder="cobros@tu-empresa.com" />
        </div>
        <div>
          <Label htmlFor="billing_whatsapp">WhatsApp de contacto</Label>
          <Input id="billing_whatsapp" type="tel" value={form.billing_whatsapp} onChange={set('billing_whatsapp')} placeholder="+54 11 1234 5678" />
        </div>
        <div>
          <Label htmlFor="billing_legal_name">Razón social</Label>
          <Input id="billing_legal_name" value={form.billing_legal_name} onChange={set('billing_legal_name')} placeholder="Ej: Barbería Centro SRL" />
        </div>
        <div>
          <Label htmlFor="billing_tax_id">CUIT / Tax ID</Label>
          <Input id="billing_tax_id" value={form.billing_tax_id} onChange={set('billing_tax_id')} placeholder="20-12345678-9" />
        </div>
      </div>
      <div>
        <Label htmlFor="billing_address">Dirección fiscal</Label>
        <Textarea id="billing_address" value={form.billing_address} onChange={set('billing_address')} rows={2} placeholder="Calle, número, ciudad, provincia" />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </form>
  )
}
