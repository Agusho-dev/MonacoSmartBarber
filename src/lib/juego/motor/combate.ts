/**
 * Combate: qué pasa cuando una caja de golpe toca una caja de daño. Bloqueo y daño a la guardia,
 * guardia rota, críticos, super armadura, efectos de los especiales (electrocutar, congelar,
 * derribar, aturdir, marear, quemar, agarrar), combos, carga de la máquina, pasivas,
 * estadísticas y eventos.
 */
import type { EfectoEspecial, FuerzaGolpe, Herramienta, Lado, LuchadorEstado, Partida } from '../tipos'
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
  aguantaGolpes,
  altoParado,
  bloquea,
  cajaCuerpo,
  cajaGolpe,
  contraArmada,
  contraPared,
  enCombo,
  finVentanas,
  golpeable,
  inmuneAlControl,
  interrumpir,
  interseccion,
  limitar,
} from './cuerpo'
import type { Accion, EstadoControl, EstadoInterno, InternoLuchador, ProyectilInterno } from './interno'
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
  /** El Corte de Precisión pegó con la punta (VentanaGolpe.punta): si entra limpio, sale el evento 'precision'. */
  punta?: boolean
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
  emitir(p, { tipo: 'guardia_rota', quien: victima, x: v.x, y: v.y + altoParado(v, vi.escala) * 0.6 })
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
  // Los que lo dejan sin moverse no entran si ya lleva demasiado encerrado (TOPE_ENCIERRO). El
  // mareo, la quemadura, la lentitud y el cegado no le sacan el control: entran igual.
  if ((estado === 'aturdido' || estado === 'electrocutado' || estado === 'congelado' || estado === 'hipnotizado') && inmuneAlControl(vi)) return false
  const t = duracion(I.kits[victima], ticks)
  v.efectos[estado] = Math.max(v.efectos[estado], t)
  return true
}

/**
 * Se termina el hipnotizado (los Lentes de Fran): por tiempo, por el primer golpe limpio o en el tope
 * del encierro. Siempre deja la inmunidad, así no se encadena.
 */
export function despertar(l: LuchadorEstado, li: InternoLuchador): void {
  if (l.efectos.hipnotizado > 0) l.efectos.hipnotizado = 0
  li.inmune.hipnotizado = INMUNIDAD.hipnotizado
  li.hipnotizadoPor = null
}

/** Deja duro al luchador (Fijación Extrema). Pegarle lo rompe con ×1,3. */
export function congelar(p: Partida, I: EstadoInterno, victima: Lado, atacante: Lado, ticks: number): void {
  const v = p.luchadores[victima]
  const vi = I.luchadores[victima]
  if (vi.inmune.congelado > 0 || inmuneAlControl(vi)) return
  interrumpir(v, vi)
  vi.stun = 0
  vi.stunBloqueo = false
  vi.vEmpuje *= 0.3
  ponerEstado(p, I, victima, 'congelado', ticks)
  p.estadisticas[atacante].congelamientos++
  emitir(p, { tipo: 'congelado', quien: victima })
}

/**
 * La embestida frena al chocar y se queda para recuperarse (salvo las que siguen de largo). Sólo con
 * la embestida ya en marcha (quinta tanda): un golpe del mismo especial ANTES de que arranque (el
 * papel del Despido de Tony) no la frena antes de que exista. Los 13 y los de la cuarta tanda tienen
 * todas sus ventanas dentro o después de su embestida: para ellos no cambia nada.
 */
