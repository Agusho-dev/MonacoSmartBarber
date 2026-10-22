// =============================================================================
// src/lib/tex/bloques-formato.ts
// Cómo se dibujan los números de Tex: el formato de cada unidad, la paleta de
// los gráficos y el armado de cada gráfico (qué serie va en gris, cuál en el
// azul de Tex, cómo se agrupa una torta, dónde caen las marcas del eje).
//
// Lo comparten la pantalla (src/components/tex/bloques/*) y el PDF
// (src/lib/tex/pdf-dibujo.ts): una sola fuente, así el informe que se manda por
// WhatsApp y el chat dicen exactamente lo mismo, con los mismos colores.
//
// PURO a propósito: sin React, sin DOM y sin imports de runtime (sólo
// `import type`), para que las pruebas lo corran con node sin compilar nada.
// =============================================================================

import type { TexGrafico, TexTabla, TexUnidad } from './contrato'

// ─────────────────────────────────────────────────────────────────────────────
// Paleta
// ─────────────────────────────────────────────────────────────────────────────

/** El azul de Tex en hex (oklch(0.66 0.16 246) aproximado): recharts y jsPDF no leen oklch. */
export const COLOR_TEX = '#2b8fe6'
/** Una sola serie: neutra. El color se reserva para lo que el texto destaca. */
export const COLOR_NEUTRO = '#a1a1aa'
/** Varias series. Validada contra el fondo #0a0a0a (y se lee bien en papel). */
export const PALETA_SERIES = ['#2b8fe6', '#f59e0b', '#10b981', '#e879f9', '#f87171', '#a78bfa'] as const
/** La porción "Otros" de una torta: siempre al final y apagada. */
export const COLOR_OTROS = '#52525b'
/**
 * Torta con una porción destacada: el resto en grises, uno distinto por
 * porción (de la más grande, más clara, a la más chica), así la leyenda no
 * tiene dos colores iguales. "Otros" va con el más oscuro.
 */
const GRISES_TORTA = ['#d4d4d8', '#a1a1aa', '#71717a', '#5b5b63'] as const
const GRIS_OTROS_CON_DESTACADA = '#3f3f46'

