'use server'

// =============================================================================
// Server actions de «Corte Final» (/juego) y del QR del kiosko.
//
// Todo con createAdminClient: `juego_partidas` no tiene policies (mig 232) y
// sus funciones de ranking sólo las ejecuta service_role. La organización y la
// sucursal se resuelven ACÁ (del token firmado del QR o del slug, acotados a la
// organización del juego: ver src/lib/juego/servidor.ts), nunca del browser.
//
// Errores: se devuelven con un texto para mostrar y se dejan en el log. Un
// ranking que no se pudo leer es `{ ok: false }`, nunca una lista vacía
// (Known Risks #13 y #15). Nada de lo que vuelve lleva ids internos, salvo el
// `barberoAsignado` del contrato (src/lib/juego/tipos.ts).
// =============================================================================

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getClientIP, rateLimit } from '@/lib/rate-limit'
import { buildAppUrl } from '@/lib/app-url'
import { isValidUUID } from '@/lib/validation'
import { IDS_PERSONAJES } from '@/lib/juego/personajes'
import { IDS_ARENAS } from '@/lib/juego/arenas'
import { firmarTokenJuego, leerTokenJuego } from '@/lib/juego/token'
import {
  ZONA_POR_DEFECTO,
  diaEnZona,
  nombreDePila,
  orgDelJuego,
  sucursalPorId,
  sucursalPorSlug,
  validarApodo,
  type SucursalJuego,
} from '@/lib/juego/servidor'
import type {
  Dificultad,
  EstadisticaPersonaje,
  EstadoTurnoJuego,
  FilaRanking,
  IdArena,
  IdPersonaje,
  PartidaParaGuardar,
  PeriodoRanking,
} from '@/lib/juego/tipos'

const ERROR_GUARDAR = 'No pudimos guardar la partida. Probá de nuevo en un rato.'
const ERROR_DATOS = 'Los datos de la partida no son válidos.'
const ERROR_RANKING = 'No pudimos cargar el ranking. Probá de nuevo en un rato.'
const ERROR_ESTADISTICAS = 'No pudimos cargar las estadísticas.'

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function esPersonaje(valor: unknown): valor is IdPersonaje {
  return typeof valor === 'string' && (IDS_PERSONAJES as readonly string[]).includes(valor)
}

function esArena(valor: unknown): valor is IdArena {
  return typeof valor === 'string' && (IDS_ARENAS as readonly string[]).includes(valor)
}

// ── Estado del turno (lo pregunta /juego cada ~20 s) ────────────────────────

const ESTADO_DESCONOCIDO: EstadoTurnoJuego = { estado: 'desconocido', adelante: null, etiqueta: null, barbero: null }

function etiquetaDeEspera(adelante: number | null): string | null {
  if (adelante === null) return null
  if (adelante <= 0) return 'Sos el próximo'
  if (adelante === 1) return 'Hay uno antes que vos'
  return `Hay ${adelante} antes que vos`
}

interface FilaPosicion {
  position: number | null
  effective_ahead: number | null
  status: string | null
  label: string | null
}

interface FilaBarberoDeEntrada {
  barber: { full_name: string | null } | null
}

/**
 * Dónde está el cliente del QR en la fila, con la misma cuenta que el kiosko
 * («Mi turno» y el cartel de éxito): la RPC `get_client_queue_position`.
 * Un token inválido o vencido, o una lectura que falla, dan `desconocido` con
 * todo en null (no se sabe), nunca un «Sos el próximo» inventado.
 */
