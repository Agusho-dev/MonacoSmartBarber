'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Copy, Loader2, Search, Trash2, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { LeagueRow, ParticipantRow } from '../../_lib/types'
import { fmtDateShort } from '../../_lib/fmt'
import { deleteLeague, deleteParticipant } from '@/lib/actions/prode'

export function ParticipantesTab({
  participants,
  leagues,
}: {
  participants: ParticipantRow[]
  leagues: LeagueRow[]
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return participants
    return participants.filter(
      (p) =>
        p.display_name.toLowerCase().includes(q) ||
        (p.client_name ?? '').toLowerCase().includes(q) ||
        (p.phone ?? '').includes(q)
    )
  }, [participants, query])

  const completed = participants.filter((p) => p.profile_completed).length

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5" /> Participantes ({participants.length})
              </CardTitle>
              <CardDescription>
                {completed} con perfil completo. Usá la búsqueda para encontrar a alguien o limpiar data de prueba.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o teléfono…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {participants.length === 0 ? 'Sin participantes todavía.' : 'Nadie coincide con la búsqueda.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead className="text-center">Jugadas</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <ParticipantRowItem key={p.id} participant={p} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-5" /> Ligas ({leagues.length})
          </CardTitle>
          <CardDescription>
            Compartí el código de invitación para que se sumen. La liga de la casa no se puede eliminar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leagues.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin ligas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-center">Miembros</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leagues.map((l) => (
                  <LeagueRowItem key={l.id} league={l} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ParticipantRowItem({ participant }: { participant: ParticipantRow }) {
  const [isPending, startTransition] = useTransition()
  const onDelete = () => {
    startTransition(async () => {
      const r = await deleteParticipant(participant.id)
      if ('error' in r) toast.error(r.error)
      else toast.success('Participante eliminado')
    })
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{participant.display_name}</TableCell>
      <TableCell className="text-muted-foreground">{participant.phone ?? '—'}</TableCell>
      <TableCell>
        {participant.profile_completed ? (
          <Badge variant="outline" className="border-emerald-300 text-emerald-600">
            Completo
          </Badge>
        ) : (
          <Badge variant="outline">Incompleto</Badge>
        )}
      </TableCell>
      <TableCell className="text-center tabular-nums">{participant.plays}</TableCell>
      <TableCell className="text-muted-foreground">{fmtDateShort(participant.created_at)}</TableCell>
      <TableCell className="text-right">
        <ConfirmDelete
          title="¿Eliminar participante?"
          description={`Se eliminará "${participant.display_name}" y sus jugadas. Esta acción no se puede deshacer.`}
          onConfirm={onDelete}
          disabled={isPending}
        />
      </TableCell>
    </TableRow>
  )
}

function LeagueRowItem({ league }: { league: LeagueRow }) {
  const [isPending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  const onDelete = () => {
    startTransition(async () => {
      const r = await deleteLeague(league.id)
      if ('error' in r) toast.error(r.error)
      else toast.success('Liga eliminada')
    })
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(league.invite_code)
      setCopied(true)
      toast.success('Código copiado')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {league.name}
          {league.is_house && <Badge className="text-[10px]">Casa</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs transition-colors hover:bg-muted"
          title="Copiar código"
        >
          {league.invite_code}
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </TableCell>
      <TableCell className="text-center tabular-nums">{league.member_count}</TableCell>
      <TableCell className="text-right">
        {league.is_house ? (
          <Button variant="ghost" size="icon" disabled aria-label="No se puede eliminar">
            <Trash2 className="size-4 text-muted-foreground/40" />
          </Button>
        ) : (
          <ConfirmDelete
            title="¿Eliminar liga?"
            description={`Se eliminará la liga "${league.name}" y sus membresías. Esta acción no se puede deshacer.`}
            onConfirm={onDelete}
            disabled={isPending}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

export function ConfirmDelete({
  title,
  description,
  onConfirm,
  disabled,
}: {
  title: string
  description: string
  onConfirm: () => void
  disabled?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="Eliminar">
          {disabled ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4 text-destructive" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
