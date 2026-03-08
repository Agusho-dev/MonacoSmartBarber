'use client'

import { useState, useTransition } from 'react'
import { Gift, Save, Trophy, Users, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { updateRewardConfig } from '@/lib/actions/rewards'

interface Branch {
  id: string
  name: string
}

interface RewardConfig {
  id: string
  branch_id: string
  points_per_visit: number
  redemption_threshold: number
  reward_description: string
  is_active: boolean
}

interface TopClient {
  points_balance: number
  total_earned: number
  total_redeemed: number
  clients: {
    name: string
    phone: string
    email: string | null
  } | null
  branches: {
    name: string
  } | null
}

interface Props {
  branches: Branch[]
  initialConfigs: RewardConfig[]
  topClients: TopClient[]
}

export function FidelizacionClient({ branches, initialConfigs, topClients }: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id || '')
  
  const currentConfig = initialConfigs.find((c) => c.branch_id === selectedBranchId) || {
    id: 'new',
    branch_id: selectedBranchId,
    points_per_visit: 1,
    redemption_threshold: 10,
    reward_description: 'Corte gratis',
    is_active: true,
  }

  const [formData, setFormData] = useState({
    points_per_visit: currentConfig.points_per_visit,
    redemption_threshold: currentConfig.redemption_threshold,
    reward_description: currentConfig.reward_description,
    is_active: currentConfig.is_active,
  })

  const [isPending, startTransition] = useTransition()

  function handleBranchChange(branchId: string) {
    setSelectedBranchId(branchId)
    const config = initialConfigs.find((c) => c.branch_id === branchId)
    if (config) {
      setFormData({
        points_per_visit: config.points_per_visit,
        redemption_threshold: config.redemption_threshold,
        reward_description: config.reward_description,
        is_active: config.is_active,
      })
    } else {
      setFormData({
        points_per_visit: 1,
        redemption_threshold: 10,
        reward_description: 'Corte gratis',
        is_active: true,
      })
    }
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateRewardConfig(selectedBranchId, formData)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Configuración guardada')
        // El router revalidatePath actualizará initialConfigs en el próximo render
      }
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fidelización</h1>
          <p className="text-muted-foreground">
            Configurá el sistema de recompensas y mirá el ranking de clientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedBranchId} onValueChange={handleBranchChange}>
            <SelectTrigger className="w-[200px] bg-background">
              <SelectValue placeholder="Seleccionar sucursal" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="size-5 text-primary" />
              Configurar Recompensas
            </CardTitle>
            <CardDescription>
              Definí cómo acumulan puntos los clientes en esta sucursal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Sistema Activado</Label>
                <p className="text-sm text-muted-foreground">
                  Si se desactiva, no se otorgarán puntos nuevos.
                </p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="points">Puntos logrados por cada visita</Label>
                <Input
                  id="points"
                  type="number"
                  min="1"
                  value={formData.points_per_visit}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      points_per_visit: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="threshold">Puntos necesarios para canjear (Precio)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  value={formData.redemption_threshold}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      redemption_threshold: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="reward">Beneficio a otorgar</Label>
                <Input
                  id="reward"
                  value={formData.reward_description}
                  onChange={(e) =>
                    setFormData({ ...formData, reward_description: e.target.value })
                  }
                  placeholder="Ej: Corte gratis"
                />
              </div>
            </div>

            <Button className="w-full" onClick={handleSave} disabled={isPending}>
              {isPending ? 'Guardando...' : (
                <>
                  <Save className="mr-2 size-4" />
                  Guardar Configuración
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-muted-foreground" />
              ¿Cómo funciona?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              1. Cada vez que un barbero <strong>finaliza un servicio</strong> desde su panel,
              el cliente suma automáticamente los puntos configurados.
            </p>
            <p>
              2. Los clientes pueden ver sus puntos en la <strong>App/PWA de clientes</strong>.
            </p>
            <p>
              3. Cuando el cliente presiona &quot;Canjear premio&quot; en su app, su turno activo en la sala
              aparecerá marcado con un ícono 🎁 para el barbero.
            </p>
            <p>
              4. El barbero, al finalizar el corte de ese cliente, elegirá la opción de pago <strong>Puntos</strong> y 
              esto registrará el corte a costo 0 y debitará automáticamente los puntos del cliente.
            </p>
            <Separator className="my-2" />
            <p className="font-medium text-foreground">
              ¡Importante! Si activas o desactivas esto, los balances de los clientes se conservarán.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-5 text-amber-500" />
            Top Clientes (Global)
          </CardTitle>
          <CardDescription>
            Clientes con más puntos acumulados en todas las sucursales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_100px_100px_100px] gap-4 border-b bg-muted/50 p-4 font-medium sm:grid-cols-[1fr_200px_100px_100px_100px]">
              <div>Cliente</div>
              <div className="hidden sm:block">Sucursal Principal</div>
              <div className="text-right">Balance</div>
              <div className="text-right">Ganados</div>
              <div className="text-right">Canjeados</div>
            </div>
            {topClients.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Users className="mx-auto mb-3 size-8 opacity-20" />
                <p>No hay puntos registrados todavía.</p>
              </div>
            ) : (
              <div className="divide-y">
                {topClients.map((tc, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_100px_100px_100px] items-center gap-4 p-4 text-sm sm:grid-cols-[1fr_200px_100px_100px_100px]"
                  >
                    <div>
                      <p className="font-medium">{tc.clients?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {tc.clients?.phone}
                      </p>
                    </div>
                    <div className="hidden truncate text-muted-foreground sm:block">
                      {tc.branches?.name || '—'}
                    </div>
                    <div className="text-right font-bold text-primary">
                      {tc.points_balance} pts
                    </div>
                    <div className="text-right text-muted-foreground">
                      {tc.total_earned}
                    </div>
                    <div className="text-right text-muted-foreground">
                      {tc.total_redeemed}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
