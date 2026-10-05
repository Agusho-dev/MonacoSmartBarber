'use client'

import Image from 'next/image'
import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Check, Clock, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { cantidadDeFotos } from '@/lib/fotos-corte/textos'
import type { SesionDeFotos } from '@/lib/types/fotos-corte'
import type { FotoDelCobro } from '@/stores/fotos-corte-store'

interface QrFotosDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** La sesión de fotos del cobro (la abre el hook al tocar "Con tu celular"). */
  sesion: SesionDeFotos | null
  abriendo: boolean
  error: string | null
  /** Vuelve a pedir la sesión (error, o venció y hay que generar otro código). */
  onReintentar: () => void
  /** Todas las fotos del cobro: acá se muestran las que llegan del celular. */
  fotos: FotoDelCobro[]
}

/**
 * QR para sacar las fotos del corte con el celular del barbero.
 *
 * Controlado por useFotosDelCobro: NO crea ni cierra sesiones al abrirse o
 * cerrarse (la versión anterior abría una sesión por apertura y la desactivaba
 * al cerrar: el celular perdía el código si el barbero cerraba el QR para
 * seguir con el cobro). La sesión es UNA por cobro y vive 45 minutos.
 *
 * Las fotos aparecen por polling al Route Handler (cada 2,5 s, sólo con esto
 * abierto o mientras el cobro espera fotos del celular), no por Realtime: el
 * Realtime anónimo exigía que cualquiera con la anon key pudiera leer las rutas
 * de todas las fotos.
 */
export function QrFotosDialog({ open, onOpenChange, sesion, abriendo, error, onReintentar, fotos }: QrFotosDialogProps) {
  const delCelular = fotos.filter((f) => f.origen === 'celular')
  const recibidas = delCelular.filter((f) => f.estado === 'lista').length
  const url =
    sesion?.estado === 'activa' && sesion.token && typeof window !== 'undefined'
      ? `${window.location.origin}/upload/${sesion.token}`
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5" aria-hidden />
            Sacá las fotos con tu celular
          </DialogTitle>
          <DialogDescription>
            Escaneá el código con la cámara del celular. Cada foto que saques aparece acá en unos segundos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="relative flex size-[252px] items-center justify-center">
            {url ? (
              <div
                role="img"
                aria-label="Código QR para subir las fotos desde el celular"
                className="rounded-2xl bg-white p-4 shadow-sm animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none"
              >
                <QRCodeSVG value={url} size={220} level="M" includeMargin={false} />
              </div>
            ) : error && !abriendo ? (
              <div
                role="alert"
                className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center"
              >
                <AlertTriangle className="size-7 text-destructive" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-destructive">No pudimos generar el código.</p>
                  <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                </div>
                <Button type="button" variant="outline" className="h-11" onClick={onReintentar}>
                  <RefreshCw className="mr-1.5 size-4" aria-hidden />
                  Reintentar
                </Button>
              </div>
            ) : sesion && sesion.estado !== 'activa' && !abriendo ? (
              <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border bg-muted/40 p-5 text-center">
                <Clock className="size-7 text-muted-foreground" aria-hidden />
                <p className="text-sm font-semibold">
                  {sesion.estado === 'vencida' ? 'Este código venció.' : 'Este cobro ya se cerró.'}
                </p>
                {sesion.estado === 'vencida' && (
                  <Button type="button" variant="outline" className="h-11" onClick={onReintentar}>
                    <RefreshCw className="mr-1.5 size-4" aria-hidden />
                    Generar otro
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl bg-muted" role="status">
                <Loader2 className="size-7 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                <span className="text-sm text-muted-foreground">Generando el código…</span>
              </div>
            )}
          </div>

          {/* Lo que va llegando del celular */}
          <div className="w-full" aria-live="polite">
            {recibidas > 0 ? (
              <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="size-4" aria-hidden />
                {cantidadDeFotos(recibidas)} {recibidas === 1 ? 'recibida' : 'recibidas'}
              </p>
            ) : url ? (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="relative flex size-2.5" aria-hidden>
                  <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                </span>
                Esperando fotos…
              </p>
            ) : null}

            {delCelular.length > 0 && (
              <ul className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1" aria-label="Fotos recibidas del celular">
                {delCelular.slice(-5).map((f) => (
                  <li
                    key={f.id}
                    className="relative size-14 shrink-0 overflow-hidden rounded-xl border bg-muted animate-in fade-in-0 zoom-in-90 duration-300 motion-reduce:animate-none"
                  >
                    {f.vistaLocal ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={f.vista} alt="" className="size-full object-cover" />
                    ) : (
                      <Image src={f.vista} alt="" fill sizes="56px" className="object-cover" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <Button type="button" className={cn('h-12 w-full text-base font-semibold')} onClick={() => onOpenChange(false)}>
          Listo
        </Button>
      </DialogContent>
    </Dialog>
  )
}
