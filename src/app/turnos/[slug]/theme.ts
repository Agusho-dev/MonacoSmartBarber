import type { CSSProperties } from 'react'

/**
 * Tema derivado del turnero público.
 *
 * El dueño configura TRES colores en /dashboard/turnos/personalizacion (fondo,
 * primario y texto) y con eso hay que pintar una pantalla entera. Aplicarlos
 * crudos era la fuente de todos los problemas de contraste: con
 * bg=#606060 / text=#ffffff / primary=#000000 quedaban placeholders invisibles,
 * precios negros sobre gris (3.3:1) y textos con `opacity: 0.5` que caían a 2:1.
 *
 * Acá se deriva un set COMPLETO de tokens midiendo contraste real (luminancia
 * relativa WCAG 2.1 sobre sRGB linearizado), no a ojo. La regla es simple: si un
 * color de marca no llega al ratio necesario contra la capa donde se va a
 * pintar, no se usa — se reemplaza por la variante legible más cercana.
 *
 * Los tokens se publican como custom properties (`--t-*`) en el contenedor raíz
 * de cada pantalla para que ningún hijo tenga que volver a hardcodear un color.
 */

// ─── Utilidades de color ─────────────────────────────────────────────

export interface RGB {
  r: number
  g: number
  b: number
}

/** Contraste mínimo para texto de cuerpo (WCAG AA). */
const AA_TEXT = 4.5
/** Contraste mínimo para texto grande / elementos de UI (WCAG AA). */
const AA_LARGE = 3

const WHITE: RGB = { r: 255, g: 255, b: 255 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }
const NEAR_BLACK: RGB = { r: 15, g: 23, b: 42 } // slate-900

