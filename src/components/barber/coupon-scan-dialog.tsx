'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Camera, KeySquare, Loader2, PackageCheck, QrCode, SwitchCamera, XCircle } from 'lucide-react'
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
import { deliverRewardByQr, validateBenefitQrForCheckout } from '@/lib/actions/rewards'
import {
  buildReferralQr,
  deliveryErrorMessage,
  normalizeBenefitInput,
  type AppliedBenefit,
} from '@/lib/loyalty-checkout'

/**
 * Beneficio validado (todavía no consumido) listo para aplicar en el cobro.
 * Es una UNIÓN: un beneficio de la app (`client_rewards`, QR de 32 hex —
 * descuento, merch o especial) o una invitación de un amigo (`MNC-REF:<código>`).
 * `qrCode` es lo que viaja a `completeService`; el server lo distingue por prefijo.
 */
export type AppliedCoupon = AppliedBenefit

/**
 * - `checkout` (default): el cobro. Valida sin consumir y devuelve el beneficio
 *   por `onApplied`; lo consume `completeService` al confirmar la venta.
 * - `delivery`: entrega de merch/especial SIN cobro (el cliente pasa a retirar
 *   la gorra). Valida, muestra qué es y recién con "Marcar entregado" llama a
 *   `deliverRewardByQr`. Un descuento o una invitación no se entregan por acá:
 *   se aplican en el cobro (`needs_checkout`).
 */
export type CouponScanMode = 'checkout' | 'delivery'

interface CouponScanDialogProps {
  open: boolean
  branchId: string
  clientId: string | null
  onClose: () => void
  /** Modo cobro: beneficio validado, listo para aplicar. */
  onApplied?: (coupon: AppliedCoupon) => void
  mode?: CouponScanMode
  /** Modo entrega: el premio quedó marcado como entregado. */
  onDelivered?: (rewardName: string) => void
}

