'use client'

import { cn } from '@/lib/utils'
import type { ProdeTeam } from '../_lib/types'

// ---------------------------------------------------------------------------
// Banderas / equipos — usados por grupos, bracket y lista.
// Las flag_url son externas (crests.football-data.org, svg/png). Usamos <img>
// con fallback al código del país si la imagen falla o no existe.
// ---------------------------------------------------------------------------

export function TeamFlag({
  url,
  code,
  size = 22,
  className,
}: {
  url: string | null | undefined
  code: string | null | undefined
  size?: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-muted ring-1 ring-border',
        className
      )}
      style={{ width: size, height: Math.round(size * 0.72) }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          width={size}
          height={Math.round(size * 0.72)}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            const el = e.currentTarget
            el.style.display = 'none'
            const sib = el.nextElementSibling as HTMLElement | null
            if (sib) sib.style.display = 'flex'
          }}
        />
      ) : null}
      <span
        className="h-full w-full items-center justify-center text-[8px] font-bold tracking-tight text-muted-foreground"
        style={{ display: url ? 'none' : 'flex' }}
      >
        {(code ?? '??').slice(0, 3)}
      </span>
    </span>
  )
}

interface TeamLike {
  flag_url?: string | null
  short_name?: string | null
  code?: string | null
  name?: string | null
}

export function TeamName({
  team,
  fallbackLabel,
  size = 22,
  flagSize,
  bold,
  className,
}: {
  team?: TeamLike | null
  fallbackLabel?: string | null
  size?: number
  flagSize?: number
  bold?: boolean
  className?: string
}) {
  const label =
    team?.short_name || team?.name || team?.code || fallbackLabel || 'Por definir'
  const undefined_ = !team && !fallbackLabel
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <TeamFlag url={team?.flag_url} code={team?.code} size={flagSize ?? size} />
      <span
        className={cn(
          'truncate',
          bold && 'font-semibold',
          undefined_ && 'italic text-muted-foreground'
        )}
      >
        {label}
      </span>
    </span>
  )
}

/** Resuelve un equipo del mapa por id, con label de respaldo. */
export function resolveTeam(
  teams: Map<string, ProdeTeam>,
  teamId: string | null | undefined,
  label?: string | null
): ProdeTeam | null {
  if (teamId && teams.has(teamId)) return teams.get(teamId)!
  if (label) return { id: '', name: label, short_name: label, code: null, group_label: null, flag_url: null }
  return null
}

// ---------------------------------------------------------------------------
// Sección con título — header consistente dentro de los tabs.
// ---------------------------------------------------------------------------

export function SectionTitle({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
