/**
 * Chequeo de contraste del tema del turnero.
 *
 *   node src/app/turnos/\[slug\]/theme.check.mts
 *
 * (Node >= 22.18 stripea los tipos solo; en versiones previas:
 * `node --experimental-strip-types …`.)
 *
 * Barre combinaciones de fondo × primario × texto —las cuatro paletas que hay
 * hoy en prod más los casos borde que rompieron el tema antes— y verifica que
 * NINGÚN par emitido quede por debajo de su mínimo WCAG. Existe porque el bug
 * que motivó `readableFill` era invisible leyendo el código: `primary` se
 * emitía crudo y nadie lo medía contra la capa de atrás.
 *
 * No es un test unitario (el proyecto no tiene runner): es un script que se
 * corre a mano cuando se toca `theme.ts`. Sale con código 1 si algo falla.
 */

// El specifier se arma en runtime a propósito: TS no acepta imports con
// extensión `.ts` (TS5097) pero Node SÍ la exige para stripear tipos.
const mod = (await import(new URL('./theme.ts', import.meta.url).href)) as typeof import('./theme')
const { buildTurneroTheme, contrastRatio } = mod

type RGB = import('./theme').RGB

function parseHex(hex: string): RGB {
  const h = hex.replace(/^#/, '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function ratio(a: string, b: string): number {
  return contrastRatio(parseHex(a), parseHex(b))
}

// ─── Combinaciones a barrer ──────────────────────────────────────────

/** Fondos: los de prod + grises de luminancia media (el peor caso posible). */
const FONDOS = [
  '#ffffff', '#f8fafc', '#e2e8f0', '#d4a373', '#a3a3a3', '#808080',
  '#767676', '#606060', '#4b5563', '#334155', '#1f2937', '#111827',
  '#0f172a', '#000000', '#132a13', '#3b0d0c',
]

/** Primarios: el default de prod (#0f172a) + marca saturada + extremos. */
const PRIMARIOS = [
  '#0f172a', '#000000', '#ffffff', '#dc2626', '#d4af37', '#2563eb',
  '#16a34a', '#7c3aed', '#f59e0b', '#0ea5e9', '#606060', '#e11d48',
]

/** Texto configurado por el dueño (incluye los que no se pueden respetar). */
const TEXTOS = [null, '#ffffff', '#000000', '#0f172a', '#606060', '#94a3b8']

/** Cada par que la UI pinta de verdad, con su mínimo. */
const REGLAS: Array<{
  nombre: string
  a: (t: import('./theme').TurneroTheme) => string
  b: (t: import('./theme').TurneroTheme) => string
  min: number
}> = [
  { nombre: 'text vs bg',          a: t => t.text,       b: t => t.bg,         min: 4.5 },
  { nombre: 'text vs surface',     a: t => t.text,       b: t => t.surface,    min: 4.5 },
  { nombre: 'text vs surfaceAlt',  a: t => t.text,       b: t => t.surfaceAlt, min: 4.5 },
  { nombre: 'textMuted vs bg',     a: t => t.textMuted,  b: t => t.bg,         min: 4.5 },
  { nombre: 'textMuted vs surf',   a: t => t.textMuted,  b: t => t.surface,    min: 4.5 },
  { nombre: 'textFaint vs bg',     a: t => t.textFaint,  b: t => t.bg,         min: 3 },
  { nombre: 'textFaint vs surf',   a: t => t.textFaint,  b: t => t.surface,    min: 3 },
  // El hallazgo: el relleno tiene que verse contra las tres capas.
  { nombre: 'primary vs bg',       a: t => t.primary,    b: t => t.bg,         min: 3 },
  { nombre: 'primary vs surface',  a: t => t.primary,    b: t => t.surface,    min: 3 },
  { nombre: 'primary vs surfAlt',  a: t => t.primary,    b: t => t.surfaceAlt, min: 3 },
  { nombre: 'onPrimary vs primary',a: t => t.onPrimary,  b: t => t.primary,    min: 4.5 },
  { nombre: 'accent vs bg',        a: t => t.accent,     b: t => t.bg,         min: 4.5 },
  { nombre: 'accent vs surface',   a: t => t.accent,     b: t => t.surface,    min: 4.5 },
  { nombre: 'dangerText vs dgBg',  a: t => t.dangerText, b: t => t.dangerBg,   min: 4.5 },
]

// ─── Barrido ─────────────────────────────────────────────────────────

interface Falla {
  regla: string
  paleta: string
  ratio: number
  min: number
}

const fallas: Falla[] = []
const peorPorRegla = new Map<string, { ratio: number; paleta: string }>()
let combinaciones = 0

for (const bg of FONDOS) {
  for (const primary of PRIMARIOS) {
    for (const text of TEXTOS) {
      combinaciones++
      const theme = buildTurneroTheme({ bg, primary, text })
      const paleta = `bg=${bg} primary=${primary} text=${text ?? '(auto)'}`

      for (const regla of REGLAS) {
        const r = ratio(regla.a(theme), regla.b(theme))
        const peor = peorPorRegla.get(regla.nombre)
        if (!peor || r < peor.ratio) peorPorRegla.set(regla.nombre, { ratio: r, paleta })
        // Tolerancia de 0.01: los tokens se emiten redondeados a hex de 8 bits.
        if (r < regla.min - 0.01) {
          fallas.push({ regla: regla.nombre, paleta, ratio: r, min: regla.min })
        }
      }
    }
  }
}

console.log(`Combinaciones barridas: ${combinaciones} (${combinaciones * REGLAS.length} pares)\n`)
console.log('Peor ratio por regla:')
for (const regla of REGLAS) {
  const peor = peorPorRegla.get(regla.nombre)!
  const ok = peor.ratio >= regla.min - 0.01 ? 'OK  ' : 'FALLA'
  console.log(
    `  ${ok} ${regla.nombre.padEnd(22)} min ${String(regla.min).padEnd(4)} peor ${peor.ratio.toFixed(2)}  ${peor.paleta}`
  )
}

if (fallas.length) {
  console.error(`\n${fallas.length} pares por debajo del mínimo. Primeros 10:`)
  for (const f of fallas.slice(0, 10)) {
    console.error(`  ${f.regla}: ${f.ratio.toFixed(2)} < ${f.min}  (${f.paleta})`)
  }
  process.exit(1)
}

console.log('\nTodos los pares cumplen su mínimo.')
