/**
 * Combate: qué pasa cuando una caja de golpe toca una caja de daño. Bloqueo y daño a la guardia,
 * guardia rota, críticos, super armadura, efectos de los especiales (electrocutar, congelar,
 * derribar, aturdir, marear, quemar, agarrar), combos, carga de la máquina, pasivas,
 * estadísticas y eventos.
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
  ESCALADO_STUN,
  FACTOR_BLOCKSTUN,
  GUARDIA,
  HITSTOP,
  HITSTOP_CRITICO,
  HITSTUN,
  INMUNIDAD,
  X_MAX,
  X_MIN,
} from './constantes'
import {
  altoParado,
  bloquea,
  cajaCuerpo,
  cajaGolpe,
  contraPared,
  enCombo,
  finVentanas,
  golpeable,
  interrumpir,
  interseccion,
  limitar,
} from './cuerpo'
import type { Accion, EstadoControl, EstadoInterno, ProyectilInterno } from './interno'
import { emitir } from './interno'
import type { DefAgarre, DefEspecial, KitPersonaje } from './movimientos'

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
  /** Ticks del estado que deja el efecto (0 = el de EFECTO). */
  ticksEfecto: number
  /** Quemadura (con efecto 'quema'). */
  quema: { cada: number; danio: number } | null
  /** No se puede bloquear (el sismo, el agarre). */
  imbloqueable: boolean
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

/** Resta vida (sin pasar de 0) y anota estadísticas. Devuelve lo que entró de verdad. */
export function hacerDanio(p: Partida, I: EstadoInterno, atacante: Lado, victima: Lado, danio: number): number {
  const v = p.luchadores[victima]
  const real = Math.min(v.vida, danio)
  v.vida = Math.max(0, v.vida - danio)
  p.estadisticas[atacante].danioHecho += real
  p.estadisticas[victima].danioRecibido += real
  I.luchadores[victima].danioRecibidoRound += real
  I.luchadores[atacante].danioHechoRound += real
  return real
}

