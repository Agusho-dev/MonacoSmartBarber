/**
 * Un duelo online entre dos jugadores de la sala, por el canal propio de la pelea
 * (juego-pelea:<id>): la elección de barberos, la medición del RTT, el arranque sincronizado,
 * el lockstep de cada pelea, el resultado, la revancha y las salidas.
 *
 * Reglas:
 *  - El que desafió es el lado 0 (izquierda) y decide la semilla y la demora.
 *  - Fuera de la pelea en sí, cada uno manda su «estado» completo al cambiar y cada segundo:
 *    si se pierde un mensaje, el siguiente lo arregla (nada de mensajes de una sola vez).
 *  - Cada pelea (k = 1, 2… con las revanchas) tiene su lockstep; los lotes que llegan antes de
 *    que la pantalla de pelea lo cree se guardan y se le pasan al crearlo.
 *  - Nunca más de MAX_MSJ_POR_SEGUNDO mensajes en un segundo (es la misma instancia de
 *    Realtime que usan el panel de los barberos, la TV y el kiosko: Known Risk #9).
 *  - Cómo termina una pelea, para que los dos celulares digan LO MISMO aunque se pierdan
 *    mensajes, se corte la red o uno se vaya en el peor momento:
 *      · lo que dice el motor manda: apenas llega a 'terminada' (`finDelMotor`), ni un adiós ni
 *        un «fin» que lleguen durante el festejo cambian ese resultado;
 *      · el «estado» del resultado lleva cómo terminó (ResumenFinal) y se repite cada segundo:
 *        el que todavía está peleando lo adopta si el otro ya cerró la pelea (o si él quedó
 *        trabado), y los dos lo concilian: anulada > motor > abandono; dos abandonos que no
 *        coinciden (se cortó la red de los dos) anulan la pelea, y dos finales del motor que no
 *        coinciden (se desincronizaron sin que el hash lo viera) también;
 *      · el abandono por silencio lo reclama sólo el que tiene red (y hace un rato): el que se
 *        quedó sin conexión 10 s, o tuvo la página oculta 10 s, pierde (`rendirsePorAusencia`).
 *        «Tener red» es una ida y vuelta REAL por el socket (`sondear` del transporte): con el
 *        4G trabado sin que se cierre la conexión el canal sigue unido, y antes los dos
 *        reclamaban (ver `vigilarRed`).
 *
 * Sin React ni Supabase: recibe un transporte (enviar/cerrar) y le pasan lo que llega con
 * `recibir`. Sin `@/`: se prueba con Node.
 */
import type { EstadisticasLuchador, EntradaJugador, IdArena, IdPersonaje, Lado } from '../tipos'
import { ABANDONO_MS, LENTA_MS, Lockstep, demoraParaRtt, type LoteEntradas } from './lockstep'
import {
  leerMensajePelea,
  type MensajePelea,
  type MotivoAdios,
  type MotivoFinal,
  type MsjEstado,
  type ResumenFinal,
} from './protocolo'

export type FaseDuelo = 'conectando' | 'eligiendo' | 'preparando' | 'peleando' | 'resultado' | 'cerrado'

export const ELECCION_MS = 20_000
/**
 * Tope duro de mensajes en cualquier ventana de 1 s. El presupuesto es 30 por jugador; se usa 29
 * porque se cuenta al llamar a `send` y el frame sale unos ms después: medido en el WebSocket,
 * con 30 algún segundo daba 31.
 */
export const MAX_MSJ_POR_SEGUNDO = 29
const ESTADO_CADA_MS = 1000
const CONEXION_MS = 10_000
const SILENCIO_MS = 8000
const ARRANQUE_MS = 30_000
const PINGS = 5
const PING_CADA_MS = 110
const PING_ESPERA_MS = 2500
const RTT_SIN_DATOS = 600
const MAX_GUARDADOS = 400
/** Recién volvió la red: se espera esto antes de reclamar un abandono (puede llegar lo que el otro decidió). */
const RECONEXION_MS = 3000
/** Trabado esperando entradas y el otro ya terminó la misma pelea: se adopta su resultado. */
const ADOPTAR_MS = 1500
/**
 * Esperando las entradas del rival desde esto, se sondea la red propia (`vigilarRed`): es cuando
 * aparece «Conexión lenta…». Con SONDEO_MS de 2 s, el trabado ya sabe que no tiene red antes de
 * que el cartel empiece a contar (a los 3 s): nunca ve una cuenta hacia una victoria que no va a tener.
 */
const SONDEO_DESDE_MS = LENTA_MS
/** Entre un sondeo y el siguiente de la misma espera (más seguido sin red, para ver cuándo vuelve). */
const SONDEO_CADA_MS = 2500
const SONDEO_CADA_SIN_RED_MS = 1000
/** Ya cumplida la espera, el sondeo que decide el abandono sale enseguida (sólo esta pausa). */
const SONDEO_DECIDE_MS = 500

export interface JugadorDuelo {
  id: string
  nombre: string
}

export interface ResultadoDuelo {
  k: number
  /** null = sin ganador (se desincronizó o se cortó la red de los dos). */
  ganador: 'yo' | 'rival' | null
  /** 'abandone': me desconecté (o el otro me dio por ido); 'ausente': tuve la página oculta 10 s. */
  motivo: 'pelea' | 'abandono_rival' | 'turno_rival' | 'abandone' | 'ausente' | 'desync' | 'corte'
  /** Rounds [yo, rival]. */
  rondas: [number, number]
  estadisticas: EstadisticasLuchador | null
  duracionSeg: number
}

