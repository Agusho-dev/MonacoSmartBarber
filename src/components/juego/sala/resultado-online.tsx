'use client'

import { Crosshair, Flame, LoaderCircle, RotateCcw, Sparkles, Swords, Timer, Trophy, Users, Wifi, Zap } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import type { EstadoDuelo } from '@/lib/juego/online/duelo'
import { bajadaResultado, tituloResultado } from '@/lib/juego/online/textos'
import { PERSONAJES } from '@/lib/juego/personajes'
import { formatearDuracion, formatearPuntos, porcentaje } from '@/lib/juego/ui/textos'
import { ImagenJuego } from '../imagen-juego'

/**
 * Resultado de una pelea online: «¡Le ganaste a Juan!» / «Juan te ganó», el marcador de la
 * sesión entre los dos, REVANCHA (tienen que aceptar los dos) y VOLVER A LA SALA. No va al
 * ranking: las victorias online quedan en el récord de la sala de este celular.
 */
export function ResultadoOnline({
  estado,
  onRevancha,
  onVolverSala,
}: {
  estado: EstadoDuelo
  onRevancha: () => void
  onVolverSala: () => void
}) {
  const r = estado.resultado
  if (!r || !estado.personajes) return null
  const rival = estado.rival.nombre
  const miPersonaje = PERSONAJES[estado.personajes[estado.lado]]
  const arena = ARENAS[estado.arena]
  const gane = r.ganador === 'yo'
  const titulo = tituloResultado(r, rival)
  const bajada = bajadaResultado(r, rival, estado.rivalSeFue)
  const est = r.estadisticas
  const puedeRevancha = estado.rivalPresente && !estado.revanchaPropia

  const stats = est
    ? [
        { icono: <Flame aria-hidden="true" />, etiqueta: 'Daño hecho', valor: formatearPuntos(est.danioHecho) },
        {
          icono: <Swords aria-hidden="true" />,
          etiqueta: 'Combo máx.',
          valor: `${est.comboMax} ${est.comboMax === 1 ? 'golpe' : 'golpes'}`,
        },
        { icono: <Zap aria-hidden="true" />, etiqueta: 'Críticos', valor: String(est.criticos) },
        {
          icono: <Sparkles aria-hidden="true" />,
          etiqueta: 'Especiales',
          valor: `${est.especialesAcertados}/${est.especialesUsados}`,
        },
        {
          icono: <Crosshair aria-hidden="true" />,
          etiqueta: 'Precisión',
          valor: `${porcentaje(est.golpesAcertados, est.golpesIntentados)} %`,
        },
        { icono: <Timer aria-hidden="true" />, etiqueta: 'Tiempo', valor: formatearDuracion(r.duracionSeg) },
      ]
    : []

  let textoRevancha = 'Revancha'
  if (estado.revanchaPropia) textoRevancha = `Esperando a ${rival}…`
  else if (estado.revanchaRival) textoRevancha = '¡Dale, revancha!'

  return (
    <section
      className="cf-pantalla cf-resultado cf-resultado-online"
      data-gano={gane ? '' : undefined}
      aria-label={titulo}
      style={{ '--cf-acento': miPersonaje.color, '--cf-acento-2': miPersonaje.colorSecundario } as CSSProperties}
    >
      <div className="cf-resultado__fondo" aria-hidden="true">
        <ImagenJuego src={arena.imagen} alt="" tipo="arena" />
      </div>
      <div className="cf-resultado__velo" aria-hidden="true" />
      <span className="cf-resultado__rayos" aria-hidden="true" />

      <div className="cf-resultado__scroll">
        <header className="cf-resultado__cabeza">
          <span className="cf-online-etiqueta">
            <Wifi aria-hidden="true" />
            Pelea online · Sala de {arena.nombre}
          </span>
        </header>

        <div className="cf-resultado__grilla">
          <div className="cf-resultado__heroe">
            <div className="cf-resultado__retrato">
              <ImagenJuego
                src={miPersonaje.rutas.retrato}
                alt={miPersonaje.nombre}
                tipo="cuerpo"
                color={miPersonaje.color}
                espejar
                prioridad
              />
            </div>
            <div className="cf-resultado__titular">
              <h1 className="cf-resultado__titulo cf-resultado-online__titulo">{titulo}</h1>
              {bajada && <p className="cf-resultado-online__bajada">{bajada}</p>}
              {r.motivo === 'pelea' && (
                <p className="cf-resultado__marcador">
                  <b>{r.rondas[0]}</b>
                  <span>–</span>
                  <b>{r.rondas[1]}</b>
                  <span className="cf-resultado__contra">rounds</span>
                </p>
              )}
            </div>
          </div>

          <div className="cf-resultado__panel">
            <div className="cf-marcador-online" aria-label={`Marcador de hoy: vos ${estado.marcador[0]}, ${rival} ${estado.marcador[1]}`}>
              <span className="cf-rotulo">Marcador de hoy</span>
              <div className="cf-marcador-online__fila">
                <span className="cf-marcador-online__nombre" data-yo="">
                  Vos
                </span>
                <b className="cf-marcador-online__num" data-adelante={estado.marcador[0] > estado.marcador[1] ? '' : undefined}>
                  {estado.marcador[0]}
                </b>
                <span className="cf-marcador-online__guion">–</span>
                <b className="cf-marcador-online__num" data-adelante={estado.marcador[1] > estado.marcador[0] ? '' : undefined}>
                  {estado.marcador[1]}
                </b>
                <span className="cf-marcador-online__nombre">{rival}</span>
              </div>
            </div>

            {stats.length > 0 && (
              <dl className="cf-stats">
                {stats.map((s) => (
                  <div key={s.etiqueta} className="cf-stat">
                    {s.icono}
                    <dt>{s.etiqueta}</dt>
                    <dd>{s.valor}</dd>
                  </div>
                ))}
              </dl>
            )}

            <p className="cf-resultado-online__nota">
              <Trophy aria-hidden="true" />
              <span>Las peleas online no van al ranking: quedan en tu récord de la sala.</span>
            </p>
          </div>
        </div>
      </div>

      <footer className="cf-resultado__acciones">
        {/* Va pegado ARRIBA de los botones (en vertical tapaba el centro de REVANCHA y se comía el toque). */}
        {estado.revanchaRival && !estado.revanchaPropia && estado.rivalPresente && (
          <p className="cf-resultado-online__pide" role="status">
            {rival} quiere la revancha
          </p>
        )}
        {estado.rivalPresente ? (
          <button
            type="button"
            className="cf-btn cf-btn--grande"
            data-pide={estado.revanchaRival && !estado.revanchaPropia ? '' : undefined}
            onClick={onRevancha}
            disabled={!puedeRevancha}
          >
            {estado.revanchaPropia ? (
              <LoaderCircle className="cf-girando" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            <span>{textoRevancha}</span>
          </button>
        ) : (
          <p className="cf-resultado-online__ausente" role="status">
            {estado.rivalSeFue === 'turno'
              ? `${rival} fue llamado a cortarse`
              : estado.rivalSeFue === 'salir'
                ? `${rival} volvió a la sala`
                : estado.rivalSeFue === 'cerro'
                  ? `${rival} cerró el juego`
                  : `Sin revancha: ${rival} ya no está`}
          </p>
        )}
        <button type="button" className="cf-btn cf-btn--sec" onClick={onVolverSala}>
          <Users aria-hidden="true" />
          <span>Volver a la sala</span>
        </button>
      </footer>
    </section>
  )
}
