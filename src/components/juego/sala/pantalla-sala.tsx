'use client'

import { ChevronLeft, LoaderCircle, Swords, Trophy, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRegistroOnline } from '@/lib/juego/online/registro'
import type { DesafioSaliente, EstadoSala, JugadorSala } from '@/lib/juego/online/sala'
import { textoEstadoJugador, textoSaliente } from '@/lib/juego/online/textos'
import { ImagenJuego } from '../imagen-juego'

function inicial(nombre: string): string {
  return (nombre.trim().charAt(0) || '?').toUpperCase()
}

/** Segundos que le quedan al desafío que mandé (se actualiza solo). */
function useRestante(vence: number | null): number | null {
  const [restante, setRestante] = useState<number | null>(null)
  useEffect(() => {
    if (vence === null) return
    const medir = () => setRestante(Math.max(0, Math.ceil((vence - Date.now()) / 1000)))
    const t = window.setInterval(medir, 250)
    const primero = window.setTimeout(medir, 0)
    return () => {
      window.clearInterval(t)
      window.clearTimeout(primero)
    }
  }, [vence])
  return vence === null ? null : restante
}

interface Props {
  estado: EstadoSala | null
  sucursal: string
  fondo: string | null
  onDesafiar: (id: string) => void
  onCancelar: () => void
  onVolver: () => void
  onJugarCpu: () => void
}

export function PantallaSala({ estado, sucursal, fondo, onDesafiar, onCancelar, onVolver, onJugarCpu }: Props) {
  const registro = useRegistroOnline()
  const saliente = estado?.saliente ?? null
  const restante = useRestante(saliente?.estado === 'esperando' ? saliente.vence : null)
  const otros = estado?.otros ?? []
  const conectada = estado?.conectada ?? false

  return (
    <section className="cf-pantalla cf-sala" aria-label={`Sala de ${sucursal}`}>
      <div className="cf-sala__fondo" aria-hidden="true">
        <ImagenJuego src={fondo} alt="" tipo="arena" />
      </div>
      <div className="cf-sala__velo" aria-hidden="true" />

      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" onClick={onVolver} aria-label="Volver">
          <ChevronLeft />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo">Sala de {sucursal}</h1>
        <span className="cf-sala__conexion" data-conectada={conectada ? '' : undefined}>
          <span className="cf-sala__conexion-punto" aria-hidden="true" />
          {conectada ? `${otros.length + 1} en la sala` : 'Conectando…'}
        </span>
      </header>

      <div className="cf-sala__cuerpo">
        <div className="cf-sala-yo">
          <span className="cf-sala-avatar cf-sala-avatar--yo" aria-hidden="true">
            {inicial(estado?.yo.nombre ?? '')}
          </span>
          <div className="cf-sala-yo__texto">
            <span className="cf-sala-yo__vos">Vos</span>
            <b className="cf-sala-yo__nombre">{estado?.yo.nombre ?? '…'}</b>
            <span className="cf-sala-yo__record">
              <Trophy aria-hidden="true" />
              {registro.peleas > 0
                ? `Ganaste ${registro.victorias} de ${registro.peleas} ${registro.peleas === 1 ? 'pelea online' : 'peleas online'}`
                : 'Todavía no peleaste online'}
            </span>
          </div>
        </div>

        <h2 className="cf-rotulo cf-sala__rotulo">En la sala</h2>

        {!conectada && otros.length === 0 ? (
          <p className="cf-sala-vacia" role="status">
            <LoaderCircle className="cf-girando" aria-hidden="true" />
            <span>Conectando con la sala de {sucursal}…</span>
          </p>
        ) : otros.length === 0 ? (
          <div className="cf-sala-vacia">
            <span className="cf-sala-vacia__icono" aria-hidden="true">
              <Users />
            </span>
            <b>Todavía no hay nadie más</b>
            <span>Cuando alguien del local abra el juego, te avisamos acá.</span>
            <button type="button" className="cf-btn cf-btn--sec" onClick={onJugarCpu}>
              <span>Pelear contra la CPU</span>
            </button>
          </div>
        ) : (
          <ul className="cf-sala-lista">
            {otros.map((j) => (
              <FilaJugador
                key={j.id}
                jugador={j}
                saliente={saliente?.a.id === j.id ? saliente : null}
                ocupadoConOtro={saliente !== null && saliente.estado === 'esperando' && saliente.a.id !== j.id}
                restante={restante}
                onDesafiar={() => onDesafiar(j.id)}
                onCancelar={onCancelar}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function FilaJugador({
  jugador: j,
  saliente,
  ocupadoConOtro,
  restante,
  onDesafiar,
  onCancelar,
}: {
  jugador: JugadorSala
  saliente: DesafioSaliente | null
  ocupadoConOtro: boolean
  restante: number | null
  onDesafiar: () => void
  onCancelar: () => void
}) {
  const libre = j.compatible && j.estado === 'libre'
  let accion: React.ReactNode
  if (saliente?.estado === 'esperando') {
    accion = (
      <span className="cf-sala-fila__espera">
        <LoaderCircle className="cf-girando" aria-hidden="true" />
        <span>Esperando{restante !== null ? ` · ${restante}` : '…'}</span>
        <button type="button" className="cf-sala-fila__cancelar" onClick={onCancelar} aria-label="Cancelar el desafío">
          <X />
        </button>
      </span>
    )
  } else if (saliente) {
    accion = (
      <span className="cf-sala-fila__respuesta" role="status">
        {textoSaliente(saliente.estado, j.nombre)}
      </span>
    )
  } else if (!j.compatible) {
    accion = <span className="cf-sala-fila__respuesta">Actualizá la página para pelear con {j.nombre}</span>
  } else {
    accion = (
      <button
        type="button"
        className="cf-btn cf-sala-fila__desafiar"
        onClick={onDesafiar}
        disabled={!libre || ocupadoConOtro}
      >
        <Swords aria-hidden="true" />
        <span>Desafiar</span>
      </button>
    )
  }
  return (
    <li className="cf-sala-fila" data-estado={j.compatible ? j.estado : 'version'}>
      <span className="cf-sala-avatar" aria-hidden="true">
        {inicial(j.nombre)}
      </span>
      <span className="cf-sala-fila__texto">
        <b>{j.nombre}</b>
        <span className="cf-sala-estado">{textoEstadoJugador(j)}</span>
      </span>
      {accion}
    </li>
  )
}
