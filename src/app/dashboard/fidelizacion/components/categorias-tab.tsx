'use client'

// =============================================================================
// Categorías: la escalera de umbrales como UN solo slider de 3 manijas, la
// ventana y la gracia, un simulador en vivo contra la base real y una tarjeta
// editable por categoría (nombre, multiplicador, beneficios, colores).
// =============================================================================

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Palette, Save, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { previewLoyaltyDistribution, saveLoyaltySettings, saveLoyaltyTiers } from '@/lib/actions/loyalty'
import { LOYALTY_TIER_CODES, type LoyaltyDistribution, type LoyaltySettings, type LoyaltyTier, type LoyaltyTierCode, type LoyaltyTierInput } from '@/lib/types/loyalty'
import { MonacoCardPreview } from './monaco-card-preview'
import { numero, PRESETS } from './helpers'

interface Props {
  settings: LoyaltySettings
  tiers: LoyaltyTier[]
  canManage: boolean
  /** La pestaña queda montada aunque no se vea: el simulador sólo consulta la base mientras está visible. */
  activa: boolean
  onSaved: (settings: LoyaltySettings, tiers: LoyaltyTier[]) => void
}

const MAX_VISITAS = 20
/**
 * = size-5 de la clase del Slider. Radix NO deja la manija en el porcentaje
 * puro del dominio: la corre media manija hacia adentro en los extremos para
 * que no se salga del track (in-bounds offset), así que el CENTRO de la manija
 * queda en `10px + p·(ancho − 20px)`. La barra de segmentos y la regla de
 * números compensan con este valor para caer en el mismo píxel.
 */
const MANIJA_PX = 20

interface TierForm {
  code: LoyaltyTierCode
  name: string
  multiplier_pct: string
  benefits: string
  color_primary: string
  color_secondary: string
  text_color: string
}

/** El texto de la tarjeta es blanco por diseño (decisión del dueño): si la fila no trae color, arranca en #FFFFFF. */
const TEXTO_DEFAULT = '#FFFFFF'

function aForm(t: LoyaltyTier): TierForm {
  return {
    code: t.code, name: t.name, multiplier_pct: String(t.multiplier_pct), benefits: t.benefits.join('\n'),
    color_primary: t.color_primary, color_secondary: t.color_secondary, text_color: t.text_color || TEXTO_DEFAULT,
  }
}

/**
 * Fracción 0..1 de un umbral en el dominio del slider (min 1, max 20). OJO:
 * el centro de la manija de Radix NO queda en `p·ancho` sino en
 * `10px + p·(ancho − 20px)` (corrección in-bounds, ver MANIJA_PX): los
 * segmentos absorben esos 10 px en las puntas y la regla se dibuja con
 * `mx-2.5` para que borde, número y manija coincidan en todo el recorrido.
 */
function pos(v: number): number {
  return Math.min(1, Math.max(0, (v - 1) / (MAX_VISITAS - 1)))
}

function umbralesDe(tiers: LoyaltyTier[]): [number, number, number] {
  const m = (c: LoyaltyTierCode, def: number) => tiers.find(t => t.code === c)?.min_visits ?? def
  return [m('plata', 3), m('oro', 6), m('platinum', 9)]
}

