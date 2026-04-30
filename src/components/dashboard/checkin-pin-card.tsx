'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Loader2, Eye, EyeOff, Trash2, ShieldCheck, ShieldOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { setCheckinPin } from '@/lib/actions/checkin-pin'

interface CheckinPinCardProps {
  hasPin: boolean
}

/**
 * Card de configuración del PIN del kiosk de Check-in.
 * Permite setear, cambiar y eliminar el PIN. Usa el patrón existente:
 * - PIN: 4-8 dígitos numéricos (mismo rango que PIN de barbero)
 * - Cambio confirmado por dialog cuando se elimina
 */
export function CheckinPinCard({ hasPin }: CheckinPinCardProps) {
  const router = useRouter()
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [isPending, startTransition] = useTransition()

  function digitsOnly(s: string) {
    return s.replace(/\D/g, '').slice(0, 8)
  }

  function save() {
    setError(null)
    setSuccess(false)
    if (pin1.length < 4) {
      setError('El PIN debe tener al menos 4 dígitos.')
      return
    }
    if (pin1 !== pin2) {
      setError('Los PINs no coinciden.')
      return
    }
    startTransition(async () => {
      const res = await setCheckinPin(pin1)
      if ('ok' in res) {
        setSuccess(true)
        setPin1('')
        setPin2('')
        router.refresh()
      } else {
        setError(mapError(res.error))
      }
    })
  }

  function clearPin() {
    startTransition(async () => {
      const res = await setCheckinPin(null)
      if ('ok' in res) {
        setConfirmClear(false)
        setPin1('')
        setPin2('')
        setSuccess(true)
        router.refresh()
      } else {
        setError(mapError(res.error))
        setConfirmClear(false)
      }
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                PIN del Check-in
              </CardTitle>
              <CardDescription>
                Bloqueá el acceso al kiosk para que sólo personal autorizado lo abra.
                Si lo dejás vacío, el kiosk queda abierto.
              </CardDescription>
            </div>
            <Badge variant={hasPin ? 'default' : 'outline'} className="gap-1">
              {hasPin ? (
                <>
                  <ShieldCheck className="h-3 w-3" />
                  Activado
                </>
              ) : (
                <>
                  <ShieldOff className="h-3 w-3" />
                  Sin PIN
                </>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="checkin-pin-1" className="text-xs">
                {hasPin ? 'Nuevo PIN' : 'PIN'} (4–8 dígitos)
              </Label>
              <div className="relative">
                <Input
                  id="checkin-pin-1"
                  inputMode="numeric"
                  maxLength={8}
                  type={show ? 'text' : 'password'}
                  value={pin1}
                  onChange={(e) => setPin1(digitsOnly(e.target.value))}
                  placeholder="••••"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? 'Ocultar' : 'Mostrar'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="checkin-pin-2" className="text-xs">
                Repetir PIN
              </Label>
              <Input
                id="checkin-pin-2"
                inputMode="numeric"
                maxLength={8}
                type={show ? 'text' : 'password'}
                value={pin2}
                onChange={(e) => setPin2(digitsOnly(e.target.value))}
                placeholder="••••"
                autoComplete="off"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {success && !error && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ Cambios guardados.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={isPending || !pin1 || !pin2}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {hasPin ? 'Cambiar PIN' : 'Activar PIN'}
            </Button>
            {hasPin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar PIN
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el PIN del kiosk?</AlertDialogTitle>
            <AlertDialogDescription>
              Cualquiera con acceso a la URL del kiosk podrá abrir el check-in sin
              autenticación. Podés volver a activarlo cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={clearPin}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function mapError(code: string): string {
  switch (code) {
    case 'PIN_LENGTH_INVALID':
      return 'El PIN debe tener entre 4 y 8 dígitos.'
    case 'UNAUTHORIZED':
      return 'No tenés permisos para cambiar el PIN.'
    case 'CLEAR_FAILED':
      return 'No se pudo eliminar el PIN. Intentá de nuevo.'
    default:
      return 'Error al guardar el PIN.'
  }
}