/** Un especial cuenta como acertado UNA vez (aunque tire varios proyectiles o pegue varias veces). */
export function contarAcierto(p: Partida, I: EstadoInterno, lado: Lado, sello: number): void {
  if (sello !== 0 && I.ultimoAcierto[lado] === sello) return
  I.ultimoAcierto[lado] = sello
  p.estadisticas[lado].especialesAcertados++
  const c = I.kits[lado].pasiva?.cargaPorEspecial
  if (c) sumarCarga(p, lado, c)
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

/** Duración real de un estado para esa víctima (Noches sin dormir: la mitad). */
function duracion(kit: KitPersonaje, ticks: number): number {
  return Math.max(1, Math.round(ticks * (kit.pasiva?.multEstados ?? 1)))
}

/**
 * Pone un estado de control respetando la inmunidad (no se encadena) y la resistencia de la
 * víctima. Devuelve si entró.
 */
export function ponerEstado(
  p: Partida,
  I: EstadoInterno,
  victima: Lado,
  estado: EstadoControl | 'lento',
  ticks: number,
): boolean {
  const v = p.luchadores[victima]
  const vi = I.luchadores[victima]
  if (v.vida <= 0) return false
  // Un estado de control no se renueva mientras dura ni enseguida después (inmunidad): un segundo
  // bombo, trago o termo encima del primero pega, pero no alarga el aturdido, el mareo ni la
  // quemadura. Sin esto, con carga, se encadenaba sin fin. LENTO (la nube) sí se renueva.
  if (estado !== 'lento' && (vi.inmune[estado] > 0 || v.efectos[estado] > 0)) return false
  const t = duracion(I.kits[victima], ticks)
  v.efectos[estado] = Math.max(v.efectos[estado], t)
  return true
}

/** Deja duro al luchador (Fijación Extrema). Pegarle lo rompe con ×1,3. */
export function congelar(p: Partida, I: EstadoInterno, victima: Lado, atacante: Lado, ticks: number): void {
  const v = p.luchadores[victima]
  const vi = I.luchadores[victima]
  if (vi.inmune.congelado > 0) return
  interrumpir(v, vi)
  vi.stun = 0
  vi.stunBloqueo = false
  vi.vEmpuje *= 0.3
  ponerEstado(p, I, victima, 'congelado', ticks)
  p.estadisticas[atacante].congelamientos++
  emitir(p, { tipo: 'congelado', quien: victima })
}

/** La embestida frena al chocar y se queda para recuperarse (salvo las que siguen de largo). */
function frenarEmbestida(I: EstadoInterno, lado: Lado, a: Accion, bloqueado: boolean): void {
  const esp = a.mov as DefEspecial
  if (!esp.embestida || a.detenido || esp.embestida.sigue) return
  a.detenido = true
  a.total = a.t + 1 + (bloqueado ? esp.embestida.recuperacionBloqueo : esp.embestida.recuperacionGolpe)
  const v0 = a.ventanasAnim[0]
  if (v0) v0.ticks = Math.max(1, a.t - v0.desde + 1)
  const li = I.luchadores[lado]
  li.vMov = 0
  li.invulnProyectil = false
}

/** Cuánto dura el aturdimiento del golpe número `golpe` de un combo (ver ESCALADO_STUN). */
function multiplicadorStun(golpe: number): number {
  if (golpe <= ESCALADO_STUN.desde) return 1
  let m = 1
  for (let i = ESCALADO_STUN.desde; i < golpe; i++) m *= ESCALADO_STUN.factor
  return Math.max(ESCALADO_STUN.minimo, m)
}

function multiplicadorCombo(golpe: number): number {
  if (golpe < ESCALADO_COMBO.desde) return 1
  let m = 1
  for (let i = ESCALADO_COMBO.desde; i <= golpe; i++) m *= ESCALADO_COMBO.factor
  return Math.max(ESCALADO_COMBO.minimo, m)
}

/**
 * Super armadura: la del movimiento (Chipi con la máquina) o la pasiva (Brian: mientras arranca y
 * pega con la herramienta o un especial). Con el puño y la patada no: medido, con armadura también
 * en esos Brian ganaba 3 de 4 en normal.
 */
function tieneArmadura(kit: KitPersonaje, accion: Accion | null, fuerza: FuerzaGolpe): boolean {
  if (!accion || accion.remate) return false
  const ar = accion.mov.armadura
  if (ar && accion.t < ar.hasta && ar.contra.includes(fuerza)) return true
  const pas = kit.pasiva?.armaduraAtaques
  if (!pas || accion.mov.aereo || !pas.includes(fuerza)) return false
  const pesado = accion.especial !== 0 || accion.mov.boton === 'herramienta'
  return pesado && accion.t < finVentanas(accion.mov)
}

/** Furia: con poca vida pega más (La 12 no para). */
function multFuria(p: Partida, I: EstadoInterno, lado: Lado): number {
  const f = I.kits[lado].pasiva?.furia
  const l = p.luchadores[lado]
  return f && l.vida < l.vidaMax * f.umbral ? f.mult : 1
}

/** El agarre: lo levanta y lo deja 'agarrado' (lo aprieta y lo tira progresarAgarre). */
function agarrar(p: Partida, I: EstadoInterno, imp: Impacto, a: Accion, def: DefAgarre): void {
  const atk = p.luchadores[imp.atacante]
  const vic = p.luchadores[imp.victima]
  const vi = I.luchadores[imp.victima]
  interrumpir(vic, vi)
  vi.stun = 0
  vi.stunBloqueo = false
  vi.caidaDerribo = 0
  vi.vEmpuje = 0
  vi.agarradoPor = imp.atacante
  vic.enSuelo = false
  vic.vy = 0
  vic.y = def.alto
  vic.x = limitar(atk.x + atk.mira * def.adelante, X_MIN, X_MAX)
  a.agarre = { victima: imp.victima, t: 0 }
  a.acerto = true
  a.total = Math.max(a.total, a.t + 2 + def.sostener + def.recuperacion)
  atk.combo = 1
  p.estadisticas[imp.atacante].golpesAcertados++
  contarAcierto(p, I, imp.atacante, a.sello)
  emitir(p, { tipo: 'agarre', atacante: imp.atacante, victima: imp.victima })
  p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.medio)
}

