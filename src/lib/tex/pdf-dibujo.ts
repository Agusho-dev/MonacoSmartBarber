// =============================================================================
// src/lib/tex/pdf-dibujo.ts
// El dibujo del informe de Tex en PDF (A4 vertical, márgenes de 14 mm).
//
// Funciones PURAS que reciben el `doc` de jsPDF y la función de autotable: no
// importan ninguna de las dos (las carga pdf.ts con import dinámico), así este
// archivo también corre en las pruebas con node y el dibujo que se prueba es
// exactamente el que baja el dueño.
//
// Todo vectorial: los gráficos se dibujan con jsPDF por tipo (no son capturas),
// así salen nítidos en el celular, impresos y adjuntos en un WhatsApp.
//
// Orden del informe: encabezado → KPIs → síntesis → gráficos → tablas. La
// síntesis va antes de los gráficos a propósito: el que recibe el PDF lee
// primero la conclusión (la primera página es lo que se ve en la vista previa
// de WhatsApp) y después el respaldo.
//
// Fuente: helvetica estándar (WinAnsi). Tildes, ñ, "•", "–", "…" y comillas
// tipográficas existen; emojis y el signo menos tipográfico no: todo texto pasa
// por `textoPdf` antes de dibujarse.
// =============================================================================

import type { jsPDF } from 'jspdf'
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import type { TexGrafico, TexInforme, TexKpi, TexTabla } from './contrato'
import {
  abreviarEtiqueta,
  abreviarValor,
  alineacionesDeTabla,
  COLOR_TEX,
  direccionDeDelta,
  escalaDeGrafico,
  esNumero,
  etiquetaDeBarra,
  filasDeKpis,
  formateadorDeBarras,
  formatearValor,
  formatosDeTabla,
  porcentajeDe,
  prepararGrafico,
  textoDeCelda,
  type GraficoListo,
} from './bloques-formato'

export type FuncionAutoTable = (doc: jsPDF, opciones: UserOptions) => void

export interface OpcionesDibujoPdf {
  orgNombre?: string
  /** dataURL PNG de la carita de Tex para el pie. null/undefined: el pie va sin imagen. */
  caraTex?: string | null
  /** Cuándo se generó (el pie lo imprime en hora argentina). */
  fecha?: Date
}

// ─────────────────────────────────────────────────────────────────────────────
// Medidas (mm) y colores
// ─────────────────────────────────────────────────────────────────────────────

const ANCHO = 210
const ALTO = 297
const MARGEN = 14
const UTIL = ANCHO - MARGEN * 2
const ALTO_BANDA = 30
const Y_INICIO_PORTADA = ALTO_BANDA + 9
/** Páginas 2 en adelante: debajo del encabezado corrido. */
const Y_INICIO_PAGINA = 21
/** Debajo de esto va el pie. */
const Y_LIMITE = ALTO - 19
/** mm por punto tipográfico. */
const PT = 0.3528

type RGB = [number, number, number]

const C = {
  banda: [10, 10, 10] as RGB,
  tinta: [23, 23, 23] as RGB,
  texto: [58, 58, 58] as RGB,
  gris: [115, 115, 115] as RGB,
  grisSuave: [150, 150, 150] as RGB,
  subtitulo: [186, 186, 186] as RGB,
  dorado: [212, 167, 58] as RGB,
  tarjeta: [248, 248, 248] as RGB,
  borde: [229, 229, 229] as RGB,
  marco: [232, 232, 232] as RGB,
  grilla: [236, 236, 236] as RGB,
  cero: [176, 176, 176] as RGB,
  separador: [234, 234, 234] as RGB,
  cabeceraTabla: [30, 30, 30] as RGB,
  filaAlterna: [247, 247, 247] as RGB,
  // En papel el verde y el rojo de la pantalla (-400) quedan lavados: -600.
  sube: [5, 150, 105] as RGB,
  baja: [220, 38, 38] as RGB,
}

