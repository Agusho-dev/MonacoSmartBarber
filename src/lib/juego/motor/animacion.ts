/**
 * El motor decide la animación de cada luchador (anim + cuadro + animTick) con la meta del atlas
 * (cuántos cuadros tiene cada animación y cuáles son los de contacto). Robusto a cualquier
 * cantidad de cuadros ≥ 1: los atlas se pueden volver a recortar sin tocar el motor.
 *
 * Ataques: el cuadro de impacto i se ve durante la ventana activa i; antes se reparten los
 * cuadros previos en el arranque y después los siguientes en la recuperación.
 */
import type { AtlasPersonaje, ClaveAnimacion, Lado, LuchadorEstado, MetaAnimaciones, Partida } from '../tipos'
import { CLAVES_ANIMACION, TPS } from '../tipos'
import { EFECTO, FASE, VEL_SALTO } from './constantes'
import { limitar } from './cuerpo'
import type { Accion, EstadoInterno, InternoLuchador, VentanaAnim } from './interno'

/** Cuadros por segundo de las animaciones que no dependen de un movimiento. */
const CPS = {
  quieto: 8,
  caminar: 10,
  correr: 12,
  pose: 20,
  victoria: 9,
  mareado: 5,
  guardiaRota: 6,
  agarrado: 14,
} as const

/** Ticks en los que se reparten los cuadros de caer (tiempo típico desde la cima hasta el piso). */
const TICKS_CAIDA = 19
/** Fracción de los cuadros de `caer` que son la caída (el resto, el aterrizaje). */
const FRACCION_CAIDA = 0.6
/** Ticks para mostrar el desplome de `ko`. */
const TICKS_KO = 24
/** Después de la ventana de un aéreo: ticks en los que se reparten los cuadros que quedan. */
const TICKS_POST_AEREO = 10

function normalizarImpactos(impactos: unknown, n: number): number[] {
  if (!Array.isArray(impactos)) return []
  const out: number[] = []
  for (const v of impactos) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const i = Math.floor(v)
    if (i >= 0 && i < n && !out.includes(i)) out.push(i)
  }
  return out.sort((a, b) => a - b)
}

/** Completa y acota una meta: toda animación tiene n ≥ 1 e impactos válidos. */
export function normalizarMeta(m: Partial<MetaAnimaciones> | null | undefined): MetaAnimaciones {
  const out = {} as MetaAnimaciones
  for (const clave of CLAVES_ANIMACION) {
    const e = m?.[clave]
    const n = Math.max(1, Math.floor(Number(e?.n) || 1))
    out[clave] = { n, impactos: normalizarImpactos(e?.impactos, n) }
  }
  return out
}

/** Meta a partir del atlas (lo que el motor necesita saber de los dibujos). */
export function metaDesdeAtlas(atlas: AtlasPersonaje): MetaAnimaciones {
  const out = {} as MetaAnimaciones
  for (const clave of CLAVES_ANIMACION) {
    const anim = atlas?.animaciones?.[clave]
    const n = Math.max(1, Array.isArray(anim?.cuadros) ? anim.cuadros.length : 0)
    out[clave] = { n, impactos: normalizarImpactos(anim?.impactos, n) }
  }
  return out
}

/**
 * Qué cuadro de la animación corresponde a cada una de las `k` ventanas activas. Si el atlas
 * no dice nada: la mitad para un golpe, repartidos para varios.
 */
export function cuadrosDeImpacto(n: number, impactos: readonly number[], k: number): number[] {
  if (k <= 0) return []
  const ult = n - 1
  const out: number[] = []
  if (impactos.length === 0) {
    if (k === 1) out.push(Math.floor(n / 2))
    else for (let i = 0; i < k; i++) out.push(Math.floor(((i + 1) * n) / (k + 1)))
  } else if (impactos.length >= k) {
    if (k === 1) out.push(impactos[0])
    else for (let i = 0; i < k; i++) out.push(impactos[Math.round((i * (impactos.length - 1)) / (k - 1))])
  } else {
    for (const i of impactos) out.push(i)
    const base = impactos[impactos.length - 1]
    const faltan = k - impactos.length
    for (let j = 1; j <= faltan; j++) out.push(Math.round(base + (j * (ult - base)) / faltan))
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = limitar(out[i], 0, ult)
    if (i > 0 && out[i] < out[i - 1]) out[i] = out[i - 1]
  }
  return out
}

