'use client'

// =============================================================================
// Referidos: la promo "invitá a un amigo" (qué recibe cada uno, vigencia y
// límite) con vista previa del texto, y la tabla de los últimos referidos.
// =============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { saveLoyaltySettings } from '@/lib/actions/loyalty'
import type { LoyaltySettings, Referral } from '@/lib/types/loyalty'
import { fmtFechaHora, numero, pesos, REFERRAL_STATUS_CLASS, REFERRAL_STATUS_LABEL } from './helpers'

interface Props {
  settings: LoyaltySettings
  referrals: Referral[]
  canManage: boolean
  timezone: string
  onSaved: (s: LoyaltySettings) => void
}

function aFechaInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function deFechaInput(v: string, finDeDia: boolean): string | null {
  if (!v) return null
  const d = new Date(`${v}T${finDeDia ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function ReferidosTab({ settings, referrals, canManage, timezone, onSaved }: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(settings.referral_enabled)
  const [descuento, setDescuento] = useState(String(settings.referral_new_client_discount_pct))
  const [ptsNuevo, setPtsNuevo] = useState(String(settings.referral_new_client_points))
  const [ptsRef, setPtsRef] = useState(String(settings.referral_referrer_points))
  const [desde, setDesde] = useState(aFechaInput(settings.referral_valid_from))
  const [hasta, setHasta] = useState(aFechaInput(settings.referral_valid_until))
  const [limite, setLimite] = useState(settings.referral_max_per_referrer != null ? String(settings.referral_max_per_referrer) : '')
  const [guardando, startSave] = useTransition()

  const n = (s: string) => Math.max(0, parseInt(s, 10) || 0)

  function guardar() {
    startSave(async () => {
      const r = await saveLoyaltySettings({
        referral_enabled: enabled,
        referral_new_client_discount_pct: Math.min(100, n(descuento)),
        referral_new_client_points: n(ptsNuevo),
        referral_referrer_points: n(ptsRef),
        referral_valid_from: deFechaInput(desde, false),
        referral_valid_until: deFechaInput(hasta, true),
        referral_max_per_referrer: limite.trim() === '' ? null : Math.max(1, n(limite)),
      })
      if ('error' in r) { toast.error(r.error); return }
      onSaved(r.data)
      toast.success('Referidos guardados')
      router.refresh()
    })
  }

  const completados = referrals.filter(r => r.status === 'completed').length
  const pendientes = referrals.filter(r => r.status === 'pending').length

  // Mismo armado que la app (`ganaTuAmigo` en invitar_screen.dart): cada
  // parte se omite si está en 0 y sin ninguna cae a "un regalo de bienvenida".
  // Antes la previa imprimía "0 % OFF + 100 pts", que la app nunca muestra.
  const pctNuevo = Math.min(100, n(descuento))
  const partesNuevo = [pctNuevo > 0 ? `${pctNuevo} % OFF` : null, n(ptsNuevo) > 0 ? `${numero(n(ptsNuevo))} pts` : null].filter((p): p is string => !!p)
  const ganaTuAmigo = partesNuevo.length ? partesNuevo.join(' + ') : 'un regalo de bienvenida'

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className={cn('space-y-5 rounded-2xl border p-5 transition-colors', enabled ? 'border-white/[0.06] bg-zinc-900/40' : 'border-white/[0.06] bg-zinc-900/20')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Invitá a un amigo</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cada cliente tiene un QR personal. El amigo lo muestra al cobrar su primera visita; el barbero lo escanea y el sistema valida que sea cliente nuevo de verdad.
              </p>
            </div>
            <Switch checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} aria-label="Activar referidos" className="mt-1 data-[state=checked]:bg-emerald-500" />
          </div>

          <div className={cn('grid gap-4 sm:grid-cols-3', !enabled && 'opacity-60')}>
            <div className="space-y-1">
              <Label htmlFor="ref-desc" className="text-xs">Descuento del nuevo (%)</Label>
              <Input id="ref-desc" type="number" min={0} max={100} value={descuento} disabled={!canManage} onChange={e => setDescuento(e.target.value)} className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Sobre su primer servicio.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-pn" className="text-xs">Puntos para el nuevo</Label>
              <Input id="ref-pn" type="number" min={0} value={ptsNuevo} disabled={!canManage} onChange={e => setPtsNuevo(e.target.value)} className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Se acreditan al cobrar la visita.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-pr" className="text-xs">Puntos para quien recomienda</Label>
              <Input id="ref-pr" type="number" min={0} value={ptsRef} disabled={!canManage} onChange={e => setPtsRef(e.target.value)} className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Sólo cuando el amigo terminó y pagó.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-from" className="text-xs">Vigente desde</Label>
              <Input id="ref-from" type="date" value={desde} disabled={!canManage} onChange={e => setDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-until" className="text-xs">Hasta</Label>
              <Input id="ref-until" type="date" value={hasta} disabled={!canManage} onChange={e => setHasta(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Vacíos = sin límite de fechas.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-max" className="text-xs">Máximo por recomendador</Label>
              <Input id="ref-max" type="number" min={1} value={limite} disabled={!canManage} onChange={e => setLimite(e.target.value)} placeholder="Sin límite" className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Referidos completados que puede cobrar.</p>
            </div>
          </div>

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Guardar
              </Button>
            </div>
          )}
        </div>

        <aside className="space-y-3 rounded-2xl border border-white/[0.06] bg-[radial-gradient(90%_100%_at_100%_0%,rgba(255,255,255,.05),transparent_60%)] p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Lo que ve el cliente</h3>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-zinc-950/60 p-4">
            {enabled ? (
              <>
                <p className="text-sm leading-relaxed">
                  Tu amigo recibe <span className="font-semibold tabular-nums">{ganaTuAmigo}</span> en su primera visita.
                </p>
                <p className="mt-2 text-sm leading-relaxed">
                  Vos sumás <span className="font-semibold tabular-nums">{numero(n(ptsRef))} pts</span> cuando se corta.
                </p>
                {(desde || hasta) && <p className="mt-2 text-[11px] text-muted-foreground">Promo vigente {desde ? `desde el ${desde.split('-').reverse().join('/')}` : ''} {hasta ? `hasta el ${hasta.split('-').reverse().join('/')}` : ''}.</p>}
                {limite.trim() !== '' && <p className="mt-1 text-[11px] text-muted-foreground">Hasta {n(limite)} amigos por cliente.</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">La sección Invitá a un amigo no se muestra en la app mientras esté apagada.</p>
            )}
          </div>
          <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <li>Nadie puede referirse a sí mismo ni a alguien que ya se cortó en Monaco.</li>
            <li>Un cliente nuevo puede ser referido una sola vez.</li>
            <li>Si la visita se anula, los puntos de los dos se revierten.</li>
          </ul>
        </aside>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-zinc-900/40">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-5 py-4">
          <h3 className="text-sm font-semibold">Últimos referidos</h3>
          <p className="text-xs text-muted-foreground">{numero(completados)} completados · {numero(pendientes)} pendientes · {numero(referrals.length)} en la lista</p>
        </header>
        {referrals.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Todavía no hubo ningún referido. Aparecen cuando un barbero escanea el QR de un amigo al cobrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-zinc-950/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Estado</th>
                  <th className="px-4 py-2.5 text-left font-medium">Recomendó</th>
                  <th className="px-4 py-2.5 text-left font-medium">Cliente nuevo</th>
                  <th className="px-4 py-2.5 text-left font-medium">Dónde</th>
                  <th className="px-4 py-2.5 text-right font-medium">Descuento</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pts nuevo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pts recom.</th>
                  <th className="px-4 py-2.5 text-right font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {referrals.map(r => (
                  <tr key={r.id} className={cn(r.status === 'cancelled' || r.status === 'rejected' ? 'text-muted-foreground' : '')}>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={REFERRAL_STATUS_CLASS[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Badge>
                      {r.rejection_reason && <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-muted-foreground" title={r.rejection_reason}>{r.rejection_reason}</p>}
                    </td>
                    <td className="px-4 py-2.5">{r.referrer?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">{r.referred?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.branch?.name ?? '—'}{r.service?.name ? ` · ${r.service.name}` : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.discount_pct} %{Number(r.discount_amount) > 0 ? <span className="block text-[10px] text-muted-foreground">{pesos(Number(r.discount_amount))}</span> : null}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(r.referred_points)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(r.referrer_points)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">{fmtFechaHora(r.completed_at ?? r.created_at, timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
