'use client'

import { ChevronRight, Crown, Swords, TriangleAlert } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { ORDEN_JEFES, type IdJefe } from '@/lib/juego/historia/jefes'
import { TEXTOS_JEFES } from '@/lib/juego/historia/textos'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { prefiereMenosMovimiento } from '@/lib/juego/ui/media'
import { alTocar } from '@/lib/juego/ui/toque'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { ImagenJuego } from '../imagen-juego'
import { TextoQueSeEscribe } from './comun'

/** Cuánto dura la alarma antes de que entre el Boss. */
const ALARMA_MS = 1700

/**
 * Antes de cada Boss: la alarma («¡Se acerca un Boss!», «¡Jefe final!» con Tony), el Boss que entra
 * grande con su nombre y su título, y lo que dice, letra por letra (un toque apura la línea; otro
 * pasa a la siguiente). En la última aparece «¡A pelear!». Mientras tanto ya bajan los atlas de la
 * pelea (la raíz los pidió al tocar «¡A pelear!» en la torre).
 */
export function PresentacionJefe({
  jefe,
  audio,
  onListo,
}: {
  jefe: IdJefe
  audio: AudioSeguro
  onListo: () => void
}) {
  const ficha = PERSONAJES[jefe]
  const textos = TEXTOS_JEFES[jefe]
  const numero = ORDEN_JEFES.indexOf(jefe) + 1
  const final = numero === ORDEN_JEFES.length
  const [fase, setFase] = useState<'alarma' | 'jefe'>(() => (prefiereMenosMovimiento() ? 'jefe' : 'alarma'))
  const [linea, setLinea] = useState(0)
  const [completa, setCompleta] = useState(false)
  const ultima = linea >= textos.antes.length - 1

  const entrar = () => {
    setFase('jefe')
    audio.ui('vs')
    vibrar([60, 40, 120])
  }
  const entrarSolo = useEffectEvent(entrar)

  useEffect(() => {
    if (fase !== 'alarma') return
    audio.ui('alarma')
    vibrar([90, 110, 90, 110, 90])
    const t = window.setTimeout(() => entrarSolo(), ALARMA_MS)
    return () => window.clearTimeout(t)
  }, [fase, audio])

  const tocar = () => {
    if (fase === 'alarma') {
      entrar()
      return
    }
    if (!completa) {
      setCompleta(true)
      return
    }
    if (ultima) {
      audio.ui('confirmar')
      onListo()
      return
    }
    audio.ui('tocar')
    setLinea((n) => n + 1)
    setCompleta(false)
  }

  return (
    <section
      className="cf-pantalla cf-hist cf-hist-jefe"
      data-fase={fase}
      data-final={final ? '' : undefined}
      aria-label={`${final ? 'Jefe final' : `Boss ${numero} de ${ORDEN_JEFES.length}`}: ${ficha.nombre}`}
      style={{ '--cf-acento': ficha.color, '--cf-acento-2': ficha.colorSecundario } as CSSProperties}
    >
      <button type="button" className="cf-hist-jefe__tocar" aria-label="Seguir" {...alTocar(tocar)} />

      {fase === 'alarma' ? (
        <div className="cf-hist-alarma" aria-live="assertive">
          <span className="cf-hist-alarma__franja" aria-hidden="true" />
          <span className="cf-hist-alarma__franja cf-hist-alarma__franja--abajo" aria-hidden="true" />
          <TriangleAlert className="cf-hist-alarma__icono" aria-hidden="true" />
          <p className="cf-titulo cf-hist-alarma__texto">{final ? '¡Jefe final!' : '¡Se acerca un Boss!'}</p>
          <p className="cf-hist-alarma__sub">{final ? 'La Máquina de Oro está en juego' : `Boss ${numero} de ${ORDEN_JEFES.length}`}</p>
        </div>
      ) : (
        <>
          <div className="cf-hist-jefe__aura" aria-hidden="true" />
          <div className="cf-hist-jefe__retrato" data-fijo={ficha.retratoFijo ? '' : undefined} aria-hidden="true">
            <ImagenJuego src={ficha.rutas.retrato} alt="" tipo="cuerpo" color={ficha.color} prioridad />
          </div>
          <div className="cf-hist-jefe__placa">
            <p className="cf-hist-jefe__numero">
              <Crown aria-hidden="true" />
              {final ? 'Jefe final' : `Boss ${numero} de ${ORDEN_JEFES.length}`}
            </p>
            <h1 className="cf-titulo cf-hist-jefe__nombre">{ficha.nombre}</h1>
            <p className="cf-hist-jefe__apodo">«{ficha.apodo}»</p>
            <p className="cf-hist-jefe__lema">{textos.titulo}</p>
          </div>
          <div className="cf-hist-dialogo" role="status">
            <p className="cf-hist-dialogo__quien">{ficha.nombre}</p>
            <p className="cf-hist-dialogo__texto">
              <TextoQueSeEscribe key={linea} texto={textos.antes[linea]} completo={completa} alTerminar={() => setCompleta(true)} />
            </p>
            <div className="cf-hist-dialogo__pie">
              {completa && ultima ? (
                <button type="button" className="cf-btn cf-hist-dialogo__pelear" {...alTocar(tocar)}>
                  <Swords aria-hidden="true" />
                  <span>¡A pelear!</span>
                </button>
              ) : (
                <span className="cf-hist-dialogo__seguir" aria-hidden="true">
                  Tocá para seguir
                  <ChevronRight />
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
