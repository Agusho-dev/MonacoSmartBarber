'use client'

// El dibujo de los gráficos de Tex con recharts 3.7. Este archivo es el único
// que importa recharts y se carga con next/dynamic desde tex-grafico.tsx: el
// chat no baja ~180 KB hasta que aparece el primer gráfico.
//
// Recibe el gráfico ya preparado (bloques-formato.ts: colores, torta agrupada,
// escala) y medidas exactas en px (las mide tex-grafico.tsx sobre su
// contenedor), así no hace falta ResponsiveContainer.
//
// Colores siempre en hex: `var(--chart-x)` en un fill sale negro en algunos
// navegadores.

import { useId, type ReactElement } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type DotItemDotProps,
} from 'recharts'
import {
  abreviarEtiqueta,
  abreviarValor,
  COLOR_TEX,
  COLORES_PANTALLA,
  escalaDeGrafico,
  esNumero,
  etiquetaDeBarra,
  formateadorDeBarras,
  formatearValor,
  porcentajeDe,
  type GraficoListo,
} from './formato'
import { medirTexto, recortarTexto } from './medir'

export interface PropsGraficoRecharts {
  g: GraficoListo
  ancho: number
  alto: number
  animar: boolean
  /** Barras horizontales: cuántas filas se dibujan (el resto queda para la tabla o el Lienzo). */
  filas?: number
}

type Fila = Record<string, string | number | null>

const TAM = 11
const DURACION = 520

function filasDe(g: GraficoListo, hasta: number): Fila[] {
  return g.etiquetas.slice(0, hasta).map((etiqueta, i) => {
    const f: Fila = { etiqueta, i }
    g.series.forEach((s, k) => {
      f[`s${k}`] = s.valores[i]
    })
    return f
  })
}

function colorDe(g: GraficoListo, serie: number, i: number): string {
  if (g.series.length === 1 && g.coloresBarras) return g.coloresBarras[i] ?? g.series[0].color
  return g.series[serie]?.color ?? COLOR_TEX
}

