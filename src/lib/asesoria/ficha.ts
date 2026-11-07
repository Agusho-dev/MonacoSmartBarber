/**
 * Ficha de asesoría (mig 238): el catálogo de preguntas y opciones, la forma de
 * los datos, la validación de lo que llega al servidor y los textos del resumen
 * («la receta») que el barbero ve la próxima vez.
 *
 * Módulo PURO (sin React, sin Supabase): lo usan el panel del barbero y las
 * server actions de `src/lib/actions/ficha-asesoria.ts`. Las claves son las que
 * se guardan en `client_asesorias.datos`: cambiar una clave existente deja
 * datos viejos sin leer; sumar una opción nueva no pide migración.
 *
 * El orden y el texto de las preguntas son los que mandó el dueño (7/nov/2026).
 * Convención de los datos: clave ausente = sin responder; en las preguntas de
 * varias opciones, `[]` = «nada / ninguno» (respondida).
 */

// ─── Catálogo ────────────────────────────────────────────────────────────────

export interface OpcionFicha<K extends string = string> {
  clave: K
  /** Lo que dice el botón. */
  texto: string
}

export const FRECUENCIAS = [
  { clave: 'semana', texto: '1 semana', enFrase: 'cada semana' },
  { clave: 'quincena', texto: '15 días', enFrase: 'cada 15 días' },
  { clave: 'mes', texto: '1 mes', enFrase: 'cada mes' },
  { clave: 'dos_meses', texto: '2 meses', enFrase: 'cada 2 meses' },
  { clave: 'tres_meses', texto: '+3 meses', enFrase: 'cada 3 meses o más' },
] as const satisfies ReadonlyArray<OpcionFicha & { enFrase: string }>

export const PARTES_QUE_CRECEN = [
  { clave: 'flequillo', texto: 'Flequillo' },
  { clave: 'remolino', texto: 'Remolino' },
  { clave: 'bajando_fade', texto: 'Bajando el fade' },
  { clave: 'forma_cuadrada', texto: 'Va hacia forma cuadrada' },
  { clave: 'atras', texto: 'Atrás' },
] as const satisfies ReadonlyArray<OpcionFicha>

export const PRODUCTOS = [
  { clave: 'cera_mate', texto: 'Cera mate' },
  { clave: 'cera_brillosa', texto: 'Cera brillosa' },
  { clave: 'polvo', texto: 'Polvo de texturizar' },
  { clave: 'crema', texto: 'Crema de peinar' },
  { clave: 'mousse', texto: 'Mousse' },
  { clave: 'gel', texto: 'Gel' },
  { clave: 'laca', texto: 'Laca / fijador' },
] as const satisfies ReadonlyArray<OpcionFicha>

export const FORMAS = [
  { clave: 'cuadrada', texto: 'Cuadrada' },
  { clave: 'redonda', texto: 'Redonda' },
  { clave: 'triangular', texto: 'Triangular' },
] as const satisfies ReadonlyArray<OpcionFicha>

/**
 * Particularidades craneales. `opuesta`: las dos del occipital no pueden ir
 * juntas (prominente o plano), así que elegir una apaga la otra.
 */
export const ZONAS_CRANEO = [
  { clave: 'mastoides', texto: 'Hendiduras en mastoides' },
  { clave: 'occipital_prominente', texto: 'Occipital prominente', opuesta: 'occipital_plano' },
  { clave: 'cuspide_alta', texto: 'Cúspide alta' },
  { clave: 'nariz', texto: 'Cuidar nariz' },
  { clave: 'orejas', texto: 'Cuidar orejas' },
  { clave: 'occipital_plano', texto: 'Occipital plano', opuesta: 'occipital_prominente' },
  { clave: 'pliegues_nuca', texto: 'Pliegues de nuca' },
  { clave: 'pliegues_craneales', texto: 'Pliegues craneales' },
  { clave: 'menton_retraido', texto: 'Mentón retraído' },
  { clave: 'entradas', texto: 'Entradas' },
] as const satisfies ReadonlyArray<OpcionFicha & { opuesta?: string }>

