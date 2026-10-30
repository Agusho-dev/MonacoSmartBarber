/**
 * La sala de espera de una sucursal: `juego-sala:<slug>` en Supabase Realtime (canal público,
 * presencia + broadcast con `self: false`). Quién tiene el juego abierto en el local, en qué
 * anda (libre / eligiendo / peleando) y los desafíos entre ellos.
 *
 * Presupuesto (es la misma instancia de Realtime que el panel de los barberos, la TV y el
 * kiosko — Known Risk #9): la presencia se publica SÓLO al entrar, al cambiar de estado y al
 * salir, con TRACK_MIN_MS entre una y otra; los desafíos son unos pocos mensajes. Con la
 * pestaña oculta más de un minuto se sale de la sala (y el socket se cierra si no queda otro
 * canal); al volver a mostrarse, entra de nuevo.
 *
 * Límite de presencia POR CLIENTE de Supabase (medido el 30/oct/2026 con una sonda): 5
 * publicaciones en ~30 s; la sexta recibe «Client presence rate limit exceeded» y el servidor
 * CIERRA el canal (phx_close). Antes, dos duelos cortos seguidos lo pasaban: la sala de ese
 * jugador moría en silencio (no veía a nadie, nadie lo podía desafiar) y, al cerrarse el canal
 * de la pelea, removeChannel cortaba el socket porque no quedaba ningún canal. Por eso hay un
 * cupo propio (PRESENCIA_MAX en PRESENCIA_VENTANA_MS, siempre con el ÚLTIMO estado) y, si el
 * servidor igual cierra la sala, se vuelve a entrar después de un rato.
 *
 * Desafío: A manda «desafio» a B (con el id del canal de la pelea). B lo acepta sólo si A está
 * en la presencia de la sala y tiene la misma versión. Si A y B se desafían a la vez, manda el
 * del id menor (el otro lo acepta solo).
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Lado } from '../tipos'
import {
  type EstadoJugador,
  leerCancelar,
  leerDesafio,
  leerPresencia,
  leerRespuesta,
  type MotivoRechazo,
  type MsjDesafio,
  nuevoId,
  PREFIJO_SALA,
  sanearNombre,
  versionJuego,
} from './protocolo'

export const DESAFIO_MS = 15_000
/**
 * El que desafía lo da por vencido un rato DESPUÉS que el desafiado: el reloj del otro arranca
 * cuando le llega, y un «sí» del último segundo tiene que alcanzar a volver (en 4G la ida sola
 * puede pasar los 400 ms). Antes eran 800 ms y ese «sí» encontraba el desafío vencido.
 */
const MARGEN_VENCIDO_MS = 2000
const OCULTA_MS = 60_000
const TRACK_MIN_MS = 1500
/** El servidor admite 5 presencias por cliente en ~30 s: se usan 4 (una de margen para el untrack al cerrar). */
const PRESENCIA_VENTANA_MS = 31_000
const PRESENCIA_MAX = 4
/** El servidor cerró la sala: se vuelve a entrar después de esto (y el doble cada vez, hasta 1 min). */
const REUNIR_MS = 8000
const REUNIR_MAX_MS = 60_000
/** Un desafío de alguien que la presencia todavía no muestra: se espera un toque. */
const ESPERA_PRESENCIA_MS = 2500
const MAX_JUGADORES = 40

export interface JugadorSala {
  id: string
  nombre: string
  estado: EstadoJugador
  /** Misma versión del juego: se pueden desafiar. */
  compatible: boolean
}

export type EstadoSaliente = 'esperando' | MotivoRechazo | 'se_fue'

export interface DesafioEntrante {
  d: string
  p: string
  de: JugadorSala
  vence: number
}

export interface DesafioSaliente {
  d: string
  p: string
  a: JugadorSala
  vence: number
  estado: EstadoSaliente
}

export interface EstadoSala {
  conectada: boolean
  yo: { id: string; nombre: string; estado: EstadoJugador }
  /** Los demás, primero los libres. */
  otros: JugadorSala[]
  entrante: DesafioEntrante | null
  saliente: DesafioSaliente | null
  /** Llegó alguien para pelear (una vez por jugador). `n` cambia en cada llegada. */
  llegada: { n: number; nombre: string; cuantos: number } | null
  /** Aviso corto («Juan canceló el desafío»). */
  aviso: { n: number; texto: string } | null
}

