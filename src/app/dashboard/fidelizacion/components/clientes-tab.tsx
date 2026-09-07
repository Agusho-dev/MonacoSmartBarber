'use client'

// =============================================================================
// Clientes: buscador → ficha del cliente en el programa (tarjeta, progreso,
// gracia, lotes con vencimiento, beneficios, referidos, visitas, historial) y
// las acciones administrativas: ajustar puntos, canjear en su nombre, cancelar
// un beneficio, revertir los puntos de una visita.
// =============================================================================

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowUpDown, Clock, Gift, History, Loader2, QrCode, Search, Smartphone, Undo2, UserPlus, XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  adjustClientPoints, cancelClientReward, getClientLoyaltySummary, redeemRewardForClient, reverseVisitPoints, searchLoyaltyClients,
  type LoyaltyClientHit,
} from '@/lib/actions/loyalty'
import type { LoyaltyClientReward, LoyaltyClientSummary, LoyaltyClientVisit, LoyaltyReward, LoyaltySettings, LoyaltyTier, LoyaltyTierCode } from '@/lib/types/loyalty'
import { MonacoCardPreview } from './monaco-card-preview'
import { describirEvento, diasHasta, fmtFecha, fmtFechaHora, fmtRelativo, numero, pesos, REFERRAL_STATUS_CLASS, REFERRAL_STATUS_LABEL, TX_TYPE_LABEL } from './helpers'

interface Props {
  tiers: LoyaltyTier[]
  rewards: LoyaltyReward[]
  settings: LoyaltySettings
  canManage: boolean
  timezone: string
}

const STATUS_LABEL: Record<string, string> = { available: 'Disponible', redeemed: 'Utilizado', expired: 'Vencido', cancelled: 'Cancelado' }
const STATUS_CLASS: Record<string, string> = {
  available: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  redeemed: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  expired: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground line-through',
}

