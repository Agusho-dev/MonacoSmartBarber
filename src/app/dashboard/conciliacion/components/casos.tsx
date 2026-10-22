'use client'

// Los casos: cada cobro del sistema y cada movimiento de Mercado Pago, con su
// estado. Pestañas por color (Para revisar por defecto, ordenado por plata),
// filtros, búsqueda y exportar. Escritorio: tabla (Hora · Cuenta · Sistema ·
// = ≠ ∅ · Mercado Pago · Estado), con "No figura" punteado donde falta un
// lado. Celular: tarjetas de 72 px con un filete del color.
//
// Un mes son ~2.300 casos: se dibujan de a 50 con "Ver más" (no se degrada el
// scroll en el celular). Lo que "no parece un cobro" nunca muestra el pagador.

import type { ReactNode } from 'react'
import { Download, Search, X } from 'lucide-react'
import {
  ETIQUETA_ESTADO,
  type CasoConciliacion,
  type ResultadoConciliacion,
} from '@/lib/conciliacion-mp/contrato'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { fechaHoraAR, horaAR, numero, plata, plural } from './formato'
import {
  PESTANAS,
  conectorDe,
  esCreditoSinCruzar,
  etiquetaDeCaso,
  hayFiltros,
  montoDelCaso,
  tonoDeCaso,
  type FiltrosCasos,
  type OpcionesFiltro,
  type PestanaCasos,
} from './logica'
import { ChipCaso, IconoCaso, TONO } from './visual'

export const TAMANO_PAGINA = 50

const TODAS = '__todas__'

interface Props {
  resultado: ResultadoConciliacion
  pestana: PestanaCasos
  onPestana: (p: PestanaCasos) => void
  conteos: Record<PestanaCasos, number>
  filtros: FiltrosCasos
  onFiltros: (f: FiltrosCasos) => void
  opciones: OpcionesFiltro
  /** Los casos de la pestaña, ya filtrados y ordenados. */
  lista: CasoConciliacion[]
  visibles: number
  onVerMas: () => void
  ocultos: Set<string>
  seleccionadoId: string | null
  onAbrir: (c: CasoConciliacion) => void
  multiDia: boolean
  /** Lo que se ve en la pestaña (sin las filas que se están plegando). */
  cantidadVisible: number
  /** Todo el período con los filtros puestos (todas las pestañas). */
  totalFiltrado: number
  onExportar: (todo: boolean) => void
  atajos: { revisar: boolean; tex: boolean } | null
  /** Desde "Nada para revisar": ir a los que cuadran o a los que hay que confirmar. */
  onVerPestana: (p: PestanaCasos) => void
  /**
   * Lo que hay en pantalla es de OTRO período o sucursal (el nuevo se está
   * calculando): la lista se atenúa, no se abre ni se exporta.
   */
  desfasado: boolean
}

