/**
 * Hash del estado de una partida para detectar desincronización entre los dos celulares.
 *
 * El motor es determinista (azar con semilla, sólo + − × ÷ y floor/round/min/max/abs/imul, que
 * dan lo mismo en V8 y en JavaScriptCore): con la misma config y las mismas entradas, las dos
 * partidas tienen que ser IDÉNTICAS bit a bit. Por eso se hashean los bits exactos de cada
 * número (no un redondeo, que escondería una diferencia chica hasta que crezca).
 *
 * FNV-1a de 32 bits. Sin React ni `@/`.
 */
import type { Partida } from '../tipos'
import { internoSiExiste } from '../motor/interno'

const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer)
const PRIMO = 0x01000193
const BASE = 0x811c9dc5

function mezclarEntero(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), PRIMO)
  h = Math.imul(h ^ ((v >>> 8) & 0xff), PRIMO)
  h = Math.imul(h ^ ((v >>> 16) & 0xff), PRIMO)
  return Math.imul(h ^ ((v >>> 24) & 0xff), PRIMO)
}

function mezclarNumero(h: number, v: number): number {
  if (v !== v) return mezclarEntero(mezclarEntero(h, 0x7ff80000), 0) // NaN: un único patrón
  F64[0] = v
  return mezclarEntero(mezclarEntero(h, U32[0]), U32[1])
}

function mezclarTexto(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), PRIMO)
  return Math.imul(h ^ 0xff, PRIMO)
}

/** Hash de 32 bits sin signo del estado que importa: vidas, posiciones, carga, tick, azar… */
export function hashPartida(p: Partida): number {
  let h = BASE
  h = mezclarEntero(h, p.tick)
  h = mezclarTexto(h, p.fase)
  h = mezclarEntero(h, p.ticksFase)
  h = mezclarEntero(h, p.round)
  h = mezclarNumero(h, p.tiempoRestante)
  h = mezclarEntero(h, p.rondasGanadas[0])
  h = mezclarEntero(h, p.rondasGanadas[1])
  h = mezclarNumero(h, p.congelamientoGolpe)
  h = mezclarNumero(h, p.escalaTiempo)
  for (const l of p.luchadores) {
    h = mezclarNumero(h, l.x)
    h = mezclarNumero(h, l.y)
    h = mezclarNumero(h, l.vx)
    h = mezclarNumero(h, l.vy)
    h = mezclarNumero(h, l.vida)
    h = mezclarNumero(h, l.guardia)
    h = mezclarNumero(h, l.carga)
    h = mezclarEntero(h, l.mira)
    h = mezclarTexto(h, l.estado)
    h = mezclarTexto(h, l.anim)
    h = mezclarEntero(h, l.cuadro)
    h = mezclarEntero(h, l.combo)
    h = mezclarNumero(h, l.efectos.congelado)
    h = mezclarNumero(h, l.efectos.electrocutado)
    h = mezclarNumero(h, l.efectos.guardiaRota)
  }
  h = mezclarEntero(h, p.proyectiles.length)
  for (const pr of p.proyectiles) {
    h = mezclarTexto(h, pr.tipo)
    h = mezclarNumero(h, pr.x)
    h = mezclarNumero(h, pr.y)
    h = mezclarEntero(h, pr.golpesRestantes)
  }
  // El estado del azar del combate (críticos, desempates): si difiere, la partida ya se fue.
  const interno = internoSiExiste(p)
  h = mezclarEntero(h, interno ? interno.azar.s >>> 0 : 0)
  return h >>> 0
}
