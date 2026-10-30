'use client'

import { Check, LoaderCircle, Lock, Sparkles, Swords, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { ELECCION_MS, type EstadoDuelo } from '@/lib/juego/online/duelo'
import { IDS_PERSONAJES, PERSONAJES, PROXIMAMENTE } from '@/lib/juego/personajes'
import type { IdPersonaje } from '@/lib/juego/tipos'
import { IconoDeEspecial } from '../iconos'
import { ImagenJuego } from '../imagen-juego'
import { BarrasAtributos } from '../pantalla-seleccion'

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

export function EleccionOnline({
  estado,
  onElegir,
  onConfirmar,
  onSalir,
  onBloqueado,
}: {
  estado: EstadoDuelo
  onElegir: (id: IdPersonaje) => void
  onConfirmar: () => void
  onSalir: () => void
  onBloqueado: (nombre: string) => void
}) {
  const conectando = estado.fase === 'conectando'
  const restante = useReloj(estado.fase === 'eligiendo', estado.confirmada)
  const ficha = PERSONAJES[estado.mia]
  const rival = estado.rival.nombre
  const urgente = !estado.confirmada && restante <= 5

  return (
    <section
      className="cf-pantalla cf-seleccion cf-eleccion-online"
      aria-label={`Elegí tu barbero para pelear contra ${rival}`}
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
        <div className="cf-heroe" key={ficha.id}>
          <div className="cf-heroe__retrato">
            <ImagenJuego src={ficha.rutas.retrato} alt={ficha.nombre} tipo="cuerpo" color={ficha.color} espejar prioridad />
          </div>
          <div className="cf-heroe__placa">
            <p className="cf-heroe__apodo">{ficha.apodo}</p>
            <h2 className="cf-heroe__nombre">{ficha.nombre}</h2>
            <BarrasAtributos atributos={ficha.atributos} />
          </div>
        </div>

        <div className="cf-seleccion__panel">
          <div className="cf-plantel" role="group" aria-label="Barberos">
            {IDS_PERSONAJES.map((id) => {
              const f = PERSONAJES[id]
              const elegido = id === ficha.id
              return (
                <button
                  key={id}
                  type="button"
                  className="cf-ficha"
                  aria-pressed={elegido}
                  data-elegido={elegido ? '' : undefined}
                  disabled={estado.confirmada && !elegido}
                  style={{ '--cf-acento': f.color } as CSSProperties}
                  onClick={() => onElegir(id)}
                >
                  <span className="cf-ficha__cara">
                    <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} prioridad />
                  </span>
                  <span className="cf-ficha__nombre">{f.nombre}</span>
                </button>
              )
            })}
            {PROXIMAMENTE.map((p) => (
              <button
                key={p.nombre}
                type="button"
                className="cf-ficha cf-ficha--bloqueada"
                onClick={() => onBloqueado(p.nombre)}
                aria-label={`${p.nombre}: próximamente`}
              >
                <span className="cf-ficha__cara">
                  <Lock aria-hidden="true" />
                </span>
                <span className="cf-ficha__nombre">{p.nombre}</span>
                <span className="cf-ficha__pronto">Pronto</span>
              </button>
            ))}
          </div>

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Especiales</h3>
            <ul className="cf-especiales">
              {ficha.especiales.map((esp) => (
                <li key={esp.nombre} className="cf-especial">
                  <span className="cf-especial__icono">
                    <IconoDeEspecial icono={esp.icono} />
                  </span>
                  <span className="cf-especial__texto">
                    <b>{esp.nombre}</b>
                    <span>{esp.descripcion}</span>
                  </span>
                  <span className="cf-rombo" aria-label={`Cuesta ${esp.costo} de carga`}>
                    <span>{esp.costo}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="cf-pasiva">
              <Sparkles aria-hidden="true" />
              <span>
                <b>{ficha.pasiva.nombre}.</b> {ficha.pasiva.descripcion}
              </span>
            </p>
          </div>
        </div>
      </div>

      <footer className="cf-seleccion__pie cf-eleccion-online__pie">
        <p className="cf-eleccion-online__nota">Pueden elegir el mismo barbero. Si se acaba el tiempo, va el que tengas marcado.</p>
        {estado.confirmada ? (
          <p className="cf-eleccion-online__esperando" role="status">
            <LoaderCircle className="cf-girando" aria-hidden="true" />
            <span>
              {estado.rivalConfirmo ? '¡A pelear!' : `Esperando a ${rival}…`}
            </span>
          </p>
        ) : (
          <button type="button" className="cf-btn cf-btn--grande cf-seleccion__pelear" onClick={onConfirmar}>
            <Check aria-hidden="true" />
            <span>Listo</span>
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
