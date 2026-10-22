'use client'

// El veredicto: en 3 segundos, ¿cuadró la plata? UNA cifra grande (el titular
// del motor, con sus montos contando desde 0 la primera vez), su segunda línea,
// la ecuación, la balanza, la cobertura por cuenta y la frescura.
//
// Ningún número inventado: si no hay resultado, todo lo numérico queda en "—".
// "Cuadra" (verde) lo decide el motor y exige cobertura total; acá no se pinta
// verde nada que no venga así.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CircleHelp, Loader2, Plug, RefreshCw } from 'lucide-react'
import type { ResultadoConciliacion } from '@/lib/conciliacion-mp/contrato'
import { Button } from '@/components/ui/button'
import { TexPose } from '@/components/tex/tex-pose'
import type { TexPoseNombre } from '@/components/tex/assets'
import { cn } from '@/lib/utils'
import { numero, plata, porcentaje } from './formato'
import { balanza, partesConMontos, segmentosCobertura, textoFrescura } from './logica'
import { useAhora } from './use-pantalla'
import type { EstadoSync } from './use-sincronizacion'
import { COLOR_RAYADO, TONO, VEREDICTO, rayado } from './visual'

interface Props {
  resultado: ResultadoConciliacion | null
  cargando: boolean
  sync: EstadoSync
  pose: TexPoseNombre
  puedeGestionar: boolean
  /** Una cuenta que no se pudo leer deja cobros de ESTE período sin verificar: "Con lo que pudimos leer…". */
  hayErroresDeLectura: boolean
  /** Hay cuentas sin conectar con cobros en el período (para el botón "Conectar cuentas"). */
  hayCuentasSinConectar: boolean
  hayConectadas: boolean
  animarCifras: boolean
  onCifrasAnimadas: () => void
  onSincronizar: () => void
  onConectarCuentas: () => void
  onReintentarLectura: () => void
  /** Ir a la pestaña "Para confirmar" (los emparejamientos dudosos). */
  onVerParaConfirmar: () => void
}

export function Veredicto(props: Props) {
  const { resultado, cargando, sync, pose } = props
  const v = resultado?.veredicto ?? null
  const estilo = v ? VEREDICTO[v.tipo] : null
  const tono = estilo ? TONO[estilo.tono] : TONO.desconocido
  const Icono = estilo?.icono ?? null
  const paraConfirmar = resultado?.totales.paraConfirmar ?? 0

  return (
    <section
      aria-labelledby="veredicto-titular"
      aria-busy={cargando}
      className="relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-4 sm:p-6"
    >
      {cargando && <BarraRecalculando />}

      <div className={cn('flow-root transition-opacity duration-200', cargando && 'opacity-70')}>
        {/* En el celular la pose de Tex va en una esquina del veredicto (spec C, 390). Flota: el
            titular la rodea y debajo usa todo el ancho (flow-root la contiene: no se mete en la balanza). */}
        <TexPose pose={pose} alto={72} className="pointer-events-none float-right -mt-1 mb-1 ml-3 lg:hidden" />
        {v && props.hayErroresDeLectura && (v.tipo === 'no_cuadra' || v.tipo === 'no_se_sabe') && (
          <p className="mb-1 text-xs font-medium text-red-300">Con lo que pudimos leer:</p>
        )}
        <h2
          id="veredicto-titular"
          className={cn(
            // 48 en escritorio (spec); entre 1024 y 1279 la columna mide ~410 px y va en 40.
            'text-[32px] leading-[1.08] font-semibold tracking-tight lg:text-[40px] xl:text-5xl',
            !v ? 'text-zinc-500' : v.tipo === 'no_se_sabe' || v.tipo === 'sin_movimientos' ? 'text-zinc-300' : tono.texto,
          )}
        >
          {Icono && <Icono className="mr-2.5 inline-block size-7 align-[-0.12em] lg:size-9 xl:mr-3 xl:size-10" aria-hidden />}
          {v ? (
            <TitularAnimado texto={v.titular} animar={props.animarCifras} onFin={props.onCifrasAnimadas} />
          ) : (
            <span className="font-mono">—</span>
          )}
        </h2>
        {estilo && <p className="sr-only">Estado: {estilo.palabra}.</p>}
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-300">
          {v ? v.detalle : 'No pudimos calcular la conciliación de este período.'}
        </p>

        {v && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Lo que cuadra sólo por un emparejamiento dudoso no prueba nada: se muestra y se va a confirmar. */}
            {paraConfirmar > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={props.onVerParaConfirmar}>
                <CircleHelp className="size-3.5" aria-hidden />
                {paraConfirmar === 1 ? 'Ver el que falta confirmar' : `Ver los ${numero(paraConfirmar)} para confirmar`}
              </Button>
            )}
            {v.tipo === 'no_se_sabe' && props.hayCuentasSinConectar && props.puedeGestionar && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={props.onConectarCuentas}>
                <Plug className="size-3.5" aria-hidden />
                Conectar cuentas
              </Button>
            )}
            {v.tipo === 'error' && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                onClick={props.onReintentarLectura}
                disabled={sync.activo}
              >
                <RefreshCw className={cn('size-3.5', sync.activo && 'animate-spin')} aria-hidden />
                Reintentar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className={cn('mt-5 space-y-5 transition-opacity duration-200', cargando && 'opacity-70')}>
        <Ecuacion resultado={resultado} />
        <BalanzaBarras resultado={resultado} />
        <Cobertura resultado={resultado} />
      </div>

      <Frescura
        resultado={resultado}
        sync={sync}
        puedeGestionar={props.puedeGestionar && props.hayConectadas}
        onSincronizar={props.onSincronizar}
      />
    </section>
  )
}

