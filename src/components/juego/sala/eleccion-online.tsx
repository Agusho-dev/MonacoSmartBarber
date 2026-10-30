'use client'

import { Check, LoaderCircle, Swords, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { ELECCION_MS, type EstadoDuelo } from '@/lib/juego/online/duelo'
import { IDS_PERSONAJES, PERSONAJES } from '@/lib/juego/personajes'
import type { IdPersonaje } from '@/lib/juego/tipos'
import { plantelOrdenado, proximamenteOrdenado, sucursalesDelPlantel } from '@/lib/juego/ui/plantel'
import { ImagenJuego } from '../imagen-juego'
import { EspecialesLuchador, FiltroSucursal, GrillaPlantel, HeroeLuchador, ProximamentePlantel } from '../plantel'

/** Las sucursales del filtro salen del catálogo (una vez). */
const SUCURSALES = sucursalesDelPlantel()

/** Segundos que quedan para elegir: arranca en 20 al entrar a la elección. */
function useReloj(activo: boolean, confirmada: boolean): number {
  const [restante, setRestante] = useState(Math.round(ELECCION_MS / 1000))
  useEffect(() => {
    if (!activo || confirmada) return
    const inicio = Date.now()
    const t = window.setInterval(() => {
      setRestante(Math.max(0, Math.ceil((ELECCION_MS - (Date.now() - inicio)) / 1000)))
    }, 250)
    return () => window.clearInterval(t)
  }, [activo, confirmada])
  return restante
}

/**
 * La elección de la pelea online: los mismos luchadores que contra la CPU (grilla, filtro por
 * sucursal y ficha grande), sin rival que elegir (es el otro jugador) y con el reloj de 20 s.
 */
export function EleccionOnline({
  estado,
  sucursal,
  onElegir,
  onConfirmar,
  onSalir,
  onBloqueado,
  onTocar,
}: {
  estado: EstadoDuelo
  /** La sucursal de la sala (sus barberos van primero). */
  sucursal: string | null
  onElegir: (id: IdPersonaje) => void
  onConfirmar: () => void
  onSalir: () => void
  onBloqueado: (nombre: string) => void
  onTocar?: () => void
}) {
  const [filtro, setFiltro] = useState<string | null>(null)
  const conectando = estado.fase === 'conectando'
  const restante = useReloj(estado.fase === 'eligiendo', estado.confirmada)
  const ficha = PERSONAJES[estado.mia]
  const rival = estado.rival.nombre
  const urgente = !estado.confirmada && restante <= 5
  const ids = plantelOrdenado(sucursal, filtro)
  const prontos = proximamenteOrdenado(sucursal, filtro)

  return (
    <section
      className="cf-pantalla cf-seleccion cf-eleccion-online"
      aria-label={`Elegí tu barbero para pelear contra ${rival}`}
      data-modo="jugador"
      style={{ '--cf-acento': ficha.color, '--cf-acento-2': ficha.colorSecundario } as CSSProperties}
    >
      <div className="cf-seleccion__fondo" aria-hidden="true">
        <span className="cf-seleccion__franja" />
        <span className="cf-seleccion__trama" />
      </div>

      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" onClick={onSalir} aria-label="Salir de la pelea online">
          <X />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo">Elegí tu barbero</h1>
        <div
          className="cf-eleccion-online__reloj"
          data-urgente={urgente ? '' : undefined}
          data-listo={estado.confirmada ? '' : undefined}
          role="timer"
          aria-label={estado.confirmada ? 'Ya elegiste' : `Quedan ${restante} segundos`}
        >
          {estado.confirmada ? <Check aria-hidden="true" /> : <span>{restante}</span>}
        </div>
      </header>

      <div className="cf-eleccion-online__contra">
        <Swords aria-hidden="true" />
        <span>
          Contra <b>{rival}</b>
        </span>
        <span className="cf-eleccion-online__estado" data-listo={estado.rivalConfirmo ? '' : undefined}>
          {estado.rivalConfirmo ? (
            <>
              <Check aria-hidden="true" />
              Ya eligió
            </>
          ) : (
            <>
              <LoaderCircle className="cf-girando" aria-hidden="true" />
              Eligiendo…
            </>
          )}
        </span>
      </div>

      <div className="cf-seleccion__cuerpo">
        <HeroeLuchador ficha={ficha} rol={estado.confirmada ? 'Elegido' : 'Vos'} esBarbero={false} espejar />

        <div className="cf-seleccion__panel">
          <FiltroSucursal
            sucursales={SUCURSALES}
            filtro={filtro}
            total={IDS_PERSONAJES.length}
            propia={sucursal}
            onFiltro={(f) => {
              if (f === filtro) return
              onTocar?.()
              setFiltro(f)
            }}
          />
          <GrillaPlantel ids={ids} jugador={estado.mia} bloqueada={estado.confirmada} onElegir={onElegir} />
          <ProximamentePlantel lista={prontos} onBloqueado={onBloqueado} />
          <EspecialesLuchador ficha={ficha} />
        </div>
      </div>

      <footer className="cf-seleccion__pie cf-eleccion-online__pie">
        <div className="cf-eleccion-online__fila">
          <span className="cf-duelo__cara cf-eleccion-online__cara" style={{ '--cf-acento': ficha.color } as CSSProperties}>
            <ImagenJuego src={ficha.rutas.cara} alt="" tipo="cara" color={ficha.color} />
          </span>
          <p className="cf-eleccion-online__nota">Pueden elegir el mismo barbero. Si se acaba el tiempo, va el que tengas marcado.</p>
        </div>
        {estado.confirmada ? (
          <p className="cf-eleccion-online__esperando" role="status">
            <LoaderCircle className="cf-girando" aria-hidden="true" />
            <span>{estado.rivalConfirmo ? '¡A pelear!' : `Esperando a ${rival}…`}</span>
          </p>
        ) : (
          <button type="button" className="cf-btn cf-btn--grande cf-seleccion__pelear" onClick={onConfirmar}>
            <Check aria-hidden="true" />
            <span>Listo con {ficha.nombre}</span>
          </button>
        )}
      </footer>

      {conectando && (
        <div className="cf-capa cf-eleccion-online__conectando" role="status">
          <div className="cf-pausa">
            <LoaderCircle className="cf-girando cf-eleccion-online__girando" aria-hidden="true" />
            <p className="cf-titulo cf-eleccion-online__titulo-conectando">Conectando</p>
            <p className="cf-texto-suave">Armando la pelea con {rival}…</p>
            <button type="button" className="cf-btn cf-btn--sec" onClick={onSalir}>
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