export const CORTES = [
  { clave: 'taper_fade', texto: 'Taper Fade' },
  { clave: 'french_crop', texto: 'French Crop' },
  { clave: 'americano', texto: 'Americano' },
  { clave: 'mohicano', texto: 'Mohicano' },
  { clave: 'mullet', texto: 'Mullet' },
  { clave: 'mod_cut', texto: 'Mod Cut' },
  { clave: 'wolf_cut', texto: 'Wolf Cut' },
  { clave: 'modern_mullet', texto: 'Modern Mullet' },
  { clave: 'buzz_cut', texto: 'Buzz Cut' },
  { clave: 'mid_part', texto: 'Mid Part' },
  { clave: 'otro', texto: 'Otro' },
] as const satisfies ReadonlyArray<OpcionFicha>

/** De arriba hacia abajo, como se ven en la cabeza. «Tijera» = sin fade. */
export const ALTURAS_FADE = [
  { clave: 'high', texto: 'High Fade' },
  { clave: 'mid', texto: 'Mid Fade' },
  { clave: 'low', texto: 'Low Fade' },
  { clave: 'tijera', texto: 'Tijera' },
] as const satisfies ReadonlyArray<OpcionFicha>

export const NUMEROS_FADE = [
  { clave: '0', texto: '0' },
  { clave: '0.5', texto: '0,5' },
  { clave: '1', texto: '1' },
  { clave: '2', texto: '2' },
  { clave: '3', texto: '3' },
] as const satisfies ReadonlyArray<OpcionFicha>

export const PARTICULARIDADES = [
  { clave: 'alopecia', texto: 'Alopecia' },
  { clave: 'lunares', texto: 'Lunares' },
  { clave: 'hongos', texto: 'Hongos' },
  { clave: 'remolinos_ocultos', texto: 'Remolinos que no se ven' },
] as const satisfies ReadonlyArray<OpcionFicha>

/**
 * Atajos para «¿Qué le molesta?»: un toque escribe la frase en la caja (que
 * sigue siendo texto libre). Tipear en la tablet mientras se corta es lo más
 * lento de la ficha.
 */
export const ATAJOS_MOLESTIA = [
  'Que le quede muy corto',
  'Que se le vea el cuero',
  'El volumen de arriba',
  'Que se le abra el remolino',
  'Las patillas',
  'La nuca desprolija',
] as const

export type ClaveFrecuencia = (typeof FRECUENCIAS)[number]['clave']
export type ClaveCrecer = (typeof PARTES_QUE_CRECEN)[number]['clave']
export type ClaveProducto = (typeof PRODUCTOS)[number]['clave']
export type ClaveForma = (typeof FORMAS)[number]['clave']
export type ClaveZona = (typeof ZONAS_CRANEO)[number]['clave']
export type ClaveCorte = (typeof CORTES)[number]['clave']
export type ClaveAltura = (typeof ALTURAS_FADE)[number]['clave']
export type ClaveNumero = (typeof NUMEROS_FADE)[number]['clave']
export type ClaveParticularidad = (typeof PARTICULARIDADES)[number]['clave']

/** Lo que se guarda en `client_asesorias.datos`. */
export interface DatosFicha {
  frecuencia?: ClaveFrecuencia
  molesta?: boolean
  molesta_detalle?: string
  crecer?: ClaveCrecer[]
  productos_usa?: ClaveProducto[]
  productos_recomendados?: ClaveProducto[]
  forma?: ClaveForma
  craneo?: ClaveZona[]
  corte?: ClaveCorte
  corte_otro?: string
  fade_altura?: ClaveAltura
  fade_numero?: ClaveNumero
  particularidades?: ClaveParticularidad[]
}

export type CampoFicha = keyof DatosFicha