/**
 * Un tick del agarre (lo llama acciones.ts): lo sostiene delante, lo aprieta cada tanto y al final
 * lo tira al piso. Si la víctima ya no está agarrada por él (KO, fin del round), termina.
 */
export function progresarAgarre(p: Partida, I: EstadoInterno, lado: Lado, a: Accion, def: DefAgarre, enPelea = true): void {
  const g = a.agarre
  if (!g) return
  const atk = p.luchadores[lado]
  const vic = p.luchadores[g.victima]
  const vi = I.luchadores[g.victima]
  if (vi.agarradoPor !== lado) {
    a.agarre = null
    a.total = Math.min(a.total, a.t + def.recuperacion)
    return
  }
  if (!enPelea) {
    // Se acabó el tiempo (o el round) con alguien agarrado: lo suelta sin apretar ni tirar
    // (antes seguía sacándole vida después del «¡TIEMPO!»). Cae parado.
    vi.agarradoPor = null
    vic.vy = Math.min(vic.vy, 0)
    a.agarre = null
    a.total = Math.min(a.total, a.t + def.recuperacion)
    return
  }
  g.t++
  vic.x = limitar(atk.x + atk.mira * def.adelante, X_MIN, X_MAX)
  vic.y = def.alto
  vic.vy = 0
  vic.enSuelo = false
  vi.vMov = 0
  vi.vEmpuje = 0
  if (g.t < def.sostener && g.t % def.apretones.cada === 0) {
    const real = hacerDanio(p, I, lado, g.victima, Math.round(def.apretones.danio * multFuria(p, I, lado) * (1 - I.kits[g.victima].reduccionDanio)))
    vic.destello = DESTELLO
    atk.combo++
    if (atk.combo > p.estadisticas[lado].comboMax) p.estadisticas[lado].comboMax = atk.combo
    p.estadisticas[lado].golpesAcertados++
    emitir(p, {
      tipo: 'golpe',
      atacante: lado,
      victima: g.victima,
      x: vic.x,
      y: vic.y + altoParado(vic) * 0.55,
      danio: real,
      critico: false,
      bloqueado: false,
      fuerza: 'leve',
      herramienta: 'agarre',
    })
    if (atk.combo >= 2) emitir(p, { tipo: 'combo', quien: lado, golpes: atk.combo })
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.leve)
  }
  if (g.t >= def.sostener) {
    const real = hacerDanio(p, I, lado, g.victima, Math.round(def.tiron.danio * multFuria(p, I, lado) * (1 - I.kits[g.victima].reduccionDanio)))
    vi.agarradoPor = null
    vic.vy = 5
    vi.vEmpuje = atk.mira * def.tiron.empuje
    vi.caidaDerribo = EFECTO.derribo
    vi.selloStun++
    atk.combo++
    if (atk.combo > p.estadisticas[lado].comboMax) p.estadisticas[lado].comboMax = atk.combo
    p.estadisticas[lado].golpesAcertados++
    sumarCarga(p, lado, CARGA.porGolpe)
    sumarCarga(p, g.victima, CARGA.porRecibir)
    emitir(p, {
      tipo: 'golpe',
      atacante: lado,
      victima: g.victima,
      x: vic.x,
      y: vic.y + 40,
      danio: real,
      critico: false,
      bloqueado: false,
      fuerza: 'especial',
      herramienta: 'agarre',
    })
    emitir(p, { tipo: 'combo', quien: lado, golpes: atk.combo })
    emitir(p, { tipo: 'derribo', quien: g.victima })
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.especial)
    a.agarre = null
    a.total = a.t + 1 + def.recuperacion
  }
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
  const ef = imp.efecto
  const sello = a ? a.sello : (imp.proyectil?.selloAccion ?? 0)
  const furia = multFuria(p, I, imp.atacante)

  if (a) {
    a.contacto = true
    // La cadena se abre desde el contacto de la última ventana (las anteriores tienen que salir).
    if (imp.ventana === a.mov.ventanas.length - 1) a.cancelDesde = Math.min(a.cancelDesde, a.t + 1)
  }

  // ─── Agarre (imbloqueable; lo levanta) ───
  const esp = a?.mov as DefEspecial | undefined
  if (ef === 'agarre' && a && esp?.agarre) {
    agarrar(p, I, imp, a, esp.agarre)
    return 'golpe'
  }

  // ─── Bloqueado ───
  if (!imp.imbloqueable && bloquea(vic, vi, imp.origenX)) {
    let chip = Math.round(imp.danio * (imp.especial ? CHIP.especial : CHIP.normal) * (1 - kitV.reduccionDanio) * furia)
    if (imp.danio > 0) chip = Math.max(1, chip)
    hacerDanio(p, I, imp.atacante, imp.victima, chip)
    stV.golpesBloqueados++
    vi.sinBloquear = 0
    const rompe = imp.efecto === 'rompe_guardia'
    const dg = imp.danioGuardia * (kitV.pasiva?.multDanioGuardia ?? 1)
    vic.guardia = rompe ? 0 : Math.max(0, vic.guardia - dg)
    const cb = kitV.pasiva?.cargaPorBloqueo
    if (cb) sumarCarga(p, imp.victima, cb)
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

  // ─── Super armadura (Chipi con la herramienta, Brian mientras ataca: contra golpes leves) ───
  if (tieneArmadura(kitV, vi.accion, imp.fuerza) && imp.efecto === null) {
    const danio = Math.max(1, Math.round(imp.danio * (1 - kitV.reduccionDanio) * furia))
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
  let mult = furia
  const critico = imp.probCritico > 0 && (imp.probCritico >= 1 || chance(I.azar, imp.probCritico))
  if (critico) mult *= CRITICO.mult
  const estabaEnCombo = enCombo(vic, vi)
  if (vic.efectos.congelado > 0) {
    mult *= EFECTO.rompeCongelado
    vic.efectos.congelado = 0
    vi.inmune.congelado = INMUNIDAD.congelado
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
  const derriba = ef === 'rompe_guardia' || ef === 'derriba' || ef === 'sismo'
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
    vi.stun = Math.max(1, Math.round(imp.hitstun * multiplicadorStun(atk.combo)))
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
  if (vic.vida > 0) {
    if (ef === 'electrocuta' && ponerEstado(p, I, imp.victima, 'electrocutado', EFECTO.electrocutado)) {
      emitir(p, { tipo: 'electrocutado', quien: imp.victima })
    }
    if (ef === 'congela') congelar(p, I, imp.victima, imp.atacante, EFECTO.congelado)
    if (ef === 'aturde' && ponerEstado(p, I, imp.victima, 'aturdido', imp.ticksEfecto || EFECTO.aturdido)) {
      emitir(p, { tipo: 'aturdido', quien: imp.victima })
    }
    if (ef === 'marea' && ponerEstado(p, I, imp.victima, 'mareado', imp.ticksEfecto || EFECTO.mareado)) {
      emitir(p, { tipo: 'mareado', quien: imp.victima })
    }
    if (ef === 'quema' && imp.quema && ponerEstado(p, I, imp.victima, 'quemado', imp.ticksEfecto || EFECTO.quemado)) {
      vi.quema = { cada: imp.quema.cada, danio: imp.quema.danio, de: imp.atacante, t: 0 }
      emitir(p, { tipo: 'quemado', quien: imp.victima })
    }
  }
  if (atk.combo >= 2) emitir(p, { tipo: 'combo', quien: imp.atacante, golpes: atk.combo })

  p.congelamientoGolpe = Math.max(p.congelamientoGolpe, imp.hitstop + (critico ? HITSTOP_CRITICO : 0))

  if (a) {
    a.acerto = true
    if (a.especial && !a.contoAcierto) {
      a.contoAcierto = true
      contarAcierto(p, I, imp.atacante, sello)
    }
    frenarEmbestida(I, imp.atacante, a, false)
  }
  if (imp.proyectil && !imp.proyectil.acerto) {
    imp.proyectil.acerto = true
    contarAcierto(p, I, imp.atacante, sello)
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
    if (!a || a.remate || a.detenido || a.agarre) continue
    const otro = (1 - lado) as Lado
    const v = p.luchadores[otro]
    const vi = I.luchadores[otro]
    if (!golpeable(v, vi, false)) continue
    const cuerpo = cajaCuerpo(v, vi)
    if (!cuerpo) continue
    const kit = I.kits[lado]
    const efEspecial = a.especial ? efectoDe(p, lado, a.especial) : null
    // El agarre no agarra en el aire (la ventana sigue buscando por si aterriza).
    if (efEspecial === 'agarre' && !v.enSuelo) continue
    for (let i = 0; i < a.mov.ventanas.length; i++) {
      if (a.resueltas[i] || a.esperaVentana[i] > 0) continue
      const w = a.mov.ventanas[i]
      if (a.t < w.desde || a.t >= w.desde + w.ticks) continue
      const inter = interseccion(cajaGolpe(l, w.caja), cuerpo)
      if (!inter) continue
      // Multigolpe: cuenta el contacto y se rearma; el último es el remate.
      const total = w.golpes ?? 1
      a.contactos[i]++
      const ultimo = a.contactos[i] >= total
      if (ultimo) a.resueltas[i] = true
      else a.esperaVentana[i] = w.cada ?? 6
      const rem = ultimo && total > 1 ? w.ultimo : undefined
      const fuerza = rem?.fuerza ?? w.fuerza
      const efVentana = rem && rem.efecto !== undefined ? rem.efecto : w.efecto
      const efecto = a.especial ? (efVentana !== undefined ? efVentana : efectoNormalizado(efEspecial)) : null
      lista.push({
        atacante: lado,
        victima: otro,
        danio: rem ? rem.danio : w.danio,
        danioGuardia: w.danioGuardia,
        fuerza,
        herramienta: a.mov.herramienta,
        hitstun: rem?.hitstun ?? w.hitstun ?? HITSTUN[fuerza],
        hitstop: w.hitstop ?? HITSTOP[fuerza],
        empuje: rem ? rem.empuje : w.empuje,
        empujeBloqueo: w.empujeBloqueo,
        origenX: l.x,
        dir: v.x >= l.x ? 1 : -1,
        x: (inter.x0 + inter.x1) / 2,
        y: (inter.y0 + inter.y1) / 2,
        probCritico:
          a.especial === 0
            ? a.mov.critico !== undefined
              ? kit.criticoBase + a.mov.critico
              : 0
            : efEspecial === 'critico'
              ? 1
              : 0,
        especial: a.especial,
        efecto,
        ticksEfecto: w.ticksEfecto ?? 0,
        quema: null,
        imbloqueable: efecto === 'agarre',
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

/** Los efectos que no hacen nada en el contacto (multigolpe, crítico, cura, nube) pasan a null. */
export function efectoNormalizado(ef: EfectoEspecial | null): EfectoEspecial | null {
  if (ef === 'multigolpe' || ef === 'critico' || ef === 'cura' || ef === 'nube') return null
  return ef
}

/** Daño de la nube o de la quemadura: sin hitstun, sin bloqueo, sin evento de golpe. */
export function danioContinuo(p: Partida, I: EstadoInterno, atacante: Lado, victima: Lado, danio: number): void {
  const v = p.luchadores[victima]
  if (v.vida <= 0) return
  hacerDanio(p, I, atacante, victima, Math.max(1, Math.round(danio * (1 - I.kits[victima].reduccionDanio))))
  v.destello = Math.max(v.destello, 3)
}

/** Golpeable por un proyectil: la caja del cuerpo, si se le puede pegar. */
export function cuerpoGolpeable(p: Partida, I: EstadoInterno, lado: Lado) {
  const v = p.luchadores[lado]
  const vi = I.luchadores[lado]
  return golpeable(v, vi, true) ? cajaCuerpo(v, vi) : null
}
