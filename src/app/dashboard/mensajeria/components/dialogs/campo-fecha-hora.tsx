'use client'

// Día y hora de 24 h, para programar (Programar mensaje y Difusiones).
//
// El datetime-local del navegador escribe la hora con el idioma del navegador:
// en Chrome con es-AR sale "05:30 p. m.", y en Mensajería todo va de 24 h, como
// en WhatsApp. Por eso el día es un campo de fecha (sin hora) y la hora, dos
// listas: de 00 a 23 y de a 5 minutos (en el iPhone, la rueda nativa).
// El valor es el mismo que daba el datetime-local ("2026-10-30T17:30"), o ''
// mientras falte algo.

import { useState } from 'react'
import { cn } from '@/lib/utils'

const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

export function CampoFechaHora({
  id,
  valor,
  onCambio,
  claseCampo,
}: {
  /** El del campo de la fecha, para el <label htmlFor>. */
  id?: string
  /** "AAAA-MM-DDTHH:MM" o ''. Se lee al montar: el campo se arma de nuevo con cada apertura. */
  valor: string
  onCambio: (valor: string) => void
  /** Las clases de cada control (el tema de quien lo usa). */
  claseCampo: string
}) {
  const [diaInicial, horaInicial = ''] = valor ? valor.split('T') : ['', '']
  const [dia, setDia] = useState(diaInicial)
  const [hora, setHora] = useState(horaInicial.slice(0, 2))
  const [minutos, setMinutos] = useState(horaInicial.slice(3, 5))

  const cambiar = (d: string, h: string, m: string) => {
    setDia(d)
    setHora(h)
    setMinutos(m)
    onCambio(d && h && m ? `${d}T${h}:${m}` : '')
  }

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="date"
        value={dia}
        onChange={(e) => cambiar(e.target.value, hora, minutos)}
        className={cn(claseCampo, 'min-w-0 flex-1 tabular-nums')}
      />
      <select
        aria-label="Hora"
        value={hora}
        // Elegida la hora, los minutos arrancan en 00: casi siempre es en punto.
        onChange={(e) => cambiar(dia, e.target.value, minutos || '00')}
        className={cn(claseCampo, 'w-[4.25rem] shrink-0 appearance-none text-center tabular-nums')}
      >
        <option value="" disabled>hh</option>
        {HORAS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden className="-mx-0.5 font-semibold">:</span>
      <select
        aria-label="Minutos"
        value={minutos}
        onChange={(e) => cambiar(dia, hora, e.target.value)}
        className={cn(claseCampo, 'w-[4.25rem] shrink-0 appearance-none text-center tabular-nums')}
      >
        <option value="" disabled>mm</option>
        {MINUTOS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  )
}
