'use client'

// Una fila de la lista de chats, como WhatsApp: en el celular la de iOS (foto
// de 52 px, nombre de 17 px, vista previa de hasta dos líneas), en la compu la
// de la Mac (foto de 48 px, una sola línea, la elegida con el fondo gris
// redondeado). El separador empieza donde empieza el texto, no debajo de la foto.
//
// Va con memo: la lista tiene cientos de filas y el Realtime cambia una por
// vez (el contexto conserva la identidad de las conversaciones que no tocó).

import { memo } from 'react'
import {
  Camera, CheckCheck, Facebook, FileText, Instagram, LayoutTemplate, MapPin, Mic, Sticker, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '../shared/avatar'
import {
  NOMBRE_DEL_ADJUNTO, displayName, formatLastMessagePreview, formatRelativeDate, lastMessageMediaKind,
  type LastMessageMediaKind,
} from '../shared/helpers'
import type { ConversationWithRelations } from '../shared/types'
import { apretarAlTocar } from './apretado'
import { cuantasEtiquetasEntran } from './medir-etiquetas'

const ICONO_ADJUNTO: Record<LastMessageMediaKind, typeof Camera> = {
  image: Camera,
  video: Video,
  audio: Mic,
  document: FileText,
  template: LayoutTemplate,
  sticker: Sticker,
  location: MapPin,
}

interface Etiqueta {
  id: string
  nombre: string
  color: string
}

export const FilaChat = memo(function FilaChat({
  conv,
  elegida,
  ultima,
  pegadaALaElegida,
  dia,
  anchoEtiquetas,
  onElegir,
}: {
  conv: ConversationWithRelations
  /** La conversación abierta: en la compu lleva el fondo gris. */
  elegida: boolean
  /** La última fila no lleva separador. */
  ultima: boolean
  /** La elegida y la de arriba tampoco, en la compu: el fondo gris redondeado no se corta con una raya. */
  pegadaALaElegida: boolean
  /** null en el servidor y al hidratar: la hora se dibuja recién en el navegador (useDiaLocal). */
  dia: string | null
  /** Ancho de la línea de etiquetas; null hasta medir la lista. */
  anchoEtiquetas: number | null
  onElegir: (conv: ConversationWithRelations) => void
}) {
  const plataforma = conv.channel?.platform
  const nombre = displayName(conv.client?.name || conv.platform_user_name || conv.platform_user_id, plataforma)
  const ultimo = conv.last_message?.[0]
  const noLeidos = conv.unread_count > 0
  const adjunto = lastMessageMediaKind(ultimo)
  const IconoAdjunto = adjunto ? ICONO_ADJUNTO[adjunto] : null
  const saliente = ultimo?.direction === 'outbound'
  // El ícono y el texto, como WhatsApp: el texto ya no repite el tipo
  // (formatLastMessagePreview). El ícono no se lee: el lector de pantalla dice
  // el tipo, salvo que el texto ya sea ése ("Foto" de una foto sin epígrafe).
  const vistaPrevia = formatLastMessagePreview(
    ultimo,
    conv.client?.phone || (plataforma === 'instagram' ? (conv.client?.instagram || 'Instagram DM') : conv.platform_user_id),
  )
  const tipoParaLeer = adjunto && NOMBRE_DEL_ADJUNTO[adjunto] !== vistaPrevia ? NOMBRE_DEL_ADJUNTO[adjunto] : null
  const hora = dia && conv.last_message_at ? formatRelativeDate(conv.last_message_at) : null
  const etiquetas: Etiqueta[] = (conv.tags ?? []).flatMap(({ tag_id, tag }) =>
    tag ? [{ id: tag_id, nombre: tag.name, color: tag.color || '#6B7280' }] : [],
  )

  return (
    <button
      type="button"
      onClick={() => onElegir(conv)}
      // Apretada con el dedo (data-apretada): aparece con una demora corta y se
      // va apenas la lista scrollea (apretado.ts). Con :active, en el iPhone la
      // fila quedaba gris durante todo el scroll.
      onPointerDown={apretarAlTocar}
      aria-current={elegida ? 'true' : undefined}
      className={cn(
        'flex w-full items-stretch gap-3 pl-4 text-left outline-none [-webkit-tap-highlight-color:transparent]',
        // Mantener el dedo sobre una fila no selecciona texto ni abre el menú
        // "Copiar | Consultar" de iOS (en WhatsApp una fila nunca se selecciona).
        'select-none [-webkit-touch-callout:none]',
        // Con el teclado, el anillo verde por dentro: el fondo gris solo no se veía (1,1:1).
        'transition-colors duration-100 data-[apretada]:bg-[var(--wa-hover)] focus-visible:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]',
        'lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-xl lg:pl-3 lg:hover:bg-[var(--wa-hover)]',
        elegida && 'lg:bg-[var(--wa-selected)] lg:hover:bg-[var(--wa-selected)]',
      )}
    >
      <span className="relative shrink-0 self-center">
        <Avatar name={nombre} size={52} className="lg:size-12 lg:text-[18px]" avatarUrl={conv.platform_user_avatar} />
        {(plataforma === 'instagram' || plataforma === 'facebook') && (
          // El anillo es del color del fondo: recorta el globito sobre la foto.
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full ring-2 ring-[var(--wa-bg)]',
              plataforma === 'instagram' ? 'bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600' : 'bg-[#1877f2]',
              elegida && 'lg:ring-[var(--wa-selected)]',
            )}
          >
            {plataforma === 'instagram'
              ? <Instagram className="size-2.5 text-white" strokeWidth={2.5} />
              : <Facebook className="size-2.5 text-white" strokeWidth={2.5} />}
          </span>
        )}
      </span>

      <span
        className={cn(
          'flex min-h-[76px] min-w-0 flex-1 flex-col justify-center border-b-[0.5px] py-2.5 pr-4 lg:min-h-[68px] lg:pr-3',
          ultima ? 'border-transparent' : 'border-[var(--wa-divider)]',
          pegadaALaElegida && 'lg:border-transparent',
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-[22px] text-[var(--wa-text)] lg:text-[15px] lg:leading-5">
            {nombre}
          </span>
          {hora && (
            <span
              className={cn(
                'shrink-0 text-[14px] tabular-nums lg:text-[12.5px]',
                noLeidos ? 'text-[var(--wa-accent)]' : 'text-[var(--wa-text-2)]',
              )}
            >
              {hora}
            </span>
          )}
        </span>

        <span className="mt-0.5 flex items-start gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-5 text-[var(--wa-text-2)] lg:line-clamp-1 lg:text-[14px]">
            {saliente && (
              <>
                <CheckCheck aria-hidden className="mr-1 inline-block size-[17px] align-[-4px]" />
                <span className="sr-only">Enviado: </span>
              </>
            )}
            {IconoAdjunto && <IconoAdjunto aria-hidden className="mr-1 inline-block size-4 align-[-3px]" />}
            {tipoParaLeer && <span className="sr-only">{tipoParaLeer}: </span>}
            {vistaPrevia}
          </span>
          {noLeidos && (
            <span className="mt-px flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--wa-accent)] px-1.5 text-[13px] font-semibold leading-none tabular-nums text-[var(--wa-on-accent)] lg:mt-0 lg:h-5 lg:min-w-5 lg:text-[12px]">
              {conv.unread_count}
              <span className="sr-only"> sin leer</span>
            </span>
          )}
        </span>

        {etiquetas.length > 0 && <LineaEtiquetas etiquetas={etiquetas} ancho={anchoEtiquetas} />}
      </span>
    </button>
  )
})

// UNA línea de chips teñidos con el color de cada etiqueta, sin envolver: las
// píldoras sólidas que ocupaban una o dos líneas más eran parte del lío.
function LineaEtiquetas({ etiquetas, ancho }: { etiquetas: Etiqueta[]; ancho: number | null }) {
  const nombres = etiquetas.map((e) => e.nombre)
  // Antes de medir (servidor e hidratación) va la primera con su "+N": la
  // línea ocupa su lugar desde el principio y casi nunca desborda.
  const enteras = ancho === null ? 1 : cuantasEtiquetasEntran(nombres, ancho)
  const mostradas = Math.max(enteras, 1)
  const sobran = etiquetas.length - mostradas

  return (
    <span className="mt-1.5 flex h-5 min-w-0 items-center gap-1 overflow-hidden">
      <span className="sr-only">Etiquetas: {nombres.join(', ')}</span>
      {etiquetas.slice(0, mostradas).map((e) => (
        <span
          key={e.id}
          aria-hidden
          className={cn(
            // leading-[14px] y no leading-none: el "…" del truncate recorta a la
            // caja de la línea, y con 11 px se comía las descendentes ("aqendado").
            'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium leading-[14px]',
            // Ni la primera entra entera: se corta con "…" en vez de desbordar.
            enteras === 0 ? 'min-w-0' : 'shrink-0',
          )}
          style={{
            backgroundColor: `color-mix(in srgb, ${e.color} 18%, transparent)`,
            // Un poco más clara que la etiqueta: un color oscuro sobre negro no se lee.
            color: `color-mix(in srgb, ${e.color} 80%, white)`,
          }}
        >
          <span className="truncate">{e.nombre}</span>
        </span>
      ))}
      {sobran > 0 && (
        <span
          aria-hidden
          className="inline-flex h-5 shrink-0 items-center rounded-md bg-white/[0.08] px-1.5 text-[11px] font-medium leading-[14px] tabular-nums text-[var(--wa-text-2)]"
        >
          +{sobran}
        </span>
      )}
    </span>
  )
}
