'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  Plus,
  ImageIcon,
  Calendar,
  Building2,
  Store,
  Eye,
  Sparkles,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  LayoutGrid,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/dashboard/agreements/status-badge'
import type { PartnerBenefit, PartnerBenefitStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'

type BenefitRow = PartnerBenefit & {
  organization: { id: string; name: string; logo_url: string | null } | null
}

type OrgRelation = {
  id: string
  status: string
  invited_at: string
  organization: { id: string; name: string; logo_url: string | null } | null
}

type FilterKey = PartnerBenefitStatus | 'all'

interface Props {
  benefits: BenefitRow[]
  orgs: OrgRelation[]
}

export function PartnerDashboardClient({ benefits, orgs }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: benefits.length }
    for (const b of benefits) c[b.status] = (c[b.status] ?? 0) + 1
    return c
  }, [benefits])

  const filtered = useMemo(
    () => (filter === 'all' ? benefits : benefits.filter((b) => b.status === filter)),
    [filter, benefits]
  )

  const activeOrgs = orgs.filter((o) => o.status === 'active' && o.organization)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-primary/5 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-16 size-48 rounded-full bg-foreground/5 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <LayoutGrid className="size-3" />
              Portal Partners
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Mis beneficios</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Cargá ofertas exclusivas para los clientes de las barberías aliadas. La barbería las
              revisa y aprueba antes de publicarlas en la app.
            </p>
          </div>
          {activeOrgs.length > 0 && (
            <Button asChild size="lg" className="shrink-0 shadow-sm">
              <Link href="/partners/dashboard/benefits/new">
                <Plus className="size-4 mr-2" />
                Nuevo beneficio
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* Stats strip */}
      {benefits.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            icon={LayoutGrid}
            label="Totales"
            value={counts.all ?? 0}
            tone="slate"
          />
          <StatTile
            icon={CheckCircle2}
            label="Aprobados"
            value={counts.approved ?? 0}
            tone="emerald"
          />
          <StatTile
            icon={Clock}
            label="En revisión"
            value={counts.pending ?? 0}
            tone="amber"
          />
          <StatTile
            icon={PauseCircle}
            label="Pausados"
            value={(counts.paused ?? 0) + (counts.rejected ?? 0)}
            tone="slate"
          />
        </section>
      )}

      {/* Orgs aliadas */}
      {activeOrgs.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Barberías aliadas · {activeOrgs.length}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeOrgs.map((rel) => (
              <div
                key={rel.id}
                className="group flex items-center gap-2.5 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition hover:shadow-md"
              >
                <Avatar className="size-6 ring-1 ring-border">
                  {rel.organization?.logo_url && (
                    <AvatarImage src={rel.organization.logo_url} alt={rel.organization.name} />
                  )}
                  <AvatarFallback className="text-[10px] font-semibold">
                    {rel.organization?.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{rel.organization?.name}</span>
                <span className="flex size-1.5 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <EmptyOrgs />
      )}

      {/* Filtros */}
      {benefits.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <TabsList className="h-10 bg-muted/60 p-1">
              <TabsTrigger value="all" className="data-[state=active]:bg-background">
                Todos · {counts.all ?? 0}
              </TabsTrigger>
              <TabsTrigger value="pending" className="data-[state=active]:bg-background">
                En revisión · {counts.pending ?? 0}
              </TabsTrigger>
              <TabsTrigger value="approved" className="data-[state=active]:bg-background">
                Aprobados · {counts.approved ?? 0}
              </TabsTrigger>
              <TabsTrigger value="paused" className="data-[state=active]:bg-background">
                Pausados · {counts.paused ?? 0}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="data-[state=active]:bg-background">
                Rechazados · {counts.rejected ?? 0}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        benefits.length === 0 ? (
          <EmptyBenefits hasActiveOrgs={activeOrgs.length > 0} />
        ) : (
          <div className="rounded-xl border border-dashed bg-card/50 py-16 text-center text-muted-foreground">
            <XCircle className="mx-auto size-8 opacity-40" />
            <p className="mt-2 text-sm">No hay beneficios en este estado.</p>
          </div>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => (
            <BenefitCard key={b.id} benefit={b} />
          ))}
        </div>
      )}
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  tone: 'slate' | 'emerald' | 'amber'
}) {
  const toneMap = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  }
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn('flex size-10 items-center justify-center rounded-lg', toneMap[tone])}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums leading-none mt-1">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BenefitCard({ benefit }: { benefit: BenefitRow }) {
  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : null

  return (
    <Card className="group overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5">
      <Link href={`/partners/dashboard/benefits/${benefit.id}`} className="block">
        <div className="relative aspect-[16/9] bg-muted">
          {benefit.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={benefit.image_url}
              alt={benefit.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-10 opacity-40" />
            </div>
          )}
          {benefit.discount_text && (
            <div className="absolute left-3 top-3 rounded-md bg-primary px-2.5 py-1 text-sm font-bold text-primary-foreground shadow-md">
              {benefit.discount_text}
            </div>
          )}
          <div className="absolute right-3 top-3">
            <StatusBadge status={benefit.status} />
          </div>
        </div>
        <CardContent className="space-y-2 p-4">
          <h3 className="line-clamp-2 min-h-[3rem] font-semibold">{benefit.title}</h3>
          {benefit.organization && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3" />
              <span className="truncate">{benefit.organization.name}</span>
            </div>
          )}
          {(benefit.valid_from || benefit.valid_until) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="size-3" />
              <span>
                {benefit.valid_from && `${dateFmt(benefit.valid_from)}`}
                {benefit.valid_from && benefit.valid_until && ' → '}
                {benefit.valid_until && `${dateFmt(benefit.valid_until)}`}
              </span>
            </div>
          )}
          {benefit.status === 'rejected' && benefit.rejection_reason && (
            <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-red-600 dark:text-red-400">
              {benefit.rejection_reason}
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-2 w-full">
            <Eye className="size-3.5 mr-1.5" />
            Ver detalle
          </Button>
        </CardContent>
      </Link>
    </Card>
  )
}