/** Ejes, grilla y tooltip de los gráficos en pantalla (siempre oscura). */
export const COLORES_PANTALLA = {
  eje: '#737373',
  grilla: '#262626',
  cero: '#525252',
  tooltipFondo: '#171717',
  tooltipBorde: '#333333',
  /** --tex-texto (oklch(0.78 0.11 245)) en hex: la etiqueta destacada del eje. */
  texTexto: '#78bff9',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Números
// ─────────────────────────────────────────────────────────────────────────────

const ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const UN_DECIMAL = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const DOS_DECIMALES = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

// Espacio duro entre la cifra y su unidad ("32 %", "45 min"): que el renglón
// nunca corte entre el número y lo que significa. Existe en WinAnsi, así que
// el PDF también lo dibuja.
const NBSP = '\u00a0'

export function esNumero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * El signo va adelante de todo y es el guion común: "-$1.234". El signo menos
 * tipográfico (U+2212) no existe en la fuente del PDF (WinAnsi) y una cifra
 * copiada con él no la entiende una planilla.
 */
function signo(v: number): string {
  return v < 0 ? '-' : ''
}

/**
 * La cifra completa, como se lee en un tooltip, una tabla o el PDF.
 *   pesos       $1.234.000 · -$18.000
 *   porcentaje  32 % · 12,5 %   (en puntos: 32 = 32 %)
 *   cantidad    1.234 · 108,4
 *   minutos     32 min
 */
export function formatearValor(v: number, unidad: TexUnidad): string {
  if (!esNumero(v)) return '—'
  const abs = Math.abs(v)
  switch (unidad) {
    case 'pesos':
      return `${signo(v)}$${ENTERO.format(abs)}`
    case 'porcentaje':
      return `${signo(v)}${UN_DECIMAL.format(abs)}${NBSP}%`
    case 'minutos':
      return `${signo(v)}${(Number.isInteger(abs) ? ENTERO : UN_DECIMAL).format(abs)}${NBSP}min`
    case 'cantidad':
    default:
      return `${signo(v)}${(Number.isInteger(abs) ? ENTERO : UN_DECIMAL).format(abs)}`
  }
}

/**
 * Para las marcas del eje: corto. "$1,2 M", "$350 mil", "32 %". Con dos
 * decimales como máximo en los millones: una marca en $1,25 M no puede decir
 * "$1,3 M" (el eje mentiría).
 */
export function abreviarValor(v: number, unidad: TexUnidad): string {
  if (!esNumero(v)) return ''
  const abs = Math.abs(v)
  const s = signo(v)
  if (unidad === 'pesos') {
    if (abs >= 1_000_000) return `${s}$${DOS_DECIMALES.format(abs / 1_000_000)}${NBSP}M`
    if (abs >= 1_000) return `${s}$${DOS_DECIMALES.format(abs / 1_000)}${NBSP}mil`
    return `${s}$${ENTERO.format(abs)}`
  }
  if (unidad === 'cantidad') {
    if (abs >= 1_000_000) return `${s}${DOS_DECIMALES.format(abs / 1_000_000)}${NBSP}M`
    if (abs >= 10_000) return `${s}${DOS_DECIMALES.format(abs / 1_000)}${NBSP}mil`
    return formatearValor(v, unidad)
  }
  return formatearValor(v, unidad)
}

/**
 * La cifra pegada a una barra: legible de un vistazo pero sin redondear tanto
 * que dos barberos con $2,34 M y $2,31 M parezcan empatados.
 */
export function etiquetaDeBarra(v: number, unidad: TexUnidad): string {
  if (!esNumero(v)) return ''
  if (unidad === 'pesos') {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `${signo(v)}$${DOS_DECIMALES.format(abs / 1_000_000)}${NBSP}M`
    if (abs >= 100_000) return `${signo(v)}$${ENTERO.format(abs / 1_000)}${NBSP}mil`
  }
  return formatearValor(v, unidad)
}

/**
 * Un mismo formato para todas las cifras de un gráfico: si una barra dice
 * "$120 mil", la de al lado no puede decir "$80.000". La escala la decide la
 * cifra más grande (en valor absoluto).
 *   corto: un decimal en los millones (cuando la completa no entra).
 */
export function formateadorDeBarras(valores: (number | null)[], unidad: TexUnidad, corto = false): (v: number) => string {
  const max = Math.max(0, ...valores.filter(esNumero).map((v) => Math.abs(v)))
  if (unidad === 'pesos' && (max >= 100_000 || (corto && max >= 10_000))) {
    return (v) => {
      if (!esNumero(v)) return ''
      const abs = Math.abs(v)
      if (abs >= 1_000_000) return `${signo(v)}$${(corto ? UN_DECIMAL : DOS_DECIMALES).format(abs / 1_000_000)}${NBSP}M`
      if (abs >= 1_000) return `${signo(v)}$${ENTERO.format(abs / 1_000)}${NBSP}mil`
      return formatearValor(v, unidad)
    }
  }
  if (unidad === 'cantidad' && (max >= 100_000 || (corto && max >= 10_000))) {
    return (v) => {
      if (!esNumero(v)) return ''
      const abs = Math.abs(v)
      if (abs >= 1_000_000) return `${signo(v)}${UN_DECIMAL.format(abs / 1_000_000)}${NBSP}M`
      if (abs >= 1_000) return `${signo(v)}${UN_DECIMAL.format(abs / 1_000)}${NBSP}mil`
      return formatearValor(v, unidad)
    }
  }
  return (v) => formatearValor(v, unidad)
}

const MESES: Record<string, string> = {
  enero: 'Ene', febrero: 'Feb', marzo: 'Mar', abril: 'Abr', mayo: 'May', junio: 'Jun', julio: 'Jul',
  agosto: 'Ago', septiembre: 'Sep', setiembre: 'Sep', octubre: 'Oct', noviembre: 'Nov', diciembre: 'Dic',
}
const DIAS: Record<string, string> = {
  lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom',
}

/**
 * Meses y días con nombre completo ("Septiembre 2026", "Sábado") en tres
 * letras, para el eje de un gráfico angosto: es mejor "Sep" que saltear la
 * etiqueta o cortarla en "Septie…". Lo demás queda igual.
 */
export function abreviarEtiqueta(texto: string): string {
  return texto.replace(/\p{L}+/gu, (palabra) => {
    const clave = palabra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const corta = MESES[clave] ?? DIAS[clave]
    if (!corta) return palabra
    return palabra[0] === palabra[0].toLowerCase() ? corta.toLowerCase() : corta
  })
}

/** "32 %" de una parte sobre el total (con un decimal por debajo de 10 %). */
export function porcentajeDe(parte: number, total: number): string {
  if (!esNumero(parte) || !esNumero(total) || total === 0) return '—'
  const p = (parte / total) * 100
  const f = Math.abs(p) < 10 ? UN_DECIMAL : ENTERO
  return `${f.format(p)}${NBSP}%`
}

// ─────────────────────────────────────────────────────────────────────────────
// Escala del eje: marcas redondas
// ─────────────────────────────────────────────────────────────────────────────

export interface Escala {
  min: number
  max: number
  marcas: number[]
}

/**
 * Marcas "lindas" (0, 250 mil, 500 mil…) entre min y max. La usan la pantalla
 * y el PDF, así los dos ejes dicen lo mismo.
 *   incluirCero: barras y áreas arrancan en 0 (la altura ES el dato); las
 *                líneas no, para que se vea la variación.
 *   enteros:     una cantidad de cortes no tiene marcas en 0,5.
 *
 * Prueba pasos de 1, 2, 2,5 y 5 (× 10ⁿ) y se queda con el que da cerca de
 * `marcas` marcas desperdiciando menos alto: con sólo 1-2-5, un -$1,35 M
 * obligaba a un eje hasta -$5 M y un cuarto del gráfico quedaba vacío.
 */
export function escalaLinda(
  valores: number[],
  { incluirCero, enteros = false, marcas = 5 }: { incluirCero: boolean; enteros?: boolean; marcas?: number },
): Escala {
  const finitos = valores.filter(esNumero)
  let min = finitos.length ? Math.min(...finitos) : 0
  let max = finitos.length ? Math.max(...finitos) : 1
  if (incluirCero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  if (min === max) {
    // Un solo valor (o todos iguales): se abre un margen para que la serie no
    // quede pegada al borde ni el rango dé cero.
    const delta = min === 0 ? 1 : Math.abs(min) * 0.2
    if (incluirCero && min >= 0) max = min + delta
    else if (incluirCero && max <= 0) min = max - delta
    else {
      min -= delta
      max += delta
    }
  }
  const rango = max - min
  const exp = Math.floor(Math.log10(rango / Math.max(1, marcas - 1)))
  let mejor: { lo: number; hi: number; paso: number; puntaje: number } | null = null
  for (let e = exp - 1; e <= exp + 1; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const paso = m * 10 ** e
      if (enteros && paso < 1) continue
      if (m === 2.5 && enteros && paso < 10) continue
      const lo = Math.floor(min / paso + 1e-9) * paso
      const hi = Math.ceil(max / paso - 1e-9) * paso
      const cantidad = Math.round((hi - lo) / paso) + 1
      if (cantidad < 3 || cantidad > 8) continue
      const puntaje = Math.abs(cantidad - marcas) + ((hi - lo) / rango - 1) * 4
      if (!mejor || puntaje < mejor.puntaje - 1e-9) mejor = { lo, hi, paso, puntaje }
    }
  }
  // Enteros con un rango de 1 (todo en cero, quejas 0 y 1, líneas entre 5 y 6):
  // ningún paso redondo da 3 marcas y el respaldo fraccionario escribía
  // "0 | 0,3 | 0,5" cortes o, en pesos, "$0 | $0 | $1 | $1". Con enteros, paso
  // 1 aunque queden sólo 2 marcas: un eje con menos marcas no miente.
  if (!mejor && enteros) {
    const lo = Math.floor(min + 1e-9)
    mejor = { lo, hi: Math.max(Math.ceil(max - 1e-9), lo + 1), paso: 1, puntaje: 0 }
  }
  const { lo, hi, paso } = mejor ?? { lo: min, hi: max, paso: rango / Math.max(1, marcas - 1) }
  const decimales = Math.min(10, Math.max(0, -Math.floor(Math.log10(paso)) + 1))
  const lista: number[] = []
  for (let i = 0; i <= Math.round((hi - lo) / paso) && i < 12; i++) lista.push(Number((lo + i * paso).toFixed(decimales)))
  return { min: lista[0], max: lista[lista.length - 1], marcas: lista }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gráficos: de TexGrafico (lo que manda el modelo) a algo que se puede dibujar
// ─────────────────────────────────────────────────────────────────────────────

export type TipoDibujo = 'barras' | 'barras_horizontales' | 'lineas' | 'area' | 'torta'

export interface SerieLista {
  nombre: string
  /** Un valor por etiqueta; null = no hay dato (la línea se corta, la barra no se dibuja). */
  valores: (number | null)[]
  color: string
}

export interface PorcionTorta {
  nombre: string
  valor: number
  /** 0–100 */
  porcentaje: number
  color: string
  esOtros: boolean
  destacada: boolean
}

export interface GraficoListo {
  titulo: string
  /** Lo que se pidió. */
  tipo: TexGrafico['tipo']
  /** Cómo se dibuja de verdad: la torta pasa a barras horizontales en lo angosto y en el PDF. */
  dibujo: TipoDibujo
  unidad: TexUnidad
  etiquetas: string[]
  series: SerieLista[]
  /** Una sola serie de barras: el color de cada barra (gris; la destacada, azul de Tex). */
  coloresBarras: string[] | null
  destacar: number | null
  /** Torta (o torta pasada a barras): porciones ordenadas, "Otros" al final. */
  porciones: PorcionTorta[] | null
  total: number | null
  hayNegativos: boolean
  /** Todos los valores son enteros: el eje no lleva marcas con coma. */
  enteros: boolean
  nota: string | null
  /** Sin un solo dato dibujable. */
  vacio: boolean
}

/** Porciones que se ven en una torta antes de agrupar el resto en "Otros". */
export const MAX_PORCIONES = 5
const MAX_SERIES = 6

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
}

/**
 * Normaliza lo que llega (lo arma el modelo: puede venir con series de largo
 * distinto, NaN o un `destacar` fuera de rango) y decide cómo se dibuja.
 *   estrecho: true en pantallas angostas y en el PDF → la torta se dibuja como
 *             barras horizontales ordenadas, con su porcentaje.
 */
export function prepararGrafico(g: TexGrafico, { estrecho = false }: { estrecho?: boolean } = {}): GraficoListo {
  const etiquetas = (Array.isArray(g?.etiquetas) ? g.etiquetas : []).map(texto)
  const n = etiquetas.length
  const seriesCrudas = (Array.isArray(g?.series) ? g.series : []).slice(0, MAX_SERIES)
  const unidad: TexUnidad = (['pesos', 'cantidad', 'porcentaje', 'minutos'] as const).includes(g?.unidad)
    ? g.unidad
    : 'cantidad'
  const tipo: TexGrafico['tipo'] = (['barras', 'barras_horizontales', 'lineas', 'area', 'torta'] as const).includes(g?.tipo)
    ? g.tipo
    : 'barras'

  const series: SerieLista[] = seriesCrudas.map((s, i) => {
    const valores = Array.isArray(s?.valores) ? s.valores : []
    return {
      nombre: texto(s?.nombre) || `Serie ${i + 1}`,
      valores: Array.from({ length: n }, (_, j) => (esNumero(valores[j]) ? valores[j] : null)),
      color: PALETA_SERIES[i % PALETA_SERIES.length],
    }
  })

  const destacar =
    typeof g?.destacar === 'number' && Number.isInteger(g.destacar) && g.destacar >= 0 && g.destacar < n ? g.destacar : null
  const todos = series.flatMap((s) => s.valores).filter(esNumero)
  const base: GraficoListo = {
    titulo: texto(g?.titulo),
    tipo,
    dibujo: tipo,
    unidad,
    etiquetas,
    series,
    coloresBarras: null,
    destacar,
    porciones: null,
    total: null,
    hayNegativos: todos.some((v) => v < 0),
    enteros: todos.every((v) => Number.isInteger(v)),
    nota: texto(g?.nota) || null,
    vacio: n === 0 || series.length === 0 || todos.length === 0,
  }
  if (base.vacio) return base

  if (tipo === 'torta') return prepararTorta(base, estrecho)

  // Una sola serie: neutra, con la etiqueta de la que habla el texto en azul.
  // Varias series: cada una con su color (la primera es el azul de Tex).
  if (series.length === 1) {
    series[0].color = COLOR_NEUTRO
    base.coloresBarras = etiquetas.map((_, i) => (i === destacar ? COLOR_TEX : COLOR_NEUTRO))
  }
  return base
}

function prepararTorta(base: GraficoListo, estrecho: boolean): GraficoListo {
  const serie = base.series[0]
  const items = base.etiquetas
    .map((nombre, i) => ({ nombre, valor: serie.valores[i], i }))
    .filter((x): x is { nombre: string; valor: number; i: number } => esNumero(x.valor))

  // Con un negativo no hay "parte de un total": se muestra como ranking de
  // barras, ordenado, sin porcentajes.
  if (items.some((x) => x.valor < 0)) {
    const orden = [...items].sort((a, b) => b.valor - a.valor)
    return {
      ...base,
      dibujo: 'barras_horizontales',
      etiquetas: orden.map((x) => x.nombre),
      series: [{ ...serie, color: COLOR_NEUTRO, valores: orden.map((x) => x.valor) }],
      coloresBarras: orden.map((x) => (x.i === base.destacar ? COLOR_TEX : COLOR_NEUTRO)),
      destacar: orden.findIndex((x) => x.i === base.destacar) >= 0 ? orden.findIndex((x) => x.i === base.destacar) : null,
    }
  }

  // Las porciones en 0 no se ven en una torta y no suman nada a la lectura.
  const positivos = items.filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor)
  const total = positivos.reduce((acc, x) => acc + x.valor, 0)
  if (positivos.length === 0 || total <= 0) return { ...base, vacio: true }

  // Más de 5 porciones: se quedan las 4 más grandes y el resto va a "Otros".
  // La destacada nunca se esconde en "Otros" (es justo la que el texto nombra).
  let visibles = positivos
  let resto: typeof positivos = []
  if (positivos.length > MAX_PORCIONES) {
    visibles = positivos.slice(0, MAX_PORCIONES - 1)
    resto = positivos.slice(MAX_PORCIONES - 1)
    const idx = resto.findIndex((x) => x.i === base.destacar)
    if (idx >= 0) {
      const [dest] = resto.splice(idx, 1)
      resto.unshift(visibles.pop()!)
      visibles.push(dest)
      visibles.sort((a, b) => b.valor - a.valor)
    }
  }

  const hayDestacada = visibles.some((x) => x.i === base.destacar)
  let gris = 0
  const porciones: PorcionTorta[] = visibles.map((x, k) => {
    const destacada = x.i === base.destacar
    const color = hayDestacada
      ? destacada
        ? COLOR_TEX
        : GRISES_TORTA[gris++ % GRISES_TORTA.length]
      : PALETA_SERIES[k % PALETA_SERIES.length]
    return { nombre: x.nombre, valor: x.valor, porcentaje: (x.valor / total) * 100, color, esOtros: false, destacada }
  })
  if (resto.length > 0) {
    const valor = resto.reduce((acc, x) => acc + x.valor, 0)
    porciones.push({
      nombre: resto.length === 1 ? resto[0].nombre : `Otros (${resto.length})`,
      valor,
      porcentaje: (valor / total) * 100,
      color: hayDestacada ? GRIS_OTROS_CON_DESTACADA : COLOR_OTROS,
      esOtros: resto.length > 1,
      destacada: false,
    })
  }

  if (!estrecho) {
    return { ...base, dibujo: 'torta', porciones, total }
  }
  // Angosto (celular, PDF): barras horizontales ordenadas. Una barra no
  // necesita colores para separarse de la vecina: gris, y la destacada en azul.
  const destacarEnBarras = porciones.findIndex((p) => p.destacada)
  return {
    ...base,
    dibujo: 'barras_horizontales',
    porciones,
    total,
    etiquetas: porciones.map((p) => p.nombre),
    series: [{ ...serie, color: COLOR_NEUTRO, valores: porciones.map((p) => p.valor) }],
    coloresBarras: porciones.map((p) => (p.destacada ? COLOR_TEX : p.esOtros ? COLOR_OTROS : COLOR_NEUTRO)),
    destacar: destacarEnBarras >= 0 ? destacarEnBarras : null,
  }
}