export function ClientesTab({ tiers, rewards, settings, canManage, timezone }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<LoyaltyClientHit[]>([])
  // Para qué consulta llegó la última respuesta: sin esto no se puede
  // distinguir "terminó y no hay nadie" de "todavía no buscó".
  const [buscado, setBuscado] = useState('')
  const [buscando, startSearch] = useTransition()
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [ficha, setFicha] = useState<LoyaltyClientSummary | null>(null)
  const [cargando, startLoad] = useTransition()

  // Diálogos
  const [ajuste, setAjuste] = useState(false)
  const [canje, setCanje] = useState(false)
  const [cancelar, setCancelar] = useState<LoyaltyClientReward | null>(null)
  const [revertir, setRevertir] = useState<LoyaltyClientVisit | null>(null)

  useEffect(() => {
    // Con menos de 2 letras el server devuelve [] igual: no vale un viaje. La
    // pestaña queda montada aunque no se vea, así que sin este corte pegaba al
    // server en cada carga de la página. La lista se oculta por la misma condición.
    if (q.trim().length < 2) return
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchLoyaltyClients(q)
        if ('error' in r) { toast.error(r.error); return }
        setHits(r.data)
        // El server trimea: comparar contra lo trimeado. Un error no la toca,
        // así que nunca imprime un falso "sin resultados".
        setBuscado(q.trim())
      })
    }, 250)
    return () => clearTimeout(t)
  }, [q, startSearch])

  function cargar(id: string) {
    setClienteId(id)
    startLoad(async () => {
      const r = await getClientLoyaltySummary(id)
      if ('error' in r) { toast.error(r.error); return }
      setFicha(r.data)
    })
  }

  function recargar() {
    if (clienteId) cargar(clienteId)
    router.refresh()
  }

  const tier = ficha?.state?.tier_code ? tiers.find(t => t.code === ficha.state!.tier_code) ?? null : null
  // Sin categoría la tarjeta va APAGADA (vidrio gris, sin chip ni etiqueta),
  // que es lo que ve el cliente en la app; los colores del fallback no se pintan.
  const look = tier ?? { code: 'bronce' as const, name: 'Sin categoría', color_primary: '#27272a', color_secondary: '#52525b', text_color: '#FFFFFF' }
  const nombresTier = Object.fromEntries(tiers.map(t => [t.code, t.name]))
  const graciaDias = diasHasta(ficha?.state?.grace_until)
  const catalogoActivo = rewards.filter(r => r.is_active && r.points_cost > 0)

  return (
    <div className="space-y-5">
      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={e => {
            const v = e.target.value
            setQ(v)
            // Por debajo de 2 letras no se busca: se vacía ACÁ (no en el
            // effect, que el lint del compilador rechaza) para que al volver a
            // 2 letras no aparezcan por un instante los hits de la consulta
            // anterior.
            if (v.trim().length < 2) { setHits([]); setBuscado('') }
          }}
          placeholder="Buscá por nombre o teléfono…"
          className="h-11 pl-9 text-base"
          aria-label="Buscar cliente"
          autoComplete="off"
        />
        {buscando && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {q.trim().length >= 2 && hits.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 shadow-2xl" role="listbox">
            {hits.map(h => (
              <li key={h.id}>
                <button type="button" role="option" aria-selected={h.id === clienteId} onClick={() => { cargar(h.id); setQ(''); setHits([]); setBuscado('') }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-white/[0.05]">
                  <span className="truncate">{h.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{h.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* `buscado === q.trim()` evita mostrar "sin resultados" mientras la
            respuesta que viene en camino es de otra consulta. */}
        {!buscando && q.trim().length >= 2 && buscado === q.trim() && hits.length === 0 && (
          <p className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-muted-foreground shadow-2xl">
            Sin resultados para «{q.trim()}». Probá con el teléfono.
          </p>
        )}
      </div>

      {!ficha && !cargando && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-14 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Buscá un cliente para ver su categoría, sus puntos y todo lo que le pasó en el programa.</p>
        </div>
      )}
      {cargando && !ficha && (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando ficha…</div>
      )}

      {ficha && (
        <div className={cn('space-y-5 transition-opacity', cargando && 'opacity-60')}>
          {/* Cabecera: tarjeta + estado + acciones */}
          <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <MonacoCardPreview tier={look} apagada={!tier} points={ficha.balance} clientName={ficha.client.name} memberSince={ficha.state?.enrolled_at ?? ficha.client.created_at} />
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">{ficha.client.name}</h3>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {ficha.client.phone} · cliente desde {fmtFecha(ficha.client.created_at, timezone)}
                    {ficha.client.has_app && <span className="ml-2 inline-flex items-center gap-1 text-sky-400"><Smartphone className="size-3" /> con la app</span>}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAjuste(true)}><ArrowUpDown className="size-4" /> Ajustar puntos</Button>
                    <Button size="sm" onClick={() => setCanje(true)} disabled={!settings.is_enabled || catalogoActivo.length === 0}><Gift className="size-4" /> Canjear premio</Button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4">
                {ficha.state?.tier_code ? (
                  <>
                    <p className="text-sm">
                      <span className="font-semibold">{ficha.state.visits_in_window}</span> {ficha.state.visits_in_window === 1 ? 'visita' : 'visitas'} en las últimas {settings.window_weeks} semanas
                      {ficha.state.next_tier_name && ficha.state.visits_to_next != null && (
                        <> · le faltan <span className="font-semibold">{ficha.state.visits_to_next}</span> para {ficha.state.next_tier_name}</>
                      )}
                      {!ficha.state.next_tier_name && <> · está en la categoría más alta</>}
                    </p>
                    {ficha.visits_in_window_live != null && ficha.visits_in_window_live !== ficha.state.visits_in_window && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Hoy cuenta {ficha.visits_in_window_live}: el estado se actualiza con el próximo cobro o el mantenimiento diario.</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tier?.name} desde {fmtFecha(ficha.state.tier_reached_at, timezone)} · en el programa desde {fmtFecha(ficha.state.enrolled_at, timezone)} · {ficha.state.total_visits ?? 0} visitas en total
                      {ficha.state.welcome_bonus && ' · bono de bienvenida acreditado'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {settings.is_enabled ? 'Todavía no tiene categoría: la recibe con su próxima visita cobrada.' : 'El programa está apagado: los puntos se ven, la categoría no.'}
                  </p>
                )}
                {ficha.state?.grace_until && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                    <Clock className="mt-0.5 size-3.5 shrink-0" />
                    En período de gracia: tiene hasta el {fmtFecha(ficha.state.grace_until, timezone)}{graciaDias != null && graciaDias >= 0 && ` (${graciaDias} ${graciaDias === 1 ? 'día' : 'días'})`} para hacer una visita y mantener {tier?.name ?? 'su categoría'}.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Saldo" value={numero(ficha.balance)} sufijo="pts" />
                <Kpi label="Por vencer 30 d" value={numero(ficha.lots.filter(l => l.remaining > 0 && l.expires_at && (diasHasta(l.expires_at) ?? 99) <= 30).reduce((a, l) => a + l.remaining, 0))} sufijo="pts" />
                <Kpi label="Beneficios activos" value={numero(ficha.rewards.filter(r => r.status === 'available').length)} />
              </div>
              {ficha.client.referral_code && (
                <p className="text-[11px] text-muted-foreground">Código de recomendación: <span className="font-mono text-foreground">{ficha.client.referral_code}</span></p>
              )}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            {/* Lotes */}
            <Panel titulo="Movimientos de puntos" icono={History} contador={ficha.lots.length}>
              {ficha.lots.length === 0 ? <Vacio texto="Sin movimientos todavía." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Fecha</th>
                        <th className="px-4 py-2 text-left font-medium">Concepto</th>
                        <th className="px-4 py-2 text-right font-medium">Puntos</th>
                        <th className="px-4 py-2 text-right font-medium">Restan</th>
                        <th className="px-4 py-2 text-right font-medium">Vence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {ficha.lots.map(l => {
                        const vencido = l.points > 0 && l.remaining === 0
                        const dias = diasHasta(l.expires_at)
                        return (
                          <tr key={l.id} className={cn((vencido || l.reversed) && 'text-muted-foreground')}>
                            <td className="px-4 py-2 text-xs tabular-nums">{fmtFechaHora(l.created_at, timezone)}</td>
                            <td className="px-4 py-2">
                              <span className={cn(l.reversed && 'line-through')}>{TX_TYPE_LABEL[l.type] ?? l.type}</span>
                              {l.description && <span className="block truncate text-[11px] text-muted-foreground" title={l.description}>{l.description}</span>}
                            </td>
                            <td className={cn('px-4 py-2 text-right font-semibold tabular-nums', l.points > 0 ? 'text-emerald-400' : 'text-red-400', (vencido || l.reversed) && 'text-muted-foreground')}>{l.points > 0 ? '+' : ''}{numero(l.points)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{l.points > 0 ? numero(l.remaining) : '—'}</td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums">
                              {l.points > 0 && l.expires_at ? (
                                <span className={cn(l.remaining > 0 && dias != null && dias <= settings.expiring_soon_days && 'text-amber-400')}>{fmtFecha(l.expires_at, timezone)}{l.remaining > 0 && dias != null && dias >= 0 ? ` · ${dias} d` : ''}</span>
                              ) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* Beneficios */}
            <Panel titulo="Beneficios" icono={Gift} contador={ficha.rewards.length}>
              {ficha.rewards.length === 0 ? <Vacio texto="Todavía no canjeó ningún premio." /> : (
                <ul className="divide-y divide-white/[0.04]">
                  {ficha.rewards.map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn('truncate text-sm', (r.status === 'expired' || r.status === 'cancelled') && 'text-muted-foreground')}>{r.name}</p>
                          <Badge variant="outline" className={STATUS_CLASS[r.status] ?? ''}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {r.points_spent > 0 ? `${numero(r.points_spent)} pts · ` : ''}canjeado {fmtFecha(r.created_at, timezone)}
                          {r.status === 'available' && r.expires_at && ` · vence ${fmtFecha(r.expires_at, timezone)}`}
                          {r.status === 'redeemed' && r.redeemed_at && ` · usado ${fmtFecha(r.redeemed_at, timezone)}`}
                          {r.cancel_reason && ` · ${r.cancel_reason}`}
                        </p>
                        <p className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><QrCode className="size-3" /> {r.qr_code}</p>
                      </div>
                      {canManage && r.status === 'available' && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelar(r)}><XCircle className="size-3.5" /> Cancelar</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Visitas recientes */}
            <Panel titulo="Últimas visitas" icono={Clock} contador={ficha.recent_visits.length}>
              {ficha.recent_visits.length === 0 ? <Vacio texto="Sin visitas registradas." /> : (
                <ul className="divide-y divide-white/[0.04]">
                  {ficha.recent_visits.map(v => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{v.service_name ?? 'Venta'}{v.branch_name ? <span className="text-muted-foreground"> · {v.branch_name}</span> : null}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {fmtFechaHora(v.completed_at, timezone)} · {pesos(Number(v.amount))}{Number(v.discount_amount) > 0 ? ` (−${pesos(Number(v.discount_amount))})` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-semibold tabular-nums', v.lot_points != null ? 'text-emerald-400' : 'text-muted-foreground')}>{v.lot_points != null ? `+${numero(v.lot_points)}` : '—'}</span>
                        {canManage && v.lot_points != null && (
                          <Button variant="ghost" size="icon-sm" aria-label="Revertir puntos de esta visita" onClick={() => setRevertir(v)}><Undo2 className="size-3.5" /></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Referidos */}
            <Panel titulo="Referidos" icono={UserPlus} contador={ficha.referrals.length}>
              {ficha.referrals.length === 0 ? <Vacio texto="No recomendó a nadie ni vino recomendado." /> : (
                <ul className="divide-y divide-white/[0.04]">
                  {ficha.referrals.map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{r.i_am_referrer ? `Recomendó a ${r.other_name ?? 'un cliente'}` : `Vino recomendado por ${r.other_name ?? 'un cliente'}`}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">{fmtFecha(r.completed_at ?? r.created_at, timezone)} · {numero(r.i_am_referrer ? r.referrer_points : r.referred_points)} pts</p>
                      </div>
                      <Badge variant="outline" className={REFERRAL_STATUS_CLASS[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          {/* Historial */}
          <Panel titulo="Historial en el programa" icono={History} contador={ficha.events.length}>
            {ficha.events.length === 0 ? <Vacio texto="Sin eventos todavía." /> : (
              <ol className="divide-y divide-white/[0.04]">
                {ficha.events.map(e => {
                  const h = describirEvento({ ...e, client_name: ficha.client.name.split(' ')[0] }, nombresTier)
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', h.tono === 'ok' ? 'bg-emerald-400' : h.tono === 'warn' ? 'bg-amber-400' : h.tono === 'bad' ? 'bg-red-500' : h.tono === 'info' ? 'bg-sky-400' : 'bg-zinc-500')} />
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', h.tono === 'bad' && 'text-red-300')}>{h.titulo}</p>
                        {h.detalle && <p className="truncate text-xs text-muted-foreground">{h.detalle}</p>}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={fmtFechaHora(e.created_at, timezone)}>{fmtRelativo(e.created_at)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </Panel>
        </div>
      )}

      {ficha && (
        <>
          <AjusteDialog open={ajuste} onOpenChange={setAjuste} clientId={ficha.client.id} balance={ficha.balance} onDone={recargar} />
          <CanjeDialog open={canje} onOpenChange={setCanje} clientId={ficha.client.id} balance={ficha.balance} tierCode={ficha.state?.tier_code ?? null} rewards={catalogoActivo} tiers={tiers} onDone={recargar} />
          <CancelarDialog reward={cancelar} onClose={() => setCancelar(null)} onDone={recargar} />
          <RevertirDialog visit={revertir} onClose={() => setRevertir(null)} onDone={recargar} timezone={timezone} />
        </>
      )}
    </div>
  )
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function Kpi({ label, value, sufijo }: { label: string; value: string; sufijo?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums tracking-tight">{value}{sufijo && <span className="ml-1 text-xs font-medium text-muted-foreground">{sufijo}</span>}</p>
    </div>
  )
}

function Panel({ titulo, icono: Icon, contador, children }: { titulo: string; icono: typeof Gift; contador: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
      <header className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{titulo}</h4>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{contador}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </section>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{texto}</p>
}

// ── Diálogos ─────────────────────────────────────────────────────────────────

function AjusteDialog({ open, onOpenChange, clientId, balance, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; balance: number; onDone: () => void }) {
  const [signo, setSigno] = useState<1 | -1>(1)
  const [puntos, setPuntos] = useState('')
  const [motivo, setMotivo] = useState('')
  const [pending, start] = useTransition()
  const n = Math.abs(parseInt(puntos, 10) || 0)

  function confirmar() {
    start(async () => {
      const r = await adjustClientPoints(clientId, signo * n, motivo)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`Listo. Nuevo saldo: ${numero(r.balance)} pts`)
      setPuntos(''); setMotivo('')
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar puntos</DialogTitle>
          <DialogDescription>Saldo actual: {numero(balance)} pts. Un ajuste positivo crea un lote con el vencimiento normal; uno negativo consume primero los que vencen antes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setSigno(1)} aria-pressed={signo === 1} className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', signo === 1 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-muted-foreground')}>Sumar</button>
            <button type="button" onClick={() => setSigno(-1)} aria-pressed={signo === -1} className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', signo === -1 ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-white/10 text-muted-foreground')}>Restar</button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aj-pts" className="text-xs">Puntos</Label>
            <Input id="aj-pts" type="number" min={1} max={100000} value={puntos} onChange={e => setPuntos(e.target.value)} className="tabular-nums" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aj-mot" className="text-xs">Motivo</Label>
            <Textarea id="aj-mot" rows={2} value={motivo} maxLength={200} onChange={e => setMotivo(e.target.value)} placeholder="Queda en el historial del cliente." className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={pending || n === 0 || motivo.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {signo === 1 ? `Sumar ${numero(n)} pts` : `Restar ${numero(n)} pts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CanjeDialog({ open, onOpenChange, clientId, balance, tierCode, rewards, tiers, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; clientId: string; balance: number; tierCode: string | null
  rewards: LoyaltyReward[]; tiers: LoyaltyTier[]; onDone: () => void
}) {
  const [rewardId, setRewardId] = useState('')
  const [pending, start] = useTransition()
  const elegido = rewards.find(r => r.id === rewardId) ?? null
  const nombreTier = (c: string) => tiers.find(t => t.code === c)?.name ?? c

  function confirmar() {
    if (!elegido) return
    start(async () => {
      const r = await redeemRewardForClient(clientId, elegido.id)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${r.reward_name} canjeado. Le quedan ${numero(r.points_remaining)} pts.`)
      setRewardId('')
      onOpenChange(false)
      onDone()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Canjear un premio para el cliente</DialogTitle>
          <DialogDescription>Se descuentan los puntos y el beneficio aparece en Mis premios de su app, con su QR. Saldo: {numero(balance)} pts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={rewardId} onValueChange={setRewardId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Elegí un premio del catálogo" /></SelectTrigger>
            <SelectContent>
              {rewards.map(r => {
                const bloqueado = !!r.allowed_tiers && (!tierCode || !r.allowed_tiers.includes(tierCode as LoyaltyTierCode))
                const agotado = r.stock !== null && r.stock <= 0
                return (
                  <SelectItem key={r.id} value={r.id} disabled={bloqueado || agotado}>
                    {r.name} · {numero(r.points_cost)} pts{agotado ? ' · agotado' : bloqueado ? ` · sólo ${r.allowed_tiers!.map(nombreTier).join('/')}` : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {elegido && (
            <p className={cn('text-sm', elegido.points_cost > balance ? 'text-amber-400' : 'text-muted-foreground')}>
              {elegido.points_cost > balance
                ? <><AlertTriangle className="mr-1 inline size-3.5" />Le faltan {numero(elegido.points_cost - balance)} pts.</>
                : <>Quedaría con {numero(balance - elegido.points_cost)} pts.</>}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={pending || !elegido || elegido.points_cost > balance}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Canjear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelarDialog({ reward, onClose, onDone }: { reward: LoyaltyClientReward | null; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [devolver, setDevolver] = useState(true)
  const [pending, start] = useTransition()

  function confirmar() {
    if (!reward) return
    start(async () => {
      const r = await cancelClientReward(reward.id, motivo, devolver)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(devolver ? `Beneficio cancelado. Se devolvieron ${numero(r.points_restored)} pts.` : 'Beneficio cancelado sin devolución.')
      setMotivo('')
      onClose()
      onDone()
    })
  }

  return (
    <Dialog open={!!reward} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar {reward?.name}</DialogTitle>
          <DialogDescription>El QR deja de ser válido. Si el premio tenía stock, vuelve una unidad.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cn-mot" className="text-xs">Motivo</Label>
            <Textarea id="cn-mot" rows={2} value={motivo} maxLength={200} onChange={e => setMotivo(e.target.value)} className="text-sm" autoFocus />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5 text-sm">
            <span>Devolver los {numero(reward?.points_spent ?? 0)} pts al cliente</span>
            <Switch checked={devolver} onCheckedChange={setDevolver} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Volver</Button>
          <Button variant="destructive" onClick={confirmar} disabled={pending || motivo.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Cancelar beneficio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevertirDialog({ visit, onClose, onDone, timezone }: { visit: LoyaltyClientVisit | null; onClose: () => void; onDone: () => void; timezone: string }) {
  const [motivo, setMotivo] = useState('')
  const [pending, start] = useTransition()

  function confirmar() {
    if (!visit) return
    start(async () => {
      const r = await reverseVisitPoints(visit.id, motivo)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`Se revirtieron ${numero(r.points_reverted)} pts${r.points_already_spent > 0 ? ` (ya había gastado ${numero(r.points_already_spent)})` : ''}${r.referral_cancelled ? ' y se canceló el referido' : ''}.`)
      setMotivo('')
      onClose()
      onDone()
    })
  }

  return (
    <Dialog open={!!visit} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revertir los puntos de la visita</DialogTitle>
          <DialogDescription>
            {visit && <>{visit.service_name ?? 'Visita'} del {fmtFechaHora(visit.completed_at, timezone)} · +{numero(visit.lot_points ?? 0)} pts. </>}
            Se anula lo que quede sin gastar del lote; si había un referido sobre esta visita, también se cancela. La visita en sí no se borra.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rv-mot" className="text-xs">Motivo</Label>
          <Textarea id="rv-mot" rows={2} value={motivo} maxLength={200} onChange={e => setMotivo(e.target.value)} className="text-sm" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Volver</Button>
          <Button variant="destructive" onClick={confirmar} disabled={pending || motivo.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Revertir puntos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
