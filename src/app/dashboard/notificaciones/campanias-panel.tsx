'use client'

// Pestaña Campañas: tarjetas de resumen + tabla de campañas con sus acciones.

import { useState, useTransition } from 'react'
import {
  AlertTriangle, BellRing, CalendarClock, Copy, Loader2, Megaphone, Plus, Send, Smartphone, Trash2, X, CheckCircle2, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  cancelPushCampaign, deletePushCampaignDraft, sendPushCampaign,
  type PushCampaignRow, type PushOverview,
} from '@/lib/actions/push-notifications'
import { PUSH_STATUS_LABEL, etiquetaDestino, branchIdDeDeepLink } from '@/lib/push/constants'
import { describirFiltros, type AudienceBranch, type AudienceTag } from './audience-filters'
import { STATUS_BADGE, fmtFechaHora, fmtFechaLarga } from './helpers'

interface Props {
  campaigns: PushCampaignRow[]
  error: string | null
  overview: PushOverview
  canManage: boolean
  timezone: string
  branches: AudienceBranch[]
  tags: AudienceTag[]
  onNueva: () => void
  onDuplicar: (c: PushCampaignRow) => void
  onChanged: (c: PushCampaignRow) => void
  onDeleted: (id: string) => void
}

function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  hint?: string
  tone?: 'emerald' | 'sky' | 'amber'
}) {
  const toneCls = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'sky' ? 'text-sky-600 dark:text-sky-400'
    : tone === 'amber' ? 'text-amber-700 dark:text-amber-400'
    : 'text-foreground'
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{typeof value === 'number' ? value.toLocaleString('es-AR') : value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function CampaniasPanel({
  campaigns, error, overview, canManage, timezone, branches, tags, onNueva, onDuplicar, onChanged, onDeleted,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<{ tipo: 'send' | 'cancel' | 'delete'; c: PushCampaignRow } | null>(null)

  const ejecutar = (tipo: 'send' | 'cancel' | 'delete', c: PushCampaignRow) => {
    setBusy(c.id)
    startTransition(async () => {
      try {
        if (tipo === 'send') {
          const r = await sendPushCampaign(c.id)
          if ('error' in r) { toast.error(r.error, { duration: 8000 }); return }
          toast.success(r.envio.estado === 'scheduled'
            ? `Programada para ${r.envio.encolados} cliente${r.envio.encolados === 1 ? '' : 's'}`
            : `Enviando a ${r.envio.encolados} cliente${r.envio.encolados === 1 ? '' : 's'} con la app`)
          onChanged({ ...c, status: r.envio.estado, audience_count: r.envio.audiencia, no_token_count: r.envio.sinApp, started_at: new Date().toISOString() })
        } else if (tipo === 'cancel') {
          const r = await cancelPushCampaign(c.id)
          if ('error' in r) { toast.error(r.error); return }
          toast.success(r.canceladas > 0 ? `Campaña cancelada · ${r.canceladas} pendientes no se van a enviar` : 'Campaña cancelada')
          onChanged({ ...c, status: 'cancelled', completed_at: new Date().toISOString() })
        } else {
          const r = await deletePushCampaignDraft(c.id)
          if ('error' in r) { toast.error(r.error); return }
          toast.success('Borrador eliminado')
          onDeleted(c.id)
        }
      } finally {
        setBusy(null)
      }
    })
  }

  const pedirConfirmacion = (tipo: 'send' | 'cancel' | 'delete', c: PushCampaignRow) => setConfirm({ tipo, c })

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Smartphone} label="Clientes con la app" value={overview.clientsWithApp} tone="emerald"
          hint={overview.activeTokens !== overview.clientsWithApp ? `${overview.activeTokens.toLocaleString('es-AR')} dispositivos activos` : 'Pueden recibir notificaciones'} />
        <Stat icon={Megaphone} label="Campañas enviadas" value={overview.campaigns.sent} hint={`${overview.campaigns.total.toLocaleString('es-AR')} creadas en total`} />
        <Stat icon={CheckCircle2} label="Notificaciones entregadas" value={overview.campaigns.pushSent} hint="Sumando todas las campañas" />
        <Stat icon={Clock} label="En cola" value={overview.outboxPending} tone={overview.outboxPending > 0 ? 'amber' : undefined}
          hint={overview.campaigns.scheduled > 0 ? `${overview.campaigns.scheduled} campaña${overview.campaigns.scheduled === 1 ? '' : 's'} programada${overview.campaigns.scheduled === 1 ? '' : 's'}` : 'Se procesa cada minuto'} />
      </div>

      {error && (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <BellRing className="size-7 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-base font-semibold">Todavía no mandaste ninguna campaña</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Una campaña es una notificación push a un grupo de clientes con la app: una promo, un aviso de horario, un recordatorio de que hace rato no vienen.
          </p>
          {canManage && (
            <Button className="mt-5" onClick={onNueva}>
              <Plus className="size-4" /> Crear la primera campaña
            </Button>
          )}
        </div>
      ) : !error && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Campaña</TableHead>
                <TableHead className="min-w-[160px]">Audiencia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="min-w-[170px]">Resultado</TableHead>
                <TableHead className="min-w-[96px]">Fecha</TableHead>
                {canManage && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map(c => {
                const total = c.audience_count ?? 0
                const sinApp = c.no_token_count ?? 0
                const conApp = Math.max(0, total - sinApp)
                const enviados = c.sent_count ?? 0
                const fallidos = c.failed_count ?? 0
                const pct = conApp > 0 ? Math.min(100, Math.round((enviados / conApp) * 100)) : 0
                const esBusy = busy === c.id
                const nombreSucursal = branches.find(b => b.id === branchIdDeDeepLink(c.deep_link))?.name
                const fechaRef = c.status === 'scheduled' ? c.scheduled_for : (c.completed_at ?? c.started_at ?? c.created_at)
                return (
                  <TableRow key={c.id} className="align-top">
                    <TableCell>
                      {/* Ancho acotado: sin esto el cuerpo completo de la campaña
                          estira la columna y empuja Resultado/Acciones fuera de la
                          vista (la tabla es auto-layout; `line-clamp` solo no alcanza). */}
                      <div className="min-w-[200px] max-w-[300px]">
                        <p className="truncate font-medium leading-tight" title={c.name}>{c.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`${c.title} — ${c.body}`}>
                          <span className="font-medium text-foreground/80">{c.title}</span> · {c.body}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Abre: {etiquetaDestino(c.deep_link, nombreSucursal)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="line-clamp-2 max-w-[240px] text-xs">{describirFiltros(c.audience_filters, branches, tags)}</p>
                      {c.audience_count != null && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {total.toLocaleString('es-AR')} clientes · {conApp.toLocaleString('es-AR')} con la app
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE[c.status] ?? ''}>
                        {c.status === 'sending' && <Loader2 className="size-3 animate-spin" />}
                        {PUSH_STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.status === 'draft' ? (
                        <span className="text-xs text-muted-foreground">Sin enviar</span>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-x-3 text-xs">
                            <span className="text-emerald-600 dark:text-emerald-400">{enviados.toLocaleString('es-AR')} enviados</span>
                            {fallidos > 0 && <span className="text-destructive">{fallidos.toLocaleString('es-AR')} fallidos</span>}
                            {sinApp > 0 && <span className="text-muted-foreground">{sinApp.toLocaleString('es-AR')} sin app</span>}
                          </div>
                          {conApp > 0 && (
                            <div className="h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs tabular-nums">{fmtFechaHora(fechaRef, timezone)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.status === 'scheduled' ? 'programada' : c.status === 'sent' ? 'completada' : c.status === 'sending' ? 'iniciada' : 'creada'}
                      </p>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {(c.status === 'draft' || c.status === 'scheduled') && (
                            <Button size="sm" variant={c.status === 'draft' ? 'default' : 'outline'} disabled={esBusy}
                              onClick={() => pedirConfirmacion('send', c)} title={c.status === 'draft' && c.scheduled_for ? 'Encolar respetando la hora programada' : 'Enviar ahora'}>
                              {esBusy ? <Loader2 className="size-4 animate-spin" /> : c.status === 'draft' && c.scheduled_for ? <CalendarClock className="size-4" /> : <Send className="size-4" />}
                              {c.status === 'draft' ? (c.scheduled_for ? 'Programar' : 'Enviar') : 'Enviar ahora'}
                            </Button>
                          )}
                          <Button size="icon-sm" variant="ghost" title="Duplicar" aria-label="Duplicar campaña" onClick={() => onDuplicar(c)}>
                            <Copy className="size-4" />
                          </Button>
                          {['scheduled', 'sending'].includes(c.status) && (
                            <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" title="Cancelar" aria-label="Cancelar campaña" disabled={esBusy}
                              onClick={() => pedirConfirmacion('cancel', c)}>
                              <X className="size-4" />
                            </Button>
                          )}
                          {c.status === 'draft' && (
                            <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" title="Eliminar borrador" aria-label="Eliminar borrador" disabled={esBusy}
                              onClick={() => pedirConfirmacion('delete', c)}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.tipo === 'send' && (confirm.c.scheduled_for && confirm.c.status === 'draft' ? 'Programar campaña' : 'Enviar campaña ahora')}
              {confirm?.tipo === 'cancel' && 'Cancelar campaña'}
              {confirm?.tipo === 'delete' && 'Eliminar borrador'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.tipo === 'send' && (
                confirm.c.scheduled_for && confirm.c.status === 'draft'
                  ? `"${confirm.c.name}" se va a encolar para el ${fmtFechaLarga(confirm.c.scheduled_for, timezone)} a los clientes de la audiencia que tengan la app con notificaciones activas.`
                  : `"${confirm.c.name}" le va a llegar en el próximo minuto a todos los clientes de la audiencia que tengan la app con notificaciones activas. No se puede deshacer una vez enviada.`
              )}
              {confirm?.tipo === 'cancel' && `Las notificaciones de "${confirm.c.name}" que todavía no salieron no se van a enviar. Las que ya se entregaron no se pueden retirar.`}
              {confirm?.tipo === 'delete' && `El borrador "${confirm.c.name}" se elimina definitivamente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.tipo !== 'send' ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
              onClick={() => { if (confirm) ejecutar(confirm.tipo, confirm.c); setConfirm(null) }}>
              {confirm?.tipo === 'send' ? (confirm.c.scheduled_for && confirm.c.status === 'draft' ? 'Programar' : 'Enviar ahora') : confirm?.tipo === 'cancel' ? 'Cancelar campaña' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
