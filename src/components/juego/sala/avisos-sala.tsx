'use client'

import { Swords, Users, X } from 'lucide-react'
import { useEffect, useEffectEvent } from 'react'
import type { EstadoSala } from '@/lib/juego/online/sala'

/** Cuánto se ve el «¡Hay alguien para pelear!» antes de irse solo. */
const AVISO_LLEGADA_MS = 6500

/**
 * «Sala de Rondeau · 3 jugadores». Sólo si hay alguien más (con la sala vacía no aparece nada).
 * El chico (durante una pelea contra la CPU) no se toca: es sólo para saber.
 */
export function ChipSala({
  estado,
  sucursal,
  chico = false,
  onAbrir,
}: {
  estado: EstadoSala | null
  sucursal: string
  chico?: boolean
  onAbrir?: () => void
}) {
  if (!estado || estado.otros.length === 0) return null
  const total = estado.otros.length + 1
  const libres = estado.otros.filter((j) => j.compatible && j.estado === 'libre').length
  const texto = `Sala de ${sucursal} · ${total} jugadores`
  const contenido = (
    <>
      <span className="cf-sala-chip__punto" aria-hidden="true" />
      <Users aria-hidden="true" />
      <span className="cf-sala-chip__largo">{texto}</span>
      <span className="cf-sala-chip__corto" aria-hidden="true">
        Sala · {total}
      </span>
    </>
  )
  if (chico || !onAbrir) {
    return (
      <span className="cf-sala-chip" data-chico={chico ? '' : undefined} data-libres={libres > 0 ? '' : undefined} role="status">
        {contenido}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="cf-sala-chip"
      data-libres={libres > 0 ? '' : undefined}
      onClick={onAbrir}
      aria-label={`${texto}. Ver la sala`}
    >
      {contenido}
    </button>
  )
}

/** Baja de arriba una vez por cada llegada; no tapa nada importante y se va solo. */
export function AvisoLlegada({
  nombre,
  cuantos,
  sucursal,
  onVer,
  onCerrar,
}: {
  nombre: string
  cuantos: number
  sucursal: string
  onVer: () => void
  onCerrar: () => void
}) {
  const cerrar = useEffectEvent(onCerrar)
  useEffect(() => {
    const t = window.setTimeout(() => cerrar(), AVISO_LLEGADA_MS)
    return () => window.clearTimeout(t)
  }, [])
  const quien = cuantos > 1 ? `${nombre} y ${cuantos - 1} más están` : `${nombre} está`
  return (
    <div className="cf-sala-aviso" role="status" aria-live="polite">
      <span className="cf-sala-aviso__icono" aria-hidden="true">
        <Swords />
      </span>
      <div className="cf-sala-aviso__texto">
        <strong>¡Hay alguien para pelear!</strong>
        <span>
          {quien} en la sala de {sucursal}
        </span>
      </div>
      <button type="button" className="cf-sala-aviso__ver" onClick={onVer}>
        Ver sala
      </button>
      <button type="button" className="cf-sala-aviso__cerrar" onClick={onCerrar} aria-label="Cerrar aviso">
        <X />
      </button>
    </div>
  )
}
