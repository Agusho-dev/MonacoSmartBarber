'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { Camera, CheckCircle2, KeySquare, Loader2, QrCode, RotateCcw, XCircle } from 'lucide-react'
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { redeemRewardByQr } from '@/lib/actions/prode'

type RedeemResult =
  | { success: true; rewardName: string | null; isFreeService: boolean; discountPct: number | null }
  | { success: false; error: string }

export function CanjearTab() {
  const [code, setCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<RedeemResult | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastScannedRef = useRef<string | null>(null)

  const runRedeem = useCallback((raw: string) => {
    const clean = raw.trim()
    if (clean.length < 8) {
      toast.error('El código es muy corto')
      return
    }
    startTransition(async () => {
      const r = await redeemRewardByQr(clean)
      if ('error' in r) {
        setResult({ success: false, error: r.error })
      } else {
        setResult({
          success: true,
          rewardName: r.rewardName,
          isFreeService: r.isFreeService,
          discountPct: r.discountPct,
        })
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.([100, 60, 100])
        }
      }
    })
  }, [])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    runRedeem(code)
  }

  const onScan = useCallback(
    (detected: IDetectedBarcode[]) => {
      if (!detected.length) return
      const raw = (detected[0]?.rawValue ?? '').trim()
      if (!raw || raw === lastScannedRef.current) return
      lastScannedRef.current = raw
      setCode(raw)
      setScannerOpen(false)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(50)
      runRedeem(raw)
    },
    [runRedeem]
  )

  const onScanError = useCallback((err: unknown) => {
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
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-primary" /> Canjear premio del cliente
          </CardTitle>
          <CardDescription>
            Escaneá el QR del premio o ingresá el código manualmente para validarlo en el mostrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result ? (
            <div className="space-y-4">
              <Button
                type="button"
                className="h-14 w-full text-base"
                onClick={() => {
                  lastScannedRef.current = null
                  setScannerOpen(true)
                }}
                disabled={isPending}
              >
                <Camera className="mr-2 size-5" />
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
                  <Label htmlFor="prode-code" className="flex items-center gap-1.5">
                    <KeySquare className="size-3.5" /> Ingresar código manualmente
                  </Label>
                  <Input
                    id="prode-code"
                    ref={inputRef}
                    placeholder="código del QR"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={isPending}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  className="h-12 w-full text-base"
                  disabled={isPending || code.trim().length < 8}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" /> Validando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 size-5" /> Validar y canjear
                    </>
                  )}
                </Button>
              </form>
            </div>
          ) : result.success ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle2 className="size-10" />
              </div>
              <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-300">¡Premio canjeado!</h2>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-left">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Premio</p>
                  <p className="font-semibold">{result.rewardName ?? 'Premio'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Beneficio</p>
                  <p className="font-medium">
                    {result.isFreeService
                      ? 'Servicio gratis'
                      : result.discountPct
                        ? `${result.discountPct}% de descuento`
                        : 'Beneficio'}
                  </p>
                </div>
              </div>
              <Button onClick={reset} className="w-full" size="lg">
                <RotateCcw className="mr-2 size-4" /> Canjear otro
              </Button>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-red-500 text-white">
                <XCircle className="size-10" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-red-700 dark:text-red-300">No se pudo canjear</h2>
                <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
              </div>
              <Button onClick={reset} className="w-full" size="lg" variant="outline">
                <RotateCcw className="mr-2 size-4" /> Probar con otro código
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
              <Camera className="size-5" /> Escanear QR
            </DialogTitle>
            <DialogDescription>
              Apuntá la cámara al QR del premio que muestra el cliente.
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
          <p className="text-center text-xs text-muted-foreground">
            Si no se abre la cámara, verificá que el navegador tenga permiso y que la página esté en HTTPS.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
