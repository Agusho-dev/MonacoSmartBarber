'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowLeft, Save, Loader2, Mail, Phone, Store } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { updatePartnerProfile } from '@/lib/actions/partner-portal'
import type { CommercialPartner } from '@/lib/types/database'

export function PartnerProfileClient({ partner }: { partner: CommercialPartner }) {
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    businessName: partner.business_name,
    contactPhone: partner.contact_phone ?? '',
    logoUrl: partner.logo_url ?? '',
  })

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData()
    fd.set('businessName', form.businessName)
    fd.set('contactPhone', form.contactPhone)
    fd.set('logoUrl', form.logoUrl)
    startTransition(async () => {
      const r = await updatePartnerProfile(fd)
      if (r.success) toast.success('Perfil actualizado')
      else toast.error(r.error ?? 'Error')
    })
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/partners/dashboard">
          <ArrowLeft className="size-4 mr-2" />
          Volver
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi perfil</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Información que ven las barberías y, cuando corresponda, sus clientes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            Comercio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                {form.logoUrl && <AvatarImage src={form.logoUrl} alt={form.businessName} />}
                <AvatarFallback className="text-lg">
                  {form.businessName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1">
                <Label htmlFor="logoUrl" className="text-xs">URL del logo</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://..."
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessName">Nombre del comercio</Label>
              <Input
                id="businessName"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="size-3.5" /> Email (solo lectura)
              </Label>
              <Input
                id="email"
                value={partner.contact_email ?? '—'}
                disabled
                readOnly
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                No se puede modificar: es el email con el que iniciás sesión.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone" className="flex items-center gap-1.5">
                <Phone className="size-3.5" /> Teléfono / WhatsApp
              </Label>
              <Input
                id="contactPhone"
                type="tel"
                placeholder="+54 9 11 1234 5678"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Guardar cambios
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
