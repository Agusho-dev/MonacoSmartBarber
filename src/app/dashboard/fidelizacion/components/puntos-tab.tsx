'use client'

// =============================================================================
// Puntos: parámetros de acreditación y vencimiento, con una calculadora que se
// actualiza al tipear, y la lista de servicios que cuentan como visita.
// =============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Calculator, Loader2, Save, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { saveLoyaltySettings, setServiceCountsAsVisit } from '@/lib/actions/loyalty'
import type { LoyaltyService, LoyaltySettings, LoyaltyTier } from '@/lib/types/loyalty'
import { fechaEnDias, pesos } from './helpers'

interface Props {
  settings: LoyaltySettings
  tiers: LoyaltyTier[]
  services: LoyaltyService[]
  canManage: boolean
  onSaved: (settings: LoyaltySettings) => void
}

const CAMPOS = [
  { key: 'base_points', label: 'Puntos base por servicio', hint: 'Lo que suma un servicio pagado a precio completo, antes del multiplicador.', min: 0, max: 100000 },
  { key: 'points_expiry_days', label: 'Vencimiento de los puntos (días)', hint: 'Cada lote vence a los N días de generado. Se gastan primero los más próximos a vencer.', min: 1, max: 3650 },
  { key: 'welcome_bonus_points', label: 'Bono de bienvenida', hint: 'Se acredita una sola vez, cuando el cliente entra al programa. 0 = sin bono.', min: 0, max: 100000 },
  { key: 'reward_validity_days', label: 'Vigencia del beneficio canjeado (días)', hint: 'Cuánto dura un premio en Mis premios. Cada premio puede tener la suya.', min: 1, max: 365 },
  { key: 'expiring_soon_days', label: 'Ventana de "por vencer" (días)', hint: 'Lo que la app y la ficha del cliente marcan como "por vencer". El aviso push tiene su propia anticipación en Notificaciones → Puntos por vencer.', min: 1, max: 90 },
] as const

type CampoKey = (typeof CAMPOS)[number]['key']

