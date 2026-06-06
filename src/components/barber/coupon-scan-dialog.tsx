'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Camera, KeySquare, Loader2, SwitchCamera, TicketPercent, XCircle } from 'lucide-react'
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validateCouponForCheckout } from '@/lib/actions/rewards'

/** Cupón validado (todavía no consumido) listo para aplicar en el cobro. */
export interface AppliedCoupon {
  qrCode: string
  clientRewardId: string
  rewardName: string | null
  discountPct: number | null
  isFreeService: boolean
}

interface CouponScanDialogProps {
  open: boolean
  branchId: string
  clientId: string | null
  onClose: () => void
  onApplied: (coupon: AppliedCoupon) => void
}

export function CouponScanDialog({
  open,
  branchId,
  clientId,
  onClose,
  onApplied,
}: CouponScanDialogProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [isPending, startTransition] = useTransition()
  const lastScannedRef = useRef<string | null>(null)

  // El cierre tras un canje exitoso es programático (el padre baja `open`), y eso NO
  // dispara onOpenChange — así que reseteamos el dedupe al ABRIR, para que re-escanear
  // el mismo QR vuelva a funcionar. (Sólo el ref: el error se limpia al iniciar cada
  // validación; evitamos setState en effect.)
  useEffect(() => {
    if (open) lastScannedRef.current = null
  }, [open])

  const runValidate = useCallback(
    (raw: string) => {
      const clean = raw.trim()
      if (clean.length < 8) {
        setError('El código es muy corto')
        return
      }
      setError(null)
      startTransition(async () => {
        const r = await validateCouponForCheckout(clean, branchId, clientId)
        if ('error' in r) {
          setError(r.error)
          lastScannedRef.current = null
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([60, 40, 60])
          return
        }
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60)
        onApplied({ qrCode: clean.toLowerCase(), ...r.coupon })
        setCode('')
      })
    },
    [branchId, clientId, onApplied],
  )

  const onScan = useCallback(
    (detected: IDetectedBarcode[]) => {
      if (!detected.length || isPending) return
      const raw = (detected[0]?.rawValue ?? '').trim()
      if (!raw || raw === lastScannedRef.current) return
      lastScannedRef.current = raw
      runValidate(raw)
    },
    [runValidate, isPending],
  )

  const onScanError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (/permission|denied|NotAllowed/i.test(message)) {
      setError('Permiso de cámara denegado. Habilitalo en el navegador o ingresá el código a mano.')
    }
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          lastScannedRef.current = null
          setCode('')
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketPercent className="size-5 text-emerald-500" />
            Canjear cupón de descuento
          </DialogTitle>
          <DialogDescription>
            Apuntá la cámara al QR del cupón que muestra el cliente en su celular.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
          {open && (
            <Scanner
              key={facingMode}
              onScan={onScan}
              onError={onScanError}
              constraints={{ facingMode }}
              formats={['qr_code']}
              classNames={{ container: 'size-full', video: 'size-full object-cover' }}
              components={{ finder: true, torch: true, zoom: true }}
              allowMultiple={false}
              scanDelay={300}
            />
          )}

          {isPending && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
              <Loader2 className="size-8 animate-spin" />
              <span className="text-sm font-medium">Validando cupón…</span>
            </div>
          )}

          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 size-9 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => {
              lastScannedRef.current = null
              setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))
            }}
            aria-label="Cambiar cámara"
          >
            <SwitchCamera className="size-4" />
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">o ingresá el código</span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            runValidate(code)
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="coupon-code" className="flex items-center gap-1.5 text-xs">
              <KeySquare className="size-3.5" /> Código del cupón
            </Label>
            <Input
              id="coupon-code"
              placeholder="código del QR"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              className="font-mono"
              disabled={isPending}
            />
          </div>
          <Button type="submit" disabled={isPending || code.trim().length < 8}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            Validar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
