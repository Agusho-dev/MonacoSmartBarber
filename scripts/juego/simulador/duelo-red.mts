/**
 * Banco de red para las pruebas online con Node (duelo-corte.mts y duelo-sala.mts):
 *  - un reloj VIRTUAL que reemplaza setTimeout, setInterval, Date.now y performance.now: una
 *    pelea con 40 s de corte corre en un par de segundos y da igual siempre;
 *  - el realtime-js INSTALADO (el RealtimeClient de node_modules, con un WebSocket falso y el
 *    protocolo 1.0.0, que es JSON): los latidos, las reconexiones y los canales son los de verdad;
 *  - un servidor Phoenix de mentira: canales, broadcast (self: false), latidos y presencia, con el
 *    atraso entre nodos que se midió en producción para la presencia (al propio le vuelve enseguida);
 *  - por celular, una red con latencia que se puede TRABAR (retiene los frames en las dos
 *    direcciones sin cerrar el socket y los suelta en orden, como TCP: el 4G que se estanca) o
 *    CORTAR (cierra el socket y rechaza conexiones hasta que vuelve).
 * No es una prueba: lo importan las pruebas.
 */
import { createRequire } from 'node:module'
import type { RealtimeClientOptions, SupabaseClient } from '@supabase/supabase-js'

// ─── Reloj virtual ───────────────────────────────────────────────────────────

interface Tarea {
  t: number
  id: number
  fn: () => void
  cada: number
}

const BASE_FECHA = Date.UTC(2026, 9, 30, 21, 0, 0)

export class Reloj {
  t = 0
  /** Excepciones de los callbacks (una prueba las cuenta como falla). */
  readonly errores: unknown[] = []
  /**
   * Pedidos HTTP (fetch) que se intentaron: el juego nunca tiene que caer al POST por REST de
   * realtime-js (`send` con el canal sin unir o el socket cerrándose). Ninguno sale de verdad.
   */
  readonly pedidosHttp: string[] = []
  private montones: Tarea[] = []
  private activas = new Map<number, Tarea>()
  private sig = 1

  /** Reemplaza los temporizadores globales. Hay que llamarlo antes de crear nada. */
  instalar(): void {
    const g = globalThis as unknown as Record<string, unknown>
    g.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => this.programar(() => fn(...a), ms ?? 0, 0)
    g.setInterval = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) =>
      this.programar(() => fn(...a), ms ?? 0, Math.max(1, ms ?? 0))
    g.clearTimeout = (id: unknown) => {
      if (id !== undefined && id !== null) this.activas.delete(Number(id))
    }
    g.clearInterval = g.clearTimeout
    Date.now = () => BASE_FECHA + Math.floor(this.t)
    performance.now = () => this.t
    g.fetch = (url: unknown) => {
      this.pedidosHttp.push(String(url))
      return Promise.reject(new Error('sin HTTP en la prueba'))
    }
  }

  /** Descarta todo lo programado (entre un escenario y otro: lo del anterior no vuelve a correr). */
  limpiar(): void {
    this.activas.clear()
    this.montones = []
  }

  private programar(fn: () => void, ms: number, cada: number): number {
    const id = this.sig++
    const tarea: Tarea = { t: this.t + Math.max(0, Number(ms) || 0), id, fn, cada }
    this.activas.set(id, tarea)
    this.meter(tarea)
    return id
  }

  private meter(x: Tarea): void {
    const h = this.montones
    h.push(x)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.menor(h[p], h[i])) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }

  private sacar(): Tarea | undefined {
    const h = this.montones
    if (h.length === 0) return undefined
    const top = h[0]
    const ult = h.pop()!
    if (h.length > 0) {
      h[0] = ult
      let i = 0
      for (;;) {
        const a = 2 * i + 1
        const b = a + 1
        let m = i
        if (a < h.length && this.menor(h[a], h[m])) m = a
        if (b < h.length && this.menor(h[b], h[m])) m = b
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]
        i = m
      }
    }
    return top
  }

  private menor(a: Tarea, b: Tarea): boolean {
    return a.t < b.t || (a.t === b.t && a.id < b.id)
  }

  /** Corre todo lo programado hasta `hasta` (ms virtuales), con las promesas de por medio. */
  async correrHasta(hasta: number): Promise<void> {
    for (;;) {
      const top = this.montones[0]
      if (!top || top.t > hasta) break
      this.sacar()
      if (this.activas.get(top.id) !== top) continue
      this.t = top.t
      if (top.cada > 0) {
        top.t += top.cada
        this.meter(top)
      } else {
        this.activas.delete(top.id)
      }
      try {
        top.fn()
      } catch (e) {
        this.errores.push(e)
      }
      await vaciar()
    }
    this.t = Math.max(this.t, hasta)
    await vaciar()
  }

  /** Corre hasta que `cond()` dé true (revisa cada `paso` ms virtuales) o hasta `tope`. */
  async correrMientras(cond: () => boolean, tope: number, paso = 50): Promise<boolean> {
    while (this.t < tope) {
      if (cond()) return true
      await this.correrHasta(Math.min(tope, this.t + paso))
    }
    return cond()
  }
}

