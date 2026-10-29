// =============================================================================
// Servidor de «Corte Final»: lo que /juego necesita saber al abrir, y los
// helpers que comparten las server actions de src/lib/actions/juego.ts.
//
// EL JUEGO ES DE MONACO. Los luchadores son sus barberos y las arenas, sus
// locales. La organización se ancla por el slug de su sucursal madre
// (`rondeau`; `branches.slug` es UNIQUE global) y todo se acota a ella: una
// sucursal de otra organización no abre el juego con su slug, no muestra el QR
// en el kiosko (el kiosko es el mismo componente para todas las orgs) y no
// suma partidas.
//
// Server-only y SIN 'use server': exporta helpers sincrónicos que no deben
// ser endpoints. Lee con createAdminClient (service role) y pide columnas
// explícitas, con los embeds por nombre de constraint (Known Risk #15).
// =============================================================================

import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { ARENAS, IDS_ARENAS, arenaDeSucursal } from './arenas'
import { leerTokenJuego, type TokenJuego } from './token'
import type { DatosEntradaJuego } from './tipos'

type ClienteAdmin = ReturnType<typeof createAdminClient>

/** La sucursal que ancla la organización del juego (Monaco). */
export const SLUG_ANCLA_JUEGO = 'rondeau'
/** La de `branches.timezone` por defecto. */
export const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires'

/**
 * No se pudo LEER (red, base caída, error de PostgREST): distinto de «no
 * existe». Los llamadores lo muestran como error y nunca como un vacío.
 */
export class ErrorLecturaJuego extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorLecturaJuego'
  }
}

// ── Organización y sucursales ───────────────────────────────────────────────

let cacheOrg: { id: string; hasta: number } | null = null
const VIDA_CACHE_ORG_MS = 10 * 60 * 1000

/** La organización del juego. Tira ErrorLecturaJuego si no se pudo resolver. */
export async function orgDelJuego(admin: ClienteAdmin): Promise<string> {
  const ahora = Date.now()
  if (cacheOrg && cacheOrg.hasta > ahora) return cacheOrg.id
  const { data, error } = await admin
    .from('branches')
    .select('organization_id')
    .eq('slug', SLUG_ANCLA_JUEGO)
    .maybeSingle()
  if (error) throw new ErrorLecturaJuego(`organización del juego: ${error.message}`)
  const id = (data as { organization_id?: string | null } | null)?.organization_id
  if (!id) throw new ErrorLecturaJuego(`no existe la sucursal ancla «${SLUG_ANCLA_JUEGO}»`)
  cacheOrg = { id, hasta: ahora + VIDA_CACHE_ORG_MS }
  return id
}

export interface SucursalJuego {
  id: string
  slug: string
  /** Para mostrar: con tildes si es la sucursal de una arena («Pueyrredón»). */
  nombre: string
  timezone: string
}

const COLUMNAS_SUCURSAL = 'id, slug, name, timezone'

interface FilaSucursal {
  id: string
  slug: string
  name: string
  timezone: string | null
}

/** En la base van sin tildes («Parana»); la arena del juego trae el nombre bien escrito. */
export function nombreVisibleSucursal(slug: string, nombreBase: string): string {
  const arena = IDS_ARENAS.find((id) => ARENAS[id].sucursalSlug === slug)
  return arena ? ARENAS[arena].nombre : nombreBase
}

function aSucursal(fila: FilaSucursal): SucursalJuego {
  return {
    id: fila.id,
    slug: fila.slug,
    nombre: nombreVisibleSucursal(fila.slug, fila.name),
    timezone: fila.timezone || ZONA_POR_DEFECTO,
  }
}

