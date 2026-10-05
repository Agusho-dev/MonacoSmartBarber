'use client'

import { useState } from 'react'
import {
  ArrowRight,
  CircleCheck,
  Keyboard,
  Loader2,
  Maximize,
  Minimize,
  RotateCw,
  Tablet,
  X,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useGiroPanel } from '@/hooks/use-giro-panel'
import {
  alternarGiro,
  alternarPantallaCompleta,
  girarTeclado,
  type EstadoGiro,
} from '@/lib/giro-panel/store'
import {
  SUGERENCIA_ROTACION_AUTOMATICA,
  avisarErrorPantallaCompleta,
  avisarGiro,
  avisarResultadoTeclado,
} from '@/lib/giro-panel/avisos'
import { vibrate } from '@/lib/barber-feedback'
import { cn } from '@/lib/utils'

/** Lo que tarda la hoja en empezar a irse antes de girar: la animación no arrastra media hoja. */
const ESPERA_CIERRE_HOJA_MS = 220

/**
 * El ÚNICO control de pantalla del panel: "Pantalla" abre una hoja chica con
 * "Dar vuelta 180°", "Pantalla completa" y —sólo si el sistema puede— "Girar
 * también el teclado". Va en una hoja y no como botón directo a propósito: un
 * toque accidental no puede dar vuelta la tablet de todo un turno.
 *
 * - `nav`: ítem de la barra inferior (con sesión).
 * - `flotante`: pastilla arriba a la derecha en la pantalla del PIN.
 *
 * Reemplaza a FullscreenButton SÓLO en /barbero (el kiosko lo sigue usando): de
 * paso deja libre el botón "Salir" del header de la fila, que ese botón tapaba.
 */
export function ControlPantalla({ variante }: { variante: 'nav' | 'flotante' }) {
  const giro = useGiroPanel()
  const [abierta, setAbierta] = useState(false)
  const girada = giro.modo !== 'normal'

  const abrir = () => {
    vibrate(8)
    setAbierta(true)
  }

  const deshacer = () => {
    void alternarGiro().then((r) => avisarGiro(r, deshacer))
  }

  const onGirar = () => {
    vibrate(12)
    setAbierta(false)
    window.setTimeout(() => {
      void alternarGiro().then((r) => avisarGiro(r, deshacer))
    }, ESPERA_CIERRE_HOJA_MS)
  }

  const onPantallaCompleta = async () => {
    vibrate(8)
    const ok = await alternarPantallaCompleta()
    if (!ok) avisarErrorPantallaCompleta()
  }

  const onGirarTeclado = async () => {
    vibrate(8)
    const motivo = await girarTeclado()
    avisarResultadoTeclado(motivo)
    if (!motivo) setAbierta(false)
  }

  // Mientras Android decide si acepta el bloqueo (hasta ~1 s, con la hoja ya
  // cerrada), el ícono gira: si no, el toque parecería no haber hecho nada.
  const icono = (
    <span className="relative inline-flex">
      {giro.bloqueando ? (
        <Loader2 aria-hidden className="size-5 animate-spin" />
      ) : (
        <Tablet
          aria-hidden
          className={cn(
            'size-5 motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
            girada && 'rotate-180',
          )}
        />
      )}
      {girada && !giro.bloqueando && (
        <span aria-hidden className="absolute -right-1 -top-1 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
      )}
    </span>
  )

  return (
    <>
      {variante === 'nav' ? (
        <button
          type="button"
          onClick={abrir}
          aria-haspopup="dialog"
          aria-expanded={abierta}
          aria-label={girada ? 'Pantalla de la tablet (dada vuelta)' : 'Pantalla de la tablet'}
          className={cn(
            'flex min-w-[4rem] flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted/50 max-[400px]:min-w-0 max-[400px]:px-1.5',
            abierta ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {icono}
          <span className="leading-none">Pantalla</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          aria-haspopup="dialog"
          aria-expanded={abierta}
          aria-label={girada ? 'Pantalla de la tablet (dada vuelta)' : 'Pantalla de la tablet'}
          className="fixed right-3 top-3 z-30 inline-flex h-11 items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 text-sm font-semibold text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:text-foreground active:scale-[0.97] motion-safe:transition-transform md:right-4 md:top-4"
        >
          {icono}
          Pantalla
        </button>
      )}

      <Sheet open={abierta} onOpenChange={setAbierta}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto max-h-[90dvh] max-w-lg gap-0 overflow-y-auto rounded-t-3xl border-x p-0"
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-muted-foreground/25" />
          <div className="flex items-start gap-3 px-5 pb-3 pt-2">
            <SheetHeader className="flex-1 gap-1 p-0">
              <SheetTitle className="text-lg font-bold tracking-tight">Pantalla de esta tablet</SheetTitle>
              <SheetDescription>Se guarda en esta tablet, no en tu usuario.</SheetDescription>
            </SheetHeader>
            <button
              type="button"
              onClick={() => setAbierta(false)}
              aria-label="Cerrar"
              className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="space-y-3 px-5 pb-6">
            <button
              type="button"
              onClick={onGirar}
              disabled={giro.bloqueando}
              className="group flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/40 active:scale-[0.99] disabled:opacity-60 motion-safe:transition-transform"
            >
              <IlustracionGiro vertical={giro.actual?.startsWith('portrait') ?? false} />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold leading-tight">
                  {girada ? 'Volver a la orientación normal' : 'Dar vuelta 180°'}
                </span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                  {girada
                    ? 'Para cuando la tablet vuelva a estar con el cargador abajo.'
                    : 'Para la tablet montada al revés, con el cargador arriba.'}
                </span>
              </span>
              {giro.bloqueando ? (
                <Loader2 aria-hidden className="size-5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <RotateCw
                  aria-hidden
                  className="size-5 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-500 group-hover:text-foreground motion-safe:group-hover:rotate-180"
                />
              )}
            </button>

            <OpcionPantallaCompleta giro={giro} onAlternar={onPantallaCompleta} />

            {girada && <EstadoTeclado giro={giro} onGirarTeclado={onGirarTeclado} />}

            {!girada && giro.preferencia?.objetivo && giro.preferencia.sistemaGira && (
              <p className="flex items-start gap-2.5 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                Esta tablet se acomoda sola: Android la pone derecha con su rotación automática.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function OpcionPantallaCompleta({ giro, onAlternar }: { giro: EstadoGiro; onAlternar: () => void }) {
  // La app instalada en display-mode fullscreen ya ocupa todo: se muestra prendida
  // y deshabilitada, con el motivo, en vez de un interruptor que no haría nada.
  const deApp = giro.pantallaCompletaDeApp
  const posible = giro.pantallaCompletaPosible && !deApp
  const activa = giro.pantallaCompleta
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activa}
      onClick={onAlternar}
      disabled={!posible}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:bg-muted/40 disabled:opacity-60"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        {activa ? <Minimize aria-hidden className="size-5" /> : <Maximize aria-hidden className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-tight">Pantalla completa</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {deApp
            ? 'La app ya ocupa toda la pantalla.'
            : !giro.pantallaCompletaPosible
              ? 'Este navegador no deja usar pantalla completa.'
              : activa
                ? 'Sin barras de Android. Tocá para salir.'
                : 'Esconde las barras de Android.'}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
          activa ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 size-6 rounded-full bg-background shadow-sm motion-safe:transition-transform motion-safe:duration-200',
            activa && 'translate-x-5',
          )}
        />
      </span>
    </button>
  )
}

function EstadoTeclado({ giro, onGirarTeclado }: { giro: EstadoGiro; onGirarTeclado: () => void }) {
  if (giro.modo === 'nativo') {
    return (
      <p className="flex items-start gap-2.5 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="block font-semibold">El teclado también sale derecho</span>
          Android giró toda la pantalla. Si salís de pantalla completa, el panel se sigue viendo derecho.
        </span>
      </p>
    )
  }
  if (giro.nativoPosible) {
    return (
      <button
        type="button"
        onClick={onGirarTeclado}
        disabled={giro.bloqueando}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:bg-muted/40 disabled:opacity-60"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          {giro.bloqueando ? (
            <Loader2 aria-hidden className="size-5 animate-spin" />
          ) : (
            <Keyboard aria-hidden className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-tight">
            {giro.bloqueando ? 'Pidiéndole a Android que gire…' : 'Girar también el teclado'}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            El de Android sale al revés. Esto le pide a Android que gire todo (pasa a pantalla completa).
          </span>
        </span>
      </button>
    )
  }
  const motivo =
    giro.motivoSinNativo === 'android_lo_ignora'
      ? 'Android no aceptó girarlo en esta tablet.'
      : 'Este navegador no deja girarlo desde el panel.'
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
      <Keyboard aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">
        <span className="block font-semibold text-foreground">El teclado de Android sale al revés</span>
        {motivo} {SUGERENCIA_ROTACION_AUTOMATICA} Los montos y las cantidades se cargan con el teclado del panel.
      </p>
    </div>
  )
}