export type MotivoCierre =
  | 'sin_conexion'
  | 'rival_salio'
  | 'rival_cerro'
  | 'rival_turno'
  | 'version'
  | 'propio'
  | 'error'

export interface ArranqueDuelo {
  k: number
  semilla: number
  demora: number
  rtt: number
  personajes: [IdPersonaje, IdPersonaje]
}

export interface EstadoDuelo {
  fase: FaseDuelo
  k: number
  lado: Lado
  yo: JugadorDuelo
  rival: JugadorDuelo
  arena: IdArena
  mia: IdPersonaje
  confirmada: boolean
  rivalConfirmo: boolean
  /** Hasta cuándo se puede elegir (reloj de `ahora`). */
  venceEleccion: number
  /** Por lado, fijados al terminar la elección. */
  personajes: [IdPersonaje, IdPersonaje] | null
  /** Preparando: yo ya estoy listo y falta el rival. */
  esperandoRival: boolean
  arranque: ArranqueDuelo | null
  resultado: ResultadoDuelo | null
  /** [yo, rival] en esta sesión. */
  marcador: [number, number]
  revanchaPropia: boolean
  revanchaRival: boolean
  rivalPresente: boolean
  /** Por qué se fue el rival (si se fue). */
  rivalSeFue: MotivoAdios | 'sin_conexion' | null
  cierre: MotivoCierre | null
}

export interface TransporteDuelo {
  /** false = no salió (canal no unido todavía). */
  enviar(m: MensajePelea): boolean
  cerrar(): void
  /** ¿El canal está unido? (sin esto, el duelo lo da por conectado siempre). */
  conectado?(): boolean
  /**
   * Ida y vuelta REAL por el socket: true = este celular tiene red. Con la red trabada sin que se
   * cierre la conexión el canal sigue unido y sólo esto lo nota. Sin esto, el canal unido alcanza
   * para reclamar un abandono (lo de antes del 30/oct).
   */
  sondear?(): Promise<boolean>
}

/** Un sondeo de la red propia en vuelo: de qué pelea, de qué espera del lockstep y de qué conexión es. */
interface SondeoRed {
  k: number
  espera: number
  desde: number
  /** `conexionDesde` al salir: si el canal se cayó o volvió mientras tanto, la respuesta ya no dice nada. */
  conexion: number
}

export interface OpcionesDuelo {
  peleaId: string
  lado: Lado
  yo: JugadorDuelo
  rival: JugadorDuelo
  arena: IdArena
  personajeInicial: IdPersonaje
  version: string
  transporte: TransporteDuelo
  marcador?: [number, number]
  ahora?: () => number
  /** Semilla de la pelea (sólo la usa el lado 0). */
  semilla?: () => number
  /**
   * Cada vez que cambia lo que una pelea cuenta (para guardar las victorias y el marcador):
   * `ahora` true = gané, false = perdí, null = no cuenta; `antes` lo que se había informado de
   * ESA pelea (undefined = es la primera vez). Cambia sólo si los dos celulares, al conciliar,
   * corrigen un abandono (ver el comentario de arriba).
   */
  alResultado?: (ahora: boolean | null, antes: boolean | null | undefined) => void
}

/** Lo que la pantalla de pelea informa al terminar (sus lados son los del mundo). */
export interface FinPeleaLocal {
  ganadorLado: Lado | null
  rondasPorLado: [number, number]
  estadisticasPorLado: [EstadisticasLuchador, EstadisticasLuchador]
  duracionSeg: number
}

type Ganador = ResultadoDuelo['ganador']

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b)
  return o[Math.floor(o.length / 2)]
}

/** Precedencia al conciliar dos resultados de la misma pelea. */
const PESO_FINAL: Record<MotivoFinal, number> = { abandono: 0, pelea: 1, desync: 2, corte: 2 }

export class Duelo {
  readonly peleaId: string
  readonly lado: Lado
  private readonly o: OpcionesDuelo
  private readonly ahora: () => number
  private fase: FaseDuelo = 'conectando'
  private k = 1
  private mia: IdPersonaje
  private confirmada = false
  private suya: IdPersonaje | null = null
  private rivalConfirmo = false
  private venceEleccion = 0
  private personajes: [IdPersonaje, IdPersonaje] | null = null
  private listoPropio = false
  private listoRival = false
  private rtt: number | null = null
  private pings = new Map<number, number>()
  private rtts: number[] = []
  private sigPing = 0
  private arranque: ArranqueDuelo | null = null
  private inicioDelRival: MsjEstado['i'] = null
  private resultado: ResultadoDuelo | null = null
  private marcador: [number, number]
  /** El marcador con el que arrancó el duelo (de peleas anteriores con este rival). */
  private readonly marcadorBase: [number, number]
  /** Lo que cuenta cada pelea de este duelo (k → ganador): el marcador se deriva de acá. */
  private readonly ganadores = new Map<number, Ganador>()
  /** El motor de este celular ya llegó a 'terminada' en la pelea k (el festejo todavía corre). */
  private finMotor: FinPeleaLocal | null = null
  /** Cómo terminó la pelea k según el rival (de su «estado»). */
  private resRival: ResumenFinal | null = null
  private revanchaPropia = false
  private revanchaRival = false
  private rivalPresente = true
  /** Se despidió (adiós): no vuelve. Sin esto, un rival que reaparece vuelve a estar presente. */
  private adiosRecibido = false
  private rivalSeFue: EstadoDuelo['rivalSeFue'] = null
  private cierre: MotivoCierre | null = null
  private conectado: boolean
  /** Desde cuándo vale `conectado` (reloj de `ahora`). */
  private conexionDesde: number
  /** Sondeo de la red propia en vuelo (ver vigilarRed). */
  private sondeo: SondeoRed | null = null
  /** La espera del lockstep (su número, `stats.esperas`) a la que pertenecen redOk y sinRedDesde. */
  private esperaVigilada = -1
  /** Lo que dijo el último sondeo de esta espera (null = todavía nada). La pantalla lo muestra. */
  private redOk: boolean | null = null
  /** Desde cuándo este celular está sin red en esta espera (cuando salió el primer sondeo que falló). */
  private sinRedDesde: number | null = null
  /** Cuándo volvió el último sondeo de esta espera. */
  private finSondeo = -Infinity
  private rival: JugadorDuelo
  private ultimoDelRival: number
  private lockstep: Lockstep | null = null
  private lockstepK = 0
  private guardados: { k: number; m: MensajePelea }[] = []
  private recibioLoteDelRival = false
  private timers: ReturnType<typeof setTimeout>[] = []
  private intervalo: ReturnType<typeof setInterval> | null = null
  private envios: number[] = []
  private colaEstado = false
  private colaOtros: MensajePelea[] = []
  private timerCola: ReturnType<typeof setTimeout> | null = null
  private oyentes = new Set<() => void>()
  private foto: EstadoDuelo
  /** Mensajes mandados (para el gancho de pruebas). */
  enviados = 0

