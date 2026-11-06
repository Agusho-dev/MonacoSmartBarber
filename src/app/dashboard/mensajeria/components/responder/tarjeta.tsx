'use client'

// La tarjeta de «Por responder» (6/nov/2026): una conversación que espera, con
// todo lo que hace falta para contestarla sin abrir el chat. De arriba abajo:
//   - quién es (foto, nombre, WhatsApp o Instagram, cuántas veces vino) y hace
//     cuánto espera, con el color de la urgencia;
//   - la franja del caso: la reseña con sus estrellas, el servicio, el barbero
//     y la sucursal (y si al segundo corrigió la nota), o la consulta;
//   - la charla corta (los últimos mensajes, lo que espera abajo de todo);
//   - la respuesta: el borrador de Tex, que se va escribiendo con la cara de Tex
//     «leyéndolo», y los ajustes (otra versión, más corta, más cálida…).
// Lo que se ve en la burbuja verde es EXACTAMENTE lo que sale al deslizar.
//
// Los sellos ENVIAR / LISTO los prende el mazo (mazo.tsx) con --pr-der y
// --pr-izq mientras se arrastra, sin renders.

import { useEffect, useRef } from 'react'
import {
  Clock3, ExternalLink, Handshake, Instagram, MessageCircleQuestion, MessageSquareText, PenLine,
  RefreshCw, Star, type LucideIcon,
} from 'lucide-react'
import { TexCara } from '@/components/tex/tex-cara'
import { cn } from '@/lib/utils'
import type { AjusteBorrador } from '@/lib/mensajeria/borrador-prompt'
import {
  esBotonTocado, esMarcaDeRuido, estadoVentana, haceCuanto, minutosEsperando, textoVentana,
  type MensajeDelHilo, type Pendiente,
} from '@/lib/mensajeria/por-responder'
import { Avatar } from '../shared/avatar'
import { WhatsAppIcon } from '../shared/icons'
import { formatearTelefonoAr, nombreLegibleDePlantilla, plantillaDelMarcador } from '../shared/helpers'
import type { Borrador, DisponibilidadTex } from './use-borradores'

const HORA = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export type AccionDerecha = 'enviar' | 'escribir' | 'chat' | 'instagram' | 'esperar'

/** Qué hace deslizar a la derecha con esta tarjeta (y qué dice el sello). */
export function accionDerecha(p: Pendiente, borrador: Borrador | undefined, ahora: number): AccionDerecha {
  const ventana = estadoVentana(p, ahora)
  if (ventana.tipo === 'cerrada') return p.plataforma === 'instagram' ? 'instagram' : 'chat'
  if (borrador?.estado === 'escribiendo') return 'esperar'
  if (borrador?.texto.trim() && borrador.estado !== 'error') return 'enviar'
  return 'escribir'
}

const SELLO_DERECHA: Record<AccionDerecha, string> = {
  enviar: 'ENVIAR',
  escribir: 'ESCRIBIR',
  chat: 'ABRIR CHAT',
  instagram: 'INSTAGRAM',
  esperar: 'ESPERÁ',
}

function cuandoFue(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const hoy = new Date()
  const mismoDia = d.toDateString() === hoy.toDateString()
  return mismoDia ? `hoy ${HORA.format(d)}` : `${DIA.format(d)} ${HORA.format(d)}`
}

function Estrellas({ nota, tamano = 'grande' }: { nota: number; tamano?: 'grande' | 'chica' }) {
  return (
    <span role="img" aria-label={`${nota} de 5 estrellas`} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          strokeWidth={1.6}
          className={cn(
            tamano === 'grande' ? 'size-[22px] lg:size-5' : 'size-3.5',
            i <= nota ? 'fill-[#ffb340] text-[#ffb340]' : 'fill-white/[0.06] text-white/20',
          )}
        />
      ))}
    </span>
  )
}

/** El color de lo que lleva esperando: verde hasta 15 min, ámbar hasta 1 h, rojo después. */
function tonoDeEspera(minutos: number): string {
  if (minutos < 15) return 'bg-[#21c063]/15 text-[#4cd884]'
  if (minutos < 60) return 'bg-[#ff9f0a]/15 text-[#ffb340]'
  return 'bg-[#ff453a]/15 text-[#ff6961]'
}

