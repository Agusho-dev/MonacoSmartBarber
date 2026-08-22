'use client'

// =============================================================================
// Selector de audiencia por filtros. Produce un `AudienceFilters` (el mismo
// shape que consumen `previewAudience` / `getFilteredClientIds` de
// `client-segments.ts` y que guardan `broadcasts.audience_filters` y
// `push_campaigns.audience_filters`).
//
// Es el mismo juego de filtros que el wizard de difusiones de
// `/dashboard/mensajeria` (segmentos, sucursales, etiquetas, último contacto,
// última visita, cantidad de visitas), pero sin depender del contexto de
// Mensajería: recibe sucursales y etiquetas por props, así se puede montar en
// cualquier pantalla. La difusión de WhatsApp puede migrar a este componente
// cuando se toque ese archivo.
// =============================================================================

import { useState } from 'react'
import { Calendar, Clock, Hash, MapPin, Tag } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AudienceFilters } from '@/lib/actions/client-segments'

export interface AudienceBranch { id: string; name: string }
export interface AudienceTag { id: string; name: string; color: string }

const SEGMENTS = [
  { key: 'nuevo', label: 'Nuevo', color: 'bg-blue-500' },
  { key: 'regular', label: 'Regular', color: 'bg-green-500' },
  { key: 'vip', label: 'VIP', color: 'bg-amber-500' },
  { key: 'en_riesgo', label: 'En riesgo', color: 'bg-orange-500' },
  { key: 'perdido', label: 'Perdido', color: 'bg-red-500' },
] as const

const CONTACT_RANGES: Array<{ label: string; maxDays?: number; minDays?: number }> = [
  { label: 'Sin filtro' },
  { label: 'Esta semana', maxDays: 7 },
  { label: 'Este mes', maxDays: 30 },
  { label: '1-3 meses', maxDays: 90, minDays: 30 },
  { label: '+3 meses', minDays: 90 },
]

// lastVisitMaxDays = "no viene hace al menos X días" (abandono)
// lastVisitMinDays = "vino dentro de los últimos X días" (recencia)
const VISIT_RANGES: Array<{
  label: string
  lastVisitMaxDays?: number
  lastVisitMinDays?: number
  minVisits?: number
  maxVisits?: number
}> = [
  { label: 'Sin filtro' },
  { label: 'Vino esta semana', lastVisitMinDays: 7 },
  { label: 'Vino este mes', lastVisitMinDays: 30 },
  { label: 'No viene hace 1-2 meses', lastVisitMaxDays: 30, lastVisitMinDays: 60 },
  { label: 'No viene hace +2 meses', lastVisitMaxDays: 60 },
  { label: 'Nunca vino', minVisits: 0, maxVisits: 0 },
]

interface Estado {
  segments: string[]
  branchIds: string[]
  tagIds: string[]
  contactRange: number
  visitRange: number
  minVisits: string
  maxVisits: string
}

function estadoDesdeFiltros(f: AudienceFilters | undefined): Estado {
  const contactRange = Math.max(0, CONTACT_RANGES.findIndex(
    r => r.maxDays === f?.lastContactDays && r.minDays === f?.lastContactMin,
  ))
  const visitRange = Math.max(0, VISIT_RANGES.findIndex(
    r => r.lastVisitMaxDays === f?.lastVisitMaxDays && r.lastVisitMinDays === f?.lastVisitMinDays,
  ))
  const vr = VISIT_RANGES[visitRange]
  return {
    segments: f?.segments ?? [],
    branchIds: f?.branchIds ?? [],
    tagIds: f?.tagIds ?? [],
    contactRange,
    visitRange,
    // Si el rango ya explica min/max (caso "Nunca vino"), no los duplicamos en los inputs.
    minVisits: f?.minVisits != null && vr?.minVisits !== f.minVisits ? String(f.minVisits) : '',
    maxVisits: f?.maxVisits != null && vr?.maxVisits !== f.maxVisits ? String(f.maxVisits) : '',
  }
}

function filtrosDesdeEstado(s: Estado): AudienceFilters {
  const vr = VISIT_RANGES[s.visitRange]
  const cr = CONTACT_RANGES[s.contactRange]
  const min = s.minVisits.trim() ? parseInt(s.minVisits, 10) : vr?.minVisits
  const max = s.maxVisits.trim() ? parseInt(s.maxVisits, 10) : vr?.maxVisits
  return {
    segments: s.segments.length ? s.segments : undefined,
    branchIds: s.branchIds.length ? s.branchIds : undefined,
    tagIds: s.tagIds.length ? s.tagIds : undefined,
    lastContactDays: cr?.maxDays,
    lastContactMin: cr?.minDays,
    lastVisitMaxDays: vr?.lastVisitMaxDays,
    lastVisitMinDays: vr?.lastVisitMinDays,
    minVisits: Number.isFinite(min as number) ? min : undefined,
    maxVisits: Number.isFinite(max as number) ? max : undefined,
    hasPhone: true,
  }
}

