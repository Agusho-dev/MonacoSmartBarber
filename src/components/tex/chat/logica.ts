// =============================================================================
// Lógica pura del chat de Tex: qué está haciendo Tex, cómo se cuenta un paso,
// cómo se copia una respuesta para WhatsApp y cómo se agrupa el historial.
//
// Sin React ni DOM: lo usan la página, el panel y las pruebas del scratchpad
// (que corren este archivo con Node, así que los tipos van con `import type`).
// =============================================================================

import { metaHerramienta } from '@/lib/tex/contrato'
import type {
  TexCodigoAviso,
  TexCodigoError,
  TexConversacion,
  TexFase,
  TexSalidaUI,
  TexUIMessage,
} from '@/lib/tex/contrato'

export type TexParte = TexUIMessage['parts'][number]
export type ParteHerramienta = Extract<TexParte, { type: `tool-${string}` }>

/** Lo mismo que `ChatStatus` del AI SDK (se repite para no importar runtime). */
export type EstadoChat = 'submitted' | 'streaming' | 'ready' | 'error'

/** Lo que se ve de Tex: la cara del composer y la línea de estado salen de acá. */
export type EstadoTex = 'reposo' | 'pensando' | 'consultando' | 'hablando'

export const TEX_TZ = 'America/Argentina/Buenos_Aires'

// ─────────────────────────────────────────────────────────────────────────────
// Partes del mensaje
// ─────────────────────────────────────────────────────────────────────────────

export function esParteHerramienta(p: TexParte): p is ParteHerramienta {
  return typeof p.type === 'string' && p.type.startsWith('tool-')
}

export function nombreDeHerramienta(p: ParteHerramienta): string {
  return p.type.slice('tool-'.length)
}

/**
 * Sin emojis, como el resto de la interfaz (y como el PDF, que no los puede
 * dibujar): el prompt se lo pide a Tex, pero si igual escribe uno no se
 * muestra. Misma regla que la síntesis del informe (bloques/tex-markdown.tsx).
 */
export function sinEmojis(texto: string): string {
  const limpio = texto.replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, '')
  return limpio === texto ? texto : limpio.replace(/[ \t]+([.,;:!?)])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

/** El texto del mensaje (todas sus partes de texto, en orden). */
export function textoDeMensaje(m: Pick<TexUIMessage, 'parts'>): string {
  const trozos: string[] = []
  for (const p of m.parts) {
    if (p.type === 'text' && p.text.trim()) trozos.push(p.text.trim())
  }
  return trozos.join('\n\n')
}

/** La salida de una herramienta, si tiene la forma que dibuja la UI. */
export function salidaUI(valor: unknown): TexSalidaUI | null {
  if (!valor || typeof valor !== 'object') return null
  const o = valor as Partial<TexSalidaUI>
  return Array.isArray(o.bloques) ? (o as TexSalidaUI) : null
}

export type EstadoPaso = 'corriendo' | 'ok' | 'error'

export interface PasoTex {
  id: string
  nombre: string
  estado: EstadoPaso
  /** El input validado (o el parcial mientras llega). */
  input: unknown
  /** false mientras el input llega de a pedazos: sus argumentos todavía no se muestran ("· Par" → "· Paraná"). */
  inputCompleto: boolean
  salida: TexSalidaUI | null
  errorText: string | null
}

/** Las herramientas del mensaje, en el orden en que se llamaron. */
export function pasosDeMensaje(m: Pick<TexUIMessage, 'parts'>): PasoTex[] {
  const pasos: PasoTex[] = []
  for (const p of m.parts) {
    if (!esParteHerramienta(p)) continue
    const nombre = nombreDeHerramienta(p)
    if (p.state === 'output-available') {
      const salida = salidaUI(p.output)
      pasos.push({
        id: p.toolCallId,
        nombre,
        // "No pude leer" dentro de la salida también es un paso fallido (Known Risk #15).
        estado: salida?.error ? 'error' : 'ok',
        input: p.input,
        inputCompleto: true,
        salida,
        errorText: salida?.error ?? null,
      })
    } else if (p.state === 'output-error') {
      pasos.push({ id: p.toolCallId, nombre, estado: 'error', input: p.input, inputCompleto: true, salida: null, errorText: p.errorText })
    } else {
      pasos.push({
        id: p.toolCallId,
        nombre,
        estado: 'corriendo',
        input: p.input,
        inputCompleto: p.state === 'input-available',
        salida: null,
        errorText: null,
      })
    }
  }
  return pasos
}

