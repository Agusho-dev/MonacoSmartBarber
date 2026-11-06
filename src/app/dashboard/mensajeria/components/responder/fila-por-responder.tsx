'use client'

// La fila «Por responder» de arriba de la lista de chats (6/nov/2026), como la
// de «Archivados» de WhatsApp pero con lo que espera a la vista: las fotos de
// los primeros apiladas como un mazo, el resumen («1 reseña de 2 estrellas ·
// 4 consultas») y el número (rojo si hay una reseña baja). Sólo aparece si hay
// algo para contestar ya; tocarla abre la bandeja de tarjetas.

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { numeroCorto } from '../navegacion/secciones'
import { Avatar } from '../shared/avatar'
import { usePorResponder } from './contexto-por-responder'
import { resumenDePila } from '@/lib/mensajeria/por-responder'

// Arriba, el más urgente (el primero); los de atrás asoman girados a cada lado.
const GIRO_ARRIBA = 'rotate-0'
const GIROS_ATRAS = ['-rotate-[11deg] -translate-x-[5px] translate-y-px', 'rotate-[11deg] translate-x-[5px] translate-y-px']

export function FilaPorResponder({ onAbrir }: { onAbrir: () => void }) {
  const { estado, pilas, cuenta, urgente } = usePorResponder()
  if (estado !== 'listo' || cuenta === 0) return null
  const primeros = pilas.paraResponder.slice(0, 3)
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Por responder: ${cuenta}. ${resumenDePila(pilas.paraResponder)}`}
      className={cn(
        'group/pr relative flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none [-webkit-tap-highlight-color:transparent] lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-xl lg:px-3',
        'transition-colors active:bg-white/[0.06] lg:hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]/60',
      )}
    >
      <span aria-hidden className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center lg:h-12 lg:w-12">
        {primeros.map((p, i) => (
          <span
            key={p.id}
            className={cn(
              'absolute inset-y-1 left-1 right-1 overflow-hidden rounded-[14px] ring-2 ring-[var(--wa-bg)] transition-transform duration-300',
              i === 0 ? cn(GIRO_ARRIBA, 'group-hover/pr:-translate-y-0.5') : cn(GIROS_ATRAS[i - 1], 'brightness-75'),
            )}
            style={{ zIndex: primeros.length - i }}
          >
            <Avatar name={p.nombre} size={44} avatarUrl={p.avatarUrl} className="size-full rounded-none text-[16px]" />
          </span>
        ))}
        {urgente && <span className="pr-latido absolute -right-0.5 -top-0.5 z-10 size-3 rounded-full bg-[#ff453a] ring-2 ring-[var(--wa-bg)]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-[22px] text-[var(--wa-text)] lg:text-[15px] lg:leading-5">Por responder</span>
        <span className="block truncate text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">
          {resumenDePila(pilas.paraResponder)}
        </span>
      </span>
      <span
        className={cn(
          'flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] font-semibold leading-none tabular-nums',
          urgente ? 'bg-[#d32f2f] text-white' : 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)]',
        )}
      >
        {numeroCorto(cuenta)}
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[var(--wa-text-3)]" />
    </button>
  )
}
