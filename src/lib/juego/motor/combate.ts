/**
 * Combate: qué pasa cuando una caja de golpe toca una caja de daño. Bloqueo y daño a la guardia,
 * guardia rota, críticos, super armadura, efectos de los especiales (electrocutar, congelar,
 * derribar), combos, carga de la máquina, estadísticas y eventos.
 */
import type { EfectoEspecial, FuerzaGolpe, Herramienta, Lado, Partida } from '../tipos'
import { CARGA_MAX } from '../tipos'
import { PERSONAJES } from '../personajes'
import { chance } from './azar'
import {
  CARGA,
  CHIP,
  CRITICO,
  DESTELLO,
  DESTELLO_CRITICO,
  EFECTO,
  ESCALADO_COMBO,
  FACTOR_BLOCKSTUN,
  GUARDIA,
  HITSTOP,
  HITSTOP_CRITICO,
  HITSTUN,
} from './constantes'
import {
  altoParado,
  bloquea,
  cajaCuerpo,
  cajaGolpe,
  contraPared,
  enCombo,
  golpeable,
  interrumpir,
  interseccion,
} from './cuerpo'
import type { Accion, EstadoInterno, ProyectilInterno } from './interno'
import { emitir } from './interno'
import type { DefEspecial } from './movimientos'

export interface Impacto {
  atacante: Lado
  victima: Lado
  danio: number
  danioGuardia: number
  fuerza: FuerzaGolpe
  herramienta: Herramienta
  hitstun: number
  hitstop: number
  empuje: number
  empujeBloqueo: number
  /** Desde dónde viene (para saber si la víctima lo ve de frente). */
  origenX: number
  /** Para dónde sale despedida la víctima. */
  dir: 1 | -1
  /** Punto de contacto (mundo). */
  x: number
  y: number
  probCritico: number
  especial: 0 | 1 | 2
  efecto: EfectoEspecial | null
  accion: Accion | null
  /** Índice de la ventana (en los golpes cuerpo a cuerpo) o -1. */
  ventana: number
  proyectil: ProyectilInterno | null
  /** Si la víctima está contra la pared, el que pega sale para atrás. */
  rebotePared: boolean
}

/** Suma carga y avisa cada vez que se completa una unidad entera. */
export function sumarCarga(p: Partida, lado: Lado, cantidad: number): void {
  const l = p.luchadores[lado]
  const antes = l.carga
  l.carga = Math.min(CARGA_MAX, Math.max(0, antes + cantidad))
  const nivelAntes = Math.floor(antes + 1e-9)
  const nivelAhora = Math.floor(l.carga + 1e-9)
  for (let n = nivelAntes + 1; n <= nivelAhora; n++) emitir(p, { tipo: 'carga', quien: lado, nivel: n })
}

function hacerDanio(p: Partida, I: EstadoInterno, atacante: Lado, victima: Lado, danio: number): void {
  const v = p.luchadores[victima]
  const real = Math.min(v.vida, danio)
  v.vida = Math.max(0, v.vida - danio)
  p.estadisticas[atacante].danioHecho += real
  p.estadisticas[victima].danioRecibido += real
  I.luchadores[victima].danioRecibidoRound += real
  I.luchadores[atacante].danioHechoRound += real
}

function romperGuardia(p: Partida, I: EstadoInterno, victima: Lado, atacante: Lado): void {
  const v = p.luchadores[victima]
  const vi = I.luchadores[victima]
  interrumpir(v, vi)
  v.guardia = 0
  v.efectos.guardiaRota = GUARDIA.rotaTicks
  vi.stun = 0
  vi.stunBloqueo = false
  p.estadisticas[atacante].guardiasRotas++
  emitir(p, { tipo: 'guardia_rota', quien: victima, x: v.x, y: v.y + altoParado(v) * 0.6 })
}