function Franja({ p, ahora }: { p: Pendiente; ahora: number }) {
  const v = p.visita
  const detalle = [v?.servicio, v?.barbero ? `con ${v.barbero}` : null, v?.sucursal].filter(Boolean).join(' · ')
  if (p.tipo === 'resena') {
    const nota = p.nota ?? p.notaFinal ?? 0
    const corrigio = p.notaFinal !== null && p.nota !== null && p.notaFinal !== p.nota
    return (
      <div className="relative overflow-hidden rounded-[20px] border border-[#ff453a]/20 bg-[linear-gradient(135deg,rgba(255,69,58,0.20),rgba(255,159,10,0.08)_70%)] px-3.5 py-2.5 lg:rounded-2xl">
        <div className="flex items-center gap-2.5">
          <Estrellas nota={nota} />
          <span className="text-[16px] font-semibold leading-5 text-white lg:text-[14px]">{nota} de 5</span>
          <span className="ml-auto rounded-full bg-black/30 px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-[#ffb3ad]">Reseña</span>
        </div>
        {(detalle || v?.at) && (
          <p className="mt-1 truncate text-[14px] leading-5 text-white/75 lg:text-[13px]">
            {[detalle, cuandoFue(v?.at ?? null)].filter(Boolean).join(' · ')}
          </p>
        )}
        {corrigio && (
          <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-black/25 px-2.5 py-1.5 text-[13px] leading-[18px] text-white/85">
            <RefreshCw aria-hidden className="size-3.5 shrink-0" />
            Enseguida tocó {p.notaFinal}: puede haber sido sin querer.
          </p>
        )}
      </div>
    )
  }
  if (p.esCierre) {
    return (
      <div className="flex items-center gap-3 rounded-[20px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 lg:rounded-2xl">
        <Handshake aria-hidden className="size-6 shrink-0 text-[#8de0b0]" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-5 text-white lg:text-[14px]">Parece un cierre de charla</p>
          <p className="text-[14px] leading-5 text-white/65 lg:text-[13px]">Un gracias o un listo: no hace falta responder.</p>
        </div>
      </div>
    )
  }
  const datosCliente = p.visitasTotales && p.visitasTotales > 0
    ? `${p.visitasTotales === 1 ? 'Vino 1 vez' : `Vino ${p.visitasTotales} veces`}${v?.barbero ? ` · la última con ${v.barbero}` : ''}${v?.at ? `, ${haceCuanto(v.at, ahora)}` : ''}`
    : 'Todavía no vino al local'
  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-[#0a84ff]/20 bg-[linear-gradient(135deg,rgba(10,132,255,0.16),rgba(94,92,230,0.06)_70%)] px-4 py-3 lg:rounded-2xl">
      <MessageCircleQuestion aria-hidden className="mt-0.5 size-6 shrink-0 text-[#64b5ff]" strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold leading-5 text-white lg:text-[14px]">
          {p.pidioHumano ? 'Pidió hablar con alguien' : 'Consulta sin responder'}
        </p>
        <p className="truncate text-[14px] leading-5 text-white/70 lg:text-[13px]">{datosCliente}</p>
      </div>
    </div>
  )
}

function textoDeMensaje(m: MensajeDelHilo): { texto: string; apagado: boolean } {
  const plantilla = m.plantilla ?? plantillaDelMarcador(m.texto)
  if (plantilla) return { texto: `Plantilla · ${nombreLegibleDePlantilla(plantilla)}`, apagado: true }
  const t = (m.texto ?? '').trim()
  if (t) return { texto: t, apagado: false }
  switch (m.tipo) {
    case 'image': return { texto: 'Foto', apagado: true }
    case 'video': return { texto: 'Video', apagado: true }
    case 'audio': return { texto: 'Audio', apagado: true }
    case 'document': return { texto: 'Archivo', apagado: true }
    default: return { texto: 'Mensaje sin texto', apagado: true }
  }
}