export function Casos(props: Props) {
  const { resultado, pestana, conteos, filtros, lista, visibles, ocultos, desfasado } = props
  const mostrados = lista.slice(0, visibles)
  const ajenosSinLista = pestana === 'ajenos' && lista.length === 0 && resultado.totales.ajenos > 0 && !hayFiltros(filtros)

  return (
    <section id="casos" aria-labelledby="casos-titulo" aria-busy={desfasado} className="scroll-mt-20 rounded-2xl border bg-card">
      <header className="flex flex-col gap-3 border-b border-white/[0.06] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="casos-titulo" className="text-base font-semibold">
            Casos
          </h2>
          <Exportar visibles={props.cantidadVisible} total={props.totalFiltrado} deshabilitado={desfasado} onExportar={props.onExportar} />
        </div>
        <Pestanas pestana={pestana} conteos={conteos} ajenos={resultado.totales.ajenos} onPestana={props.onPestana} />
        <Filtros filtros={filtros} onFiltros={props.onFiltros} opciones={props.opciones} />
      </header>

      {/* Mientras se calcula otro período, lo de abajo es del anterior: atenuado y sin tocar. */}
      <div className={cn('transition-opacity duration-200', desfasado && 'pointer-events-none opacity-50')} inert={desfasado}>
        {ajenosSinLista ? (
          <ResumenAjenos cantidad={resultado.totales.ajenos} monto={resultado.totales.montoAjeno} />
        ) : lista.length === 0 ? (
          <Vacio
            pestana={pestana}
            filtrado={hayFiltros(filtros)}
            cuadran={conteos.cuadran}
            confirmar={conteos.confirmar}
            onLimpiar={() => props.onFiltros({ ...filtros, sucursalId: null, alias: null, barbero: null, estado: null, texto: '' })}
            onVerPestana={props.onVerPestana}
          />
        ) : (
          <>
            <div
              aria-hidden
              className={cn(
                'hidden gap-3 border-b border-white/[0.06] px-5 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase xl:grid',
                props.multiDia ? COLUMNAS_MULTIDIA : COLUMNAS,
              )}
            >
              <span>Hora</span>
              <span>Cuenta</span>
              <span>Sistema</span>
              <span />
              <span>Mercado Pago</span>
              <span>Estado</span>
            </div>
            <ul
              data-lista-casos
              aria-label={`Casos: ${PESTANAS.find((p) => p.id === pestana)?.etiqueta ?? ''}`}
              className="divide-y divide-white/[0.05]"
            >
              {mostrados.map((c) => (
                <li key={c.id} className="cmp-pliegue" data-plegado={ocultos.has(c.id) ? 'true' : 'false'}>
                  <div>
                    <FilaCaso caso={c} seleccionado={props.seleccionadoId === c.id} multiDia={props.multiDia} onAbrir={props.onAbrir} />
                  </div>
                </li>
              ))}
            </ul>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 sm:px-5">
              <p className="text-xs text-muted-foreground tabular-nums">
                {lista.length > mostrados.length
                  ? `Mostrando ${numero(mostrados.length)} de ${numero(lista.length)}`
                  : plural(lista.length, 'caso')}
              </p>
              {lista.length > mostrados.length && (
                <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={props.onVerMas}>
                  Ver {Math.min(TAMANO_PAGINA, lista.length - mostrados.length)} más
                </Button>
              )}
              {props.atajos && (
                <p className="hidden w-full text-[11px] text-muted-foreground/70 lg:block">
                  En la lista: <Tecla>↑</Tecla> <Tecla>↓</Tecla> para moverte · <Tecla>Enter</Tecla> abre
                  {props.atajos.revisar && (
                    <>
                      {' '}
                      · <Tecla>R</Tecla> revisar · <Tecla>V</Tecla> vincular
                    </>
                  )}
                  {props.atajos.tex && (
                    <>
                      {' '}
                      · <Tecla>T</Tecla> preguntarle a Tex
                    </>
                  )}
                </p>
              )}
            </footer>
          </>
        )}
      </div>
    </section>
  )
}

// La tabla va desde 1280 (con el menú quedan ~976 px de contenido; a 1024 quedan 720 y las
// columnas se comían los nombres): abajo de eso, las tarjetas del celular.
const COLUMNAS = 'grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,2.1fr)_1.5rem_minmax(0,1.6fr)_12.75rem]'
const COLUMNAS_MULTIDIA = 'grid-cols-[5.75rem_minmax(0,1fr)_minmax(0,2.1fr)_1.5rem_minmax(0,1.6fr)_12.75rem]'

function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.04] px-1 py-px font-mono text-[10px] text-zinc-300">{children}</kbd>
  )
}