/** Escala del eje de valores según cómo se dibuja (barras y áreas desde 0). */
export function escalaDeGrafico(g: GraficoListo, marcas = 5): Escala {
  const valores = g.series.flatMap((s) => s.valores).filter(esNumero)
  // Una barra negativa lleva su cifra DEBAJO: sin un poco de aire bajo la más
  // larga, la cifra se pisaría con las etiquetas del eje.
  const min = valores.length ? Math.min(...valores) : 0
  if (g.dibujo === 'barras' && min < 0) valores.push(min * 1.12)
  return escalaLinda(valores, {
    incluirCero: g.dibujo !== 'lineas',
    // Los pesos se escriben sin decimales: con un paso de $0,25 las marcas
    // dirían "$0 | $0 | $1", aunque los datos traigan centavos.
    enteros: (g.enteros || g.unidad === 'pesos') && g.unidad !== 'porcentaje',
    marcas,
  })
}

/**
 * Los mismos datos del gráfico como tabla (el botón "Ver tabla" y la
 * accesibilidad). La torta muestra TODAS las porciones con su porcentaje, no
 * sólo las que entraron en el dibujo.
 */
export function tablaDeGrafico(g: TexGrafico): TexTabla {
  const listo = prepararGrafico(g)
  if (listo.tipo === 'torta' && !listo.hayNegativos) {
    const serie = listo.series[0]
    const filas = listo.etiquetas
      .map((e, i) => ({ e, v: serie?.valores[i] ?? null }))
      .filter((x): x is { e: string; v: number } => esNumero(x.v))
      .sort((a, b) => b.v - a.v)
    const total = filas.reduce((acc, x) => acc + Math.max(0, x.v), 0)
    return {
      titulo: listo.titulo,
      columnas: ['', serie?.nombre ?? 'Valor', '%'],
      filas: filas.map((x) => [x.e, formatearValor(x.v, listo.unidad), porcentajeDe(x.v, total)]),
      alinear: ['izq', 'der', 'der'],
    }
  }
  return {
    titulo: listo.titulo,
    columnas: ['', ...listo.series.map((s) => s.nombre)],
    filas: listo.etiquetas.map((e, i) => [e, ...listo.series.map((s) => (esNumero(s.valores[i]) ? formatearValor(s.valores[i] as number, listo.unidad) : null))]),
    alinear: ['izq', ...listo.series.map(() => 'der' as const)],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablas
// ─────────────────────────────────────────────────────────────────────────────

// "$1.234", "-$500", "US$ 20", "32 %", "+12,5 %", "1.234", "108,4", "45 min", "3,2 M".
const PARECE_NUMERO =
  /^[+\-−–]?\s?(?:US\$|\$|€|R\$)?\s?\d{1,3}(?:[.\s\u00a0]\d{3})*(?:,\d+)?(?:\s?(?:%|min|h|hs|k|M|mil|x))?$|^[+\-−–]?\s?(?:US\$|\$|€)?\s?\d+(?:[.,]\d+)?(?:\s?(?:%|min|h|hs|k|M|mil|x))?$/i

export function pareceNumero(v: string | number | null | undefined): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v !== 'string') return false
  const s = v.trim()
  return s.length > 0 && s.length <= 24 && PARECE_NUMERO.test(s)
}