/** Deja duro al luchador (Fijación Extrema). Pegarle lo rompe con ×1,3. */
export function congelar(p: Partida, I: EstadoInterno, victima: Lado, atacante: Lado, ticks: number): void {
  const v = p.luchadores[victima]
  const vi = I.luchadores[victima]
  interrumpir(v, vi)
  vi.stun = 0
  vi.stunBloqueo = false
  vi.vEmpuje *= 0.3
  v.efectos.congelado = Math.max(v.efectos.congelado, ticks)
  p.estadisticas[atacante].congelamientos++
  emitir(p, { tipo: 'congelado', quien: victima })
}

/** La embestida (Corte Relámpago) frena al chocar y se queda para recuperarse. */
function frenarEmbestida(I: EstadoInterno, lado: Lado, a: Accion, bloqueado: boolean): void {
  const esp = a.mov as DefEspecial
  if (!esp.embestida || a.detenido) return
  a.detenido = true
  a.total = a.t + 1 + (bloqueado ? esp.embestida.recuperacionBloqueo : esp.embestida.recuperacionGolpe)
  const v0 = a.ventanasAnim[0]
  if (v0) v0.ticks = Math.max(1, a.t - v0.desde + 1)
  const li = I.luchadores[lado]
  li.vMov = 0
  li.invulnProyectil = false
}

function multiplicadorCombo(golpe: number): number {
  if (golpe < ESCALADO_COMBO.desde) return 1
  let m = 1
  for (let i = ESCALADO_COMBO.desde; i <= golpe; i++) m *= ESCALADO_COMBO.factor
  return Math.max(ESCALADO_COMBO.minimo, m)
}

function tieneArmadura(accion: Accion | null, fuerza: FuerzaGolpe): boolean {
  const ar = accion?.mov.armadura
  return !!ar && !!accion && accion.t < ar.hasta && ar.contra.includes(fuerza)
}

