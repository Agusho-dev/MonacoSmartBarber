'use client'

import { ChevronRight, HandFist, Shield } from 'lucide-react'
import { useState } from 'react'
import { IconoDeEspecial, IconoMaquina } from './iconos'

interface Paso {
  titulo: string
  tactil: string
  teclado: string
}

const PASOS: readonly Paso[] = [
  {
    titulo: 'Movete',
    tactil:
      'Apoyá el pulgar izquierdo donde quieras y deslizá. Arriba saltás, abajo te agachás. Dos deslizadas rápidas para un costado: dash.',
    teclado: 'A y D (o las flechas) para caminar. W o espacio para saltar, S para agacharte. Shift: dash.',
  },
  {
    titulo: 'Pegá',
    tactil:
      'GOLPE encadena puño, patada y combo si lo tocás seguido. MÁQUINA pega más fuerte y rompe guardias. Mantené GUARDIA para bloquear.',
    teclado: 'J golpe (tocalo seguido para el combo), K máquina y mantené L para la guardia.',
  },
  {
    titulo: 'Cargá la máquina',
    tactil:
      'La barra se llena sola, y más rápido si pegás o te pegan. Cuando una carta late, tocala: es tu especial. En el TURBO carga el doble.',
    teclado: 'La barra se llena sola. Cuando una carta late, U o I tiran el especial. En el TURBO carga el doble. Esc pausa.',
  },
]

/** Tres tarjetas cortas antes de la primera pelea (y desde «Cómo se juega»). */
export function Tutorial({ tactil, onCerrar }: { tactil: boolean; onCerrar: () => void }) {
  const [paso, setPaso] = useState(0)
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
          {paso === 0 && (tactil ? <IlustracionJoystick /> : <Teclas grupos={[['A', 'D'], ['W'], ['S'], ['Shift']]} />)}
          {paso === 1 && (tactil ? <IlustracionBotones /> : <Teclas grupos={[['J'], ['K'], ['L']]} />)}
          {paso === 2 && <IlustracionCarga tactil={tactil} />}
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

function IlustracionBotones() {
  return (
    <div className="cf-ilu-botones">
      <div className="cf-ilu-bp cf-ilu-bp--golpe">
        <HandFist />
        <span>Golpe</span>
      </div>
      <div className="cf-ilu-bp cf-ilu-bp--herramienta">
        <IconoMaquina />
        <span>Máquina</span>
      </div>
      <div className="cf-ilu-bp cf-ilu-bp--guardia">
        <Shield />
        <span>Guardia</span>
      </div>
    </div>
  )
}

function IlustracionCarga({ tactil }: { tactil: boolean }) {
  return (
    <div className="cf-ilu-carga">
      <div className="cf-ilu-carga__barra">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>
      <div className="cf-ilu-carga__cartas">
        <div className="cf-ilu-carta" data-lista="">
          <IconoDeEspecial icono="rayo" />
          <b>4</b>
          {!tactil && <kbd>U</kbd>}
        </div>
        <div className="cf-ilu-carta">
          <IconoDeEspecial icono="tijera" />
          <b>6</b>
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
