'use client'

import { useState } from 'react'
import { LayoutGrid, ListChecks, Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProdeMatch, ProdeTeam } from '../../_lib/types'
import { SyncBar } from './sync-bar'
import { MatchList } from './match-list'
import { GroupsView } from './groups-view'
import { BracketView } from './bracket-view'

type View = 'lista' | 'grupos' | 'llaves'

const VIEWS: { id: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'lista', label: 'Lista', icon: ListChecks },
  { id: 'grupos', label: 'Grupos', icon: LayoutGrid },
  { id: 'llaves', label: 'Llaves', icon: Network },
]

export function ResultadosTab({
  matches,
  teams,
  lastSyncAt,
}: {
  matches: ProdeMatch[]
  teams: ProdeTeam[]
  lastSyncAt: string | null
}) {
  const [view, setView] = useState<View>('grupos')

  return (
    <div className="space-y-4">
      <SyncBar lastSyncAt={lastSyncAt} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {VIEWS.map((v) => {
            const Icon = v.icon
            const active = view === v.id
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {v.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {view === 'lista' && 'Cargá el resultado de cada partido — al guardar se puntúan las jugadas.'}
          {view === 'grupos' && 'Posiciones en vivo, calculadas con los resultados cargados.'}
          {view === 'llaves' && 'El cuadro de eliminación, partido por partido.'}
        </p>
      </div>

      {view === 'lista' && <MatchList matches={matches} teams={teams} />}
      {view === 'grupos' && <GroupsView matches={matches} teams={teams} />}
      {view === 'llaves' && <BracketView matches={matches} teams={teams} />}
    </div>
  )
}
