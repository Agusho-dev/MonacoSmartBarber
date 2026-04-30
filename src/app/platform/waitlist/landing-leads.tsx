'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Scissors,
  Search,
  Store,
  UserRound,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  updateLandingLeadStatus,
  type LandingLead,
  type LandingLeadStatus,
} from '@/lib/actions/platform-billing'

const TEAM_LABELS: Record<string, string> = {
  solo: 'Solo',
  '2_3': '2-3 barberos',
  '4_6': '4-6 barberos',
  '7_15': '7-15 barberos',
  '15_plus': '15+ barberos',
}

const BRANCH_LABELS: Record<string, string> = {
  '1': '1 local',
  '2_3': '2-3 sucursales',
  '4_10': '4-10 sucursales',
  '10_plus': '10+ sucursales',
}

const SOFTWARE_LABELS: Record<string, string> = {
  ninguno: 'Nada',
  fresha: 'Fresha',
  booksy: 'Booksy',
  agendapro: 'AgendaPro',
  planilla: 'Planilla',
  otro: 'Otro',
}

const TIMELINE_LABELS: Record<string, { label: string; accent: string }> = {
  asap: { label: 'Ya, esta semana', accent: 'bg-red-500/10 text-red-300' },
  '1_mes': { label: 'En 1 mes', accent: 'bg-amber-500/10 text-amber-300' },
  '3_meses': { label: 'En 3 meses', accent: 'bg-blue-500/10 text-blue-300' },
  explorando: { label: 'Explorando', accent: 'bg-zinc-700/50 text-zinc-300' },
}

const INTEREST_LABELS: Record<string, string> = {
  face_id: 'Face ID',
  crm: 'CRM',
  panel: 'Panel barberos',
  finanzas: 'Finanzas',
  estadisticas: 'Estadísticas',
  reseñas: 'Reseñas',
}

const STATUS_META: Record<LandingLeadStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-300' },
  contacted: { label: 'Contactado', cls: 'bg-blue-500/10 text-blue-300' },
  converted: { label: 'Convertido', cls: 'bg-emerald-500/10 text-emerald-300' },
  discarded: { label: 'Descartado', cls: 'bg-zinc-700/40 text-zinc-400' },
}

const STATUS_FILTERS: { value: 'all' | LandingLeadStatus; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'contacted', label: 'Contactados' },
  { value: 'converted', label: 'Convertidos' },
  { value: 'discarded', label: 'Descartados' },
]

export function LandingLeads({ leads }: { leads: LandingLead[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | LandingLeadStatus>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter(l => {
      if (filter !== 'all' && l.status !== filter) return false
      if (!q) return true
      return (
        l.full_name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        (l.barbershop_name?.toLowerCase().includes(q) ?? false) ||
        (l.city?.toLowerCase().includes(q) ?? false) ||
        (l.phone?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [leads, query, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: leads.length,
      pending: 0,
      contacted: 0,
      converted: 0,
      discarded: 0,
    }
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1
    return c
  }, [leads])

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-10 text-center">
        <UserRound className="mx-auto mb-3 size-8 text-zinc-600" />
        <p className="text-sm text-zinc-400">Sin leads del landing todavía.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Cuando alguien complete el cuestionario en{' '}
          <code className="rounded bg-zinc-800 px-1">studios.com.ar</code> aparecerá acá.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre, email, barbería…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => {
            const active = filter === f.value
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800/60'
                )}
              >
                {f.label}
                <span className="rounded bg-zinc-800/80 px-1 text-[10px] tabular-nums">
                  {counts[f.value] ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
          No hay leads para este filtro.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map(l => (
            <LeadRow key={l.id} lead={l} />
          ))}
        </ul>
      )}
    </div>
  )
}

