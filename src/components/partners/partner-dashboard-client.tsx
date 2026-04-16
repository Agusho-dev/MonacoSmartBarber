'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  Plus,
  ImageIcon,
  Calendar,
  Building2,
  Filter,
  Store,
  Eye,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/dashboard/agreements/status-badge'
import type { PartnerBenefit, PartnerBenefitStatus } from '@/lib/types/database'

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
      <section className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mis beneficios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá beneficios para que los clientes de las barberías aliadas los vean en la app.
          </p>
        </div>
        {activeOrgs.length > 0 && (
          <Button asChild size="lg" className="shrink-0">
            <Link href="/partners/dashboard/benefits/new">
              <Plus className="size-4 mr-2" />
              Nuevo beneficio
            </Link>
          </Button>
        )}
      </section>

      {/* Orgs aliadas */}
      {activeOrgs.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                Barberías aliadas ({activeOrgs.length})
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeOrgs.map((rel) => (
                <div
                  key={rel.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm"
                >
                  <Avatar className="size-5">
                    {rel.organization?.logo_url && (
                      <AvatarImage src={rel.organization.logo_url} alt={rel.organization.name} />
                    )}
                    <AvatarFallback className="text-[10px]">
                      {rel.organization?.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium">{rel.organization?.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyOrgs />
      )}

      {/* Filtros */}
      {benefits.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="size-4 text-muted-foreground shrink-0" />
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <TabsList className="h-9">
              <TabsTrigger value="all">Todos ({counts.all ?? 0})</TabsTrigger>
              <TabsTrigger value="pending">En revisión ({counts.pending ?? 0})</TabsTrigger>
              <TabsTrigger value="approved">Aprobados ({counts.approved ?? 0})</TabsTrigger>
              <TabsTrigger value="paused">Pausados ({counts.paused ?? 0})</TabsTrigger>
              <TabsTrigger value="rejected">Rechazados ({counts.rejected ?? 0})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        benefits.length === 0 ? (
          <EmptyBenefits hasActiveOrgs={activeOrgs.length > 0} />
        ) : (
          <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
            No hay beneficios en este estado.
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

function BenefitCard({ benefit }: { benefit: BenefitRow }) {
  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : null

  return (
    <Card className="overflow-hidden hover:shadow-md transition">
      <Link href={`/partners/dashboard/benefits/${benefit.id}`} className="block">
        <div className="relative aspect-[16/9] bg-muted">
          {benefit.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={benefit.image_url} alt={benefit.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <ImageIcon className="size-10 opacity-40" />
            </div>
          )}
          {benefit.discount_text && (
            <div className="absolute top-3 left-3 bg-primary text-primary-foreground text-sm font-bold px-2.5 py-1 rounded-md shadow">
              {benefit.discount_text}
            </div>
          )}
          <div className="absolute top-3 right-3">
            <StatusBadge status={benefit.status} />
          </div>
        </div>
        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold line-clamp-2 min-h-[3rem]">{benefit.title}</h3>
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
            <p className="text-xs text-red-600 dark:text-red-400 line-clamp-2 border-l-2 border-red-300 pl-2 mt-2">
              {benefit.rejection_reason}
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full mt-2">
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
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <Store className="size-12 mx-auto text-muted-foreground/40" />
        <h3 className="font-semibold mt-3">Todavía no tenés convenios activos</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Cuando una barbería te apruebe como partner activo vas a poder cargar beneficios exclusivos para sus clientes.
        </p>
      </CardContent>
    </Card>
  )
}

function EmptyBenefits({ hasActiveOrgs }: { hasActiveOrgs: boolean }) {
  return (
    <div className="text-center py-16 border border-dashed rounded-lg">
      <Sparkles className="size-12 mx-auto text-muted-foreground/40" />
      <h3 className="font-semibold mt-4 text-lg">Cargá tu primer beneficio</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        Subí una oferta exclusiva: la barbería la revisa, aprueba y la mostramos a sus clientes en la app.
      </p>
      {hasActiveOrgs && (
        <Button asChild className="mt-6">
          <Link href="/partners/dashboard/benefits/new">
            <Plus className="size-4 mr-2" />
            Crear beneficio
          </Link>
        </Button>
      )}
    </div>
  )
}
