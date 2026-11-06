'use client'

// La hoja para escribir o corregir la respuesta de una tarjeta (6/nov/2026).
// En el celular, la hoja de iOS de pantalla entera (HojaWhatsApp: «Cancelar ·
// Responder a Benjamín · Enviar»), arriba del teclado; en la compu, el diálogo
// de la Mac. Arriba, lo que escribió el cliente; abajo, el campo con el
// borrador y los ajustes de Tex, que reescriben el campo en vivo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AjusteBorrador } from '@/lib/mensajeria/borrador-prompt'
import {
  MAX_CARACTERES_RESPUESTA, estadoVentana, textoVentana, type Pendiente,
} from '@/lib/mensajeria/por-responder'
import { HojaWhatsApp } from '../dialogs/hoja-whatsapp'
import type { Borrador, DisponibilidadTex } from './use-borradores'

const AJUSTES: { ajuste: AjusteBorrador; texto: string }[] = [
  { ajuste: 'otra', texto: 'Otra versión' },
  { ajuste: 'mas_corta', texto: 'Más corta' },
  { ajuste: 'mas_calida', texto: 'Más cálida' },
  { ajuste: 'invitar', texto: 'Invitar a volver' },
]

export function HojaResponder({
  pendiente,
  borrador,
  ia,
  ahora,
  onCerrar,
  onAjuste,
  onEnviar,
}: {
  pendiente: Pendiente | null
  borrador?: Borrador
  ia: DisponibilidadTex
  ahora: number
  onCerrar: () => void
  onAjuste: (a: AjusteBorrador) => void
  /** Manda este texto (la tarjeta se va a la derecha). */
  onEnviar: (texto: string) => void
}) {
  const abierta = pendiente !== null
  // Lo que escribió la persona. Mientras no toque el campo, el campo muestra el
  // borrador de Tex (y lo sigue en vivo si pide un ajuste).
  const [texto, setTexto] = useState('')
  const [tocado, setTocado] = useState(false)
  const campo = useRef<HTMLTextAreaElement>(null)
  const idActual = pendiente?.id ?? null

  // Al abrir (o cambiar de tarjeta), el campo vuelve al borrador.
  const [abiertaPara, setAbiertaPara] = useState<string | null>(null)
  if (idActual !== abiertaPara) {
    setAbiertaPara(idActual)
    setTexto('')
    setTocado(false)
  }
  const valor = tocado ? texto : (borrador?.texto ?? '')

  // El campo crece con el texto, hasta casi la mitad de la pantalla. Se mide
  // también cuando el campo aparece: la hoja lo monta después de abrirse, y un
  // efecto que corrió antes lo dejaba en 4 renglones con el borrador cortado.
  const medir = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.45))}px`
  }, [])
  const refCampo = useCallback((el: HTMLTextAreaElement | null) => {
    campo.current = el
    if (el) window.requestAnimationFrame(() => medir(el))
  }, [medir])
  useEffect(() => {
    medir(campo.current)
  }, [valor, abierta, medir])

  const limpio = valor.trim()
  const largo = limpio.length
  const escribiendo = borrador?.estado === 'escribiendo' && !tocado
  const ventana = pendiente ? estadoVentana(pendiente, ahora) : null
  const espera = pendiente?.loQueEspera.slice(-3) ?? []

  return (
    <HojaWhatsApp
      open={abierta}
      onOpenChange={(v) => { if (!v) onCerrar() }}
      titulo={pendiente ? `Responder a ${pendiente.nombrePila ?? pendiente.nombre}` : 'Responder'}
      subtitulo={ventana ? textoVentana(ventana) : undefined}
      descripcion="Escribí o corregí la respuesta y mandala."
      cerrarAfuera={false}
      accion={{
        texto: 'Enviar',
        onClick: () => { if (limpio && largo <= MAX_CARACTERES_RESPUESTA) onEnviar(limpio) },
        deshabilitada: !limpio || largo > MAX_CARACTERES_RESPUESTA || escribiendo,
      }}
    >
      <div className="wa-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-2 lg:px-5 lg:pb-4 lg:pt-4">
        {espera.length > 0 && (
          <div className="mb-3 space-y-1.5">
            <p className="text-[13px] font-medium text-[var(--wa-text-2)]">Lo que escribió</p>
            {espera.map((m) => (
              <p key={m.id} className="w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-[18px] rounded-bl-[6px] bg-[var(--wa-in)] px-3 py-1.5 text-[15px] leading-5 text-[var(--wa-bubble-text)] lg:text-[13.5px]">
                {(m.texto ?? '').trim() || (m.tipo === 'image' ? 'Foto' : m.tipo === 'audio' ? 'Audio' : 'Adjunto')}
              </p>
            ))}
          </div>
        )}

        <label htmlFor="pr-respuesta" className="mb-1.5 text-[13px] font-medium text-[var(--wa-text-2)]">Tu respuesta</label>
        <textarea
          id="pr-respuesta"
          ref={refCampo}
          value={valor}
          onChange={(e) => { setTexto(e.target.value); setTocado(true) }}
          rows={4}
          placeholder="Escribí la respuesta…"
          maxLength={MAX_CARACTERES_RESPUESTA + 200}
          // 16 px: iOS hace zoom al enfocar un campo de menos.
          className={cn(
            'w-full resize-none rounded-2xl bg-[var(--wa-out)] px-3.5 py-3 text-base leading-[22px] text-[var(--wa-bubble-text)] outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/50 lg:text-[14px] lg:leading-5',
            escribiendo && 'pr-borrador-vivo',
          )}
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-[12.5px] text-[var(--wa-text-2)]">
          <span>{escribiendo ? 'Tex está escribiendo…' : tocado ? 'La escribiste vos' : borrador?.texto ? 'Borrador de Tex' : ''}</span>
          {largo > MAX_CARACTERES_RESPUESTA - 400 && (
            <span className={cn('tabular-nums', largo > MAX_CARACTERES_RESPUESTA && 'text-[var(--wa-danger)]')}>
              {largo}/{MAX_CARACTERES_RESPUESTA}
            </span>
          )}
        </div>

        {ia === 'si' && (
          <div className="mt-3 flex flex-wrap gap-2">
            {AJUSTES.map((a) => (
              <button
                key={a.ajuste}
                type="button"
                disabled={escribiendo}
                onClick={() => { setTocado(false); onAjuste(a.ajuste) }}
                className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-[14px] font-medium text-white/85 outline-none transition-colors hover:bg-white/[0.11] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px]"
              >
                {a.ajuste === 'otra' && <RefreshCw aria-hidden className="size-4" />}
                {a.texto}
              </button>
            ))}
          </div>
        )}
      </div>
    </HojaWhatsApp>
  )
}