function Pestanas({
  pestana,
  conteos,
  ajenos,
  onPestana,
}: {
  pestana: PestanaCasos
  conteos: Record<PestanaCasos, number>
  ajenos: number
  onPestana: (p: PestanaCasos) => void
}) {
  return (
    <div data-sin-swipe className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5" role="group" aria-label="Estados">
      <div className="flex w-max gap-1 rounded-lg border bg-muted/50 p-1">
        {PESTANAS.map((p) => {
          const n = p.id === 'ajenos' ? Math.max(conteos.ajenos, ajenos) : conteos[p.id]
          const activa = pestana === p.id
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={activa}
              onClick={() => onPestana(p.id)}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
                activa ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                p.id === 'ajenos' && !activa && 'text-muted-foreground/70',
              )}
            >
              {p.etiqueta}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] tabular-nums',
                  p.id === 'revisar' && n > 0
                    ? 'bg-amber-500/15 text-amber-300'
                    : // Lo que hay que confirmar también pide una mano: se marca, en gris (todavía no se sabe).
                      p.id === 'confirmar' && n > 0
                      ? 'bg-zinc-200/15 text-zinc-100'
                      : 'bg-white/[0.06] text-muted-foreground',
                )}
              >
                {numero(n)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Filtros({
  filtros,
  onFiltros,
  opciones,
}: {
  filtros: FiltrosCasos
  onFiltros: (f: FiltrosCasos) => void
  opciones: OpcionesFiltro
}) {
  const poner = (cambio: Partial<FiltrosCasos>) => onFiltros({ ...filtros, ...cambio })
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="relative lg:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={filtros.texto}
          onChange={(e) => poner({ texto: e.target.value })}
          placeholder="Cliente, pagador, monto o nº"
          aria-label="Buscar casos"
          className="h-10 pr-9 pl-9 lg:h-9"
          enterKeyHint="search"
        />
        {filtros.texto && (
          <button
            type="button"
            onClick={() => poner({ texto: '' })}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
            aria-label="Borrar la búsqueda"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div data-sin-swipe className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {/* La sucursal no va acá: se elige arriba y manda en toda la pantalla (control-periodo.tsx). */}
        {opciones.aliases.length > 1 && (
          <FiltroSelect
            etiqueta="Cuenta"
            todas="Todas las cuentas"
            valor={filtros.alias}
            opciones={opciones.aliases.map((a) => ({ valor: a, texto: a }))}
            onCambiar={(v) => poner({ alias: v })}
            mono
          />
        )}
        {opciones.barberos.length > 1 && (
          <FiltroSelect
            etiqueta="Barbero"
            todas="Todos los barberos"
            valor={filtros.barbero}
            opciones={opciones.barberos.map((b) => ({ valor: b, texto: b }))}
            onCambiar={(v) => poner({ barbero: v })}
          />
        )}
        {filtros.estado && (
          <button
            type="button"
            onClick={() => poner({ estado: null })}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-3 text-xs lg:h-9"
            aria-label={`Quitar el filtro: ${ETIQUETA_ESTADO[filtros.estado]}`}
          >
            Sólo: {ETIQUETA_ESTADO[filtros.estado]}
            <X className="size-3.5" aria-hidden />
          </button>
        )}
        {hayFiltros(filtros) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 shrink-0 text-muted-foreground lg:h-9"
            onClick={() => onFiltros({ sucursalId: null, alias: null, barbero: null, estado: null, texto: '' })}
          >
            Limpiar
          </Button>
        )}
      </div>
    </div>
  )
}

function FiltroSelect({
  etiqueta,
  todas,
  valor,
  opciones,
  onCambiar,
  mono,
}: {
  etiqueta: string
  todas: string
  valor: string | null
  opciones: { valor: string; texto: string }[]
  onCambiar: (v: string | null) => void
  mono?: boolean
}) {
  return (
    <Select value={valor ?? TODAS} onValueChange={(v) => onCambiar(v === TODAS ? null : v)}>
      <SelectTrigger
        aria-label={etiqueta}
        className={cn('h-10 w-auto min-w-[9.5rem] shrink-0 lg:h-9', valor && 'border-white/30 bg-white/[0.04]')}
      >
        <SelectValue placeholder={todas} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={TODAS}>{todas}</SelectItem>
        {opciones.map((o) => (
          <SelectItem key={o.valor} value={o.valor} className={cn(mono && 'font-mono text-[13px]')}>
            {o.texto}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Exportar({
  visibles,
  total,
  deshabilitado,
  onExportar,
}: {
  visibles: number
  total: number
  /** Mientras se calcula otro período: el archivo saldría con las filas del anterior. */
  deshabilitado: boolean
  onExportar: (todo: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={total === 0 || deshabilitado}>
          <Download className="size-4" aria-hidden />
          <span className="hidden sm:inline">Exportar CSV</span>
          <span className="sm:hidden">CSV</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Exportar a CSV</DropdownMenuLabel>
        <DropdownMenuItem disabled={visibles === 0} onSelect={() => onExportar(false)}>
          Lo que estoy viendo ({numero(visibles)})
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExportar(true)}>Todo el período ({numero(total)})</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NoFigura({ texto }: { texto: string }) {
  return (
    <span className="inline-flex h-8 max-w-full items-center truncate rounded-md border border-dashed border-white/15 px-2.5 text-xs text-muted-foreground">
      {texto}
    </span>
  )
}

function textoSinMovimiento(c: CasoConciliacion): string {
  if (c.estado === 'pendiente') return 'Todavía no leído'
  if (c.estado === 'sin_verificar') return 'Sin verificar'
  return 'No figura'
}

/**
 * Del lado del sistema: un crédito que todavía no se pudo cruzar (entró hace
 * minutos, o podría ser de un cobro que no se leyó o no se puede verificar) no
 * "no figura": decirlo así lo leería como plata que sobra.
 */
function textoSinSistema(c: CasoConciliacion): string {
  return esCreditoSinCruzar(c) ? 'Sin cruzar todavía' : 'No figura'
}

/** Barbero · cliente, o "3 cobros · Lucas, Nahuel" en un cobro conjunto. */
function quienDelSistema(c: CasoConciliacion): { linea: string; sub: string | null } {
  const e = c.esperados
  if (e.length === 0) return { linea: '', sub: null }
  if (e.length === 1) {
    const x = e[0]
    const sub =
      x.tipo === 'sin_cuenta'
        ? 'Sin cuenta asignada'
        : x.tipo === 'propina_suelta'
          ? 'Propina transferida'
          : [x.servicio, x.esManual ? 'alta manual' : null].filter(Boolean).join(' · ') || null
    return { linea: [x.barbero ?? 'Sin barbero', x.cliente].filter(Boolean).join(' · '), sub }
  }
  const barberos = [...new Set(e.map((x) => x.barbero).filter(Boolean))].join(', ')
  return { linea: `${e.length} cobros${barberos ? ` · ${barberos}` : ''}`, sub: 'Cobro conjunto' }
}

function FilaCaso({
  caso: c,
  seleccionado,
  multiDia,
  onAbrir,
}: {
  caso: CasoConciliacion
  seleccionado: boolean
  multiDia: boolean
  onAbrir: (c: CasoConciliacion) => void
}) {
  const tono = TONO[tonoDeCaso(c)]
  const etiqueta = etiquetaDeCaso(c)
  const cuando = multiDia ? fechaHoraAR(c.fecha) : horaAR(c.fecha)
  const sistema = quienDelSistema(c)
  const ajeno = c.estado === 'ajeno'
  const pagador = ajeno ? null : (c.movimiento?.pagador ?? null)
  const conector = conectorDe(c)
  const resumenMovil = [cuando, c.alias, sistema.linea || pagador].filter(Boolean).join(' · ')

  return (
    <button
      id={`caso-${c.id}`}
      data-caso-id={c.id}
      type="button"
      onClick={() => onAbrir(c)}
      aria-label={`${cuando} · ${c.alias ?? 'sin cuenta'} · ${etiqueta} · ${montoDelCaso(c)}`}
      className={cn(
        'group relative block w-full text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-none',
        seleccionado && 'bg-white/[0.05]',
      )}
    >
      {/* Celular (y hasta 1279): tarjeta de 72 px con el filete del color. */}
      <span className="flex min-h-[72px] items-stretch gap-3 py-3 pr-4 pl-0 sm:pr-5 xl:hidden">
        <span aria-hidden className={cn('w-1 shrink-0 rounded-r-full', tono.solido)} />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="flex items-center justify-between gap-3">
            <span className={cn('flex min-w-0 items-center gap-1.5 text-sm font-medium', tono.texto)}>
              <IconoCaso caso={c} className="size-4 shrink-0" />
              <span className="truncate">{etiqueta}</span>
            </span>
            <span className="shrink-0 font-mono text-sm font-semibold text-zinc-100 tabular-nums">{montoDelCaso(c)}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{resumenMovil}</span>
        </span>
      </span>

      {/* Escritorio: la tabla. */}
      <span
        className={cn(
          'hidden min-h-14 items-center gap-3 px-5 py-2.5 xl:grid',
          multiDia ? COLUMNAS_MULTIDIA : COLUMNAS,
          seleccionado && 'shadow-[inset_3px_0_0_0_rgb(212_212_216/0.8)]',
        )}
      >
        <span className="font-mono text-[13px] text-zinc-400 tabular-nums">{cuando}</span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[13px] text-zinc-200">{c.alias ?? '—'}</span>
          {c.aliasMp && c.aliasMp !== c.alias && (
            <span className="block truncate text-[11px] text-amber-300">→ {c.aliasMp}</span>
          )}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-3">
          {c.esperados.length === 0 ? (
            <NoFigura texto={textoSinSistema(c)} />
          ) : (
            <>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-zinc-200">{sistema.linea}</span>
                {sistema.sub && <span className="block truncate text-[11px] text-muted-foreground">{sistema.sub}</span>}
              </span>
              <span className="shrink-0 font-mono text-[13px] text-zinc-100 tabular-nums">{plata(c.montoSistema)}</span>
            </>
          )}
        </span>
        <span
          aria-hidden
          className={cn(
            'text-center font-mono text-base',
            conector === '='
              ? 'text-emerald-400/80'
              : conector === '≠'
                ? 'text-amber-300'
                : conector === '≈'
                  ? 'text-zinc-300'
                  : 'text-zinc-500',
          )}
        >
          {conector}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-3">
          {!c.movimiento ? (
            <NoFigura texto={textoSinMovimiento(c)} />
          ) : (
            <>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-zinc-200">
                  {ajeno ? 'No parece un cobro' : (pagador ?? 'Sin nombre del pagador')}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                  {horaAR(c.movimiento.fecha)}
                  {c.estado === 'otra_cuenta' && c.aliasMp ? ` · en ${c.aliasMp}` : ''}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] text-zinc-100 tabular-nums">{plata(c.montoMp)}</span>
            </>
          )}
        </span>
        <span className="min-w-0" title={etiqueta}>
          <ChipCaso caso={c} corta />
        </span>
      </span>
    </button>
  )
}

function Vacio({
  pestana,
  filtrado,
  cuadran,
  confirmar,
  onLimpiar,
  onVerPestana,
}: {
  pestana: PestanaCasos
  filtrado: boolean
  cuadran: number
  confirmar: number
  onLimpiar: () => void
  onVerPestana: (p: PestanaCasos) => void
}) {
  const textos: Record<PestanaCasos, string> = {
    revisar: 'Nada para revisar en este período.',
    confirmar: 'No hay emparejamientos para confirmar en este período.',
    pendientes: 'No hay cobros ni transferencias esperando.',
    cuadran: 'Todavía no hay cobros que cuadren en este período.',
    revisados: 'Nadie marcó casos como revisados en este período.',
    sin_verificar: 'Todo lo cobrado tiene una cuenta conectada para verificar.',
    ajenos: 'No entró nada que no parezca un cobro.',
  }
  // Sin nada para revisar, lo próximo es lo que falta confirmar (antes que lo que ya cuadra).
  const siguiente =
    pestana !== 'revisar'
      ? null
      : confirmar > 0
        ? { pestana: 'confirmar' as const, texto: `Ver ${confirmar === 1 ? 'el que falta confirmar' : `los ${numero(confirmar)} para confirmar`}` }
        : cuadran > 0
          ? { pestana: 'cuadran' as const, texto: `Ver ${cuadran === 1 ? 'el que cuadra' : `los ${numero(cuadran)} que cuadran`}` }
          : null
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm text-muted-foreground">{filtrado ? 'No hay casos con estos filtros.' : textos[pestana]}</p>
      {filtrado ? (
        <Button variant="outline" size="sm" onClick={onLimpiar}>
          Limpiar los filtros
        </Button>
      ) : (
        siguiente && (
          <Button variant="outline" size="sm" onClick={() => onVerPestana(siguiente.pestana)}>
            {siguiente.texto}
          </Button>
        )
      )}
    </div>
  )
}

function ResumenAjenos({ cantidad, monto }: { cantidad: number; monto: number }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-8 text-sm">
      <p className="text-zinc-200">
        {plural(cantidad, 'movimiento')} no {cantidad === 1 ? 'parece' : 'parecen'} un cobro:{' '}
        <span className="font-mono tabular-nums">{plata(monto)}</span>.
      </p>
      <p className="text-muted-foreground">
        Son cobros con tarjeta o Point, rendimientos, devoluciones o transferencias fuera del horario del local. No cuentan en la conciliación y
        no se muestran con quién pagó.
      </p>
    </div>
  )
}