function rgbDeHex(hex: string): RGB {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto
// ─────────────────────────────────────────────────────────────────────────────

// Lo que WinAnsi (CP1252) tiene además de Latin-1.
const CP1252_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'))

/** Deja sólo lo que la fuente del PDF puede dibujar (sin emojis ni "−" tipográfico). */
export function textoPdf(valor: unknown): string {
  const s = typeof valor === 'string' ? valor : valor == null ? '' : String(valor)
  let quitado = false
  const limpio = s
    .replace(/[\u2212\u2010\u2011]/g, '-')
    .replace(/[\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    // Invisibles que en el PDF se verían (el guion opcional sale como "-").
    .replace(/[\u00ad\u200b\u2060\ufeff]/g, '')
    .replace(/≈/g, '~')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[\s\S]/gu, (ch) => {
      const c = ch.codePointAt(0) ?? 0
      if (c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(ch)) return ch
      if (c === 9 || c === 13) return ' '
      quitado = true
      return ''
    })
  // Un emoji que se fue deja su hueco: "sucursales 🙂." → "sucursales ." → "sucursales."
  return quitado ? limpio.replace(/ +([.,;:!?)])/g, '$1').replace(/ {2,}/g, ' ').trim() : limpio
}

type Estilo = 'normal' | 'bold' | 'italic' | 'bolditalic'

function fuente(doc: jsPDF, tamano: number, estilo: Estilo = 'normal', color?: RGB): void {
  doc.setFont('helvetica', estilo)
  doc.setFontSize(tamano)
  if (color) doc.setTextColor(color[0], color[1], color[2])
}

/**
 * Ancho de un texto tal como lo DIBUJA jsPDF, con la fuente actual.
 * `doc.getTextWidth` mide con kerning y `doc.text` dibuja sin kerning: en un
 * renglón armado palabra por palabra, después de pares como "Tr" el espacio
 * siguiente desaparecía ("Transferenciaya").
 */
function anchoTexto(doc: jsPDF, texto: string): number {
  return (doc.getStringUnitWidth(texto, { doKerning: false }) * doc.getFontSize()) / doc.internal.scaleFactor
}

/** Corta con "…" lo que no entra en `ancho` (con la fuente actual). */
function recortar(doc: jsPDF, texto: string, ancho: number): string {
  if (anchoTexto(doc, texto) <= ancho) return texto
  let lo = 0
  let hi = texto.length
  while (lo < hi) {
    const mitad = Math.ceil((lo + hi) / 2)
    if (anchoTexto(doc, texto.slice(0, mitad).trimEnd() + '…') <= ancho) lo = mitad
    else hi = mitad - 1
  }
  return lo > 0 ? texto.slice(0, lo).trimEnd() + '…' : '…'
}

function lineasDe(doc: jsPDF, texto: string, ancho: number, max: number): string[] {
  const lineas = (doc.splitTextToSize(texto, ancho) as string[]).filter((l) => l.length > 0)
  if (lineas.length <= max) return lineas
  const visibles = lineas.slice(0, max)
  visibles[max - 1] = recortar(doc, lineas.slice(max - 1).join(' '), ancho)
  return visibles
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────

interface Estado {
  doc: jsPDF
  /** Borde superior de lo próximo que se dibuja. */
  y: number
}

function nuevaPagina(e: Estado): void {
  e.doc.addPage()
  e.y = Y_INICIO_PAGINA
}

/** Si lo que viene no entra en lo que queda de la página, pasa a la siguiente. */
function asegurar(e: Estado, alto: number): void {
  if (e.y + alto > Y_LIMITE && e.y > Y_INICIO_PAGINA + 0.5) nuevaPagina(e)
}

function lineaHorizontal(doc: jsPDF, x0: number, x1: number, y: number, color: RGB, grosor: number): void {
  doc.setDrawColor(color[0], color[1], color[2])
  doc.setLineWidth(grosor)
  doc.line(x0, y, x1, y)
}

// ─────────────────────────────────────────────────────────────────────────────
// Encabezado (banda oscura de la primera página)
// ─────────────────────────────────────────────────────────────────────────────

const ESPACIADO_ORG = 0.45

function dibujarOrg(doc: jsPDF, org: string, yBase: number, tamano: number, anchoMax: number): number {
  if (!org) return 0
  fuente(doc, tamano, 'bold', C.dorado)
  const recortado = recortar(doc, org, anchoMax)
  const ancho = anchoTexto(doc, recortado) + ESPACIADO_ORG * Math.max(0, recortado.length - 1)
  doc.text(recortado, ANCHO - MARGEN - ancho, yBase, { charSpace: ESPACIADO_ORG })
  return ancho
}

function dibujarPortada(doc: jsPDF, informe: TexInforme, org: string): void {
  doc.setFillColor(C.banda[0], C.banda[1], C.banda[2])
  doc.rect(0, 0, ANCHO, ALTO_BANDA, 'F')

  const titulo = textoPdf(informe.titulo) || 'Informe'
  const subtitulo = textoPdf([informe.periodo, informe.alcance].filter((x) => x && x.trim()).join('  ·  '))

  // La org se mide primero: el título usa lo que queda.
  fuente(doc, 7.5, 'bold')
  const orgTexto = textoPdf(org.toUpperCase())
  const anchoOrgEstimado = orgTexto
    ? Math.min(62, anchoTexto(doc, orgTexto) + ESPACIADO_ORG * Math.max(0, orgTexto.length - 1))
    : 0
  const anchoTitulo = UTIL - (anchoOrgEstimado ? anchoOrgEstimado + 10 : 0)

  let tamano = 15
  fuente(doc, tamano, 'bold')
  let lineas = doc.splitTextToSize(titulo, anchoTitulo) as string[]
  if (lineas.length > 1) {
    tamano = 13
    fuente(doc, tamano, 'bold')
    lineas = lineasDe(doc, titulo, anchoTitulo, 2)
  }
  const interlinea = tamano * PT * 1.2
  let yTitulo: number
  if (subtitulo) yTitulo = lineas.length === 1 ? 14.4 : 11.2
  else yTitulo = lineas.length === 1 ? 17.2 : 13.6

  doc.setTextColor(255, 255, 255)
  lineas.forEach((l, i) => doc.text(l, MARGEN, yTitulo + i * interlinea))

  if (subtitulo) {
    fuente(doc, 9, 'normal', C.subtitulo)
    const ySub = yTitulo + (lineas.length - 1) * interlinea + 7
    doc.text(recortar(doc, subtitulo, UTIL), MARGEN, ySub)
  }
  dibujarOrg(doc, orgTexto, yTitulo, 7.5, 62)
}

/** Páginas 2 en adelante: título y org en chico, para que una hoja suelta se sepa de qué informe es. */
function dibujarEncabezadoCorrido(doc: jsPDF, informe: TexInforme, org: string): void {
  const yBase = 11.5
  fuente(doc, 7.5, 'bold')
  const orgTexto = textoPdf(org.toUpperCase())
  const anchoOrg = dibujarOrg(doc, orgTexto, yBase, 7, 60)
  fuente(doc, 7.5, 'bold', C.grisSuave)
  doc.text(recortar(doc, textoPdf(informe.titulo), UTIL - (anchoOrg ? anchoOrg + 8 : 0)), MARGEN, yBase)
  lineaHorizontal(doc, MARGEN, ANCHO - MARGEN, yBase + 3.4, C.separador, 0.2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pie: "Preparado con Tex" (la única aparición de Tex en el informe)
// ─────────────────────────────────────────────────────────────────────────────

const CARA_ALTO = 5
const CARA_ANCHO = (CARA_ALTO * 256) / 182

function fechaHoraArgentina(fecha: Date): string {
  try {
    const partes = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(fecha)
    const p = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
    return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`
  } catch {
    return fecha.toISOString().slice(0, 16).replace('T', ' ')
  }
}

function dibujarPie(doc: jsPDF, pagina: number, total: number, texto: string, cara: string | null): void {
  const yBase = ALTO - 8.4
  lineaHorizontal(doc, MARGEN, ANCHO - MARGEN, yBase - 5.6, C.separador, 0.2)
  let x = MARGEN
  if (cara) {
    try {
      // Mismo alias en todas las páginas: jsPDF guarda la imagen una sola vez.
      doc.addImage(cara, 'PNG', x, yBase - 3.7, CARA_ANCHO, CARA_ALTO, 'tex-cara', 'FAST')
      x += CARA_ANCHO + 1.8
    } catch {
      /* sin carita: el pie igual sale */
    }
  }
  fuente(doc, 7.5, 'normal', C.grisSuave)
  const paginas = `Pág. ${pagina}/${total}`
  const anchoPaginas = anchoTexto(doc, paginas)
  doc.text(recortar(doc, texto, ANCHO - MARGEN - anchoPaginas - 6 - x), x, yBase)
  doc.text(paginas, ANCHO - MARGEN, yBase, { align: 'right' })
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────────────────

const KPI = { pad: 3.4, yEtiqueta: 5.6, yValor: 12.6, yDelta: 17.6, yBase: 20.9, interBase: 2.8, abajo: 3.6 }
/** La cifra arranca en 13 pt y se achica hasta 9; si a 9 pt no entra, va en dos renglones. */
const VALOR_KPI = { maximo: 13, minimo: 9, interlinea: 9 * PT * 1.2 }

/**
 * La cifra de un KPI, ya acomodada en el ancho de su tarjeta: nunca se dibuja
 * más ancha que la tarjeta (la de al lado la tapaba). Primero se achica; si a
 * 9 pt igual no entra ("32 % de 1.200 clientes únicos"), se parte en dos
 * renglones por un espacio, nunca adentro de un número. Lo que no entre en el
 * segundo renglón se corta con "…".
 */
export function lineasDeValorKpi(doc: jsPDF, valor: string, ancho: number): { tamano: number; lineas: string[] } {
  let tamano = VALOR_KPI.maximo
  fuente(doc, tamano, 'bold')
  while (anchoTexto(doc, valor) > ancho && tamano > VALOR_KPI.minimo) {
    tamano -= 0.5
    doc.setFontSize(tamano)
  }
  if (anchoTexto(doc, valor) <= ancho) return { tamano, lineas: [valor] }
  // El espacio duro une la cifra con su unidad ("32 %"): no es un lugar de corte.
  const palabras = valor.split(/[^\S ]+/).filter(Boolean)
  let primera = ''
  let i = 0
  for (; i < palabras.length; i++) {
    const prueba = primera ? `${primera} ${palabras[i]}` : palabras[i]
    if (primera && anchoTexto(doc, prueba) > ancho) break
    primera = prueba
  }
  const resto = palabras.slice(i).join(' ')
  const lineas = [recortar(doc, primera, ancho)]
  if (resto) lineas.push(recortar(doc, resto, ancho))
  return { tamano, lineas }
}

function lineasDeBase(doc: jsPDF, k: TexKpi, ancho: number): string[] {
  if (!k.delta || !k.base) return []
  fuente(doc, 6.5, 'normal')
  return lineasDe(doc, textoPdf(k.base), ancho - KPI.pad * 2, 2)
}

function altoDeKpi(doc: jsPDF, k: TexKpi, ancho: number): number {
  // Sin base no hay delta (contra qué se compara es parte del dato).
  if (!k.delta || !k.base) return KPI.yValor + KPI.abajo + 0.6
  const base = lineasDeBase(doc, k, ancho)
  return KPI.yBase + (base.length - 1) * KPI.interBase + KPI.abajo - 0.4
}

function dibujarFlecha(doc: jsPDF, direccion: 'sube' | 'baja' | 'igual' | null, x: number, yBase: number, color: RGB): number {
  doc.setFillColor(color[0], color[1], color[2])
  doc.setDrawColor(color[0], color[1], color[2])
  if (direccion === 'sube') {
    doc.triangle(x, yBase - 0.2, x + 2.3, yBase - 0.2, x + 1.15, yBase - 2.2, 'F')
    return 3.1
  }
  if (direccion === 'baja') {
    doc.triangle(x, yBase - 2.2, x + 2.3, yBase - 2.2, x + 1.15, yBase - 0.2, 'F')
    return 3.1
  }
  doc.setLineWidth(0.45)
  doc.line(x, yBase - 1.2, x + 2.1, yBase - 1.2)
  return 3
}

/**
 * Una tarjeta de KPI. `extra` es el alto que agrega una cifra en dos renglones
 * en esa fila: todas las tarjetas de la fila lo suman, así las cifras quedan
 * apoyadas en la misma línea y los deltas alineados (como en la pantalla).
 */
function dibujarKpi(
  doc: jsPDF,
  k: TexKpi,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  valor: { tamano: number; lineas: string[] },
  extra: number,
): void {
  doc.setFillColor(C.tarjeta[0], C.tarjeta[1], C.tarjeta[2])
  doc.setDrawColor(C.borde[0], C.borde[1], C.borde[2])
  doc.setLineWidth(0.2)
  doc.roundedRect(x, y, ancho, alto, 2, 2, 'FD')

  const interior = ancho - KPI.pad * 2
  fuente(doc, 7.5, 'normal', C.gris)
  doc.text(recortar(doc, textoPdf(k.etiqueta), interior), x + KPI.pad, y + KPI.yEtiqueta)

  fuente(doc, valor.tamano, 'bold', C.tinta)
  const ultimaBase = y + KPI.yValor + extra
  valor.lineas.forEach((l, i) => doc.text(l, x + KPI.pad, ultimaBase - (valor.lineas.length - 1 - i) * VALOR_KPI.interlinea))

  if (k.delta && k.base) {
    const color = k.tono === 'sube' ? C.sube : k.tono === 'baja' ? C.baja : C.gris
    const direccion = direccionDeDelta(k.delta) ?? (k.tono === 'sube' ? 'sube' : k.tono === 'baja' ? 'baja' : 'igual')
    const dx = dibujarFlecha(doc, direccion, x + KPI.pad, y + KPI.yDelta + extra, color)
    fuente(doc, 7.5, 'bold', color)
    doc.text(recortar(doc, textoPdf(k.delta), interior - dx), x + KPI.pad + dx, y + KPI.yDelta + extra)
    const base = lineasDeBase(doc, k, ancho)
    fuente(doc, 6.5, 'normal', C.gris)
    base.forEach((l, i) => doc.text(l, x + KPI.pad, y + KPI.yBase + extra + i * KPI.interBase))
  }
}

function dibujarKpis(e: Estado, kpis: TexKpi[]): void {
  const lista = kpis.filter((k) => k && (k.etiqueta || k.valor))
  if (lista.length === 0) return
  // Hasta 4 por fila, repartidas parejo y cada fila a todo el ancho (5 → 3 + 2).
  const gap = 3.5
  let i = 0
  for (const enFila of filasDeKpis(lista.length, 4)) {
    const fila = lista.slice(i, i + enFila)
    i += enFila
    const ancho = (UTIL - gap * (enFila - 1)) / enFila
    const valores = fila.map((k) => lineasDeValorKpi(e.doc, textoPdf(k.valor), ancho - KPI.pad * 2))
    const extra = Math.max(...valores.map((v) => v.lineas.length - 1)) * VALOR_KPI.interlinea
    const alto = Math.max(...fila.map((k) => altoDeKpi(e.doc, k, ancho))) + extra
    asegurar(e, alto)
    fila.forEach((k, j) => dibujarKpi(e.doc, k, MARGEN + j * (ancho + gap), e.y, ancho, alto, valores[j], extra))
    e.y += alto + gap
  }
  e.y += 4
}

// ─────────────────────────────────────────────────────────────────────────────
// Títulos de sección
// ─────────────────────────────────────────────────────────────────────────────

function dibujarTituloBloque(e: Estado, texto: string, tamano = 10, ancho = UTIL, x = MARGEN): void {
  fuente(e.doc, tamano, 'bold', C.tinta)
  const lineas = lineasDe(e.doc, textoPdf(texto), ancho, 2)
  const interlinea = tamano * PT * 1.25
  lineas.forEach((l, i) => e.doc.text(l, x, e.y + tamano * PT * 0.95 + i * interlinea))
  e.y += lineas.length * interlinea + 1.6
}

// ─────────────────────────────────────────────────────────────────────────────
// Gráficos
// ─────────────────────────────────────────────────────────────────────────────

const MARCO_PAD = 4.2
const ALTO_PLOT = 54
const MAX_FILAS_HORIZONTALES = 30
/** Alto máximo del dibujo de un ranking: con título y nota, el marco entra en una página. */
const ALTO_MAX_RANKING = 200

interface Caja {
  x: number
  y: number
  ancho: number
  alto: number
}

function colorDeBarra(g: GraficoListo, serie: number, i: number): RGB {
  if (g.series.length === 1 && g.coloresBarras) return rgbDeHex(g.coloresBarras[i] ?? g.series[0].color)
  return rgbDeHex(g.series[serie].color)
}

/** Leyenda de varias series: cuadradito de color + nombre, en renglones. Devuelve el alto usado. */
function dibujarLeyenda(doc: jsPDF, g: GraficoListo, x: number, y: number, ancho: number, dibujar: boolean): number {
  if (g.series.length < 2) return 0
  fuente(doc, 7.5, 'normal', C.texto)
  let cx = x
  let cy = y + 2.6
  for (const s of g.series) {
    const nombre = recortar(doc, textoPdf(s.nombre), ancho - 4)
    const w = 3.6 + anchoTexto(doc, nombre)
    if (cx > x && cx + w > x + ancho) {
      cx = x
      cy += 4.4
    }
    if (dibujar) {
      const [r, gg, b] = rgbDeHex(s.color)
      doc.setFillColor(r, gg, b)
      doc.roundedRect(cx, cy - 2.3, 2.5, 2.5, 0.5, 0.5, 'F')
      fuente(doc, 7.5, 'normal', C.texto)
      doc.text(nombre, cx + 3.6, cy)
    }
    cx += w + 5
  }
  return cy - y + 1.2
}

function dibujarEjeY(doc: jsPDF, g: GraficoListo, caja: Caja) {
  const escala = escalaDeGrafico(g, 5)
  fuente(doc, 6.5, 'normal', C.grisSuave)
  const textos = escala.marcas.map((m) => textoPdf(abreviarValor(m, g.unidad)))
  const anchoEje = Math.max(...textos.map((t) => anchoTexto(doc, t))) + 2.6
  const plot = { x0: caja.x + anchoEje, x1: caja.x + caja.ancho, y0: caja.y + 3.4, y1: caja.y + caja.alto - 6.2 }
  const yDe = (v: number) => plot.y1 - ((v - escala.min) / (escala.max - escala.min || 1)) * (plot.y1 - plot.y0)
  escala.marcas.forEach((m, i) => {
    const y = yDe(m)
    lineaHorizontal(doc, plot.x0, plot.x1, y, m === 0 && escala.min < 0 ? C.cero : C.grilla, m === 0 && escala.min < 0 ? 0.3 : 0.15)
    fuente(doc, 6.5, 'normal', C.grisSuave)
    doc.text(textos[i], plot.x0 - 1.8, y + 1.05, { align: 'right' })
  })
  // La base (0) de las barras más marcada que la grilla.
  if (escala.min === 0 && g.dibujo !== 'lineas') lineaHorizontal(doc, plot.x0, plot.x1, yDe(0), C.cero, 0.3)
  return { plot, yDe, escala }
}

function dibujarEtiquetasX(doc: jsPDF, g: GraficoListo, plot: { x0: number; x1: number; y1: number }): void {
  const n = g.etiquetas.length
  const banda = (plot.x1 - plot.x0) / n
  fuente(doc, 6.5, 'normal')
  // Si no entran, primero los meses y días en tres letras ("Sep", "Sáb").
  const largas = Math.max(...g.etiquetas.map((t) => anchoTexto(doc, textoPdf(t)))) + 1.5 > banda
  const etiquetas = largas ? g.etiquetas.map(abreviarEtiqueta) : g.etiquetas
  const anchoMax = Math.max(...etiquetas.map((t) => anchoTexto(doc, textoPdf(t))))
  // Si no entran todas, una cada tanto. Se acepta recortar una etiqueta hasta
  // ~12 mm ("Septiem…"); más corta que eso ya no se lee y conviene saltear.
  const cada = Math.max(1, Math.ceil((Math.min(anchoMax, 12) + 1.5) / banda))
  const visibles = new Set<number>()
  for (let i = 0; i < n; i += cada) visibles.add(i)
  if (g.destacar != null && !visibles.has(g.destacar)) {
    // La destacada siempre se ve; se le hace lugar sacando las vecinas.
    for (const i of [...visibles]) if (Math.abs(i - g.destacar) < cada) visibles.delete(i)
    visibles.add(g.destacar)
  }
  for (const i of visibles) {
    const destacada = i === g.destacar
    fuente(doc, 6.5, destacada ? 'bold' : 'normal', destacada ? C.tinta : C.gris)
    const disponible = Math.max(banda * cada - 1, 6)
    doc.text(recortar(doc, textoPdf(etiquetas[i]), disponible), plot.x0 + banda * (i + 0.5), plot.y1 + 4.2, { align: 'center' })
  }
}

function dibujarBarrasVerticales(doc: jsPDF, g: GraficoListo, caja: Caja): void {
  const { plot, yDe } = dibujarEjeY(doc, g, caja)
  const n = g.etiquetas.length
  const k = g.series.length
  const banda = (plot.x1 - plot.x0) / n
  const grupo = banda * (k === 1 ? 0.6 : 0.78)
  const gap = k > 1 ? Math.min(0.5, grupo * 0.06) : 0
  const sub = (grupo - gap * (k - 1)) / k

  // Etiquetas de valor: sólo si entran sin pisarse (una serie o dos).
  fuente(doc, 6.5, 'normal')
  const lugar = k === 1 ? banda * 0.96 : sub * 1.9
  const medir = (ts: string[][]) => Math.max(...ts.flat().map((t) => (t ? anchoTexto(doc, t) : 0)))
  // Un solo formato para todas las cifras del gráfico; si no entra, el corto.
  const todos = g.series.flatMap((s) => s.valores)
  const textosCon = (formato: (v: number) => string) =>
    g.series.map((s) => s.valores.map((v) => (esNumero(v) ? textoPdf(formato(v)) : '')))
  let textos = textosCon(formateadorDeBarras(todos, g.unidad))
  if (medir(textos) > lugar) textos = textosCon(formateadorDeBarras(todos, g.unidad, true))
  const conEtiquetas = k <= 2 && medir(textos) <= lugar && n <= 24

  g.series.forEach((s, si) => {
    s.valores.forEach((v, i) => {
      if (!esNumero(v)) return
      const x = plot.x0 + banda * i + (banda - grupo) / 2 + si * (sub + gap)
      const arriba = yDe(Math.max(v, 0))
      const abajo = yDe(Math.min(v, 0))
      const [r, gg, b] = colorDeBarra(g, si, i)
      doc.setFillColor(r, gg, b)
      doc.rect(x, arriba, sub, Math.max(0.25, abajo - arriba), 'F')
      if (conEtiquetas) {
        fuente(doc, 6.5, i === g.destacar ? 'bold' : 'normal', i === g.destacar ? C.tinta : C.texto)
        // Los negativos van hacia abajo, con su etiqueta debajo de la barra.
        const yTexto = v >= 0 ? arriba - 1.3 : abajo + 2.8
        doc.text(textos[si][i], x + sub / 2, yTexto, { align: 'center' })
      }
    })
  })
  dibujarEtiquetasX(doc, g, plot)
}

function dibujarLineasArea(doc: jsPDF, g: GraficoListo, caja: Caja): void {
  const { plot, yDe, escala } = dibujarEjeY(doc, g, caja)
  const n = g.etiquetas.length
  const banda = (plot.x1 - plot.x0) / n
  const xDe = (i: number) => plot.x0 + banda * (i + 0.5)
  const conPuntos = n <= 31
  const base = yDe(Math.max(escala.min, Math.min(0, escala.max)))

  g.series.forEach((s) => {
    const [r, gg, b] = rgbDeHex(s.color)
    // Tramos continuos (un null corta la línea).
    const tramos: { i: number; v: number }[][] = []
    let actual: { i: number; v: number }[] = []
    s.valores.forEach((v, i) => {
      if (esNumero(v)) actual.push({ i, v })
      else if (actual.length) {
        tramos.push(actual)
        actual = []
      }
    })
    if (actual.length) tramos.push(actual)

    if (g.dibujo === 'area') {
      for (const t of tramos) {
        if (t.length < 2) continue
        doc.saveGraphicsState()
        const GState = (doc as unknown as { GState: new (p: { opacity: number }) => unknown }).GState
        doc.setGState(new GState({ opacity: g.series.length > 1 ? 0.12 : 0.18 }))
        doc.setFillColor(r, gg, b)
        doc.moveTo(xDe(t[0].i), base)
        for (const p of t) doc.lineTo(xDe(p.i), yDe(p.v))
        doc.lineTo(xDe(t[t.length - 1].i), base)
        doc.close()
        doc.fill()
        doc.restoreGraphicsState()
      }
    }

    doc.setDrawColor(r, gg, b)
    doc.setLineWidth(0.6)
    doc.setLineJoin('round')
    doc.setLineCap('round')
    for (const t of tramos) {
      for (let j = 1; j < t.length; j++) doc.line(xDe(t[j - 1].i), yDe(t[j - 1].v), xDe(t[j].i), yDe(t[j].v))
    }
    // Las uniones redondeadas son de la línea: lo que se dibuje después vuelve a lo normal.
    doc.setLineJoin('miter')
    doc.setLineCap('butt')
    if (conPuntos) {
      doc.setLineWidth(0.35)
      s.valores.forEach((v, i) => {
        if (!esNumero(v)) return
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(r, gg, b)
        doc.circle(xDe(i), yDe(v), 0.7, 'FD')
      })
    }
  })

  // El punto del que habla el texto: en el azul de Tex, con su cifra.
  if (g.destacar != null) {
    const s = g.series[0]
    const v = s.valores[g.destacar]
    if (esNumero(v)) {
      const [r, gg, b] = rgbDeHex(COLOR_TEX)
      doc.setFillColor(r, gg, b)
      doc.setDrawColor(255, 255, 255)
      doc.setLineWidth(0.4)
      doc.circle(xDe(g.destacar), yDe(v), 1.25, 'FD')
      fuente(doc, 6.5, 'bold', C.tinta)
      doc.text(textoPdf(etiquetaDeBarra(v, g.unidad)), xDe(g.destacar), yDe(v) - 2.3, { align: 'center' })
    }
  }
  dibujarEtiquetasX(doc, g, plot)
}

function altoFilaHorizontal(g: GraficoListo): number {
  return g.series.length === 1 ? 6.4 : 2.4 + g.series.length * 3.2
}

/** Filas de un ranking que entran en una página (con varias series, cada fila es más alta). */
function filasHorizontales(g: GraficoListo): number {
  return Math.min(g.etiquetas.length, MAX_FILAS_HORIZONTALES, Math.floor(ALTO_MAX_RANKING / altoFilaHorizontal(g)))
}

function dibujarBarrasHorizontales(doc: jsPDF, g: GraficoListo, caja: Caja): void {
  const filas = filasHorizontales(g)
  const k = g.series.length
  const altoFila = altoFilaHorizontal(g)
  const altoBarra = k === 1 ? 4 : 2.7

  // Cifra al final de cada barra; en una torta, también su porcentaje.
  const textoValor = (si: number, i: number): string => {
    const v = g.series[si].valores[i]
    if (!esNumero(v)) return ''
    if (g.porciones && g.total) return textoPdf(`${formatearValor(v, g.unidad)}  ·  ${porcentajeDe(v, g.total)}`)
    return textoPdf(formatearValor(v, g.unidad))
  }
  // Cada texto se mide con el estilo con que se dibuja: la fila destacada va en
  // negrita, más ancha (medida en normal, "Transferencia" salía "Transferen…").
  const estiloFila = (i: number): Estilo => (i === g.destacar ? 'bold' : 'normal')
  let anchoValor = 0
  for (let si = 0; si < k; si++) {
    for (let i = 0; i < filas; i++) {
      fuente(doc, 7, estiloFila(i))
      anchoValor = Math.max(anchoValor, anchoTexto(doc, textoValor(si, i)))
    }
  }
  anchoValor += 2.4
  let anchoEtiquetaMax = 0
  for (let i = 0; i < filas; i++) {
    fuente(doc, 7.5, estiloFila(i))
    anchoEtiquetaMax = Math.max(anchoEtiquetaMax, anchoTexto(doc, textoPdf(g.etiquetas[i])))
  }
  const anchoEtiquetas = Math.min(caja.ancho * 0.34, Math.max(18, anchoEtiquetaMax + 3))

  // Sin eje visible (cada barra lleva su cifra): la escala sale de los datos,
  // así la barra más larga llena el ancho en vez de quedar en el 80 %.
  const valores = g.series.flatMap((s) => s.valores.slice(0, filas)).filter(esNumero)
  const min = Math.min(0, ...valores)
  const max = Math.max(0, ...valores)
  const hayNegativos = min < 0
  const x0 = caja.x + anchoEtiquetas + (hayNegativos ? anchoValor : 0)
  const x1 = caja.x + caja.ancho - anchoValor
  const xDe = (v: number) => x0 + ((v - min) / (max - min || 1)) * (x1 - x0)

  for (let i = 0; i < filas; i++) {
    const arriba = caja.y + i * altoFila
    const destacada = i === g.destacar
    fuente(doc, 7.5, destacada ? 'bold' : 'normal', destacada ? C.tinta : C.texto)
    doc.text(recortar(doc, textoPdf(g.etiquetas[i]), anchoEtiquetas - 2.5), caja.x, arriba + altoFila / 2 + 1.25)
    const altoGrupo = k * altoBarra + (k - 1) * 0.5
    g.series.forEach((s, si) => {
      const v = s.valores[i]
      if (!esNumero(v)) return
      const y = arriba + (altoFila - altoGrupo) / 2 + si * (altoBarra + 0.5)
      const a = xDe(Math.min(v, 0))
      const b = xDe(Math.max(v, 0))
      const [r, gg, bb] = colorDeBarra(g, si, i)
      doc.setFillColor(r, gg, bb)
      doc.rect(a, y, Math.max(0.3, b - a), altoBarra, 'F')
      if (k <= 3) {
        fuente(doc, 7, destacada ? 'bold' : 'normal', destacada ? C.tinta : C.texto)
        const yTexto = y + altoBarra / 2 + 1.05
        if (v >= 0) doc.text(textoValor(si, i), b + 1.4, yTexto)
        else doc.text(textoValor(si, i), a - 1.4, yTexto, { align: 'right' })
      }
    })
  }
  if (hayNegativos) {
    doc.setDrawColor(C.cero[0], C.cero[1], C.cero[2])
    doc.setLineWidth(0.3)
    doc.line(xDe(0), caja.y, xDe(0), caja.y + filas * altoFila)
  }
}

function dibujarGrafico(e: Estado, grafico: TexGrafico): void {
  const doc = e.doc
  const g = prepararGrafico(grafico, { estrecho: true })
  const interior = UTIL - MARCO_PAD * 2

  // Primero se mide todo, para no partir un gráfico entre dos páginas.
  fuente(doc, 10, 'bold')
  const lineasTitulo = lineasDe(doc, textoPdf(g.titulo || 'Gráfico'), interior, 2)
  const altoTitulo = lineasTitulo.length * 10 * PT * 1.25 + 1.6
  const altoLeyenda = g.vacio ? 0 : dibujarLeyenda(doc, g, 0, 0, interior, false)
  const horizontal = g.dibujo === 'barras_horizontales'
  const filas = horizontal ? filasHorizontales(g) : 0
  const altoPlot = g.vacio ? 8 : horizontal ? filas * altoFilaHorizontal(g) + 1 : ALTO_PLOT
  const recorte = horizontal && g.etiquetas.length > filas ? `Se muestran ${filas} de ${g.etiquetas.length}.` : ''
  const nota = [g.nota, recorte].filter(Boolean).join(' ')
  fuente(doc, 7.5, 'italic')
  const lineasNota = nota ? lineasDe(doc, textoPdf(nota), interior, 3) : []
  const altoNota = lineasNota.length ? lineasNota.length * 3.3 + 1.6 : 0
  const alto = MARCO_PAD + altoTitulo + (altoLeyenda ? altoLeyenda + 2.4 : 0) + altoPlot + altoNota + MARCO_PAD - 0.6

  asegurar(e, alto)
  const y0 = e.y
  doc.setDrawColor(C.marco[0], C.marco[1], C.marco[2])
  doc.setLineWidth(0.25)
  doc.roundedRect(MARGEN, y0, UTIL, alto, 2.5, 2.5, 'S')

  e.y = y0 + MARCO_PAD
  dibujarTituloBloque(e, g.titulo || 'Gráfico', 10, interior, MARGEN + MARCO_PAD)
  if (altoLeyenda) {
    dibujarLeyenda(doc, g, MARGEN + MARCO_PAD, e.y, interior, true)
    e.y += altoLeyenda + 2.4
  }

  const caja: Caja = { x: MARGEN + MARCO_PAD, y: e.y, ancho: interior, alto: altoPlot }
  if (g.vacio) {
    fuente(doc, 8, 'normal', C.gris)
    doc.text('No hay datos para graficar.', caja.x, caja.y + 5)
  } else if (horizontal) dibujarBarrasHorizontales(doc, g, caja)
  else if (g.dibujo === 'lineas' || g.dibujo === 'area') dibujarLineasArea(doc, g, caja)
  else dibujarBarrasVerticales(doc, g, caja)
  e.y += altoPlot

  if (lineasNota.length) {
    e.y += 1.6
    fuente(doc, 7.5, 'italic', C.gris)
    lineasNota.forEach((l, i) => doc.text(l, MARGEN + MARCO_PAD, e.y + 2.6 + i * 3.3))
    e.y += lineasNota.length * 3.3
  }
  e.y = y0 + alto + 6
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablas
// ─────────────────────────────────────────────────────────────────────────────

function finalDeTabla(doc: jsPDF): number | null {
  const ultima = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
  return typeof ultima?.finalY === 'number' ? ultima.finalY : null
}

/**
 * Letra y relleno de una tabla: el normal y, si no entra a lo ancho, el
 * compacto. Más chico que 6,5 pt ya no se lee impreso.
 */
const ESTILOS_TABLA = [
  { tamano: 8, tamanoCabecera: 7.5, relleno: 2.4, rellenoVertical: 1.9 },
  { tamano: 6.5, tamanoCabecera: 6.5, relleno: 1.2, rellenoVertical: 1.5 },
] as const

/** Una palabra de texto más ancha que esto (un enlace, un código) se puede partir: no se le da toda una columna. */
const MAX_PALABRA_MM = 46
/** autotable mide con kerning y jsPDF dibuja sin: un poco de aire para que la cifra entre igual. */
const HOLGURA_MM = 0.6

export interface PlanTabla {
  tamano: number
  tamanoCabecera: number
  relleno: number
  rellenoVertical: number
  /** El ancho mínimo de cada columna (mm, con el relleno): una cifra nunca se parte y una palabra no se corta. */
  minimos: number[]
  /** Las columnas de cada parte. Si la tabla no entra a lo ancho se parte, y la primera columna va en todas. */
  grupos: number[][]
}

/** Las palabras de una celda. El espacio duro une la cifra con su unidad ("32 %"): no separa. */
function palabrasDe(texto: string): string[] {
  return texto.split(/[^\S ]+/).filter(Boolean)
}

function minimosDeColumnas(
  doc: jsPDF,
  columnas: string[],
  filas: string[][],
  alinear: ('izq' | 'der')[],
  estilo: (typeof ESTILOS_TABLA)[number],
): number[] {
  return columnas.map((columna, j) => {
    // El encabezado puede ir en dos renglones, pero sin cortar una palabra ("Sucurs" / "al").
    fuente(doc, estilo.tamanoCabecera, 'bold')
    let minimo = 0
    for (const p of palabrasDe(columna)) minimo = Math.max(minimo, Math.min(MAX_PALABRA_MM, anchoTexto(doc, p)))
    fuente(doc, estilo.tamano, 'normal')
    for (const fila of filas) {
      const celda = fila[j] ?? ''
      if (!celda) continue
      // Una cifra va entera en un renglón: "$123.456.7" arriba y "89" abajo se lee como otro número.
      if (alinear[j] === 'der') minimo = Math.max(minimo, anchoTexto(doc, celda))
      else for (const p of palabrasDe(celda)) minimo = Math.max(minimo, Math.min(MAX_PALABRA_MM, anchoTexto(doc, p)))
    }
    return minimo + estilo.relleno * 2 + HOLGURA_MM
  })
}

/**
 * Reparte las columnas que siguen a la primera en partes que entran en
 * `ancho` (la primera va en todas), lo más parejas posible: 5 + 4 y no 8 + 1.
 */
export function partirColumnas(minimos: number[], ancho: number): number[][] {
  const n = minimos.length
  if (n <= 2) return [minimos.map((_, j) => j)]
  // Llenando cada parte en orden: entra seguro (salvo una columna sola más ancha que la página).
  const enOrden: number[][] = []
  let actual = [0]
  let usado = minimos[0]
  for (let j = 1; j < n; j++) {
    if (actual.length > 1 && usado + minimos[j] > ancho) {
      enOrden.push(actual)
      actual = [0]
      usado = minimos[0]
    }
    actual.push(j)
    usado += minimos[j]
  }
  enOrden.push(actual)
  // Las mismas partes con la misma cantidad de columnas cada una, si así también entran.
  const partes = enOrden.length
  const base = Math.floor((n - 1) / partes)
  const sobran = (n - 1) % partes
  const parejas: number[][] = []
  let j = 1
  for (let p = 0; p < partes; p++) {
    const grupo = [0]
    for (let c = 0; c < base + (p < sobran ? 1 : 0); c++) grupo.push(j++)
    parejas.push(grupo)
  }
  const entra = (grupo: number[]) => grupo.reduce((acc, i) => acc + minimos[i], 0) <= ancho
  return parejas.every(entra) ? parejas : enOrden
}

/**
 * Cómo se dibuja una tabla: con la letra normal si entra a lo ancho; si no,
 * con la compacta; y si tampoco, partida en columnas. Una cifra nunca se
 * parte en dos renglones (antes autotable cortaba "$123.456.789" en
 * "$123.456.7" y "89" para hacer entrar diez columnas).
 */
export function planDeTabla(
  doc: jsPDF,
  columnas: string[],
  filas: string[][],
  alinear: ('izq' | 'der')[],
  ancho: number = UTIL,
): PlanTabla {
  const todas = columnas.map((_, j) => j)
  let plan: PlanTabla | null = null
  for (const estilo of ESTILOS_TABLA) {
    const minimos = minimosDeColumnas(doc, columnas, filas, alinear, estilo)
    const entra = minimos.reduce((acc, m) => acc + m, 0) <= ancho
    plan = { ...estilo, minimos, grupos: entra ? [todas] : partirColumnas(minimos, ancho) }
    if (entra) break
  }
  return plan as PlanTabla
}

function dibujarTablaCruda(
  e: Estado,
  autoTable: FuncionAutoTable,
  columnas: string[],
  filas: string[][],
  alinear: ('izq' | 'der')[],
  titulo?: string,
): void {
  const plan = planDeTabla(e.doc, columnas, filas, alinear)
  const halign = (j: number) => (alinear[j] === 'der' ? ('right' as const) : ('left' as const))
  plan.grupos.forEach((grupo, parte) => {
    if (parte > 0) {
      // La tabla no entraba a lo ancho: siguen las columnas que faltaban, con la primera otra vez.
      asegurar(e, 22)
      fuente(e.doc, 7, 'italic', C.gris)
      const de = titulo ? `Sigue «${recortar(e.doc, textoPdf(titulo), 90)}»` : 'Sigue la tabla'
      const texto = `${de}: columnas ${grupo[1] + 1} a ${grupo[grupo.length - 1] + 1} de ${columnas.length}.`
      e.doc.text(recortar(e.doc, texto, UTIL), MARGEN, e.y + 2.6)
      e.y += 5
    }
    autoTable(e.doc, {
      startY: e.y,
      head: [grupo.map((j) => columnas[j])],
      body: filas.map((f) => grupo.map((j) => f[j] ?? '')),
      theme: 'striped',
      margin: { top: Y_INICIO_PAGINA, right: MARGEN, bottom: ALTO - Y_LIMITE, left: MARGEN },
      styles: {
        font: 'helvetica',
        fontSize: plan.tamano,
        textColor: C.texto,
        cellPadding: { top: plan.rellenoVertical, right: plan.relleno, bottom: plan.rellenoVertical, left: plan.relleno },
        overflow: 'linebreak',
        valign: 'middle',
        lineWidth: 0,
      },
      // Borde del mismo color que el fondo: sin él, algunos visores dibujan una
      // costura blanca entre celda y celda del encabezado.
      headStyles: {
        fillColor: C.cabeceraTabla,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: plan.tamanoCabecera,
        lineColor: C.cabeceraTabla,
        lineWidth: 0.1,
      },
      bodyStyles: { fillColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: C.filaAlterna },
      // El mínimo de cada columna hace que autotable la achique hasta ahí y no más.
      columnStyles: Object.fromEntries(grupo.map((j, k) => [k, { halign: halign(j), minCellWidth: plan.minimos[j] }])),
      didParseCell: (d: CellHookData) => {
        d.cell.styles.halign = halign(grupo[d.column.index] ?? 0)
      },
      // Cada celda del encabezado se pinta un poco más ancha que ella misma: en
      // las vistas previas chicas (WhatsApp, Quick Look) dos rectángulos oscuros
      // pegados dejan ver una costura clara entre celda y celda.
      willDrawCell: (d: CellHookData) => {
        if (d.section !== 'head') return
        d.doc.setFillColor(C.cabeceraTabla[0], C.cabeceraTabla[1], C.cabeceraTabla[2])
        d.doc.rect(d.cell.x - 0.3, d.cell.y, d.cell.width + 0.6, d.cell.height, 'F')
      },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
    })
    e.y = (finalDeTabla(e.doc) ?? e.y) + (parte < plan.grupos.length - 1 ? 6 : 8)
  })
}

function dibujarTabla(e: Estado, autoTable: FuncionAutoTable, t: TexTabla): void {
  const columnas = (Array.isArray(t?.columnas) ? t.columnas : []).map((c) => textoPdf(c))
  if (columnas.length === 0) return
  const alinear = alineacionesDeTabla(t)
  // Un año o un DNI van sin separador de miles ("2026", no "2.026").
  const formatos = formatosDeTabla(t)
  const filas = (Array.isArray(t.filas) ? t.filas : []).map((f) =>
    columnas.map((_, j) => textoPdf(textoDeCelda(Array.isArray(f) ? f[j] : null, formatos[j]))),
  )
  // El título no queda solo al pie de una página: viaja con el encabezado y dos filas.
  asegurar(e, 24)
  dibujarTituloBloque(e, t.titulo || 'Tabla')
  e.y += 0.6
  if (filas.length === 0) {
    fuente(e.doc, 8, 'normal', C.gris)
    e.doc.text('No hay filas para mostrar.', MARGEN, e.y + 3)
    e.y += 10
    return
  }
  dibujarTablaCruda(e, autoTable, columnas, filas, alinear, t.titulo)
}

// ─────────────────────────────────────────────────────────────────────────────
// Síntesis: markdown liviano → PDF
// ─────────────────────────────────────────────────────────────────────────────

interface Tramo {
  texto: string
  negrita: boolean
  cursiva: boolean
}

type BloqueMd =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'item'; nivel: number; marca: string; texto: string }
  | { tipo: 'tabla'; filas: string[][] }
  | { tipo: 'separador' }

const RE_TITULO = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RE_VINETA = /^(\s*)[-*+•]\s+(.*)$/
const RE_NUMERO = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const RE_FILA_TABLA = /^\s*\|.*\|\s*$/
const RE_SEPARADOR_TABLA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const RE_REGLA = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

function celdasDeFila(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

export function parsearMarkdown(md: string): BloqueMd[] {
  const lineas = md.replace(/\r\n?/g, '\n').split('\n')
  const bloques: BloqueMd[] = []
  let parrafo: string[] = []
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push({ tipo: 'parrafo', texto: parrafo.join(' ') })
    parrafo = []
  }
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    if (!linea.trim()) {
      cerrarParrafo()
      continue
    }
    if (RE_FILA_TABLA.test(linea) && i + 1 < lineas.length && RE_SEPARADOR_TABLA.test(lineas[i + 1])) {
      cerrarParrafo()
      const filas = [celdasDeFila(linea)]
      i += 1
      while (i + 1 < lineas.length && RE_FILA_TABLA.test(lineas[i + 1])) {
        filas.push(celdasDeFila(lineas[i + 1]))
        i += 1
      }
      bloques.push({ tipo: 'tabla', filas })
      continue
    }
    if (RE_REGLA.test(linea)) {
      cerrarParrafo()
      bloques.push({ tipo: 'separador' })
      continue
    }
    const t = RE_TITULO.exec(linea)
    if (t) {
      cerrarParrafo()
      bloques.push({ tipo: 'titulo', nivel: t[1].length, texto: t[2] })
      continue
    }
    const v = RE_VINETA.exec(linea)
    if (v) {
      cerrarParrafo()
      bloques.push({ tipo: 'item', nivel: Math.min(2, Math.floor(v[1].replace(/\t/g, '  ').length / 2)), marca: '•', texto: v[2] })
      continue
    }
    const n = RE_NUMERO.exec(linea)
    if (n) {
      cerrarParrafo()
      bloques.push({ tipo: 'item', nivel: Math.min(2, Math.floor(n[1].replace(/\t/g, '  ').length / 2)), marca: `${n[2]}.`, texto: n[3] })
      continue
    }
    // Un renglón sangrado debajo de un ítem es la continuación del ítem.
    const ultimo = bloques[bloques.length - 1]
    if (!parrafo.length && ultimo?.tipo === 'item' && /^\s{2,}\S/.test(linea)) {
      ultimo.texto += ' ' + linea.trim()
      continue
    }
    parrafo.push(linea.trim().replace(/^>\s?/, ''))
  }
  cerrarParrafo()
  return bloques
}

/** `**negrita**`, `*cursiva*`, `_cursiva_`, enlaces y código → tramos con estilo, sin las marcas. */
export function tramosEnLinea(texto: string): Tramo[] {
  const limpio = texto
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(?![\s*])(.+?)(?<![\s*])\*|(?<![\p{L}\p{N}])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}])/gu
  const tramos: Tramo[] = []
  let ultimo = 0
  const empujar = (t: string, negrita: boolean, cursiva: boolean) => {
    // Lo que quedó suelto (un "***" mal cerrado) no se imprime como asterisco.
    const s = t.replace(/\*{1,3}/g, '')
    if (s) tramos.push({ texto: s, negrita, cursiva })
  }
  for (const m of limpio.matchAll(re)) {
    const i = m.index ?? 0
    if (i > ultimo) empujar(limpio.slice(ultimo, i), false, false)
    if (m[1] != null || m[2] != null) empujar(m[1] ?? m[2], true, false)
    else empujar(m[3] ?? m[4], false, true)
    ultimo = i + m[0].length
  }
  if (ultimo < limpio.length) empujar(limpio.slice(ultimo), false, false)
  return tramos
}

interface Palabra {
  texto: string
  estilo: Estilo
  espacio: boolean
  ancho: number
}

/** Párrafo con negritas y cursivas mezcladas (jsPDF no tiene texto enriquecido: se arma palabra por palabra). */
function dibujarTextoRico(
  e: Estado,
  texto: string,
  {
    x,
    ancho,
    tamano,
    color,
    interlinea,
    negrita = false,
  }: { x: number; ancho: number; tamano: number; color: RGB; interlinea: number; negrita?: boolean },
): void {
  const doc = e.doc
  const palabras: Palabra[] = []
  let espacioPendiente = false
  for (const tramo of tramosEnLinea(textoPdf(texto))) {
    const fuerte = negrita || tramo.negrita
    const estilo: Estilo = fuerte && tramo.cursiva ? 'bolditalic' : fuerte ? 'bold' : tramo.cursiva ? 'italic' : 'normal'
    for (const parte of tramo.texto.split(/(\s+)/)) {
      if (!parte) continue
      if (/^\s+$/.test(parte)) {
        espacioPendiente = true
        continue
      }
      fuente(doc, tamano, estilo)
      let resto = parte
      // Una "palabra" más ancha que el renglón (un link largo) se parte.
      while (anchoTexto(doc, resto) > ancho) {
        const pedazo = (doc.splitTextToSize(resto, ancho) as string[])[0] || resto.slice(0, 20)
        palabras.push({ texto: pedazo, estilo, espacio: espacioPendiente, ancho: anchoTexto(doc, pedazo) })
        espacioPendiente = false
        resto = resto.slice(pedazo.length)
      }
      if (resto) palabras.push({ texto: resto, estilo, espacio: espacioPendiente, ancho: anchoTexto(doc, resto) })
      espacioPendiente = false
    }
  }
  if (palabras.length === 0) return
  fuente(doc, tamano, 'normal')
  const espacio = anchoTexto(doc, ' ')

  const renglones: Palabra[][] = []
  let actual: Palabra[] = []
  let usado = 0
  for (const p of palabras) {
    const extra = actual.length && p.espacio ? espacio : 0
    if (actual.length && usado + extra + p.ancho > ancho) {
      renglones.push(actual)
      actual = [{ ...p, espacio: false }]
      usado = p.ancho
    } else {
      actual.push(p)
      usado += extra + p.ancho
    }
  }
  if (actual.length) renglones.push(actual)

  for (const renglon of renglones) {
    asegurar(e, interlinea)
    const yBase = e.y + interlinea * 0.72
    let cx = x
    renglon.forEach((p, i) => {
      if (i > 0 && p.espacio) cx += espacio
      fuente(doc, tamano, p.estilo, color)
      doc.text(p.texto, cx, yBase)
      cx += p.ancho
    })
    e.y += interlinea
  }
}

function dibujarSintesis(e: Estado, autoTable: FuncionAutoTable, md: string): void {
  const bloques = parsearMarkdown(md)
  if (bloques.length === 0) return
  const doc = e.doc
  const tamano = 9.5
  const interlinea = tamano * PT * 1.5

  asegurar(e, 18)
  // Volanta chica y espaciada: distinta de los títulos que traiga el markdown.
  fuente(doc, 7.5, 'bold', C.grisSuave)
  doc.text('SÍNTESIS', MARGEN, e.y + 2.8, { charSpace: 0.6 })
  e.y += 5.4

  bloques.forEach((b, indice) => {
    if (b.tipo === 'titulo') {
      const t = b.nivel <= 1 ? 11.5 : b.nivel === 2 ? 10.5 : 9.5
      asegurar(e, t * PT * 1.4 + interlinea * 2 + 2)
      if (indice > 0) e.y += 1.8
      dibujarTextoRico(e, b.texto, { x: MARGEN, ancho: UTIL, tamano: t, color: C.tinta, interlinea: t * PT * 1.4, negrita: true })
      e.y += 0.8
      return
    }
    if (b.tipo === 'parrafo') {
      dibujarTextoRico(e, b.texto, { x: MARGEN, ancho: UTIL, tamano, color: C.texto, interlinea })
      e.y += 2.2
      return
    }
    if (b.tipo === 'item') {
      const sangria = MARGEN + b.nivel * 4.6
      asegurar(e, interlinea)
      fuente(doc, tamano, b.marca === '•' ? 'bold' : 'normal', C.gris)
      // "10." es más ancho que "1.": el texto arranca después de la marca, sea cual sea.
      const anchoMarca = b.marca === '•' ? 3.6 : Math.max(5, anchoTexto(doc, b.marca) + 1.8)
      doc.text(b.marca, sangria + (b.marca === '•' ? 0.4 : 0), e.y + interlinea * 0.72)
      dibujarTextoRico(e, b.texto, { x: sangria + anchoMarca, ancho: UTIL - (sangria - MARGEN) - anchoMarca, tamano, color: C.texto, interlinea })
      e.y += 0.9
      return
    }
    if (b.tipo === 'separador') {
      asegurar(e, 6)
      lineaHorizontal(doc, MARGEN, ANCHO - MARGEN, e.y + 2.5, C.separador, 0.25)
      e.y += 5
      return
    }
    if (b.tipo === 'tabla' && b.filas.length > 0) {
      const columnas = b.filas[0].map((c) => textoPdf(c.replace(/\*\*/g, '')))
      const cuerpo = b.filas.slice(1).map((f) => columnas.map((_, j) => textoPdf((f[j] ?? '').replace(/\*\*/g, ''))))
      const alinear = alineacionesDeTabla({ titulo: '', columnas, filas: cuerpo })
      asegurar(e, 20)
      e.y += 1
      dibujarTablaCruda(e, autoTable, columnas, cuerpo, alinear)
      e.y -= 3
    }
  })
  e.y += 5
}

// ─────────────────────────────────────────────────────────────────────────────
// El informe
// ─────────────────────────────────────────────────────────────────────────────

export function dibujarInformeTex(
  doc: jsPDF,
  autoTable: FuncionAutoTable,
  informe: TexInforme,
  opciones: OpcionesDibujoPdf = {},
): void {
  const org = (opciones.orgNombre ?? '').trim()
  const fecha = opciones.fecha ?? new Date()
  const titulo = textoPdf(informe.titulo) || 'Informe'

  doc.setProperties({
    title: titulo,
    subject: textoPdf([informe.periodo, informe.alcance].filter(Boolean).join(' · ')),
    author: textoPdf(org),
    creator: 'Tex',
  })

  dibujarPortada(doc, informe, org)
  const e: Estado = { doc, y: Y_INICIO_PORTADA }

  const kpis = Array.isArray(informe.kpis) ? informe.kpis : []
  const graficos = Array.isArray(informe.graficos) ? informe.graficos : []
  const tablas = Array.isArray(informe.tablas) ? informe.tablas : []
  const sintesis = typeof informe.sintesis === 'string' ? informe.sintesis.trim() : ''

  dibujarKpis(e, kpis)
  if (sintesis) dibujarSintesis(e, autoTable, sintesis)
  for (const g of graficos) dibujarGrafico(e, g)
  for (const t of tablas) dibujarTabla(e, autoTable, t)

  if (!kpis.length && !graficos.length && !tablas.length && !sintesis) {
    fuente(doc, 9.5, 'normal', C.gris)
    doc.text('Este informe no tiene datos.', MARGEN, e.y + 4)
  }

  // Encabezado corrido y pie, ahora que se sabe cuántas páginas hay.
  const total = doc.getNumberOfPages()
  const pie = textoPdf(['Preparado con Tex', fechaHoraArgentina(fecha), org].filter(Boolean).join('  ·  '))
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    if (p > 1) dibujarEncabezadoCorrido(doc, informe, org)
    dibujarPie(doc, p, total, pie, opciones.caraTex ?? null)
  }
  doc.setPage(total)
}
