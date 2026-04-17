'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MapPin,
  Calendar,
  Mail,
  Phone,
  Loader2,
  ImageIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { approveBenefit, pauseBenefit, unpauseBenefit, rejectBenefit } from '@/lib/actions/agreements'
import { StatusBadge } from './status-badge'
import { RejectDialog } from './reject-dialog'
import type { PartnerBenefit, PartnerBenefitStatus } from '@/lib/types/database'

interface Props {
  benefit: PartnerBenefit & {
    partner: {
      id: string
      business_name: string
      logo_url: string | null
      contact_email: string | null
      contact_phone: string | null
    } | null
  }
}

export function BenefitDetailClient({ benefit }: Props) {
  const router = useRouter()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onApprove = () => {
    startTransition(async () => {
      const r = await approveBenefit(benefit.id)
      if (r.success) {
        toast.success('Convenio aprobado')
        router.refresh()
      } else toast.error(r.error ?? 'Error')
    })
  }

  const onTogglePause = () => {
    startTransition(async () => {
      const r = benefit.status === 'approved'
        ? await pauseBenefit(benefit.id)
        : await unpauseBenefit(benefit.id)
      if (r.success) {
        toast.success(benefit.status === 'approved' ? 'Convenio pausado' : 'Convenio reactivado')
        router.refresh()
      } else toast.error(r.error ?? 'Error')
    })
  }

  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/convenios">
            <ArrowLeft className="size-4 mr-2" />
            Volver
          </Link>
        </Button>
        <StatusBadge status={benefit.status as PartnerBenefitStatus} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          {/* Preview estilo card mobile */}
          <Card className="overflow-hidden">
            <div className="relative aspect-[16/10] bg-muted">
              {benefit.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={benefit.image_url} alt={benefit.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="size-12 opacity-40" />
                </div>
              )}
              {benefit.discount_text && (
                <div className="absolute top-4 left-4">
                  <div className="bg-primary text-primary-foreground font-bold text-lg px-3 py-1.5 rounded-lg shadow-lg">
                    {benefit.discount_text}
                  </div>
                </div>
              )}
            </div>
            <CardContent className="p-6 space-y-4">
              <div>
                <h1 className="text-2xl font-bold leading-tight">{benefit.title}</h1>
                {benefit.partner && (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar className="size-7">
                      {benefit.partner.logo_url && (
                        <AvatarImage src={benefit.partner.logo_url} alt={benefit.partner.business_name} />
                      )}
                      <AvatarFallback className="text-xs">
                        {benefit.partner.business_name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">{benefit.partner.business_name}</span>
                  </div>
                )}
              </div>

              {benefit.description && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Descripción</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{benefit.description}</p>
                </div>
              )}

              {benefit.terms && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Términos y condiciones</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{benefit.terms}</p>
                </div>
              )}

              {(benefit.valid_from || benefit.valid_until) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-4">
                  <Calendar className="size-4" />
                  <span>
                    {benefit.valid_from && `Desde ${dateFmt(benefit.valid_from)}`}
                    {benefit.valid_from && benefit.valid_until && ' — '}
                    {benefit.valid_until && `Hasta ${dateFmt(benefit.valid_until)}`}
                  </span>
                </div>
              )}

              {benefit.location_address && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="size-4 mt-0.5 shrink-0" />
                  <span>{benefit.location_address}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {benefit.status === 'rejected' && benefit.rejection_reason && (
            <Card className="border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900">
              <CardContent className="p-4">
                <h3 className="font-semibold text-red-700 dark:text-red-300">Motivo del rechazo</h3>
                <p className="text-sm text-red-700/80 dark:text-red-300/80 mt-1">{benefit.rejection_reason}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar acciones + info partner */}
        <div className="space-y-4">
          {benefit.status === 'pending' && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="font-semibold">Acciones</h3>
                <Button className="w-full" onClick={onApprove} disabled={isPending}>
                  {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <CheckCircle2 className="size-4 mr-2" />}
                  Aprobar y publicar
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setRejectOpen(true)}
                  disabled={isPending}
                >
                  <XCircle className="size-4 mr-2" />
                  Rechazar
                </Button>
              </CardContent>
            </Card>
          )}

          {(benefit.status === 'approved' || benefit.status === 'paused') && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="font-semibold">Acciones</h3>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={onTogglePause}
                  disabled={isPending}
                >
                  {benefit.status === 'approved' ? (
                    <><PauseCircle className="size-4 mr-2" /> Pausar</>
                  ) : (
                    <><CheckCircle2 className="size-4 mr-2" /> Reactivar</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {benefit.partner && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Partner</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    {benefit.partner.logo_url && (
                      <AvatarImage src={benefit.partner.logo_url} alt={benefit.partner.business_name} />
                    )}
                    <AvatarFallback>
                      {benefit.partner.business_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{benefit.partner.business_name}</p>
                  </div>
                </div>
                {benefit.partner.contact_email && (
                  <a
                    href={`mailto:${benefit.partner.contact_email}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Mail className="size-4" />
                    {benefit.partner.contact_email}
                  </a>
                )}
                {benefit.partner.contact_phone && (
                  <a
                    href={`https://wa.me/${benefit.partner.contact_phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Phone className="size-4" />
                    {benefit.partner.contact_phone}
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={async (reason) => {
          const r = await rejectBenefit(benefit.id, reason)
          if (r.success) {
            toast.success('Convenio rechazado')
            router.refresh()
            setRejectOpen(false)
          } else {
            toast.error(r.error ?? 'Error')
          }
        }}
      />
    </div>
  )
}
