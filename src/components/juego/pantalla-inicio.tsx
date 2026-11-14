'use client'

import { CircleHelp, Trophy, Volume2, VolumeX } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { espejarRetrato, PERSONAJES } from '@/lib/juego/personajes'
import type { DatosEntradaJuego, EstadoTurnoJuego, IdPersonaje } from '@/lib/juego/tipos'
import { hayPaseValido, venceDelPase } from '@/lib/juego/ui/pase-duenos'
import type { PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import { ImagenJuego } from './imagen-juego'
import { LogoCorteFinal } from './logo-corte-final'
import { CapaPinDuenos, type VistaPin } from './pin-duenos'
import { ChipTurno } from './turno'

interface Props {
  datos: DatosEntradaJuego
  /** Los dos de la portada: el luchador que le toca al jugador y su rival (su barbero, si vino por QR). */
  luchadores: [IdPersonaje, IdPersonaje]
  turno: EstadoTurnoJuego | null
  prefs: PreferenciasJuego
  onJugar: () => void
  onRanking: () => void
  onComoSeJuega: () => void
  onSonido: () => void
}

/** El logo de Monaco, transparente (sale de public/logo-monaco.png; 720×199). */
const LOGO_MONACO = { src: '/juego/logo-monaco.webp', ancho: 720, alto: 199 } as const

/** El gesto secreto del modo dueño: 5 toques al logo de Monaco en menos de 3 s (pin-duenos.tsx). */
const TOQUES_GESTO = 5
const VENTANA_GESTO_MS = 3000

export function PantallaInicio({ datos, luchadores, turno, prefs, onJugar, onRanking, onComoSeJuega, onSonido }: Props) {
  const arena = ARENAS[datos.arenaInicial]
  const [sinLogo, setSinLogo] = useState(false)
  /** La capa del modo dueño (null: cerrada). Con ella abierta, Enter y espacio no arrancan. */
  const [capaPin, setCapaPin] = useState<VistaPin | null>(null)
  const toquesLogo = useRef<number[]>([])
  const jugar = useEffectEvent(() => {
    if (capaPin === null) onJugar()
  })

  // El logo de Monaco se traga sus toques (no arranca el juego): 5 en menos de 3 s abren el modo
  // dueño. Sin ninguna pista a la vista; sin el PIN no entra nadie.
  const tocarLogo = () => {
    const ahora = performance.now()
    const recientes = toquesLogo.current.filter((t) => ahora - t < VENTANA_GESTO_MS)
    recientes.push(ahora)
    if (recientes.length < TOQUES_GESTO) {
      toquesLogo.current = recientes
      return
    }
    toquesLogo.current = []
    setCapaPin(hayPaseValido() ? { tipo: 'activo', vence: venceDelPase() } : { tipo: 'teclado' })
  }

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
  const [izquierda, derecha] = [PERSONAJES[luchadores[0]], PERSONAJES[luchadores[1]]]

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
        <ImagenJuego src={izquierda.rutas.retrato} alt="" tipo="cuerpo" color={izquierda.color} espejar={espejarRetrato(izquierda)} prioridad />
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
          {/* El gesto del modo dueño (tocarLogo): sin rol ni foco, para que no se anuncie. */}
          <div className="cf-inicio__monaco-toque" onClick={tocarLogo}>
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
          </div>
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
            {/* data-audio-propio: el audio se destraba en el click, ya con la preferencia nueva
                (ver alGesto en audio/index.ts). */}
            <button type="button" className="cf-boton-icono" onClick={onSonido} aria-pressed={prefs.sonido} data-audio-propio="">
              {prefs.sonido ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              <span>{prefs.sonido ? 'Sonido' : 'Silencio'}</span>
            </button>
          </nav>
        </div>
      </div>

      {capaPin && <CapaPinDuenos inicial={capaPin} onCerrar={() => setCapaPin(null)} />}
    </section>
  )
}
