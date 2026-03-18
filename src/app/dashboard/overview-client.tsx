'use client'

import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency, formatDateTime } from '@/lib/format'
import type { Visit, BranchOccupancy } from '@/lib/types/database'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card'
import Link from 'next/link'
import {
  Users,
  Clock,
  Scissors,
  CircleCheck,
  UserPlus,
  UserCheck,
  AlertTriangle,
} from 'lucide-react'

interface ClientVisitRow {
  client_id: string
  branch_id: string
  completed_at: string
}

interface OverviewProps {
  todayVisits: Visit[]
  occupancy: BranchOccupancy[]
  newClientsCount: number
  recentVisits: Visit[]
  clientVisitData: ClientVisitRow[]
  branches: { id: string; name: string }[]
}

export function OverviewClient({
  todayVisits,
  occupancy,
  newClientsCount,
  recentVisits,
  clientVisitData,
  branches,
}: OverviewProps) {
  const { selectedBranchId } = useBranchStore()

  const filterByBranch = <T extends { branch_id: string }>(items: T[]) =>
    selectedBranchId ? items.filter((i) => i.branch_id === selectedBranchId) : items

  const filteredVisits = filterByBranch(todayVisits)
  const filteredOccupancy = filterByBranch(occupancy)
  const filteredRecent = filterByBranch(recentVisits)
  const filteredClientVisits = filterByBranch(clientVisitData)

  const completedToday = filteredVisits.length
  const uniqueClientsToday = new Set(filteredVisits.map((v) => v.client_id)).size
  const clientsWaiting = filteredOccupancy.reduce((s, o) => s + o.clients_waiting, 0)
  const clientsInProgress = filteredOccupancy.reduce((s, o) => s + o.clients_in_progress, 0)

  const totalRevenue = filteredVisits.reduce((s, v) => s + v.amount, 0)
  const revenueByMethod = filteredVisits.reduce(
    (acc, v) => {
      acc[v.payment_method] = (acc[v.payment_method] || 0) + v.amount
      return acc
    },
    {} as Record<string, number>
  )

  const paymentLabels: Record<string, string> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
  }

  const now = Date.now()
  const thirtyDaysMs = 30 * 86400000

  const lastVisitByClient = new Map<string, string>()
  const visitCountByClient = new Map<string, number>()
  filteredClientVisits.forEach((v) => {
    const existing = lastVisitByClient.get(v.client_id)
    if (!existing || v.completed_at > existing) {
      lastVisitByClient.set(v.client_id, v.completed_at)
    }
    visitCountByClient.set(v.client_id, (visitCountByClient.get(v.client_id) || 0) + 1)
  })

  const recurringClients = [...visitCountByClient.values()].filter((c) => c >= 2).length

  const atRiskClients = [...lastVisitByClient.entries()].filter(([, lastVisit]) => {
    const daysSince = Math.floor((now - new Date(lastVisit).getTime()) / 86400000)
    return daysSince >= 25 && daysSince <= 39
  }).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Inicio</h2>
        <BranchSelector branches={branches} />
      </div>

      {atRiskClients > 0 && (
        <Link href="/dashboard/estadisticas">
          <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 transition-colors hover:bg-yellow-500/15">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
              <AlertTriangle className="size-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-yellow-400">
                {atRiskClients} cliente{atRiskClients !== 1 ? 's' : ''} en riesgo
              </p>
              <p className="text-xs text-muted-foreground">
                No han visitado en 25-39 días. Tocá para ver detalles.
              </p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Clientes hoy" value={uniqueClientsToday} icon={Users} />
        <StatCard title="En cola" value={clientsWaiting} icon={Clock} />
        <StatCard title="En atención" value={clientsInProgress} icon={Scissors} />
        <StatCard title="Cortes completados" value={completedToday} icon={CircleCheck} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Ingresos de hoy</CardDescription>
            <CardTitle className="text-3xl">{formatCurrency(totalRevenue)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(revenueByMethod).map(([method, amount]) => (
                <div key={method} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {paymentLabels[method] ?? method}
                  </span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </div>
              ))}
              {Object.keys(revenueByMethod).length === 0 && (
                <p className="text-sm text-muted-foreground">Sin ingresos registrados</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Estadísticas rápidas</CardTitle>
            <CardDescription>Resumen del período</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-3">
              <QuickStat
                icon={UserPlus}
                label="Clientes nuevos"
                value={newClientsCount}
                sub="Este mes"
              />
              <QuickStat
                icon={UserCheck}
                label="Recurrentes"
                value={recurringClients}
                sub="Últimos 30 días"
              />
              <QuickStat
                icon={AlertTriangle}
                label="En riesgo"
                value={atRiskClients}
                sub="25-39 días sin visita"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actividad reciente</CardTitle>
          <CardDescription>Últimas visitas completadas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredRecent.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No hay actividad reciente
              </p>
            )}
            {filteredRecent.map((visit) => (
              <div key={visit.id} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Scissors className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {visit.client?.name ?? 'Cliente'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {visit.service?.name ?? 'Servicio'} &middot;{' '}
                      {visit.barber?.full_name ?? 'Barbero'}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium">{formatCurrency(visit.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(visit.completed_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}

function QuickStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  sub: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
}
