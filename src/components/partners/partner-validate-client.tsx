'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import {
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  KeySquare,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { validateRedemptionByPartner } from '@/lib/actions/partner-portal'

type ValidationResult =
  | { success: true; benefitTitle: string; clientName?: string }
  | { success: false; error: string }

export function PartnerValidateClient() {
  const [code, setCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ValidationResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean.length < 4) {
      toast.error('El código es muy corto')
      return
    }
    startTransition(async () => {
      const r = await validateRedemptionByPartner(clean)
      if (r.success) {
        setResult({
          success: true,
          benefitTitle: r.benefitTitle ?? 'Beneficio',
          clientName: r.clientName,
        })
        // Vibrar en mobile
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.([100, 60, 100])
        }
      } else {
        setResult({ success: false, error: r.error ?? 'Error' })
      }
    })
  }

  const reset = () => {
    setCode('')
    setResult(null)
    inputRef.current?.focus()
  }

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <QrCode className="size-6 text-primary" />
          Validar código
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pedile al cliente que te muestre su código de canje y validalo acá.
        </p>
      </div>

      {!result ? (
        <Card>
          <CardHeader>
            <CardTitle>Ingresar código</CardTitle>
            <CardDescription>Código de 6 caracteres alfanuméricos.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="flex items-center gap-1.5">
                  <KeySquare className="size-3.5" /> Código
                </Label>
                <Input
                  id="code"
                  ref={inputRef}
                  placeholder="MN7X9K"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={12}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="text-center text-3xl font-mono tracking-widest uppercase h-16"
                  disabled={isPending}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={isPending || code.trim().length < 4}
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-5 mr-2 animate-spin" />
                    Validando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-5 mr-2" />
                    Validar y marcar como usado
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : result.success ? (
        <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-10" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
                ¡Código válido!
              </h2>
              <p className="text-sm text-emerald-800/80 dark:text-emerald-200/80 mt-1">
                Marcado como canjeado correctamente.
              </p>
            </div>
            <div className="rounded-lg bg-white dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-4 text-left space-y-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Beneficio</p>
                <p className="font-semibold">{result.benefitTitle}</p>
              </div>
              {result.clientName && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</p>
                  <p className="font-medium">{result.clientName}</p>
                </div>
              )}
            </div>
            <Button onClick={reset} className="w-full" size="lg">
              <RotateCcw className="size-4 mr-2" />
              Validar otro código
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-red-500 text-white flex items-center justify-center mx-auto">
              <XCircle className="size-10" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-red-900 dark:text-red-100">
                No se pudo validar
              </h2>
              <p className="text-sm text-red-800/80 dark:text-red-200/80 mt-1">{result.error}</p>
            </div>
            <Button onClick={reset} className="w-full" size="lg" variant="outline">
              <RotateCcw className="size-4 mr-2" />
              Probar con otro código
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
