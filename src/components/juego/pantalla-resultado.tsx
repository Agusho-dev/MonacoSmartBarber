'use client'

import {
  Check,
  Crosshair,
  Flame,
  LoaderCircle,
  RotateCcw,
  Share2,
  Sparkles,
  Swords,
  Timer,
  Trophy,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { guardarPartidaJuego } from '@/lib/actions/juego'
import { ARENAS } from '@/lib/juego/arenas'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { DatosEntradaJuego, EstadoTurnoJuego, PartidaParaGuardar } from '@/lib/juego/tipos'
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
import type { ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
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
/** Lo que pasó con cada envío y si ya se contó el puntaje: volver del ranking no repite nada. */
const envios = new Map<string, Envio>()
const contados = new Set<string>()

type Envio =
  | { tipo: 'nada' }
  | { tipo: 'guardando' }
  | { tipo: 'listo'; apodo: string; puesto: number | null }
  | { tipo: 'error'; mensaje: string }

function armarPartida(r: ResultadoPelea, datos: DatosEntradaJuego, apodo: string): PartidaParaGuardar {
  const e = r.estadisticas
  return {
    token: datos.token,
    sucursalSlug: datos.sucursal?.slug ?? null,
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
}: Props) {
  const jugador = PERSONAJES[resultado.eleccion.jugador]
  /** La CPU le dio el remate ¡AL CERO!: el retrato sale pelado (public/juego/personajes/<id>/retrato_rapado.webp). */
  const peladoAlCero = !resultado.gano && resultado.estadisticasRival.finalAlCero
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
  const [envio, setEnvioLocal] = useState<Envio>(
    () =>
      envios.get(resultado.id) ??
      (apodoAuto && !enviadas.has(resultado.id) ? { tipo: 'guardando' } : { tipo: 'nada' }),
  )
  const setEnvio = (e: Envio) => {
    envios.set(resultado.id, e)
    setEnvioLocal(e)
  }
  const [contado, setContado] = useState(() => contados.has(resultado.id))
  const [aviso, setAviso] = useState<string | null>(null)
  const numeroRef = useRef<HTMLSpanElement>(null)

  const terminarEnvio = (nombre: string, r: Awaited<ReturnType<typeof guardarPartidaJuego>>) => {
    if (r.ok) {
      guardarPreferencias({ apodo: nombre })
      setEnvio({ tipo: 'listo', apodo: nombre, puesto: r.puesto })
      onGuardado(nombre, total)
    } else {
      setEnvio({ tipo: 'error', mensaje: r.error || 'No se pudo guardar' })
    }
  }

  // Guardado automático (una sola vez por pelea). Sin «vivo»: si StrictMode desmonta y
  // vuelve a montar, la respuesta igual tiene que llegar al estado.
  const alTerminarEnvio = useEffectEvent(terminarEnvio)
  useEffect(() => {
    if (!apodoAuto || enviadas.has(resultado.id)) return
    enviadas.add(resultado.id)
    guardarPartidaJuego(armarPartida(resultado, datos, apodoAuto))
      .then((r) => alTerminarEnvio(apodoAuto, r))
      .catch(() => alTerminarEnvio(apodoAuto, { ok: false, error: 'Sin conexión' }))
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

  const enviarManual = (nombre: string) => {
    if (enviadas.has(resultado.id)) return
    enviadas.add(resultado.id)
    setEnvio({ tipo: 'guardando' })
    guardarPartidaJuego(armarPartida(resultado, datos, nombre))
      .then((r) => terminarEnvio(nombre, r))
      .catch(() => setEnvio({ tipo: 'error', mensaje: 'Sin conexión' }))
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
    enviarManual(nombre)
  }

  const reintentar = () => {
    enviadas.delete(resultado.id)
    const nombre = sanearApodo(apodo).trim() || apodoAuto || 'Anónimo'
    enviarManual(nombre)
  }

  /**
   * Si se va sin tocar «Guardar», la pelea igual cuenta para las estadísticas, pero como
   * «Anónimo»: el nombre precargado no se publica en el ranking sin que lo confirme.
   */
  const guardarAlSalir = () => {
    if (enviadas.has(resultado.id)) return
    enviadas.add(resultado.id)
    void guardarPartidaJuego(armarPartida(resultado, datos, 'Anónimo')).catch(() => {})
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

  const stats: { clave: ClaveStat; etiqueta: string; valor: string }[] = [
    { clave: 'danio', etiqueta: 'Daño hecho', valor: formatearPuntos(est.danioHecho) },
    { clave: 'combo', etiqueta: 'Combo máx.', valor: `${est.comboMax} ${est.comboMax === 1 ? 'golpe' : 'golpes'}` },
    { clave: 'criticos', etiqueta: 'Críticos', valor: String(est.criticos) },
    { clave: 'especiales', etiqueta: 'Especiales', valor: `${est.especialesAcertados}/${est.especialesUsados}` },
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

      <div className="cf-resultado__scroll">
        <header className="cf-resultado__cabeza">
          <ChipTurno turno={turno} />
        </header>

        <div className="cf-resultado__grilla">
          <div className="cf-resultado__heroe">
            <div className="cf-resultado__retrato">
              <ImagenJuego
                src={peladoAlCero ? jugador.rutas.retrato.replace(/retrato\.webp$/, 'retrato_rapado.webp') : jugador.rutas.retrato}
                alt={peladoAlCero ? `${jugador.nombre}, pelado al cero` : jugador.nombre}
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
                    <button type="submit" className="cf-btn">
                      <span>Guardar</span>
                    </button>
                  </div>
                  {envio.tipo === 'error' && (
                    <p className="cf-apodo__error" role="alert">
                      {envio.mensaje.replace(/\.$/, '')}.{' '}
                      <button type="button" className="cf-enlace" onClick={reintentar}>
                        Reintentar
                      </button>
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

      <footer className="cf-resultado__acciones">
        <button
          type="button"
          className="cf-btn cf-btn--grande"
          onClick={() => {
            guardarAlSalir()
            onRevancha()
          }}
        >
          <RotateCcw aria-hidden="true" />
          <span>Revancha</span>
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--sec"
          onClick={() => {
            guardarAlSalir()
            onCambiarBarbero()
          }}
        >
          <Users aria-hidden="true" />
          <span>Cambiar barbero</span>
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--sec"
          onClick={() => {
            guardarAlSalir()
            onRanking()
          }}
        >
          <Trophy aria-hidden="true" />
          <span>Ranking</span>
        </button>
        <button type="button" className="cf-btn cf-btn--sec" onClick={compartir}>
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