export interface Emparejamiento {
  peleaId: string
  lado: Lado
  rival: { id: string; nombre: string }
}

export interface OpcionesSala {
  slug: string
  cliente: () => SupabaseClient
  ahora?: () => number
}

export interface OyentesSala {
  /** Se aceptó un desafío (propio o ajeno): arranca el duelo. */
  emparejar?: (e: Emparejamiento) => void
  /** El que desafió canceló justo cuando aceptábamos: el duelo que se armó se cierra. */
  cancelado?: (peleaId: string) => void
}

const ORDEN_ESTADO: Record<EstadoJugador, number> = { libre: 0, eligiendo: 1, peleando: 2 }

export class Sala {
  private readonly o: OpcionesSala
  private readonly ahora: () => number
  /** Se genera al conectar por primera vez (el constructor es puro: corre en el render). */
  private id = ''
  private canal: RealtimeChannel | null = null
  /**
   * El canal anterior todavía saliendo. realtime-js devuelve el MISMO canal si se pide otra vez
   * un tópico que no terminó de salir: unirse antes de que termine dejaría un canal muerto.
   */
  private saliendo: Promise<void> | null = null
  private unida = false
  private dejadaPorOculta = false
  /** Entre desconectar() y el próximo conectar(): no se hace nada. */
  private apagada = true
  private disponible = true
  private oyentesEventos = new Set<OyentesSala>()
  private timerOculta: ReturnType<typeof setTimeout> | null = null
  private timerUnir: ReturnType<typeof setTimeout> | null = null
  private timerTrack: ReturnType<typeof setTimeout> | null = null
  private ultimoTrack = -Infinity
  /** Cuándo salió cada una de las últimas presencias (para el cupo por cliente del servidor). */
  private publicadas: number[] = []
  /** Veces seguidas que el servidor cerró la sala (la espera para volver a entrar crece). */
  private cierresSeguidos = 0
  private unidaDesde = 0
  private estado: EstadoJugador = 'libre'
  private nombre = 'Jugador'
  private jugadores = new Map<string, JugadorSala>()
  private vistos = new Set<string>()
  private entrante: DesafioEntrante | null = null
  private saliente: DesafioSaliente | null = null
  private aceptados = new Map<string, string>()
  private pendientes: { m: MsjDesafio; hasta: number }[] = []
  private llegada: EstadoSala['llegada'] = null
  private nLlegada = 0
  private aviso: EstadoSala['aviso'] = null
  private nAviso = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private oyentes = new Set<() => void>()
  private foto: EstadoSala

  constructor(o: OpcionesSala) {
    this.o = o
    this.ahora = o.ahora ?? (() => Date.now())
    this.foto = this.armarFoto()
  }

  /** Para la UI: emparejamientos y cancelaciones. Devuelve cómo dejar de escuchar. */
  escuchar(oyentes: OyentesSala): () => void {
    this.oyentesEventos.add(oyentes)
    return () => {
      this.oyentesEventos.delete(oyentes)
    }
  }

  private emparejar(e: Emparejamiento): void {
    this.oyentesEventos.forEach((o) => o.emparejar?.(e))
  }

  /** ¿Puede recibir un desafío ahora? (no en un duelo, no con el «te toca» encima). */
  setDisponible(si: boolean): void {
    this.disponible = si
    if (!si && this.entrante) this.rechazar('no')
  }

  // ─── Lectura para React ────────────────────────────────────────────────────

  leer = (): EstadoSala => this.foto

  suscribir = (fn: () => void): (() => void) => {
    this.oyentes.add(fn)
    return () => {
      this.oyentes.delete(fn)
    }
  }