/** Topes de los textos libres. */
export const TOPE_DETALLE_MOLESTIA = 300
export const TOPE_CORTE_OTRO = 60

// ─── Preguntas (orden del dueño) ─────────────────────────────────────────────

export type ClavePregunta =
  | 'frecuencia'
  | 'molesta'
  | 'crecer'
  | 'productos_usa'
  | 'productos_recomendados'
  | 'forma'
  | 'craneo'
  | 'corte'
  | 'fade_altura'
  | 'fade_numero'
  | 'particularidades'

export type CapituloFicha = 'charla' | 'cabeza' | 'corte' | 'cuidados'

export interface PreguntaFicha {
  clave: ClavePregunta
  titulo: string
  /** Rótulo corto (la tarjeta perforada, «Falta: …»). */
  corto: string
  capitulo: CapituloFicha
}

export const PREGUNTAS: readonly PreguntaFicha[] = [
  { clave: 'frecuencia', titulo: '¿Cada cuánto se corta?', corto: 'Frecuencia', capitulo: 'charla' },
  { clave: 'molesta', titulo: '¿Qué le molesta o no le gusta?', corto: 'Le molesta', capitulo: 'charla' },
  { clave: 'crecer', titulo: '¿Se está dejando crecer alguna parte?', corto: 'Crecer', capitulo: 'charla' },
  { clave: 'productos_usa', titulo: '¿Usa algún producto?', corto: 'Usa', capitulo: 'charla' },
  {
    clave: 'productos_recomendados',
    titulo: '¿Se le recomendó algún producto?',
    corto: 'Recomendado',
    capitulo: 'charla',
  },
  { clave: 'forma', titulo: 'Forma superior', corto: 'Forma', capitulo: 'cabeza' },
  { clave: 'craneo', titulo: 'Particularidades craneales', corto: 'Cráneo', capitulo: 'cabeza' },
  { clave: 'corte', titulo: '¿Qué corte se realiza?', corto: 'Corte', capitulo: 'corte' },
  { clave: 'fade_altura', titulo: 'Altura del fade', corto: 'Altura', capitulo: 'corte' },
  { clave: 'fade_numero', titulo: '¿Desde qué número el fade?', corto: 'Número', capitulo: 'corte' },
  { clave: 'particularidades', titulo: '¿Tiene alguna particularidad?', corto: 'Particularidad', capitulo: 'cuidados' },
]

export const CAPITULOS: Record<CapituloFicha, string> = {
  charla: 'La charla',
  cabeza: 'La cabeza',
  corte: 'El corte',
  cuidados: 'Cuidados',
}

/** El número no aplica a un corte a tijera. */
export function aplicaPregunta(datos: DatosFicha, clave: ClavePregunta): boolean {
  if (clave === 'fade_numero') return datos.fade_altura !== 'tijera'
  return true
}

export function respondida(datos: DatosFicha, clave: ClavePregunta): boolean {
  switch (clave) {
    case 'frecuencia':
      return datos.frecuencia != null
    case 'molesta':
      return datos.molesta != null
    case 'crecer':
      return Array.isArray(datos.crecer)
    case 'productos_usa':
      return Array.isArray(datos.productos_usa)
    case 'productos_recomendados':
      return Array.isArray(datos.productos_recomendados)
    case 'forma':
      return datos.forma != null
    case 'craneo':
      return Array.isArray(datos.craneo)
    case 'corte':
      return datos.corte != null
    case 'fade_altura':
      return datos.fade_altura != null
    case 'fade_numero':
      return datos.fade_numero != null
    case 'particularidades':
      return Array.isArray(datos.particularidades)
  }
}

export interface ProgresoFicha {
  hechas: number
  /** Las que aplican (sin el número del fade si es a tijera). */
  total: number
  faltan: PreguntaFicha[]
  completa: boolean
}