export async function obtenerEstadoTurnoJuego(token: string): Promise<EstadoTurnoJuego> {
  const datos = leerTokenJuego(token)
  if (!datos) return { ...ESTADO_DESCONOCIDO }
  try {
    const admin = createAdminClient()
    const [posicion, entrada] = await Promise.all([
      admin.rpc('get_client_queue_position', { p_queue_entry_id: datos.queueEntryId }),
      admin
        .from('queue_entries')
        .select('barber:staff!queue_entries_barber_id_fkey(full_name)')
        .eq('id', datos.queueEntryId)
        .maybeSingle(),
    ])
    if (posicion.error) {
      console.error('[juego] estado del turno:', posicion.error.message)
      return { ...ESTADO_DESCONOCIDO }
    }
    if (entrada.error) console.error('[juego] barbero del turno:', entrada.error.message)

    const fila = (Array.isArray(posicion.data) ? posicion.data[0] : posicion.data) as FilaPosicion | null | undefined
    const barbero = nombreDePila((entrada.data as unknown as FilaBarberoDeEntrada | null)?.barber?.full_name)

    switch (fila?.status) {
      case 'waiting': {
        const n = fila.effective_ahead
        const adelante = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
        return { estado: 'esperando', adelante, etiqueta: etiquetaDeEspera(adelante), barbero }
      }
      case 'in_progress':
        return {
          estado: 'atendiendo',
          adelante: 0,
          etiqueta: barbero ? `¡Te toca! Te atiende ${barbero}` : '¡Te toca!',
          barbero,
        }
      case 'completed':
        return { estado: 'terminado', adelante: null, etiqueta: 'Ya te atendieron', barbero }
      case 'cancelled':
        return { estado: 'terminado', adelante: null, etiqueta: 'Ya no estás en la fila', barbero }
      default:
        // 'not_found' (la entrada ya no existe) o algo que la RPC no devolvía.
        return { ...ESTADO_DESCONOCIDO }
    }
  } catch (e) {
    console.error('[juego] obtenerEstadoTurnoJuego:', mensaje(e))
    return { ...ESTADO_DESCONOCIDO }
  }
}

// ── Guardar una partida ─────────────────────────────────────────────────────

/** Entero en [min, max]; acepta un número con decimales y lo redondea (el daño puede venir fraccionado). */
const entero = (min: number, max: number) =>
  z
    .number()
    .finite()
    .transform((n) => Math.round(n))
    .pipe(z.number().int().min(min).max(max))

/** Rangos realistas para una partida al mejor de 3 de ~2–3 minutos (la base tiene redes más holgadas). */
const esquemaPartida = z.object({
  token: z.string().max(400).nullish(),
  sucursalSlug: z.string().max(64).nullish(),
  apodo: z.string().max(64),
  personaje: z.string().refine(esPersonaje),
  rival: z.string().refine(esPersonaje),
  arena: z.string().refine(esArena),
  dificultad: z.enum(['facil', 'normal', 'dificil']),
  resultado: z.enum(['victoria', 'derrota']),
  rondasGanadas: entero(0, 5),
  rondasPerdidas: entero(0, 5),
  puntaje: entero(0, 60_000),
  comboMax: entero(0, 60),
  criticos: entero(0, 150),
  especiales: entero(0, 60),
  danioHecho: entero(0, 10_000),
  danioRecibido: entero(0, 10_000),
  perfectos: entero(0, 5),
  finalAlCero: z.boolean(),
  duracionSeg: entero(20, 900),
})

type PartidaValidada = z.infer<typeof esquemaPartida>

const MULTIPLICADOR: Record<Dificultad, number> = { facil: 0.6, normal: 1, dificil: 1.6 }

/**
 * Lo máximo que puede valer una partida con estos números según la fórmula
 * del diseño (calcularPuntaje), con el doble de holgura: el motor ajusta los
 * pesos después de simular y esto sólo tiene que frenar un puntaje inventado
 * («60.000 con 0 de daño»), nunca una partida real.
 */
function techoDePuntaje(p: PartidaValidada): number {
  const base =
    p.danioHecho +
    p.comboMax * 40 +
    p.criticos * 30 +
    p.especiales * 120 +
    p.rondasGanadas * (500 + 60 * 10) + // ronda ganada + segundos restantes del KO
    p.perfectos * 1000 +
    (p.finalAlCero ? 1500 : 0)
  const techo = base * MULTIPLICADOR[p.dificultad] * (p.resultado === 'victoria' ? 1 : 0.5)
  return techo * 2 + 1000
}

const LIMITE_GUARDAR = { limit: 6, window: 600 }
const LIMITE_GUARDAR_IP_CON_QR = { limit: 40, window: 600 }

