'use client'

import { useState, useTransition } from 'react'
import { upsertPaymentAccount, togglePaymentAccount, deletePaymentAccount } from '@/lib/actions/paymentAccounts'
import type { Branch, PaymentAccount } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'

interface AccountWithBranch extends PaymentAccount {
  branch?: { name: string } | null
}

interface Props {
  accounts: AccountWithBranch[]
  branches: Branch[]
}

const EMPTY_FORM = { id: '', branch_id: '', name: '', alias_or_cbu: '' }

export function CuentasClient({ accounts, branches }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [, startTransition] = useTransition()

  function openCreate() {
    setForm({ ...EMPTY_FORM, branch_id: branches[0]?.id ?? '' })
    setDialogOpen(true)
  }

  function openEdit(acc: AccountWithBranch) {
    setForm({
      id: acc.id,
      branch_id: acc.branch_id,
      name: acc.name,
      alias_or_cbu: acc.alias_or_cbu ?? '',
    })
    setDialogOpen(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    if (form.id) fd.append('id', form.id)
    fd.append('branch_id', form.branch_id)
    fd.append('name', form.name)
    fd.append('alias_or_cbu', form.alias_or_cbu)

    startTransition(async () => {
      const result = await upsertPaymentAccount(fd)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(form.id ? 'Cuenta actualizada' : 'Cuenta creada')
        setDialogOpen(false)
      }
    })
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const result = await togglePaymentAccount(id, !current)
      if (result.error) toast.error(result.error)
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePaymentAccount(id)
      if (result.error) toast.error(result.error)
      else toast.success('Cuenta eliminada')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cuentas de cobro</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá los alias y CBUs disponibles para que los barberos puedan imputar cobros.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-2" />
          Nueva cuenta
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Wallet className="size-10 mx-auto mb-4 text-muted-foreground" />
          <p className="font-medium">No hay cuentas configuradas</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Agregá cuentas bancarias o alias para que los barberos las usen al cerrar cada servicio.
          </p>
          <Button onClick={openCreate} variant="outline">
            <Plus className="size-4 mr-2" />
            Agregar primera cuenta
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted shrink-0">
                <Wallet className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{acc.name}</p>
                  {!acc.is_active && (
                    <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                  )}
                </div>
                {acc.alias_or_cbu && (
                  <p className="text-sm text-muted-foreground font-mono">{acc.alias_or_cbu}</p>
                )}
                {acc.branch && (
                  <p className="text-xs text-muted-foreground mt-0.5">{acc.branch.name}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={acc.is_active}
                  onCheckedChange={() => handleToggle(acc.id, acc.is_active)}
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(acc)}>
                  <Pencil className="size-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar cuenta?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Las visitas ya imputadas a esta cuenta conservarán el registro.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => handleDelete(acc.id)}
                      >
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar cuenta' : 'Nueva cuenta de cobro'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Sucursal</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Seleccionar sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre de la cuenta</Label>
              <Input
                className="mt-1.5"
                placeholder="Ej: monaco.barber.1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>
                Alias o CBU{' '}
                <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                className="mt-1.5 font-mono"
                placeholder="Ej: monaco.barber.uno o 0000003100..."
                value={form.alias_or_cbu}
                onChange={(e) => setForm((f) => ({ ...f, alias_or_cbu: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!form.name || !form.branch_id}>
                {form.id ? 'Guardar cambios' : 'Crear cuenta'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