export function progresoFicha(datos: DatosFicha): ProgresoFicha {
  const aplican = PREGUNTAS.filter((p) => aplicaPregunta(datos, p.clave))
  const faltan = aplican.filter((p) => !respondida(datos, p.clave))
  return {
    hechas: aplican.length - faltan.length,
    total: aplican.length,
    faltan,
    completa: faltan.length === 0,
  }
}

export function fichaVacia(datos: DatosFicha | null | undefined): boolean {
  if (!datos) return true
  return PREGUNTAS.every((p) => !respondida(datos, p.clave))
}

// ─── Validación (servidor) y lectura defensiva ───────────────────────────────

type Validador = (valor: unknown) => { ok: true; valor: unknown } | { ok: false }

function unaDe(opciones: ReadonlyArray<{ clave: string }>): Validador {
  const validas = new Set(opciones.map((o) => o.clave))
  return (v) => (typeof v === 'string' && validas.has(v) ? { ok: true, valor: v } : { ok: false })
}

function variasDe(opciones: ReadonlyArray<{ clave: string }>): Validador {
  const validas = new Set(opciones.map((o) => o.clave))
  return (v) => {
    if (!Array.isArray(v) || v.length > validas.size) return { ok: false }
    const vistas = new Set<string>()
    for (const x of v) {
      if (typeof x !== 'string' || !validas.has(x) || vistas.has(x)) return { ok: false }
      vistas.add(x)
    }
    // Mismo orden que el catálogo: dos fichas iguales se guardan iguales.
    return { ok: true, valor: opciones.map((o) => o.clave).filter((c) => vistas.has(c)) }
  }
}

function texto(tope: number): Validador {
  return (v) => {
    if (typeof v !== 'string') return { ok: false }
    const limpio = v.replace(/\s+/g, ' ').trim()
    if (!limpio || limpio.length > tope) return { ok: false }
    return { ok: true, valor: limpio }
  }
}

const VALIDADORES: Record<CampoFicha, Validador> = {
  frecuencia: unaDe(FRECUENCIAS),
  molesta: (v) => (typeof v === 'boolean' ? { ok: true, valor: v } : { ok: false }),
  molesta_detalle: texto(TOPE_DETALLE_MOLESTIA),
  crecer: variasDe(PARTES_QUE_CRECEN),
  productos_usa: variasDe(PRODUCTOS),
  productos_recomendados: variasDe(PRODUCTOS),
  forma: unaDe(FORMAS),
  craneo: (v) => {
    const r = variasDe(ZONAS_CRANEO)(v)
    if (!r.ok) return r
    const lista = r.valor as string[]
    // Prominente y plano a la vez no existe.
    if (lista.includes('occipital_prominente') && lista.includes('occipital_plano')) return { ok: false }
    return r
  },
  corte: unaDe(CORTES),
  corte_otro: texto(TOPE_CORTE_OTRO),
  fade_altura: unaDe(ALTURAS_FADE),
  fade_numero: unaDe(NUMEROS_FADE),
  particularidades: variasDe(PARTICULARIDADES),
}

export const CAMPOS_FICHA = Object.keys(VALIDADORES) as CampoFicha[]

function esCampo(c: unknown): c is CampoFicha {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(VALIDADORES, c)
}

/**
 * Valida un cambio parcial que llega del panel: cada clave tiene que ser del
 * catálogo y cada valor válido. Una clave que aparece en `quitar` no puede venir
 * también en `cambios`. Cualquier cosa rara rechaza el cambio entero (es un
 * endpoint HTTP: no se guarda «lo que se pueda»).
 */