function parseHex(hex: string | null | undefined): RGB | null {
  if (!hex) return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex(c: RGB): string {
  const part = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`
}

/** Canal sRGB linearizado (WCAG 2.1, §relative luminance). */
function linearize(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/**
 * Luminancia relativa 0..1.
 *
 * Exportada junto con `contrastRatio` a propósito: si alguna pantalla necesita
 * un color que no sale del tema (el verde de "abierto", por ejemplo), tiene que
 * poder medirlo contra las capas en vez de elegirlo a ojo.
 */
export function relativeLuminance(c: RGB): number {
  return (
    0.2126 * linearize(c.r) +
    0.7152 * linearize(c.g) +
    0.0722 * linearize(c.b)
  )
}

/** Ratio de contraste WCAG entre dos colores opacos (1..21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * t=0 devuelve `a`, t=1 devuelve `b`.
 *
 * Redondea a enteros a propósito: si se validara el contraste con los canales
 * en flotante y recién después se redondeara al escribir el hex, el color
 * emitido podía quedar unas centésimas por debajo del ratio que se verificó.
 */
function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function rgba(c: RGB, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`
}

/**
 * Extremo legible sobre TODAS las capas.
 *
 * El orden importa: blanco (temas oscuros), después slate-900 (temas claros) y
 * recién al final negro puro. Slate-900 no es lo bastante oscuro para un fondo
 * de luminancia media —se queda en 4.3:1 justo en la zona peor— así que el
 * negro puro existe como último recurso: es el único que garantiza >= 4.58:1
 * contra cualquier color.
 */
function bestForeground(layers: RGB[]): RGB {
  const candidatos = [WHITE, NEAR_BLACK, BLACK]
  const peor = (c: RGB) => Math.min(...layers.map(l => contrastRatio(c, l)))

  const pasa = candidatos.find(c => peor(c) >= AA_TEXT)
  if (pasa) return pasa

  return candidatos.reduce((mejor, c) => (peor(c) > peor(mejor) ? c : mejor))
}

/**
 * Capas de un tema oscuro: la tarjeta se aclara sobre el fondo y el hueco
 * (chips, badges, celdas internas) se hunde.
 *
 * El rango se achica hasta que exista UN color de texto que se lea sobre las
 * tres. Con fondos de luminancia media (el #606060 que configuró el dueño está
 * al borde) separar mucho las capas deja al blanco corto contra la tarjeta y al
 * negro corto contra el hueco: no hay un solo texto que sirva para las dos.
 */
function capasOscuras(bg: RGB): { surface: RGB; surfaceAlt: RGB } {
  const rangos: Array<[number, number]> = [
    [0.08, 0.12], [0.06, 0.09], [0.04, 0.06], [0.02, 0.03], [0, 0],
  ]
  for (const [arriba, abajo] of rangos) {
    const surface = mix(bg, WHITE, arriba)
    const surfaceAlt = mix(bg, BLACK, abajo)
    const capas = [bg, surface, surfaceAlt]
    const hayTexto = [WHITE, NEAR_BLACK, BLACK].some(f =>
      capas.every(l => contrastRatio(f, l) >= AA_TEXT)
    )
    if (hayTexto) return { surface, surfaceAlt }
  }
  return { surface: bg, surfaceAlt: bg }
}

/**
 * Acerca `from` a `toward` todo lo que se pueda sin bajar de `minRatio` contra
 * NINGUNA de las capas en `against`. Sirve para construir la escala de texto
 * apagado: se busca el gris más suave que todavía se lee.
 */
function fadeWhileLegible(
  from: RGB,
  toward: RGB,
  against: RGB[],
  minRatio: number
): RGB {
  const steps = [0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05]
  for (const t of steps) {
    const candidate = mix(from, toward, t)
    if (against.every(layer => contrastRatio(candidate, layer) >= minRatio)) {
      return candidate
    }
  }
  return from
}

/**
 * Primario usable como RELLENO grande (CTA, chip activo, avatar sin foto).
 *
 * `primary` se emitía CRUDO: se validaba el texto que va encima (`onPrimary`) y
 * el primario-como-tinta (`accent`), pero nunca el relleno contra la capa que
 * tiene detrás. Con un fondo oscuro y el primario por default (#0f172a, que es
 * lo que tienen casi todas las orgs) el CTA quedaba en 1.28:1 contra la
 * superficie —un botón invisible— y encima `onPrimary` daba blanco igual que
 * `text`, así que tampoco se distinguía por su contenido.
 *
 * Se corrige aclarando/oscureciendo hasta llegar a `minRatio` (3:1, el mínimo
 * WCAG para componentes de UI y superficies grandes). Mezclar contra blanco o
 * negro escala los tres canales de forma pareja, así que el MATIZ de la marca se
 * conserva: un primario bordó sigue siendo bordó, sólo más claro.
 *
 * A diferencia de `readableAccent` acá NO se degrada al color de texto: un
 * relleno tiene que seguir siendo un color de marca, y si fuese igual al texto
 * el botón desaparecería contra los títulos.
 */
function readableFill(
  color: RGB,
  against: RGB[],
  minRatio: number,
  isDark: boolean
): RGB {
  const peor = (c: RGB) => Math.min(...against.map(layer => contrastRatio(c, layer)))
  if (peor(color) >= minRatio) return color

  // Primero la dirección que corresponde al tema (aclarar sobre fondo oscuro,
  // oscurecer sobre fondo claro); si esa no alcanza —fondos de luminancia
  // media— se prueba la contraria antes de resignarse.
  const direcciones = isDark ? [WHITE, BLACK] : [BLACK, WHITE]
  let mejor = color
  for (const target of direcciones) {
    // Pasos enteros: acumular `t += 0.05` en flotante se pasaba de 1.
    for (let paso = 1; paso <= 20; paso++) {
      const candidato = mix(color, target, paso / 20)
      if (peor(candidato) >= minRatio) return candidato
      if (peor(candidato) > peor(mejor)) mejor = candidato
    }
  }
  return mejor
}

/**
 * Devuelve `color` si ya se lee sobre todas las capas; si no, lo empuja hacia
 * el extremo legible (blanco en temas oscuros, casi-negro en claros) hasta que
 * llegue al ratio. Un primario negro sobre fondo gris/negro termina degradando
 * al color de texto, que es exactamente lo que pide el diseño: si la marca no
 * puede ser el acento, el acento es el texto.
 */
function readableAccent(
  color: RGB,
  against: RGB[],
  minRatio: number,
  isDark: boolean,
  text: RGB
): RGB {
  const passes = (c: RGB) => against.every(layer => contrastRatio(c, layer) >= minRatio)
  if (passes(color)) return color

  // Un primario sin croma (negro, blanco, gris) no tiene identidad que rescatar:
  // corregirlo devuelve otro gris. En ese caso el acento es directamente el
  // color de texto, que es más limpio que un gris intermedio.
  const croma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
  if (croma < 12) return text

  const target = isDark ? WHITE : NEAR_BLACK
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const candidate = mix(color, target, t)
    if (passes(candidate)) return candidate
  }
  return text
}

// ─── Tema ────────────────────────────────────────────────────────────

export interface TurneroTheme {
  /** Fondo de la página. */
  bg: string
  /** Capa de contenido (tarjetas, inputs) apoyada sobre `bg`. */
  surface: string
  /** Un escalón más de elevación: chips, celdas internas, cajas de detalle. */
  surfaceAlt: string
  /** Borde sutil que sigue leyéndose sobre `surface`. */
  border: string
  /** Texto principal. Garantiza >= 4.5:1 contra `bg` y `surface`. */
  text: string
  /** Texto secundario legible (>= 4.5:1). */
  textMuted: string
  /** Texto terciario / etiquetas (>= 3:1). Nunca para párrafos. */
  textFaint: string
  /**
   * Color de marca para RELLENOS (botones, chips activos, avatares).
   * Garantiza >= 3:1 contra `bg`, `surface` y `surfaceAlt`, así que el botón
   * siempre se recorta del fondo. Puede NO ser el hex que configuró el dueño.
   */
  primary: string
  /** Texto/ícono que va encima de `primary`. */
  onPrimary: string
  /** Color de marca para PRIMER PLANO (precios, links, íconos de acento). */
  accent: string
  /** Halo de foco, ya con alpha. */
  ring: string
  /** Rojo sólido para rellenos destructivos (lleva texto blanco). */
  danger: string
  /** Fondo de cajas de error/alerta. */
  dangerBg: string
  /** Texto sobre `dangerBg` (>= 4.5:1 garantizado). */
  dangerText: string
  /** true si el fondo es oscuro. Útil para sombras y estados hover. */
  isDark: boolean
}

