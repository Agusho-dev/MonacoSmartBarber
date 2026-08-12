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

/** Cuánto se aleja un color del gris. 0 = gris puro. */
function croma(c: RGB): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/**
 * El matiz de `hue`, llevado a la MISMA luminancia que `bg`.
 *
 * Es la pieza que hace posible el vidrio. El ambiente tiene que variar para que
 * el `backdrop-filter` tenga algo que refractar, pero cualquier variación de
 * LUMINANCIA sobre un tema oscuro compite con el texto —que también es claro— y
 * el buscador de opacidades termina apagando el efecto hasta 0.02, o sea nada.
 * Fue exactamente lo que pasó: la pantalla no estaba sin efecto, estaba sin
 * presupuesto para el efecto.
 *
 * Variando el CROMA en vez del brillo, el ojo ve el degradado y el contraste
 * casi no se mueve: la mancha puede subir a una opacidad que se nota sin bajar
 * un punto la legibilidad. Es, además, cómo se comporta la luz de verdad sobre
 * un vidrio teñido.
 */
function aLaLuminanciaDe(hue: RGB, bg: RGB): RGB {
  const objetivo = relativeLuminance(bg)
  const actual = relativeLuminance(hue)
  // Un piso absoluto para que un fondo negro puro igual reciba algo de color.
  const techo = objetivo * 1.9 + 0.014

  if (actual <= techo && actual >= objetivo * 0.45) return hue

  const destino = actual > techo ? BLACK : WHITE
  let mejor = hue
  for (let paso = 1; paso <= 20; paso++) {
    const cand = mix(hue, destino, paso / 20)
    const l = relativeLuminance(cand)
    mejor = cand
    if (destino === BLACK ? l <= techo : l >= objetivo * 0.45) break
  }
  return mejor
}

// ─── Vidrio ──────────────────────────────────────────────────────────

/** Un color que se pinta encima de una capa, con su mínimo WCAG. */
interface Requisito {
  color: RGB
  min: number
}

/** true si TODOS los requisitos se cumplen sobre `capa`. */
function capaLegible(capa: RGB, reqs: Requisito[]): boolean {
  return reqs.every(r => contrastRatio(r.color, capa) >= r.min)
}

/**
 * Mayor opacidad de `tint` que sigue siendo legible sobre TODAS las bases.
 *
 * El vidrio no es un color más: es una capa TRANSLÚCIDA, así que lo que ve el
 * ojo es la composición con lo que tiene detrás. Elegir la opacidad a ojo (el
 * `bg-white/[0.04]` del kiosko) puede hundir el texto que va encima por debajo
 * del mínimo sin que nadie lo note, porque el color del texto nunca cambió.
 *
 * Se prueba de la opacidad más marcada a la más sutil y se queda la primera que
 * pasa. Devolver 0 es un resultado válido: el relleno desaparece pero el borde,
 * la línea de luz y la sombra siguen dibujando la tarjeta.
 */