/** La charla corta, como el chat: lo del cliente a la izquierda, lo del local a la derecha. */
function Hilo({ p, fondo }: { p: Pendiente; fondo: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Abajo de todo: lo que espera es lo último. Y sigue abajo cuando la charla
  // se achica (el borrador de Tex crece mientras llega), salvo que la persona
  // haya subido a leer.
  const pegada = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    pegada.current = true
    el.scrollTop = el.scrollHeight
    const alScrollear = () => { pegada.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }
    const obs = new ResizeObserver(() => { if (pegada.current) el.scrollTop = el.scrollHeight })
    obs.observe(el)
    el.addEventListener('scroll', alScrollear, { passive: true })
    return () => {
      obs.disconnect()
      el.removeEventListener('scroll', alScrollear)
    }
  }, [p.id, p.hilo.length])
  const desde = Date.parse(p.esperandoDesde)
  const mensajes = p.hilo.slice(-8)
  return (
    <div
      ref={ref}
      data-hilo=""
      className={cn(
        // Nunca en cero: lo que escribió el cliente (abajo de todo) siempre se ve.
        'wa-scroll min-h-[5.5rem] flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_18px)]',
        fondo && 'overflow-hidden',
      )}
    >
      <ol className="flex min-h-full flex-col justify-end gap-1.5 pt-3">
        {mensajes.map((m, i) => {
          const siguiente = mensajes[i + 1]
          const ultimoDeTanda = !siguiente || siguiente.dir !== m.dir
          if (esBotonTocado(m) || esMarcaDeRuido(m)) {
            return (
              <li key={m.id} className={cn('flex', m.dir === 'inbound' ? 'justify-start' : 'justify-end')}>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-[12.5px] text-white/60">
                  {esBotonTocado(m) ? `Tocó «${(m.texto ?? '').trim() || 'un botón'}»` : (m.texto ?? '').replace(/^\[|\]$/g, '')}
                </span>
              </li>
            )
          }
          const { texto, apagado } = textoDeMensaje(m)
          const espera = m.dir === 'inbound' && Date.parse(m.at) >= desde - 1000
          const esFoto = m.tipo === 'image' && m.media && /^https:\/\//.test(m.media)
          return (
            <li key={m.id} className={cn('flex flex-col', m.dir === 'inbound' ? 'items-start' : 'items-end')}>
              <div
                className={cn(
                  'max-w-[86%] whitespace-pre-wrap break-words px-3 py-1.5 text-[15px] leading-[20px] lg:text-[13.5px] lg:leading-[18px]',
                  m.dir === 'inbound'
                    ? cn('rounded-[18px] rounded-bl-[6px] bg-[var(--wa-in)] text-[var(--wa-bubble-text)]', espera && 'ring-1 ring-[#64b5ff]/45')
                    : 'rounded-[18px] rounded-br-[6px] bg-[var(--wa-out)]/80 text-[var(--wa-bubble-text)]/90',
                  apagado && 'italic text-white/55',
                )}
              >
                {esFoto && !fondo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.media ?? ''} alt="" loading="lazy" className="mb-1 max-h-40 rounded-xl object-cover" draggable={false} />
                )}
                {/* Lo del local se resume (casi siempre es un automático); lo del cliente se lee entero. */}
                <span className={m.dir === 'outbound' ? 'line-clamp-3' : 'line-clamp-6'}>{texto}</span>
              </div>
              {ultimoDeTanda && (
                <span className="mt-0.5 px-1 text-[11px] tabular-nums text-white/40">{HORA.format(new Date(m.at))}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Chip({ children, onClick, icono: Icono, destacado = false, deshabilitado = false }: {
  children: string
  onClick: () => void
  icono?: LucideIcon
  destacado?: boolean
  deshabilitado?: boolean
}) {
  return (
    <button
      type="button"
      data-sin-arrastre=""
      onClick={onClick}
      disabled={deshabilitado}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium outline-none transition-[background-color,transform,opacity] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.97] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:px-3 lg:text-[13px]',
        destacado ? 'bg-[var(--wa-accent)]/15 text-[#4cd884] hover:bg-[var(--wa-accent)]/20' : 'bg-white/[0.07] text-white/85 hover:bg-white/[0.11]',
      )}
    >
      {Icono && <Icono aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
      {children}
    </button>
  )
}

function ZonaRespuesta({
  p, ahora, borrador, ia, onEditar, onAjuste, onPedirIgual, onVerChat, fondo,
}: {
  p: Pendiente
  ahora: number
  borrador?: Borrador
  ia: DisponibilidadTex
  onEditar: () => void
  onAjuste: (a: AjusteBorrador) => void
  onPedirIgual: () => void
  onVerChat: () => void
  fondo: boolean
}) {
  const ventana = estadoVentana(p, ahora)
  if (ventana.tipo === 'cerrada') {
    const ig = p.plataforma === 'instagram'
    return (
      <div className="border-t border-white/[0.07] px-4 pb-4 pt-3">
        <div className="flex items-start gap-3 rounded-2xl bg-white/[0.05] px-3.5 py-3">
          <Clock3 aria-hidden className="mt-0.5 size-5 shrink-0 text-[#ffb340]" />
          <p className="text-[14px] leading-5 text-white/80 lg:text-[13px] lg:leading-[18px]">
            {ig
              ? 'Pasaron más de 24 horas: Instagram ya no deja contestar desde acá. Desde la app de Instagram sí.'
              : 'Pasaron más de 24 horas desde su último mensaje: WhatsApp sólo deja mandarle una plantilla, desde el chat.'}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ig && p.usuarioIg ? (
            <a
              data-sin-arrastre=""
              href={`https://ig.me/m/${encodeURIComponent(p.usuarioIg)}`}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[14px] font-medium text-white/90 outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <Instagram aria-hidden className="size-4" /> Abrir en Instagram <ExternalLink aria-hidden className="size-3.5 opacity-60" />
            </a>
          ) : (
            <Chip onClick={onVerChat} icono={MessageSquareText} destacado>Abrir el chat</Chip>
          )}
        </div>
      </div>
    )
  }

  // Un cierre de charla (lo decide la lista, o el servidor al pedir el borrador: 422 'cierre').
  if ((p.esCierre && !borrador) || borrador?.estado === 'cierre') {
    return (
      <div className="border-t border-white/[0.07] px-4 pb-4 pt-3">
        <p className="text-[14px] leading-5 text-white/65 lg:text-[13px]">Deslizá a la izquierda para marcarla como lista.</p>
        <div className="mt-2.5 flex gap-2">
          <Chip onClick={onPedirIgual} icono={PenLine} deshabilitado={fondo}>Responder igual</Chip>
        </div>
      </div>
    )
  }

  const escribiendo = borrador?.estado === 'escribiendo'
  const texto = borrador?.texto ?? ''
  const sinIa = ia !== 'si'
  const etiqueta = borrador?.editado ? 'Tu respuesta' : escribiendo ? 'Tex está escribiendo…' : texto ? 'Borrador de Tex' : sinIa ? 'Tu respuesta' : 'Tex'
  return (
    <div className="border-t border-white/[0.07] px-4 pb-3 pt-2.5 lg:pb-3.5">
      <div className="mb-1.5 flex min-h-8 items-center gap-2">
        {sinIa || borrador?.editado ? (
          <PenLine aria-hidden className="size-4 text-white/55" />
        ) : (
          <TexCara tamano={26} estado={escribiendo ? (texto ? 'hablando' : 'pensando') : 'reposo'} texto={texto} />
        )}
        <span className="min-w-0 truncate text-[13px] font-medium text-white/65">{etiqueta}</span>
        {!sinIa && !fondo && (texto || borrador?.estado === 'error') && !escribiendo && (
          <button
            type="button"
            data-sin-arrastre=""
            onClick={() => onAjuste('otra')}
            aria-label="Que Tex escriba otra versión"
            title="Otra versión"
            className="-my-1 flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium text-[#64b5ff] outline-none transition-colors hover:bg-white/[0.06] active:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
          >
            <RefreshCw aria-hidden className="size-3.5" /> Otra
          </button>
        )}
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums',
            ventana.porCerrar ? 'bg-[#ff9f0a]/15 text-[#ffb340]' : 'bg-white/[0.06] text-white/55',
          )}
        >
          {textoVentana(ventana)}
        </span>
      </div>

      <button
        type="button"
        onClick={onEditar}
        disabled={fondo}
        aria-label={texto ? `Editar la respuesta: ${texto}` : 'Escribir la respuesta'}
        className={cn(
          'group/borrador relative ml-auto flex w-full max-w-[92%] text-left outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 rounded-[20px]',
        )}
      >
        {texto || escribiendo ? (
          <span
            className={cn(
              'pr-borrador wa-scroll relative ml-auto block max-h-[min(9.5rem,24dvh)] touch-pan-y overflow-y-auto whitespace-pre-wrap break-words rounded-[20px] rounded-br-[6px] bg-[var(--wa-out)] px-3.5 py-2.5 text-[16px] leading-[21px] text-[var(--wa-bubble-text)] shadow-[0_10px_30px_-12px_rgba(33,192,99,0.45)] transition-transform duration-150 group-active/borrador:scale-[0.99] lg:text-[14px] lg:leading-[19px]',
              escribiendo && 'pr-borrador-vivo',
            )}
          >
            {texto}
            {escribiendo && <span aria-hidden className="pr-cursor" />}
            {!escribiendo && (
              <PenLine aria-hidden className="ml-1.5 inline size-3.5 -translate-y-px text-white/45" />
            )}
          </span>
        ) : (
          <span className="ml-auto block w-full rounded-[20px] border border-dashed border-white/20 px-3.5 py-3 text-center text-[15px] text-white/55 lg:text-[13px]">
            {sinIa ? 'Tocá para escribir la respuesta' : borrador?.estado === 'error' ? 'Tocá para escribirla vos' : 'Tex la va a escribir en un segundo'}
          </span>
        )}
      </button>
      {borrador?.error && (
        <p className="mt-1.5 text-right text-[12.5px] leading-4 text-[#ffb340]">{borrador.error}</p>
      )}

    </div>
  )
}