/**
 * "Ahora → Así queda": dos tablets con el marco quieto y el contenido dado vuelta.
 * Está dibujada en las coordenadas de la UI, así que el barbero ve "Ahora" igual
 * que la pantalla real (derecha o al revés) y "Así queda" como va a quedar. Sin
 * marcas físicas (cámara, cargador): su lugar depende de cómo esté montada.
 */
function IlustracionGiro({ vertical }: { vertical: boolean }) {
  return (
    <span aria-hidden className="flex shrink-0 items-end gap-1.5">
      <ConEpigrafe texto="Ahora">
        <MiniTablet vertical={vertical} girada={false} />
      </ConEpigrafe>
      <ArrowRight className="mb-[1.375rem] size-4 text-muted-foreground" />
      <ConEpigrafe texto="Así queda">
        <MiniTablet vertical={vertical} girada />
      </ConEpigrafe>
    </span>
  )
}

function ConEpigrafe({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[10px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">
        {texto}
      </span>
    </span>
  )
}

function MiniTablet({ vertical, girada }: { vertical: boolean; girada: boolean }) {
  const w = vertical ? 30 : 44
  const h = vertical ? 42 : 30
  const cx = w / 2
  const cy = h / 2
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={vertical ? 34 : 54}
      height={vertical ? 48 : 37}
      className="overflow-visible"
    >
      <rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        rx={5}
        className="fill-background stroke-foreground/70"
        strokeWidth={1.5}
      />
      <g
        className="giro-ilus-contenido"
        data-girado={girada ? '' : undefined}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        <rect x={5.5} y={5.5} width={w * 0.42} height={3.2} rx={1.6} className="fill-foreground" />
        <rect x={5.5} y={11.5} width={w - 11} height={2.4} rx={1.2} className="fill-foreground/35" />
        <rect x={5.5} y={15.8} width={w * 0.55} height={2.4} rx={1.2} className="fill-foreground/35" />
        <rect x={5.5} y={h - 8.7} width={w - 11} height={3.2} rx={1.6} className="fill-foreground/20" />
      </g>
    </svg>
  )
}
