import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDashboardOverview } from '@/lib/actions/overview'
import { OverviewClient } from '@/components/dashboard/overview-client'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Star,
  ShieldCheck,
  ArrowRight,
  TrendingUp,
  Users,
  DollarSign,
} from 'lucide-react'

export default async function DashboardPage() {
  const data = await getDashboardOverview()

  // Sin sesión válida — raro en este punto, el layout ya redirige
  if (!data) {
    redirect('/login')
  }

  // Sin sucursales → onboarding
  if (data.branches.length === 0) {
    redirect('/onboarding')
  }

  // Onboarding incompleto → mostrar banner pero no redirigir
  const settings = data.organization?.settings as Record<string, unknown> | null
  const onboardingCompleted = settings?.onboarding_completed === true

  const { setupChecklist } = data

  const pendingSetupItems = [
    !setupChecklist.whatsappConfigurado && {
      key: 'wa',
      label: 'Conectar WhatsApp',
      description: 'Automatizá recordatorios y reviews por WhatsApp.',
      icon: MessageSquare,
      href: '/dashboard/configuracion',
    },
    !setupChecklist.puntosConfigurado && {
      key: 'puntos',
      label: 'Activar programa de puntos',
      description: 'Fidelizá a tus clientes con recompensas.',
      icon: Star,
      href: '/dashboard/fidelizacion',
    },
    !setupChecklist.rolesPersonalizados && {
      key: 'roles',
      label: 'Crear roles personalizados',
      description: 'Definí permisos granulares para tu equipo.',
      icon: ShieldCheck,
      href: '/dashboard/equipo',
    },
  ].filter(Boolean) as {
    key: string
    label: string
    description: string
    icon: React.ComponentType<{ className?: string }>
    href: string
  }[]

  // Estadísticas de hoy
  const clientesToday = new Set(data.todayVisits.map((v) => v.client_id)).size
  const cortesToday = data.todayVisits.length
  const ingresosHoy = data.todayRevenue

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Inicio</h1>
      </div>

      {/* Banner de setup incompleto */}
      {!onboardingCompleted && (
        <div className="flex items-center gap-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
            <AlertTriangle className="size-5 text-yellow-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-yellow-400">Completá tu configuración</p>
            <p className="text-xs text-muted-foreground">
              Tu barbería todavía tiene pasos de setup pendientes.
            </p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href="/onboarding">
              Continuar
              <ArrowRight className="ml-1.5 size-3.5" />
            </Link>
          </Button>
        </div>
      )}

      {/* Métricas del día */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          icon={Users}
          label="Clientes atendidos hoy"
          value={clientesToday}
          format="number"
        />
        <MetricCard
          icon={TrendingUp}
          label="Cortes completados"
          value={cortesToday}
          format="number"
        />
        <MetricCard
          icon={DollarSign}
          label="Ingresos del día"
          value={ingresosHoy}
          format="currency"
        />
      </div>

      {/* Contenido principal + checklist lateral */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Actividad reciente — ocupa 2/3 */}
        <div className="lg:col-span-2">
          <OverviewClient
            todayVisits={data.todayVisits}
            occupancy={[]}
            newClientsCount={data.newClientsThisMonth}
            recentVisits={data.recentVisits}
            clientVisitData={[]}
            branches={data.branches}
          />
        </div>

        {/* Checklist lateral — visible cuando hay items pendientes */}
        {pendingSetupItems.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Pendiente de configurar
            </h2>
            {pendingSetupItems.map((item) => (
              <Link key={item.key} href={item.href} className="block">
                <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                  <CardHeader className="pb-2 gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <item.icon className="size-4 text-muted-foreground" />
                      </div>
                      <CardTitle className="text-sm">{item.label}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {/* Todo configurado */}
            {pendingSetupItems.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-green-500" />
                Todo configurado correctamente.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Componente auxiliar de métrica ──────────────────────────────────────────

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  format: 'number' | 'currency'
}

function MetricCard({ icon: Icon, label, value, format }: MetricCardProps) {
  const displayValue = format === 'currency' ? formatCurrency(value) : String(value)

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tracking-tight">{displayValue}</p>
      </CardContent>
    </Card>
  )
}