/** Deja correr las promesas pendientes (setImmediate no está reemplazado). */
function vaciar(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

// ─── realtime-js instalado ───────────────────────────────────────────────────

const requerir = createRequire(import.meta.url)
interface ModuloRealtime {
  RealtimeClient: new (url: string, opciones: RealtimeClientOptions) => SupabaseClient['realtime']
}
const { RealtimeClient } = requerir('@supabase/realtime-js') as ModuloRealtime
/** La versión instalada (para el informe). */
export const VERSION_REALTIME: string = (requerir('@supabase/realtime-js/package.json') as { version: string }).version

// ─── Red y servidor Phoenix de mentira ───────────────────────────────────────

export type ModoRed = 'normal' | 'trabado' | 'caido'

interface MsjPhoenix {
  topic: string
  event: string
  payload: Record<string, unknown>
  ref: string | null
  join_ref?: string | null
}

type EventoSocket = { tipo: 'abrir' } | { tipo: 'msj'; datos: string }

/** El WebSocket que le damos a realtime-js (`transport`). */
class SocketFalso {
  static red: Red | null = null
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readonly conexion: Conexion

  constructor(url: string) {
    if (!SocketFalso.red) throw new Error('sin red de prueba')
    this.conexion = SocketFalso.red.conectar(this, url)
  }

  send(datos: string): void {
    this.conexion.subir(datos)
  }

  close(code = 1000, reason = ''): void {
    this.conexion.cerrarDesdeCliente(code, reason)
  }
}

class Conexion {
  readonly cel: string
  readonly ws: SocketFalso
  private readonly red: Red
  viva = true
  /** Frames retenidos por la traba (en orden). */
  private subida: string[] = []
  private bajada: EventoSocket[] = []
  private ultimaSubida = 0
  private ultimaBajada = 0

  constructor(red: Red, cel: string, ws: SocketFalso) {
    this.red = red
    this.cel = cel
    this.ws = ws
  }

  private get modo(): ModoRed {
    return this.red.modoDe(this.cel)
  }

  /** Del celular al servidor. */
  subir(datos: string): void {
    if (!this.viva || this.ws.readyState !== 1) return
    if (this.modo === 'caido') return
    if (this.modo === 'trabado') {
      this.subida.push(datos)
      return
    }
    this.programarSubida(datos)
  }

  private programarSubida(datos: string): void {
    const t = Math.max(this.red.reloj.t + this.red.latencia(this.cel), this.ultimaSubida)
    this.ultimaSubida = t
    setTimeout(() => {
      if (this.viva) this.red.servidor.recibir(this, datos)
    }, t - this.red.reloj.t)
  }

  /** Del servidor al celular. */
  bajar(e: EventoSocket): void {
    if (!this.viva || this.modo === 'caido') return
    if (this.modo === 'trabado') {
      this.bajada.push(e)
      return
    }
    this.programarBajada(e)
  }

  private programarBajada(e: EventoSocket): void {
    const t = Math.max(this.red.reloj.t + this.red.latencia(this.cel), this.ultimaBajada)
    this.ultimaBajada = t
    setTimeout(() => {
      if (!this.viva) return
      if (e.tipo === 'abrir') {
        this.ws.readyState = 1
        this.ws.onopen?.()
      } else if (this.ws.readyState === 1) {
        this.ws.onmessage?.({ data: e.datos })
      }
    }, t - this.red.reloj.t)
  }

  /** Terminó la traba: sale todo lo retenido, en orden. */
  soltar(): void {
    for (const d of this.subida.splice(0)) this.programarSubida(d)
    for (const e of this.bajada.splice(0)) this.programarBajada(e)
  }

  /** La red se cayó: el socket se cierra (el celular se entera enseguida) y lo retenido se pierde. */
  caer(): void {
    if (!this.viva) return
    this.morir()
    setTimeout(() => {
      this.ws.readyState = 3
      this.ws.onclose?.({ code: 1006, reason: 'sin red' })
    }, 30)
  }

  /** El celular cierra (realtime-js: desconectar o «heartbeat timeout»). Lo retenido se pierde. */
  cerrarDesdeCliente(code: number, reason: string): void {
    if (!this.viva) {
      this.ws.readyState = 3
      return
    }
    const trabado = this.modo === 'trabado'
    this.morir()
    this.ws.readyState = 2
    this.red.cierresDeCliente.push({ cel: this.cel, t: this.red.reloj.t, reason })
    // Con la red trabada el cierre no se completa enseguida (el navegador espera y lo da por perdido).
    setTimeout(
      () => {
        this.ws.readyState = 3
        this.ws.onclose?.({ code: trabado ? 1006 : code, reason })
      },
      trabado ? 1000 : this.red.latencia(this.cel),
    )
  }

  private morir(): void {
    this.viva = false
    this.subida = []
    this.bajada = []
    this.red.servidor.olvidar(this)
  }
}

interface Presencia {
  conexion: Conexion
  ref: string
  meta: Record<string, unknown>
}

class ServidorPhoenix {
  private temas = new Map<string, Set<Conexion>>()
  /** Por tema y clave: la presencia de cada uno. */
  private presencias = new Map<string, Map<string, Presencia>>()
  private claves = new Map<Conexion, Map<string, string>>()
  private sigRef = 1
  /** Mensajes de broadcast que entregó (para medir el presupuesto). */
  broadcasts = 0
  private readonly red: Red

  constructor(red: Red) {
    this.red = red
  }

  recibir(c: Conexion, crudo: string): void {
    let m: MsjPhoenix
    try {
      m = JSON.parse(crudo) as MsjPhoenix
    } catch {
      return
    }
    switch (m.event) {
      case 'heartbeat':
        this.responder(c, m, {})
        break
      case 'phx_join': {
        let miembros = this.temas.get(m.topic)
        if (!miembros) {
          miembros = new Set()
          this.temas.set(m.topic, miembros)
        }
        miembros.add(c)
        const config = (m.payload?.config ?? {}) as { presence?: { key?: string; enabled?: boolean } }
        const clave = config.presence?.key || `anon-${this.sigRef++}`
        let deC = this.claves.get(c)
        if (!deC) {
          deC = new Map()
          this.claves.set(c, deC)
        }
        deC.set(m.topic, clave)
        this.responder(c, m, {})
        if (config.presence?.enabled) this.mandar(c, m.topic, 'presence_state', this.estadoPresencia(m.topic))
        break
      }
      case 'phx_leave':
        this.salir(c, m.topic)
        this.responder(c, m, {})
        break
      case 'broadcast': {
        const miembros = this.temas.get(m.topic)
        if (!miembros?.has(c)) break
        for (const otro of miembros) {
          if (otro === c) continue
          this.broadcasts++
          this.mandar(otro, m.topic, 'broadcast', m.payload)
        }
        break
      }
      case 'presence': {
        const p = m.payload as { event?: string; payload?: Record<string, unknown> }
        if (p.event === 'track') this.track(c, m.topic, p.payload ?? {})
        else if (p.event === 'untrack') this.untrack(c, m.topic)
        this.responder(c, m, {})
        break
      }
      default:
        if (m.ref) this.responder(c, m, {})
    }
  }

  private responder(c: Conexion, m: MsjPhoenix, response: Record<string, unknown>): void {
    const r: MsjPhoenix = { topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response }, ref: m.ref, join_ref: m.join_ref ?? null }
    c.bajar({ tipo: 'msj', datos: JSON.stringify(r) })
  }

  private mandar(c: Conexion, topic: string, event: string, payload: Record<string, unknown>, atraso = 0): void {
    const datos = JSON.stringify({ topic, event, payload, ref: null })
    if (atraso <= 0) c.bajar({ tipo: 'msj', datos })
    else setTimeout(() => c.bajar({ tipo: 'msj', datos }), atraso)
  }

  private estadoPresencia(topic: string): Record<string, unknown> {
    const r: Record<string, unknown> = {}
    for (const [clave, p] of this.presencias.get(topic) ?? []) r[clave] = { metas: [{ phx_ref: p.ref, ...p.meta }] }
    return r
  }

  /** Un cambio de presencia: al propio le vuelve enseguida; a los demás, con el atraso entre nodos. */
  private difundir(origen: Conexion, topic: string, diff: Record<string, unknown>): void {
    for (const c of this.temas.get(topic) ?? []) {
      this.mandar(c, topic, 'presence_diff', diff, c === origen ? 0 : this.red.atrasoPresencia)
    }
  }

  private track(c: Conexion, topic: string, meta: Record<string, unknown>): void {
    const clave = this.claves.get(c)?.get(topic)
    if (!clave) return
    let deTema = this.presencias.get(topic)
    if (!deTema) {
      deTema = new Map()
      this.presencias.set(topic, deTema)
    }
    const vieja = deTema.get(clave)
    const nueva: Presencia = { conexion: c, ref: `r${this.sigRef++}`, meta }
    deTema.set(clave, nueva)
    const leaves = vieja ? { [clave]: { metas: [{ phx_ref: vieja.ref, ...vieja.meta }] } } : {}
    this.difundir(c, topic, { joins: { [clave]: { metas: [{ phx_ref: nueva.ref, ...meta }] } }, leaves })
  }

  private untrack(c: Conexion, topic: string): void {
    const clave = this.claves.get(c)?.get(topic)
    const deTema = this.presencias.get(topic)
    const vieja = clave ? deTema?.get(clave) : undefined
    if (!clave || !deTema || !vieja || vieja.conexion !== c) return
    deTema.delete(clave)
    this.difundir(c, topic, { joins: {}, leaves: { [clave]: { metas: [{ phx_ref: vieja.ref, ...vieja.meta }] } } })
  }

  private salir(c: Conexion, topic: string): void {
    this.untrack(c, topic)
    this.temas.get(topic)?.delete(c)
    this.claves.get(c)?.delete(topic)
  }

  /** El socket murió: sale de todos los canales (los demás ven irse su presencia). */
  olvidar(c: Conexion): void {
    for (const topic of [...(this.claves.get(c)?.keys() ?? [])]) this.salir(c, topic)
    for (const miembros of this.temas.values()) miembros.delete(c)
    this.claves.delete(c)
  }
}

