'use client'

import { CircleHelp, Trophy, Volume2, VolumeX } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { IDS_PERSONAJES, PERSONAJES } from '@/lib/juego/personajes'
import type { DatosEntradaJuego, EstadoTurnoJuego } from '@/lib/juego/tipos'
import type { PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import { ImagenJuego } from './imagen-juego'
import { LogoCorteFinal } from './logo-corte-final'
import { ChipTurno } from './turno'

interface Props {
  datos: DatosEntradaJuego
  turno: EstadoTurnoJuego | null
  prefs: PreferenciasJuego
  onJugar: () => void
  onRanking: () => void
  onComoSeJuega: () => void
  onSonido: () => void
}

/** El logo de Monaco, transparente (sale de public/logo-monaco.png; 720×199). */
const LOGO_MONACO = { src: '/juego/logo-monaco.webp', ancho: 720, alto: 199 } as const

export function PantallaInicio({ datos, turno, prefs, onJugar, onRanking, onComoSeJuega, onSonido }: Props) {
  const arena = ARENAS[datos.arenaInicial]
  const jugar = useEffectEvent(onJugar)
  const [sinLogo, setSinLogo] = useState(false)

  // En la compu: Enter o espacio también arrancan.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.repeat || (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter')) return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'BUTTON' || t.tagName === 'INPUT')) return
      e.preventDefault()
      jugar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [])
  const [izquierda, derecha] = [PERSONAJES[IDS_PERSONAJES[0]], PERSONAJES[IDS_PERSONAJES[1] ?? IDS_PERSONAJES[0]]]

  return (
    <section className="cf-pantalla cf-inicio" aria-label="Corte Final">
      <div className="cf-inicio__fondo" aria-hidden="true">
        <ImagenJuego src={arena.imagen} alt="" tipo="arena" prioridad />
      </div>
      <div className="cf-inicio__velo" aria-hidden="true" />
      <div className="cf-inicio__haces" aria-hidden="true">
        <span />
        <span />
      </div>

      <div
        className="cf-inicio__luchador cf-inicio__luchador--izq"
        style={{ '--cf-acento': izquierda.color } as CSSProperties}
        aria-hidden="true"
      >
        <ImagenJuego src={izquierda.rutas.retrato} alt="" tipo="cuerpo" color={izquierda.color} espejar prioridad />
      </div>
      <div
        className="cf-inicio__luchador cf-inicio__luchador--der"
        style={{ '--cf-acento': derecha.color } as CSSProperties}
        aria-hidden="true"
      >
        <ImagenJuego src={derecha.rutas.retrato} alt="" tipo="cuerpo" color={derecha.color} prioridad />
      </div>

      {/* Toda la pantalla es el botón de jugar; la barra de abajo va por encima. */}
      <button type="button" className="cf-inicio__tocar" onClick={onJugar} aria-label="Tocá para jugar" />

      <div className="cf-inicio__contenido">
        <header className="cf-inicio__arriba">
          {sinLogo ? (
            <p className="cf-inicio__saludo">
              Monaco <b>Barber Studio</b>
            </p>
          ) : (
            <Image
              src={LOGO_MONACO.src}
              alt="Monaco Barber Studio"
              width={LOGO_MONACO.ancho}
              height={LOGO_MONACO.alto}
              unoptimized
              loading="eager"
              draggable={false}
              className="cf-inicio__monaco"
              onError={() => setSinLogo(true)}
            />
          )}
          {datos.cliente && (
            <p className="cf-inicio__saludo">
              Hola, <b>{datos.cliente.nombre}</b>
            </p>
          )}
          <ChipTurno turno={turno} />
        </header>

        <div className="cf-inicio__marca">
          <LogoCorteFinal className="cf-inicio__logo" brillo />
          <p className="cf-inicio__bajada">
            {datos.cliente ? 'Jugá mientras esperás tu turno' : 'Elegí a tu barbero y peleá'}
          </p>
        </div>

        <div className="cf-inicio__abajo">
          <p className="cf-inicio__cta" aria-hidden="true">
            Tocá para jugar
          </p>
          <nav className="cf-inicio__barra" aria-label="Opciones">
            <button type="button" className="cf-boton-icono" onClick={onRanking}>
              <Trophy aria-hidden="true" />
              <span>Ranking</span>
            </button>
            <button type="button" className="cf-boton-icono" onClick={onComoSeJuega}>
              <CircleHelp aria-hidden="true" />
              <span>Cómo se juega</span>
            </button>
            <button type="button" className="cf-boton-icono" onClick={onSonido} aria-pressed={prefs.sonido}>
              {prefs.sonido ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              <span>{prefs.sonido ? 'Sonido' : 'Silencio'}</span>
            </button>
          </nav>
        </div>
      </div>
    </section>
  )
}