/** Aplica un contacto. Devuelve cómo salió. */
export function aplicarImpacto(p: Partida, I: EstadoInterno, imp: Impacto): 'golpe' | 'bloqueo' | 'armadura' {
  const atk = p.luchadores[imp.atacante]
  const vic = p.luchadores[imp.victima]
  const ai = I.luchadores[imp.atacante]
  const vi = I.luchadores[imp.victima]
  const kitA = I.kits[imp.atacante]
  const kitV = I.kits[imp.victima]
  const stA = p.estadisticas[imp.atacante]
  const stV = p.estadisticas[imp.victima]
  const a = imp.accion

  if (a) {
    a.contacto = true
    // La cadena se abre desde el contacto de la última ventana (las anteriores tienen que salir).
    if (imp.ventana === a.mov.ventanas.length - 1) a.cancelDesde = Math.min(a.cancelDesde, a.t + 1)
  }

  // ─── Bloqueado ───
  if (bloquea(vic, vi, imp.origenX)) {
    let chip = Math.round(imp.danio * (imp.especial ? CHIP.especial : CHIP.normal) * (1 - kitV.reduccionDanio))
    if (imp.danio > 0) chip = Math.max(1, chip)
    hacerDanio(p, I, imp.atacante, imp.victima, chip)
    stV.golpesBloqueados++
    vi.sinBloquear = 0
    const rompe = imp.efecto === 'rompe_guardia'
    vic.guardia = rompe ? 0 : Math.max(0, vic.guardia - imp.danioGuardia)
    emitir(p, {
      tipo: 'golpe',
      atacante: imp.atacante,
      victima: imp.victima,
      x: imp.x,
      y: imp.y,
      danio: chip,
      critico: false,
      bloqueado: true,
      fuerza: imp.fuerza,
      herramienta: imp.herramienta,
    })
    if (vic.guardia <= 0) {
      romperGuardia(p, I, imp.victima, imp.atacante)
      vi.vEmpuje = imp.dir * imp.empujeBloqueo
    } else {
      const bs = Math.max(1, Math.round(imp.hitstun * FACTOR_BLOCKSTUN))
      vi.stun = Math.max(vi.stun, bs)
      vi.stunTotal = vi.stun
      vi.stunBloqueo = true
      vi.selloStun++
      vi.vEmpuje = imp.dir * imp.empujeBloqueo
      if (imp.rebotePared && contraPared(vic, imp.dir)) ai.vEmpuje = -imp.dir * imp.empujeBloqueo * 0.8
    }
    if (imp.efecto === 'congela') congelar(p, I, imp.victima, imp.atacante, EFECTO.congeladoBloqueo)
    if (a) frenarEmbestida(I, imp.atacante, a, true)
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, imp.hitstop)
    return 'bloqueo'
  }

  // ─── Super armadura (Chipi con la herramienta contra golpes leves) ───
  if (tieneArmadura(vi.accion, imp.fuerza) && imp.efecto === null) {
    const danio = Math.max(1, Math.round(imp.danio * (1 - kitV.reduccionDanio)))
    hacerDanio(p, I, imp.atacante, imp.victima, danio)
    stA.golpesAcertados++
    vic.destello = DESTELLO
    sumarCarga(p, imp.atacante, CARGA.porGolpe)
    sumarCarga(p, imp.victima, CARGA.porRecibir)
    if (a) a.acerto = true
    emitir(p, {
      tipo: 'golpe',
      atacante: imp.atacante,
      victima: imp.victima,
      x: imp.x,
      y: imp.y,
      danio,
      critico: false,
      bloqueado: false,
      fuerza: imp.fuerza,
      herramienta: imp.herramienta,
    })
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.leve)
    return 'armadura'
  }

  // ─── Golpe limpio ───
  let mult = 1
  const critico = imp.probCritico > 0 && chance(I.azar, imp.probCritico)
  if (critico) mult *= CRITICO.mult
  const estabaEnCombo = enCombo(vic, vi)
  if (vic.efectos.congelado > 0) {
    mult *= EFECTO.rompeCongelado
    vic.efectos.congelado = 0
    emitir(p, { tipo: 'descongelado', quien: imp.victima, roto: true })
  }
  if (vic.efectos.guardiaRota > 0) mult *= GUARDIA.rotaMult
  atk.combo = estabaEnCombo ? atk.combo + 1 : 1
  mult *= multiplicadorCombo(atk.combo)
  mult *= 1 - kitV.reduccionDanio
  const danio = Math.max(1, Math.round(imp.danio * mult))
  hacerDanio(p, I, imp.atacante, imp.victima, danio)

  stA.golpesAcertados++
  if (critico) stA.criticos++
  if (atk.combo > stA.comboMax) stA.comboMax = atk.combo
  sumarCarga(p, imp.atacante, CARGA.porGolpe + (critico ? kitA.cargaPorCritico : 0))
  sumarCarga(p, imp.victima, CARGA.porRecibir)
  if (critico) atk.efectos.critico = CRITICO.aura
  vic.destello = critico ? DESTELLO_CRITICO : DESTELLO

  // Reacción de la víctima.
  interrumpir(vic, vi)
  vi.selloStun++
  vi.stunBloqueo = false
  const derriba = imp.efecto === 'rompe_guardia'
  if (!vic.enSuelo) {
    // En el aire: cae y queda tirado.
    vi.stun = 0
    vi.caidaDerribo = Math.max(vi.caidaDerribo, derriba ? EFECTO.derribo : EFECTO.derriboAereo)
    vic.vy = Math.max(vic.vy, 6)
    vi.vEmpuje = imp.dir * Math.max(3.2, imp.empuje)
    if (derriba) emitir(p, { tipo: 'derribo', quien: imp.victima })
  } else if (derriba) {
    vi.stun = 0
    vic.enSuelo = false
    vic.y = 0.5
    vic.vy = 7
    vi.vEmpuje = imp.dir * imp.empuje
    vi.caidaDerribo = EFECTO.derribo
    emitir(p, { tipo: 'derribo', quien: imp.victima })
  } else {
    vi.stun = Math.max(1, imp.hitstun)
    vi.stunTotal = vi.stun
    vi.vEmpuje = imp.dir * imp.empuje
    if (imp.rebotePared && contraPared(vic, imp.dir)) ai.vEmpuje = -imp.dir * imp.empuje * 0.7
  }

  emitir(p, {
    tipo: 'golpe',
    atacante: imp.atacante,
    victima: imp.victima,
    x: imp.x,
    y: imp.y,
    danio,
    critico,
    bloqueado: false,
    fuerza: imp.fuerza,
    herramienta: imp.herramienta,
  })
  if (imp.efecto === 'electrocuta' && vic.vida > 0) {
    vic.efectos.electrocutado = EFECTO.electrocutado
    emitir(p, { tipo: 'electrocutado', quien: imp.victima })
  }
  if (imp.efecto === 'congela' && vic.vida > 0) congelar(p, I, imp.victima, imp.atacante, EFECTO.congelado)
  if (atk.combo >= 2) emitir(p, { tipo: 'combo', quien: imp.atacante, golpes: atk.combo })

  p.congelamientoGolpe = Math.max(p.congelamientoGolpe, imp.hitstop + (critico ? HITSTOP_CRITICO : 0))

  if (a) {
    a.acerto = true
    if (a.especial && !a.contoAcierto) {
      a.contoAcierto = true
      stA.especialesAcertados++
    }
    frenarEmbestida(I, imp.atacante, a, false)
  }
  if (imp.proyectil && !imp.proyectil.acerto) {
    imp.proyectil.acerto = true
    stA.especialesAcertados++
  }
  return 'golpe'
}