export function limpiarCambiosFicha(
  cambios: unknown,
  quitar: unknown,
): { ok: true; cambios: DatosFicha; quitar: CampoFicha[] } | { ok: false; error: string } {
  if (cambios === null || typeof cambios !== 'object' || Array.isArray(cambios)) {
    return { ok: false, error: 'Cambios inválidos.' }
  }
  if (!Array.isArray(quitar) || quitar.length > CAMPOS_FICHA.length) {
    return { ok: false, error: 'Cambios inválidos.' }
  }
  const limpio: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(cambios as Record<string, unknown>)) {
    if (!esCampo(clave)) return { ok: false, error: 'Cambios inválidos.' }
    const r = VALIDADORES[clave](valor)
    if (!r.ok) return { ok: false, error: 'Cambios inválidos.' }
    limpio[clave] = r.valor
  }
  const aQuitar = new Set<CampoFicha>()
  for (const c of quitar) {
    if (!esCampo(c) || c in limpio) return { ok: false, error: 'Cambios inválidos.' }
    aQuitar.add(c)
  }
  if (Object.keys(limpio).length === 0 && aQuitar.size === 0) {
    return { ok: false, error: 'No hay nada que guardar.' }
  }
  return { ok: true, cambios: limpio as DatosFicha, quitar: [...aQuitar] }
}

/**
 * Lee `datos` de la base (o del almacenamiento local) quedándose sólo con lo
 * que el catálogo de HOY entiende: una opción que se sacó del catálogo no rompe
 * la pantalla, se ignora.
 */
export function leerDatosFicha(crudo: unknown): DatosFicha {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) return {}
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(crudo as Record<string, unknown>)) {
    if (!esCampo(clave)) continue
    const r = VALIDADORES[clave](valor)
    if (r.ok) salida[clave] = r.valor
  }
  return salida as DatosFicha
}

/** Aplica un cambio parcial a una ficha (lo mismo que hace `asesoria_guardar`). */
export function aplicarCambios(datos: DatosFicha, cambios: DatosFicha, quitar: readonly CampoFicha[]): DatosFicha {
  const salida: Record<string, unknown> = { ...datos, ...cambios }
  for (const c of quitar) delete salida[c]
  return salida as DatosFicha
}

