'use client'

// Pestaña Dispositivos: cuántos clientes tienen la app con notificaciones y los
// últimos registros. Nunca se muestra el token en claro: es una credencial.

import { AlertTriangle, Apple, Smartphone, TabletSmartphone, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { PushOverview } from '@/lib/actions/push-notifications'
import { fmtFechaHora, fmtRelativo } from './helpers'

interface Props {
  overview: PushOverview
  timezone: string
}

function Stat({ icon: Icon, label, value, hint }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString('es-AR')}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function DispositivosPanel({ overview, timezone }: Props) {
  const total = overview.activeTokens
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '—')

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Clientes con la app" value={overview.clientsWithApp} hint="Con al menos un dispositivo activo" />
        <Stat icon={TabletSmartphone} label="Dispositivos activos" value={overview.activeTokens} hint="Un cliente puede tener más de uno" />
        <Stat icon={Apple} label="iPhone" value={overview.ios} hint={`${pct(overview.ios)} de los dispositivos`} />
        <Stat icon={Smartphone} label="Android" value={overview.android} hint={`${pct(overview.android)} de los dispositivos`} />
      </div>

      {overview.error && (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{overview.error}</span>
        </div>
      )}

      {overview.recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Smartphone className="size-7 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-base font-semibold">Todavía ningún cliente registró la app</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Cuando un cliente instala la app, inicia sesión con su teléfono y acepta las notificaciones, su dispositivo aparece acá y pasa a poder recibir campañas y avisos automáticos.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Últimos registros</p>
            <p className="text-[11px] text-muted-foreground">Los {overview.recent.length} dispositivos más recientes. El identificador del dispositivo no se muestra.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Versión de la app</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead>Registrado</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.recent.map((d, i) => (
                <TableRow key={`${d.client_id}-${i}`}>
                  <TableCell className="font-medium">{d.client_name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      {d.platform === 'ios' ? <Apple className="size-3.5 text-muted-foreground" /> : <Smartphone className="size-3.5 text-muted-foreground" />}
                      {d.platform === 'ios' ? 'iPhone' : 'Android'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.app_version ?? '—'}</TableCell>
                  <TableCell className="text-sm" title={d.last_seen_at ? fmtFechaHora(d.last_seen_at, timezone) : undefined}>{fmtRelativo(d.last_seen_at)}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtFechaHora(d.created_at, timezone)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={d.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border bg-muted text-muted-foreground'}>
                      {d.is_active ? 'Activo' : 'Dado de baja'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
