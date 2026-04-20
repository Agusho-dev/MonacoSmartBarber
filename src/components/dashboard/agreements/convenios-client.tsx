'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Handshake,
  Clock3,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Ticket,
  Plus,
  Store,
  ImageIcon,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { approveBenefit, rejectBenefit, pauseBenefit, unpauseBenefit } from '@/lib/actions/agreements'
import type { PartnerBenefit, PartnerBenefitStatus } from '@/lib/types/database'
import { StatusBadge } from './status-badge'
import { RejectDialog } from './reject-dialog'

interface BenefitRow extends PartnerBenefit {
  partner: { id: string; business_name: string; logo_url: string | null } | null
}

interface PartnerRow {
  id: string
  status: 'active' | 'paused' | 'revoked'
  invited_at: string
  revoked_at: string | null
  partner: {
    id: string
    business_name: string
    contact_email: string | null
    contact_phone: string | null
    logo_url: string | null
    created_at: string
  } | null
}

interface Stats {
  pending: number
  approved: number
  rejected: number
  paused: number
  redemptions: number
}

export function ConveniosClient({
  benefits,
  partners,
  stats,
}: {
  benefits: BenefitRow[]
  partners: PartnerRow[]
  stats: Stats
}) {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'paused' | 'all'>('pending')

  const filtered = useMemo(() => {
    if (tab === 'all') return benefits
    return benefits.filter(b => b.status === tab)
  }, [benefits, tab])

  const activePartnersCount = partners.filter(p => p.status === 'active').length

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Handshake className="size-6 text-primary" />
            Convenios Comerciales
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aprobá los beneficios que tus clientes verán en la app móvil.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/convenios/partners">
              <Store className="size-4 mr-2" />
              Partners ({activePartnersCount})
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/convenios/partners/new">
              <Plus className="size-4 mr-2" />
              Invitar partner
            </Link>
          </Button>
        </div>
      </header>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          icon={<Clock3 className="size-4" />}
          label="Pendientes"
          value={stats.pending}
          tone="amber"
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4" />}
          label="Aprobados"
          value={stats.approved}
          tone="green"
        />
        <MetricCard
          icon={<PauseCircle className="size-4" />}
          label="Pausados"
          value={stats.paused}
          tone="slate"
        />
        <MetricCard
          icon={<XCircle className="size-4" />}
          label="Rechazados"
          value={stats.rejected}
          tone="red"
        />
        <MetricCard
          icon={<Ticket className="size-4" />}
          label="Canjes"
          value={stats.redemptions}
          tone="blue"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-5 w-full sm:w-auto sm:inline-flex">
          <TabsTrigger value="pending">Pendientes</TabsTrigger>
          <TabsTrigger value="approved">Aprobados</TabsTrigger>
          <TabsTrigger value="paused">Pausados</TabsTrigger>
          <TabsTrigger value="rejected">Rechazados</TabsTrigger>
          <TabsTrigger value="all">Todos</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((b) => (
                <BenefitCard key={b.id} benefit={b} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'amber' | 'green' | 'red' | 'slate' | 'blue'
}) {
  const toneClasses: Record<string, string> = {
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300',
    green: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300',
    red: 'text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-300',
    slate: 'text-slate-600 bg-slate-100 dark:bg-slate-800/50 dark:text-slate-300',
    blue: 'text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-300',
  }
  return (
    <Card className="border-muted-foreground/10">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${toneClasses[tone]}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function BenefitCard({ benefit }: { benefit: BenefitRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)

  const isPendingStatus = benefit.status === 'pending'
  const isApproved = benefit.status === 'approved'
  const isPaused = benefit.status === 'paused'

  const onApprove = () => {
    startTransition(async () => {
      const r = await approveBenefit(benefit.id)
      if (r.success) {
        toast.success('Convenio aprobado', { description: 'Ya se muestra en la app de los clientes.' })
        router.refresh()
      } else {
        toast.error(r.error ?? 'Error al aprobar')
      }
    })
  }

  const onPauseToggle = () => {
    startTransition(async () => {
      const r = isApproved ? await pauseBenefit(benefit.id) : await unpauseBenefit(benefit.id)
      if (r.success) {
        toast.success(isApproved ? 'Convenio pausado' : 'Convenio reactivado')
        router.refresh()
      } else {
        toast.error(r.error ?? 'Error')
      }
    })
  }

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="relative aspect-video bg-muted">
        {benefit.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={benefit.image_url}
            alt={benefit.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="size-10 opacity-40" />
          </div>
        )}
        {benefit.discount_text && (
          <div className="absolute top-2 left-2">
            <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded shadow">
              {benefit.discount_text}
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <StatusBadge status={benefit.status as PartnerBenefitStatus} />
        </div>
      </div>

      <CardContent className="flex flex-col flex-1 gap-3 p-4">
        <div>
          <h3 className="font-semibold leading-tight line-clamp-2">{benefit.title}</h3>
          {benefit.partner && (
            <div className="flex items-center gap-2 mt-1.5">
              <Avatar className="size-5">
                {benefit.partner.logo_url && (
                  <AvatarImage src={benefit.partner.logo_url} alt={benefit.partner.business_name} />
                )}
                <AvatarFallback className="text-[10px]">
                  {benefit.partner.business_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground truncate">
                {benefit.partner.business_name}
              </span>
            </div>
          )}
        </div>

        {benefit.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{benefit.description}</p>
        )}

        {benefit.rejection_reason && (
          <div className="text-xs rounded-md bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-2">
            <span className="font-medium">Motivo: </span>
            {benefit.rejection_reason}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-auto pt-2">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/dashboard/convenios/${benefit.id}`}>
              Ver detalle
            </Link>
          </Button>
          {isPendingStatus && (
            <>
              <Button size="sm" onClick={onApprove} disabled={isPending} className="flex-1">
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1" />}
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={isPending}
              >
                <XCircle className="size-3.5" />
              </Button>
            </>
          )}
          {(isApproved || isPaused) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onPauseToggle}
              disabled={isPending}
              className="flex-1"
            >
              {isApproved ? <PauseCircle className="size-3.5 mr-1" /> : <CheckCircle2 className="size-3.5 mr-1" />}
              {isApproved ? 'Pausar' : 'Reactivar'}
            </Button>
          )}
        </div>
      </CardContent>

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
            toast.error(r.error ?? 'Error al rechazar')
          }
        }}
      />
    </Card>
  )
}

function EmptyState({ tab }: { tab: string }) {
  const labels: Record<string, { title: string; sub: string }> = {
    pending: {
      title: 'No hay convenios pendientes',
      sub: 'Cuando un partner cargue un beneficio aparecerá acá para aprobar.',
    },
    approved: {
      title: 'Todavía no hay convenios activos',
      sub: 'Invitá partners y aprobá sus beneficios para que aparezcan en la app.',
    },
    paused: {
      title: 'Ningún convenio pausado',
      sub: 'Los convenios pausados aparecen acá hasta que los reactivés.',
    },
    rejected: {
      title: 'Sin convenios rechazados',
      sub: '—',
    },
    all: {
      title: 'Aún no hay convenios cargados',
      sub: 'Empezá invitando un partner.',
    },
  }
  const { title, sub } = labels[tab] ?? labels.all

  return (
    <div className="text-center py-16 border border-dashed rounded-lg">
      <Handshake className="size-10 mx-auto text-muted-foreground/50" />
      <h3 className="font-semibold mt-3">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{sub}</p>
      <Button asChild className="mt-4">
        <Link href="/dashboard/convenios/partners/new">
          <Plus className="size-4 mr-2" />
          Invitar partner
        </Link>
      </Button>
    </div>
  )
}
