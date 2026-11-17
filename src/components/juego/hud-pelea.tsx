'use client'

import { Crown, Pause, Zap } from 'lucide-react'
import type { CSSProperties } from 'react'
import { espejarRetrato } from '@/lib/juego/personajes'
import type { FichaPersonaje, Lado } from '@/lib/juego/tipos'
import { alTocar } from '@/lib/juego/ui/toque'
import { EstadosHud } from './estados-hud'
import { IconoMaquina } from './iconos'
import { ImagenJuego } from './imagen-juego'

/**
 * Estructura del HUD de la pelea. NO se re-renderiza durante la pelea: los valores los
 * escribe src/lib/juego/ui/hud.ts por los atributos `data-hud`.
 */
export function HudPelea({
  fichas,
  rondasParaGanar,
  segundos,
  onPausa,
  jefe = false,
}: {
  fichas: [FichaPersonaje, FichaPersonaje]
  rondasParaGanar: number
  segundos: number
  onPausa: () => void
  /**
   * Modo historia: el rival (lado 1) es un Boss. Lleva la corona y «Boss» en vez de «CPU», y la barra
   * de vida dorada (juego.css, `[data-jefe]`). Sólo contra la CPU: online no hay Bosses reforzados, así
   * que sala/hud-online.tsx no lo necesita.
   */
  jefe?: boolean
}) {
  return (
    <div className="cf-hud" data-jefe={jefe ? '' : undefined}>
      <LadoHud lado={0} ficha={fichas[0]} rondas={rondasParaGanar} />
      <div className="cf-hud__centro">
        <div className="cf-reloj" data-hud="marco-reloj" aria-hidden="true">
          <span data-hud="reloj">{segundos}</span>
        </div>
        <div className="cf-turbo" data-hud="turbo" aria-hidden="true">
          <Zap />
          <span>Turbo</span>
        </div>
        {/* También con el pulgar en el stick (un segundo dedo no genera click: ui/toque.ts). Sólo
            un toque que empieza y termina sobre el botón: un dedo de los controles no lo dispara
            (lo capturan sus zonas). */}
        <button type="button" className="cf-hud__pausa" {...alTocar(onPausa)} aria-label="Pausa">
          <Pause />
        </button>
      </div>
      <LadoHud lado={1} ficha={fichas[1]} rondas={rondasParaGanar} jefe={jefe} />
    </div>
  )
}

function LadoHud({ lado, ficha, rondas, jefe = false }: { lado: Lado; ficha: FichaPersonaje; rondas: number; jefe?: boolean }) {
  return (
    <div
      className="cf-hud__lado"
      data-lado={lado}
      style={{ '--cf-acento': ficha.color } as CSSProperties}
      aria-hidden="true"
    >
      <div className="cf-hud__cara" data-hud={`cara-${lado}`}>
        <ImagenJuego src={ficha.rutas.cara} alt="" tipo="cara" color={ficha.color} espejar={espejarRetrato(ficha, lado === 1)} prioridad />
      </div>
      <div className="cf-hud__barras">
        <div className="cf-hud__fila">
          <span className="cf-hud__nombre">{ficha.nombre}</span>
          {lado === 1 &&
            (jefe ? (
              <span className="cf-hud__cpu cf-hud__jefe">
                <Crown aria-hidden="true" />
                Boss
              </span>
            ) : (
              <span className="cf-hud__cpu">CPU</span>
            ))}
          <EstadosHud lado={lado} />
        </div>
        <div className="cf-vida" data-hud={`barra-vida-${lado}`} data-nivel="alta">
          <div className="cf-vida__chip" data-hud={`chip-${lado}`} />
          <div className="cf-vida__relleno" data-hud={`vida-${lado}`} />
        </div>
        <div className="cf-guardia" data-hud={`barra-guardia-${lado}`}>
          <div className="cf-guardia__relleno" data-hud={`guardia-${lado}`} />
        </div>
        <div className="cf-hud__pie">
          <div className="cf-hud__rondas">
            {Array.from({ length: Math.max(1, rondas) }, (_, i) => (
              <span key={i} className="cf-ronda" data-hud={`ronda-${lado}`} />
            ))}
          </div>
          {lado === 1 && (
            <div className="cf-mini-carga">
              <IconoMaquina />
              <div className="cf-mini-carga__barra">
                <div className="cf-mini-carga__relleno" data-hud="carga-rival" />
              </div>
              <span data-hud="carga-rival-num">2</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
