'use client'

import { useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, Camera, Check, Images, Loader2, RotateCw, ShieldCheck, Smartphone, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { vibrate } from '@/lib/barber-feedback'
import { cantidadDeFotos } from '@/lib/fotos-corte/textos'
import { TOPE_FOTOS_POR_CORTE } from '@/lib/types/fotos-corte'
import { useFotosDelCobro } from '@/hooks/use-fotos-del-cobro'
import type { FotoDelCobro } from '@/stores/fotos-corte-store'
import { QrFotosDialog } from './qr-fotos-dialog'
import { VisorFotos, type FotoDelVisor } from './visor-fotos'

interface FotosDelCobroProps {
  /** La entrada de la fila que se está cobrando. La sesión de fotos se ata a ella. */
  entradaId: string
  /** El diálogo de cobro está abierto (para el polling del celular). */
  abierto: boolean
  /** Mientras se registra el cobro no se agregan ni se quitan fotos. */
  deshabilitado?: boolean
}

/**
 * "Fotos del corte" en el cobro: con el celular (QR, recomendado), con la
 * cámara de la tablet o desde la galería.
 *
 * Las fotos se suben en segundo plano apenas se eligen y el cobro NO las
 * espera: si siguen subiendo cuando se toca Cobrar, terminan solas y quedan en
 * la ficha (ver fotos-corte-store). La cámara es la NATIVA (<input capture>):
 * se orienta sola por sensor y EXIF, y nunca se endereza nada aunque el panel
 * esté girado 180° (src/lib/giro-panel/camara.ts).
 */
export function FotosDelCobro({ entradaId, abierto, deshabilitado = false }: FotosDelCobroProps) {
  const f = useFotosDelCobro(entradaId, abierto)
  const inputCamara = useRef<HTMLInputElement>(null)
  const inputGaleria = useRef<HTMLInputElement>(null)
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

  const elegir = (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return
    vibrate(8)
    f.agregar(archivos)
  }

  return (
    <section aria-labelledby="cobro-fotos">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p id="cobro-fotos" className="text-sm font-medium">
          Fotos del corte <span className="text-muted-foreground">(opcional)</span>
        </p>
        {f.fotos.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {f.resumen.listas + f.resumen.enCurso}/{TOPE_FOTOS_POR_CORTE}
          </span>
        )}
      </div>

      {/* Tres caminos. El del celular va primero: saca mejores fotos y no hay
          que andar con la tablet en la mano. */}
      <div className="grid grid-cols-3 gap-2">
        <Mosaico
          icono={<Smartphone className="size-6" aria-hidden />}
          titulo="Con tu celular"
          detalle="Escaneá el QR"
          destacado
          deshabilitado={bloqueado}
          onClick={() => {
            vibrate(8)
            f.qr.abrir()
          }}
        />
        <Mosaico
          icono={<Camera className="size-6" aria-hidden />}
          titulo="Cámara"
          detalle="De la tablet"
          deshabilitado={bloqueado}
          onClick={() => inputCamara.current?.click()}
        />
        <Mosaico
          icono={<Images className="size-6" aria-hidden />}
          titulo="Galería"
          detalle="Elegir fotos"
          deshabilitado={bloqueado}
          onClick={() => inputGaleria.current?.click()}
        />
      </div>

      <input
        ref={inputCamara}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          elegir(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={inputGaleria}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          elegir(e.target.files)
          e.target.value = ''
        }}
      />

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
      <div className="mt-2 space-y-1" aria-live="polite">
        {f.resumen.enCurso > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            Subiendo {cantidadDeFotos(f.resumen.enCurso)}… Podés cobrar igual: terminan solas.
          </p>
        ) : f.resumen.listas > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5 shrink-0" aria-hidden />
            {cantidadDeFotos(f.resumen.listas)} {f.resumen.listas === 1 ? 'lista' : 'listas'}
          </p>
        ) : null}
        {f.resumen.enTope && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Llegaste al máximo de {TOPE_FOTOS_POR_CORTE} fotos por corte.
          </p>
        )}
        {f.resumen.conError > 0 && ultimoError && (
          <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {ultimoError}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
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

function Mosaico({
  icono,
  titulo,
  detalle,
  destacado = false,
  deshabilitado,
  onClick,
}: {
  icono: React.ReactNode
  titulo: string
  detalle: string
  destacado?: boolean
  deshabilitado: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      className={cn(
        'relative flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1.5 py-3 text-center outline-none',
        'transition-[background-color,border-color,transform] duration-150 motion-safe:active:scale-[0.97] motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        // El recomendado se distingue por el borde y la sombra, no por un
        // fondo gris: en el panel claro un mosaico gris se lee como apagado.
        destacado
          ? 'border-foreground bg-card shadow-sm hover:bg-muted/40'
          : 'border-border bg-card hover:bg-muted/60',
      )}
    >
      {destacado && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
          Recomendado
        </span>
      )}
      {icono}
      <span className="text-sm font-semibold leading-tight">{titulo}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{detalle}</span>
    </button>
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
