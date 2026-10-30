'use client'

import {
  CircleHelp,
  LogOut,
  Maximize,
  Minimize,
  Music,
  Play,
  RotateCcw,
  Vibrate,
  VibrateOff,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { EstadoTurnoJuego } from '@/lib/juego/tipos'
import { usePantallaCompleta } from '@/lib/juego/ui/media'
import { pedirPantallaCompleta, salirDePantallaCompleta, soportaPantallaCompleta } from '@/lib/juego/ui/pantalla-completa'
import { guardarPreferencias, type PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import { ChipTurno } from './turno'

interface Props {
  prefs: PreferenciasJuego
  turno: EstadoTurnoJuego | null
  tactil: boolean
  /** Etiqueta del golpe pesado del luchador (Máquina, Remate, Celular…) para la leyenda de teclas. */
  herramienta?: string
  onContinuar: () => void
  onReiniciar: () => void
  onComoSeJuega: () => void
  onSalir: () => void
}

export function MenuPausa({
  prefs,
  turno,
  tactil,
  herramienta = 'Máquina',
  onContinuar,
  onReiniciar,
  onComoSeJuega,
  onSalir,
}: Props) {
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  const pantallaCompleta = usePantallaCompleta()
  const puedeVibrar = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  const puedePantallaCompleta = soportaPantallaCompleta()

  return (
    <div className="cf-capa" role="dialog" aria-modal="true" aria-labelledby="cf-pausa-titulo">
      <div className="cf-pausa">
        <h2 id="cf-pausa-titulo" className="cf-titulo cf-pausa__titulo">
          Pausa
        </h2>
        <ChipTurno turno={turno} />

        <button type="button" className="cf-btn cf-btn--grande cf-pausa__continuar" onClick={onContinuar} autoFocus>
          <Play aria-hidden="true" />
          <span>Seguir peleando</span>
        </button>

        <div className="cf-pausa__acciones">
          <button type="button" className="cf-btn cf-btn--sec" onClick={onReiniciar}>
            <RotateCcw aria-hidden="true" />
            <span>Reiniciar</span>
          </button>
          <button type="button" className="cf-btn cf-btn--sec" onClick={onComoSeJuega}>
            <CircleHelp aria-hidden="true" />
            <span>Cómo se juega</span>
          </button>
          <button
            type="button"
            className="cf-btn cf-btn--sec"
            data-peligro={confirmarSalida ? '' : undefined}
            onClick={() => (confirmarSalida ? onSalir() : setConfirmarSalida(true))}
          >
            <LogOut aria-hidden="true" />
            <span>{confirmarSalida ? 'Tocá de nuevo para salir' : 'Cambiar barbero'}</span>
          </button>
        </div>

        <div className="cf-ajustes" role="group" aria-label="Ajustes">
          <Interruptor
            activo={prefs.sonido}
            icono={prefs.sonido ? Volume2 : VolumeX}
            texto="Sonido"
            onClick={() => guardarPreferencias({ sonido: !prefs.sonido })}
          />
          <Interruptor
            activo={prefs.musica}
            icono={Music}
            texto="Música"
            onClick={() => guardarPreferencias({ musica: !prefs.musica })}
          />
          {puedeVibrar && (
            <Interruptor
              activo={prefs.vibracion}
              icono={prefs.vibracion ? Vibrate : VibrateOff}
              texto="Vibración"
              onClick={() => guardarPreferencias({ vibracion: !prefs.vibracion })}
            />
          )}
          {puedePantallaCompleta && (
            <Interruptor
              activo={pantallaCompleta}
              icono={pantallaCompleta ? Minimize : Maximize}
              texto="Pantalla completa"
              onClick={() => {
                guardarPreferencias({ pantallaCompleta: !pantallaCompleta })
                void (pantallaCompleta ? salirDePantallaCompleta() : pedirPantallaCompleta())
              }}
            />
          )}
        </div>

        {!tactil && (
          <dl className="cf-leyenda-teclas">
            <div>
              <dt>
                <kbd>A</kbd>
                <kbd>D</kbd>
              </dt>
              <dd>Caminar</dd>
            </div>
            <div>
              <dt>
                <kbd>W</kbd>
              </dt>
              <dd>Saltar</dd>
            </div>
            <div>
              <dt>
                <kbd>S</kbd>
              </dt>
              <dd>Agacharse</dd>
            </div>
            <div>
              <dt>
                <kbd>J</kbd>
              </dt>
              <dd>Golpe</dd>
            </div>
            <div>
              <dt>
                <kbd>K</kbd>
              </dt>
              <dd>{herramienta}</dd>
            </div>
            <div>
              <dt>
                <kbd>L</kbd>
              </dt>
              <dd>Guardia</dd>
            </div>
            <div>
              <dt>
                <kbd>U</kbd>
                <kbd>I</kbd>
              </dt>
              <dd>Especiales</dd>
            </div>
            <div>
              <dt>
                <kbd>Shift</kbd>
              </dt>
              <dd>Esquiva</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}

function Interruptor({
  activo,
  icono: Icono,
  texto,
  onClick,
}: {
  activo: boolean
  icono: LucideIcon
  texto: string
  onClick: () => void
}) {
  return (
    <button type="button" className="cf-interruptor" aria-pressed={activo} onClick={onClick}>
      <Icono aria-hidden="true" />
      <span>{texto}</span>
      <span className="cf-interruptor__estado">{activo ? 'Sí' : 'No'}</span>
    </button>
  )
}