function frenarEmbestida(I: EstadoInterno, lado: Lado, a: Accion, bloqueado: boolean): void {
  const esp = a.mov as DefEspecial
  if (!esp.embestida || a.detenido || esp.embestida.sigue || a.t < esp.embestida.desde) return
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
function tieneArmadura(kit: KitPersonaje, accion: Accion | null, fuerza: FuerzaGolpe, jefe = false): boolean {
  if (!accion || accion.remate) return false
  // Un Boss del modo historia con armadura (ModificadorJefe.armadura): los leves no lo frenan
  // mientras pega con lo que sea, en el piso, hasta que se le terminan las ventanas.
  if (jefe && fuerza === 'leve' && !accion.mov.aereo && accion.t < finVentanas(accion.mov)) return true
  const ar = accion.mov.armadura
  if (ar && accion.t < ar.hasta && ar.contra.includes(fuerza)) return true
  const pas = kit.pasiva?.armaduraAtaques
  if (!pas || accion.mov.aereo || !pas.includes(fuerza)) return false
  const pesado = accion.especial !== 0 || accion.mov.boton === 'herramienta'
  return pesado && accion.t < finVentanas(accion.mov)
}

/**
 * Pelo de punta (Nico M., PasivaKit.pincha): el que le pega de cerca (golpe, bloqueo, armadura o
 * agarre) se pincha: pierde un poco de vida, sin aturdimiento ni bloqueo (como la quemadura). Los
 * tiros no (imp.accion es null).
 */
function pinchar(p: Partida, I: EstadoInterno, imp: Impacto): void {
  const pc = I.kits[imp.victima].pasiva?.pincha
  if (!pc || !imp.accion) return
  const quien = p.luchadores[imp.atacante]
  if (quien.vida <= 0) return
  danioContinuo(p, I, imp.victima, imp.atacante, pc.danio)
  emitir(p, { tipo: 'pinchazo', quien: imp.atacante, x: imp.x, y: imp.y })
}

/**
 * Furia: con poca vida pega más (La 12 no para). Y un Boss del modo historia pega más siempre
 * (ModificadorJefe.danio): este factor multiplica todo el daño que hace, limpio, al bloqueo o contra
 * armadura. Sin `jefes` el factor es el de siempre.
 */
function multFuria(p: Partida, I: EstadoInterno, lado: Lado): number {
  const f = I.kits[lado].pasiva?.furia
  const l = p.luchadores[lado]
  const furia = f && l.vida < l.vidaMax * f.umbral ? f.mult : 1
  const jefe = p.config.jefes?.[lado]
  return jefe ? furia * jefe.danio : furia
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
  // Los golpes del agarre llevan la herramienta del especial (el apretón de Brian, la ejecución de
  // Nacho, el revoleo de Lautaro): el sonido y el destello de cada uno.
  const herramienta = a.mov.herramienta
  if (g.t < def.sostener && g.t % def.apretones.cada === 0) {
    const real = hacerDanio(p, I, lado, g.victima, Math.round(def.apretones.danio * multFuria(p, I, lado) * (1 - I.kits[g.victima].reduccionDanio)))
    vic.destello = DESTELLO
    atk.combo++
    if (atk.combo > p.estadisticas[lado].comboMax) p.estadisticas[lado].comboMax = atk.combo
    // Los apretones y el tirón son parte del agarre, que ya contó UN golpe acertado (agarrar):
    // contarlos aparte llevaba la «Precisión» por encima de 100 %.
    emitir(p, {
      tipo: 'golpe',
      atacante: lado,
      victima: g.victima,
      x: vic.x,
      y: vic.y + altoParado(vic, I.luchadores[g.victima].escala) * 0.55,
      danio: real,
      critico: false,
      bloqueado: false,
      fuerza: 'leve',
      herramienta,
    })
    if (atk.combo >= 2) emitir(p, { tipo: 'combo', quien: lado, golpes: atk.combo })
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.leve)
  }
  if (g.t >= def.sostener) {
    const real = hacerDanio(p, I, lado, g.victima, Math.round(def.tiron.danio * multFuria(p, I, lado) * (1 - I.kits[g.victima].reduccionDanio)))
    // Si ya lleva demasiado encerrado (TOPE_ENCIERRO), el tirón le pega pero no lo deja tirado: cae parado.
    const derriba = !inmuneAlControl(vi)
    vi.agarradoPor = null
    // El revoleo de Lautaro (`tiron.vy`) lo manda alto: cae lejos.
    vic.vy = def.tiron.vy ?? 5
    vi.vEmpuje = atk.mira * def.tiron.empuje
    vi.caidaDerribo = derriba ? EFECTO.derribo : 0
    vi.selloStun++
    atk.combo++
    if (atk.combo > p.estadisticas[lado].comboMax) p.estadisticas[lado].comboMax = atk.combo
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
      herramienta,
    })
    emitir(p, { tipo: 'combo', quien: lado, golpes: atk.combo })
    if (derriba) emitir(p, { tipo: 'derribo', quien: g.victima })
    // La ejecución de Nacho (`roba`): después de la carga de siempre del tirón, la víctima pierde hasta
    // `carga` y él se queda con hasta `gana` («Rival.exe no responde»).
    if (def.roba) {
      const r = Math.min(def.roba.carga, vic.carga)
      if (r > 0) {
        sumarCarga(p, g.victima, -r)
        sumarCarga(p, lado, Math.min(def.roba.gana, r))
        emitir(p, { tipo: 'carga_robada', atacante: lado, victima: g.victima, cantidad: r })
      }
    }
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.especial)
    a.agarre = null
    a.total = a.t + 1 + def.recuperacion
  }
}

