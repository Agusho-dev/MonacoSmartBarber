// =============================================================================
// src/lib/tex/barberos.ts
// Los barberos para Tex: cómo se los nombra y cómo se encuentra a uno a partir
// de lo que dijo la persona ("chipi", "Lucas M.", "fabri").
//
// En Monaco el `full_name` del staff suele ser un APODO ("Chipi", "Chino") y a
// veces trae espacios de más ("Chipi "). Tex nunca ve ni inventa ids: pasa el
// nombre y acá se resuelve contra los barberos del ALCANCE del rol.
//
// Resolución (la primera regla que encuentra a alguien gana; en cada regla,
// los activos antes que los dados de baja):
//   1. el nombre completo, sin acentos ni mayúsculas;
//   2. una palabra del nombre (el nombre de pila, el apodo o el apellido);
//   3. el comienzo de las palabras ("fabri" → "Fabrizio Galeassi"; "lucas m"
//      → "Lucas Martinez"), desde 3 letras;
//   4. una parte del nombre, desde 3 letras.
// Dos fichas con el MISMO nombre son la misma persona para quien pregunta (hay
// barberos cargados dos veces): se devuelven todos sus ids. Dos nombres
// distintos que coinciden = ambiguo, y el modelo repregunta con las opciones.
//
// PURO: sin imports de runtime. Lo prueban los tests del scratchpad.
// =============================================================================

export interface BarberoDelAlcance {
  id: string
  /** `full_name` limpio (sin espacios de más), tal cual se lo llama en el local. */
  nombre: string
  sucursalId: string | null
  activo: boolean
}

export type BarberoElegido =
  | { ok: true; ids: string[]; nombre: string; activo: boolean }
  | { ok: false; error: 'barbero_no_resuelto'; mensaje: string; opciones: string[] }

/** Los barberos de una sucursal, para el system prompt. */
export interface TexEquipoSucursal {
  sucursal: string
  barberos: string[]
}

/** "Chipi " → "Chipi"; "  Lucas   Martinez" → "Lucas Martinez". */
export function nombreLimpio(nombre: string | null | undefined): string {
  return (nombre ?? '').replace(/\s+/g, ' ').trim()
}

/** Sin acentos, en minúsculas, sin signos y con un solo espacio entre palabras. */
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

function palabras(s: string): string[] {
  return normalizarNombre(s).split(' ').filter(Boolean)
}

type Regla = (b: BarberoDelAlcance, q: string, tokensQ: string[]) => boolean

const REGLAS: Regla[] = [
  // 1. Nombre completo.
  (b, q) => normalizarNombre(b.nombre) === q,
  // 2. Una palabra del nombre (con una sola palabra pedida).
  (b, q, tq) => tq.length === 1 && palabras(b.nombre).includes(q),
  // 3. Comienzo de palabras: cada palabra pedida empieza una palabra distinta del nombre.
  (b, q, tq) => {
    if (q.replace(/ /g, '').length < 3) return false
    const disponibles = palabras(b.nombre)
    return tq.every((t) => {
      const i = disponibles.findIndex((p) => p.startsWith(t))
      if (i === -1) return false
      disponibles.splice(i, 1)
      return true
    })
  },
  // 4. Una parte del nombre (también escrito todo junto: "nicoulloque").
  (b, q) => {
    const junto = q.replace(/ /g, '')
    if (junto.length < 3) return false
    return normalizarNombre(b.nombre).includes(q) || normalizarNombre(b.nombre).replace(/ /g, '').includes(junto)
  },
]

/** "Lucas Martinez (Paraná)": para que el modelo distinga a dos con nombres parecidos. */
function etiquetaConSucursal(b: BarberoDelAlcance, nombreSucursal: (id: string | null) => string | null): string {
  const suc = nombreSucursal(b.sucursalId)
  return suc ? `${b.nombre} (${suc})` : b.nombre
}