export function CategoriasTab({ settings, tiers, canManage, activa, onSaved }: Props) {
  const router = useRouter()
  const [umbrales, setUmbrales] = useState<[number, number, number]>(() => umbralesDe(tiers))
  const [ventana, setVentana] = useState(String(settings.window_weeks))
  const [gracia, setGracia] = useState(String(settings.grace_days))
  const [forms, setForms] = useState<TierForm[]>(() => LOYALTY_TIER_CODES.map(c => tiers.find(t => t.code === c)).filter((t): t is LoyaltyTier => !!t).map(aForm))
  const [dist, setDist] = useState<LoyaltyDistribution | null>(null)
  const [simulando, startSim] = useTransition()
  const [guardando, startSave] = useTransition()

  const ventanaNum = Math.min(Math.max(parseInt(ventana, 10) || 1, 1), 104)

  // Simulador en vivo: debounce de 300 ms sobre el slider y la ventana.
  useEffect(() => {
    if (!activa) return
    const t = setTimeout(() => {
      startSim(async () => {
        const r = await previewLoyaltyDistribution(ventanaNum, umbrales)
        if ('error' in r) { toast.error(r.error); return }
        setDist(r.data)
      })
    }, 300)
    return () => clearTimeout(t)
  }, [activa, umbrales, ventanaNum, startSim])

  const rangos = LOYALTY_TIER_CODES.map((code, i) => {
    const min = i === 0 ? 0 : umbrales[i - 1]
    const max = i === 3 ? null : umbrales[i] - 1
    return { code, min, max }
  })

  function setForm(code: LoyaltyTierCode, patch: Partial<TierForm>) {
    setForms(fs => fs.map(f => (f.code === code ? { ...f, ...patch } : f)))
  }

  function guardar() {
    const payload: LoyaltyTierInput[] = forms.map(f => {
      const r = rangos.find(x => x.code === f.code)!
      return {
        code: f.code,
        name: f.name.trim(),
        min_visits: r.min,
        max_visits: r.max,
        multiplier_pct: parseInt(f.multiplier_pct, 10) || 100,
        color_primary: f.color_primary,
        color_secondary: f.color_secondary,
        text_color: f.text_color,
        benefits: f.benefits.split('\n').map(s => s.trim()).filter(Boolean),
      }
    })
    startSave(async () => {
      const r1 = await saveLoyaltyTiers(payload)
      if ('error' in r1) { toast.error(r1.error); return }
      const nuevos = tiers.map(t => {
        const p = payload.find(x => x.code === t.code)!
        return { ...t, ...p }
      })
      const r2 = await saveLoyaltySettings({ window_weeks: ventanaNum, grace_days: Math.min(Math.max(parseInt(gracia, 10) || 0, 0), 365) })
      if ('error' in r2) {
        // Las categorías YA quedaron escritas: el resto del módulo (Resumen,
        // Premios, Clientes) tiene que reflejarlas aunque la ventana y la
        // gracia no se hayan guardado.
        onSaved(settings, nuevos)
        toast.error('Las categorías se guardaron, pero no la ventana ni la gracia: ' + r2.error)
        router.refresh()
        return
      }
      onSaved(r2.data, nuevos)
      toast.success('Categorías guardadas')
      router.refresh()
    })
  }

  const totalSim = dist?.total ?? 0

  return (
    <div className="space-y-6">
      {/* ── Escalera de umbrales ────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Escalera de categorías</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Movés las tres manijas y quedan definidos los cuatro rangos. Cuenta visitas en las últimas <span className="text-foreground">{ventanaNum} semanas</span>.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="w-28 space-y-1">
              <Label htmlFor="ventana" className="text-xs">Ventana (semanas)</Label>
              <Input id="ventana" type="number" min={1} max={104} value={ventana} onChange={e => setVentana(e.target.value)} disabled={!canManage} className="h-9 tabular-nums" />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="gracia" className="text-xs">Gracia (días)</Label>
              <Input id="gracia" type="number" min={0} max={365} value={gracia} onChange={e => setGracia(e.target.value)} disabled={!canManage} className="h-9 tabular-nums" />
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {/* Segmentos coloreados: los bordes caen donde están las manijas (mismo dominio que el slider) */}
          <div className="flex h-9 w-full overflow-hidden rounded-xl ring-1 ring-white/10">
            {rangos.map((r, i) => {
              const f = forms[i]
              const desde = i === 0 ? 0 : pos(umbrales[i - 1])
              const hasta = i === 3 ? 1 : pos(umbrales[i])
              // Los centros de las manijas recorren `10px + p·(100% − 20px)`:
              // cada segmento mide su fracción de ESE recorrido, y el primero
              // y el último absorben la media manija de su punta.
              const extremos = (i === 0 ? MANIJA_PX / 2 : 0) + (i === 3 ? MANIJA_PX / 2 : 0)
              const ancho = `calc(${Math.max(0, hasta - desde)} * (100% - ${MANIJA_PX}px) + ${extremos}px)`
              return (
                <div
                  key={r.code}
                  className="flex items-center justify-center overflow-hidden px-1 text-[11px] font-semibold uppercase tracking-wider transition-[width] duration-200"
                  style={{ width: ancho, backgroundImage: `linear-gradient(90deg, ${f.color_primary}, ${f.color_secondary})`, color: f.text_color }}
                  title={`${f.name}: ${r.min}${r.max === null ? '+' : `–${r.max}`} visitas`}
                >
                  <span className="truncate">{f.name} {r.min}{r.max === null ? '+' : `–${r.max}`}</span>
                </div>
              )
            })}
          </div>
          <Slider
            min={1}
            max={MAX_VISITAS}
            step={1}
            minStepsBetweenThumbs={1}
            value={umbrales}
            onValueChange={v => { if (v.length === 3) setUmbrales([v[0], v[1], v[2]]) }}
            disabled={!canManage}
            aria-label="Umbrales de visitas para Plata, Oro y Platinum"
            className="[&_[data-slot=slider-range]]:bg-white/40 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-5"
          />
          {/* Regla de números 1..20: mx-2.5 = media manija por punta, así el 0–100 % de esta caja es exactamente el recorrido de los CENTROS de las manijas (y el 1 y el 20 dejan de colgar fuera del contenedor) */}
          <div className="relative mx-2.5 h-4 text-[10px] text-muted-foreground tabular-nums" aria-hidden>
            {Array.from({ length: MAX_VISITAS }, (_, i) => i + 1).map(v => (
              <span
                key={v}
                className={cn('absolute top-0 -translate-x-1/2', v % 5 !== 0 && v !== 1 && 'invisible sm:visible')}
                style={{ left: `${pos(v) * 100}%` }}
              >
                {v}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {rangos.map((r, i) => `${forms[i].name} ${r.min}${r.max === null ? '+' : `–${r.max}`}`).join(' · ')} visitas
          </p>
        </div>

        {/* Simulador */}
        <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Con estos umbrales, hoy</p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {simulando ? <Loader2 className="inline size-3.5 animate-spin" /> : dist ? `${numero(totalSim)} clientes con historial · ${numero(dist.with_visits_in_window)} con visitas en la ventana` : '—'}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {rangos.map((r, i) => {
              const f = forms[i]
              const n = dist ? dist[r.code] : 0
              const pct = totalSim > 0 ? (n / totalSim) * 100 : 0
              return (
                <div key={r.code} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium">{f.name}</span>
                    <span className="text-lg font-bold tabular-nums">{dist ? numero(n) : '—'}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className={cn('h-full rounded-full transition-[width] duration-500', simulando && 'opacity-60')} style={{ width: `${Math.max(pct, n > 0 ? 2 : 0)}%`, backgroundImage: `linear-gradient(90deg, ${f.color_primary}, ${f.color_secondary})` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground tabular-nums">{pct.toFixed(1)} %</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Tarjetas editables ──────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2">
        {forms.map((f, i) => {
          const r = rangos[i]
          const look = { code: f.code, name: f.name || '—', color_primary: f.color_primary, color_secondary: f.color_secondary, text_color: f.text_color }
          return (
            <div key={f.code} className="space-y-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <MonacoCardPreview tier={look} points={[120, 340, 650, 1200][i]} clientName="Cliente Monaco" memberSince={String(new Date().getFullYear())} compact />

              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`nombre-${f.code}`} className="text-xs">Nombre</Label>
                  <Input id={`nombre-${f.code}`} value={f.name} maxLength={40} disabled={!canManage} onChange={e => setForm(f.code, { name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`mult-${f.code}`} className="text-xs">Multiplicador (%)</Label>
                  <Input id={`mult-${f.code}`} type="number" min={100} max={500} step={5} value={f.multiplier_pct} disabled={!canManage} onChange={e => setForm(f.code, { multiplier_pct: e.target.value })} className="tabular-nums" />
                </div>
              </div>
              <p className="-mt-2 text-[11px] text-muted-foreground">
                {r.min}{r.max === null ? '+' : `–${r.max}`} visitas · con {settings.base_points} pts base, un corte a precio completo da <span className="text-foreground tabular-nums">{Math.round(settings.base_points * (parseInt(f.multiplier_pct, 10) || 100) / 100)} pts</span>
              </p>

              <div className="space-y-1">
                <Label htmlFor={`ben-${f.code}`} className="text-xs">Beneficios (uno por línea, hasta 8)</Label>
                <Textarea id={`ben-${f.code}`} rows={3} value={f.benefits} disabled={!canManage} onChange={e => setForm(f.code, { benefits: e.target.value })} className="text-sm" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Palette className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Colores</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS[f.code].map(p => {
                    const activo = p.primary === f.color_primary && p.secondary === f.color_secondary && p.text === f.text_color
                    return (
                      <button
                        key={p.nombre}
                        type="button"
                        disabled={!canManage}
                        onClick={() => setForm(f.code, { color_primary: p.primary, color_secondary: p.secondary, text_color: p.text })}
                        className={cn('group flex flex-col items-center gap-1 rounded-lg p-1 transition-colors hover:bg-white/[0.04]', activo && 'bg-white/[0.06]')}
                        aria-pressed={activo}
                        aria-label={`Paleta ${p.nombre}`}
                      >
                        <span className={cn('h-8 w-full rounded-md ring-1 ring-white/10', activo && 'ring-2 ring-white/70')} style={{ backgroundImage: `linear-gradient(135deg, ${p.primary}, ${p.secondary})` }} />
                        <span className="text-[10px] text-muted-foreground group-hover:text-foreground">{p.nombre}</span>
                      </button>
                    )
                  })}
                </div>
                <details className="group">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Avanzado: colores exactos</summary>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {([['color_primary', 'Inicio'], ['color_secondary', 'Fin'], ['text_color', 'Texto']] as const).map(([k, label]) => (
                      <div key={k} className="space-y-1">
                        <Label htmlFor={`${k}-${f.code}`} className="text-[10px]">{label}</Label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={f[k]}
                            disabled={!canManage}
                            onChange={e => setForm(f.code, { [k]: e.target.value.toUpperCase() })}
                            className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                            aria-label={`${label} de ${f.name}`}
                          />
                          <Input id={`${k}-${f.code}`} value={f[k]} maxLength={7} disabled={!canManage} onChange={e => setForm(f.code, { [k]: e.target.value })} className="h-8 font-mono text-xs uppercase" />
                        </div>
                        {k === 'text_color' && (
                          <p className="text-[10px] leading-snug text-muted-foreground">Siempre blanco por diseño; cambialo sólo si el fondo lo exige.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )
        })}
      </section>

      {canManage && (
        <div className="sticky bottom-0 z-10 -mx-3 flex justify-end border-t border-white/[0.06] bg-zinc-950/85 px-3 py-3 backdrop-blur-xl lg:-mx-6 lg:px-6">
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar categorías
          </Button>
        </div>
      )}
    </div>
  )
}
