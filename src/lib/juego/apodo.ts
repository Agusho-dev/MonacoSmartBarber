// =============================================================================
// Apodo del ranking de «Corte Final»: normalización y filtro de malas palabras.
//
// Lo usa la server action que guarda la partida (src/lib/actions/juego.ts, por
// medio de servidor.ts, que lo reexporta). Sin imports de `@/` ni
// `server-only` a propósito: se prueba con Node tal cual. La lista no es un
// secreto: si algún día la UI quiere avisar antes de mandar, puede importarlo.
//
// El filtro es básico (rioplatense + algo de inglés) y se equivoca para los dos
// lados. Hasta el 30/oct rechazaba nombres de verdad: Nazir y Nazira (por
// «nazi»), Concha, Dick y Bergamo (leído con «v»: «vergamo»). Cada excepción
// está pegada a su raíz y probada contra los insultos que sigue frenando.
// =============================================================================

export const APODO_MAX = 16
/** Letras (con tildes), números, espacio, punto, guion y guion bajo. */
const APODO_PERMITIDO = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$/
const APODO_CON_ALGO = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/

/** Cada letra puede venir repetida («puuuto»). */
function repetible(raiz: string): string {
  return [...raiz].map((c) => `${c}+`).join('')
}

/**
 * Palabras que sólo cuentan SOLAS (un token entero, con plural opcional): como
 * parte de otra palabra dan falsos positivos («corto», «cálculo», «forrado»).
 * «nazi» está acá Y abajo: sola («El Nazi», «Nazi88») y pegada («neonazi»).
 * «dick» ya no: Dick es un nombre (lo pegado sigue abajo).
 */
const SOLO_PALABRA = [
  'puto', 'puta', 'puton', 'pija', 'orto', 'culo', 'culon', 'culona', 'teta', 'pene', 'verga',
  'choto', 'chota', 'forro', 'forra', 'trolo', 'trola', 'zorra', 'perra', 'pajero', 'pajera',
  'trava', 'marica', 'maricon', 'mogolico', 'mogolica', 'sidoso', 'sexo', 'cock', 'nazi',
].map((p) => new RegExp(`^${repetible(p)}s*$`))

/**
 * Raíces que se buscan en cualquier parte del apodo junto (sin espacios ni
 * signos), con las excepciones de palabras y nombres comunes que las
 * contienen: computadora, diputado, disputa, Caputo, pijama, Vergara,
 * bergamota, Bergamo, Penélope, controla, Nazir, Nazira, Ignazio, Concha, Dick.
 */
const EN_CUALQUIER_PARTE: RegExp[] = [
  ...[
    'pelotud', 'mierd', 'conchud', 'chupal', 'chupam', 'sorete', 'pajer', 'culiad',
    'culead', 'culiao', 'culeao', 'garch', 'mogolic', 'hitler', 'porno', 'violad',
    'tetona', 'tetud', 'fuck', 'shit', 'bitch', 'nigg', 'fagg', 'pussy', 'dickhead',
  ].map((r) => new RegExp(repetible(r))),
  new RegExp(`(?<!com|dis|di|re|im|am|ca|sa|es)${repetible('put')}[aoi]`),
  // Vergara y la b leída como v: Bergamo, bergamota («vergaman» sigue frenado).
  new RegExp(`${repetible('verga')}(?!ra|mo)`),
  new RegExp(`${repetible('pija')}(?!m)`),
  new RegExp(`${repetible('pene')}(?!lo)`),
  new RegExp(`(?<!con)${repetible('trol')}[ao]`),
  // «neonazi», «nazismo», «naziboy»; no Nazir, Nazira, Nazim, Nazih, Nazif, Nazia ni Ignazio.
  new RegExp(`${repetible('nazi')}(?![rmhfao])`),
  // Concha es un nombre: lo que no pasa es «concha tu/su madre», «conchetumare», «concha de
  // la lora» y «tu/su concha» (y «conchudo», arriba). Con «su» seguido de «a» pasa: Concha Suárez.
  new RegExp(`${repetible('conch')}[ae]*(?:d+e+)?[ts]+u+(?!a)`),
  new RegExp(`${repetible('conch')}[ae]*d+e+l+a+`),
  new RegExp(`(?:t+u+|s+u+)${repetible('concha')}`),
  // Dick es un nombre: lo que no pasa es pegado a esto («Big Dick», «My Dick»).
  new RegExp(`(?:big|my|your|suck)${repetible('dick')}`),
  /hdp|lpm|ptm|ctm|lpqtp|hdtpm/,
]

const LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' }

/** Cómo leer los números: como letras («p1ja», «cu1o») o como separadores («Culo10»). */
const LECTURAS_DE_NUMEROS: ((s: string) => string)[] = [
  (s) => s.replace(/1/g, 'i').replace(/[0-9]/g, (d) => LEET[d] ?? d),
  (s) => s.replace(/1/g, 'l').replace(/[0-9]/g, (d) => LEET[d] ?? d),
  (s) => s.replace(/[0-9]/g, ' '),
]

/** Las lecturas de un apodo que vale la pena revisar: números, «k» por «c» y «b» por «v». */
function lecturas(apodo: string): { palabras: string[]; junto: string }[] {
  const sinTildes = apodo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // «ElPutoAmo» → «el puto amo»
  const separado = sinTildes.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  const salida: { palabras: string[]; junto: string }[] = []
  for (const numeros of LECTURAS_DE_NUMEROS) {
    for (const parecidas of [false, true]) {
      let s = numeros(separado)
      if (parecidas) s = s.replace(/k/g, 'c').replace(/b/g, 'v')
      const palabras = s.split(/[^a-z]+/).filter(Boolean)
      salida.push({ palabras, junto: palabras.join('') })
    }
  }
  return salida
}

/** Filtro básico de malas palabras (rioplatense + algo de inglés). */
export function esApodoOfensivo(apodo: string): boolean {
  return lecturas(apodo).some(
    ({ palabras, junto }) =>
      palabras.some((p) => SOLO_PALABRA.some((re) => re.test(p))) ||
      SOLO_PALABRA.some((re) => re.test(junto)) ||
      EN_CUALQUIER_PARTE.some((re) => re.test(junto)),
  )
}

export type ResultadoApodo = { ok: true; apodo: string } | { ok: false; error: string }

/** Normaliza (espacios, NFC) y valida el apodo del ranking. Los errores van tal cual a la pantalla. */
export function validarApodo(crudo: unknown): ResultadoApodo {
  if (typeof crudo !== 'string') return { ok: false, error: 'Escribí un apodo para el ranking.' }
  const apodo = crudo.normalize('NFC').replace(/\s+/g, ' ').trim()
  const largo = [...apodo].length
  if (largo === 0) return { ok: false, error: 'Escribí un apodo para el ranking.' }
  if (largo > APODO_MAX) return { ok: false, error: `El apodo puede tener hasta ${APODO_MAX} caracteres.` }
  if (!APODO_PERMITIDO.test(apodo) || !APODO_CON_ALGO.test(apodo)) {
    return { ok: false, error: 'Usá letras, números, espacios, puntos o guiones.' }
  }
  if (esApodoOfensivo(apodo)) return { ok: false, error: 'Ese apodo no puede ir en el ranking. Probá con otro.' }
  return { ok: true, apodo }
}
