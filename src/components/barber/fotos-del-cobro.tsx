'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, Check, Loader2, QrCode, RotateCw, ShieldCheck, Smartphone, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { vibrate } from '@/lib/barber-feedback'
import { cantidadDeFotos } from '@/lib/fotos-corte/textos'
import { TOPE_FOTOS_POR_CORTE } from '@/lib/types/fotos-corte'
import { useFotosDelCobro } from '@/hooks/use-fotos-del-cobro'
import type { FotoDelCobro } from '@/stores/fotos-corte-store'
import { QrFotosDialog } from './qr-fotos-dialog'
import { VisorFotos, type FotoDelVisor } from './visor-fotos'
import { TituloCobro } from './cobro/piezas-cobro'
import { claseTextoAviso, useTonoDelTema } from './cobro/tono'

interface FotosDelCobroProps {
  /** La entrada de la fila que se está cobrando. La sesión de fotos se ata a ella. */
  entradaId: string
  /** El diálogo de cobro está abierto (para el polling del celular). */
  abierto: boolean
  /** Mientras se registra el cobro no se agregan ni se quitan fotos. */
  deshabilitado?: boolean
}

/**
 * "Fotos del corte" en el cobro: SÓLO con el celular del barbero (QR). Decisión
 * del dueño (19/oct/2026): la cámara de las tablets es mala y su galería no
 * tiene fotos de cortes, así que la Cámara y la Galería de la tablet se
 * sacaron. La subida desde el dispositivo sigue en el hook (`f.agregar`), sin
 * botón: si algún día cambian las tablets, se vuelve a ofrecer acá.
 *
 * Las fotos del celular llegan a la tira solas y el cobro NO las espera: si
 * siguen subiendo cuando se toca Cobrar, terminan solas y quedan en la ficha
 * (ver fotos-corte-store).
 */