function alphaLegible(
  tint: RGB,
  bases: RGB[],
  candidatos: number[],
  reqs: Requisito[]
): number {
  for (const a of candidatos) {
    if (bases.every(base => capaLegible(mix(base, tint, a), reqs))) return a
  }
  return 0
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
  /**
   * Verde de "listo" como RELLENO, ya corregido para recortarse del fondo de
   * marca (>= 3:1). Se usa en la pantalla de confirmación, no en el momento del
   * tilde: ese es una capa propia (ver `--t-go-*`).
   */
  success: string
  /** Texto/ícono que va encima de `success`. */
  onSuccess: string
  /** Verde como TINTA (>= 4.5:1). Degrada al color de texto si la paleta no da. */
  successText: string
  /** Rojo sólido para rellenos destructivos (lleva texto blanco). */
  danger: string
  /** Fondo de cajas de error/alerta. */
  dangerBg: string
  /** Texto sobre `dangerBg` (>= 4.5:1 garantizado). */
  dangerText: string
  /** true si el fondo es oscuro. Útil para sombras y estados hover. */
  isDark: boolean

  // ── Vidrio ──
  /** Relleno translúcido de un panel de vidrio. Va con `backdrop-filter`. */
  glassBg: string
  /** Mismo relleno, un escalón más denso, para hover. */
  glassBgHover: string
  /** Caja anidada DENTRO de un panel de vidrio (un escalón más de elevación). */
  glassInner: string
  /** Borde de 1px del vidrio. */
  glassBorder: string
  /** Borde en hover / estado activo. */
  glassBorderStrong: string
  /** Línea de luz que corre por el borde superior. */
  glassHighlight: string
  /**
   * Blanco del brillo interno del panel (degradado de arriba hacia el medio).
   * Es lo que hace que el vidrio tenga canto en vez de leerse como un
   * rectángulo de relleno parejo.
   */
  glassSheen: string
  /** `box-shadow` completo del panel en reposo. */
  glassShadow: string
  /** `box-shadow` completo del panel elevado. */
  glassShadowHover: string
  /**
   * Fondo del header/footer pegajosos: el color de página con alpha, para que
   * el contenido pase por debajo difuminado sin que el texto del chrome pierda
   * contraste contra lo que sea que esté scrolleando atrás.
   */
  chromeBg: string
  /**
   * Degradado del fondo de la página. Los dos extremos son `bg` empujado un
   * escalón: alcanza para que el vidrio tenga algo que refractar y no mueve el
   * contraste de ningún texto.
   */
  bgGradient: string
  /**
   * Manchas de luz del fondo. Sin algo detrás, el `backdrop-filter` del vidrio
   * no se percibe: sobre un color plano no hay nada que desenfocar.
   */
  glow1: string
  glow2: string
  /**
   * Cada superficie compuesta que el sistema de vidrio puede producir, en hex.
   * No se emite como CSS: existe para que `theme.check.mts` valide el contraste
   * contra TODAS ellas sin tener que replicar la derivación.
   */
  glassLayers: string[]
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

  // ─── El vidrio se decide ANTES que el texto ───────────────────────
  //
  // Éste es el orden que importa y estuvo al revés. Antes se derivaba primero
  // toda la escala de texto —que `fadeWhileLegible` deja pegada a su mínimo por
  // construcción— y recién después se buscaba cuánta opacidad de vidrio "cabía"
  // sin romperla. No cabía casi nada: el buscador terminaba eligiendo 0.02, o
  // sea ninguna, y la pantalla se veía plana. No faltaba efecto; faltaba
  // presupuesto para el efecto, y se lo había gastado el texto.
  //
  // Ahora la opacidad del panel es una CONSTANTE DE DISEÑO y el texto se acomoda
  // a ella. Es la misma regla que el resto del archivo aplica a los colores de
  // marca: el que no llega al ratio se reemplaza por su variante legible. Si una
  // paleta no admite la constante —un gris medio con texto blanco no tolera que
  // le sumen luz— se baja por la escala hasta la primera que deje existir algún
  // color de texto.
  const ESCALA_OSCURA = [0.14, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02]
  const ESCALA_CLARA = [0.86, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32, 0.24, 0.16, 0.08]

  /** ¿Existe algún color de texto que se lea sobre todas estas capas? */
  function hayTextoPara(capas: RGB[]): boolean {
    return [WHITE, NEAR_BLACK, BLACK].some(f =>
      capas.every(l => contrastRatio(f, l) >= AA_TEXT)
    )
  }

  function elegirVidrio(tint: RGB, escala: number[]): number {
    for (const a of escala) {
      const vidrio = mix(bg, tint, a)
      const hover = mix(bg, tint, Math.min(1, a * 1.4))
      if (hayTextoPara([bg, surface, surfaceAlt, vidrio, hover])) return a
    }
    return 0
  }

  let glassTint = WHITE
  let glassAlpha = elegirVidrio(WHITE, isDark ? ESCALA_OSCURA : ESCALA_CLARA)
  if (glassAlpha === 0 && isDark) {
    // Fondo que ya no admite más luz (gris medio con texto blanco): antes de
    // resignar el efecto se prueba el vidrio ahumado, que oscurece en vez de
    // aclarar y también se lee como vidrio.
    const humo = elegirVidrio(BLACK, ESCALA_OSCURA)
    if (humo > 0) {
      glassTint = BLACK
      glassAlpha = humo
    }
  }

  const glassAlphaHover = Math.min(1, glassAlpha * 1.4)
  const vidrioBase = mix(bg, glassTint, glassAlpha)
  const vidrioHover = mix(bg, glassTint, glassAlphaHover)

  // El texto de marca se respeta SOLO si de verdad se lee sobre TODAS las capas
  // donde va a caer —incluido el vidrio—. Con bg #606060 un texto de marca gris
  // medio daba 1.2:1.
  const layers = [bg, surface, surfaceAlt, vidrioBase, vidrioHover]
  const text =
    brandText && layers.every(l => contrastRatio(brandText, l) >= AA_TEXT)
      ? brandText
      : bestForeground(layers)

  // La escala apagada se deriva del texto ya validado, no de una opacidad fija:
  // `opacity: 0.5` sobre un fondo de luminancia parecida es texto invisible.
  //
  // `fadeWhileLegible` devuelve el gris MÁS SUAVE que todavía pasa, o sea que
  // aterriza pegado al mínimo por construcción. Como `layers` ya incluye el
  // vidrio, el mínimo se mide donde de verdad cae el texto; la holgura que
  // queda es sólo para las capas de AMBIENTE (manchas de luz, brillo interno),
  // que se derivan después.
  const HOLGURA_CAPAS = 1.18
  const textMuted = fadeWhileLegible(text, surface, layers, AA_TEXT * HOLGURA_CAPAS)
  const textFaint = fadeWhileLegible(text, surface, layers, AA_LARGE * HOLGURA_CAPAS)

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

  // ─── Ambiente ─────────────────────────────────────────────────────
  //
  // El vidrio ya quedó fijado arriba (es constante de diseño). Lo que sigue son
  // las capas de AMBIENTE, que sí se acomodan al texto: manchas de luz y brillo
  // interno se apoyan sobre el vidrio y no pueden hundir lo que va escrito
  // encima.

  const reqs: Requisito[] = [
    { color: text, min: AA_TEXT },
    { color: textMuted, min: AA_TEXT },
    { color: textFaint, min: AA_LARGE },
    { color: primary, min: AA_LARGE },
    { color: accent, min: AA_TEXT },
  ]

  // ── Manchas de luz del fondo ──────────────────────────────────────
  //
  // Son lo que hace que el vidrio EXISTA: `backdrop-filter` desenfoca lo que
  // tiene atrás, y atrás hay un color plano. Sin nada que desenfocar el efecto
  // no se percibe y la pantalla se lee como tarjetas grises sobre gris.
  //
  // El tinte lleva el MATIZ de la marca a la LUMINANCIA del fondo (ver
  // `aLaLuminanciaDe`): así la mancha se percibe como color y no como brillo, y
  // no le come contraste a un texto que en un tema oscuro también es claro.
  //
  // Una marca sin croma (negro, blanco, gris — el caso del dueño, que tiene el
  // primario en #000000) no tiene matiz que prestar: el ambiente toma un azul
  // frío tenue. Es ambiente puro, no identidad; sin él, un turnero en blanco y
  // negro no tiene forma de mostrar vidrio, porque el vidrio necesita que atrás
  // haya ALGO.
  const HUE_NEUTRO: RGB = { r: 91, g: 108, b: 184 } // índigo suave
  const matiz = croma(brandPrimary) >= 12 ? brandPrimary : HUE_NEUTRO
  const glowTint = aLaLuminanciaDe(matiz, bg)
  // La escala arranca alta a propósito: con el tinte igualado en luminancia, una
  // opacidad grande casi no mueve el contraste y sí se ve.
  const ESCALA_GLOW = [
    0.85, 0.75, 0.65, 0.55, 0.45, 0.38, 0.32, 0.26, 0.22, 0.18,
    0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02,
  ]
  let glowAlpha = 0
  for (const a of ESCALA_GLOW) {
    const solido = mix(bg, glowTint, a)
    const debil = mix(bg, glowTint, a * 0.62)
    const capas = [solido, debil].flatMap(base => [
      base,
      mix(base, glassTint, glassAlpha),
      mix(base, glassTint, glassAlphaHover),
    ])
    if (capas.every(c => capaLegible(c, reqs))) {
      glowAlpha = a
      break
    }
  }
  const glowSolid = mix(bg, glowTint, glowAlpha)

  // Caja anidada dentro de un panel: en tema oscuro sube un escalón de luz, en
  // claro baja uno (sobre blanco casi sólido, más blanco no existe).
  const innerTint = isDark ? WHITE : NEAR_BLACK
  // Las CUATRO superficies de vidrio posibles, reposo y hover, sobre el fondo y
  // sobre la mancha de luz. Validar sólo las de reposo dejaba el brillo interno
  // elegido contra la capa más oscura y después aplicado sobre la más clara: el
  // chequeo de contraste lo agarró al instante (texto en 4.15:1).
  const basesVidrio = [
    mix(bg, glassTint, glassAlpha),
    mix(glowSolid, glassTint, glassAlpha),
    mix(bg, glassTint, glassAlphaHover),
    mix(glowSolid, glassTint, glassAlphaHover),
  ]
  const innerAlpha = alphaLegible(
    innerTint,
    basesVidrio,
    [0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02],
    reqs
  )

  // Brillo interno del panel: un degradado blanco de arriba hacia el medio.
  // Es lo que da la sensación de canto curvo —un panel de relleno parejo se lee
  // como un rectángulo pintado, no como vidrio— y se mide con el mismo criterio
  // que todo lo demás, apoyado SOBRE el vidrio ya compuesto.
  const sheenAlpha = alphaLegible(
    WHITE,
    basesVidrio,
    [0.1, 0.085, 0.07, 0.055, 0.045, 0.035, 0.025, 0.015],
    reqs
  )

  // Velo del header/footer: el contenido scrollea POR DEBAJO, así que lo que
  // queda atrás puede ser cualquier color. Se busca el velo más transparente
  // que aguante el peor caso posible (blanco puro y negro puro detrás).
  let chromeAlpha = 1
  for (const a of [0.84, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98]) {
    if ([mix(WHITE, bg, a), mix(BLACK, bg, a)].every(c => capaLegible(c, reqs))) {
      chromeAlpha = a
      break
    }
  }

  // El fondo no es un color plano sino un degradado muy corto: el vidrio
  // necesita que lo de atrás VARÍE para leerse como vidrio. Los dos extremos
  // son el mismo `bg` empujado un escalón, así que ningún texto cambia de
  // contraste de forma apreciable — y las capas compuestas que sí importan se
  // barren igual en `glassLayers`.
  const fondoAlto = mix(bg, isDark ? WHITE : BLACK, 0.05)
  const fondoBajo = mix(bg, isDark ? BLACK : NEAR_BLACK, 0.04)
  const gradienteDeFondo =
    `linear-gradient(180deg, ${toHex(fondoAlto)} 0%, ${toHex(bg)} 45%, ${toHex(fondoBajo)} 100%)`

  const bordeTint = isDark ? WHITE : text
  const sombra = isDark
    ? '0 14px 38px -18px rgba(0,0,0,0.75), 0 2px 8px -4px rgba(0,0,0,0.45)'
    : '0 12px 32px -16px rgba(15,23,42,0.28), 0 2px 6px -3px rgba(15,23,42,0.10)'
  const sombraHover = isDark
    ? '0 22px 48px -18px rgba(0,0,0,0.85), 0 3px 10px -4px rgba(0,0,0,0.5)'
    : '0 20px 44px -16px rgba(15,23,42,0.34), 0 3px 8px -3px rgba(15,23,42,0.14)'

  // Todas las superficies compuestas que puede generar el sistema, para que el
  // chequeo las barra sin volver a derivarlas.
  const glassLayers = [
    glowSolid,
    mix(bg, glowTint, glowAlpha * 0.62),
    ...[bg, glowSolid].flatMap(base => {
      const vidrio = mix(base, glassTint, glassAlpha)
      return [
        vidrio,
        mix(base, glassTint, glassAlphaHover),
        mix(vidrio, innerTint, innerAlpha),
        // La zona más clara del brillo interno: es la superficie real donde cae
        // el texto de la parte de arriba de cada tarjeta.
        mix(vidrio, WHITE, sheenAlpha),
        mix(mix(base, glassTint, glassAlphaHover), WHITE, sheenAlpha),
      ]
    }),
    mix(WHITE, bg, chromeAlpha),
    mix(BLACK, bg, chromeAlpha),
  ]

  // ─── Verde de "listo" ─────────────────────────────────────────────
  //
  // NO sale de la marca: "confirmado" es un código de color que el cliente ya
  // trae aprendido de cualquier app de pedidos, y una barbería con primario
  // bordó no puede quedarse sin él.
  //
  // Se deriva ACÁ ABAJO, después del vidrio, y no junto al primario: el verde
  // cae sobre paneles translúcidos y hay que medirlo contra la composición real.
  // Derivado arriba, contra las capas sólidas, quedaba en 2.9:1 sobre el vidrio
  // de un tema claro — el chequeo de contraste lo agarró en el acto.
  //
  // La otra salida era meterlo en `reqs` para que el buscador de opacidad lo
  // contemplara, pero eso le hace pagar a TODA la pantalla (menos vidrio en
  // todos lados) el precio de un color que se usa en una sola. Es más barato
  // corregir el verde.
  const GREEN: RGB = { r: 22, g: 163, b: 74 } // green-600
  const capasVerde = [...layers, ...glassLayers]
  const success = readableFill(GREEN, capasVerde, AA_LARGE, isDark)
  const onSuccess = bestForeground([success])
  const successText = readableAccent(GREEN, capasVerde, AA_TEXT, isDark, text)

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
    success: toHex(success),
    onSuccess: toHex(onSuccess),
    successText: toHex(successText),
    danger: '#dc2626',
    dangerBg: toHex(dangerBg),
    dangerText: toHex(dangerText),
    isDark,

    glassBg: rgba(glassTint, glassAlpha),
    glassBgHover: rgba(glassTint, glassAlphaHover),
    glassInner: rgba(innerTint, innerAlpha),
    glassBorder: rgba(bordeTint, isDark ? 0.28 : 0.14),
    glassBorderStrong: rgba(bordeTint, isDark ? 0.46 : 0.3),
    glassHighlight: rgba(WHITE, isDark ? 0.62 : 0.95),
    glassSheen: rgba(WHITE, sheenAlpha),
    glassShadow: sombra,
    glassShadowHover: sombraHover,
    chromeBg: rgba(bg, chromeAlpha),
    bgGradient: gradienteDeFondo,
    glow1: rgba(glowTint, glowAlpha),
    glow2: rgba(glowTint, Math.round(glowAlpha * 0.62 * 1000) / 1000),
    glassLayers: glassLayers.map(toHex),
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
    '--t-success': t.success,
    '--t-on-success': t.onSuccess,
    '--t-success-text': t.successText,
    '--t-danger': t.danger,
    '--t-danger-bg': t.dangerBg,
    '--t-danger-text': t.dangerText,
    '--t-glass-bg': t.glassBg,
    '--t-glass-bg-hover': t.glassBgHover,
    '--t-glass-inner': t.glassInner,
    '--t-glass-border': t.glassBorder,
    '--t-glass-border-strong': t.glassBorderStrong,
    '--t-glass-highlight': t.glassHighlight,
    '--t-glass-sheen': t.glassSheen,
    '--t-glass-shadow': t.glassShadow,
    '--t-glass-shadow-hover': t.glassShadowHover,
    '--t-chrome-bg': t.chromeBg,
    '--t-bg-gradient': t.bgGradient,
    '--t-glow-1': t.glow1,
    '--t-glow-2': t.glow2,
  } as CSSProperties
}