/**
 * Cómo se escriben los números de una columna:
 *   'numero'         monto o cantidad, con separador de miles ("1.234").
 *   'identificador'  año, DNI, teléfono, id, código: tal cual ("2026").
 */
export type FormatoColumna = 'numero' | 'identificador'

// Encabezados de columnas que identifican algo (consulta_sql devuelve los
// números crudos de la base: `anio`, `dni`, `cliente_id`, `extract`…).
const PALABRAS_IDENTIFICADOR = new Set([
  'anio', 'ano', 'year', 'dni', 'cuit', 'cuil', 'tel', 'telefono', 'phone', 'celular', 'whatsapp',
  'id', 'uuid', 'codigo', 'cod', 'code', 'nro', 'cbu', 'cvu', 'legajo', 'documento',
])

// Encabezados de plata o de cantidades: "Cortes" con 1.950 y 2.010 sigue
// siendo una cantidad aunque sus números parezcan años.
const PALABRAS_MAGNITUD = new Set([
  'total', 'totales', 'monto', 'montos', 'importe', 'importes', 'ingreso', 'ingresos', 'egreso', 'egresos',
  'gasto', 'gastos', 'pesos', 'precio', 'precios', 'facturacion', 'facturado', 'venta', 'ventas', 'saldo',
  'costo', 'costos', 'sueldo', 'sueldos', 'comision', 'comisiones', 'propina', 'propinas', 'cobrado', 'cobros',
  'pagos', 'pagado', 'pendiente', 'acumulado', 'deuda', 'neto', 'bruto', 'tarifa', 'valor', 'valores', 'ticket',
  'promedio', 'media', 'mediana', 'maximo', 'minimo', 'suma', 'resultado', 'corte', 'cortes', 'clientes',
  'visitas', 'turnos', 'cantidad', 'veces', 'servicios', 'puntos', 'minutos', 'mensajes', 'respuestas',
  'atenciones', 'transferencias', 'count', 'sum', 'avg', 'amount', 'revenue',
])