export function PuntosTab({ settings, tiers, services, canManage, onSaved }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<Record<CampoKey, string>>({
    base_points: String(settings.base_points),
    points_expiry_days: String(settings.points_expiry_days),
    welcome_bonus_points: String(settings.welcome_bonus_points),
    reward_validity_days: String(settings.reward_validity_days),
    expiring_soon_days: String(settings.expiring_soon_days),
  })
  const [guardando, startSave] = useTransition()

  // Calculadora
  const [servicioId, setServicioId] = useState<string>(services[0]?.id ?? '')
  const [pagado, setPagado] = useState(70)
  const [tierCode, setTierCode] = useState<string>(tiers.find(t => t.code === 'oro')?.code ?? tiers[0]?.code ?? 'bronce')

  // Servicios que cuentan
  const [lista, setLista] = useState(services)
  const [cambiando, setCambiando] = useState<string | null>(null)

  const n = (k: CampoKey) => Math.max(0, parseInt(form[k], 10) || 0)
  const servicio = lista.find(s => s.id === servicioId) ?? null
  const tier = tiers.find(t => t.code === tierCode) ?? tiers[0]
  const mult = tier?.multiplier_pct ?? 100
  const puntos = Math.round(n('base_points') * (pagado / 100) * mult / 100)
  const precio = servicio?.price ?? 16000
  const pagadoPesos = Math.round(precio * pagado / 100)

  function guardar() {
    startSave(async () => {
      const r = await saveLoyaltySettings({
        base_points: n('base_points'),
        points_expiry_days: Math.max(1, n('points_expiry_days')),
        welcome_bonus_points: n('welcome_bonus_points'),
        reward_validity_days: Math.max(1, n('reward_validity_days')),
        expiring_soon_days: Math.max(1, n('expiring_soon_days')),
      })
      if ('error' in r) { toast.error(r.error); return }
      onSaved(r.data)
      toast.success('Configuración de puntos guardada')
      router.refresh()
    })
  }

  async function toggleServicio(s: LoyaltyService, v: boolean) {
    setCambiando(s.id)
    setLista(l => l.map(x => (x.id === s.id ? { ...x, counts_as_visit: v } : x)))
    const r = await setServiceCountsAsVisit(s.id, v)
    setCambiando(null)
    if ('error' in r) {
      setLista(l => l.map(x => (x.id === s.id ? { ...x, counts_as_visit: !v } : x)))
      toast.error(r.error)
      return
    }
    toast.success(v ? `${s.name} cuenta como visita` : `${s.name} ya no cuenta como visita`)
  }

  const grupos = agrupar(lista)

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* Parámetros */}
        <div className="space-y-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Cómo se acreditan y vencen</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Los puntos se calculan sobre lo que el cliente pagó de verdad: un servicio con 30 % OFF suma el 70 %.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {CAMPOS.map(c => (
              <div key={c.key} className="space-y-1">
                <Label htmlFor={c.key} className="text-xs">{c.label}</Label>
                <Input id={c.key} type="number" min={c.min} max={c.max} value={form[c.key]} disabled={!canManage} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} className="tabular-nums" />
                <p className="text-[11px] leading-snug text-muted-foreground">{c.hint}</p>
              </div>
            ))}
          </div>
          {canManage && (
            <div className="flex justify-end pt-1">
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Guardar
              </Button>
            </div>
          )}
        </div>

        {/* Calculadora */}
        <aside className="space-y-4 rounded-2xl border border-white/[0.06] bg-[radial-gradient(90%_100%_at_100%_0%,rgba(255,255,255,.05),transparent_60%)] p-5 lg:sticky lg:top-16 lg:self-start">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Calculadora de ejemplo</h3>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Servicio</Label>
            <Select value={servicioId} onValueChange={setServicioId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elegí un servicio" /></SelectTrigger>
              <SelectContent>
                {lista.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name} · {pesos(s.price)}{s.branch_name ? ` · ${s.branch_name}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">Pagó el</Label>
              <span className="text-sm font-semibold tabular-nums">{pagado} %</span>
            </div>
            <Slider min={0} max={100} step={5} value={[pagado]} onValueChange={v => setPagado(v[0] ?? 0)} aria-label="Porcentaje pagado" />
            <p className="text-[11px] text-muted-foreground">{pagado === 100 ? 'Sin descuento' : pagado === 0 ? 'Servicio gratis: cuenta como visita, no da puntos' : `Usó ${100 - pagado} % OFF`}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Categoría</Label>
            <div className="flex flex-wrap gap-1.5">
              {tiers.map(t => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setTierCode(t.code)}
                  aria-pressed={t.code === tierCode}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', t.code === tierCode ? 'border-transparent' : 'border-white/10 text-muted-foreground hover:text-foreground')}
                  style={t.code === tierCode ? { backgroundImage: `linear-gradient(135deg, ${t.color_primary}, ${t.color_secondary})`, color: t.text_color } : undefined}
                >
                  {t.name} ×{(t.multiplier_pct / 100).toFixed(2)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-zinc-950/60 p-4">
            <p className="text-sm leading-relaxed">
              {servicio?.name ?? 'Corte'} de <span className="font-semibold tabular-nums">{pesos(precio)}</span> pagado al <span className="font-semibold tabular-nums">{pagado} %</span> ({pesos(pagadoPesos)}) · cliente <span className="font-semibold">{tier?.name ?? '—'}</span>
            </p>
            <p className="mt-2 text-3xl font-black tabular-nums tracking-tight">{puntos.toLocaleString('es-AR')} <span className="text-base font-semibold text-muted-foreground">pts</span></p>
            <p className="mt-1 text-xs text-muted-foreground">
              {n('base_points')} base × {pagado} % × {mult} % · vencen el <span className="text-foreground">{fechaEnDias(Math.max(1, n('points_expiry_days')))}</span>
            </p>
            {n('welcome_bonus_points') > 0 && (
              <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-muted-foreground">
                Si es su primer contacto con el programa, suma además <span className="text-foreground tabular-nums">{n('welcome_bonus_points')} pts</span> de bienvenida.
              </p>
            )}
          </div>
        </aside>
      </section>

      {/* Servicios que cuentan como visita */}
      <section className="rounded-2xl border border-white/[0.06] bg-zinc-900/40">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-5 py-4">
          <div className="flex items-center gap-2">
            <Scissors className="size-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">Servicios que cuentan como visita</h3>
              <p className="text-xs text-muted-foreground">Un servicio apagado no mueve la categoría ni suma puntos. Las ventas de productos nunca cuentan.</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{lista.filter(s => s.counts_as_visit).length} de {lista.length} cuentan</span>
        </header>
        {lista.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No hay servicios activos cargados.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {grupos.map(g => (
              <div key={g.nombre ?? '__global'}>
                {grupos.length > 1 && <p className="bg-zinc-950/40 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.nombre ?? 'Todas las sucursales'}</p>}
                <ul className="divide-y divide-white/[0.04]">
                  {g.items.map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <div className="min-w-0">
                        <p className={cn('truncate text-sm', !s.counts_as_visit && 'text-muted-foreground')}>{s.name}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">{pesos(s.price)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {cambiando === s.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        <Switch checked={s.counts_as_visit} disabled={!canManage || cambiando === s.id} onCheckedChange={v => toggleServicio(s, v)} aria-label={`${s.name} cuenta como visita`} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function agrupar(lista: LoyaltyService[]): { nombre: string | null; items: LoyaltyService[] }[] {
  const m = new Map<string | null, LoyaltyService[]>()
  for (const s of lista) {
    const k = s.branch_name
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(s)
  }
  return [...m.entries()].sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '')).map(([nombre, items]) => ({ nombre, items }))
}