function BarraRecalculando() {
  return (
    <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
      <div className="cmp-barrido h-full w-1/3 bg-gradient-to-r from-transparent via-zinc-300/70 to-transparent" />
    </div>
  )
}

/**
 * El titular con sus montos. La primera vez que hay montos, cuentan desde 0 en
 * 700 ms. Mientras la página no hidrata, el titular queda invisible (sólo si
 * se permite movimiento): así no se ve el número final, después un $0 y
 * después la cuenta. Con movimiento reducido no se oculta ni cuenta.
 */
function TitularAnimado({ texto, animar, onFin }: { texto: string; animar: boolean; onFin: () => void }) {
  const partes = partesConMontos(texto)
  const tieneMontos = partes.some((p) => p.tipo === 'monto')
  const debe = animar && tieneMontos
  const [progreso, setProgreso] = useState(1)
  const [arranco, setArranco] = useState(false)
  const onFinRef = useRef(onFin)

  useEffect(() => {
    onFinRef.current = onFin
  })

  useEffect(() => {
    if (!animar) return
    let raf = 0
    if (!tieneMontos || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Nada que contar (o no se quiere movimiento): la primera vez ya pasó.
      raf = requestAnimationFrame(() => onFinRef.current())
      return () => cancelAnimationFrame(raf)
    }
    let inicio = 0
    const paso = (t: number) => {
      if (!inicio) {
        inicio = t
        setArranco(true)
      }
      const x = Math.min(1, (t - inicio) / 700)
      setProgreso(1 - Math.pow(1 - x, 3))
      if (x < 1) raf = requestAnimationFrame(paso)
      else onFinRef.current()
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [animar, tieneMontos, texto])

  return (
    <span className={cn(debe && !arranco && 'motion-safe:opacity-0')}>
      {partes.map((p, i) =>
        p.tipo === 'texto' ? (
          <span key={i}>{p.texto}</span>
        ) : (
          // La cifra final reserva el ancho: mientras cuenta, el resto de la frase no salta.
          <span key={i} className="inline-grid font-mono tabular-nums">
            <span className="invisible col-start-1 row-start-1" aria-hidden>
              {plata(p.valor)}
            </span>
            <span className="col-start-1 row-start-1 text-right">{plata(debe ? Math.round(p.valor * progreso) : p.valor)}</span>
          </span>
        ),
      )}
    </span>
  )
}

function Ecuacion({ resultado }: { resultado: ResultadoConciliacion | null }) {
  const t = resultado?.totales
  return (
    <p className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-5">
      <span>
        En el sistema{' '}
        <span className="font-mono font-medium text-foreground tabular-nums">{t ? plata(t.montoSistema) : '—'}</span>
      </span>
      <span>
        En Mercado Pago{' '}
        <span className="font-mono font-medium text-foreground tabular-nums">{t ? plata(t.montoMp) : '—'}</span>
      </span>
    </p>
  )
}

const ESTILO_TRAMO: Record<
  'base' | 'confirmar' | 'sobra' | 'falta' | 'sin_verificar',
  { clase: string; estilo?: CSSProperties; leyenda: string }
> = {
  base: { clase: 'bg-zinc-300/80', leyenda: '' },
  // Entró, pero sólo cuadra por un emparejamiento dudoso: más apagado que lo verificado.
  confirmar: { clase: 'bg-zinc-500/80', leyenda: 'Para confirmar' },
  sobra: { clase: 'bg-amber-400', leyenda: 'Sobran' },
  falta: { clase: '', estilo: rayado(COLOR_RAYADO.ambar, COLOR_RAYADO.ambarFondo), leyenda: 'Faltan' },
  sin_verificar: { clase: '', estilo: rayado(COLOR_RAYADO.gris, COLOR_RAYADO.grisFondo), leyenda: 'Sin verificar' },
}

/**
 * Dos barras con la misma escala. Lo que falta va rayado en ámbar y lo que
 * sobra lleno en ámbar: tramos separados, nunca neteados.
 */
function BalanzaBarras({ resultado }: { resultado: ResultadoConciliacion | null }) {
  if (!resultado) {
    return (
      <div className="space-y-2" aria-hidden>
        <FilaBarra etiqueta="Sistema" />
        <FilaBarra etiqueta="Mercado Pago" />
      </div>
    )
  }
  const b = balanza(resultado)
  if (b.sistema === 0 && b.mp === 0) return null
  const leyenda = b.tramos.filter((t) => t.tipo !== 'base')
  const descripcion = [
    `En el sistema ${plata(b.sistema)}`,
    `en Mercado Pago ${plata(b.mp)}`,
    ...leyenda.map((t) => `${ESTILO_TRAMO[t.tipo].leyenda.toLowerCase()} ${plata(t.valor)}`),
  ].join(', ')
  return (
    <div className="space-y-2">
      <div role="img" aria-label={`Balanza: ${descripcion}.`} className="space-y-2">
        <FilaBarra etiqueta="Sistema">
          <div className="cmp-crece h-full rounded-full bg-zinc-300/80" style={{ width: `${b.pctSistema}%` }} />
        </FilaBarra>
        <FilaBarra etiqueta="Mercado Pago">
          <div className="cmp-crece flex h-full">
            {b.tramos.map((t) => (
              <div
                key={t.tipo}
                className={cn('h-full transition-[width] duration-700 first:rounded-l-full last:rounded-r-full', ESTILO_TRAMO[t.tipo].clase)}
                style={{ width: `${t.pct}%`, ...ESTILO_TRAMO[t.tipo].estilo }}
              />
            ))}
          </div>
        </FilaBarra>
      </div>
      {leyenda.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:pl-[6.75rem]">
          {leyenda.map((t) => (
            <li key={t.tipo} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('inline-block h-2.5 w-4 rounded-sm', ESTILO_TRAMO[t.tipo].clase)}
                style={ESTILO_TRAMO[t.tipo].estilo}
              />
              {ESTILO_TRAMO[t.tipo].leyenda}{' '}
              <span className="font-mono text-zinc-300 tabular-nums">{plata(t.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilaBarra({ etiqueta, children }: { etiqueta: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{etiqueta}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">{children}</div>
    </div>
  )
}

/** Un segmento por cuenta con cobros: lleno = conectada, rojo = con error, rayado = sin conectar. */
function Cobertura({ resultado }: { resultado: ResultadoConciliacion | null }) {
  if (!resultado) {
    return <p className="text-xs text-muted-foreground">Cobertura: —</p>
  }
  const segmentos = segmentosCobertura(resultado.cuentas)
  if (segmentos.length === 0) return null
  const conectadas = segmentos.filter((s) => s.tipo === 'conectada').length
  const texto = `${conectadas} de ${segmentos.length} ${segmentos.length === 1 ? 'cuenta conectada' : 'cuentas conectadas'} · ${porcentaje(
    resultado.cobertura.pctPlata,
  )} de la plata`
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-muted-foreground">Cobertura</span>
        <div className="flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Cobertura: ${texto}.`}>
          {segmentos.map((s) => (
            <span
              key={s.id}
              title={`${s.alias}: ${s.tipo === 'conectada' ? 'conectada' : s.tipo === 'error' ? 'con error' : 'sin conectar'}`}
              className={cn('h-full min-w-1', s.tipo === 'conectada' && 'bg-zinc-300/80', s.tipo === 'error' && 'bg-red-400')}
              style={{ flexGrow: s.peso, flexBasis: 0, ...(s.tipo === 'sin_conectar' ? rayado(COLOR_RAYADO.gris, COLOR_RAYADO.grisFondo) : {}) }}
            />
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground sm:pl-[6.75rem]">{texto}</p>
    </div>
  )
}

function Frescura({
  resultado,
  sync,
  puedeGestionar,
  onSincronizar,
}: {
  resultado: ResultadoConciliacion | null
  sync: EstadoSync
  puedeGestionar: boolean
  onSincronizar: () => void
}) {
  // "Leído hace N min" contado con el reloj de la pantalla: el texto del servidor queda fijo en la hora del cálculo.
  const ahora = useAhora()
  const frescura = resultado ? textoFrescura(resultado, ahora) : null
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
      {/* Se anuncia el avance de la lectura, no cada minuto de "leído hace N min" (el reloj de la pantalla). */}
      <span className="sr-only" aria-live="polite">
        {sync.activo ? `Trayendo los movimientos de Mercado Pago: ${Math.min(sync.hechas + 1, sync.total)} de ${sync.total}.` : ''}
      </span>
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {sync.activo ? (
          <>
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            <span>
              Trayendo los movimientos de Mercado Pago…{' '}
              <span className="tabular-nums">
                {Math.min(sync.hechas + 1, sync.total)} de {sync.total}
              </span>
            </span>
          </>
        ) : frescura ? (
          <span>{frescura}</span>
        ) : resultado ? (
          <span>Todavía no hay cuentas de Mercado Pago leídas.</span>
        ) : null}
      </p>
      {puedeGestionar && (
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onSincronizar} disabled={sync.activo}>
          <RefreshCw className={cn('size-3.5', sync.activo && 'animate-spin')} aria-hidden />
          Sincronizar
        </Button>
      )}
    </div>
  )
}