function palabrasDeEncabezado(texto: string): string[] {
  return String(texto ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * El formato de cada columna. Un año con separador de miles se lee como una
 * cantidad ("2.026"), igual un DNI o un id. Lo dice el encabezado: un `_id`
 * al final ("cliente_id") o, si no, la primera palabra que decide ("Año de
 * alta" es un año; "Cortes por año", una cantidad). Si el encabezado no dice
 * nada, una columna cuyos números son TODOS enteros entre 1900 y 2100 es de años.
 */
export function formatosDeTabla(t: Pick<TexTabla, 'columnas' | 'filas'>): FormatoColumna[] {
  const columnas = Array.isArray(t?.columnas) ? t.columnas : []
  const filas = Array.isArray(t?.filas) ? t.filas : []
  return columnas.map((c, j) => {
    const palabras = palabrasDeEncabezado(c)
    const ultima = palabras[palabras.length - 1]
    if (ultima === 'id' || ultima === 'uuid') return 'identificador'
    for (const p of palabras) {
      if (PALABRAS_IDENTIFICADOR.has(p)) return 'identificador'
      if (PALABRAS_MAGNITUD.has(p)) return 'numero'
    }
    let hayAnios = false
    for (const fila of filas) {
      const v = Array.isArray(fila) ? fila[j] : null
      if (typeof v !== 'number') continue
      if (!Number.isInteger(v) || v < 1900 || v > 2100) return 'numero'
      hayAnios = true
    }
    return hayAnios ? 'identificador' : 'numero'
  })
}

/** La celda como se muestra: número con miles (salvo un año, un DNI o un id); vacío como raya. */
export function textoDeCelda(v: string | number | null | undefined, formato: FormatoColumna = 'numero'): string {
  if (v == null) return '—'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    if (formato === 'identificador' && Number.isInteger(v)) return String(v)
    return Number.isInteger(v) ? ENTERO.format(v) : DOS_DECIMALES.format(v)
  }
  const s = String(v)
  return s.trim() === '' ? '—' : s
}

/** Alineación por columna: la que manda la herramienta, o números a la derecha. */
export function alineacionesDeTabla(t: TexTabla): ('izq' | 'der')[] {
  const columnas = Array.isArray(t?.columnas) ? t.columnas : []
  const filas = Array.isArray(t?.filas) ? t.filas : []
  return columnas.map((_, j) => {
    const pedida = t.alinear?.[j]
    if (pedida === 'izq' || pedida === 'der') return pedida
    let hay = false
    for (const fila of filas) {
      const c = Array.isArray(fila) ? fila[j] : null
      if (c == null || (typeof c === 'string' && c.trim() === '')) continue
      if (!pareceNumero(c)) return 'izq'
      hay = true
    }
    return hay ? 'der' : 'izq'
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Textos de los bloques
// ─────────────────────────────────────────────────────────────────────────────

/** "Fuente: Finanzas · 1–21 oct · Todas las sucursales" (sin duplicar el prefijo). */
export function textoFuente(fuente: string): string {
  const f = fuente.trim()
  return /^fuente\s*:/i.test(f) ? f : `Fuente: ${f}`
}

/**
 * "No pude leer: {error}". Si la herramienta ya lo dice ("No pude leer las
 * reseñas."), no se repite: quedaría "No pude leer: No pude leer…".
 */
export function textoNoPudeLeer(error: string): string {
  const e = error.trim()
  const sinTildes = e.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/^(no pude|no se pudo|no pudimos|no puedo|no se puede|no fue posible)/.test(sinTildes)) return e
  return `No pude leer: ${e}`
}

/**
 * "5★" → "5 estrellas", "1★" → "1 estrella". La fuente del PDF (Helvetica,
 * WinAnsi) no tiene la ★ y `textoPdf` la borraba: el KPI "5★" de las reseñas
 * salía "5" a secas en el archivo que se manda. Lo usan `generar_informe` (así
 * la pantalla y el PDF dicen lo mismo) y `textoPdf` (informes ya guardados).
 */
export function estrellasEnTexto(texto: string): string {
  return texto.replace(/(\d+(?:[.,]\d+)?)\s*★/g, (_m, n: string) => `${n} ${n === '1' ? 'estrella' : 'estrellas'}`)
}

/** Hacia dónde apunta un delta ("+12 %" sube, "-3 %" baja), mirando el signo escrito. */
export function direccionDeDelta(delta: string | undefined | null): 'sube' | 'baja' | 'igual' | null {
  if (!delta) return null
  const d = delta.trim()
  if (/^\+/.test(d)) return 'sube'
  if (/^[-−–]/.test(d)) return 'baja'
  if (/^[0]+(?:[.,]0+)?\s?%?$/.test(d) || /^±/.test(d)) return 'igual'
  return null
}

/**
 * Un enlace que sale de una herramienta se respeta sólo si es interno ("/…",
 * no "//…") o https. Nada de `javascript:` aunque el dato venga raro.
 */
export function enlaceSeguro(href: string | undefined | null): { href: string; interno: boolean } | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (/^\/(?!\/)/.test(h)) return { href: h, interno: true }
  if (/^https:\/\//i.test(h)) return { href: h, interno: false }
  return null
}

/**
 * Cuántas tarjetas va en cada fila: hasta `max` por fila, repartidas parejo
 * (5 → 3 + 2, 7 → 3 + 2 + 2 o 4 + 3, 10 → 4 + 3 + 3). Cada fila ocupa el
 * ancho entero: nunca queda un hueco al final ni una tarjeta huérfana.
 */
export function filasDeKpis(n: number, max: number): number[] {
  if (n <= 0) return []
  const filas = Math.ceil(n / Math.max(1, max))
  const base = Math.floor(n / filas)
  const extra = n % filas
  return Array.from({ length: filas }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Comparación profunda de datos planos (JSON): para no volver a dibujar un gráfico idéntico en cada chunk del stream. */
export function igualesProfundo(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!igualesProfundo(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!igualesProfundo((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}