  constructor(o: OpcionesDuelo) {
    this.o = o
    this.peleaId = o.peleaId
    this.lado = o.lado
    this.ahora = o.ahora ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.mia = o.personajeInicial
    this.rival = { ...o.rival }
    this.marcadorBase = o.marcador ? [o.marcador[0], o.marcador[1]] : [0, 0]
    this.marcador = [this.marcadorBase[0], this.marcadorBase[1]]
    this.conectado = o.transporte.conectado ? o.transporte.conectado() : true
    this.conexionDesde = this.ahora()
    this.ultimoDelRival = this.ahora()
    this.foto = this.armarFoto()
    this.intervalo = setInterval(() => this.latido(), ESTADO_CADA_MS)
    this.despues(CONEXION_MS, () => {
      if (this.fase === 'conectando') this.cerrar('sin_conexion')
    })
    this.mandarEstado()
  }

  // ─── Lectura para React ────────────────────────────────────────────────────

  leer = (): EstadoDuelo => this.foto

  suscribir = (fn: () => void): (() => void) => {
    this.oyentes.add(fn)
    return () => {
      this.oyentes.delete(fn)
    }
  }

  private armarFoto(): EstadoDuelo {
    return {
      fase: this.fase,
      k: this.k,
      lado: this.lado,
      yo: this.o.yo,
      rival: this.rival,
      arena: this.o.arena,
      mia: this.mia,
      confirmada: this.confirmada,
      rivalConfirmo: this.rivalConfirmo,
      venceEleccion: this.venceEleccion,
      personajes: this.personajes,
      esperandoRival: this.fase === 'preparando' && this.listoPropio && !this.arranque,
      arranque: this.arranque,
      resultado: this.resultado,
      marcador: this.marcador,
      revanchaPropia: this.revanchaPropia,
      revanchaRival: this.revanchaRival,
      rivalPresente: this.rivalPresente,
      rivalSeFue: this.rivalSeFue,
      cierre: this.cierre,
    }
  }

  private avisar(): void {
    this.foto = this.armarFoto()
    this.oyentes.forEach((f) => f())
  }

  // ─── Envío con límite ──────────────────────────────────────────────────────

  private hayLugar(): boolean {
    const t = this.ahora()
    while (this.envios.length > 0 && t - this.envios[0] >= 1000) this.envios.shift()
    return this.envios.length < MAX_MSJ_POR_SEGUNDO
  }

  private enviarYa(m: MensajePelea): boolean {
    if (!this.hayLugar()) return false
    if (!this.o.transporte.enviar(m)) return false
    this.envios.push(this.ahora())
    this.enviados++
    return true
  }

  /** Mensajes que no son lotes: si no hay lugar en este segundo, esperan un toque. */
  private enviar(m: MensajePelea): void {
    if (this.fase === 'cerrado' && m.t !== 'adios') return
    if (this.colaOtros.length === 0 && !this.colaEstado && this.enviarYa(m)) return
    if (m.t === 'estado') this.colaEstado = true
    else if (this.colaOtros.length < 20) this.colaOtros.push(m)
    this.programarCola()
  }

  private programarCola(): void {
    if (this.timerCola !== null) return
    this.timerCola = setTimeout(() => {
      this.timerCola = null
      while (this.colaOtros.length > 0 && this.enviarYa(this.colaOtros[0])) this.colaOtros.shift()
      if (this.colaOtros.length === 0 && this.colaEstado && this.enviarYa(this.mensajeEstado())) this.colaEstado = false
      if (this.colaOtros.length > 0 || this.colaEstado) this.programarCola()
    }, 40)
  }

  private mensajeEstado(): MsjEstado {
    const f = this.fase === 'peleando' ? 'peleando' : this.fase === 'resultado' ? 'resultado' : this.fase === 'preparando' ? 'preparando' : 'eligiendo'
    const a = this.arranque
    return {
      t: 'estado',
      de: this.o.yo.id,
      k: this.k,
      f,
      n: this.o.yo.nombre,
      v: this.o.version,
      p: this.mia,
      c: this.confirmada,
      l: this.listoPropio,
      r: this.revanchaPropia,
      i: this.lado === 0 && a && a.k === this.k ? { s: a.semilla, d: a.demora, pj: a.personajes } : null,
      x: f === 'resultado' ? this.resumenPropio() : null,
    }
  }

