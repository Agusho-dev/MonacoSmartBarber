'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import {
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  KeySquare,
  Camera,
} from 'lucide-react'
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { validateRedemptionByPartner } from '@/lib/actions/partner-portal'

type ValidationResult =
  | { success: true; benefitTitle: string; clientName?: string }
  | { success: false; error: string }

// Limpia el payload escaneado: el QR de la mobile es literal el código
// (6 chars alfanuméricos), pero si en el futuro se envuelve en una URL
// del tipo https://.../r/MN7X9K igual rescatamos el último segmento.
function extractCodeFromScan(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Si parece URL, agarrar el último path segment no vacío
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1].toUpperCase()
    } catch {
      // fallthrough
    }
  }
  return trimmed.toUpperCase()
}

export function PartnerValidateClient() {
  const [code, setCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runValidation = useCallback(
    (raw: string) => {
      const clean = raw.trim().toUpperCase()
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
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate?.([100, 60, 100])
          }
        } else {
          setResult({ success: false, error: r.error ?? 'Error' })
        }
      })
    },
    [startTransition],
  )

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    runValidation(code)
  }

  const onScan = useCallback(
    (detected: IDetectedBarcode[]) => {
      if (!detected.length) return
      const raw = detected[0]?.rawValue ?? ''
      const clean = extractCodeFromScan(raw)
      if (!clean || clean === lastScannedRef.current) return
      lastScannedRef.current = clean
      setCode(clean)
      setScannerOpen(false)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(50)
      }
      toast.success(`Código detectado: ${clean}`)
      runValidation(clean)
    },
    [runValidation],
  )

  const onScanError = useCallback((err: unknown) => {
    // No spameamos toasts: los errores frame-a-frame son normales.
    // Solo avisamos si es permiso denegado.
    const message = err instanceof Error ? err.message : String(err)
    if (/permission|denied|NotAllowed/i.test(message)) {
      toast.error('Permiso de cámara denegado')
      setScannerOpen(false)
    }
  }, [])

  const reset = () => {
    setCode('')
    setResult(null)
    lastScannedRef.current = null
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
          Escaneá el QR del cliente o ingresá el código manualmente.
        </p>
      </div>

      {!result ? (
        <Card>
          <CardHeader>
            <CardTitle>Ingresar código</CardTitle>
            <CardDescription>
              Código de 6 caracteres alfanuméricos, o QR de la app del cliente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button
                type="button"
                variant="default"
                className="w-full h-14 text-base"
                onClick={() => {
                  lastScannedRef.current = null
                  setScannerOpen(true)
                }}
                disabled={isPending}
              >
                <Camera className="size-5 mr-2" />
                Escanear QR con cámara
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">o</span>
                </div>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code" className="flex items-center gap-1.5">
                    <KeySquare className="size-3.5" /> Ingresar manualmente
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
                  variant="outline"
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
            </div>
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

      <Dialog
        open={scannerOpen}
        onOpenChange={(open) => {
          setScannerOpen(open)
          if (!open) lastScannedRef.current = null
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="size-5" />
              Escanear QR
            </DialogTitle>
            <DialogDescription>
              Apuntá la cámara al código QR que el cliente muestra en la app.
            </DialogDescription>
          </DialogHeader>
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
            {scannerOpen && (
              <Scanner
                onScan={onScan}
                onError={onScanError}
                constraints={{ facingMode: 'environment' }}
                formats={['qr_code']}
                classNames={{ container: 'size-full', video: 'size-full object-cover' }}
                components={{ finder: true, torch: true, zoom: true }}
                allowMultiple={false}
                scanDelay={300}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Si no se abre la cámara, verificá que el navegador tenga permiso y que la página esté en HTTPS.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
