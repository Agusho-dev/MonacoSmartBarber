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
// «nazi»), Concha, Dick y Bergamo (leído con «v»: «vergamo»). Hasta el 31/oct
// frenaba Faggioli y Faggiani («fagg»), Putin y Penela, dejaba pasar insultos
// de todos los días (boludo, tarado, poronga, pete, maraca, bolita, …) y se
// salteaba con letras de Latin-1 que NFD no descompone («PUTØ», «ØRTØ»). Cada
// excepción está pegada a su raíz y probada contra los insultos que sigue
// frenando. Lo que además es un nombre o un apellido (Gil, Concha, Dick, Nazir)
// pasa: las palabras vulgares que no insultan a nadie las decide el dueño.
// =============================================================================

export const APODO_MAX = 16
/** Letras (con tildes), números, espacio, punto, guion y guion bajo. */
const APODO_PERMITIDO = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$/
const APODO_CON_ALGO = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/

/**
 * Letras que APODO_PERMITIDO acepta y NFD no descompone (y algunas más, por si
 * la lista se agranda): cómo se leen. Sin esto «PUTØ» se leía «put» y «CULØ»,
 * «cul». La prueba recorre todo lo que APODO_PERMITIDO acepta y exige que
 * termine en a-z.
 */
const LETRAS_SUELTAS: Record<string, string> = {
  Æ: 'AE', æ: 'ae', Ð: 'D', ð: 'd', Ø: 'O', ø: 'o', Þ: 'TH', þ: 'th', ß: 'ss',
  Œ: 'OE', œ: 'oe', Ł: 'L', ł: 'l',
}
/** Y cómo se PARECEN (otra lectura): «ßitch» es «Bitch», «pijæ» puede ser «pije». */
const LETRAS_PARECIDAS: Record<string, string> = { ...LETRAS_SUELTAS, ß: 'B', Þ: 'P', þ: 'p', Æ: 'E', æ: 'e', Œ: 'E', œ: 'e' }
const LETRA_SUELTA = new RegExp(`[${Object.keys(LETRAS_SUELTAS).join('')}]`, 'g')

/** Cada letra puede venir repetida («puuuto»). */
function repetible(raiz: string): string {
  return [...raiz].map((c) => `${c}+`).join('')
}

/**
 * Palabras que sólo cuentan SOLAS (un token entero, con plural opcional): como
 * parte de otra palabra dan falsos positivos («corto», «cálculo», «forrado»,
 * «Petete», «cajetilla», «Maracaná»). «nazi» está acá Y abajo: sola («El
 * Nazi», «Nazi88») y pegada («neonazi»). «dick» ya no: Dick es un nombre (lo
 * pegado sigue abajo). «pete» frena también al nombre inglés Pete: acá se lee
 * como el insulto.
 */
const SOLO_PALABRA = [
  'puto', 'puta', 'puton', 'pija', 'orto', 'culo', 'culon', 'culona', 'teta', 'pene', 'verga',
  'choto', 'chota', 'forro', 'forra', 'trolo', 'trola', 'zorra', 'perra', 'pajero', 'pajera',
  'trava', 'marica', 'maricon', 'mogolico', 'mogolica', 'sidoso', 'sexo', 'cock', 'nazi',
  'pete', 'petero', 'petera', 'ojete', 'cajeta', 'maraca', 'bolita', 'fag',
  'cagon', 'cagona', 'cagador', 'cagadora', 'ortiva', 'garca',
  // los plurales en -es (el `s*` cubre sólo los terminados en vocal)
  'cagones', 'maricones', 'culones', 'putones',
].map((p) => new RegExp(`^${repetible(p)}s*$`))

/** Sola y sin plural: «paraguas» es otra cosa. */
const SOLO_PALABRA_SIN_PLURAL = ['paragua'].map((p) => new RegExp(`^${repetible(p)}$`))

/**
 * Raíces que se buscan en cualquier parte del apodo junto (sin espacios ni
 * signos), con las excepciones de palabras y nombres comunes que las
 * contienen: computadora, diputado, disputa, Caputo, Putin, pijama, Vergara,
 * bergamota, Bergamo, Penélope, controla, Nazir, Nazira, Ignazio, Concha, Dick,
 * flojete, tortillería, fagot, y tres apellidos de clientes de verdad (31/oct):
 * Caniggia, Lifshitz y Hauptman.
 */
