'use client'

import { useState, useTransition } from 'react'
import { Store, Mail, Loader2, Check, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { requestLoginMagicLink } from '@/lib/actions/partner-portal'

export function PartnerLoginClient() {
  const [email, setEmail] = useState('')
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState<{ email: string; devLinkUrl?: string } | null>(null)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Ingresá tu email')
      return
    }
    const fd = new FormData()
    fd.set('email', email)
    startTransition(async () => {
      const r = await requestLoginMagicLink(fd)
      if (r.success) {
        setSent({ email: r.sentTo ?? email, devLinkUrl: r.devLinkUrl })
      } else {
        toast.error(r.error ?? 'Error')
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
            <Store className="size-8" />
          </div>
          <h1 className="text-2xl font-bold">Portal de Partners</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá y gestioná los beneficios que ofrecés a los clientes.
          </p>
        </div>

        {!sent ? (
          <Card>
            <CardHeader>
              <CardTitle>Iniciar sesión</CardTitle>
              <CardDescription>
                Ingresá el email con el que fuiste invitado. Te enviaremos un link de acceso.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="size-3.5" /> Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="contacto@comercio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Enviando link...
                    </>
                  ) : (
                    'Enviar link de acceso'
                  )}
                </Button>
              </form>

              <p className="text-xs text-muted-foreground text-center mt-4">
                ¿Todavía no te invitaron? Contactá al equipo de la barbería.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-200 dark:border-emerald-900">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="size-10 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
                  <Check className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <CardTitle>Link enviado</CardTitle>
                  <CardDescription className="text-xs">
                    Si el email {sent.email} está registrado, recibirás un link en unos minutos.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Revisá tu casilla y spam. El link caduca en 15 minutos.
              </p>

              {sent.devLinkUrl && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Modo desarrollo — link de acceso directo:
                  </p>
                  <a
                    href={sent.devLinkUrl}
                    className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 hover:underline font-mono break-all"
                  >
                    <ExternalLink className="size-3.5 shrink-0" />
                    {sent.devLinkUrl}
                  </a>
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={() => setSent(null)}>
                Volver
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
