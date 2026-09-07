'use client'

// =============================================================================
// Premios: la grilla del catálogo (con imagen o lámina de color) y la vista
// "escalera" — los premios activos sobre una línea ordenada por puntos, para
// ver de un vistazo si hay escalones cercanos o huecos.
// =============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Grid3x3, Loader2, Lock, MoreHorizontal, Pencil, Plus, Power, Star, TrendingUp, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { deleteReward, toggleReward } from '@/lib/actions/loyalty'
import type { LoyaltyReward, LoyaltyService, LoyaltySettings, LoyaltyTier } from '@/lib/types/loyalty'
import { KIND_ICON, PremioEditorSheet } from './premio-editor-sheet'
import { fmtFecha, numero, REWARD_KIND_LABEL } from './helpers'

interface Props {
  rewards: LoyaltyReward[]
  tiers: LoyaltyTier[]
  services: LoyaltyService[]
  settings: LoyaltySettings
  canManage: boolean
  onChange: (rewards: LoyaltyReward[]) => void
}

type Vista = 'grilla' | 'escalera'

export function PremiosTab({ rewards, tiers, services, settings, canManage, onChange }: Props) {
  const router = useRouter()
  const [vista, setVista] = useState<Vista>('grilla')
  const [editor, setEditor] = useState<{ open: boolean; reward: LoyaltyReward | null; key: number }>({ open: false, reward: null, key: 0 })
  const [borrar, setBorrar] = useState<LoyaltyReward | null>(null)
  const [pending, startTransition] = useTransition()
  const [ocupado, setOcupado] = useState<string | null>(null)

  const nombreTier = (code: string) => tiers.find(t => t.code === code)?.name ?? code
  const activos = rewards.filter(r => r.is_active && r.points_cost > 0).sort((a, b) => a.points_cost - b.points_cost)

  function abrir(reward: LoyaltyReward | null) {
    setEditor(e => ({ open: true, reward, key: e.key + 1 }))
  }

  function guardado(r: LoyaltyReward) {
    const existe = rewards.some(x => x.id === r.id)
    onChange(existe ? rewards.map(x => (x.id === r.id ? { ...x, ...r, redemptions_count: x.redemptions_count } : x)) : [...rewards, { ...r, redemptions_count: 0 }])
    router.refresh()
  }

  async function alternar(r: LoyaltyReward) {
    setOcupado(r.id)
    const res = await toggleReward(r.id, !r.is_active)
    setOcupado(null)
    if ('error' in res) { toast.error(res.error); return }
    onChange(rewards.map(x => (x.id === r.id ? { ...x, is_active: !r.is_active } : x)))
    toast.success(!r.is_active ? `${r.name} activado` : `${r.name} desactivado`)
  }

  function confirmarBorrado() {
    const r = borrar
    if (!r) return
    startTransition(async () => {
      const res = await deleteReward(r.id)
      setBorrar(null)
      if ('error' in res) { toast.error(res.error); return }
      if (res.deactivated) {
        onChange(rewards.map(x => (x.id === r.id ? { ...x, is_active: false } : x)))
        toast.info(`${r.name} ya tiene canjes: se desactivó en vez de borrarse.`)
      } else {
        onChange(rewards.filter(x => x.id !== r.id))
        toast.success(`${r.name} borrado`)
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Catálogo de premios</h3>
          <p className="text-sm text-muted-foreground">{numero(activos.length)} activos de {numero(rewards.length)} · el cliente ve sólo los activos y vigentes.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 p-0.5">
            <button type="button" onClick={() => setVista('grilla')} aria-pressed={vista === 'grilla'} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', vista === 'grilla' ? 'bg-white/[0.1]' : 'text-muted-foreground hover:text-foreground')}>
              <Grid3x3 className="size-3.5" /> Grilla
            </button>
            <button type="button" onClick={() => setVista('escalera')} aria-pressed={vista === 'escalera'} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', vista === 'escalera' ? 'bg-white/[0.1]' : 'text-muted-foreground hover:text-foreground')}>
              <TrendingUp className="size-3.5" /> Escalera
            </button>
          </div>
          {canManage && (
            <Button onClick={() => abrir(null)}><Plus className="size-4" /> Nuevo premio</Button>
          )}
        </div>
      </div>

      {rewards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-14 text-center">
          <Star className="size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Todavía no hay premios. Una buena escalera arranca con un 30 % OFF alcanzable y termina en algo aspiracional.</p>
          {canManage && <Button variant="outline" onClick={() => abrir(null)}><Plus className="size-4" /> Crear el primero</Button>}
        </div>
      ) : vista === 'escalera' ? (
        <Escalera rewards={activos} nombreTier={nombreTier} onEdit={canManage ? abrir : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rewards.map(r => {
            const Icon = KIND_ICON[r.kind] ?? Star
            const agotado = r.stock !== null && r.stock <= 0
            const vencido = !!r.valid_until && new Date(r.valid_until) < new Date()
            const futuro = !!r.valid_from && new Date(r.valid_from) > new Date()
            return (
              <article key={r.id} className={cn('group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 transition-colors hover:border-white/[0.12]', !r.is_active && 'opacity-60')}>
                <div className={cn('relative aspect-[16/10] overflow-hidden', !r.image_url && lamina(r))}>
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex size-full items-center justify-center"><Icon className="size-10 text-white/60" /></div>
                  )}
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur">{numero(r.points_cost)} pts</span>
                    {r.is_featured && <span className="flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-1 text-[10px] font-semibold text-black"><Star className="size-3" /> Destacado</span>}
                  </div>
                  <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1.5">
                    {!r.is_active && <Badge variant="outline" className="bg-black/60 backdrop-blur">Inactivo</Badge>}
                    {agotado && <Badge variant="destructive">Agotado</Badge>}
                    {vencido && <Badge variant="outline" className="bg-black/60 backdrop-blur">Vencido</Badge>}
                    {futuro && <Badge variant="outline" className="bg-black/60 backdrop-blur">Desde {fmtFecha(r.valid_from)}</Badge>}
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold">{r.name}</h4>
                      <p className="text-xs text-muted-foreground">
                        {REWARD_KIND_LABEL[r.kind]}
                        {r.kind === 'descuento' && r.discount_pct != null && ` · ${r.discount_pct >= 100 ? 'gratis' : `${r.discount_pct} %`}`}
                        {r.service?.name ? ` · ${r.service.name}` : r.kind === 'descuento' ? ' · cualquier servicio' : ''}
                        {r.kind === 'merch' && ` · stock ${r.stock === null ? 'ilimitado' : numero(r.stock)}`}
                      </p>
                    </div>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${r.name}`} disabled={ocupado === r.id}>
                            {ocupado === r.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => abrir(r)}><Pencil className="size-4" /> Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alternar(r)}><Power className="size-4" /> {r.is_active ? 'Desactivar' : 'Activar'}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setBorrar(r)}><Trash2 className="size-4" /> Borrar</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {r.description && <p className="line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {r.allowed_tiers && (
                      <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">
                        <Lock className="size-3" /> Solo {r.allowed_tiers.map(nombreTier).join(' y ')}
                      </span>
                    )}
                    {r.allow_stacking && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">Acumulable</span>}
                    {r.validity_days != null && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">Vale {r.validity_days} días</span>}
                    {(r.redemptions_count ?? 0) > 0 && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">{numero(r.redemptions_count)} canjes</span>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editor.open && (
        <PremioEditorSheet
          key={editor.key}
          open={editor.open}
          onOpenChange={o => setEditor(e => ({ ...e, open: o }))}
          reward={editor.reward}
          tiers={tiers}
          services={services}
          settings={settings}
          onSaved={guardado}
        />
      )}

      <AlertDialog open={!!borrar} onOpenChange={o => { if (!o) setBorrar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar {borrar?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              {(borrar?.redemptions_count ?? 0) > 0
                ? `Este premio ya fue canjeado ${numero(borrar?.redemptions_count)} veces, así que no se puede borrar: se va a desactivar y deja de aparecer en la app.`
                : 'Desaparece del catálogo. Si preferís esconderlo por un tiempo, desactivalo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarBorrado} disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {(borrar?.redemptions_count ?? 0) > 0 ? 'Desactivar' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Lámina de color cuando el premio no tiene foto. */
function lamina(r: LoyaltyReward): string {
  if (r.kind === 'merch') return 'bg-[linear-gradient(135deg,#1f2937_0%,#4b5563_100%)]'
  if (r.kind === 'especial') return 'bg-[linear-gradient(135deg,#312e81_0%,#6d28d9_100%)]'
  return 'bg-[linear-gradient(135deg,#27272a_0%,#52525b_100%)]'
}

function Escalera({ rewards, nombreTier, onEdit }: { rewards: LoyaltyReward[]; nombreTier: (c: string) => string; onEdit?: (r: LoyaltyReward) => void }) {
  if (rewards.length === 0) {
    return <p className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">No hay premios activos para dibujar la escalera.</p>
  }
  const max = Math.max(...rewards.map(r => r.points_cost))
  const pos = (p: number) => 6 + (p / max) * 88 // % sobre la línea, con margen
  return (
    <div className="space-y-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5">
      <p className="text-xs text-muted-foreground">Cada punto es un premio activo, ubicado según cuántos puntos cuesta. Los escalones cercanos dan objetivos; los huecos largos, desmotivan.</p>
      <div className="relative h-56 sm:h-48">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/15" />
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <span key={f} className="absolute top-1/2 -translate-x-1/2 translate-y-3 text-[10px] text-muted-foreground tabular-nums" style={{ left: `${pos(f * max)}%` }}>
            {numero(Math.round(f * max))}
          </span>
        ))}
        {rewards.map((r, i) => {
          const Icon = KIND_ICON[r.kind] ?? Star
          const arriba = i % 2 === 0
          return (
            <button
              key={r.id}
              type="button"
              onClick={onEdit ? () => onEdit(r) : undefined}
              className={cn('group absolute flex -translate-x-1/2 flex-col items-center gap-1.5 text-center', arriba ? 'bottom-1/2 mb-3' : 'top-1/2 mt-3 flex-col-reverse', !onEdit && 'cursor-default')}
              style={{ left: `${pos(r.points_cost)}%`, maxWidth: 120 }}
              aria-label={`${r.name}, ${r.points_cost} puntos`}
            >
              <span className="w-full">
                <span className="block truncate text-[11px] font-semibold leading-tight">{r.name}</span>
                <span className="block text-[10px] text-muted-foreground tabular-nums">{numero(r.points_cost)} pts{r.allowed_tiers ? ` · ${r.allowed_tiers.map(nombreTier).join('/')}` : ''}</span>
              </span>
              <span className={cn('flex size-8 items-center justify-center rounded-full border-2 border-zinc-950 shadow transition-transform group-hover:scale-110', r.kind === 'merch' ? 'bg-slate-500' : r.kind === 'especial' ? 'bg-violet-600' : 'bg-zinc-200 text-black')}>
                <Icon className="size-3.5" />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
