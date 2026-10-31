'use client'

import {
  Check,
  Clock,
  Crosshair,
  Flame,
  LoaderCircle,
  RotateCcw,
  Share2,
  Sparkles,
  Swords,
  Timer,
  Trophy,
  UserX,
  Users,
  Zap,
} from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react'
import { guardarPartidaJuego } from '@/lib/actions/juego'
import { ARENAS } from '@/lib/juego/arenas'
import { idDispositivo, uuidNuevo } from '@/lib/juego/dispositivo'
import {
  APODO_ANONIMO,
  esRechazoPorApodo,
  esRechazoPorDatos,
  esRechazoPorTope,
  normalizarIdPartida,
  type PartidaAGuardar,
  type RespuestaGuardado,
} from '@/lib/juego/guardado'
import { encolarSiCorresponde, quitarPendiente, reintentarPendientes } from '@/lib/juego/pendientes'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { DatosEntradaJuego, EstadoTurnoJuego } from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { prefiereMenosMovimiento } from '@/lib/juego/ui/media'
import { guardarPreferencias, type PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import {
  APODO_MAX,
  formatearDuracion,
  formatearPuntos,
  porcentaje,
  sanearApodo,
} from '@/lib/juego/ui/textos'
import { alTocar } from '@/lib/juego/ui/toque'
import type { ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
import { useDesborde } from './capa'
import { ImagenJuego } from './imagen-juego'
import { ChipTurno } from './turno'

type ClaveStat = 'danio' | 'combo' | 'criticos' | 'especiales' | 'precision' | 'tiempo'

function IconoStat({ clave }: { clave: ClaveStat }) {
  switch (clave) {
    case 'danio':
      return <Flame aria-hidden="true" />
    case 'combo':
      return <Swords aria-hidden="true" />
    case 'criticos':
      return <Zap aria-hidden="true" />
    case 'especiales':
      return <Sparkles aria-hidden="true" />
    case 'precision':
      return <Crosshair aria-hidden="true" />
    case 'tiempo':
      return <Timer aria-hidden="true" />
  }
}

/** Partidas ya mandadas al ranking (StrictMode monta dos veces; una revancha rápida no duplica). */
const enviadas = new Set<string>()
/**
 * Peleas que salieron como «Anónimo» al irse de la pantalla, con clave: si vuelve (del ranking) y
 * confirma un apodo, se mandan de nuevo y el servidor se lo pone a esa misma fila.
 */
const anonimas = new Set<string>()
/**
 * Lo que pasó con cada envío y si ya se contó el puntaje: volver del ranking no repite nada. `envios`
 * se lee con useSyncExternalStore: una respuesta que llega después de ir al ranking y volver se ve
 * en la pantalla nueva (antes quedaba en la que ya se había desmontado, con «Guardar» muerto).
 */
const envios = new Map<string, Envio>()
const oyentesEnvios = new Set<() => void>()
const contados = new Set<string>()

function suscribirEnvios(oyente: () => void): () => void {
  oyentesEnvios.add(oyente)
  return () => {
    oyentesEnvios.delete(oyente)
  }
}

/** Anota cómo va el guardado de esa pelea y avisa a la pantalla que la muestra. */
function anotarEnvio(id: string, e: Envio) {
  envios.set(id, e)
  for (const oyente of oyentesEnvios) oyente()
}
/** La clave de las peleas cuyo id no es un UUID (sin `crypto.randomUUID`): una sola por pelea. */
const clavesPropias = new Map<string, string | null>()

type Envio =
  | { tipo: 'nada' }
  | { tipo: 'guardando' }
  | { tipo: 'listo'; apodo: string; puesto: number | null }
  /** El servidor la frenó por el tope: está en la cola de pendientes.ts y se guarda sola más tarde. */
  | { tipo: 'pendiente'; apodo: string }
  /** `reintentar`: si tiene sentido mandarla de nuevo igual (una falla de red o de la base; no un apodo ni datos rechazados). */
  | { tipo: 'error'; mensaje: string; reintentar: boolean }
  /** Salió como «Anónimo» al irse y no tiene clave: mandarla otra vez con un apodo la duplicaría. */
  | { tipo: 'anonima' }

/**
 * La clave de idempotencia de la pelea (guardado.ts): su id, que es un UUID (`crypto.randomUUID` en
 * pantalla-pelea.tsx); si no lo es, uno propio que se recuerda. Null sólo sin crypto.
 */
function claveDePelea(id: string): string | null {
  const directa = normalizarIdPartida(id)
  if (directa) return directa
  if (!clavesPropias.has(id)) clavesPropias.set(id, uuidNuevo())
  return clavesPropias.get(id) ?? null
}

function armarPartida(r: ResultadoPelea, datos: DatosEntradaJuego, apodo: string): PartidaAGuardar {
  const e = r.estadisticas
  return {
    token: datos.token,
    sucursalSlug: datos.sucursal?.slug ?? null,
    // Sin QR, el tope del guardado es por celular y no por el wifi del local (guardado.ts).
    dispositivo: idDispositivo(),
    // La misma en cada intento de esta pelea: el servidor no la guarda dos veces (mig 234).
    idPartida: claveDePelea(r.id),
    apodo,
    personaje: r.eleccion.jugador,
    rival: r.eleccion.rival,
    arena: r.eleccion.arena,
    dificultad: r.eleccion.dificultad,
    resultado: r.gano ? 'victoria' : 'derrota',
    rondasGanadas: r.rondas[0],
    rondasPerdidas: r.rondas[1],
    puntaje: Math.max(0, Math.round(r.desglose.total)),
    comboMax: e.comboMax,
    criticos: e.criticos,
    especiales: e.especialesAcertados,
    danioHecho: Math.round(e.danioHecho),
    danioRecibido: Math.round(e.danioRecibido),
    perfectos: e.rondasPerfectas,
    finalAlCero: e.finalAlCero,
    duracionSeg: r.duracionSeg,
  }
}

interface Props {
  resultado: ResultadoPelea
  datos: DatosEntradaJuego
  prefs: PreferenciasJuego
  audio: AudioSeguro
  turno: EstadoTurnoJuego | null
  onRevancha: () => void
  onCambiarBarbero: () => void
  onRanking: () => void
  onGuardado: (apodo: string, puntaje: number) => void
  /** El chip de la sala de la sucursal (si hay alguien más con el juego abierto). */
  sala?: ReactNode
}

export function PantallaResultado({
  resultado,
  datos,
  prefs,
  audio,
  turno,
  onRevancha,
  onCambiarBarbero,
  onRanking,
  onGuardado,
  sala,
}: Props) {
  const jugador = PERSONAJES[resultado.eleccion.jugador]
  /**
   * La CPU le dio el remate ¡AL CERO!: el retrato sale pelado (`rutas.rapado.retrato`), si el
   * barbero ya tiene sus sprites pelados; si no, el de siempre.
   */
  const retratoPelado =
    !resultado.gano && resultado.estadisticasRival.finalAlCero ? (jugador.rutas.rapado?.retrato ?? null) : null
  const rival = PERSONAJES[resultado.eleccion.rival]
  const arena = ARENAS[resultado.eleccion.arena]
  const { desglose, estadisticas: est, gano } = resultado
  const total = Math.max(0, Math.round(desglose.total))
  const rango = (desglose.rango || 'D').toUpperCase()
  const record = total > 0 && total > resultado.mejorAnterior
  const id = resultado.id

  // Con un apodo ya guardado de antes, la partida va sola al ranking.
  const [apodoAuto] = useState(() => (prefs.apodo.trim().length >= 2 ? prefs.apodo.trim() : null))
  const [apodo, setApodo] = useState(() => prefs.apodo || datos.cliente?.nombre || '')
  const [envioInicial] = useState<Envio>(() =>
    apodoAuto && !enviadas.has(resultado.id) ? { tipo: 'guardando' } : { tipo: 'nada' },
  )
  const envioAnotado = useSyncExternalStore(
    suscribirEnvios,
    () => envios.get(resultado.id),
    () => undefined,
  )
  const envio = envioAnotado ?? envioInicial
  const setEnvio = (e: Envio) => anotarEnvio(resultado.id, e)
  const [contado, setContado] = useState(() => contados.has(resultado.id))
  const [aviso, setAviso] = useState<string | null>(null)
  const numeroRef = useRef<HTMLSpanElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Sin desborde, el scroller va con touch-action: none (`data-sin-paneo`, juego.css): un pulgar
  // apoyado acá mientras otro dedo toca «Revancha» llega a la pelea con el touch-action de donde se
  // apoyó, y con pan-y su primer movimiento empezaba un paneo y dejaba muertos los controles.
  useDesborde(scrollRef)

  /** Lo que vuelve de un guardado de la pantalla. `r` null: el pedido tiró (sin conexión). */
  const terminarEnvio = (nombre: string, partida: PartidaAGuardar, r: RespuestaGuardado | null) => {
    if (r?.ok) {
      // Si otro intento de esta pelea había llegado primero, el servidor dice con qué apodo quedó.
      const guardadoComo = r.apodo ?? nombre
      anonimas.delete(resultado.id)
      // Una falla anterior pudo haberla dejado en la cola: ya no hace falta mandarla.
      quitarPendiente(resultado.id)
      if (nombre !== APODO_ANONIMO) guardarPreferencias({ apodo: nombre })
      setEnvio({ tipo: 'listo', apodo: guardadoComo, puesto: r.puesto })
      onGuardado(guardadoComo, total)
      // El servidor ya acepta a este celular: van las que habían quedado en la cola.
      void reintentarPendientes(guardarPartidaJuego)
    } else if (esRechazoPorTope(r)) {
      // Frenada ANTES de insertar (no se guardó nada): a la cola, que la manda sola cuando se
      // libere el cupo. El apodo ya pasó el filtro del servidor (se revisa antes que el tope).
      encolarSiCorresponde(resultado.id, partida, r)
      if (nombre !== APODO_ANONIMO) guardarPreferencias({ apodo: nombre })
      setEnvio({ tipo: 'pendiente', apodo: nombre })
    } else if (esRechazoPorApodo(r)) {
      // El filtro corre antes de tocar la base: no se guardó nada. Se libera la pelea: con otro
      // apodo sale de nuevo y, si se va sin guardar, como «Anónimo» (guardarAlSalir).
      enviadas.delete(resultado.id)
      setEnvio({ tipo: 'error', mensaje: r.error, reintentar: false })
    } else {
      // Red caída, un timeout o la base (pudo haberse guardado), o datos inválidos. Con clave, la
      // falla ambigua queda además en la cola: si se va sin reintentar, sale sola más tarde y el
      // servidor no la duplica. Sin clave, sólo a mano con «Reintentar».
      encolarSiCorresponde(resultado.id, partida, r)
      setEnvio({ tipo: 'error', mensaje: r?.error || 'Sin conexión', reintentar: !esRechazoPorDatos(r) })
    }
  }

  // Guardado automático (una sola vez por pelea). Sin «vivo»: si StrictMode desmonta y
  // vuelve a montar, la respuesta igual tiene que llegar al estado.
  const alTerminarEnvio = useEffectEvent(terminarEnvio)
  useEffect(() => {
    if (!apodoAuto || enviadas.has(resultado.id)) return
    enviadas.add(resultado.id)
    // Anotado (no sólo el estado inicial): si va al ranking y vuelve antes de la respuesta, ve esto.
    anotarEnvio(resultado.id, { tipo: 'guardando' })
    const partida = armarPartida(resultado, datos, apodoAuto)
    guardarPartidaJuego(partida)
      .then((r) => alTerminarEnvio(apodoAuto, partida, r))
      .catch(() => alTerminarEnvio(apodoAuto, partida, null))
  }, [resultado, datos, apodoAuto])

  // El puntaje cuenta hasta el total; después aparece el rango.
  useEffect(() => {
    const el = numeroRef.current
    if (!el) return
    if (prefiereMenosMovimiento() || total === 0 || contados.has(id)) {
      el.textContent = formatearPuntos(total)
      const t = window.setTimeout(() => {
        contados.add(id)
        setContado(true)
      }, 60)
      return () => window.clearTimeout(t)
    }
    el.textContent = '0'
    const duracion = Math.min(1800, Math.max(900, 600 + total / 6))
    let inicio = -1
    let ultimoTic = 0
    let raf = 0
    const paso = (t: number) => {
      if (inicio < 0) inicio = t
      const k = Math.min(1, (t - inicio) / duracion)
      const suave = 1 - Math.pow(1 - k, 3)
      el.textContent = formatearPuntos(total * suave)
      if (k < 1) {
        if (t - ultimoTic > 110) {
          ultimoTic = t
          audio.ui('puntos')
        }
        raf = requestAnimationFrame(paso)
      } else {
        contados.add(id)
        setContado(true)
      }
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [id, total, audio])

  useEffect(() => {
    if (!aviso) return
    const t = window.setTimeout(() => setAviso(null), 2600)
    return () => window.clearTimeout(t)
  }, [aviso])

  /**
   * Manda la pelea con ese apodo si no salió ya. Una que salió como «Anónimo» al irse (con clave)
   * sale de nuevo: el servidor le pone el apodo a esa misma fila.
   */
  const enviarManual = (nombre: string) => {
    if (enviadas.has(resultado.id) && !anonimas.has(resultado.id)) return
    anonimas.delete(resultado.id)
    enviadas.add(resultado.id)
    setEnvio({ tipo: 'guardando' })
    const partida = armarPartida(resultado, datos, nombre)
    guardarPartidaJuego(partida)
      .then((r) => terminarEnvio(nombre, partida, r))
      .catch(() => terminarEnvio(nombre, partida, null))
  }

  const reintentar = () => {
    // Con un pedido en vuelo no sale otro (dos toques antes de que se redibuje la pantalla).
    if (envios.get(resultado.id)?.tipo === 'guardando') return
    enviadas.delete(resultado.id)
    const nombre = sanearApodo(apodo).trim() || apodoAuto || APODO_ANONIMO
    enviarManual(nombre)
  }

  const alGuardar = (e: FormEvent) => {
    e.preventDefault()
    const nombre = sanearApodo(apodo).trim()
    if (nombre.length < 2) {
      audio.ui('error')
      setAviso('Poné un apodo de al menos 2 letras')
      return
    }
    audio.ui('confirmar')
    // Después de un error, «Guardar» (y Enter) hace lo mismo que «Reintentar», con el apodo que
    // está escrito (hasta el 31/oct no hacía nada y la partida se perdía).
    if (envio.tipo === 'error') reintentar()
    else enviarManual(nombre)
  }

  /**
   * Si se va sin tocar «Guardar» (o con el apodo rechazado por el servidor, que no guardó nada), la
   * pelea igual cuenta para las estadísticas, pero como «Anónimo»: el nombre precargado no se publica
   * en el ranking sin que lo confirme. Si ya salió (guardándose, guardada, en la cola o con una falla
   * que no dice si se guardó) no se manda nada más. La pantalla ya se va, pero la respuesta se mira
   * igual: si no se guardó y se puede reintentar sin duplicarla (el tope; una falla de red o de la
   * base, sólo con clave), queda en la cola (pendientes.ts); si se guardó, van las de la cola.
   */
  const guardarAlSalir = () => {
    if (enviadas.has(resultado.id)) return
    enviadas.add(resultado.id)
    const partida = armarPartida(resultado, datos, APODO_ANONIMO)
    // Con clave, si vuelve del ranking todavía puede ponerle su apodo; sin clave, no sale nada más.
    if (partida.idPartida) anonimas.add(resultado.id)
    else anotarEnvio(resultado.id, { tipo: 'anonima' })
    void guardarPartidaJuego(partida)
      .then((r) => {
        if (r.ok) void reintentarPendientes(guardarPartidaJuego)
        else encolarSiCorresponde(resultado.id, partida, r)
      })
      .catch(() => encolarSiCorresponde(resultado.id, partida, null))
  }

  const compartir = async () => {
    audio.ui('tocar')
    const puntos = formatearPuntos(total)
    const texto = gano
      ? `Le gané a ${rival.nombre} en Corte Final con ${puntos} puntos (rango ${rango}). ¿Me superás?`
      : `Hice ${puntos} puntos en Corte Final peleando con ${jugador.nombre}. ¿Me superás?`
    const url = `${window.location.origin}/juego${datos.sucursal ? `?s=${encodeURIComponent(datos.sucursal.slug)}` : ''}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Corte Final · Monaco', text: texto, url })
        return
      }
      await navigator.clipboard.writeText(`${texto} ${url}`)
      setAviso('Copiado: pegalo donde quieras')
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setAviso('No se pudo compartir')
    }
  }

  // «Guardar» es el submit del form: el click (mouse, teclado, el primer dedo) ya lo envía, así que del
  // helper van sólo los punteros, que piden el submit (por el form del botón) con un segundo dedo.
  const { onClick: _clickDelForm, ...segundoDedoGuardar } = alTocar((boton) =>
    (boton as HTMLButtonElement).form?.requestSubmit(),
  )

  const stats: { clave: ClaveStat; etiqueta: string; valor: string }[] = [
    { clave: 'danio', etiqueta: 'Daño hecho', valor: formatearPuntos(est.danioHecho) },
    { clave: 'combo', etiqueta: 'Combo máx.', valor: `${est.comboMax} ${est.comboMax === 1 ? 'golpe' : 'golpes'}` },
    { clave: 'criticos', etiqueta: 'Críticos', valor: String(est.criticos) },
    { clave: 'especiales', etiqueta: 'Especiales', valor: `${est.especialesAcertados}/${est.especialesUsados}` },
    // `porcentaje` topea en 100 (el motor ya cuenta un intento por golpe posible de cada ventana).
    { clave: 'precision', etiqueta: 'Precisión', valor: `${porcentaje(est.golpesAcertados, est.golpesIntentados)} %` },
    { clave: 'tiempo', etiqueta: 'Tiempo', valor: formatearDuracion(resultado.duracionSeg) },
  ]

  return (
    <section
      className="cf-pantalla cf-resultado"
      data-gano={gano ? '' : undefined}
      aria-label={gano ? 'Victoria' : 'Derrota'}
      style={{ '--cf-acento': jugador.color, '--cf-acento-2': jugador.colorSecundario } as CSSProperties}
    >
      <div className="cf-resultado__fondo" aria-hidden="true">
        <ImagenJuego src={arena.imagen} alt="" tipo="arena" />
      </div>
      <div className="cf-resultado__velo" aria-hidden="true" />
      <span className="cf-resultado__rayos" aria-hidden="true" />

      <div className="cf-resultado__scroll" ref={scrollRef} data-sin-paneo="">
        <header className="cf-resultado__cabeza">
          <ChipTurno turno={turno} />
          {sala}
        </header>

        <div className="cf-resultado__grilla">
          <div className="cf-resultado__heroe">
            <div className="cf-resultado__retrato">
              <ImagenJuego
                src={retratoPelado ?? jugador.rutas.retrato}
                alternativa={retratoPelado ? jugador.rutas.retrato : null}
                alt={retratoPelado ? `${jugador.nombre}, pelado al cero` : jugador.nombre}
                tipo="cuerpo"
                color={jugador.color}
                espejar
                prioridad
              />
            </div>
            <div className="cf-resultado__titular">
              <h1 className="cf-resultado__titulo">{gano ? 'Victoria' : 'Derrota'}</h1>
              <p className="cf-resultado__marcador">
                <b>{resultado.rondas[0]}</b>
                <span>–</span>
                <b>{resultado.rondas[1]}</b>
                <span className="cf-resultado__contra">
                  vs {rival.nombre}
                </span>
              </p>
            </div>
          </div>

          <div className="cf-resultado__panel">
            <div className="cf-puntaje">
              <div className="cf-rango" data-rango={rango} data-visible={contado ? '' : undefined} aria-label={`Rango ${rango}`}>
                <span>{rango}</span>
              </div>
              <div className="cf-puntaje__numero">
                <span className="cf-rotulo">Puntaje</span>
                <span className="cf-puntaje__valor" ref={numeroRef} aria-live="off" />
                {record && contado && (
                  <span className="cf-record">
                    <Trophy aria-hidden="true" />
                    Nuevo récord
                  </span>
                )}
              </div>
            </div>

            <div className="cf-apodo">
              {envio.tipo === 'listo' ? (
                <p className="cf-apodo__listo">
                  <Check aria-hidden="true" />
                  <span>
                    Guardado como <b>{envio.apodo}</b>
                    {envio.puesto ? (
                      <>
                        {' '}
                        · puesto <b>#{envio.puesto}</b>
                      </>
                    ) : null}
                  </span>
                </p>
              ) : envio.tipo === 'guardando' ? (
                <p className="cf-apodo__listo">
                  <LoaderCircle className="cf-girando" aria-hidden="true" />
                  <span>Guardando en el ranking…</span>
                </p>
              ) : envio.tipo === 'pendiente' ? (
                <p className="cf-apodo__listo" data-estado="pendiente">
                  <Clock aria-hidden="true" />
                  <span>
                    Se guarda como <b>{envio.apodo}</b> en unos minutos
                  </span>
                </p>
              ) : envio.tipo === 'anonima' ? (
                <p className="cf-apodo__listo">
                  <UserX aria-hidden="true" />
                  <span>Sin apodo: esta pelea no entra al ranking</span>
                </p>
              ) : (
                <form className="cf-apodo__form" onSubmit={alGuardar}>
                  <label htmlFor="cf-apodo" className="cf-rotulo">
                    Tu apodo para el ranking
                  </label>
                  <div className="cf-apodo__fila">
                    <input
                      id="cf-apodo"
                      className="cf-input"
                      value={apodo}
                      maxLength={APODO_MAX}
                      autoComplete="nickname"
                      autoCapitalize="characters"
                      enterKeyHint="done"
                      placeholder="Ej: El Facha"
                      onChange={(e) => setApodo(sanearApodo(e.target.value))}
                    />
                    {/* El click ya envía el form (y Enter también): del helper van sólo los
                        punteros, para el segundo dedo (ui/toque.ts). Un toque que además genere
                        click no manda dos: `enviadas` y el «guardando» lo frenan. */}
                    <button type="submit" className="cf-btn" {...segundoDedoGuardar}>
                      <span>Guardar</span>
                    </button>
                  </div>
                  {envio.tipo === 'error' && (
                    <p className="cf-apodo__error" role="alert">
                      {envio.mensaje.replace(/\.$/, '')}.
                      {envio.reintentar && (
                        <>
                          {' '}
                          <button type="button" className="cf-enlace" {...alTocar(reintentar)}>
                            Reintentar
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </form>
              )}
            </div>

            <dl className="cf-stats">
              {stats.map(({ clave, etiqueta, valor }) => (
                <div key={clave} className="cf-stat">
                  <IconoStat clave={clave} />
                  <dt>{etiqueta}</dt>
                  <dd>{valor}</dd>
                </div>
              ))}
            </dl>

            {desglose.partes.length > 0 && (
              <ul className="cf-desglose" aria-label="Cómo se armó el puntaje">
                {desglose.partes.map((parte, i) => (
                  <li key={`${parte.etiqueta}-${i}`} style={{ animationDelay: `${0.25 + i * 0.06}s` }}>
                    <span>{parte.etiqueta}</span>
                    <b>
                      {parte.puntos >= 0 ? '+' : ''}
                      {formatearPuntos(parte.puntos)}
                    </b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Con el pulgar todavía apoyado (en el stick de la pelea que terminó), Chrome no genera
          click para el segundo dedo: los botones van con alTocar (ui/toque.ts). */}
      <footer className="cf-resultado__acciones">
        <button
          type="button"
          className="cf-btn cf-btn--grande"
          {...alTocar(() => {
            guardarAlSalir()
            onRevancha()
          })}
        >
          <RotateCcw aria-hidden="true" />
          <span>Revancha</span>
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--sec"
          {...alTocar(() => {
            guardarAlSalir()
            onCambiarBarbero()
          })}
        >
          <Users aria-hidden="true" />
          <span>Cambiar barbero</span>
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--sec"
          {...alTocar(() => {
            guardarAlSalir()
            onRanking()
          })}
        >
          <Trophy aria-hidden="true" />
          <span>Ranking</span>
        </button>
        <button type="button" className="cf-btn cf-btn--sec" {...alTocar(() => void compartir())}>
          <Share2 aria-hidden="true" />
          <span>Compartir</span>
        </button>
      </footer>

      {aviso && (
        <div className="cf-toast" role="status">
          {aviso}
        </div>
      )}
    </section>
  )
}