  /** El resultado propio en lados del mundo (lo que viaja en el «estado»). */
  private resumenPropio(): ResumenFinal | null {
    const r = this.resultado
    if (!r) return null
    const el: Lado = this.lado === 0 ? 1 : 0
    const g: Lado | null = r.ganador === null ? null : r.ganador === 'yo' ? this.lado : el
    const m: MotivoFinal = r.motivo === 'pelea' || r.motivo === 'desync' || r.motivo === 'corte' ? r.motivo : 'abandono'
    const porLado: [number, number] = this.lado === 0 ? [r.rondas[0], r.rondas[1]] : [r.rondas[1], r.rondas[0]]
    return { g, m, r: porLado }
  }

  private mandarEstado(): void {
    if (this.fase === 'cerrado') return
    this.enviar(this.mensajeEstado())
  }

  /** ¿Cambió el canal (unido / caído)? Se anota desde cuándo. */
  private revisarConexion(): void {
    const c = this.o.transporte.conectado ? this.o.transporte.conectado() : true
    if (c !== this.conectado) {
      this.conectado = c
      this.conexionDesde = this.ahora()
      // Volvió el canal (el join hizo ida y vuelta con el servidor): la red anda.
      if (c) {
        this.redOk = null
        this.sinRedDesde = null
      }
    }
  }

  /**
   * Para la pantalla de pelea, en cada cuadro: «Sin conexión / Reconectando…» en vez de la cuenta
   * hacia el abandono del rival cuando el que no tiene red es ESTE celular (el canal caído o, con
   * el canal unido, el último sondeo sin respuesta). De paso vigila la red mientras espera.
   */
  estaConectado(): boolean {
    this.revisarConexion()
    this.vigilarRed()
    return this.conectado && this.redOk !== false
  }

  /** Cada segundo: el estado (salvo en plena pelea con lotes yendo y viniendo) y el silencio del rival. */
  private latido(): void {
    if (this.fase === 'cerrado') return
    this.revisarConexion()
    if (this.fase === 'peleando') this.vigilarRed()
    const peleandoConLotes = this.fase === 'peleando' && this.recibioLoteDelRival
    if (!peleandoConLotes) this.mandarEstado()
    if (this.fase !== 'peleando' && this.ahora() - this.ultimoDelRival > SILENCIO_MS) {
      if (this.fase === 'resultado') {
        if (this.rivalPresente) {
          this.rivalPresente = false
          this.rivalSeFue = this.rivalSeFue ?? 'sin_conexion'
          this.revanchaRival = false
          this.avisar()
        }
      } else {
        this.cerrar('sin_conexion')
      }
    }
  }