/** Resumen corto de un conjunto de filtros, para tablas ("VIP · Rondeau · No viene hace +2 meses"). */
export function describirFiltros(
  f: AudienceFilters | null | undefined,
  branches: AudienceBranch[] = [],
  tags: AudienceTag[] = [],
): string {
  if (!f) return 'Todos los clientes'
  const partes: string[] = []
  if (f.segments?.length) {
    partes.push(f.segments.map(s => SEGMENTS.find(x => x.key === s)?.label ?? s).join(', '))
  }
  if (f.branchIds?.length) {
    partes.push(f.branchIds.map(id => branches.find(b => b.id === id)?.name ?? 'Sucursal').join(', '))
  }
  if (f.tagIds?.length) {
    partes.push(f.tagIds.map(id => tags.find(t => t.id === id)?.name ?? 'Etiqueta').join(', '))
  }
  const cr = CONTACT_RANGES.find(r => r.maxDays === f.lastContactDays && r.minDays === f.lastContactMin)
  if (cr && cr.label !== 'Sin filtro') partes.push(`Contacto: ${cr.label.toLowerCase()}`)
  const vr = VISIT_RANGES.find(r => r.lastVisitMaxDays === f.lastVisitMaxDays && r.lastVisitMinDays === f.lastVisitMinDays && (r.minVisits ?? -1) === (f.minVisits ?? -1) && (r.maxVisits ?? -1) === (f.maxVisits ?? -1))
  if (vr && vr.label !== 'Sin filtro') partes.push(vr.label)
  else if (f.minVisits != null || f.maxVisits != null) {
    partes.push(`${f.minVisits ?? 0}${f.maxVisits != null ? `–${f.maxVisits}` : '+'} visitas`)
  }
  if (f.manualClientIds?.length) partes.push(`${f.manualClientIds.length} elegidos a mano`)
  return partes.length ? partes.join(' · ') : 'Todos los clientes'
}

interface Props {
  branches: AudienceBranch[]
  tags: AudienceTag[]
  /** Filtros iniciales (para duplicar una campaña). Sólo se leen al montar. */
  initial?: AudienceFilters
  onChange: (filters: AudienceFilters) => void
  disabled?: boolean
}

function Chip({ active, onClick, children, activeClass = 'bg-primary text-primary-foreground border-transparent', disabled }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  activeClass?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        active ? activeClass : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export function AudienceFilters({ branches, tags, initial, onChange, disabled }: Props) {
  const [estado, setEstado] = useState<Estado>(() => estadoDesdeFiltros(initial))

  const actualizar = (patch: Partial<Estado>) => {
    const next = { ...estado, ...patch }
    setEstado(next)
    onChange(filtrosDesdeEstado(next))
  }
  const toggle = (lista: string[], id: string) => (lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id])

  return (
    <div className="space-y-5">
      {branches.length > 1 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <MapPin className="size-3" /> Sucursales donde se atendió
          </Label>
          <div className="flex flex-wrap gap-2">
            {branches.map(b => (
              <Chip key={b.id} disabled={disabled} active={estado.branchIds.includes(b.id)}
                onClick={() => actualizar({ branchIds: toggle(estado.branchIds, b.id) })}
                activeClass="bg-violet-600 text-white border-transparent">
                <MapPin className="size-2.5" /> {b.name}
              </Chip>
            ))}
          </div>
          {estado.branchIds.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Sin filtro = clientes de todas las sucursales</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Segmentos</Label>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map(s => (
            <Chip key={s.key} disabled={disabled} active={estado.segments.includes(s.key)}
              onClick={() => actualizar({ segments: toggle(estado.segments, s.key) })}
              activeClass="bg-emerald-600 text-white border-transparent">
              <span className={`size-2 rounded-full ${s.color}`} /> {s.label}
            </Chip>
          ))}
        </div>
        {estado.segments.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Sin filtro = todos los segmentos</p>
        )}
      </div>

      {tags.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <Tag className="size-3" /> Etiquetas
          </Label>
          <div className="flex flex-wrap gap-2">
            {tags.map(t => {
              const activa = estado.tagIds.includes(t.id)
              return (
                <button key={t.id} type="button" disabled={disabled} aria-pressed={activa}
                  onClick={() => actualizar({ tagIds: toggle(estado.tagIds, t.id) })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    activa ? 'border-transparent text-white' : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                  }`}
                  style={activa ? { backgroundColor: t.color } : undefined}>
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Clock className="size-3" /> Último contacto (mensaje)
        </Label>
        <div className="flex flex-wrap gap-2">
          {CONTACT_RANGES.map((r, i) => (
            <Chip key={r.label} disabled={disabled} active={estado.contactRange === i}
              onClick={() => actualizar({ contactRange: i })}
              activeClass="bg-emerald-600 text-white border-transparent">
              {r.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Calendar className="size-3" /> Última visita (corte)
        </Label>
        <div className="flex flex-wrap gap-2">
          {VISIT_RANGES.map((r, i) => (
            <Chip key={r.label} disabled={disabled} active={estado.visitRange === i}
              onClick={() => actualizar({ visitRange: i })}
              activeClass="bg-cyan-600 text-white border-transparent">
              {r.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Hash className="size-3" /> Cantidad de visitas (opcional)
        </Label>
        <div className="flex items-center gap-3">
          <Input type="number" min={0} placeholder="Mín" className="w-24" disabled={disabled}
            value={estado.minVisits} onChange={e => actualizar({ minVisits: e.target.value })} />
          <span className="text-xs text-muted-foreground">a</span>
          <Input type="number" min={0} placeholder="Máx" className="w-24" disabled={disabled}
            value={estado.maxVisits} onChange={e => actualizar({ maxVisits: e.target.value })} />
          <span className="text-xs text-muted-foreground">visitas</span>
        </div>
      </div>
    </div>
  )
}