/** ¿Llegó texto DESPUÉS de la última herramienta? (es lo que pliega la tarjeta de trabajo). */
export function hayTextoDespuesDeHerramientas(m: Pick<TexUIMessage, 'parts'>): boolean {
  let ultimaHerramienta = -1
  m.parts.forEach((p, i) => {
    if (esParteHerramienta(p)) ultimaHerramienta = i
  })
  return m.parts.some((p, i) => i > ultimaHerramienta && p.type === 'text' && p.text.trim() !== '')
}

/** ¿El mensaje ya muestra algo? Sin nada visible, Tex sigue "pensando". */
export function tienePartesVisibles(m: Pick<TexUIMessage, 'parts'>): boolean {
  return m.parts.some(
    (p) => (p.type === 'text' && p.text.trim() !== '') || esParteHerramienta(p) || p.type === 'data-aviso',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de Tex
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué está haciendo Tex. NO alcanza con `status === 'submitted'` (gotcha 5 del
 * protocolo): el chunk 'start' llega enseguida con el id del mensaje, el chat
 * pasa a 'streaming' con un mensaje del assistant VACÍO, y eso sigue siendo
 * "pensando". El `data-estado` transient (`fase`) es sólo el respaldo.
 */
export function derivarEstadoTex(args: {
  status: EstadoChat
  ultimo: Pick<TexUIMessage, 'role' | 'parts'> | undefined
  fase: TexFase | null
}): EstadoTex {
  const { status, ultimo, fase } = args
  if (status === 'ready' || status === 'error') return 'reposo'
  if (!ultimo || ultimo.role !== 'assistant') return 'pensando'
  const partes = ultimo.parts
  if (partes.some((p) => esParteHerramienta(p) && (p.state === 'input-streaming' || p.state === 'input-available'))) {
    return 'consultando'
  }
  for (let i = partes.length - 1; i >= 0; i--) {
    const p = partes[i]
    if (p.type === 'text') {
      if (p.text.trim() !== '') return status === 'streaming' ? 'hablando' : 'pensando'
      continue
    }
    // Terminó una herramienta y todavía no hay texto: Tex está leyendo el resultado.
    if (esParteHerramienta(p)) return 'pensando'
  }
  return fase === 'consultando' ? 'consultando' : 'pensando'
}

/**
 * "Está tardando más de lo normal": el pedido en curso pasó 8 s sin una letra.
 * Se cuenta por PEDIDO (un número que sube con cada envío, reintento o
 * "Volver a generar"), no por pregunta: "Volver a generar" reusa la misma
 * pregunta y el aviso del pedido anterior aparecía al instante.
 */
export function avisarLento(a: { ocupado: boolean; hayTexto: boolean; pedidoEnCurso: number; pedidoLento: number }): boolean {
  return a.ocupado && !a.hayTexto && a.pedidoLento === a.pedidoEnCurso
}

/** La herramienta que está corriendo ahora (la última que no terminó). */
export function pasoActivo(m: Pick<TexUIMessage, 'parts'> | undefined): PasoTex | null {
  if (!m) return null
  const pasos = pasosDeMensaje(m)
  for (let i = pasos.length - 1; i >= 0; i--) if (pasos[i].estado === 'corriendo') return pasos[i]
  return null
}

/** La línea de 12 px del encabezado (aria-live). Vacía en reposo. */
export function lineaDeEstado(
  estado: EstadoTex,
  activo: Pick<PasoTex, 'nombre' | 'input'> & { inputCompleto?: boolean } | null,
): string {
  switch (estado) {
    case 'pensando':
      return 'Pensando…'
    case 'consultando': {
      if (!activo) return 'Consultando los datos…'
      const meta = metaHerramienta(activo.nombre)
      const sucursal = activo.inputCompleto === false ? null : textoCorto(campo(activo.input, 'sucursal'))
      return `${meta.haciendo}${sucursal ? ` de ${sucursal}` : ''}…`
    }
    case 'hablando':
      return 'Escribiendo…'
    default:
      return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores y avisos: el texto exacto de la especificación
// ─────────────────────────────────────────────────────────────────────────────

export type AccionError = 'reintentar' | 'configurar' | 'planes' | 'nueva' | 'entrar' | null

/**
 * Qué se muestra ante un error del turno. La clave (sin_clave, clave_invalida)
 * sólo ofrece "Configurar Tex" a quien puede configurarlo; al resto no le sirve
 * saber de claves: se le dice que avise al dueño.
 */
export function varianteDeError(
  codigo: TexCodigoError,
  mensaje: string,
  puedeConfigurar: boolean,
): { texto: string; accion: AccionError } {
  const noDisponible = { texto: 'Tex no está disponible ahora. Avisale al dueño.', accion: null }
  switch (codigo) {
    case 'limite':
      return { texto: 'Hay muchas consultas seguidas. Esperá un momento.', accion: 'reintentar' }
    case 'sin_clave':
      return puedeConfigurar
        ? { texto: 'Para que Tex funcione falta conectar la clave de Anthropic. Se hace una sola vez.', accion: 'configurar' }
        : noDisponible
    case 'clave_invalida':
      return puedeConfigurar ? { texto: 'Anthropic rechazó la clave. Revisala en Configurar Tex.', accion: 'configurar' } : noDisponible
    case 'bloqueado':
      return { texto: 'Tex es parte de Enterprise.', accion: 'planes' }
    case 'cuota':
      return { texto: mensaje || 'Se terminaron las consultas de Tex de este mes.', accion: 'planes' }
    case 'sin_sesion':
      return { texto: 'Tu sesión se cerró. Volvé a entrar para seguir.', accion: 'entrar' }
    case 'no_encontrada':
      return { texto: 'No encontré esta conversación. Empezá una nueva.', accion: 'nueva' }
    case 'sin_permiso':
      return { texto: mensaje || 'Con tu usuario no podés usar Tex.', accion: null }
    case 'invalido':
      return { texto: mensaje || 'No pude leer el pedido. Probá de nuevo.', accion: 'reintentar' }
    default:
      return { texto: mensaje || 'Tex no pudo terminar la respuesta. Probá de nuevo.', accion: 'reintentar' }
  }
}

/** El texto de un aviso del turno: los de la especificación van literales. */
export function textoDeAviso(codigo: TexCodigoAviso, texto: string): string {
  switch (codigo) {
    case 'rechazo':
      return 'Eso no lo puedo responder. Probá preguntarlo de otra forma.'
    case 'limite_respuesta':
      return 'La respuesta se cortó por larga. Pedime que siga o que la resuma.'
    case 'interrumpido':
      return 'Detuviste la respuesta.'
    default:
      return texto?.trim() || 'No pude terminar esta respuesta.'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Argumentos legibles de un paso: "Paraná · octubre"
// ─────────────────────────────────────────────────────────────────────────────

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function campo(input: unknown, clave: string): unknown {
  if (!input || typeof input !== 'object') return undefined
  return (input as Record<string, unknown>)[clave]
}

function textoCorto(v: unknown, max = 40): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

interface Fecha {
  a: number
  m: number // 1..12
  d: number
}

/** "2026-10-01" o "2026-10-01T00:00:00…" → {a, m, d}. Sin `new Date()`: la zona del proceso no importa. */
function leerFecha(v: unknown): Fecha | null {
  if (typeof v !== 'string') return null
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!r) return null
  const f = { a: Number(r[1]), m: Number(r[2]), d: Number(r[3]) }
  if (f.m < 1 || f.m > 12 || f.d < 1 || f.d > 31) return null
  return f
}

function ultimoDiaDelMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

function diaCorto(f: Fecha, conAnio = false): string {
  return `${f.d} ${MESES_CORTOS[f.m - 1]}${conAnio ? ` ${f.a}` : ''}`
}

/** El período de un input: "20 oct", "1–21 oct", "octubre", "28 sep – 3 oct", "últimos 6 meses". */
export function periodoLegible(input: unknown): string | null {
  const desde = leerFecha(campo(input, 'desde'))
  const hasta = leerFecha(campo(input, 'hasta'))
  if (desde && hasta) {
    const mismoMes = desde.a === hasta.a && desde.m === hasta.m
    if (mismoMes && desde.d === hasta.d) return diaCorto(desde)
    if (mismoMes && desde.d === 1 && hasta.d === ultimoDiaDelMes(hasta.a, hasta.m)) return MESES[desde.m - 1]
    if (mismoMes) return `${desde.d}–${hasta.d} ${MESES_CORTOS[desde.m - 1]}`
    if (desde.a === hasta.a) return `${diaCorto(desde)} – ${diaCorto(hasta)}`
    return `${diaCorto(desde, true)} – ${diaCorto(hasta, true)}`
  }
  if (desde) return `desde el ${diaCorto(desde)}`
  if (hasta) return `hasta el ${diaCorto(hasta)}`

  const dia = leerFecha(campo(input, 'fecha')) ?? leerFecha(campo(input, 'dia'))
  if (dia) return diaCorto(dia)

  const mesFinal = campo(input, 'mesFinal') ?? campo(input, 'mes')
  const mf = typeof mesFinal === 'string' ? /^(\d{4})-(\d{2})/.exec(mesFinal) : null
  const nombreMes = mf && Number(mf[2]) >= 1 && Number(mf[2]) <= 12 ? MESES[Number(mf[2]) - 1] : null

  const meses = campo(input, 'mesesAtras') ?? campo(input, 'meses')
  if (typeof meses === 'number' && Number.isFinite(meses)) {
    if (meses === 0) return 'todo el historial'
    if (meses === 1) return nombreMes ?? 'este mes'
    return `últimos ${meses} meses`
  }
  return nombreMes
}

/** Los argumentos que vale la pena mostrar en el paso, en orden. */
export function argumentosLegibles(input: unknown): string[] {
  const out: string[] = []
  const sucursal = textoCorto(campo(input, 'sucursal'), 28)
  if (sucursal) out.push(sucursal)
  const periodo = periodoLegible(input)
  if (periodo) out.push(periodo)
  const busqueda = textoCorto(
    campo(input, 'query') ?? campo(input, 'consulta') ?? campo(input, 'busqueda') ?? campo(input, 'texto'),
    28,
  )
  if (busqueda) out.push(`“${busqueda}”`)
  if (out.length === 0) {
    const titulo = textoCorto(campo(input, 'titulo'), 48)
    if (titulo) out.push(titulo)
  }
  return out
}

/** "Leyendo las finanzas · Paraná · octubre" (el paso de la tarjeta de trabajo). */
export function textoDePaso(
  paso: Pick<PasoTex, 'nombre' | 'input' | 'estado' | 'errorText'> & { inputCompleto?: boolean },
  conArgumentos: boolean,
): string {
  const meta = metaHerramienta(paso.nombre)
  if (paso.estado === 'error') {
    const t = paso.errorText?.trim()
    // El servidor manda frases para la persona ("No pude leer las reseñas"); un
    // mensaje técnico (JSON, inglés) no se muestra tal cual.
    if (t && t.length <= 120 && !/[{}[\]]/.test(t)) return t
    return `No pude completar: ${meta.etiqueta}`
  }
  const args = conArgumentos && paso.inputCompleto !== false ? argumentosLegibles(paso.input) : []
  return [meta.haciendo, ...args].join(' · ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen plegado: "Consulté Finanzas y Estadísticas · 2,1 s"
// ─────────────────────────────────────────────────────────────────────────────

/** "A", "A y B", "A, B y C". */
export function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** "0,8 s" · "2,1 s" · "12 s" · "1 min 5 s". */
export function formatearDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 10_000) return `${(Math.max(ms, 100) / 1000).toFixed(1).replace('.', ',')} s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  const resto = s % 60
  return resto ? `${min} min ${resto} s` : `${min} min`
}

// Las herramientas que no "consultan" algo: se cuentan con su propio verbo.
const ACCIONES: Record<string, string> = {
  generar_informe: 'Armé el informe',
  sincronizar_mp: 'Traje los movimientos de Mercado Pago',
}

export function resumenPlegado(pasos: Pick<PasoTex, 'nombre' | 'estado'>[], duracionMs?: number | null): string {
  const consultas: string[] = []
  const acciones: string[] = []
  let graficos = 0
  let fallidos = 0
  for (const p of pasos) {
    if (p.estado === 'error') fallidos++
    if (p.nombre === 'graficar') {
      graficos++
      continue
    }
    const accion = ACCIONES[p.nombre]
    if (accion) {
      if (!acciones.includes(accion)) acciones.push(accion)
      continue
    }
    const etiqueta = metaHerramienta(p.nombre).etiqueta
    if (!consultas.includes(etiqueta)) consultas.push(etiqueta)
  }
  const frases: string[] = []
  if (consultas.length) frases.push(`Consulté ${enumerar(consultas)}`)
  if (graficos === 1) frases.push('Armé un gráfico')
  else if (graficos > 1) frases.push(`Armé ${graficos} gráficos`)
  frases.push(...acciones)
  if (fallidos > 0) frases.push(fallidos === 1 ? '1 sin leer' : `${fallidos} sin leer`)
  if (duracionMs != null && duracionMs > 0) frases.push(formatearDuracion(duracionMs))
  return frases.join(' · ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Copiar para WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

const NEGRITA = '\u0001'

function esSeparadorTabla(l: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')
}

function celdasDeTabla(l: string): string[] {
  let t = l.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

function filaATexto(encabezados: string[], celdas: string[]): string {
  // Las celdas vacías del final (filas cortas) no suman.
  const limpias = [...celdas]
  while (limpias.length > 1 && limpias[limpias.length - 1] === '') limpias.pop()
  if (limpias.length === 0) return ''
  if (limpias.length === 1) return limpias[0]
  const [primera, ...resto] = limpias
  if (resto.length === 1) return `${primera}: ${resto[0]}`
  return `${primera}: ${resto
    .map((v, i) => {
      const titulo = encabezados[i + 1]?.replace(/\*\*/g, '').trim()
      return titulo ? `${titulo} ${v}` : v
    })
    .join(' · ')}`
}

function convertirLinea(l: string): string {
  const titulo = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l)
  if (titulo) {
    const t = titulo[1].replace(/\*\*|__/g, '').trim()
    return t ? `**${t}**` : ''
  }
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) return ''
  const item = /^(\s*)[-*+]\s+(.*)$/.exec(l)
  if (item) return `${item[1]}• ${item[2]}`
  return l
}

function convertirEnLinea(t: string): string {
  return (
    t
      // imágenes fuera; los enlaces internos del dashboard no sirven afuera
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, texto: string, url: string) =>
        /^https?:\/\//i.test(url) ? `${texto} (${url})` : texto,
      )
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, `${NEGRITA}$1${NEGRITA}`)
      .replace(/__(?=\S)([\s\S]*?\S)__/g, `${NEGRITA}$1${NEGRITA}`)
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1_$2_')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '~$1~')
      .replace(/`([^`\n]+)`/g, '$1')
      .split(NEGRITA)
      .join('*')
  )
}

/**
 * Markdown → texto para WhatsApp: `**x**` → `*x*`, cursiva → `_x_`, títulos en
 * negrita sin `#`, viñetas "•", y las tablas en renglones ("Paraná: $1.234.000";
 * con más columnas, "Lucas: Cortes 120 · Facturación $1.200.000"). Los bloques
 * de código quedan tal cual.
 */
export function aWhatsApp(md: string): string {
  const lineas = sinEmojis(md).replace(/\r\n?/g, '\n').split('\n')
  const salida: string[] = []
  let enCodigo = false
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    if (/^\s*```/.test(l)) {
      enCodigo = !enCodigo
      salida.push(l.trim())
      continue
    }
    if (enCodigo) {
      salida.push(l)
      continue
    }
    if (l.includes('|') && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      const encabezados = celdasDeTabla(l)
      i += 2
      while (i < lineas.length && lineas[i].includes('|') && lineas[i].trim() !== '') {
        const fila = filaATexto(encabezados, celdasDeTabla(lineas[i]))
        if (fila) salida.push(convertirEnLinea(fila))
        i++
      }
      i--
      continue
    }
    salida.push(convertirEnLinea(convertirLinea(l)))
  }
  return salida
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Lo que copia "Copiar para WhatsApp": el texto; si la respuesta es sólo bloques, sus cifras. */
export function textoParaCompartir(m: Pick<TexUIMessage, 'parts'>): string {
  const texto = textoDeMensaje(m)
  if (texto) return aWhatsApp(texto)
  const renglones: string[] = []
  for (const paso of pasosDeMensaje(m)) {
    for (const b of paso.salida?.bloques ?? []) {
      if (b.tipo === 'kpis') {
        if (b.titulo) renglones.push(`*${b.titulo}*`)
        for (const k of b.items) renglones.push(`${k.etiqueta}: ${k.valor}`)
      } else if (b.tipo === 'informe') {
        renglones.push(`*${b.informe.titulo}*`)
        if (b.informe.periodo) renglones.push(b.informe.periodo)
        for (const k of b.informe.kpis) renglones.push(`${k.etiqueta}: ${k.valor}`)
      } else if (b.tipo === 'conciliacion') {
        renglones.push(`*${b.veredicto.titular}*`, b.veredicto.detalle)
      }
    }
    if (paso.salida?.fuente && renglones.length) renglones.push(`_Fuente: ${paso.salida.fuente}_`)
  }
  return renglones.join('\n').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Historial
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoHistorial = 'Fijadas' | 'Hoy' | 'Ayer' | 'Esta semana' | 'Antes'

const ORDEN_GRUPOS: GrupoHistorial[] = ['Fijadas', 'Hoy', 'Ayer', 'Esta semana', 'Antes']

const formatosDia = new Map<string, Intl.DateTimeFormat>()

function diaEnZona(ms: number, tz: string): string {
  let f = formatosDia.get(tz)
  if (!f) {
    // en-CA da YYYY-MM-DD.
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    formatosDia.set(tz, f)
  }
  return f.format(ms)
}

function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/**
 * Fijadas · Hoy · Ayer · Esta semana (desde el lunes) · Antes. El día se toma en
 * la zona del negocio y no en la del proceso: así el servidor (UTC) y el
 * navegador dibujan los mismos grupos y la hidratación no se rompe a las 21 h.
 */
export function agruparConversaciones(
  lista: TexConversacion[],
  ahoraMs: number,
  tz: string = TEX_TZ,
): { grupo: GrupoHistorial; items: TexConversacion[] }[] {
  const hoy = diaEnZona(ahoraMs, tz)
  const lunes = (new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10))).getUTCDay() + 6) % 7
  const grupos = new Map<GrupoHistorial, TexConversacion[]>()
  const ordenadas = [...lista].sort((a, b) => (Date.parse(b.actualizada) || 0) - (Date.parse(a.actualizada) || 0))
  for (const c of ordenadas) {
    let g: GrupoHistorial
    if (c.fijada) g = 'Fijadas'
    else {
      const ms = Date.parse(c.actualizada)
      if (!Number.isFinite(ms)) g = 'Antes'
      else {
        const d = diasEntre(diaEnZona(ms, tz), hoy)
        g = d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : d <= lunes ? 'Esta semana' : 'Antes'
      }
    }
    const items = grupos.get(g) ?? []
    items.push(c)
    grupos.set(g, items)
  }
  return ORDEN_GRUPOS.filter((g) => grupos.has(g)).map((g) => ({ grupo: g, items: grupos.get(g)! }))
}

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Buscador del historial: todas las palabras, sin importar acentos ni orden. */
export function filtrarConversaciones(lista: TexConversacion[], consulta: string): TexConversacion[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return lista
  return lista.filter((c) => {
    const t = normalizar(c.titulo || '')
    return palabras.every((p) => t.includes(p))
  })
}

/**
 * El historial trae las conversaciones más recientes (hasta 200): una más
 * vieja se encuentra buscándola por su título en el servidor. Con la lista
 * llena, el riel lo avisa.
 */
export const HISTORIAL_VISIBLE = 200

/** Con menos letras no se busca en el servidor (el filtro local ya alcanza). */
export const MIN_BUSQUEDA_SERVIDOR = 2

/**
 * La búsqueda en el riel: lo que filtró la lista cargada (instantáneo) más lo
 * que encontró el servidor entre las conversaciones que no están cargadas,
 * sin repetir y sin las que se están borrando. De una conversación cargada
 * manda la versión de la lista: tiene el título y el fijado al día.
 */
export function mezclarBusqueda(
  locales: TexConversacion[],
  remotas: TexConversacion[],
  cargadas: TexConversacion[],
  excluir: ReadonlySet<string> = new Set(),
): TexConversacion[] {
  const salida = locales.filter((c) => !excluir.has(c.id))
  const vistos = new Set([...cargadas.map((c) => c.id), ...excluir])
  for (const c of remotas) {
    if (vistos.has(c.id)) continue
    vistos.add(c.id)
    salida.push(c)
  }
  return salida
}

/**
 * La lista recién leída del servidor reemplaza a la que había, salvo la
 * conversación abierta: si se abrió desde la búsqueda (no está entre las
 * más recientes), sigue en el riel.
 */
export function fusionarHistorial(
  nueva: TexConversacion[],
  anterior: TexConversacion[],
  mantenerId: string | null,
): TexConversacion[] {
  if (!mantenerId || nueva.some((c) => c.id === mantenerId)) return nueva
  const abierta = anterior.find((c) => c.id === mantenerId)
  return abierta ? [...nueva, abierta] : nueva
}

/**
 * El riel después de volver a leer el historial con la pantalla abierta.
 * `listarConversacionesTex` tira si no pudo leer, pero sin sesión (o sin
 * acceso a Tex) devuelve [] sin tirar: una lista que de golpe viene vacía no
 * borra la que se estaba viendo (con la sesión vencida, el riel decía
 * "Todavía no hay conversaciones"). Las que se borran en esta pantalla ya
 * salen de la lista solas.
 */
export function historialRefrescado(
  nueva: TexConversacion[],
  anterior: TexConversacion[],
  mantenerId: string | null,
): TexConversacion[] {
  if (nueva.length === 0 && anterior.length > 0) return anterior
  return fusionarHistorial(nueva, anterior, mantenerId)
}

/** Cambia (o suma, si vino de la búsqueda) una conversación de la lista. */
export function cambiarEnLista(
  lista: TexConversacion[],
  c: TexConversacion,
  cambios: Partial<Omit<TexConversacion, 'id'>> = {},
): TexConversacion[] {
  return lista.some((x) => x.id === c.id) ? lista.map((x) => (x.id === c.id ? { ...x, ...cambios } : x)) : [...lista, { ...c, ...cambios }]
}

/**
 * ¿`cargarConversacionTex` dijo que la conversación NO EXISTE (o es de otra
 * persona)? Sólo eso borra `?c=` y dice "No encontré esa conversación". Un
 * error de lectura (base caída, timeout, sesión) no: la conversación puede
 * estar intacta y se ofrece reintentar. Ante la duda, error.
 */
export function esConversacionNoEncontrada(r: { error?: string; codigo?: unknown } | null | undefined): boolean {
  if (!r) return false
  if (r.codigo != null) return r.codigo === 'no_encontrada'
  return /^no encontr(amos|e) esa conversacion/.test(normalizar(r.error ?? ''))
}

/** Título mientras Tex no puso el suyo: las primeras ~60 letras, cortadas en una palabra. */
export function tituloProvisorio(texto: string): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length <= 60) return t
  const corte = t.slice(0, 60)
  const espacio = corte.lastIndexOf(' ')
  return `${(espacio > 30 ? corte.slice(0, espacio) : corte).trimEnd()}…`
}

// ─────────────────────────────────────────────────────────────────────────────
// Saludo, hora, ids
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Buen día" hasta las 12:59, "Buenas tardes" de 13 a 19:59, "Buenas noches"
 * desde las 20. La especificación no dice dónde empieza el día: de 0 a 5:59
 * también es "Buenas noches" (nadie saluda "Buen día" a la 1 de la mañana).
 */
export function saludoPorHora(hora: number, nombre: string | null | undefined): string {
  const saludo = hora >= 6 && hora < 13 ? 'Buen día' : hora >= 13 && hora < 20 ? 'Buenas tardes' : 'Buenas noches'
  const n = nombre?.trim()
  return n ? `${saludo}, ${n}.` : `${saludo}.`
}

/** "14:32" en la hora del negocio (igual en el servidor y en el navegador). */
export function horaCorta(ms: number, tz: string = TEX_TZ): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)
}

export { esUuid, nuevoUuid } from './ids'

// ─────────────────────────────────────────────────────────────────────────────
// Recetas del composer ("+")
// ─────────────────────────────────────────────────────────────────────────────

export interface RecetaTex {
  id: string
  etiqueta: string
  plantilla: string
  /** Sólo si la persona ve la conciliación con Mercado Pago. */
  conciliacion?: boolean
}

export const TEX_RECETAS: RecetaTex[] = [
  { id: 'informe', etiqueta: 'Informe en PDF', plantilla: 'Informe en PDF de [período]' },
  { id: 'comparar', etiqueta: 'Comparar períodos', plantilla: 'Comparar [período] contra [período]' },
  { id: 'cuadro', etiqueta: '¿Cuadró la plata?', plantilla: '¿Cuadró la plata de [día]?', conciliacion: true },
]

/** El próximo hueco "[…]" a partir de `desde` (para seleccionarlo y escribir encima). */
export function huecoDesde(texto: string, desde = 0): [number, number] | null {
  const re = /\[[^\]\n]{1,40}\]/g
  re.lastIndex = Math.max(0, desde)
  const m = re.exec(texto)
  return m ? [m.index, m.index + m[0].length] : null
}