export function FotosDelCobro({ entradaId, abierto, deshabilitado = false }: FotosDelCobroProps) {
  const f = useFotosDelCobro(entradaId, abierto)
  const tono = useTonoDelTema()
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null)

  const listas = useMemo(() => f.fotos.filter((x) => x.estado === 'lista'), [f.fotos])
  const fotosDelVisor: FotoDelVisor[] = useMemo(
    () =>
      listas.map((x, i) => ({
        id: x.id,
        src: x.vista,
        local: x.vistaLocal,
        alt: `Foto ${i + 1} del corte`,
        epigrafe: x.origen === 'celular' ? 'Desde el celular' : null,
      })),
    [listas],
  )

  const bloqueado = deshabilitado || f.resumen.enTope
  const ultimoError = [...f.fotos].reverse().find((x) => x.estado === 'error')?.error ?? null

  return (
    <section aria-labelledby="cobro-fotos">
      <TituloCobro
        id="cobro-fotos"
        opcional
        detalle={
          f.fotos.length > 0 && (
            <span className="font-mono text-[0.9375rem] tabular-nums text-muted-foreground">
              {f.resumen.listas + f.resumen.enCurso}/{TOPE_FOTOS_POR_CORTE}
            </span>
          )
        }
      >
        Fotos del corte
      </TituloCobro>

      {/* Un solo camino: el celular del barbero, por QR. */}
      <button
        type="button"
        disabled={bloqueado}
        onClick={() => {
          vibrate(8)
          f.qr.abrir()
        }}
        className={cn(
          'flex w-full items-center gap-4 rounded-2xl border-2 border-foreground bg-card px-4 py-3.5 text-left outline-none',
          'motion-safe:transition-[background-color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.99]',
          'hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        )}
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Smartphone className="size-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-tight">Sacalas con tu celular</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Escaneá el QR con la cámara del celular</span>
        </span>
        <QrCode className="size-6 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {f.fotos.length > 0 && (
        <ul
          className="-mx-1 mt-2 flex gap-3 overflow-x-auto px-1 pb-1 pr-3 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Fotos de este corte"
        >
          {f.fotos.map((foto) => (
            <li key={foto.id} className="shrink-0 animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
              <Miniatura
                foto={foto}
                deshabilitado={deshabilitado}
                onAbrir={() => {
                  const i = listas.findIndex((x) => x.id === foto.id)
                  if (i >= 0) setFotoAbierta(i)
                }}
                onReintentar={() => f.reintentar(foto.id)}
                onQuitar={() => f.quitar(foto.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Estado en palabras: lo que la tira dice con íconos. */}
      <div className="mt-2.5 space-y-1.5" aria-live="polite">
        {f.resumen.enCurso > 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            Subiendo {cantidadDeFotos(f.resumen.enCurso)}… Podés cobrar igual: terminan solas.
          </p>
        ) : f.resumen.listas > 0 ? (
          <p className={cn('flex items-center gap-1.5 text-sm font-medium', claseTextoAviso('verde', tono))}>
            <Check className="size-4 shrink-0" aria-hidden />
            {cantidadDeFotos(f.resumen.listas)} {f.resumen.listas === 1 ? 'lista' : 'listas'}
          </p>
        ) : null}
        {f.resumen.enTope && (
          <p className={cn('text-sm font-medium', claseTextoAviso('ambar', tono))}>
            Llegaste al máximo de {TOPE_FOTOS_POR_CORTE} fotos por corte.
          </p>
        )}
        {f.resumen.conError > 0 && ultimoError && (
          <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {ultimoError}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          Siempre con permiso del cliente. Quedan en su ficha para la próxima visita.
        </p>
      </div>

      <QrFotosDialog
        open={f.qr.abierto}
        onOpenChange={(o) => {
          if (!o) f.qr.cerrar()
        }}
        sesion={f.sesion}
        abriendo={f.abriendoSesion}
        error={f.errorSesion}
        onReintentar={f.qr.reintentarSesion}
        fotos={f.fotos}
      />
      <VisorFotos fotos={fotosDelVisor} indice={fotoAbierta} onIndice={setFotoAbierta} />
    </section>
  )
}

/** Anillo de progreso de la subida (determinado). */
function Anillo({ progreso }: { progreso: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, progreso))}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300"
      />
    </svg>
  )
}

function Miniatura({
  foto,
  deshabilitado,
  onAbrir,
  onReintentar,
  onQuitar,
}: {
  foto: FotoDelCobro
  deshabilitado: boolean
  onAbrir: () => void
  onReintentar: () => void
  onQuitar: () => void
}) {
  const enCurso = foto.estado === 'preparando' || foto.estado === 'subiendo' || foto.estado === 'confirmando'
  const conError = foto.estado === 'error'
  const etiqueta =
    foto.estado === 'lista'
      ? `Ver foto${foto.origen === 'celular' ? ' del celular' : ''}`
      : conError
        ? foto.reintentable
          ? 'No se subió. Tocá para reintentar.'
          : (foto.error ?? 'No se pudo subir')
        : foto.estado === 'subiendo'
          ? `Subiendo, ${Math.round(foto.progreso * 100)} %`
          : 'Preparando la foto'

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={etiqueta}
        title={conError ? (foto.error ?? undefined) : undefined}
        disabled={enCurso || (conError && !foto.reintentable)}
        onClick={() => (conError ? onReintentar() : onAbrir())}
        className={cn(
          'relative block size-[76px] overflow-hidden rounded-xl border bg-muted outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          conError && 'border-destructive/60',
        )}
      >
        {foto.vistaLocal ? (
          /* blob: de la tablet: next/image no lo optimiza */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={foto.vista} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          <Image src={foto.vista} alt="" fill sizes="76px" className="object-cover" draggable={false} />
        )}

        {enCurso && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            {foto.estado === 'subiendo' ? (
              <Anillo progreso={foto.progreso} />
            ) : (
              <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
          </span>
        )}
        {conError && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/70 text-white">
            {foto.reintentable ? <RotateCw className="size-5" aria-hidden /> : <AlertTriangle className="size-5" aria-hidden />}
            <span className="text-[10px] font-bold leading-none">{foto.reintentable ? 'Reintentar' : 'No se puede'}</span>
          </span>
        )}
        {foto.estado === 'lista' && (
          <span className="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow" aria-hidden>
            <Check className="size-3" />
          </span>
        )}
        {foto.origen === 'celular' && (
          <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white" aria-hidden>
            <Smartphone className="size-3" />
          </span>
        )}
      </button>

      {/* Quitar: 44 px de área táctil alrededor de un círculo chico. */}
      <button
        type="button"
        onClick={() => {
          vibrate(8)
          onQuitar()
        }}
        disabled={deshabilitado}
        aria-label="Quitar foto"
        className="absolute -right-3 -top-3 flex size-11 items-center justify-center outline-none disabled:opacity-40 focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow-md">
          <X className="size-3.5" aria-hidden />
        </span>
      </button>
    </div>
  )
}