/** Slug en minúsculas si tiene forma de slug; null si no (nunca llega a la query). */
export function normalizarSlug(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const s = valor.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(s) ? s : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sucursal ACTIVA de la organización del juego, por slug. Null si no hay. */
export async function sucursalPorSlug(
  admin: ClienteAdmin,
  slug: unknown,
  orgId: string,
): Promise<SucursalJuego | null> {
  const s = normalizarSlug(slug)
  if (!s) return null
  const { data, error } = await admin
    .from('branches')
    .select(COLUMNAS_SUCURSAL)
    .eq('slug', s)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new ErrorLecturaJuego(`sucursal «${s}»: ${error.message}`)
  return data ? aSucursal(data as FilaSucursal) : null
}

/** Sucursal ACTIVA de la organización del juego, por id. Null si no hay. */
export async function sucursalPorId(
  admin: ClienteAdmin,
  id: string | null | undefined,
  orgId: string,
): Promise<SucursalJuego | null> {
  if (!id || !UUID.test(id)) return null
  const { data, error } = await admin
    .from('branches')
    .select(COLUMNAS_SUCURSAL)
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new ErrorLecturaJuego(`sucursal ${id}: ${error.message}`)
  return data ? aSucursal(data as FilaSucursal) : null
}

/** 'YYYY-MM-DD' de esa fecha en esa zona horaria (con la de Monaco si la zona no existe). */
export function diaEnZona(fecha: Date, zona: string): string {
  const formatear = (z: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha)
  try {
    return formatear(zona)
  } catch {
    return formatear(ZONA_POR_DEFECTO)
  }
}

// ── Nombres ─────────────────────────────────────────────────────────────────

/**
 * Nombre de pila para saludar: la primera palabra, sólo letras (con tildes),
 * apóstrofos y guiones, capitalizada («JUAN CRUZ» → «Juan», «maría» → «María»,
 * «jean-pierre» → «Jean-Pierre»). Null si no queda nada que parezca un nombre.
 */
export function nombreDePila(nombre: string | null | undefined): string | null {
  if (typeof nombre !== 'string') return null
  const primera = nombre.normalize('NFC').trim().split(/\s+/)[0] ?? ''
  const limpia = primera
    .replace(/[^\p{L}'’-]/gu, '')
    .replace(/^['’-]+|['’-]+$/g, '')
    .slice(0, 24)
  if (!limpia) return null
  return limpia
    .toLocaleLowerCase('es-AR')
    .split('-')
    .map((parte) => (parte ? parte.charAt(0).toLocaleUpperCase('es-AR') + parte.slice(1) : parte))
    .join('-')
}

// ── Apodo del ranking ───────────────────────────────────────────────────────

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
 */
const SOLO_PALABRA = [
  'puto', 'puta', 'puton', 'pija', 'orto', 'culo', 'culon', 'culona', 'teta', 'pene', 'verga',
  'choto', 'chota', 'forro', 'forra', 'trolo', 'trola', 'zorra', 'perra', 'pajero', 'pajera',
  'trava', 'marica', 'maricon', 'mogolico', 'mogolica', 'sidoso', 'sexo', 'dick', 'cock',
].map((p) => new RegExp(`^${repetible(p)}s*$`))

/**
 * Raíces que se buscan en cualquier parte del apodo junto (sin espacios ni
 * signos), con las excepciones de palabras comunes que las contienen:
 * computadora, diputado, disputa, Caputo, pijama, Vergara, Penélope, controla.
 */
const EN_CUALQUIER_PARTE: RegExp[] = [
  ...[
    'pelotud', 'mierd', 'conchud', 'concha', 'chupal', 'chupam', 'sorete', 'pajer', 'culiad',
    'culead', 'culiao', 'culeao', 'garch', 'mogolic', 'nazi', 'hitler', 'porno', 'violad',
    'tetona', 'tetud', 'fuck', 'shit', 'bitch', 'nigg', 'fagg', 'pussy',
  ].map((r) => new RegExp(repetible(r))),
  new RegExp(`(?<!com|dis|di|re|im|am|ca|sa|es)${repetible('put')}[aoi]`),
  new RegExp(`${repetible('verga')}(?!ra)`),
  new RegExp(`${repetible('pija')}(?!m)`),
  new RegExp(`${repetible('pene')}(?!lo)`),
  new RegExp(`(?<!con)${repetible('trol')}[ao]`),
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
  const sinTildes = apodo.normalize('NFD').replace(/[̀-ͯ]/g, '')
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

// ── Entrada a /juego ────────────────────────────────────────────────────────

const DATOS_POR_DEFECTO: DatosEntradaJuego = {
  token: null,
  sucursal: null,
  cliente: null,
  arenaInicial: 'rondeau',
  barberoAsignado: null,
}

interface FilaEntradaQr {
  branch_id: string | null
  barber_id: string | null
  organization_id: string
  client: { name: string | null } | null
}

/** Lo que dice un token válido. Null si no es de una entrada de la organización del juego. */
async function datosDesdeToken(
  admin: ClienteAdmin,
  orgId: string,
  token: TokenJuego,
  crudo: string,
): Promise<DatosEntradaJuego | null> {
  const { data, error } = await admin
    .from('queue_entries')
    .select('branch_id, barber_id, organization_id, client:clients!queue_entries_client_id_fkey(name)')
    .eq('id', token.queueEntryId)
    .maybeSingle()
  if (error) throw new ErrorLecturaJuego(`entrada del QR: ${error.message}`)
  const entrada = data as unknown as FilaEntradaQr | null
  if (entrada && entrada.organization_id !== orgId) return null

  const sucursal = await sucursalPorId(admin, entrada?.branch_id ?? token.branchId, orgId)
  // Sin la entrada (se borró) y sin una sucursal nuestra, el token no dice nada útil.
  if (!entrada && !sucursal) return null

  const nombre = nombreDePila(entrada?.client?.name)
  return {
    token: crudo,
    sucursal: sucursal ? { slug: sucursal.slug, nombre: sucursal.nombre } : null,
    cliente: nombre ? { nombre } : null,
    arenaInicial: sucursal ? arenaDeSucursal(sucursal.slug) : DATOS_POR_DEFECTO.arenaInicial,
    barberoAsignado: entrada?.barber_id ?? null,
  }
}

/**
 * Resuelve lo que /juego necesita al abrir: `?t=<token del QR>` o
 * `?s=<slug de sucursal>`. Con un token válido: sucursal, nombre de pila del
 * cliente, barbero asignado y la arena del local. Sin token (o vencido, o
 * adulterado): la sucursal del slug si es nuestra. Si no, todo null y Rondeau.
 * NUNCA tira: ante cualquier error devuelve el default (y lo deja en el log).
 */
export async function obtenerDatosEntradaJuego(params: { t?: string; s?: string }): Promise<DatosEntradaJuego> {
  try {
    const admin = createAdminClient()
    const orgId = await orgDelJuego(admin)

    const crudo = params?.t
    const token = leerTokenJuego(crudo)
    if (token && typeof crudo === 'string') {
      const conQr = await datosDesdeToken(admin, orgId, token, crudo)
      if (conQr) return conQr
    }

    const sucursal = await sucursalPorSlug(admin, params?.s, orgId)
    if (sucursal) {
      return {
        ...DATOS_POR_DEFECTO,
        sucursal: { slug: sucursal.slug, nombre: sucursal.nombre },
        arenaInicial: arenaDeSucursal(sucursal.slug),
      }
    }
    return { ...DATOS_POR_DEFECTO }
  } catch (e) {
    console.error('[juego] obtenerDatosEntradaJuego:', e instanceof Error ? e.message : e)
    return { ...DATOS_POR_DEFECTO }
  }
}