/** Cuadro de un ataque en el tick t (arranque → impactos → recuperación). */
export function cuadroDeAtaque(
  t: number,
  total: number,
  ventanas: readonly VentanaAnim[],
  impactos: readonly number[],
  n: number,
): number {
  const ult = n - 1
  const k = Math.min(ventanas.length, impactos.length)
  if (k === 0) return limitar(Math.floor((t * n) / Math.max(1, total)), 0, ult)
  const v0 = ventanas[0]
  if (t < v0.desde) {
    const m = impactos[0]
    if (m <= 0) return 0
    return limitar(Math.floor((t * m) / Math.max(1, v0.desde)), 0, m - 1)
  }
  for (let i = 0; i < k; i++) {
    const v = ventanas[i]
    if (t < v.desde + v.ticks) {
      if (t >= v.desde) return impactos[i]
      // Entre la ventana i-1 y la i: los cuadros que hay entre sus impactos.
      const finPrev = ventanas[i - 1].desde + ventanas[i - 1].ticks
      const m = impactos[i] - impactos[i - 1] - 1
      if (m <= 0) return impactos[i - 1]
      return impactos[i - 1] + 1 + Math.min(m - 1, Math.floor(((t - finPrev) * m) / Math.max(1, v.desde - finPrev)))
    }
  }
  const vk = ventanas[k - 1]
  const fin = vk.desde + vk.ticks
  const fk = impactos[k - 1]
  const m = ult - fk
  if (m <= 0) return fk
  return limitar(fk + 1 + Math.floor(((t - fin) * m) / Math.max(1, total - fin)), fk, ult)
}

function bucle(tick: number, cps: number, n: number): number {
  return Math.floor((tick * cps) / TPS) % n
}

function unaVez(tick: number, cps: number, n: number): number {
  return Math.min(n - 1, Math.floor((tick * cps) / TPS))
}

function repartido(t: number, duracion: number, n: number): number {
  return limitar(Math.floor((t * n) / Math.max(1, duracion)), 0, n - 1)
}

function vaiven(tick: number, cps: number, n: number): number {
  if (n <= 1) return 0
  const ciclo = 2 * n - 2
  const i = Math.floor((tick * cps) / TPS) % ciclo
  return i < n ? i : ciclo - i
}

/** Qué animación toca y su «sello» (si el sello cambia, la animación arranca de nuevo). */
function elegir(l: LuchadorEstado, li: InternoLuchador): { clave: ClaveAnimacion; sello: number } {
  const ef = l.efectos
  if (li.pose === 'ko') return { clave: 'ko', sello: 1 }
  if (li.pose === 'victoria') return { clave: 'victoria', sello: 2 }
  if (li.pose === 'burla') return { clave: 'burla', sello: 3 }
  if (li.pose === 'mareado') return { clave: 'danio', sello: 4 }
  if (li.agarradoPor !== null) return { clave: 'danio', sello: 17 }
  if (ef.congelado > 0) return { clave: 'danio', sello: 5 }
  if (li.caidaDerribo > 0 || li.derribo > 0) return { clave: 'ko', sello: 100 + li.selloStun }
  if (li.levantar > 0) return { clave: 'levantarse', sello: 6 }
  if (ef.electrocutado > 0) return { clave: 'danio', sello: 7 }
  if (ef.aturdido > 0 && li.stun === 0) return { clave: 'danio', sello: 18 }
  if (ef.guardiaRota > 0 && li.stun === 0) return { clave: 'danio', sello: 8 }
  if (li.stun > 0) {
    if (li.stunBloqueo) return { clave: li.agachado ? 'agachado' : 'guardia', sello: 9 }
    return { clave: 'danio', sello: 1000 + li.selloStun }
  }
  if (li.dash) return { clave: li.dash.adelante ? 'dash' : 'guardia', sello: 2000 + li.selloDash }
  if (li.accion) return { clave: li.accion.mov.anim, sello: 10000 + li.accion.sello }
  if (!l.enSuelo) return { clave: l.vy > 0 ? 'saltar' : 'caer', sello: 10 }
  if (li.aterrizaje > 0) return { clave: 'caer', sello: 11 }
  if (li.guardia) return { clave: li.agachado ? 'agachado' : 'guardia', sello: 12 }
  if (li.agachado) return { clave: 'agachado', sello: 13 }
  if (li.vMov !== 0) return { clave: li.corriendo ? 'correr' : 'caminar', sello: li.corriendo ? 14 : 15 }
  return { clave: 'quieto', sello: 16 }
}