interface FilaEntradaParaGuardar {
  branch_id: string | null
  client_id: string | null
  organization_id: string
}

/**
 * Guarda una partida terminada y devuelve el puesto del apodo en el ranking
 * de HOY de esa sucursal (o el general si no hay sucursal). Organización y
 * sucursal salen del token del QR o, sin token, del slug; sin ninguna de las
 * dos, la partida queda en la organización del juego sin sucursal.
 *
 * Rate limit: 6 cada 10 min por jugador. Con QR el jugador es IP + entrada de
 * la fila (los clientes del local comparten el wifi), con un techo de 40 por
 * IP; sin QR, la IP.
 */
export async function guardarPartidaJuego(
  input: PartidaParaGuardar,
): Promise<{ ok: true; puesto: number | null } | { ok: false; error: string }> {
  const parseo = esquemaPartida.safeParse(input)
  if (!parseo.success) {
    console.warn('[juego] partida rechazada:', parseo.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return { ok: false, error: ERROR_DATOS }
  }
  const p = parseo.data

  const apodo = validarApodo(p.apodo)
  if (!apodo.ok) return { ok: false, error: apodo.error }

  // Coherencia: un ganador ganó al menos una ronda, un perdedor perdió al menos una.
  if (p.resultado === 'victoria' ? p.rondasGanadas < 1 : p.rondasPerdidas < 1) {
    console.warn('[juego] partida incoherente: resultado', p.resultado, 'con rondas', p.rondasGanadas, '-', p.rondasPerdidas)
    return { ok: false, error: ERROR_DATOS }
  }
  if (p.puntaje > techoDePuntaje(p)) {
    console.warn('[juego] puntaje imposible:', p.puntaje, 'techo', Math.round(techoDePuntaje(p)))
    return { ok: false, error: ERROR_DATOS }
  }

  try {
    const token = leerTokenJuego(p.token)
    const ip = await getClientIP()
    const [porJugador, porIp] = await Promise.all([
      rateLimit('juego_guardar', token ? `${ip}:${token.queueEntryId}` : ip, LIMITE_GUARDAR),
      token ? rateLimit('juego_guardar_ip', ip, LIMITE_GUARDAR_IP_CON_QR) : Promise.resolve(null),
    ])
    if (!porJugador.allowed || (porIp && !porIp.allowed)) {
      return { ok: false, error: 'Guardaste muchas partidas seguidas. Esperá unos minutos y probá de nuevo.' }
    }

    const admin = createAdminClient()
    const orgId = await orgDelJuego(admin)

    let sucursal: SucursalJuego | null = null
    let queueEntryId: string | null = null
    let clientId: string | null = null
    if (token) {
      const { data, error } = await admin
        .from('queue_entries')
        .select('branch_id, client_id, organization_id')
        .eq('id', token.queueEntryId)
        .maybeSingle()
      if (error) {
        console.error('[juego] entrada del QR al guardar:', error.message)
        return { ok: false, error: ERROR_GUARDAR }
      }
      const entrada = data as FilaEntradaParaGuardar | null
      // Un token de una entrada de otra organización no lo emitimos nosotros: se ignora.
      if (!entrada || entrada.organization_id === orgId) {
        queueEntryId = token.queueEntryId
        clientId = entrada?.client_id ?? null
        sucursal = await sucursalPorId(admin, entrada?.branch_id ?? token.branchId, orgId)
      }
    }
    if (!sucursal) sucursal = await sucursalPorSlug(admin, p.sucursalSlug, orgId)

    const { error: errorAlta } = await admin.from('juego_partidas').insert({
      organization_id: orgId,
      branch_id: sucursal?.id ?? null,
      queue_entry_id: queueEntryId,
      client_id: clientId,
      apodo: apodo.apodo,
      personaje: p.personaje,
      rival: p.rival,
      arena: p.arena,
      dificultad: p.dificultad,
      resultado: p.resultado,
      rondas_ganadas: p.rondasGanadas,
      rondas_perdidas: p.rondasPerdidas,
      puntaje: p.puntaje,
      combo_max: p.comboMax,
      criticos: p.criticos,
      especiales: p.especiales,
      danio_hecho: p.danioHecho,
      danio_recibido: p.danioRecibido,
      // Un perfecto es una ronda ganada, y el remate «AL CERO» sólo lo hace el que gana.
      perfectos: Math.min(p.perfectos, p.rondasGanadas),
      final_al_cero: p.finalAlCero && p.resultado === 'victoria',
      duracion_seg: p.duracionSeg,
    })
    if (errorAlta) {
      console.error('[juego] insert de la partida:', errorAlta.message)
      return { ok: false, error: ERROR_GUARDAR }
    }

    // La partida ya quedó guardada: si el puesto no se puede leer, se informa null (no se sabe).
    const { data: puesto, error: errorPuesto } = await admin.rpc('juego_puesto', {
      p_org: orgId,
      p_branch: sucursal?.id ?? null,
      p_periodo: 'hoy',
      p_apodo: apodo.apodo,
    })
    if (errorPuesto) console.error('[juego] puesto después de guardar:', errorPuesto.message)
    return { ok: true, puesto: typeof puesto === 'number' ? puesto : null }
  } catch (e) {
    console.error('[juego] guardarPartidaJuego:', mensaje(e))
    return { ok: false, error: ERROR_GUARDAR }
  }
}

// ── Ranking y estadísticas ──────────────────────────────────────────────────

const PERIODOS: readonly PeriodoRanking[] = ['hoy', 'semana', 'siempre']

interface FilaRankingSql {
  apodo: string
  personaje: string
  puntaje: number
  fecha: string
}

/**
 * Top 10 con el mejor puntaje de cada apodo. `sucursalSlug` null = el ranking
 * general (todas las sucursales). Hoy y semana (de lunes a domingo) en hora de
 * Córdoba; lo calcula la base (juego_ranking, mig 232).
 */
export async function obtenerRankingJuego(
  sucursalSlug: string | null,
  periodo: PeriodoRanking,
): Promise<{ ok: true; filas: FilaRanking[] } | { ok: false; error: string }> {
  if (!PERIODOS.includes(periodo)) return { ok: false, error: 'Elegí hoy, semana o siempre.' }
  try {
    const admin = createAdminClient()
    const orgId = await orgDelJuego(admin)

    let branchId: string | null = null
    if (sucursalSlug) {
      const sucursal = await sucursalPorSlug(admin, sucursalSlug, orgId)
      if (!sucursal) return { ok: false, error: 'No encontramos esa sucursal.' }
      branchId = sucursal.id
    }

    // Uno de más: la RPC agrupa por apodo, así que «Anónimo» ocupa a lo sumo una fila.
    const { data, error } = await admin.rpc('juego_ranking', {
      p_org: orgId,
      p_branch: branchId,
      p_periodo: periodo,
      p_limite: 11,
    })
    if (error) {
      console.error('[juego] ranking:', error.message)
      return { ok: false, error: ERROR_RANKING }
    }

    const filas: FilaRanking[] = ((data ?? []) as FilaRankingSql[])
      // Un luchador que salió del catálogo no se puede dibujar: su fila no se muestra.
      .filter((f) => esPersonaje(f.personaje))
      // Las peleas que se cerraron sin confirmar apodo se guardan como «Anónimo» para las
      // estadísticas de los barberos, pero no compiten en el ranking.
      .filter((f) => f.apodo !== 'Anónimo')
      .slice(0, 10)
      .map((f, i) => ({
        puesto: i + 1,
        apodo: f.apodo,
        personaje: f.personaje as IdPersonaje,
        puntaje: f.puntaje,
        fecha: new Date(f.fecha).toISOString(),
      }))
    return { ok: true, filas }
  } catch (e) {
    console.error('[juego] obtenerRankingJuego:', mensaje(e))
    return { ok: false, error: ERROR_RANKING }
  }
}

interface FilaEstadisticaSql {
  personaje: string
  peleas: number
  victorias: number
}

/**
 * Peleas y victorias por personaje del jugador, de todas las sucursales. Un
 * personaje sin partidas va con 0 (es un dato, no una falla: si la lectura
 * falla la respuesta es `{ ok: false }`).
 */
export async function obtenerEstadisticasPersonajes(): Promise<
  { ok: true; datos: EstadisticaPersonaje[] } | { ok: false; error: string }
> {
  try {
    const admin = createAdminClient()
    const orgId = await orgDelJuego(admin)
    const { data, error } = await admin.rpc('juego_estadisticas_personajes', { p_org: orgId })
    if (error) {
      console.error('[juego] estadísticas por personaje:', error.message)
      return { ok: false, error: ERROR_ESTADISTICAS }
    }
    const porPersonaje = new Map(((data ?? []) as FilaEstadisticaSql[]).map((f) => [f.personaje, f]))
    const datos: EstadisticaPersonaje[] = IDS_PERSONAJES.map((id) => ({
      personaje: id,
      peleas: porPersonaje.get(id)?.peleas ?? 0,
      victorias: porPersonaje.get(id)?.victorias ?? 0,
    }))
    return { ok: true, datos }
  } catch (e) {
    console.error('[juego] obtenerEstadisticasPersonajes:', mensaje(e))
    return { ok: false, error: ERROR_ESTADISTICAS }
  }
}

// ── El QR del kiosko ────────────────────────────────────────────────────────

interface FilaEntradaParaEnlace {
  branch_id: string
  organization_id: string
  status: string
  is_break: boolean | null
  checked_in_at: string
  branch: { timezone: string | null } | null
}

/** Una tablet de un local hace un check-in por cliente: 60 cada 10 min por IP es holgado. */
const LIMITE_ENLACE = { limit: 60, window: 600 }

/**
 * Para el cartel de éxito (y «Mi turno») del kiosko: el link con el token
 * firmado que va en el QR. Sólo para una entrada de HOY que sigue en la fila
 * (esperando o atendiéndose) y de la organización del juego: en el kiosko de
 * cualquier otra organización devuelve error y el kiosko no muestra nada.
 */
export async function crearEnlaceJuego(
  queueEntryId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!isValidUUID(queueEntryId)) return { ok: false, error: 'Lugar en la fila inválido.' }
  try {
    const admin = createAdminClient()
    const ip = await getClientIP()
    const [permiso, orgId, lectura] = await Promise.all([
      rateLimit('juego_enlace', ip, LIMITE_ENLACE),
      orgDelJuego(admin),
      admin
        .from('queue_entries')
        .select('branch_id, organization_id, status, is_break, checked_in_at, branch:branches!queue_entries_branch_id_fkey(timezone)')
        .eq('id', queueEntryId)
        .maybeSingle(),
    ])
    if (!permiso.allowed) return { ok: false, error: 'Demasiados pedidos. Probá en unos minutos.' }
    if (lectura.error) {
      console.error('[juego] entrada para el QR:', lectura.error.message)
      return { ok: false, error: 'No pudimos leer la fila.' }
    }
    const entrada = lectura.data as unknown as FilaEntradaParaEnlace | null
    if (!entrada) return { ok: false, error: 'No encontramos ese lugar en la fila.' }
    if (entrada.organization_id !== orgId) return { ok: false, error: 'El juego no está disponible en esta sucursal.' }
    if ((entrada.status !== 'waiting' && entrada.status !== 'in_progress') || entrada.is_break === true) {
      return { ok: false, error: 'Ese lugar ya no está en la fila.' }
    }
    const zona = entrada.branch?.timezone || ZONA_POR_DEFECTO
    if (diaEnZona(new Date(entrada.checked_in_at), zona) !== diaEnZona(new Date(), zona)) {
      return { ok: false, error: 'Ese lugar en la fila no es de hoy.' }
    }

    const token = firmarTokenJuego({ queueEntryId, branchId: entrada.branch_id })
    if (!token) return { ok: false, error: 'No pudimos armar el enlace del juego.' }
    return { ok: true, url: `${await buildAppUrl()}/juego?t=${token}` }
  } catch (e) {
    console.error('[juego] crearEnlaceJuego:', mensaje(e))
    return { ok: false, error: 'No pudimos armar el enlace del juego.' }
  }
}