export function TarjetaPendiente({
  p,
  ahora,
  borrador,
  ia,
  fondo = false,
  onEditar,
  onAjuste,
  onPedirIgual,
  onVerChat,
}: {
  p: Pendiente
  ahora: number
  borrador?: Borrador
  ia: DisponibilidadTex
  /** Una de las de atrás: sin toques, sin el borrador vivo. */
  fondo?: boolean
  onEditar: () => void
  onAjuste: (a: AjusteBorrador) => void
  onPedirIgual: () => void
  onVerChat: () => void
}) {
  const minutos = minutosEsperando(p, ahora)
  const subtitulo = p.plataforma === 'instagram'
    ? p.usuarioIg ? `@${p.usuarioIg}` : 'Instagram'
    : p.telefono ? formatearTelefonoAr(p.telefono) ?? `+${p.telefono}` : 'WhatsApp'
  const sello = accionDerecha(p, borrador, ahora)
  return (
    <article
      aria-roledescription="tarjeta"
      aria-label={`${p.tipo === 'resena' ? `Reseña de ${p.nota ?? '?'} estrellas` : 'Consulta'} de ${p.nombre}`}
      className="pr-tarjeta relative flex h-full w-full flex-col overflow-hidden rounded-[30px] bg-[#121315] text-white ring-1 ring-white/[0.09] lg:rounded-[24px] lg:bg-[#1b1c1e]"
    >
      {/* El brillo de arriba, como una tarjeta de vidrio. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]" />

      {/* Los sellos del arrastre. */}
      <span aria-hidden className="pr-sello pr-sello-der">{SELLO_DERECHA[sello]}</span>
      <span aria-hidden className="pr-sello pr-sello-izq">LISTO</span>

      <header className="relative flex items-center gap-3 px-4 pb-3 pt-4">
        <Avatar name={p.nombre} size={48} avatarUrl={p.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-semibold leading-6 lg:text-[16px] lg:leading-5">{p.nombre}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-white/55 lg:text-[12.5px]">
            {p.plataforma === 'instagram'
              ? <Instagram aria-hidden className="size-3.5 shrink-0" />
              : <WhatsAppIcon className="size-3.5 shrink-0" />}
            <span className="truncate">{subtitulo}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold tabular-nums lg:text-[12px]', tonoDeEspera(minutos))}>
            {minutos >= 15 && !fondo && <span aria-hidden className="pr-latido size-1.5 rounded-full bg-current" />}
            {haceCuanto(p.esperandoDesde, ahora) || 'recién'}
          </span>
          {!fondo && (
            <button
              type="button"
              data-sin-arrastre=""
              onClick={onVerChat}
              className="-mr-1 flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium text-white/55 outline-none transition-colors hover:text-white/90 active:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <MessageSquareText aria-hidden className="size-3.5" /> Ver chat
            </button>
          )}
        </div>
      </header>

      <div className="relative px-4">
        <Franja p={p} ahora={ahora} />
      </div>

      <Hilo p={p} fondo={fondo} />

      <ZonaRespuesta
        p={p}
        ahora={ahora}
        borrador={borrador}
        ia={ia}
        onEditar={onEditar}
        onAjuste={onAjuste}
        onPedirIgual={onPedirIgual}
        onVerChat={onVerChat}
        fondo={fondo}
      />

    </article>
  )
}

/** Una tarjeta gris mientras carga la primera vez. */
export function TarjetaCargando() {
  return (
    <div className="pr-tarjeta relative flex h-full w-full flex-col overflow-hidden rounded-[30px] bg-[#121315] p-4 ring-1 ring-white/[0.09] lg:rounded-[24px] lg:bg-[#1b1c1e]">
      <div className="flex items-center gap-3">
        <span className="pr-brillo size-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <span className="pr-brillo block h-4 w-2/5 rounded-full" />
          <span className="pr-brillo block h-3 w-1/4 rounded-full" />
        </div>
      </div>
      <span className="pr-brillo mt-4 block h-20 rounded-[20px]" />
      <div className="mt-auto space-y-2">
        <span className="pr-brillo block h-9 w-3/5 rounded-[18px]" />
        <span className="pr-brillo ml-auto block h-14 w-4/5 rounded-[18px]" />
      </div>
    </div>
  )
}