function EmptyOrgs() {
  return (
    <Card className="border-dashed bg-card/60">
      <CardContent className="p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted">
          <Store className="size-6 text-muted-foreground" />
        </div>
        <h3 className="mt-3 font-semibold">Todavía no tenés convenios activos</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Cuando una barbería te apruebe como partner activo vas a poder cargar beneficios exclusivos para sus clientes.
        </p>
      </CardContent>
    </Card>
  )
}

function EmptyBenefits({ hasActiveOrgs }: { hasActiveOrgs: boolean }) {
  const steps = [
    {
      icon: Sparkles,
      title: 'Armá tu oferta',
      description: 'Título, imagen, descuento y validez.',
    },
    {
      icon: Clock,
      title: 'La barbería revisa',
      description: 'Aprueba o te pide ajustes rápido.',
    },
    {
      icon: CheckCircle2,
      title: 'Publicado en la app',
      description: 'Los clientes lo ven y lo canjean.',
    },
  ]

  return (
    <Card className="overflow-hidden border-dashed">
      <CardContent className="p-6 sm:p-10">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-7" />
          </div>
          <h3 className="mt-4 text-xl font-semibold">Cargá tu primer beneficio</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Subí una oferta exclusiva: la barbería la revisa, aprueba y la mostramos a sus clientes
            en la app.
          </p>
          {hasActiveOrgs && (
            <Button asChild size="lg" className="mt-6 shadow-sm">
              <Link href="/partners/dashboard/benefits/new">
                <Plus className="size-4 mr-2" />
                Crear beneficio
                <ArrowRight className="size-4 ml-2" />
              </Link>
            </Button>
          )}
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="rounded-xl border bg-card p-4 text-left shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <step.icon className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-semibold">{step.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