export function CouponScanDialog({
  open,
  branchId,
  clientId,
  onClose,
  onApplied,
  mode = 'checkout',
  onDelivered,
}: CouponScanDialogProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [isPending, startTransition] = useTransition()
  const lastScannedRef = useRef<string | null>(null)
  // Cada cambio de `open` es una sesión nueva del escáner. Una validación en vuelo
  // que contesta después de cerrar —o de cerrar y reabrir— pertenece a una sesión
  // vieja y se descarta: si no, el resultado de un QR abortado se aplicaba igual
  // (en modo entrega reabría directo en "Marcar entregado"; en modo cobro dejaba
  // el beneficio aplicado en el cobro).
  const sessionRef = useRef(0)
  // Modo entrega: premio validado esperando el "Marcar entregado" del barbero.
  const [pendingDelivery, setPendingDelivery] = useState<{ qrCode: string; rewardName: string } | null>(null)

  const isDelivery = mode === 'delivery'

  // El cierre tras un canje exitoso es programático (el padre baja `open`), y eso NO
  // dispara onOpenChange — así que reseteamos el dedupe al ABRIR, para que re-escanear
  // el mismo QR vuelva a funcionar. (Sólo refs: el error se limpia al iniciar cada
  // validación; evitamos setState en effect.)
  useEffect(() => {
    sessionRef.current += 1
    if (open) lastScannedRef.current = null
  }, [open])

  const resetAll = useCallback(() => {
    lastScannedRef.current = null
    setCode('')
    setError(null)
    setPendingDelivery(null)
  }, [])

  const runValidate = useCallback(
    (raw: string) => {
      // Acepta las dos formas: el hex del beneficio y "MNC-REF:CODIGO" (o el código
      // de invitación pelado, que se normaliza al formato con prefijo).
      const clean = normalizeBenefitInput(raw)
      if (clean.length < 8) {
        setError('El código es muy corto')
        return
      }
      setError(null)
      const session = sessionRef.current
      startTransition(async () => {
        const r = await validateBenefitQrForCheckout(clean, branchId, clientId)
        // El barbero cerró el escáner mientras validaba: no aplicar nada.
        if (session !== sessionRef.current) return
        if ('error' in r) {
          setError(r.error)
          lastScannedRef.current = null
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([60, 40, 60])
          return
        }

        if (isDelivery) {
          // Sólo merch/especial se entregan sin cobro. Lo demás se aplica al cobrar.
          if (r.kind === 'referral') {
            setError('Una invitación se aplica al cobrar un servicio')
            lastScannedRef.current = null
            return
          }
          if (r.coupon.kind === 'descuento') {
            setError(deliveryErrorMessage('needs_checkout'))
            lastScannedRef.current = null
            return
          }
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60)
          setPendingDelivery({ qrCode: clean.toLowerCase(), rewardName: r.coupon.rewardName ?? 'Beneficio' })
          setCode('')
          return
        }

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60)
        if (r.kind === 'referral') {
          onApplied?.({
            kind: 'referral',
            qrCode: buildReferralQr(r.referral.code),
            code: r.referral.code,
            referrerFirstName: r.referral.referrerFirstName,
            discountPct: r.referral.discountPct,
            referredPoints: r.referral.referredPoints,
            referrerPoints: r.referral.referrerPoints,
          })
        } else {
          onApplied?.({
            kind: 'coupon',
            qrCode: clean.toLowerCase(),
            clientRewardId: r.coupon.clientRewardId,
            rewardName: r.coupon.rewardName,
            discountPct: r.coupon.discountPct,
            isFreeService: r.coupon.isFreeService,
            rewardKind: r.coupon.kind,
            serviceId: r.coupon.serviceId,
            serviceName: r.coupon.serviceName,
            servicePrice: r.coupon.servicePrice,
            allowStacking: r.coupon.allowStacking,
          })
        }
        setCode('')
      })
    },
    [branchId, clientId, onApplied, isDelivery],
  )

  const confirmDelivery = useCallback(() => {
    if (!pendingDelivery) return
    setError(null)
    const session = sessionRef.current
    startTransition(async () => {
      const r = await deliverRewardByQr(pendingDelivery.qrCode, branchId)
      if ('error' in r) {
        // Sólo se gatea el error: si la entrega YA ocurrió en la base, el toast de
        // `onDelivered` es la única confirmación que le queda al barbero si cerró.
        if (session !== sessionRef.current) return
        setError(r.error)
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([60, 40, 60])
        return
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60)
      setPendingDelivery(null)
      onDelivered?.(r.rewardName)
    })
  }, [pendingDelivery, branchId, onDelivered])

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
          resetAll()
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDelivery
              ? <PackageCheck className="size-5 text-emerald-500" />
              : <QrCode className="size-5 text-emerald-500" />}
            {isDelivery ? 'Entregar premio' : 'Escaneá el QR del cliente'}
          </DialogTitle>
          <DialogDescription>
            {isDelivery
              ? 'Escaneá el QR del premio que el cliente canjeó en la app (merch o especial)'
              : 'Beneficio de la app o invitación de un amigo'}
          </DialogDescription>
        </DialogHeader>

        {pendingDelivery ? (
          /* Modo entrega: premio validado. La cámara se apaga para no re-escanear;
             el consumo real ocurre recién al confirmar. */
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
              <PackageCheck className="size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Entregar</p>
                <p className="truncate text-lg font-bold">{pendingDelivery.rewardName}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12"
                onClick={() => { setPendingDelivery(null); lastScannedRef.current = null; setError(null) }}
                disabled={isPending}
              >
                Volver
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-12 flex-1 font-bold"
                onClick={confirmDelivery}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
                Marcar entregado
              </Button>
            </div>
          </div>
        ) : (
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
                <span className="text-sm font-medium">Validando…</span>
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
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!pendingDelivery && (
          <>
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
                  <KeySquare className="size-3.5" />
                  {isDelivery ? 'Código del premio' : 'Código del beneficio o de la invitación'}
                </Label>
                <Input
                  id="coupon-code"
                  placeholder={isDelivery ? 'código del QR del premio' : 'código del QR o MNC-REF:XXXXXXXX'}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono"
                  disabled={isPending}
                />
              </div>
              <Button type="submit" disabled={isPending || code.trim().length < 8}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                Validar
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