export interface BrandColors {
  bg?: string | null
  primary?: string | null
  text?: string | null
}

const DEFAULT_BG = '#f8fafc'
const DEFAULT_PRIMARY = '#0f172a'

export function buildTurneroTheme(brand: BrandColors): TurneroTheme {
  const bg = parseHex(brand.bg) ?? parseHex(DEFAULT_BG)!
  const brandPrimary = parseHex(brand.primary) ?? parseHex(DEFAULT_PRIMARY)!
  const brandText = parseHex(brand.text)

  const isDark = relativeLuminance(bg) < 0.5

  // Elevación: en temas claros la tarjeta es blanco puro y el hueco se ensucia
  // apenas; en oscuros el rango lo decide `capasOscuras`.
  const { surface, surfaceAlt } = isDark
    ? capasOscuras(bg)
    : { surface: WHITE, surfaceAlt: mix(WHITE, NEAR_BLACK, 0.05) }

  // El texto de marca se respeta SOLO si de verdad se lee sobre TODAS las capas
  // donde va a caer. Con bg #606060 un texto de marca gris medio daba 1.2:1.
  const layers = [bg, surface, surfaceAlt]
  const text =
    brandText && layers.every(l => contrastRatio(brandText, l) >= AA_TEXT)
      ? brandText
      : bestForeground(layers)

  // La escala apagada se deriva del texto ya validado, no de una opacidad fija:
  // `opacity: 0.5` sobre un fondo de luminancia parecida es texto invisible.
  const textMuted = fadeWhileLegible(text, surface, layers, AA_TEXT)
  const textFaint = fadeWhileLegible(text, surface, layers, AA_LARGE)

  const border = mix(surface, text, 0.16)

  // `primary` se usa como relleno: tiene que verse ÉL contra la capa que tiene
  // detrás (3:1, mínimo de UI) y recién después importa el texto que va encima.
  // Validar sólo `onPrimary` dejaba botones invisibles: ver `readableFill`.
  const primary = readableFill(brandPrimary, layers, AA_LARGE, isDark)
  // `onPrimary` se mide contra el primario YA corregido: contra el crudo podía
  // elegir blanco para un relleno que después se aclaraba hasta ser gris claro.
  const onPrimary = bestForeground([primary])
  // `accent` se usa como tinta (precios, links): tiene que leerse ÉL contra el
  // fondo, cosa que un primario negro sobre gris medio no cumple (4.1:1).
  const accent = readableAccent(brandPrimary, layers, AA_TEXT, isDark, text)

  // Rojo: en un fondo de luminancia media ningún rojo llega a 4.5:1, así que la
  // caja de error trae su propio fondo de alto contraste en vez de ser un tinte
  // translúcido de la superficie.
  const dangerBg = parseHex(isDark ? '#3f1416' : '#fef2f2')!
  const dangerText = parseHex(isDark ? '#fecaca' : '#b91c1c')!

  return {
    bg: toHex(bg),
    surface: toHex(surface),
    surfaceAlt: toHex(surfaceAlt),
    border: toHex(border),
    text: toHex(text),
    textMuted: toHex(textMuted),
    textFaint: toHex(textFaint),
    primary: toHex(primary),
    onPrimary: toHex(onPrimary),
    accent: toHex(accent),
    ring: rgba(accent, 0.45),
    danger: '#dc2626',
    dangerBg: toHex(dangerBg),
    dangerText: toHex(dangerText),
    isDark,
  }
}

/**
 * Custom properties para el contenedor raíz. Los hijos consumen
 * `var(--t-surface)` y compañía, así nadie vuelve a escribir un hex a mano.
 */
export function themeVars(t: TurneroTheme): CSSProperties {
  return {
    '--t-bg': t.bg,
    '--t-surface': t.surface,
    '--t-surface-alt': t.surfaceAlt,
    '--t-border': t.border,
    '--t-text': t.text,
    '--t-text-muted': t.textMuted,
    '--t-text-faint': t.textFaint,
    '--t-primary': t.primary,
    '--t-on-primary': t.onPrimary,
    '--t-accent': t.accent,
    '--t-ring': t.ring,
    '--t-danger': t.danger,
    '--t-danger-bg': t.dangerBg,
    '--t-danger-text': t.dangerText,
  } as CSSProperties
}
