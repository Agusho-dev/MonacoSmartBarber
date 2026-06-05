'use client'

import { useState, useTransition } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RewardLite } from '../../_lib/types'
import { setPrizeMapping, updateReward } from '@/lib/actions/prode'

export type PrizeSlot = 'welcome' | 'weekly' | 'grand'

function benefitLabel(r: RewardLite): string {
  if (r.is_free_service) return 'Servicio gratis'
  if (r.discount_pct) return `${r.discount_pct}% de descuento`
  return 'Beneficio personalizado'
}

export function PrizeSlotCard({
  slot,
  title,
  hint,
  icon: Icon,
  reward,
  rewards,
}: {
  slot: PrizeSlot
  title: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  reward: RewardLite | null
  rewards: RewardLite[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-amber-500" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>

      <div className="mt-3 flex-1 rounded-lg border bg-muted/30 p-3">
        {reward ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-tight">{reward.name}</p>
              {!reward.is_active && (
                <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                  Inactiva
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{benefitLabel(reward)}</p>
            {reward.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reward.description}</p>
            )}
          </>
        ) : (
          <p className="text-xs italic text-muted-foreground">Sin recompensa asignada.</p>
        )}
      </div>

      <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        <Settings2 className="mr-1.5 size-4" /> Configurar
      </Button>

      <PrizeDialog
        open={open}
        onOpenChange={setOpen}
        slot={slot}
        title={title}
        reward={reward}
        rewards={rewards}
      />
    </div>
  )
}

function PrizeDialog({
  open,
  onOpenChange,
  slot,
  title,
  reward,
  rewards,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  slot: PrizeSlot
  title: string
  reward: RewardLite | null
  rewards: RewardLite[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-y-auto">
        {open && (
          <PrizeForm
            key={reward?.id ?? 'none'}
            slot={slot}
            title={title}
            reward={reward}
            rewards={rewards}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PrizeForm({
  slot,
  title,
  reward,
  rewards,
  onDone,
}: {
  slot: PrizeSlot
  title: string
  reward: RewardLite | null
  rewards: RewardLite[]
  onDone: () => void
}) {
  const [mappedId, setMappedId] = useState<string>(reward?.id ?? '')
  const [description, setDescription] = useState(reward?.description ?? '')
  const [discount, setDiscount] = useState<string>(reward?.discount_pct?.toString() ?? '')
  const [freeService, setFreeService] = useState(reward?.is_free_service ?? false)
  const [active, setActive] = useState(reward?.is_active ?? true)
  const [validUntil, setValidUntil] = useState<string>(
    reward?.valid_until ? reward.valid_until.slice(0, 10) : ''
  )
  const [savingMap, startMap] = useTransition()
  const [savingReward, startReward] = useTransition()

  const onSaveMapping = () => {
    if (!mappedId) return toast.error('Elegí una recompensa')
    startMap(async () => {
      const r = await setPrizeMapping({ slot, rewardId: mappedId })
      if ('error' in r) toast.error(r.error)
      else toast.success('Premio actualizado')
    })
  }

  const onSaveReward = () => {
    if (!reward) return
    const disc = discount.trim() === '' ? null : Number(discount)
    if (disc !== null && (!Number.isInteger(disc) || disc < 0 || disc > 100))
      return toast.error('El descuento debe estar entre 0 y 100')
    startReward(async () => {
      const r = await updateReward({
        rewardId: reward.id,
        description: description.trim() || null,
        discountPct: freeService ? null : disc,
        isFreeService: freeService,
        isActive: active,
        validUntil: validUntil || null,
      })
      if ('error' in r) toast.error(r.error)
      else {
        toast.success('Recompensa actualizada')
        onDone()
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Configurar premio · {title}</DialogTitle>
        <DialogDescription>
          Elegí qué recompensa se entrega y ajustá su beneficio.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>Recompensa a entregar</Label>
          <div className="flex items-center gap-2">
            <Select value={mappedId} onValueChange={setMappedId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Elegir recompensa" />
              </SelectTrigger>
              <SelectContent>
                {rewards.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveMapping}
              disabled={savingMap || mappedId === reward?.id}
            >
              {savingMap ? <Loader2 className="size-4 animate-spin" /> : 'Usar'}
            </Button>
          </div>
        </div>

        {reward && (
          <div className="space-y-4 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Detalle de “{reward.name}”
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="r-desc">Descripción</Label>
              <Textarea
                id="r-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Servicio gratis</p>
                <p className="text-xs text-muted-foreground">El premio es un servicio sin cargo.</p>
              </div>
              <Switch checked={freeService} onCheckedChange={setFreeService} />
            </div>

            {!freeService && (
              <div className="space-y-1.5">
                <Label htmlFor="r-disc">Descuento (%)</Label>
                <Input
                  id="r-disc"
                  type="number"
                  min={0}
                  max={100}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-28"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-valid">Vence</Label>
                <Input
                  id="r-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div className="flex items-end justify-between rounded-lg border px-3 py-2">
                <span className="text-sm font-medium">Activa</span>
                <Switch checked={active} onCheckedChange={setActive} />
              </div>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cerrar
        </Button>
        {reward && (
          <Button onClick={onSaveReward} disabled={savingReward}>
            {savingReward ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Guardar detalle
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