export interface OpcionesRed {
  /** Ida (un solo sentido) entre cada celular y el servidor, en ms. */
  latenciaMs?: number
  /** Cuánto tarda un cambio de presencia en llegarle a los OTROS (en producción, 0,3–2,8 s). */
  atrasoPresenciaMs?: number
}

/** Lo que el juego usa de un SupabaseClient (canales y el realtime de abajo). */
export type ClienteDePrueba = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'getChannels' | 'realtime'>

export class Red {
  readonly reloj: Reloj
  readonly servidor: ServidorPhoenix
  readonly atrasoPresencia: number
  private readonly latenciaBase: number
  private modos = new Map<string, ModoRed>()
  private latencias = new Map<string, number>()
  private conexiones = new Set<Conexion>()
  /** Cierres que pidió el celular (realtime-js), con el motivo («heartbeat timeout»…). */
  readonly cierresDeCliente: { cel: string; t: number; reason: string }[] = []

  constructor(reloj: Reloj, o: OpcionesRed = {}) {
    this.reloj = reloj
    this.latenciaBase = o.latenciaMs ?? 100
    this.atrasoPresencia = o.atrasoPresenciaMs ?? 2500
    this.servidor = new ServidorPhoenix(this)
    SocketFalso.red = this
  }

  latencia(cel: string): number {
    return this.latencias.get(cel) ?? this.latenciaBase
  }

