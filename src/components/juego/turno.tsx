'use client'

import { BellRing, Clock, Scissors, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { EstadoTurnoJuego, FichaPersonaje } from '@/lib/juego/tipos'
import { ImagenJuego } from './imagen-juego'

/** «Hay 2 antes que vos»: sólo si vino por QR y el servidor sabe algo. */
export function ChipTurno({ turno, compacto = false }: { turno: EstadoTurnoJuego | null; compacto?: boolean }) {
  if (!turno || !turno.etiqueta || turno.estado === 'desconocido' || turno.estado === 'terminado') return null
  const proximo = turno.estado === 'esperando' && turno.adelante === 0
  const atendiendo = turno.estado === 'atendiendo'
  return (
    <div
      className="cf-chip-turno"
      data-proximo={proximo ? '' : undefined}
      data-atendiendo={atendiendo ? '' : undefined}
      data-compacto={compacto ? '' : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="cf-chip-turno__punto" aria-hidden="true" />
      {atendiendo ? <BellRing aria-hidden="true" /> : <Clock aria-hidden="true" />}
      <span>{turno.etiqueta}</span>
    </div>
  )
}

/** Cartel que baja de arriba: «¡Sos el próximo!». No bloquea la pelea. */
export function AvisoProximo({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="cf-aviso-proximo" role="alert">
      <span className="cf-aviso-proximo__icono" aria-hidden="true">
        <BellRing />
      </span>
      <div className="cf-aviso-proximo__texto">
        <strong>¡Sos el próximo!</strong>
        <span>Andá acercándote: en un ratito te llaman.</span>
      </div>
      <button type="button" className="cf-aviso-proximo__cerrar" onClick={onCerrar} aria-label="Cerrar aviso">
        <X />
      </button>
    </div>
  )
}

/** Pantalla completa cuando lo empiezan a atender: pausa todo, vibra y suena. */
export function PantallaTeToca({
  nombreCliente,
  nombreBarbero,
  ficha,
  onCerrar,
}: {
  nombreCliente: string | null
  nombreBarbero: string | null
  ficha: FichaPersonaje | null
  onCerrar: () => void
}) {
  const color = ficha?.color ?? '#f5b301'
  return (
    <div
      className="cf-te-toca"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cf-te-toca-titulo"
      style={{ '--cf-acento': color } as CSSProperties}
    >
      <div className="cf-te-toca__ondas" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="cf-te-toca__cara">
        {ficha ? (
          <ImagenJuego src={ficha.rutas.cara} alt={ficha.nombre} tipo="cara" color={ficha.color} prioridad />
        ) : (
          <Scissors className="cf-te-toca__tijera" aria-hidden="true" />
        )}
      </div>
      <h2 id="cf-te-toca-titulo" className="cf-te-toca__titulo">
        ¡Te toca{nombreCliente ? `, ${nombreCliente}` : ''}!
      </h2>
      <p className="cf-te-toca__bajada">
        {nombreBarbero ? (
          <>
            Andá con <b>{nombreBarbero}</b>
          </>
        ) : (
          'Acercate a la silla'
        )}
      </p>
      <button type="button" className="cf-btn cf-btn--grande" onClick={onCerrar} autoFocus>
        <span>Voy</span>
      </button>
      <p className="cf-te-toca__nota">La pelea queda en pausa. Seguís cuando vuelvas.</p>
    </div>
  )
}