/** Qué etiquetas del eje de categorías se ven: una cada `cada`, y la destacada siempre. */
function etiquetasVisibles(n: number, cada: number, destacar: number | null): Set<number> {
  const visibles = new Set<number>()
  for (let i = 0; i < n; i += cada) visibles.add(i)
  if (destacar != null && destacar < n && !visibles.has(destacar)) {
    for (const i of [...visibles]) if (Math.abs(i - destacar) < cada) visibles.delete(i)
    visibles.add(destacar)
  }
  return visibles
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip propio, oscuro, con la cifra completa
// ─────────────────────────────────────────────────────────────────────────────

interface PropsTooltip {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}

function TooltipTex({ active, payload, g }: PropsTooltip & { g: GraficoListo }) {
  if (!active || !payload?.length) return null
  const fila = (payload[0]?.payload ?? null) as Fila | null
  if (!fila) return null
  const i = typeof fila.i === 'number' ? fila.i : -1
  const total = g.porciones && g.total ? g.total : null
  // En la dona cada porción tiene su color (la serie no).
  const colorPunto = (k: number) => (g.dibujo === 'torta' ? (g.porciones?.[i]?.color ?? colorDe(g, k, i)) : colorDe(g, k, i))
  return (
    <div
      className="max-w-[260px] min-w-[150px] rounded-lg border px-3 py-2 text-[12px] leading-5 shadow-xl shadow-black/40"
      style={{ background: COLORES_PANTALLA.tooltipFondo, borderColor: COLORES_PANTALLA.tooltipBorde }}
    >
      <p className="mb-0.5 font-medium text-zinc-100">{String(fila.etiqueta ?? '')}</p>
      {g.series.map((s, k) => {
        const v = fila[`s${k}`]
        return (
          <div key={k} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5 text-zinc-400">
              <span className="size-2 shrink-0 rounded-full" style={{ background: colorPunto(k) }} />
              <span className="truncate">{s.nombre}</span>
            </span>
            <span className="font-mono text-zinc-100 tabular-nums">{esNumero(v) ? formatearValor(v, g.unidad) : '—'}</span>
          </div>
        )
      })}
      {total != null && esNumero(fila.s0) && (
        <p className="mt-0.5 text-zinc-400">{porcentajeDe(fila.s0, total)} del total</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// La barra: extremo redondeado del lado opuesto al cero, y su cifra afuera
// ─────────────────────────────────────────────────────────────────────────────

interface PropsBarra {
  p: BarShapeProps
  clave: string
  color: string
  horizontal: boolean
  texto: string | null
  tamTexto?: number
  destacada: boolean
}

function BarraTex({ p, clave, color, horizontal, texto, tamTexto = TAM, destacada }: PropsBarra): ReactElement {
  const v = (p.payload as Fila | undefined)?.[clave]
  if (!esNumero(v)) return <g />
  const x0 = Math.min(p.x, p.x + p.width)
  const w = Math.abs(p.width)
  const y0 = Math.min(p.y, p.y + p.height)
  const h = Math.abs(p.height)
  const negativo = v < 0
  const r = Math.max(0, Math.min(4, horizontal ? h / 2 : w / 2, horizontal ? w : h))

  // Se redondea sólo la punta (la que se aleja del cero): una barra negativa
  // termina abajo (o a la izquierda), y ahí va la curva.
  let d: string
  if (!horizontal && !negativo)
    d = `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h}Z`
  else if (!horizontal)
    d = `M${x0},${y0}V${y0 + h - r}Q${x0},${y0 + h} ${x0 + r},${y0 + h}H${x0 + w - r}Q${x0 + w},${y0 + h} ${x0 + w},${y0 + h - r}V${y0}Z`
  else if (!negativo)
    d = `M${x0},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h - r}Q${x0 + w},${y0 + h} ${x0 + w - r},${y0 + h}H${x0}Z`
  else
    d = `M${x0 + w},${y0}H${x0 + r}Q${x0},${y0} ${x0},${y0 + r}V${y0 + h - r}Q${x0},${y0 + h} ${x0 + r},${y0 + h}H${x0 + w}Z`

  let etiqueta: ReactElement | null = null
  if (texto) {
    const props = {
      fontSize: tamTexto,
      fill: destacada ? '#f4f4f5' : '#a1a1aa',
      fontWeight: destacada ? 600 : 400,
      style: { fontVariantNumeric: 'tabular-nums' as const },
    }
    etiqueta = horizontal ? (
      <text x={negativo ? x0 - 6 : x0 + w + 6} y={y0 + h / 2} dy="0.35em" textAnchor={negativo ? 'end' : 'start'} {...props}>
        {texto}
      </text>
    ) : (
      <text x={x0 + w / 2} y={negativo ? y0 + h + 13 : y0 - 6} textAnchor="middle" {...props}>
        {texto}
      </text>
    )
  }
  return (
    <g>
      {w > 0 && h > 0 && <path d={d} fill={color} />}
      {etiqueta}
    </g>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Barras verticales, líneas y áreas
// ─────────────────────────────────────────────────────────────────────────────

interface PropsTick {
  x?: number | string
  y?: number | string
  index?: number
}

function Verticales({ g, ancho, alto, animar }: PropsGraficoRecharts) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const n = g.etiquetas.length
  const datos = filasDe(g, n)
  const escala = escalaDeGrafico(g, 5)
  const anchoY = Math.ceil(Math.max(...escala.marcas.map((m) => medirTexto(abreviarValor(m, g.unidad), TAM)))) + 10

  const unaSerie = g.series.length === 1
  const anchoPlot = Math.max(40, ancho - anchoY - 8)
  const banda = anchoPlot / n
  // La cifra de cada barra: completa si entra; si no, la corta ("$8,9 M") y,
  // como último recurso, en 10 px. Si tampoco entra, no va (quedan el tooltip
  // y "Ver tabla"): una cifra encimada con la de al lado no se lee.
  const valores = unaSerie ? g.series[0].valores : []
  const formatoCompleto = formateadorDeBarras(valores, g.unidad)
  const formatoCorto = formateadorDeBarras(valores, g.unidad, true)
  const completas = valores.map((v) => (esNumero(v) ? formatoCompleto(v) : ''))
  const cortas = valores.map((v) => (esNumero(v) ? formatoCorto(v) : ''))
  const entra = (ts: string[], tam: number) => ts.length > 0 && Math.max(...ts.map((t) => medirTexto(t, tam, 600))) + 4 <= banda
  const opcion = [
    { textos: completas, tam: TAM },
    { textos: cortas, tam: TAM },
    { textos: cortas, tam: 10 },
  ].find((o) => entra(o.textos, o.tam))
  const conEtiquetas = g.dibujo === 'barras' && unaSerie && n <= 16 && opcion != null
  const textosValor = opcion?.textos ?? []
  const tamValor = opcion?.tam ?? TAM

  // Etiquetas del eje X: si no entran, primero se abrevian los meses y días
  // ("Sep"), después se recortan hasta ~64 px y, si igual no entran, una cada tanto.
  const etiquetasEje =
    Math.max(...g.etiquetas.map((t) => medirTexto(t, TAM))) + 8 > banda ? g.etiquetas.map(abreviarEtiqueta) : g.etiquetas
  const anchoMaxX = Math.max(...etiquetasEje.map((t) => medirTexto(t, TAM)))
  const cada = Math.max(1, Math.ceil((Math.min(anchoMaxX, 64) + 10) / banda))
  const visibles = etiquetasVisibles(n, cada, g.destacar)
  const anchoEtiquetaX = Math.max(banda * cada - 8, 28)
  const aireX = Math.min(32, Math.ceil(Math.min(anchoMaxX, anchoEtiquetaX) / 2) + 4)

  const margen = { top: conEtiquetas ? 22 : g.dibujo !== 'barras' && g.destacar != null ? 24 : 10, right: 8, bottom: 0, left: 0 }
  const contenido = { fill: COLORES_PANTALLA.eje, fontSize: TAM }

  const tickX = ({ x = 0, y = 0, index = 0 }: PropsTick): ReactElement => {
    if (!visibles.has(index)) return <g />
    const destacada = index === g.destacar
    const texto = etiquetasEje[index] ?? ''
    return (
      <text
        x={Number(x)}
        y={Number(y)}
        dy={12}
        textAnchor="middle"
        fontSize={TAM}
        fill={destacada ? COLORES_PANTALLA.texTexto : COLORES_PANTALLA.eje}
        fontWeight={destacada ? 600 : 400}
      >
        <title>{g.etiquetas[index] ?? ''}</title>
        {recortarTexto(texto, anchoEtiquetaX, TAM, destacada ? 600 : 400)}
      </text>
    )
  }

  const ejes = [
    <CartesianGrid key="grilla" vertical={false} stroke={COLORES_PANTALLA.grilla} strokeDasharray="3 3" />,
    <XAxis
      key="x"
      dataKey="etiqueta"
      interval={0}
      height={24}
      tickLine={false}
      axisLine={{ stroke: COLORES_PANTALLA.grilla }}
      tick={tickX}
      // En líneas y áreas el primer y el último punto caen en el borde: sin
      // este aire, la etiqueta del último día se corta a la mitad.
      padding={g.dibujo === 'barras' ? undefined : { left: aireX, right: aireX }}
    />,
    <YAxis
      key="y"
      type="number"
      domain={[escala.min, escala.max]}
      ticks={escala.marcas}
      width={anchoY}
      tickLine={false}
      axisLine={false}
      tick={contenido}
      tickFormatter={(v: number) => abreviarValor(v, g.unidad)}
    />,
    escala.min < 0 ? <ReferenceLine key="cero" y={0} stroke={COLORES_PANTALLA.cero} /> : null,
  ]

  if (g.dibujo === 'barras') {
    return (
      <BarChart width={ancho} height={alto} data={datos} margin={margen} barCategoryGap={unaSerie ? '22%' : '14%'} barGap={2}>
        {ejes}
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} isAnimationActive={false} content={(p) => <TooltipTex {...p} g={g} />} />
        {g.series.map((s, k) => (
          <Bar
            key={k}
            dataKey={`s${k}`}
            name={s.nombre}
            fill={s.color}
            maxBarSize={64}
            isAnimationActive={animar ? 'auto' : false}
            animationDuration={DURACION}
            shape={(p: BarShapeProps) => (
              <BarraTex
                p={p}
                clave={`s${k}`}
                color={colorDe(g, k, p.index)}
                horizontal={false}
                texto={conEtiquetas ? textosValor[p.index] || null : null}
                tamTexto={tamValor}
                destacada={p.index === g.destacar}
              />
            )}
          />
        ))}
      </BarChart>
    )
  }

  // Líneas y áreas: puntos chicos si hay pocos; el destacado, grande, en azul y con su cifra.
  const conPuntos = n <= 24
  function dibujarPunto(k: number, { cx, cy, index }: DotItemDotProps): ReactElement {
    const v = g.series[k]?.valores[index]
    if (!esNumero(v) || typeof cx !== 'number' || typeof cy !== 'number') return <g key={`p${k}-${index}`} />
    if (k === 0 && index === g.destacar) {
      return (
        <g key={`p${k}-${index}`}>
          <circle cx={cx} cy={cy} r={5} fill={COLOR_TEX} stroke="#0a0a0a" strokeWidth={2} />
          <text x={cx} y={cy - 11} textAnchor="middle" fontSize={TAM} fontWeight={600} fill="#f4f4f5">
            {etiquetaDeBarra(v, g.unidad)}
          </text>
        </g>
      )
    }
    if (!conPuntos) return <g key={`p${k}-${index}`} />
    return <circle key={`p${k}-${index}`} cx={cx} cy={cy} r={2.5} fill="#0a0a0a" stroke={g.series[k].color} strokeWidth={1.5} />
  }

  const tooltip = (
    <Tooltip
      cursor={{ stroke: '#404040', strokeWidth: 1 }}
      isAnimationActive={false}
      content={(p) => <TooltipTex {...p} g={g} />}
    />
  )

  if (g.dibujo === 'area') {
    return (
      <AreaChart width={ancho} height={alto} data={datos} margin={margen}>
        <defs>
          {g.series.map((s, k) => (
            <linearGradient key={k} id={`${id}-a${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={g.series.length > 1 ? 0.22 : 0.3} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ejes}
        {tooltip}
        {g.series.map((s, k) => (
          <Area
            key={k}
            type="monotone"
            dataKey={`s${k}`}
            name={s.nombre}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#${id}-a${k})`}
            connectNulls={false}
            dot={(p: DotItemDotProps) => dibujarPunto(k, p)}
            activeDot={{ r: 4, fill: s.color, stroke: '#0a0a0a', strokeWidth: 2 }}
            isAnimationActive={animar ? 'auto' : false}
            animationDuration={DURACION}
          />
        ))}
      </AreaChart>
    )
  }

  return (
    <LineChart width={ancho} height={alto} data={datos} margin={margen}>
      {ejes}
      {tooltip}
      {g.series.map((s, k) => (
        <Line
          key={k}
          type="monotone"
          dataKey={`s${k}`}
          name={s.nombre}
          stroke={s.color}
          strokeWidth={2}
          connectNulls={false}
          dot={(p: DotItemDotProps) => dibujarPunto(k, p)}
          activeDot={{ r: 4, fill: s.color, stroke: '#0a0a0a', strokeWidth: 2 }}
          isAnimationActive={animar ? 'auto' : false}
          animationDuration={DURACION}
        />
      ))}
    </LineChart>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Barras horizontales (rankings y la torta en lo angosto)
// ─────────────────────────────────────────────────────────────────────────────

function Horizontales({ g, ancho, alto, animar, filas }: PropsGraficoRecharts) {
  const visibles = Math.min(filas ?? g.etiquetas.length, g.etiquetas.length)
  const datos = filasDe(g, visibles)
  const k = g.series.length
  const conCifras = k <= 2

  // Un solo formato para todas las barras del ranking ("$120 mil" y "$80 mil", no "$80.000").
  const formato = formateadorDeBarras(g.series.flatMap((s) => s.valores.slice(0, visibles)), g.unidad)
  const texto = (si: number, i: number): string => {
    const v = g.series[si].valores[i]
    if (!esNumero(v)) return ''
    if (g.porciones && g.total) return `${formato(v)} · ${porcentajeDe(v, g.total)}`
    return formato(v)
  }
  let anchoValor = 0
  if (conCifras) for (let si = 0; si < k; si++) for (let i = 0; i < visibles; i++) anchoValor = Math.max(anchoValor, medirTexto(texto(si, i), TAM, 600))
  anchoValor = Math.ceil(anchoValor) + 12

  const anchoEtiquetas = Math.round(
    Math.min(ancho * 0.4, Math.max(56, Math.max(...g.etiquetas.slice(0, visibles).map((t) => medirTexto(t, 12))) + 14)),
  )

  // Sin eje de valores (cada barra lleva su cifra): la escala sale de los datos
  // y la barra más larga llena el ancho. Con negativos, se reserva lugar a la
  // izquierda para la cifra de la barra que va para ese lado.
  const valores = g.series.flatMap((s) => s.valores.slice(0, visibles)).filter(esNumero)
  let lo = Math.min(0, ...valores)
  const hi = Math.max(0, ...valores)
  // Todo en cero: un rango mínimo para que el eje no quede de ancho 0.
  const techo = hi === lo ? lo + 1 : hi
  if (lo < 0 && conCifras) {
    const plot = Math.max(40, ancho - anchoEtiquetas - anchoValor)
    const rango = hi - lo || 1
    lo -= (anchoValor / Math.max(1, plot - anchoValor)) * rango
  }

  const tickY = ({ x = 0, y = 0, index = 0 }: PropsTick): ReactElement => {
    const destacada = index === g.destacar
    const etiqueta = g.etiquetas[index] ?? ''
    return (
      <text
        x={Number(x) - 4}
        y={Number(y)}
        dy="0.35em"
        textAnchor="end"
        fontSize={12}
        fill={destacada ? '#f4f4f5' : '#a1a1aa'}
        fontWeight={destacada ? 600 : 400}
      >
        <title>{etiqueta}</title>
        {recortarTexto(etiqueta, anchoEtiquetas - 12, 12, destacada ? 600 : 400)}
      </text>
    )
  }

  return (
    <BarChart
      layout="vertical"
      width={ancho}
      height={alto}
      data={datos}
      margin={{ top: 2, right: conCifras ? anchoValor : 8, bottom: 2, left: 0 }}
      barCategoryGap={k === 1 ? '20%' : '12%'}
      barGap={2}
    >
      <XAxis type="number" hide domain={[lo, techo]} />
      <YAxis type="category" dataKey="etiqueta" width={anchoEtiquetas} interval={0} tickLine={false} axisLine={false} tick={tickY} />
      {lo < 0 ? <ReferenceLine x={0} stroke={COLORES_PANTALLA.cero} /> : null}
      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} isAnimationActive={false} content={(p) => <TooltipTex {...p} g={g} />} />
      {g.series.map((s, si) => (
        <Bar
          key={si}
          dataKey={`s${si}`}
          name={s.nombre}
          fill={s.color}
          isAnimationActive={animar ? 'auto' : false}
          animationDuration={DURACION}
          shape={(p: BarShapeProps) => (
            <BarraTex
              p={p}
              clave={`s${si}`}
              color={colorDe(g, si, p.index)}
              horizontal
              texto={conCifras ? texto(si, p.index) || null : null}
              destacada={p.index === g.destacar}
            />
          )}
        />
      ))}
    </BarChart>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Torta (dona) con su leyenda: sólo donde hay ancho
// ─────────────────────────────────────────────────────────────────────────────

function Dona({ g, ancho, alto, animar }: PropsGraficoRecharts) {
  const porciones = g.porciones ?? []
  const total = g.total ?? 0
  const lado = Math.max(120, Math.min(alto, 200, Math.round(ancho * 0.4)))
  const datos: Fila[] = porciones.map((p, i) => ({ etiqueta: p.nombre, i, s0: p.valor }))
  return (
    <div className="flex h-full items-center gap-5">
      <div className="relative shrink-0" style={{ width: lado, height: lado }}>
        {/* El total va ANTES que la dona: así el tooltip (que vive adentro del gráfico) le pasa por encima. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Total</span>
          <span className="font-mono text-[15px] font-semibold text-foreground tabular-nums">{abreviarValor(total, g.unidad)}</span>
        </div>
        <PieChart width={lado} height={lado}>
          <Tooltip isAnimationActive={false} content={(p) => <TooltipTex {...p} g={g} />} />
          <Pie
            data={datos}
            dataKey="s0"
            nameKey="etiqueta"
            innerRadius={Math.round(lado * 0.33)}
            outerRadius={Math.round(lado * 0.48)}
            paddingAngle={porciones.length > 1 ? 1.5 : 0}
            startAngle={90}
            endAngle={-270}
            stroke="#0a0a0a"
            strokeWidth={2}
            isAnimationActive={animar ? 'auto' : false}
            animationDuration={DURACION}
          >
            {porciones.map((p, i) => (
              <Cell key={i} fill={p.color} />
            ))}
          </Pie>
        </PieChart>
      </div>
      <ul className="min-w-0 flex-1 space-y-2" aria-label="Porciones">
        {porciones.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px] leading-5">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className={p.destacada ? 'min-w-0 flex-1 truncate font-medium text-foreground' : 'min-w-0 flex-1 truncate text-zinc-300'} title={p.nombre}>
              {p.nombre}
            </span>
            <span className="hidden font-mono text-[12px] text-muted-foreground tabular-nums @lg:inline">{formatearValor(p.valor, g.unidad)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-[12px] font-medium text-zinc-200 tabular-nums">
              {porcentajeDe(p.valor, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function GraficoRecharts(props: PropsGraficoRecharts) {
  if (props.g.dibujo === 'torta') return <Dona {...props} />
  if (props.g.dibujo === 'barras_horizontales') return <Horizontales {...props} />
  return <Verticales {...props} />
}