function cuadroDeAccion(a: Accion, n: number, impactosAtlas: readonly number[]): number {
  if (!a.cuadrosImpacto) a.cuadrosImpacto = cuadrosDeImpacto(n, impactosAtlas, a.ventanasAnim.length)
  let total = a.total
  if (a.mov.aereo) {
    const ult = a.ventanasAnim[a.ventanasAnim.length - 1]
    total = ult ? ult.desde + ult.ticks + TICKS_POST_AEREO : a.total
  }
  return cuadroDeAtaque(Math.min(a.t, total), total, a.ventanasAnim, a.cuadrosImpacto, n)
}

function cuadroPara(l: LuchadorEstado, li: InternoLuchador, clave: ClaveAnimacion, n: number, impactos: readonly number[]): number {
  const ef = l.efectos
  const t = l.animTick
  if (li.accion && clave === li.accion.mov.anim && li.pose === null && li.stun === 0 && !li.dash) {
    return cuadroDeAccion(li.accion, n, impactos)
  }
  switch (clave) {
    case 'quieto':
      return bucle(t, CPS.quieto, n)
    case 'caminar': {
      const i = bucle(t, CPS.caminar, n)
      return li.atras ? n - 1 - i : i
    }
    case 'correr':
      return bucle(t, CPS.correr, n)
    case 'dash':
      return li.dash ? repartido(li.dash.t, li.dash.total, n) : n - 1
    case 'guardia':
    case 'agachado':
      if (li.dash) return repartido(li.dash.t, li.dash.total, n)
      if (li.stun > 0 && li.stunBloqueo) return n - 1
      return unaVez(t, CPS.pose, n)
    case 'saltar':
      return limitar(Math.floor((1 - l.vy / VEL_SALTO) * n), 0, n - 1)
    case 'caer': {
      const nCaida = n <= 2 ? n : Math.ceil(n * FRACCION_CAIDA)
      if (!l.enSuelo) return limitar(Math.floor((li.tAire * nCaida) / TICKS_CAIDA), 0, nCaida - 1)
      if (nCaida >= n) return n - 1
      const hecho = li.aterrizajeTotal - li.aterrizaje
      return limitar(nCaida + Math.floor((hecho * (n - nCaida)) / Math.max(1, li.aterrizajeTotal)), nCaida, n - 1)
    }
    case 'danio':
      if (li.pose === 'mareado') return vaiven(t, CPS.mareado, n)
      if (li.agarradoPor !== null) return vaiven(t, CPS.agarrado, n)
      if (ef.congelado > 0) return Math.min(1, n - 1)
      if (ef.electrocutado > 0) return Math.min(n - 1, Math.floor(t / 3) % 2)
      if (ef.aturdido > 0 && li.stun === 0) return vaiven(t, CPS.mareado, n)
      if (ef.guardiaRota > 0 && li.stun === 0) return vaiven(t, CPS.guardiaRota, n)
      return repartido(li.stunTotal - li.stun, li.stunTotal, n)
    case 'ko':
      return repartido(t, TICKS_KO, n)
    case 'levantarse':
      return repartido(EFECTO.levantarse - li.levantar, EFECTO.levantarse, n)
    case 'victoria':
      return unaVez(t, CPS.victoria, n)
    case 'burla':
      return repartido(li.poseT, FASE.burla, n)
    default:
      return unaVez(t, CPS.pose, n)
  }
}

/** Actualiza anim, cuadro y animTick. `avanza` = false durante el hitstop (el dibujo se queda quieto). */
export function animar(p: Partida, I: EstadoInterno, lado: Lado, avanza: boolean): void {
  const l = p.luchadores[lado]
  const li = I.luchadores[lado]
  const { clave, sello } = elegir(l, li)
  if (clave !== l.anim || sello !== li.animSello) {
    l.anim = clave
    li.animSello = sello
    li.animClave = clave
    l.animTick = 0
  } else if (avanza) l.animTick++
  const meta = I.meta[lado][clave]
  const n = Math.max(1, meta?.n ?? 1)
  const c = cuadroPara(l, li, clave, n, meta?.impactos ?? [])
  l.cuadro = Number.isFinite(c) ? limitar(Math.floor(c), 0, n - 1) : 0
}
