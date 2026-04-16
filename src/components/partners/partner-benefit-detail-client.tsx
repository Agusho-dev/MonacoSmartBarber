'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  ArrowLeft,
  Pencil,
  Archive,
  Calendar,
  MapPin,
  ImageIcon,
  Loader2,
  Building2,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StatusBadge } from '@/components/dashboard/agreements/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { archiveBenefitByPartner } from '@/lib/actions/partner-portal'
import { BenefitFormClient } from './benefit-form-client'
import type { PartnerBenefit } from '@/lib/types/database'

type Benefit = PartnerBenefit & {
  organization: { id: string; name: string; logo_url: string | null } | null
}

interface Props {
  benefit: Benefit
  orgs: Array<{ id: string; name: string; logo_url: string | null }>
}

export function PartnerBenefitDetailClient({ benefit, orgs }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (editing) {
    return (
      <BenefitFormClient
        mode="edit"
        orgs={orgs}
        initial={{
          ...benefit,
          organization_id: benefit.organization_id,
        }}
      />
    )
  }

  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  const onArchive = () => {
    startTransition(async () => {
      const r = await archiveBenefitByPartner(benefit.id)
      if (r.success) {
        toast.success('Beneficio archivado')
        router.push('/partners/dashboard')
      } else {
        toast.error(r.error ?? 'Error')
      }
    })
  }

  const canEdit = benefit.status !== 'archived'
  const canArchive = benefit.status !== 'archived'

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partners/dashboard">
            <ArrowLeft className="size-4 mr-2" />
            Volver
          </Link>
        </Button>
        <StatusBadge status={benefit.status} />
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4">
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
                <div className="absolute top-4 left-4 bg-primary text-primary-foreground font-bold text-lg px-3 py-1.5 rounded-lg shadow-lg">
                  {benefit.discount_text}
                </div>
              )}
            </div>
            <CardContent className="p-6 space-y-4">
              <div>
                <h1 className="text-2xl font-bold leading-tight">{benefit.title}</h1>
                {benefit.organization && (
                  <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                    <Building2 className="size-4" />
                    <span>{benefit.organization.name}</span>
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
                <h3 className="font-semibold text-red-700 dark:text-red-300">
                  Motivo del rechazo
                </h3>
                <p className="text-sm text-red-700/80 dark:text-red-300/80 mt-1">
                  {benefit.rejection_reason}
                </p>
                <p className="text-xs text-red-700/70 dark:text-red-300/70 mt-2">
                  Editá el beneficio y se reenviará a revisión automáticamente.
                </p>
              </CardContent>
            </Card>
          )}

          {benefit.status === 'pending' && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>
                Este beneficio está <strong>en revisión</strong>. La barbería lo aprobará o rechazará pronto.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar acciones */}
        <div className="space-y-4">
          {(canEdit || canArchive) && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="font-semibold">Acciones</h3>
                {canEdit && (
                  <Button className="w-full" onClick={() => setEditing(true)} disabled={isPending}>
                    <Pencil className="size-4 mr-2" />
                    Editar beneficio
                  </Button>
                )}
                {canArchive && (
                  <Button
                    variant="outline"
                    className="w-full text-red-600 hover:text-red-700"
                    onClick={() => setArchiveOpen(true)}
                    disabled={isPending}
                  >
                    <Archive className="size-4 mr-2" />
                    Archivar
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {benefit.organization && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Barbería</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    {benefit.organization.logo_url && (
                      <AvatarImage src={benefit.organization.logo_url} alt={benefit.organization.name} />
                    )}
                    <AvatarFallback>{benefit.organization.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <p className="font-medium">{benefit.organization.name}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar beneficio?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de aparecer en la app de los clientes. Podés volver a crearlo más adelante si querés reactivarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onArchive} disabled={isPending}>
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