/** Busca los contactos cuerpo a cuerpo de este tick (los dos lados, antes de aplicar: hay cambios de golpes). */
export function contactosCuerpoACuerpo(p: Partida, I: EstadoInterno): Impacto[] {
  const lista: Impacto[] = []
  for (const lado of [0, 1] as const) {
    const l = p.luchadores[lado]
    const li = I.luchadores[lado]
    const a = li.accion
    if (!a || a.remate || a.detenido) continue
    const otro = (1 - lado) as Lado
    const v = p.luchadores[otro]
    const vi = I.luchadores[otro]
    if (!golpeable(v, vi, false)) continue
    const cuerpo = cajaCuerpo(v, vi)
    if (!cuerpo) continue
    const kit = I.kits[lado]
    for (let i = 0; i < a.mov.ventanas.length; i++) {
      if (a.resueltas[i]) continue
      const w = a.mov.ventanas[i]
      if (a.t < w.desde || a.t >= w.desde + w.ticks) continue
      const inter = interseccion(cajaGolpe(l, w.caja), cuerpo)
      if (!inter) continue
      a.resueltas[i] = true
      const efecto = a.especial ? efectoDe(p, lado, a.especial) : null
      lista.push({
        atacante: lado,
        victima: otro,
        danio: w.danio,
        danioGuardia: w.danioGuardia,
        fuerza: w.fuerza,
        herramienta: a.mov.herramienta,
        hitstun: w.hitstun ?? HITSTUN[w.fuerza],
        hitstop: w.hitstop ?? HITSTOP[w.fuerza],
        empuje: w.empuje,
        empujeBloqueo: w.empujeBloqueo,
        origenX: l.x,
        dir: v.x >= l.x ? 1 : -1,
        x: (inter.x0 + inter.x1) / 2,
        y: (inter.y0 + inter.y1) / 2,
        probCritico: a.especial === 0 && a.mov.critico !== undefined ? kit.criticoBase + a.mov.critico : 0,
        especial: a.especial,
        efecto,
        accion: a,
        ventana: i,
        proyectil: null,
        rebotePared: a.especial === 0,
      })
      break
    }
  }
  return lista
}

/** El efecto de cada especial sale de la ficha del personaje (personajes.ts). */
export function efectoDe(p: Partida, lado: Lado, numero: 1 | 2): EfectoEspecial {
  return PERSONAJES[p.luchadores[lado].id].especiales[numero - 1].efecto
}