  private armarFoto(): EstadoSala {
    const otros = [...this.jugadores.values()].sort(
      (a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.nombre.localeCompare(b.nombre, 'es'),
    )
    return {
      conectada: this.unida,
      yo: { id: this.id, nombre: this.nombre, estado: this.estado },
      otros,
      entrante: this.entrante,
      saliente: this.saliente,
      llegada: this.llegada,
      aviso: this.aviso,
    }
  }

  private avisar(): void {
    this.foto = this.armarFoto()
    this.oyentes.forEach((f) => f())
  }

  private despues(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (!this.apagada) fn()
    }, ms)
    this.timers.add(t)
  }

  private avisoCorto(texto: string): void {
    this.aviso = { n: ++this.nAviso, texto }
  }

  // ─── Conexión ──────────────────────────────────────────────────────────────

  conectar(): void {
    if (!this.apagada) return
    this.apagada = false
    if (!this.id) this.id = nuevoId()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.alCambiarVisibilidad)
      window.addEventListener('pagehide', this.alOcultarPagina)
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.dejadaPorOculta = true
      return
    }
    // Un tick después: con StrictMode (o un remontaje) el efecto se desmonta y se vuelve a montar
    // en el acto, y un join → leave → join seguidos del mismo tópico dejan al último sin respuesta
    // del servidor hasta que realtime-js reintenta (≈10 s). Así el que se cancela no abre nada.
    this.timerUnir = setTimeout(() => {
      this.timerUnir = null
      this.unir()
    }, 0)
  }

  private unir(): void {
    if (this.canal || this.apagada) return
    if (this.saliendo) {
      const s = this.saliendo
      void s.finally(() => {
        if (this.saliendo === s) this.saliendo = null
        this.unir()
      })
      return
    }
    let cliente: SupabaseClient
    try {
      cliente = this.o.cliente()
    } catch (e) {
      console.error('[juego] sala: sin cliente de Realtime', e)
      return
    }
    const canal = cliente.channel(PREFIJO_SALA + this.o.slug, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    })
    this.canal = canal
    canal
      .on('presence', { event: 'sync' }, () => {
        if (this.canal === canal) this.leerPresencia()
      })
      .on('broadcast', { event: 'desafio' }, (msg: { payload?: unknown }) => {
        if (this.canal === canal) this.alDesafio(msg?.payload)
      })
      .on('broadcast', { event: 'respuesta' }, (msg: { payload?: unknown }) => {
        if (this.canal === canal) this.alRespuesta(msg?.payload)
      })
      .on('broadcast', { event: 'cancelar' }, (msg: { payload?: unknown }) => {
        if (this.canal === canal) this.alCancelar(msg?.payload)
      })
      .subscribe((estado) => {
        if (this.canal !== canal) return
        if (estado === 'SUBSCRIBED') {
          this.unida = true
          this.unidaDesde = this.ahora()
          // Cada (re)conexión es presencia nueva en el servidor: se vuelve a publicar.
          this.publicar(true)
        } else if (estado === 'CLOSED') {
          // Lo cerró el SERVIDOR (el nuestro llega con this.canal ya en null): el cupo de presencia
          // («Client presence rate limit exceeded») u otro límite. realtime-js ya lo sacó de su
          // lista y no reintenta: se vuelve a entrar después de un rato, con un canal nuevo. Si
          // venía de estar unida más de un minuto, el cierre es otro: la espera vuelve a ser corta.
          if (this.unida && this.ahora() - this.unidaDesde > REUNIR_MAX_MS) this.cierresSeguidos = 0
          this.soltarCanal()
          const espera = Math.min(REUNIR_MAX_MS, REUNIR_MS * 2 ** this.cierresSeguidos)
          this.cierresSeguidos++
          this.despues(espera, () => {
            if (!this.dejadaPorOculta) this.unir()
          })
        } else {
          // CHANNEL_ERROR / TIMED_OUT: realtime-js reintenta solo.
          this.unida = false
        }
        this.avisar()
      })
  }

  /** Lo local de estar en la sala (los demás, los desafíos a medio camino) se suelta. */
  private soltarCanal(): void {
    this.canal = null
    this.unida = false
    if (this.timerTrack !== null) clearTimeout(this.timerTrack)
    this.timerTrack = null
    this.jugadores.clear()
    if (this.entrante) this.entrante = null
    if (this.saliente?.estado === 'esperando') this.saliente = null
    this.pendientes = []
  }

  private dejar(): void {
    const canal = this.canal
    this.soltarCanal()
    if (canal) {
      let cliente: SupabaseClient | null = null
      try {
        cliente = this.o.cliente()
      } catch {
        cliente = null
      }
      // El «leave» ya borra la presencia en el servidor (los demás lo ven irse al toque). Sin
      // removeChannel: ése corta el socket si no queda otro canal, y volver a entrar enseguida
      // (StrictMode, volver a mostrar la pestaña) esperaría la reconexión con espera creciente.
      this.saliendo = canal.unsubscribe().then(
        () => this.cortarSocketSiSobra(cliente),
        () => this.cortarSocketSiSobra(cliente),
      )
    }
    this.avisar()
  }

  /** Si de verdad se dejó la sala (oculta o desmontada) y no queda ningún canal: no gastar una conexión. */
  private cortarSocketSiSobra(cliente: SupabaseClient | null): void {
    if (!cliente || this.canal || !(this.apagada || this.dejadaPorOculta)) return
    try {
      if (cliente.getChannels().length === 0) cliente.realtime.disconnect()
    } catch {
      // Si no se puede cortar, queda abierta: no es grave.
    }
  }

  private alCambiarVisibilidad = (): void => {
    if (document.visibilityState === 'hidden') {
      if (this.timerOculta === null) {
        this.timerOculta = setTimeout(() => {
          this.timerOculta = null
          if (document.visibilityState === 'hidden' && this.canal) {
            this.dejadaPorOculta = true
            this.dejar()
          }
        }, OCULTA_MS)
      }
    } else {
      if (this.timerOculta !== null) clearTimeout(this.timerOculta)
      this.timerOculta = null
      if (this.dejadaPorOculta) {
        this.dejadaPorOculta = false
        this.unir()
      }
    }
  }

  /** Se cierra la página: que los demás lo vean irse ya (si llega a salir). */
  private alOcultarPagina = (e: PageTransitionEvent): void => {
    if (e.persisted) return
    if (this.canal) void this.canal.untrack().catch(() => {})
  }

  /** Sale de la sala y suelta todo. Se puede volver a conectar() (StrictMode monta dos veces). */
  desconectar(): void {
    if (this.apagada) return
    if (this.timerUnir !== null) clearTimeout(this.timerUnir)
    this.timerUnir = null
    this.dejar()
    this.apagada = true
    this.dejadaPorOculta = false
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.alCambiarVisibilidad)
      window.removeEventListener('pagehide', this.alOcultarPagina)
    }
    if (this.timerOculta !== null) clearTimeout(this.timerOculta)
    this.timerOculta = null
    this.timers.forEach((t) => clearTimeout(t))
    this.timers.clear()
  }

  // ─── Presencia ─────────────────────────────────────────────────────────────

  /**
   * Publica la presencia (siempre la ÚLTIMA: nombre y estado se leen al salir). TRACK_MIN_MS entre
   * una y otra salvo `inmediato`, y NUNCA más de PRESENCIA_MAX en PRESENCIA_VENTANA_MS (ni
   * `inmediato`): pasarse hace que el servidor cierre la sala.
   */
  private publicar(inmediato = false): void {
    const canal = this.canal
    if (!canal || !this.unida) return
    const t = this.ahora()
    this.publicadas = this.publicadas.filter((x) => t - x < PRESENCIA_VENTANA_MS)
    let falta = inmediato ? 0 : TRACK_MIN_MS - (t - this.ultimoTrack)
    if (this.publicadas.length >= PRESENCIA_MAX) falta = Math.max(falta, this.publicadas[0] + PRESENCIA_VENTANA_MS - t)
    if (falta > 0) {
      if (this.timerTrack === null) {
        this.timerTrack = setTimeout(() => {
          this.timerTrack = null
          this.publicar(true)
        }, falta)
      }
      return
    }
    if (this.timerTrack !== null) clearTimeout(this.timerTrack)
    this.timerTrack = null
    this.ultimoTrack = t
    this.publicadas.push(t)
    void canal.track({ id: this.id, n: this.nombre, e: this.estado, v: versionJuego() }).catch(() => {})
  }

  /** libre / eligiendo / peleando: se publica sólo si cambia. */
  setEstado(e: EstadoJugador): void {
    if (this.estado === e) return
    this.estado = e
    this.publicar()
    this.avisar()
  }

  setNombre(crudo: string): void {
    const n = sanearNombre(crudo)
    if (!n || n === this.nombre) return
    this.nombre = n
    this.publicar()
    this.avisar()
  }

  private leerPresencia(): void {
    const canal = this.canal
    if (!canal) return
    const estado = canal.presenceState() as Record<string, unknown[]>
    const nuevos = new Map<string, JugadorSala>()
    const miVersion = versionJuego()
    for (const [clave, metas] of Object.entries(estado)) {
      if (nuevos.size >= MAX_JUGADORES) break
      if (clave === this.id || !Array.isArray(metas) || metas.length === 0) continue
      const p = leerPresencia(metas[metas.length - 1])
      if (!p || p.id !== clave) continue
      nuevos.set(p.id, { id: p.id, nombre: p.n, estado: p.e, compatible: p.v === miVersion })
    }

    // Llegadas: una vez por jugador nuevo que viene a pelear.
    const llegaron: JugadorSala[] = []
    for (const j of nuevos.values()) {
      if (this.vistos.has(j.id)) continue
      this.vistos.add(j.id)
      if (j.compatible && j.estado === 'libre') llegaron.push(j)
    }
    if (llegaron.length > 0) {
      const cuantos = [...nuevos.values()].filter((j) => j.compatible && j.estado === 'libre').length
      this.llegada = { n: ++this.nLlegada, nombre: llegaron[0].nombre, cuantos }
    }

    // Se fueron: los desafíos con ellos se caen.
    if (this.entrante && !nuevos.has(this.entrante.de.id)) {
      this.avisoCorto(`${this.entrante.de.nombre} se fue de la sala`)
      this.entrante = null
    }
    if (this.saliente && this.saliente.estado === 'esperando' && !nuevos.has(this.saliente.a.id)) {
      this.saliente = { ...this.saliente, estado: 'se_fue' }
      this.limpiarSalienteLuego(this.saliente.d)
    }
    this.jugadores = nuevos

    // Desafíos que llegaron antes que la presencia del que los mandó.
    const t = this.ahora()
    const pendientes = this.pendientes
    this.pendientes = []
    for (const p of pendientes) {
      if (nuevos.has(p.m.de)) this.alDesafio(p.m)
      else if (p.hasta > t) this.pendientes.push(p)
    }
    this.avisar()
  }

  // ─── Desafíos ──────────────────────────────────────────────────────────────

  private mandar(evento: 'desafio' | 'respuesta' | 'cancelar', payload: Record<string, unknown>): void {
    const canal = this.canal
    if (!canal || !this.unida) return
    void canal.send({ type: 'broadcast', event: evento, payload }).catch(() => {})
  }

  private responder(m: MsjDesafio, ok: boolean, motivo: MotivoRechazo | null): void {
    this.mandar('respuesta', { de: this.id, a: m.de, d: m.d, ok, m: motivo })
  }

  private limpiarSalienteLuego(d: string): void {
    this.despues(3200, () => {
      if (this.saliente?.d === d && this.saliente.estado !== 'esperando') {
        this.saliente = null
        this.avisar()
      }
    })
  }

  desafiar(id: string): void {
    const j = this.jugadores.get(id)
    if (!j || !j.compatible || j.estado !== 'libre' || !this.unida) return
    if (this.saliente?.estado === 'esperando' || this.entrante) return
    const d = nuevoId()
    const p = nuevoId()
    this.saliente = { d, p, a: j, vence: this.ahora() + DESAFIO_MS, estado: 'esperando' }
    this.mandar('desafio', { de: this.id, a: id, d, p, v: versionJuego() })
    this.despues(DESAFIO_MS + MARGEN_VENCIDO_MS, () => {
      if (this.saliente?.d === d && this.saliente.estado === 'esperando') {
        this.saliente = { ...this.saliente, estado: 'vencido' }
        this.limpiarSalienteLuego(d)
        this.avisar()
      }
    })
    this.avisar()
  }

  cancelarDesafio(): void {
    const s = this.saliente
    if (!s) return
    if (s.estado === 'esperando') this.mandar('cancelar', { de: this.id, a: s.a.id, d: s.d })
    this.saliente = null
    this.avisar()
  }

  aceptar(): void {
    const e = this.entrante
    if (!e) return
    if (!this.unida) {
      // Sin la sala unida el «sí» no saldría y el otro nunca entraría al duelo: se reintenta.
      this.avisoCorto('Sin conexión con la sala. Probá de nuevo.')
      this.avisar()
      return
    }
    this.entrante = null
    this.mandar('respuesta', { de: this.id, a: e.de.id, d: e.d, ok: true, m: null })
    this.aceptados.set(e.d, e.p)
    this.despues(DESAFIO_MS * 2, () => this.aceptados.delete(e.d))
    this.avisar()
    this.emparejar({ peleaId: e.p, lado: 1, rival: { id: e.de.id, nombre: e.de.nombre } })
  }

  rechazar(motivo: 'no' | 'vencido' = 'no'): void {
    const e = this.entrante
    if (!e) return
    this.entrante = null
    this.mandar('respuesta', { de: this.id, a: e.de.id, d: e.d, ok: false, m: motivo })
    this.avisar()
  }

  descartarLlegada(): void {
    if (!this.llegada) return
    this.llegada = null
    this.avisar()
  }

  descartarAviso(): void {
    if (!this.aviso) return
    this.aviso = null
    this.avisar()
  }

  private alDesafio(crudo: unknown): void {
    const m = leerDesafio(crudo)
    if (!m || m.a !== this.id) return
    const de = this.jugadores.get(m.de)
    if (!de) {
      // Sólo se acepta de alguien que está en la sala: si la presencia viene atrasada, se espera un toque.
      if (this.pendientes.length < 5) this.pendientes.push({ m, hasta: this.ahora() + ESPERA_PRESENCIA_MS })
      return
    }
    if (m.v !== versionJuego()) {
      this.responder(m, false, 'version')
      return
    }
    const s = this.saliente
    if (s && s.estado === 'esperando' && s.a.id === m.de) {
      // Se desafiaron a la vez: manda el del id menor.
      if (this.id < m.de) return
      this.saliente = null
      this.responder(m, true, null)
      this.aceptados.set(m.d, m.p)
      this.avisar()
      this.emparejar({ peleaId: m.p, lado: 1, rival: { id: de.id, nombre: de.nombre } })
      return
    }
    if (!this.disponible || this.entrante || (s && s.estado === 'esperando')) {
      this.responder(m, false, 'ocupado')
      return
    }
    const d = m.d
    this.entrante = { d, p: m.p, de, vence: this.ahora() + DESAFIO_MS }
    this.despues(DESAFIO_MS, () => {
      if (this.entrante?.d === d) this.rechazar('vencido')
    })
    this.avisar()
  }

  private alRespuesta(crudo: unknown): void {
    const m = leerRespuesta(crudo)
    if (!m || m.a !== this.id) return
    const s = this.saliente
    if (!s || s.d !== m.d || s.a.id !== m.de || s.estado !== 'esperando') {
      // Un «sí» a un desafío que ya no está (lo cancelé o venció): que no se quede esperando.
      if (m.ok) this.mandar('cancelar', { de: this.id, a: m.de, d: m.d })
      return
    }
    if (m.ok) {
      this.saliente = null
      this.avisar()
      this.emparejar({ peleaId: s.p, lado: 0, rival: { id: s.a.id, nombre: s.a.nombre } })
      return
    }
    this.saliente = { ...s, estado: m.m ?? 'no' }
    this.limpiarSalienteLuego(s.d)
    this.avisar()
  }

  private alCancelar(crudo: unknown): void {
    const m = leerCancelar(crudo)
    if (!m || m.a !== this.id) return
    if (this.entrante && this.entrante.d === m.d && this.entrante.de.id === m.de) {
      this.avisoCorto(`${this.entrante.de.nombre} canceló el desafío`)
      this.entrante = null
      this.avisar()
    }
    const p = this.aceptados.get(m.d)
    if (p) {
      this.aceptados.delete(m.d)
      this.oyentesEventos.forEach((o) => o.cancelado?.(p))
    }
  }
}