  ponerLatencia(cel: string, ms: number): void {
    this.latencias.set(cel, ms)
  }

  modoDe(cel: string): ModoRed {
    return this.modos.get(cel) ?? 'normal'
  }

  /** Traba, corta o devuelve la red de un celular. */
  ponerModo(cel: string, modo: ModoRed): void {
    const antes = this.modoDe(cel)
    this.modos.set(cel, modo)
    const suyas = [...this.conexiones].filter((c) => c.cel === cel && c.viva)
    if (modo === 'caido') for (const c of suyas) c.caer()
    else if (modo === 'normal' && antes === 'trabado') for (const c of suyas) c.soltar()
  }

  conectar(ws: SocketFalso, url: string): Conexion {
    const cel = new URL(url.replace(/^ws/, 'http')).searchParams.get('cel') ?? '?'
    const c = new Conexion(this, cel, ws)
    this.conexiones.add(c)
    if (this.modoDe(cel) === 'caido') {
      c.viva = false
      setTimeout(() => {
        ws.readyState = 3
        ws.onerror?.({ type: 'error', message: 'sin red' })
        ws.onclose?.({ code: 1006, reason: 'sin red' })
      }, 200)
    } else {
      c.bajar({ tipo: 'abrir' })
    }
    return c
  }

  /** Un cliente de Supabase para el celular `cel`, con el realtime-js de verdad abajo. */
  crearCliente(cel: string, opciones: Partial<RealtimeClientOptions> = {}): ClienteDePrueba {
    const realtime = new RealtimeClient('ws://realtime.prueba/realtime/v1', {
      params: { apikey: 'prueba', cel },
      transport: SocketFalso as unknown as RealtimeClientOptions['transport'],
      vsn: '1.0.0',
      ...opciones,
    } as RealtimeClientOptions)
    const cliente = {
      realtime,
      channel: (topico: string, o?: Parameters<SupabaseClient['channel']>[1]) => realtime.channel(topico, o),
      removeChannel: (canal: Parameters<SupabaseClient['removeChannel']>[0]) => realtime.removeChannel(canal),
      getChannels: () => realtime.getChannels(),
    }
    return cliente as unknown as ClienteDePrueba
  }
}

// ─── Verificaciones ──────────────────────────────────────────────────────────

export class Verificador {
  fallas = 0
  ok = 0
  private readonly log: (l: string) => void

  constructor(log: (l: string) => void = console.log) {
    this.log = log
  }

  verificar(cond: boolean, texto: string): boolean {
    this.log(`${cond ? 'OK   ' : 'FALLA'} ${texto}`)
    if (cond) this.ok++
    else this.fallas++
    return cond
  }
}