/**
 * Aplica un contacto. Devuelve cómo salió. 'contra' = lo anuló la contra del All In de Chino: no hizo
 * nada (el que tiró un proyectil lo saca de la pantalla).
 */
export function aplicarImpacto(p: Partida, I: EstadoInterno, imp: Impacto): 'golpe' | 'bloqueo' | 'armadura' | 'contra' {
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

  // ─── La contra (el All In de Chino) ───
  // Arriba de todo, antes de marcar el contacto del que pega: si no, el golpe contrarrestado le abría
  // la cadena y la cancelación en especial. El agarre le gana (se resuelve abajo, como siempre).
  const va = vi.accion
  if (ef !== 'agarre' && va && contraArmada(va)) {
    const ct = (va.mov as DefEspecial).contra as NonNullable<DefEspecial['contra']>
    va.contraOk = true
    // Salta a la embestida: cerrarTickAccion la deja en `salto` y el próximo tick arranca a correr.
    va.t = ct.salto - 1
    vic.efectos.dominio = 0
    emitir(p, { tipo: 'contra', quien: imp.victima })
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, HITSTOP.fuerte)
    return 'contra'
  }

  if (a) {
    a.contacto = true
    // La cadena se abre desde el contacto de la última ventana (las anteriores tienen que salir).
    if (imp.ventana === a.mov.ventanas.length - 1) a.cancelDesde = Math.min(a.cancelDesde, a.t + 1)
  }

  // ─── Agarre (imbloqueable; lo levanta) ───
  const esp = a?.mov as DefEspecial | undefined
  if (ef === 'agarre' && a && esp?.agarre) {
    // Agarre contra golpe en el mismo tick: los golpes se aplican antes que los agarres
    // (contactosCuerpoACuerpo los deja al final), así que si al que agarra ya le cortaron el
    // movimiento, no agarra. Antes agarraba igual: la víctima quedaba «agarrada» sin agarre,
    // después tirada gratis, y el especial contaba como acertado (dependía del lado).
    if (ai.accion !== a) return 'golpe'
    agarrar(p, I, imp, a, esp.agarre)
    pinchar(p, I, imp)
    return 'golpe'
  }
  const inmune = inmuneAlControl(vi)

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
    if (vic.guardia <= 0 && !inmune) {
      romperGuardia(p, I, imp.victima, imp.atacante)
      vi.vEmpuje = imp.dir * imp.empujeBloqueo
    } else {
      // Inmune al control (TOPE_ENCIERRO): la guardia no se rompe y el blockstun queda en el piso.
      const bs = Math.max(1, Math.round(imp.hitstun * FACTOR_BLOCKSTUN * (inmune ? ESCALADO_STUN.minimo : 1)))
      vi.stun = Math.max(vi.stun, bs)
      vi.stunTotal = vi.stun
      vi.stunBloqueo = true
      vi.selloStun++
      vi.vEmpuje = imp.dir * imp.empujeBloqueo
      if (imp.rebotePared && contraPared(vic, imp.dir)) ai.vEmpuje = -imp.dir * imp.empujeBloqueo * 0.8
      // Pulso fino (Fran): el próximo golpe normal que arranque enseguida es crítico seguro.
      const ctb = kitV.pasiva?.criticoTrasBloqueo
      if (ctb) vi.critListo = Math.max(vi.critListo, vi.stun + ctb)
    }
    if (imp.efecto === 'congela') congelar(p, I, imp.victima, imp.atacante, EFECTO.congeladoBloqueo)
    if (a) frenarEmbestida(I, imp.atacante, a, true)
    p.congelamientoGolpe = Math.max(p.congelamientoGolpe, imp.hitstop)
    pinchar(p, I, imp)
    return 'bloqueo'
  }

  // ─── Super armadura (Chipi con la herramienta, Brian mientras ataca: contra golpes leves) ───
  // Y el que llegó al tope del encierro (TOPE_ENCIERRO.tope), hasta que respire: aguanta cualquier
  // golpe así (le saca vida, pero no lo frena, no lo tira ni le pone ningún efecto).
  if ((tieneArmadura(kitV, vi.accion, imp.fuerza, p.config.jefes?.[imp.victima]?.armadura === true) && imp.efecto === null) || aguantaGolpes(vi)) {
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
    pinchar(p, I, imp)
    return 'armadura'
  }

  // ─── Golpe limpio ───
  let mult = furia
  const critico = imp.probCritico > 0 && (imp.probCritico >= 1 || chance(I.azar, imp.probCritico))
  if (critico) mult *= CRITICO.mult
  const estabaEnCombo = enCombo(vic, vi)
  // Los dos estados que dejan indefenso (quinta tanda) se cortan con el primer golpe limpio, ANTES de
  // poner el efecto de este golpe (que, con la inmunidad recién puesta, ya no los renueva).
  if (vic.efectos.hipnotizado > 0) despertar(vic, vi)
  if (vic.efectos.cegado > 0) {
    vic.efectos.cegado = 0
    vi.inmune.cegado = INMUNIDAD.cegado
  }
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
  // Inmune al control (TOPE_ENCIERRO): nada lo tira y el aturdimiento del golpe queda en el piso
  // de ESCALADO_STUN, así el combo se cae enseguida.
  const derriba = (ef === 'rompe_guardia' || ef === 'derriba' || ef === 'sismo') && !inmune
  if (!vic.enSuelo) {
    // En el aire: cae y queda tirado.
    vi.stun = 0
    if (!inmune) vi.caidaDerribo = Math.max(vi.caidaDerribo, derriba ? EFECTO.derribo : EFECTO.derriboAereo)
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
    vi.stun = Math.max(1, Math.round(imp.hitstun * (inmune ? ESCALADO_STUN.minimo : multiplicadorStun(atk.combo))))
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
  if (imp.punta && critico) emitir(p, { tipo: 'precision', quien: imp.atacante, x: imp.x, y: imp.y })
  if (vic.vida > 0) {
    // La duración del electrocutado y del congelado también la puede decir el especial (ticksEfecto).
    if (ef === 'electrocuta' && ponerEstado(p, I, imp.victima, 'electrocutado', imp.ticksEfecto || EFECTO.electrocutado)) {
      emitir(p, { tipo: 'electrocutado', quien: imp.victima })
    }
    if (ef === 'congela') congelar(p, I, imp.victima, imp.atacante, imp.ticksEfecto || EFECTO.congelado)
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
    // Los Lentes de Fran: sólo hipnotizan al que está en el piso (en el aire pega y lo tira, nada más).
    if (ef === 'hipnotiza' && vic.enSuelo && ponerEstado(p, I, imp.victima, 'hipnotizado', imp.ticksEfecto || EFECTO.hipnotizado)) {
      vi.hipnotizadoPor = imp.atacante
      emitir(p, { tipo: 'hipnotizado', quien: imp.victima })
    }
    if (ef === 'ciega' && ponerEstado(p, I, imp.victima, 'cegado', imp.ticksEfecto || EFECTO.cegado)) {
      emitir(p, { tipo: 'cegado', quien: imp.victima })
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
  // El Despido Final de Tony (DefEspecial.siPega): el papel entró limpio, la víctima se arrodilla
  // (aturdida, con el escalado del combo) y la acción se estira: recién ahora existe la patada.
  const sp = (a?.mov as DefEspecial | undefined)?.siPega
  if (a && sp && imp.ventana === sp.ventana && vic.enSuelo && vic.vida > 0 && !derriba) {
    a.total = Math.max(a.total, sp.total)
    vi.stun = Math.max(vi.stun, Math.max(1, Math.round(sp.aturde * (inmune ? ESCALADO_STUN.minimo : multiplicadorStun(atk.combo)))))
    vi.stunTotal = vi.stun
    emitir(p, { tipo: 'despido', atacante: imp.atacante, victima: imp.victima })
  }
  pinchar(p, I, imp)
  return 'golpe'
}

/** Busca los contactos cuerpo a cuerpo de este tick (los dos lados, antes de aplicar: hay cambios de golpes). */
export function contactosCuerpoACuerpo(p: Partida, I: EstadoInterno): Impacto[] {
  const lista: Impacto[] = []
  const agarres: Impacto[] = []
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
    const esp = a.mov as DefEspecial
    // El agarre no agarra en el aire (la ventana sigue buscando por si aterriza; el Lanzamiento Aéreo
    // de Lautaro sí, `agarre.aire`) ni al que ya lleva demasiado encerrado (TOPE_ENCIERRO): si no
    // vuelve a moverse a tiempo, el agarre sale al aire.
    if (efEspecial === 'agarre' && ((!v.enSuelo && !esp.agarre?.aire) || inmuneAlControl(vi))) continue
    // La contra que saltó (el All In): la embestida pega con el bono.
    const bono = a.contraOk ? esp.contra?.bono : undefined
    for (let i = 0; i < a.mov.ventanas.length; i++) {
      if (a.resueltas[i] || a.esperaVentana[i] > 0) continue
      const w = a.mov.ventanas[i]
      if (a.t < w.desde || a.t >= w.desde + w.ticks) continue
      const inter = interseccion(cajaGolpe(l, w.caja, li.escala), cuerpo)
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
      const efecto = bono ? bono.efecto : a.especial ? (efVentana !== undefined ? efVentana : efectoNormalizado(efEspecial)) : null
      // La punta del Corte de Precisión (Fran): con el rival lejos, crítico seguro.
      const punta = !!w.punta && Math.abs(v.x - l.x) >= w.punta.desde
      // La Volea de Nehuen: sus golpes aéreos pegan más (no aturden ni empujan más).
      const multAereo = a.mov.aereo ? (kit.pasiva?.multAereo ?? 1) : 1
      ;(efecto === 'agarre' ? agarres : lista).push({
        atacante: lado,
        victima: otro,
        danio: (bono ? bono.danio : rem ? rem.danio : w.danio) * multAereo,
        danioGuardia: w.danioGuardia,
        fuerza,
        herramienta: a.mov.herramienta,
        hitstun: bono ? bono.hitstun : (rem?.hitstun ?? w.hitstun ?? HITSTUN[fuerza]),
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
              ? a.critSeguro
                ? 1
                : kit.criticoBase + a.mov.critico
              : 0
            : efEspecial === 'critico' || punta
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
        punta,
      })
      break
    }
  }
  // Los golpes antes que los agarres (el golpe le gana al agarre en el mismo tick, sin importar el
  // lado) y, si los dos agarran en el mismo tick, se traban: no agarra ninguno.
  if (agarres.length === 2) return lista
  return agarres.length ? [...lista, ...agarres] : lista
}

/** El efecto de cada especial sale de la ficha del personaje (personajes.ts). */
export function efectoDe(p: Partida, lado: Lado, numero: 1 | 2): EfectoEspecial {
  return PERSONAJES[p.luchadores[lado].id].especiales[numero - 1].efecto
}

/**
 * Los efectos que no hacen nada en el contacto (multigolpe, crítico, cura, nube) pasan a null. Los de
 * la quinta tanda que hace su pieza, también: la contra, la precisión (la punta) y la devolución.
 */
export function efectoNormalizado(ef: EfectoEspecial | null): EfectoEspecial | null {
  if (ef === 'multigolpe' || ef === 'critico' || ef === 'cura' || ef === 'nube') return null
  if (ef === 'contra' || ef === 'precision' || ef === 'devuelve' || ef === 'trampa') return null
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