function LeadRow({ lead }: { lead: LandingLead }) {
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<LandingLeadStatus>(lead.status)

  const setNewStatus = (next: LandingLeadStatus) => {
    if (next === status) return
    const prev = status
    setStatus(next)
    startTransition(async () => {
      const res = await updateLandingLeadStatus(lead.id, next)
      if ('error' in res) {
        setStatus(prev)
        alert(res.error)
      }
    })
  }

  const statusMeta = STATUS_META[status]
  const timeline = TIMELINE_LABELS[lead.start_timeline]
  const waCleaned = lead.phone?.replace(/\D/g, '') ?? ''
  const waUrl = waCleaned ? `https://wa.me/${waCleaned}` : null
  const mailUrl = `mailto:${lead.email}`

  return (
    <li className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setExpanded(x => !x)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-zinc-900/70"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500/30 to-emerald-600/10 text-sm font-semibold text-emerald-200">
          {initials(lead.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-zinc-100">{lead.full_name}</span>
            <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', statusMeta.cls)}>
              {statusMeta.label}
            </span>
            {timeline && (
              <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium', timeline.accent)}>
                {timeline.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" />
              {lead.email}
            </span>
            {lead.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />
                {lead.phone}
              </span>
            )}
            {lead.barbershop_name && (
              <span className="inline-flex items-center gap-1">
                <Store className="size-3" />
                {lead.barbershop_name}
              </span>
            )}
            {lead.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {lead.city}
              </span>
            )}
          </div>
        </div>
        <div className="hidden text-right text-xs text-zinc-500 sm:block">
          <div>{new Date(lead.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</div>
          <div className="text-[10px]">
            {new Date(lead.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoBlock
              icon={<Scissors className="size-3.5" />}
              label="Equipo"
              value={TEAM_LABELS[lead.team_size] ?? lead.team_size}
            />
            <InfoBlock
              icon={<Building2 className="size-3.5" />}
              label="Sucursales"
              value={BRANCH_LABELS[lead.branches_count] ?? lead.branches_count}
            />
            <InfoBlock
              icon={<UserRound className="size-3.5" />}
              label="Software actual"
              value={lead.current_software ? SOFTWARE_LABELS[lead.current_software] ?? lead.current_software : '—'}
            />
            <InfoBlock
              icon={<MapPin className="size-3.5" />}
              label="Ubicación"
              value={[lead.city, lead.country].filter(Boolean).join(', ') || '—'}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Intereses</div>
            <div className="flex flex-wrap gap-1.5">
              {lead.interests.length === 0 ? (
                <span className="text-xs text-zinc-500">—</span>
              ) : (
                lead.interests.map(k => (
                  <span
                    key={k}
                    className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
                  >
                    {INTEREST_LABELS[k] ?? k}
                  </span>
                ))
              )}
            </div>
          </div>

          {(lead.utm_source || lead.utm_campaign || lead.referrer) && (
            <div className="mt-4 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 font-mono text-[11px] text-zinc-500">
              {lead.utm_source && <div>utm_source: <span className="text-zinc-300">{lead.utm_source}</span></div>}
              {lead.utm_medium && <div>utm_medium: <span className="text-zinc-300">{lead.utm_medium}</span></div>}
              {lead.utm_campaign && <div>utm_campaign: <span className="text-zinc-300">{lead.utm_campaign}</span></div>}
              {lead.referrer && <div>referrer: <span className="text-zinc-300">{lead.referrer}</span></div>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={mailUrl}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <Mail className="size-3.5" />
              Email
              <ExternalLink className="size-3 text-zinc-500" />
            </a>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                <MessageCircle className="size-3.5" />
                WhatsApp
                <ExternalLink className="size-3 text-emerald-400/60" />
              </a>
            )}

            <div className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
              <StatusBtn
                active={status === 'pending'}
                disabled={isPending}
                onClick={() => setNewStatus('pending')}
                label="Pendiente"
              />
              <StatusBtn
                active={status === 'contacted'}
                disabled={isPending}
                onClick={() => setNewStatus('contacted')}
                label="Contactado"
                icon={<Check className="size-3" />}
              />
              <StatusBtn
                active={status === 'converted'}
                disabled={isPending}
                onClick={() => setNewStatus('converted')}
                label="Convertido"
                icon={<CheckCircle2 className="size-3" />}
              />
              <StatusBtn
                active={status === 'discarded'}
                disabled={isPending}
                onClick={() => setNewStatus('discarded')}
                label="Descartar"
                icon={<XCircle className="size-3" />}
              />
            </div>
          </div>

          {lead.notes && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Notas</div>
              {lead.notes}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function StatusBtn({
  active,
  disabled,
  onClick,
  label,
  icon,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
        active
          ? 'bg-zinc-100 text-zinc-900'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        disabled && 'cursor-wait opacity-60'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function InfoBlock({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm text-zinc-100">{value}</div>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}