/** ¿Dos valores de un campo son iguales? (las listas, por contenido). */
export function mismoValor(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

// ─── Textos («la receta») ────────────────────────────────────────────────────

function textoDe<K extends string>(opciones: ReadonlyArray<{ clave: K; texto: string }>, clave: K | undefined) {
  return clave ? (opciones.find((o) => o.clave === clave)?.texto ?? null) : null
}

function lista<K extends string>(opciones: ReadonlyArray<{ clave: K; texto: string }>, claves: readonly K[] | undefined) {
  return (claves ?? []).map((c) => opciones.find((o) => o.clave === c)?.texto).filter((t): t is string => !!t)
}

/** «Que le quede corto» → «que le quede corto» (para seguir una frase). No toca siglas («LED»). */
function minusculaInicial(texto: string): string {
  const [a, b] = texto
  return a && b && a !== a.toLowerCase() && b === b.toLowerCase() ? a.toLowerCase() + texto.slice(1) : texto
}

/** «uno, dos y tres». */
export function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

export function textoCorte(datos: DatosFicha): string | null {
  if (!datos.corte) return null
  if (datos.corte === 'otro') return datos.corte_otro?.trim() || 'Otro corte'
  return textoDe(CORTES, datos.corte)
}

/** «Mid Fade desde el 0,5», «A tijera», «Fade desde el 1». */
export function textoFade(datos: DatosFicha): string | null {
  if (datos.fade_altura === 'tijera') return 'A tijera'
  const altura = textoDe(ALTURAS_FADE, datos.fade_altura)
  const numero = textoDe(NUMEROS_FADE, datos.fade_numero)
  if (altura && numero) return `${altura} desde el ${numero}`
  if (altura) return altura
  if (numero) return `Fade desde el ${numero}`
  return null
}

/** El renglón grande de la receta: «French Crop · Mid Fade desde el 0,5». */
export function titularDeFicha(datos: DatosFicha): string | null {
  const partes = [textoCorte(datos), textoFade(datos)].filter((p): p is string => !!p)
  return partes.length > 0 ? partes.join(' · ') : null
}

export type TipoRenglonFicha = 'cabeza' | 'molesta' | 'cuidados' | 'frecuencia' | 'crecer' | 'productos'

export interface RenglonFicha {
  tipo: TipoRenglonFicha
  texto: string
  /** Lo que conviene mirar antes de agarrar la máquina (cuidados, lo que no le gusta). */
  atencion?: boolean
}

/**
 * Los renglones de la receta, en el orden en que le sirven al barbero con el
 * cliente sentado: la cabeza y lo que no le gusta primero; lo de la charla,
 * después. Sólo lo respondido.
 */
export function renglonesDeFicha(datos: DatosFicha): RenglonFicha[] {
  const renglones: RenglonFicha[] = []

  const forma = textoDe(FORMAS, datos.forma)
  const craneo = lista(ZONAS_CRANEO, datos.craneo)
  const cabeza = [forma ? `Forma ${forma.toLowerCase()}` : null, ...craneo].filter((t): t is string => !!t)
  if (cabeza.length > 0) renglones.push({ tipo: 'cabeza', texto: cabeza.join(' · ') })

  if (datos.molesta === true) {
    const detalle = datos.molesta_detalle?.trim()
    renglones.push({
      tipo: 'molesta',
      texto: detalle ? `No le gusta: ${minusculaInicial(detalle)}` : 'Hay algo que no le gusta',
      atencion: true,
    })
  } else if (datos.molesta === false) {
    renglones.push({ tipo: 'molesta', texto: 'Nada le molesta' })
  }

  if (Array.isArray(datos.particularidades)) {
    const p = lista(PARTICULARIDADES, datos.particularidades)
    renglones.push(
      p.length > 0
        ? { tipo: 'cuidados', texto: p.join(' · '), atencion: true }
        : { tipo: 'cuidados', texto: 'Sin particularidades' },
    )
  }

  const frecuencia = FRECUENCIAS.find((f) => f.clave === datos.frecuencia)
  if (frecuencia) renglones.push({ tipo: 'frecuencia', texto: `Se corta ${frecuencia.enFrase}` })

  if (Array.isArray(datos.crecer)) {
    const c = lista(PARTES_QUE_CRECEN, datos.crecer).map((t) => t.toLowerCase())
    renglones.push({ tipo: 'crecer', texto: c.length > 0 ? `Se deja crecer: ${enumerar(c)}` : 'No se deja crecer nada' })
  }

  const usa = Array.isArray(datos.productos_usa) ? lista(PRODUCTOS, datos.productos_usa).map((t) => t.toLowerCase()) : null
  const reco = Array.isArray(datos.productos_recomendados)
    ? lista(PRODUCTOS, datos.productos_recomendados).map((t) => t.toLowerCase())
    : null
  const productos = [
    usa ? (usa.length > 0 ? `Usa ${enumerar(usa)}` : 'No usa productos') : null,
    reco && reco.length > 0 ? `le recomendamos ${enumerar(reco)}` : null,
  ].filter((t): t is string => !!t)
  if (productos.length > 0) {
    const frase = productos.join(' · ')
    renglones.push({ tipo: 'productos', texto: frase.charAt(0).toUpperCase() + frase.slice(1) })
  }

  return renglones
}

/** Cómo se dice un valor (para «Antes: Mid Fade»). Null = no había nada. */
export function textoDeValor(clave: ClavePregunta, datos: DatosFicha): string | null {
  switch (clave) {
    case 'frecuencia':
      return textoDe(FRECUENCIAS, datos.frecuencia)
    case 'molesta':
      return datos.molesta === true
        ? datos.molesta_detalle?.trim()
          ? `Sí: ${datos.molesta_detalle.trim()}`
          : 'Sí'
        : datos.molesta === false
          ? 'No'
          : null
    case 'crecer':
      return Array.isArray(datos.crecer) ? enumerar(lista(PARTES_QUE_CRECEN, datos.crecer)) || 'Nada' : null
    case 'productos_usa':
      return Array.isArray(datos.productos_usa) ? enumerar(lista(PRODUCTOS, datos.productos_usa)) || 'Ninguno' : null
    case 'productos_recomendados':
      return Array.isArray(datos.productos_recomendados)
        ? enumerar(lista(PRODUCTOS, datos.productos_recomendados)) || 'Ninguno'
        : null
    case 'forma':
      return textoDe(FORMAS, datos.forma)
    case 'craneo':
      return Array.isArray(datos.craneo) ? enumerar(lista(ZONAS_CRANEO, datos.craneo)) || 'Ninguna' : null
    case 'corte':
      return textoCorte(datos)
    case 'fade_altura':
      return textoDe(ALTURAS_FADE, datos.fade_altura)
    case 'fade_numero':
      return textoDe(NUMEROS_FADE, datos.fade_numero)
    case 'particularidades':
      return Array.isArray(datos.particularidades)
        ? enumerar(lista(PARTICULARIDADES, datos.particularidades)) || 'Ninguna'
        : null
  }
}

/** Los campos que forman cada pregunta (para comparar «antes» y «ahora»). */
const CAMPOS_DE_PREGUNTA: Record<ClavePregunta, readonly CampoFicha[]> = {
  frecuencia: ['frecuencia'],
  molesta: ['molesta', 'molesta_detalle'],
  crecer: ['crecer'],
  productos_usa: ['productos_usa'],
  productos_recomendados: ['productos_recomendados'],
  forma: ['forma'],
  craneo: ['craneo'],
  corte: ['corte', 'corte_otro'],
  fade_altura: ['fade_altura'],
  fade_numero: ['fade_numero'],
  particularidades: ['particularidades'],
}

/** ¿La pregunta cambió entre dos fichas? */
export function cambioPregunta(clave: ClavePregunta, antes: DatosFicha, ahora: DatosFicha): boolean {
  return CAMPOS_DE_PREGUNTA[clave].some((c) => !mismoValor(antes[c], ahora[c]))
}

/** Productos recomendados en texto («Cera mate y Polvo de texturizar»), para el cobro. */
export function productosRecomendados(datos: DatosFicha | null | undefined): string[] {
  return datos ? lista(PRODUCTOS, datos.productos_recomendados) : []
}

// ─── Contratos con las server actions ────────────────────────────────────────

export interface FichaAsesoria {
  id: string
  /** El cliente bajo el que está guardada (puede ser otra ficha del mismo teléfono). */
  clienteId: string
  datos: DatosFicha
  creadaEn: string
  actualizadaEn: string
  actualizadaPor: { id: string; nombre: string } | null
  /** En cuántas visitas se tocó. */
  visitas: number
}

/** Cómo estaba la ficha antes de esta visita: el «antes» de cada pregunta. */
export interface PreviaFicha {
  datos: DatosFicha
  /** Cuándo quedó así (null = no se sabe). */
  fecha: string | null
  barbero: string | null
}

/** La foto del corte de la ficha: la de la visita en que se completó. */
export interface FotoDeFicha {
  id: string
  url: string
  fecha: string
}

export type MotivoErrorFicha = 'sesion' | 'acceso' | 'datos' | 'no_existe' | 'entrada' | 'error'

export type ResultadoFichaAsesoria =
  | { ok: true; ficha: FichaAsesoria | null; previa: PreviaFicha | null; fotos: FotoDeFicha[] }
  | { ok: false; motivo: MotivoErrorFicha; error: string }

export type ResultadoGuardadoFicha =
  | { ok: true; datos: DatosFicha; fichaId: string | null; actualizadaEn: string | null }
  | { ok: false; motivo: MotivoErrorFicha; error: string }

export type ResultadoFichasDeLaFila =
  | { ok: true; fichas: Record<string, { datos: DatosFicha; actualizadaEn: string }> }
  | { ok: false; error: string }