function ordenarNombres(nombres: string[]): string[] {
  return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * El barbero que quiso decir la persona, entre los del alcance. Con `opciones`
 * para que el modelo repregunte si no lo encuentra o si hay más de uno.
 */
export function resolverBarbero(
  barberos: BarberoDelAlcance[],
  pedido: string,
  opciones: { nombreSucursal?: (id: string | null) => string | null; alcance?: string } = {},
): BarberoElegido {
  const nombreSucursal = opciones.nombreSucursal ?? (() => null)
  // "Lucas Martinez (Paraná)": lo que devuelve una repregunta vuelve a entrar tal cual.
  const crudo = nombreLimpio(pedido.replace(/\([^)]*\)\s*$/, ''))
  const q = normalizarNombre(crudo)
  const tq = q.split(' ').filter(Boolean)
  const activos = barberos.filter((b) => b.activo)
  const inactivos = barberos.filter((b) => !b.activo)
  // Las opciones que se ofrecen: los activos con sucursal (los que hoy trabajan en el alcance).
  const conSucursal = activos.filter((b) => b.sucursalId != null)
  const sugerencias = ordenarNombres((conSucursal.length > 0 ? conSucursal : activos).map((b) => etiquetaConSucursal(b, nombreSucursal)))
  const deAlcance = opciones.alcance ? ` de ${opciones.alcance}` : ' de tu alcance'

  if (q.length < 2) {
    return { ok: false, error: 'barbero_no_resuelto', mensaje: 'Decime el nombre del barbero.', opciones: sugerencias }
  }

  for (const regla of REGLAS) {
    for (const grupo of [activos, inactivos]) {
      const encontrados = grupo.filter((b) => regla(b, q, tq))
      if (encontrados.length === 0) continue
      // Mismo nombre = misma persona (fichas duplicadas): todos sus ids.
      const porNombre = new Map<string, BarberoDelAlcance[]>()
      for (const b of encontrados) {
        const clave = normalizarNombre(b.nombre)
        porNombre.set(clave, [...(porNombre.get(clave) ?? []), b])
      }
      if (porNombre.size === 1) {
        const [clave, fichas] = [...porNombre.entries()][0]
        // También las fichas homónimas que la regla no tomó (otra sucursal, dada de baja).
        const todas = barberos.filter((b) => normalizarNombre(b.nombre) === clave)
        const ids = [...new Set([...fichas, ...todas].map((b) => b.id))].sort()
        return { ok: true, ids, nombre: fichas[0].nombre, activo: todas.some((b) => b.activo) }
      }
      const candidatos = ordenarNombres(encontrados.map((b) => etiquetaConSucursal(b, nombreSucursal)))
      return {
        ok: false,
        error: 'barbero_no_resuelto',
        mensaje: `"${crudo}" coincide con varios barberos: ${candidatos.join(', ')}. ¿Cuál querés?`,
        opciones: candidatos,
      }
    }
  }

  return {
    ok: false,
    error: 'barbero_no_resuelto',
    mensaje:
      sugerencias.length > 0
        ? `No encontré a "${crudo}" entre los barberos${deAlcance}. Barberos: ${sugerencias.join(', ')}.`
        : `No encontré a "${crudo}": no hay barberos cargados${deAlcance}.`,
    opciones: sugerencias,
  }
}

/**
 * Los barberos ACTIVOS por sucursal, en el orden de `sucursales` (el del
 * contexto, por nombre) y cada lista en orden alfabético, sin repetir nombres.
 * Determinístico: va en el system prompt, que tiene que ser idéntico pedido a
 * pedido para que la caché sirva.
 */
export function agruparEquipo(
  sucursales: { id: string; nombre: string }[],
  barberos: BarberoDelAlcance[],
): TexEquipoSucursal[] {
  const out: TexEquipoSucursal[] = []
  for (const s of sucursales) {
    const nombres = new Map<string, string>()
    for (const b of barberos) {
      if (!b.activo || b.sucursalId !== s.id || !b.nombre) continue
      const clave = normalizarNombre(b.nombre)
      if (!nombres.has(clave)) nombres.set(clave, b.nombre)
    }
    if (nombres.size === 0) continue
    out.push({ sucursal: s.nombre, barberos: ordenarNombres([...nombres.values()]) })
  }
  return out
}
