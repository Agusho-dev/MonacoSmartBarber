'use client'

import { ChevronRight, HandFist, Shield, Wind } from 'lucide-react'
import { useState } from 'react'
import { IDS_PERSONAJES, PERSONAJES } from '@/lib/juego/personajes'
import type { FichaPersonaje } from '@/lib/juego/tipos'
import { IconoDeEspecial, IconoHerramienta } from './iconos'

interface Paso {
  titulo: string
  tactil: string
  teclado: string
}

/**
 * Los textos nombran el golpe pesado del barbero elegido (MÁQUINA, REMATE, CELULAR…): con 13
 * luchadores el botón no siempre dice «máquina».
 */
function pasos(herramienta: string): readonly Paso[] {
  const h = herramienta.toUpperCase()
  return [
  {
    titulo: 'Movete',
    tactil:
      'Apoyá el pulgar izquierdo donde quieras y deslizá. Arriba saltás, también en diagonal, y si lo dejás apretado seguís saltando. Abajo te agachás.',
    teclado: 'A y D (o las flechas) para caminar. W o espacio para saltar (con A o D, en diagonal), S para agacharte.',
  },
  {
    titulo: 'Pegá y esquivá',
    tactil: `GOLPE encadena puño, patada y combo. ${h} pega más fuerte y rompe guardias. Mantené GUARDIA para bloquear. ESQUIVA te saca para atrás, o hacia donde apuntes el stick (también sale con dos empujones rápidos del stick).`,
    teclado: `J golpe (tocalo seguido para el combo), K ${herramienta.toLowerCase()} (golpe pesado), mantené L para la guardia y Shift para esquivar: para atrás, o hacia donde caminás.`,
  },
  {
    titulo: 'Cargá la máquina',
    tactil:
      'La barra se llena sola, y más rápido si pegás o te pegan. Cuando una carta late, tocala: es tu especial. Ojo con los del rival: el sismo y el bombo se saltan, la onda se pasa con la ESQUIVA y el agarre no se bloquea.',
    teclado: 'La barra se llena sola. Cuando una carta late, U o I tiran el especial. El sismo y el bombo se saltan, la onda se pasa con Shift y el agarre no se bloquea. Esc pausa.',
  },
  ]
}

/**
 * Tres tarjetas cortas antes de la primera pelea (y desde «Cómo se juega»), con los botones y
 * las cartas del barbero elegido.
 */
export function Tutorial({
  tactil,
  ficha = PERSONAJES[IDS_PERSONAJES[0]],
  onCerrar,
}: {
  tactil: boolean
  /** El luchador del jugador: su golpe pesado y sus dos especiales en las ilustraciones. */
  ficha?: FichaPersonaje
  onCerrar: () => void
}) {
  const [paso, setPaso] = useState(0)
  const PASOS = pasos(ficha.herramientas[0])
  const ultimo = paso === PASOS.length - 1
  const actual = PASOS[paso]

  return (
    <div className="cf-capa cf-capa--tutorial" role="dialog" aria-modal="true" aria-labelledby="cf-tuto-titulo">
      <div className="cf-tuto">
        <div className="cf-tuto__cabeza">
          <span className="cf-rotulo">
            Cómo se juega · {paso + 1} de {PASOS.length}
          </span>
          <button type="button" className="cf-enlace" onClick={onCerrar}>
            Saltar
          </button>
        </div>

        <div className="cf-tuto__ilustracion" key={paso} aria-hidden="true">
          {paso === 0 && (tactil ? <IlustracionJoystick /> : <Teclas grupos={[['A', 'D'], ['W'], ['S']]} />)}
          {paso === 1 &&
            (tactil ? <IlustracionBotones herramienta={ficha.herramientas[0]} /> : <Teclas grupos={[['J'], ['K'], ['L'], ['Shift']]} />)}
          {paso === 2 && <IlustracionCarga tactil={tactil} ficha={ficha} />}
        </div>

        <h2 id="cf-tuto-titulo" className="cf-tuto__titulo">
          {actual.titulo}
        </h2>
        <p className="cf-tuto__texto">{tactil ? actual.tactil : actual.teclado}</p>

        <div className="cf-tuto__pie">
          <div className="cf-puntos" aria-hidden="true">
            {PASOS.map((p, i) => (
              <span key={p.titulo} data-activo={i === paso ? '' : undefined} />
            ))}
          </div>
          <button
            type="button"
            className="cf-btn"
            onClick={() => (ultimo ? onCerrar() : setPaso(paso + 1))}
            autoFocus
          >
            <span>{ultimo ? '¡A pelear!' : 'Siguiente'}</span>
            {!ultimo && <ChevronRight aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function IlustracionJoystick() {
  return (
    <div className="cf-ilu-joy">
      <div className="cf-ilu-joy__base">
        <div className="cf-ilu-joy__perilla" />
      </div>
      <span className="cf-ilu-etiqueta cf-ilu-etiqueta--arriba">Saltar</span>
      <span className="cf-ilu-etiqueta cf-ilu-etiqueta--abajo">Agacharse</span>
    </div>
  )
}

function IlustracionBotones({ herramienta }: { herramienta: string }) {
  return (
    <div className="cf-ilu-botones">
      <div className="cf-ilu-bp cf-ilu-bp--golpe">
        <HandFist />
        <span>Golpe</span>
      </div>
      <div className="cf-ilu-bp cf-ilu-bp--herramienta">
        <IconoHerramienta nombre={herramienta} />
        <span>{herramienta}</span>
      </div>
      <div className="cf-ilu-bp cf-ilu-bp--guardia">
        <Shield />
        <span>Guardia</span>
      </div>
      <div className="cf-ilu-bp cf-ilu-bp--esquiva">
        <Wind />
        <span>Esquiva</span>
      </div>
    </div>
  )
}

function IlustracionCarga({ tactil, ficha }: { tactil: boolean; ficha: FichaPersonaje }) {
  const [e1, e2] = ficha.especiales
  return (
    <div className="cf-ilu-carga">
      <div className="cf-ilu-carga__barra">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>
      <div className="cf-ilu-carga__cartas">
        <div className="cf-ilu-carta" data-lista="">
          <IconoDeEspecial icono={e1.icono} />
          <b>{e1.costo}</b>
          {!tactil && <kbd>U</kbd>}
        </div>
        <div className="cf-ilu-carta">
          <IconoDeEspecial icono={e2.icono} />
          <b>{e2.costo}</b>
          {!tactil && <kbd>I</kbd>}
        </div>
      </div>
    </div>
  )
}

function Teclas({ grupos }: { grupos: string[][] }) {
  return (
    <div className="cf-ilu-teclas">
      {grupos.map((g) => (
        <div key={g.join('')} className="cf-ilu-teclas__grupo">
          {g.map((t) => (
            <kbd key={t}>{t}</kbd>
          ))}
        </div>
      ))}
    </div>
  )
}