const EN_CUALQUIER_PARTE: RegExp[] = [
  ...[
    'pelotud', 'mierd', 'conchud', 'chupal', 'chupam', 'chupapet', 'sorete', 'pajer', 'pajiller',
    'culiad', 'culead', 'culiao', 'culeao', 'garch', 'mogolic', 'mongolic', 'hitler', 'porno',
    'violad', 'tetona', 'tetud', 'fuck', 'bitch', 'faggot', 'pussy', 'dickhead',
    'bolud', 'tarad', 'porong', 'garomp', 'bufarr', 'idiot', 'imbecil',
  ].map((r) => new RegExp(repetible(r))),
  new RegExp(`(?<!lif)${repetible('shit')}`),
  new RegExp(`${repetible('nigg')}(?!ia)`),
  new RegExp(`${repetible('cornud')}[ao]`),
  // «puta», «puto», «putita»; no Putin («puti» seguido de n) ni Sputnik («put» sin vocal).
  new RegExp(`(?<!com|dis|di|re|im|am|ca|sa|es)${repetible('put')}(?:[ao]|i+(?![in]))`),
  // Vergara y la b leída como v: Bergamo, bergamota («vergaman» sigue frenado).
  new RegExp(`${repetible('verga')}(?!ra|mo)`),
  new RegExp(`${repetible('pija')}(?!m)`),
  new RegExp(`${repetible('pene')}(?!lo)`),
  new RegExp(`(?<!con)${repetible('trol')}[ao]`),
  new RegExp(`${repetible('forraz')}[ao]`),
  new RegExp(`${repetible('tortiller')}[ao]`),
  // «ojete» pegado («elojete»); no flojete.
  new RegExp(`(?<!fl)${repetible('ojete')}`),
  // «cajeta» pegada; no Cajetan («cajetilla» ya no la contiene).
  new RegExp(`${repetible('cajeta')}(?!n)`),
  // «te cogí», «te cojo», «cogeme», «cójeme»; no «recogeme» ni «Coger» solo.
  new RegExp(`t+e+c+o+[gj]+[io]`),
  new RegExp(`(?<!re)c+o+[gj]+e+m+e+`),
  // «neonazi», «nazismo», «naziboy»; no Nazir, Nazira, Nazim, Nazih, Nazif, Nazia ni Ignazio.
  new RegExp(`${repetible('nazi')}(?![rmhfao])`),
  // Concha es un nombre: lo que no pasa es «concha tu/su madre», «conchetumare», «concha de
  // la lora» y «tu/su concha» (y «conchudo», arriba). Con «su» seguido de «a» pasa: Concha Suárez.
  new RegExp(`${repetible('conch')}[ae]*(?:d+e+)?[ts]+u+(?!a)`),
  new RegExp(`${repetible('conch')}[ae]*d+e+l+a+`),
  new RegExp(`(?:t+u+|s+u+)${repetible('concha')}`),
  // Dick es un nombre: lo que no pasa es pegado a esto («Big Dick», «My Dick»).
  new RegExp(`(?:big|my|your|suck)${repetible('dick')}`),
  /hdp|lpm|(?<!hau)ptm|ctm|lpqtp|hdtpm/,
]

/**
 * Nombres y apellidos que contienen una raíz de EN_CUALQUIER_PARTE y que no
 * se pueden exceptuar con la raíz sin abrirle paso a lo pegado: cuando son una
 * palabra entera, no entran al apodo junto. «Penela» pasa; «penelargo», no.
 */
const NOMBRES_CON_RAIZ = new Set(['penela'])

const LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' }

/** Cómo leer los números: como letras («p1ja», «cu1o») o como separadores («Culo10»). */
const LECTURAS_DE_NUMEROS: ((s: string) => string)[] = [
  (s) => s.replace(/1/g, 'i').replace(/[0-9]/g, (d) => LEET[d] ?? d),
  (s) => s.replace(/1/g, 'l').replace(/[0-9]/g, (d) => LEET[d] ?? d),
  (s) => s.replace(/[0-9]/g, ' '),
]

/**
 * Cómo lee las letras el filtro: sin tildes y con las letras sueltas de Latin-1 en a-z, respetando
 * mayúsculas. Se exporta para la prueba: todo lo que APODO_PERMITIDO acepta tiene que salir en a-z.
 */
export function aLetrasLatinas(apodo: string, letras: Record<string, string> = LETRAS_SUELTAS): string {
  return apodo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(LETRA_SUELTA, (c) => letras[c] ?? c)
}

/**
 * Las lecturas de un apodo que vale la pena revisar: las letras sueltas como se leen y como se
 * parecen, tres cortes de palabras, los números, «k» por «c» y «b» por «v».
 */
function lecturas(apodo: string): { palabras: string[]; junto: string }[] {
  const bases = new Set<string>()
  for (const letras of [LETRAS_SUELTAS, LETRAS_PARECIDAS]) {
    const latino = aLetrasLatinas(apodo, letras)
    // «ElPutoAmo» → «el puto amo»
    bases.add(latino.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())
    // Sólo donde empieza una palabra con mayúscula: «ElCulØ» → «ElCulO» → «el culo» (no «el cul o»).
    bases.add(latino.replace(/([a-z])(?=[A-Z][a-z])/g, '$1 ').toLowerCase())
    // Y sin cortar: «culØ» → «culo».
    bases.add(latino.toLowerCase())
  }
  const salida: { palabras: string[]; junto: string }[] = []
  for (const base of bases) {
    for (const numeros of LECTURAS_DE_NUMEROS) {
      for (const parecidas of [false, true]) {
        let s = numeros(base)
        if (parecidas) s = s.replace(/k/g, 'c').replace(/b/g, 'v')
        const palabras = s.split(/[^a-z]+/).filter(Boolean)
        salida.push({ palabras, junto: palabras.filter((p) => !NOMBRES_CON_RAIZ.has(p)).join('') })
      }
    }
  }
  return salida
}

/** Filtro básico de malas palabras (rioplatense + algo de inglés). */
export function esApodoOfensivo(apodo: string): boolean {
  return lecturas(apodo).some(
    ({ palabras, junto }) =>
      palabras.some((p) => SOLO_PALABRA.some((re) => re.test(p)) || SOLO_PALABRA_SIN_PLURAL.some((re) => re.test(p))) ||
      SOLO_PALABRA.some((re) => re.test(junto)) ||
      SOLO_PALABRA_SIN_PLURAL.some((re) => re.test(junto)) ||
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
