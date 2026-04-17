'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  ArrowLeft,
  Store,
  Mail,
  Phone,
  Link2,
  Copy,
  Check,
  MessageCircle,
  Loader2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { invitePartner, type InvitePartnerResult } from '@/lib/actions/partners'

export function InvitePartnerClient() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<InvitePartnerResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    businessName: '',
    contactEmail: '',
    contactPhone: '',
  })

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.businessName.trim()) {
      toast.error('Ingresá el nombre del comercio')
      return
    }
    if (!form.contactEmail.trim() && !form.contactPhone.trim()) {
      toast.error('Ingresá email o teléfono para enviarle el link')
      return
    }

    const fd = new FormData()
    fd.set('businessName', form.businessName)
    fd.set('contactEmail', form.contactEmail)
    fd.set('contactPhone', form.contactPhone)

    startTransition(async () => {
      const r = await invitePartner(fd)
      if (r.success) {
        setResult(r)
        toast.success('Partner invitado correctamente')
      } else {
        toast.error(r.error ?? 'Error al invitar')
      }
    })
  }

  const copyLink = async () => {
    if (!result?.magicLinkUrl) return
    await navigator.clipboard.writeText(result.magicLinkUrl)
    setCopied(true)
    toast.success('Link copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  const inviteAnother = () => {
    setResult(null)
    setForm({ businessName: '', contactEmail: '', contactPhone: '' })
    setCopied(false)
  }

  const formatExpiry = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-2xl mx-auto">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/convenios/partners">
            <ArrowLeft className="size-4 mr-2" />
            Volver a partners
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Store className="size-6 text-primary" />
          Invitar partner
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Creá un comercio aliado y recibirá un link de acceso para cargar sus beneficios.
        </p>
      </div>

      {!result ? (
        <Card>
          <CardHeader>
            <CardTitle>Datos del comercio</CardTitle>
            <CardDescription>
              Al menos uno de los contactos (email o teléfono) es obligatorio para enviarle el link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Nombre del comercio *</Label>
                <Input
                  id="businessName"
                  placeholder="Ej: Cafetería El Roble"
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  maxLength={120}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactEmail" className="flex items-center gap-1.5">
                  <Mail className="size-3.5" /> Email
                </Label>
                <Input
                  id="contactEmail"
                  type="email"
                  placeholder="contacto@comercio.com"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  disabled={isPending}
                />
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
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Si cargás un número, intentaremos enviarle el link por WhatsApp automáticamente.
                </p>
              </div>

              <div className="rounded-lg bg-muted/50 border border-dashed p-3 flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <p>
                  El link caduca en <strong>72 horas</strong>. El partner accederá a su propio portal para
                  cargar y mantener sus beneficios; vos aprobás cada uno antes de que aparezca en la app.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" asChild disabled={isPending}>
                  <Link href="/dashboard/convenios/partners">Cancelar</Link>
                </Button>
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <Link2 className="size-4 mr-2" />
                      Invitar y generar link
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="size-10 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
                <Check className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <CardTitle>¡Partner invitado!</CardTitle>
                <CardDescription>Compartí el link para que cargue sus beneficios.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.whatsappSent ? (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-sm p-3 flex items-start gap-2">
                <MessageCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Enviado por WhatsApp</p>
                  <p className="text-xs opacity-80 mt-0.5">
                    El partner recibió un mensaje en {form.contactPhone}. También podés compartirle el link manualmente abajo.
                  </p>
                </div>
              </div>
            ) : result.whatsappError && form.contactPhone ? (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm p-3 flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">No se pudo enviar por WhatsApp</p>
                  <p className="text-xs opacity-80 mt-0.5">
                    Compartile el link manualmente o revisá la configuración de WhatsApp en ajustes.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Link de acceso
              </Label>
              <div className="rounded-lg border bg-muted p-3 break-all text-sm font-mono">
                {result.magicLinkUrl}
              </div>
              {result.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Caduca el {formatExpiry(result.expiresAt)}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={copyLink} className="flex-1" variant={copied ? 'outline' : 'default'}>
                {copied ? (
                  <>
                    <Check className="size-4 mr-2" />
                    Link copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-2" />
                    Copiar link
                  </>
                )}
              </Button>
              {form.contactEmail && (
                <Button variant="outline" asChild>
                  <a
                    href={`mailto:${form.contactEmail}?subject=${encodeURIComponent(
                      'Link de acceso a tu portal de convenios'
                    )}&body=${encodeURIComponent(
                      `Hola! Te invitamos a sumarte como partner.\n\nAccedé con este link (válido 72h):\n${result.magicLinkUrl}`
                    )}`}
                  >
                    <Mail className="size-4 mr-2" />
                    Email
                  </a>
                </Button>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={inviteAnother}>
                Invitar otro partner
              </Button>
              <Button className="flex-1" onClick={() => router.push('/dashboard/convenios/partners')}>
                <ExternalLink className="size-4 mr-2" />
                Ir a partners
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
