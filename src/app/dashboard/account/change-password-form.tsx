'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changePassword } from './actions'

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (next !== confirm) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    startTransition(async () => {
      const res = await changePassword({ currentPassword: current, newPassword: next })
      if ('error' in res) {
        toast.error(res.message)
        return
      }
      toast.success('Contraseña actualizada')
      setCurrent('')
      setNext('')
      setConfirm('')
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="current">Contraseña actual</Label>
        <Input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </div>
      <div>
        <Label htmlFor="next">Nueva contraseña</Label>
        <Input id="next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" minLength={8} />
      </div>
      <div>
        <Label htmlFor="confirm">Confirmar nueva</Label>
        <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Guardando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  )
}
