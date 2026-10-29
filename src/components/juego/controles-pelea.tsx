'use client'

import { HandFist, Shield } from 'lucide-react'
import { CARGA_MAX } from '@/lib/juego/tipos'
import type { FichaPersonaje } from '@/lib/juego/tipos'
import { nombreCortoEspecial } from '@/lib/juego/ui/textos'
import { IconoDeEspecial, IconoMaquina } from './iconos'

/**
 * Estructura de los controles de la pelea: barra «CARGA DE LA MÁQUINA», las dos cartas
 * de especiales, el joystick flotante y los botones en arco. Los toques los maneja
 * src/lib/juego/ui/controles-tactiles.ts y los valores, hud.ts: esto no se
 * re-renderiza durante la pelea.
 */
export function ControlesPelea({ ficha }: { ficha: FichaPersonaje }) {
  return (
    <>
      <div className="cf-carga" aria-hidden="true">
        <div className="cf-carga__icono">
          <IconoMaquina />
        </div>
        <div className="cf-carga__cuerpo">
          <div className="cf-carga__rotulo">
            <span className="cf-carga__largo">Carga de la máquina</span>
            <span className="cf-carga__corto">Carga</span>
            <span className="cf-carga__x2">x2 Turbo</span>
          </div>
          <div className="cf-carga__segs">
            {Array.from({ length: CARGA_MAX }, (_, i) => (
              <div key={i} className="cf-carga__seg" data-hud="carga-seg">
                <div className="cf-carga__seg-relleno" data-parte="relleno" />
                <div className="cf-carga__seg-destello" data-parte="destello" />
              </div>
            ))}
          </div>
        </div>
        <div className="cf-carga__num" data-hud="carga-num">
          2
        </div>
      </div>

      <div className="cf-cartas">
        {ficha.especiales.map((esp, i) => (
          <button
            key={esp.nombre}
            type="button"
            className="cf-carta"
            data-carta={i + 1}
            aria-label={`${esp.nombre}: cuesta ${esp.costo} de carga`}
          >
            <span className="cf-carta__marco">
              <span className="cf-carta__arte">
                <IconoDeEspecial icono={esp.icono} className="cf-carta__icono" />
              </span>
              <span className="cf-carta__llenado" data-hud={`carta-llenado-${i + 1}`} />
              <span className="cf-carta__nombre">{nombreCortoEspecial(esp.nombre)}</span>
            </span>
            <span className="cf-carta__costo" aria-hidden="true">
              <span>{esp.costo}</span>
            </span>
            <kbd className="cf-carta__tecla" aria-hidden="true">
              {i === 0 ? 'U' : 'I'}
            </kbd>
          </button>
        ))}
      </div>

      <div className="cf-zona-joy" data-zona="joystick" aria-hidden="true">
        <div className="cf-joy" data-joy="base">
          <span className="cf-joy__flecha cf-joy__flecha--arr" />
          <span className="cf-joy__flecha cf-joy__flecha--der" />
          <span className="cf-joy__flecha cf-joy__flecha--aba" />
          <span className="cf-joy__flecha cf-joy__flecha--izq" />
          <div className="cf-joy__perilla" data-joy="perilla" />
        </div>
      </div>

      <div className="cf-zona-botones" data-zona="botones" aria-hidden="true">
        <div className="cf-bp cf-bp--golpe" data-boton="golpe">
          <HandFist className="cf-bp__icono" />
          <span className="cf-bp__texto">Golpe</span>
        </div>
        <div className="cf-bp cf-bp--herramienta" data-boton="herramienta">
          <IconoMaquina className="cf-bp__icono" />
          <span className="cf-bp__texto">{ficha.herramientas[0]}</span>
        </div>
        <div className="cf-bp cf-bp--guardia" data-boton="guardia">
          <Shield className="cf-bp__icono" />
          <span className="cf-bp__texto">Guardia</span>
        </div>
      </div>
    </>
  )
}