  private despues(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  // ─── Lo que llega ──────────────────────────────────────────────────────────

  recibir(crudo: unknown): void {
    if (this.fase === 'cerrado') return
    const m = leerMensajePelea(crudo)
    // Sólo el rival de ESTE duelo (en un canal público cualquiera podría mandar algo).
    if (!m || m.de !== this.rival.id) return
    this.ultimoDelRival = this.ahora()
    switch (m.t) {
      case 'estado':
        this.alEstado(m)
        break
      case 'ping':
        this.enviar({ t: 'pong', de: this.o.yo.id, i: m.i })
        break
      case 'pong': {
        const t = this.pings.get(m.i)
        if (t !== undefined && this.rtt === null) {
          this.pings.delete(m.i)
          this.rtts.push(this.ahora() - t)
          if (this.rtts.length >= PINGS) this.cerrarRtt()
        }
        break
      }
      case 'e':
      case 'pide':
        this.alLockstep(m.k, m)
        break
      case 'adios':
        this.alAdios(m.m)
        break
      case 'fin':
        // Con el motor ya en 'terminada' manda el motor (el «fin» llegó tarde: el otro no vio la cola).
        if (m.k !== this.k || this.fase !== 'peleando' || this.finMotor) break
        if (m.m === 'abandono') this.fijarResultado('rival', 'abandone', null)
        else this.fijarResultado(null, 'desync', null)
        break
    }
  }

  private alEstado(m: MsjEstado): void {
    if (m.v !== this.o.version) {
      this.cerrar('version')
      return
    }
    if (m.n !== this.rival.nombre) this.rival = { ...this.rival, nombre: m.n }
    // Volvió a dar señales (se había quedado sin conexión, sin despedirse): está de nuevo.
    if (!this.rivalPresente && !this.adiosRecibido && this.fase === 'resultado') {
      this.rivalPresente = true
      this.rivalSeFue = null
    }
    if (m.k === this.k && m.f === 'resultado' && m.x) this.resRival = m.x
    switch (this.fase) {
      case 'conectando':
        this.aEligiendo()
        this.alEstado(m)
        return
      case 'eligiendo':
        if (m.k === this.k) {
          this.rivalConfirmo = m.c
          if (m.c && m.p) this.suya = m.p
          if (this.confirmada && this.rivalConfirmo) this.aPreparando()
        }
        break
      case 'preparando':
        if (m.k === this.k) {
          this.listoRival = m.l
          if (this.lado === 1 && m.i) this.inicioDelRival = m.i
          this.intentarArrancar()
        }
        break
      case 'peleando':
        // El otro ya cerró la pelea k y yo sigo en ella: o el motor me lleva solo al mismo final
        // (el pedido trae la cola que falte), o me toca lo que él decidió.
        if (m.k === this.k && m.f === 'resultado' && m.x && !this.finMotor) {
          const x = m.x
          const trabado = this.lockstep !== null && this.lockstep.msEsperando() >= ADOPTAR_MS
          if (x.m !== 'pelea' || trabado) {
            this.adoptar(x)
            return
          }
        }
        break
      case 'resultado':
        if (m.k === this.k && m.f === 'resultado') {
          this.revanchaRival = m.r && this.rivalPresente
          if (m.x) this.conciliar()
        }
        // El rival ya pasó a la revancha (vio la mía): voy también.
        if (m.k === this.k + 1 && m.f === 'preparando' && this.revanchaPropia) this.aRevancha()
        else if (this.revanchaPropia && this.revanchaRival) this.aRevancha()
        break
      default:
        break
    }
    this.avisar()
  }

  private alAdios(motivo: MotivoAdios): void {
    this.adiosRecibido = true
    this.rivalPresente = false
    this.rivalSeFue = motivo
    this.revanchaRival = false
    if (this.fase === 'peleando') {
      // Se fue durante MI festejo: el resultado es el del motor (lo fija terminarPelea).
      if (this.finMotor) {
        this.avisar()
        return
      }
      // Terminó la misma pelea antes que yo y se fue: su resultado (no es un abandono).
      if (this.resRival && this.resRival.m === 'pelea') {
        this.adoptar(this.resRival)
        return
      }
      this.fijarResultado('yo', motivo === 'turno' ? 'turno_rival' : 'abandono_rival', null)
    } else if (this.fase === 'resultado') {
      this.avisar()
    } else {
      this.cerrar(motivo === 'turno' ? 'rival_turno' : motivo === 'cerro' ? 'rival_cerro' : 'rival_salio')
    }
  }

  /** Me quedo con lo que decidió el otro (en lados del mundo) para la pelea k. */
  private adoptar(x: ResumenFinal): void {
    const el: Lado = this.lado === 0 ? 1 : 0
    const ganador: Ganador = x.g === null ? null : x.g === this.lado ? 'yo' : 'rival'
    const motivo: ResultadoDuelo['motivo'] =
      x.m === 'abandono' ? (ganador === 'yo' ? 'abandono_rival' : 'abandone') : x.m
    const rondas: [number, number] = [x.r[this.lado], x.r[el]]
    if (this.fase === 'peleando') this.fijarResultado(ganador, motivo, null, rondas)
    else if (this.fase === 'resultado') this.reemplazarResultado(ganador, motivo, rondas)
  }

  /**
   * Los dos resultados de la misma pelea tienen que decir lo mismo. Anulada > motor > abandono:
   * el que tiene menos peso adopta el del otro; dos abandonos que no coinciden (los dos creen que
   * ganaron, o los dos que perdieron: se cortó la red de los dos) anulan la pelea.
   */
  private conciliar(): void {
    const mio = this.resumenPropio()
    const suyo = this.resRival
    if (this.fase !== 'resultado' || !mio || !suyo) return
    if (PESO_FINAL[suyo.m] > PESO_FINAL[mio.m]) {
      this.adoptar(suyo)
      return
    }
    if (mio.m === 'abandono' && suyo.m === 'abandono' && mio.g !== suyo.g) {
      this.reemplazarResultado(null, 'corte', this.resultado?.rondas ?? [0, 0])
      return
    }
    // Los dos motores terminaron la pelea y no dicen lo mismo: se desincronizaron sin que el hash
    // (cada CADA_HASH ticks) lo viera. No cuenta para nadie, como un hash distinto; el otro lo
    // adopta al recibir este «estado» (anulada pesa más que el motor).
    if (mio.m === 'pelea' && suyo.m === 'pelea' && (mio.g !== suyo.g || mio.r[0] !== suyo.r[0] || mio.r[1] !== suyo.r[1])) {
      console.error('[juego] los dos celulares terminaron la pelea online distinto', { mio, suyo })
      this.reemplazarResultado(null, 'desync', this.resultado?.rondas ?? [0, 0])
    }
  }

  /** Corrige el resultado de la pelea k ya mostrado (lo ve la pantalla de resultado al toque). */
  private reemplazarResultado(ganador: Ganador, motivo: ResultadoDuelo['motivo'], rondas: [number, number]): void {
    const r = this.resultado
    if (!r || (r.ganador === ganador && r.motivo === motivo)) return
    this.resultado = { ...r, ganador, motivo, rondas }
    this.aplicarGanador(r.k, ganador)
    this.mandarEstado()
    this.avisar()
  }

  /** Anota lo que cuenta la pelea k y recalcula el marcador (avisa el cambio a la raíz). */
  private aplicarGanador(k: number, ganador: Ganador): void {
    const antes = this.ganadores.has(k) ? this.ganadores.get(k) : undefined
    if (antes === ganador) return
    this.ganadores.set(k, ganador)
    let yo = this.marcadorBase[0]
    let el = this.marcadorBase[1]
    for (const g of this.ganadores.values()) {
      if (g === 'yo') yo++
      else if (g === 'rival') el++
    }
    this.marcador = [yo, el]
    this.o.alResultado?.(ganador === null ? null : ganador === 'yo', antes === undefined ? undefined : antes === null ? null : antes === 'yo')
  }

  private alLockstep(k: number, m: MensajePelea): void {
    if (k !== this.k) return
    if (m.t === 'e') this.recibioLoteDelRival = true
    if (this.lockstep && this.lockstepK === k) {
      this.pasarAlLockstep(this.lockstep, m)
    } else if (this.fase === 'preparando' || this.fase === 'peleando') {
      // Todavía no se montó la pantalla de pelea (o el «inicio» no llegó): se guardan.
      if (this.guardados.length < MAX_GUARDADOS) this.guardados.push({ k, m })
    }
  }

  private pasarAlLockstep(l: Lockstep, m: MensajePelea): void {
    if (m.t === 'e') l.recibirLote({ n: m.n, b: m.b, c: m.c, h: m.h })
    else if (m.t === 'pide') l.responderPedido(m.desde)
  }

  // ─── Fases ─────────────────────────────────────────────────────────────────

  private aEligiendo(): void {
    this.fase = 'eligiendo'
    this.venceEleccion = this.ahora() + ELECCION_MS
    const k = this.k
    // A los 20 s se confirma solo lo que tenga elegido.
    this.despues(ELECCION_MS, () => {
      if (this.fase === 'eligiendo' && this.k === k && !this.confirmada) this.confirmar()
    })
    this.avisar()
  }

  private aPreparando(): void {
    const mio = this.mia
    const suyo = this.suya ?? this.mia
    this.personajes = this.lado === 0 ? [mio, suyo] : [suyo, mio]
    this.fase = 'preparando'
    this.prepararArranque()
  }

  private prepararArranque(): void {
    this.listoPropio = false
    this.listoRival = false
    this.arranque = null
    this.inicioDelRival = null
    this.rtt = null
    this.rtts = []
    this.pings.clear()
    this.recibioLoteDelRival = false
    this.lockstep = null
    this.guardados = []
    this.finMotor = null
    this.resRival = null
    this.sondeo = null
    this.esperaVigilada = -1
    this.redOk = null
    this.sinRedDesde = null
    this.finSondeo = -Infinity
    const k = this.k
    if (this.lado === 0) this.medirRtt()
    this.despues(ARRANQUE_MS, () => {
      if (this.fase === 'preparando' && this.k === k) this.cerrar('sin_conexion')
    })
    this.mandarEstado()
    this.avisar()
  }

  private medirRtt(): void {
    for (let i = 0; i < PINGS; i++) {
      this.despues(i * PING_CADA_MS, () => {
        if (this.fase !== 'preparando' || this.rtt !== null) return
        const id = ++this.sigPing
        this.pings.set(id, this.ahora())
        this.enviar({ t: 'ping', de: this.o.yo.id, i: id })
      })
    }
    this.despues(PING_ESPERA_MS, () => this.cerrarRtt())
  }

  private cerrarRtt(): void {
    if (this.rtt !== null || this.fase !== 'preparando') return
    this.rtt = this.rtts.length > 0 ? mediana(this.rtts) : RTT_SIN_DATOS
    this.intentarArrancar()
  }

  /** El lado 0 decide y arranca medio RTT después; el lado 1 arranca al recibir el «inicio». */
  private intentarArrancar(): void {
    if (this.fase !== 'preparando' || this.arranque || !this.listoPropio || !this.personajes) return
    if (this.lado === 0) {
      if (!this.listoRival || this.rtt === null) return
      const semilla = Math.floor(Math.abs(this.o.semilla ? this.o.semilla() : Math.random() * 0x7fffffff)) % 0x7fffffff
      this.arranque = { k: this.k, semilla, demora: demoraParaRtt(this.rtt), rtt: this.rtt, personajes: this.personajes }
      this.mandarEstado()
      const k = this.k
      this.avisar()
      this.despues(Math.max(0, Math.min(400, this.rtt / 2)), () => {
        if (this.fase === 'preparando' && this.k === k) this.aPeleando()
      })
    } else {
      const i = this.inicioDelRival
      if (!i) return
      if (i.pj[0] !== this.personajes[0] || i.pj[1] !== this.personajes[1]) {
        this.cerrar('error')
        return
      }
      this.arranque = { k: this.k, semilla: i.s, demora: i.d, rtt: 0, personajes: this.personajes }
      this.aPeleando()
    }
  }

  private aPeleando(): void {
    this.fase = 'peleando'
    this.mandarEstado()
    this.avisar()
  }

  private fijarResultado(
    ganador: Ganador,
    motivo: ResultadoDuelo['motivo'],
    fin: FinPeleaLocal | null,
    rondas?: [number, number],
  ): void {
    if (this.fase !== 'peleando') return
    this.lockstep?.cerrar()
    const yo = this.lado
    const el: Lado = yo === 0 ? 1 : 0
    this.resultado = {
      k: this.k,
      ganador,
      motivo,
      rondas: fin ? [fin.rondasPorLado[yo], fin.rondasPorLado[el]] : (rondas ?? [0, 0]),
      estadisticas: fin ? { ...fin.estadisticasPorLado[yo] } : null,
      duracionSeg: fin ? fin.duracionSeg : 0,
    }
    this.aplicarGanador(this.k, ganador)
    this.revanchaPropia = false
    this.revanchaRival = false
    this.fase = 'resultado'
    this.mandarEstado()
    // Si el resultado del otro llegó antes que el mío (yo seguía en el festejo), se concilian ya.
    this.conciliar()
    this.avisar()
  }

  private aRevancha(): void {
    if (this.fase !== 'resultado' || !this.rivalPresente) return
    this.k++
    this.resultado = null
    this.revanchaPropia = false
    this.revanchaRival = false
    this.fase = 'preparando'
    this.prepararArranque()
  }

  private cerrar(motivo: MotivoCierre): void {
    if (this.fase === 'cerrado') return
    this.lockstep?.cerrar()
    this.fase = 'cerrado'
    this.cierre = motivo
    this.limpiar()
    this.avisar()
  }

  private limpiar(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []
    if (this.intervalo !== null) clearInterval(this.intervalo)
    this.intervalo = null
    if (this.timerCola !== null) clearTimeout(this.timerCola)
    this.timerCola = null
  }

  // ─── Acciones de la UI ─────────────────────────────────────────────────────

  elegir(id: IdPersonaje): void {
    if (this.fase !== 'eligiendo' || this.confirmada || id === this.mia) return
    this.mia = id
    this.mandarEstado()
    this.avisar()
  }

  confirmar(): void {
    if (this.fase !== 'eligiendo' || this.confirmada) return
    this.confirmada = true
    this.mandarEstado()
    if (this.rivalConfirmo) this.aPreparando()
    else this.avisar()
  }

  /** Recursos cargados y VS visto. */
  marcarListo(): void {
    if (this.fase !== 'preparando' || this.listoPropio) return
    this.listoPropio = true
    this.mandarEstado()
    this.intentarArrancar()
    this.avisar()
  }

  /** La pantalla de pelea lo crea al montarse (una vez por pelea). */
  crearLockstep(tomarPropia: () => EntradaJugador): Lockstep | null {
    const a = this.arranque
    if (this.fase !== 'peleando' || !a) return null
    if (this.lockstep && this.lockstepK === a.k) {
      // La pantalla se volvió a montar (StrictMode): que lea SUS controles.
      this.lockstep.usarEntrada(tomarPropia)
      return this.lockstep
    }
    const k = a.k
    const de = this.o.yo.id
    const l = new Lockstep({
      lado: this.lado,
      demora: a.demora,
      tomarPropia,
      ahora: this.ahora,
      enviarLote: (lote: LoteEntradas) => this.enviarYa({ t: 'e', de, k, n: lote.n, b: lote.b, c: lote.c, h: lote.h }),
      pedir: (desde: number) => this.enviar({ t: 'pide', de, k, desde }),
    })
    this.lockstep = l
    this.lockstepK = k
    const guardados = this.guardados
    this.guardados = []
    for (const g of guardados) if (g.k === k) this.pasarAlLockstep(l, g.m)
    return l
  }

  /**
   * El motor llegó a 'terminada' (antes del festejo). Desde acá el resultado es ése: un adiós o
   * un «fin» que lleguen durante el festejo no lo cambian (antes, si el otro volvía a la sala
   * rápido, este celular se anotaba «¡Ganaste por abandono!» aunque hubiera perdido).
   */
  finDelMotor(fin: FinPeleaLocal): void {
    if (this.fase !== 'peleando' || this.finMotor) return
    this.finMotor = fin
  }

  /** La pelea terminó en la pantalla (fin_partida, después del festejo). */
  terminarPelea(fin: FinPeleaLocal): void {
    const f = this.finMotor ?? fin
    const g = f.ganadorLado
    this.fijarResultado(g === null ? null : g === this.lado ? 'yo' : 'rival', 'pelea', f)
  }

  /**
   * La pantalla lo llama en cada cuadro mientras lleva ABANDONO_MS esperando entradas del rival.
   * Gana el que queda, pero sólo si el que espera tiene red DE VERDAD (una ida y vuelta por el
   * socket, no el canal «unido»): el que lleva ABANDONO_MS sin red pierde, sin red no se reclama
   * nada, y recién reconectado espera RECONEXION_MS por si llega lo que el otro ya decidió.
   */
  abandonoDelRival(): void {
    if (this.fase !== 'peleando' || this.finMotor) return
    this.revisarConexion()
    this.vigilarRed()
    this.decidirAbandono(null)
  }

  /**
   * Con ABANDONO_MS de espera: ¿pierdo (el que no tiene red soy yo), gano (tengo red y el otro no
   * manda nada) o todavía no se sabe? `sondeo`: lo que acaba de contestar un sondeo de esta
   * espera; null = nada nuevo (si hace falta, sale uno y se decide cuando vuelva).
   */
  private decidirAbandono(sondeo: boolean | null): void {
    const l = this.lockstep
    if (this.fase !== 'peleando' || this.finMotor || !l || l.msEsperando() < ABANDONO_MS) return
    const t = this.ahora()
    // Sin red desde hace ABANDONO_MS (el canal caído o, con el canal unido, desde el primer sondeo
    // que falló): el que se fue es este celular. El otro, con red, reclama lo mismo.
    const caido = this.conectado ? null : this.conexionDesde
    const sinRed =
      caido === null ? this.sinRedDesde : this.sinRedDesde === null ? caido : Math.min(caido, this.sinRedDesde)
    if (sinRed !== null && t - sinRed >= ABANDONO_MS) {
      this.fijarResultado('rival', 'abandone', null)
      return
    }
    if (!this.conectado || t - this.conexionDesde < RECONEXION_MS) return
    const sondear = this.o.transporte.sondear
    if (!sondear || sondeo === true) {
      this.reclamarAbandono()
      return
    }
    // Sin un sondeo que diga que hay red AHORA no se reclama: sale uno y decide al volver.
    if (sondeo === null && !this.sondeo) {
      const pausa = this.redOk === false ? SONDEO_CADA_SIN_RED_MS : SONDEO_DECIDE_MS
      if (t - this.finSondeo >= pausa) this.sondearRed()
    }
  }

  /** Gana el que queda: se lo avisa al otro (si todavía está) y cierra la pelea. */
  private reclamarAbandono(): void {
    this.enviar({ t: 'fin', de: this.o.yo.id, k: this.k, m: 'abandono' })
    this.rivalPresente = false
    this.rivalSeFue = 'sin_conexion'
    this.fijarResultado('yo', 'abandono_rival', null)
  }

  /**
   * Mientras espera las entradas del rival: ¿el que no tiene red es este celular? Con el 4G
   * trabado sin que se cierre la conexión, el canal sigue «unido» y los dos celulares esperan lo
   * mismo: antes los dos reclamaban el abandono a los 10 s (la pelea quedaba anulada aunque sólo
   * uno hubiera perdido la red), el trabado veía «¡Ganaste por abandono!» y, si la traba duraba
   * más que el latido de realtime-js, los dos se anotaban la victoria. Cada espera del lockstep
   * tiene lo suyo: qué dijo el último sondeo (`redOk`, lo muestra la pantalla) y desde cuándo
   * falta la red (`sinRedDesde`, lo usa decidirAbandono). Lo llaman la pantalla en cada cuadro
   * (estaConectado, abandonoDelRival) y el latido de cada segundo.
   */
  private vigilarRed(): void {
    const l = this.lockstep
    if (this.fase !== 'peleando' || this.finMotor || !l || this.lockstepK !== this.k) return
    const espera = l.msEsperando()
    const id = l.stats.esperas
    if (espera === 0 || id !== this.esperaVigilada) {
      // Terminó la espera (o empezó otra): lo que se midió antes no cuenta.
      this.esperaVigilada = espera === 0 ? -1 : id
      this.redOk = null
      this.sinRedDesde = null
      this.finSondeo = -Infinity
      if (espera === 0) return
    }
    if (espera < SONDEO_DESDE_MS || !this.conectado || this.sondeo || !this.o.transporte.sondear) return
    const pausa = this.redOk === false ? SONDEO_CADA_SIN_RED_MS : SONDEO_CADA_MS
    if (this.ahora() - this.finSondeo >= pausa) this.sondearRed()
  }

  private sondearRed(): void {
    const sondear = this.o.transporte.sondear
    const l = this.lockstep
    if (!sondear || !l || this.sondeo) return
    const s: SondeoRed = { k: this.k, espera: l.stats.esperas, desde: this.ahora(), conexion: this.conexionDesde }
    this.sondeo = s
    let respuesta: Promise<boolean>
    try {
      respuesta = sondear.call(this.o.transporte)
    } catch {
      respuesta = Promise.resolve(false)
    }
    void respuesta.then(
      (ok) => this.alSondeo(s, ok),
      () => this.alSondeo(s, false),
    )
  }

  private alSondeo(s: SondeoRed, ok: boolean): void {
    if (this.sondeo === s) this.sondeo = null
    this.revisarConexion()
    const l = this.lockstep
    // De otra pelea, de otra espera, la espera ya terminó o el canal se cayó (o volvió) mientras
    // tanto: no dice nada de ahora (si no, un «sin red» de antes de reconectar contaba como de ahora).
    if (
      this.fase !== 'peleando' ||
      this.finMotor ||
      this.k !== s.k ||
      !l ||
      l.stats.esperas !== s.espera ||
      l.msEsperando() === 0 ||
      this.conexionDesde !== s.conexion
    ) {
      return
    }
    this.finSondeo = this.ahora()
    this.redOk = ok
    if (ok) this.sinRedDesde = null
    else if (this.sinRedDesde === null) this.sinRedDesde = s.desde
    // Llegó algo del rival mientras tanto: sigue ahí (si la espera no se resuelve sola, lo decide él).
    if (this.ultimoDelRival >= s.desde) return
    this.decidirAbandono(ok)
  }

  /**
   * Este celular tuvo la página oculta ABANDONO_MS o más en plena pelea (bloqueó la pantalla,
   * se fue a otra app): el que se fue es él. Lo que reclamó o va a reclamar el otro coincide.
   */
  rendirsePorAusencia(): void {
    if (this.fase !== 'peleando' || this.finMotor) return
    this.fijarResultado('rival', 'ausente', null)
  }

  /** Los hashes no coincidieron: la pelea no cuenta para nadie. */
  desincronizada(): void {
    if (this.fase !== 'peleando') return
    this.enviar({ t: 'fin', de: this.o.yo.id, k: this.k, m: 'desync' })
    this.fijarResultado(null, 'desync', null)
  }

  pedirRevancha(): void {
    if (this.fase !== 'resultado' || !this.rivalPresente || this.revanchaPropia) return
    this.revanchaPropia = true
    this.mandarEstado()
    if (this.revanchaRival) this.aRevancha()
    else this.avisar()
  }

  /**
   * Se va del duelo: abandona la pelea, lo llamaron a cortarse o vuelve a la sala. Si estaba
   * peleando, la pierde (el rival gana por abandono).
   */
  salir(motivo: MotivoAdios): void {
    if (this.fase === 'cerrado') return
    const adios: MensajePelea = { t: 'adios', de: this.o.yo.id, m: motivo }
    if (this.fase === 'peleando') {
      // En pleno festejo la pelea ya tiene resultado (el del motor): se fija y el otro lo recibe
      // antes que el adiós. Si no, la pierde el que se va.
      if (this.finMotor) this.terminarPelea(this.finMotor)
      else this.aplicarGanador(this.k, 'rival')
    }
    this.lockstep?.cerrar()
    if (this.resultado && this.resultado.k === this.k) {
      this.o.transporte.enviar(this.mensajeEstado())
      this.enviados++
    }
    // Dos veces, por las dudas: es lo único que el otro necesita saber.
    this.o.transporte.enviar(adios)
    this.enviados++
    const transporte = this.o.transporte
    setTimeout(() => {
      transporte.enviar(adios)
    }, 250)
    this.fase = 'cerrado'
    this.cierre = 'propio'
    this.limpiar()
    this.avisar()
  }

  destruir(): void {
    if (this.fase !== 'cerrado') {
      this.fase = 'cerrado'
      this.cierre = this.cierre ?? 'propio'
    }
    this.limpiar()
    const transporte = this.o.transporte
    // Un toque después: que salga el «adiós» si se acaba de mandar.
    setTimeout(() => transporte.cerrar(), 600)
    this.oyentes.clear()
  }
}
