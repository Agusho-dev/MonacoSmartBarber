'use client'

// La tarjeta de «Por responder» (6/nov/2026; a pantalla completa el 7/nov/2026).
// Pedido del dueño (7/nov): «que las cards ocupen toda la pantalla completa…
// los botones como que están por fuera de la card… quiero que todo se sienta
// como un chat, o sea una card completa». Así que cada tarjeta ES un chat de
// WhatsApp, entero, y se desliza entera:
//   - arriba, cuántas quedan (las rayitas, como las historias), el encabezado
//     del chat («‹», la foto, el nombre y hace cuánto espera, con el color de
//     la urgencia) y, debajo, el caso fijado como un mensaje fijado: la reseña
//     con sus estrellas, el servicio, el barbero y la sucursal, o la consulta;
//   - en el medio, la charla con el fondo y las burbujas del chat de verdad
//     («Sin responder» marca desde dónde espera) y, al final, la respuesta que
//     propone Tex, como una burbuja por salir;
//   - abajo, la barra del chat: «Listo» y «Después» a la izquierda y «Enviar» a
//     la derecha, del lado al que se desliza cada cosa.
// Lo que se ve en la burbuja verde es EXACTAMENTE lo que sale al deslizar.
//
// Sin backdrop-filter adentro: la tarjeta entera se mueve con el dedo y en iOS
// un desenfoque dentro de algo que se transforma se redibuja en cada cuadro.
// Los sellos ENVIAR / LISTO y el tinte los prende el mazo (mazo.tsx) con
// --pr-der y --pr-izq mientras se arrastra, sin renders.

import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  Check, ChevronLeft, Clock3, Handshake, Instagram, MessageCircleQuestion, MessageSquareText, PenLine,
  RefreshCw, SendHorizontal, Star, type LucideIcon,
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
import { nombreLegibleDePlantilla, plantillaDelMarcador } from '../shared/helpers'
import { useDiaLocal } from '../shared/use-dia-local'
import { diaDelMensaje, etiquetaDeDia } from '../inbox/pastilla-fecha'
import type { Borrador, DisponibilidadTex } from './use-borradores'

const HORA = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

// La pastilla de la fecha y de los avisos del chat (la misma que chat-view.tsx).
const PASTILLA = 'rounded-full bg-[var(--wa-date-chip)] px-3 py-[3px] text-[12.5px] font-medium text-[var(--wa-text-2)]'

export type AccionDerecha = 'enviar' | 'escribir' | 'chat' | 'instagram' | 'esperar'

/** Qué hace deslizar a la derecha con esta tarjeta (y qué dicen el sello y el botón verde). */
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

const BOTON_DERECHA: Record<AccionDerecha, { texto: string; icono: LucideIcon }> = {
  enviar: { texto: 'Enviar', icono: SendHorizontal },
  escribir: { texto: 'Escribir', icono: PenLine },
  chat: { texto: 'Abrir chat', icono: MessageSquareText },
  instagram: { texto: 'Instagram', icono: Instagram },
  // Mientras Tex escribe: el mismo «Enviar», apagado (no cambia de ancho al terminar).
  esperar: { texto: 'Enviar', icono: SendHorizontal },
}

function horaDe(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? HORA.format(new Date(t)) : ''
}

function cuandoFue(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const mismoDia = d.toDateString() === new Date().toDateString()
  return mismoDia ? `hoy ${HORA.format(d)}` : `${DIA.format(d)} ${HORA.format(d)}`
}

function Estrellas({ nota, tamano = 15 }: { nota: number; tamano?: number }) {
  return (
    <span role="img" aria-label={`${nota} de 5 estrellas`} className="flex shrink-0 items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          strokeWidth={1.6}
          style={{ width: tamano, height: tamano }}
          className={i <= nota ? 'fill-[#ffb340] text-[#ffb340]' : 'fill-white/[0.06] text-white/25'}
        />
      ))}
    </span>
  )
}

/** El color de lo que lleva esperando: verde hasta 15 min, ámbar hasta 1 h, rojo después. */
function tonoDeEspera(minutos: number): string {
  if (minutos < 15) return 'text-[#4cd884]'
  if (minutos < 60) return 'text-[#ffb340]'
  return 'text-[#ff6961]'
}

function textoDeEspera(p: Pendiente, ahora: number): string {
  const t = haceCuanto(p.esperandoDesde, ahora)
  if (!t || t === 'recién') return 'Recién llegó'
  return t === 'ayer' ? 'Espera desde ayer' : `Espera ${t}`
}

// ── Arriba: cuántas quedan, quién es y el caso ──────────────────────────────

/**
 * Las rayitas de arriba, como las de las historias: verdes las que ya se
 * atendieron en esta pasada, blanca la de ahora y grises las que siguen. Con
 * muchas, una sola barra que se llena.
 */
function Progreso({ total, actual }: { total: number; actual: number }) {
  if (total < 1) return <div className="h-[11px]" />
  const etiqueta = `Tarjeta ${Math.min(actual + 1, total)} de ${total}`
  if (total > 14) {
    return (
      <div role="img" aria-label={etiqueta} className="mx-[22px] mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.16]">
        <div className="h-full rounded-full bg-[var(--wa-accent)]" style={{ width: `${Math.min(100, (actual / total) * 100)}%` }} />
      </div>
    )
  }
  return (
    <div role="img" aria-label={etiqueta} className="mx-[22px] mt-2 flex gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-[3px] min-w-0 flex-1 rounded-full',
            i < actual ? 'bg-[var(--wa-accent)]' : i === actual ? 'bg-white/90' : 'bg-white/[0.16]',
          )}
        />
      ))}
    </div>
  )
}

/** El caso, fijado debajo del encabezado como un mensaje fijado de WhatsApp. */
function CasoFijado({ p, ahora }: { p: Pendiente; ahora: number }) {
  const v = p.visita
  const vencida = estadoVentana(p, ahora).tipo === 'cerrada'
  let acento: string
  let titulo: ReactNode
  let detalle: string
  let correccion: string | null = null
  if (p.tipo === 'resena') {
    const nota = p.nota ?? p.notaFinal
    acento = 'bg-[#ff6961]'
    titulo = nota ? (
      <>
        <Estrellas nota={nota} />
        <span>{nota} de 5</span>
      </>
    ) : (
      <>
        <Star aria-hidden className="size-4 shrink-0 fill-[#ffb340] text-[#ffb340]" strokeWidth={1.6} />
        <span>Reseña sin responder</span>
      </>
    )
    detalle = [v?.servicio, v?.barbero ? `con ${v.barbero.trim()}` : null, v?.sucursal, cuandoFue(v?.at ?? null)]
      .filter(Boolean)
      .join(' · ') || 'Calificó la atención'
    if (p.notaFinal !== null && p.nota !== null && p.notaFinal !== p.nota) {
      correccion = `Enseguida tocó ${p.notaFinal}: puede haber sido sin querer`
    }
  } else if (p.esCierre) {
    acento = 'bg-white/40'
    titulo = (
      <>
        <Handshake aria-hidden className="size-4 shrink-0 text-[#8de0b0]" strokeWidth={2} />
        <span>Parece un cierre de charla</span>
      </>
    )
    detalle = 'Escribió un gracias o un listo'
  } else {
    acento = 'bg-[#64b5ff]'
    titulo = (
      <>
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-[#64b5ff]" strokeWidth={2} />
        <span>{p.pidioHumano ? 'Pidió hablar con alguien' : 'Consulta sin responder'}</span>
      </>
    )
    detalle = p.visitasTotales && p.visitasTotales > 0
      ? `${p.visitasTotales === 1 ? 'Vino 1 vez' : `Vino ${p.visitasTotales} veces`}${v?.barbero ? ` · la última con ${v.barbero.trim()}` : ''}${v?.at ? `, ${haceCuanto(v.at, ahora)}` : ''}`
      : 'Todavía no vino al local'
  }
  return (
    <div className="flex items-center gap-3 border-t-[0.5px] border-[var(--wa-divider)] py-2 pl-4 pr-3 lg:px-4">
      <span aria-hidden className={cn('w-[3px] self-stretch rounded-full', acento)} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-5 text-[var(--wa-text)] lg:text-[14px]">{titulo}</p>
        <p className="truncate text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:text-[12.5px]">{detalle}</p>
        {correccion && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-4 text-[#ffcf7a]">
            <RefreshCw aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{correccion}</span>
          </p>
        )}
      </div>
      {vencida && (
        <span className="shrink-0 rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[11.5px] font-semibold text-[#ffb340]">Vencida</span>
      )}
    </div>
  )
}

// ── El medio: la charla ─────────────────────────────────────────────────────

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

/** Una burbuja de la charla, con las clases del chat (globals.css: .wa-bubble y la colita). */
function Burbuja({ m, colita, fondo }: { m: MensajeDelHilo; colita: boolean; fondo: boolean }) {
  const sale = m.dir === 'outbound'
  const clase = cn('wa-bubble', colita ? (sale ? 'wa-bubble-out' : 'wa-bubble-in') : (sale ? 'wa-fill-out' : 'wa-fill-in'))
  const hora = horaDe(m.at)
  const meta = sale ? 'wa-meta-out' : 'wa-meta-in'

  if (esBotonTocado(m)) {
    // La nota de la reseña llega como el botón «1»…«5»: se ve con sus estrellas.
    const t = (m.texto ?? '').trim()
    const nota = /^[1-5]$/.test(t) ? Number(t) : null
    return (
      <div className={clase}>
        <div className="relative">
          <p className="flex items-center gap-1.5">
            {nota ? (
              <>
                <Estrellas nota={nota} />
                <span className="font-semibold tabular-nums">{nota}</span>
              </>
            ) : (
              <span className="italic">Tocó «{t || 'un botón'}»</span>
            )}
            <span className="wa-spacer" data-hora={hora} aria-hidden />
          </p>
          <span className={cn('wa-meta', meta)}>{hora}</span>
        </div>
      </div>
    )
  }

  const { texto, apagado } = textoDeMensaje(m)
  const esFoto = m.tipo === 'image' && !!m.media && /^https:\/\//.test(m.media)
  // Lo del local se resume (casi siempre es un automático) y lleva la hora en
  // su renglón; lo del cliente se lee entero, con la hora al final del texto.
  return (
    <div className={clase}>
      {esFoto && !fondo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.media ?? ''} alt="" loading="lazy" draggable={false} className="-mx-1 -mt-0.5 mb-1 max-h-52 w-[calc(100%+0.5rem)] rounded-xl object-cover" />
      )}
      {sale ? (
        <>
          <p className={cn('line-clamp-4 whitespace-pre-wrap', apagado && 'italic text-[var(--wa-meta-out)]')}>{texto}</p>
          <div className="mt-0.5 flex justify-end text-[11px] leading-[15px] tabular-nums text-[var(--wa-meta-out)]">{hora}</div>
        </>
      ) : (
        <div className="relative">
          <p className={cn('whitespace-pre-wrap', apagado && 'italic text-[var(--wa-meta-in)]')}>
            {texto}
            <span className="wa-spacer" data-hora={hora} aria-hidden />
          </p>
          <span className={cn('wa-meta', meta)}>{hora}</span>
        </div>
      )}
    </div>
  )
}

/**
 * La charla, como el chat: lo del cliente a la izquierda, lo del local a la
 * derecha, los separadores de día y «Sin responder» antes de lo que espera. Al
 * final va la respuesta (children). Arranca abajo de todo y sigue abajo
 * mientras Tex escribe, salvo que la persona haya subido a leer.
 */
function Hilo({ p, fondo, aviso, children }: { p: Pendiente; fondo: boolean; aviso?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLOListElement>(null)
  const pegada = useRef(true)
  const hoy = useDiaLocal()
  useLayoutEffect(() => {
    const el = ref.current
    const ol = lista.current
    if (!el || !ol) return
    pegada.current = true
    el.scrollTop = el.scrollHeight
    const alScrollear = () => { pegada.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }
    // La lista crece con el borrador que llega; la caja, con el alto de la pantalla.
    const obs = new ResizeObserver(() => { if (pegada.current) el.scrollTop = el.scrollHeight })
    obs.observe(el)
    obs.observe(ol)
    el.addEventListener('scroll', alScrollear, { passive: true })
    return () => {
      obs.disconnect()
      el.removeEventListener('scroll', alScrollear)
    }
  }, [p.id, p.hilo.length])

  const desde = Date.parse(p.esperandoDesde)
  const mensajes = p.hilo
  const espera = mensajes.findIndex((m) => m.dir === 'inbound' && !esMarcaDeRuido(m) && Date.parse(m.at) >= desde - 1000)
  return (
    <div
      ref={ref}
      data-hilo=""
      className={cn(
        'wa-scroll relative z-0 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_14px)]',
        fondo && 'overflow-hidden',
      )}
    >
      <ol ref={lista} className="flex min-h-full flex-col justify-end px-4 pb-[calc(var(--pr-dock)+0.75rem)] pt-4 lg:px-6">
        {aviso && !fondo && <li className="mb-3 flex justify-center">{aviso}</li>}
        {mensajes.map((m, i) => {
          const anterior = mensajes[i - 1]
          const siguiente = mensajes[i + 1]
          const dia = diaDelMensaje(m.at)
          const nuevoDia = !anterior || diaDelMensaje(anterior.at) !== dia
          const ruido = esMarcaDeRuido(m)
          const primeroDeTanda = nuevoDia || i === espera || !anterior || anterior.dir !== m.dir
          const ultimoDeTanda = !siguiente || siguiente.dir !== m.dir || i + 1 === espera || diaDelMensaje(siguiente.at) !== dia
          return (
            <Fragment key={m.id}>
              {nuevoDia && (
                <li className="flex justify-center py-2">
                  <span className={PASTILLA}>{etiquetaDeDia(new Date(m.at), hoy)}</span>
                </li>
              )}
              {i === espera && (
                <li className="flex justify-center py-2">
                  <span className={cn(PASTILLA, 'font-semibold text-[#ffb340]')}>Sin responder</span>
                </li>
              )}
              <li className={cn('flex', m.dir === 'inbound' ? 'justify-start' : 'justify-end', primeroDeTanda ? 'mt-2' : 'mt-0.5')}>
                {ruido ? (
                  // «[Reacción: …]», «[Sticker]»: marcas de los webhooks, no mensajes.
                  <span className={PASTILLA}>{(m.texto ?? '').replace(/^\[|\]$/g, '')}</span>
                ) : (
                  <Burbuja m={m} colita={ultimoDeTanda} fondo={fondo} />
                )}
              </li>
            </Fragment>
          )
        })}
        {children}
      </ol>
    </div>
  )
}

/** Un aviso del chat, centrado, como el de «Los mensajes están cifrados». */
function AvisoDelChat({ icono: Icono, tono = 'neutro', children }: { icono: LucideIcon; tono?: 'neutro' | 'ambar'; children: ReactNode }) {
  return (
    <p className="mx-auto flex max-w-[21rem] items-start gap-2 rounded-2xl bg-[var(--wa-date-chip)] px-3.5 py-2.5 text-left text-[13.5px] leading-[18px] text-[var(--wa-text-2)] shadow-sm lg:text-[12.5px] lg:leading-[17px]">
      <Icono aria-hidden className={cn('mt-px size-4 shrink-0', tono === 'ambar' ? 'text-[#ffb340]' : 'text-[#8de0b0]')} strokeWidth={2} />
      <span>{children}</span>
    </p>
  )
}

function Chip({ children, onClick, icono: Icono, deshabilitado = false }: {
  children: string
  onClick: () => void
  icono?: LucideIcon
  deshabilitado?: boolean
}) {
  return (
    <button
      type="button"
      data-sin-arrastre=""
      onClick={onClick}
      disabled={deshabilitado}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--wa-date-chip)] px-3.5 text-[14px] font-medium text-[var(--wa-accent)] shadow-sm outline-none transition-[background-color,transform,opacity] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.97] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:px-3 lg:text-[13px]"
    >
      {Icono && <Icono aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
      {children}
    </button>
  )
}

/**
 * La respuesta, al final de la charla: el borrador de Tex como una burbuja por
 * salir (con «Otra» arriba, y abajo cuánto queda para contestar y «Editar»), o
 * el aviso de por qué no se puede contestar desde acá.
 */
function Respuesta({
  p, ahora, borrador, ia, onEditar, onAjuste, onPedirIgual, fondo,
}: {
  p: Pendiente
  ahora: number
  borrador?: Borrador
  ia: DisponibilidadTex
  onEditar: () => void
  onAjuste: (a: AjusteBorrador) => void
  onPedirIgual: () => void
  fondo: boolean
}) {
  const ventana = estadoVentana(p, ahora)
  if (ventana.tipo === 'cerrada') {
    return (
      <li className="flex justify-center pt-4">
        <AvisoDelChat icono={Clock3} tono="ambar">
          {p.plataforma === 'instagram'
            ? 'Pasaron más de 24 horas: Instagram ya no deja contestar desde acá. Desde la app de Instagram, sí.'
            : 'Pasaron más de 24 horas desde su último mensaje: WhatsApp sólo deja mandarle una plantilla, desde el chat.'}
        </AvisoDelChat>
      </li>
    )
  }

  // Un cierre de charla (lo decide la lista, o el servidor al pedir el borrador: 422 'cierre').
  if ((p.esCierre && !borrador) || borrador?.estado === 'cierre') {
    return (
      <li className="flex flex-col items-center gap-2.5 pt-4">
        <AvisoDelChat icono={Handshake}>No hace falta responder: deslizá a la izquierda para marcarla como lista.</AvisoDelChat>
        <Chip onClick={onPedirIgual} icono={PenLine} deshabilitado={fondo}>Responder igual</Chip>
      </li>
    )
  }

  const escribiendo = borrador?.estado === 'escribiendo'
  const texto = borrador?.texto ?? ''
  const sinIa = ia !== 'si'
  const etiqueta = borrador?.editado ? 'Tu respuesta' : escribiendo ? 'Tex está escribiendo…' : texto ? 'Borrador de Tex' : 'Tu respuesta'
  const puedeOtra = !sinIa && !fondo && !escribiendo && (!!texto || borrador?.estado === 'error')
  return (
    <li className="flex flex-col items-end pt-3">
      {texto || escribiendo ? (
        <div
          className={cn(
            // Sin colita: todavía no salió. El borde verde y el brillo la separan de lo enviado.
            'wa-bubble wa-fill-out pr-borrador w-fit min-w-[11rem] max-w-[88%] shadow-[0_12px_32px_-12px_rgba(33,192,99,0.6)] ring-1 ring-[#4cd884]/40 lg:max-w-[80%]',
            escribiendo && 'pr-borrador-vivo',
          )}
        >
          <div className="-mt-0.5 mb-1 flex min-h-6 items-center gap-1.5 text-[12.5px] font-medium text-[var(--wa-meta-out)]">
            {sinIa || borrador?.editado ? (
              <PenLine aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <TexCara tamano={24} estado={escribiendo ? (texto ? 'hablando' : 'pensando') : 'reposo'} texto={texto} />
            )}
            <span className="min-w-0 truncate">{etiqueta}</span>
            {puedeOtra && (
              <button
                type="button"
                data-sin-arrastre=""
                onClick={() => onAjuste('otra')}
                aria-label="Que Tex escriba otra versión"
                title="Otra versión"
                className="-my-1 -mr-1.5 ml-auto flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12.5px] font-semibold text-[#a6f0c4] outline-none transition-colors active:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50 lg:hover:bg-white/[0.08]"
              >
                <RefreshCw aria-hidden className="size-3.5" /> Otra
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onEditar}
            disabled={fondo}
            aria-label={`Editar la respuesta: ${texto}`}
            className="block w-full rounded-md text-left outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <span className="block whitespace-pre-wrap">
              {texto}
              {escribiendo && <span aria-hidden className="pr-cursor" />}
            </span>
          </button>
          <div className="mt-1.5 flex items-center justify-end gap-3 text-[11.5px] leading-4 text-[var(--wa-meta-out)]">
            <span className={cn('flex items-center gap-1 tabular-nums', ventana.porCerrar && 'font-semibold text-[#ffcf7a]')}>
              <Clock3 aria-hidden className="size-3" /> {textoVentana(ventana)}
            </span>
            {!escribiendo && (
              <button
                type="button"
                data-sin-arrastre=""
                onClick={onEditar}
                disabled={fondo}
                aria-keyshortcuts="E"
                className="-my-1.5 -mr-1.5 flex h-7 items-center gap-1 rounded-full px-2 font-semibold text-[#a6f0c4] outline-none transition-colors active:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50 lg:hover:bg-white/[0.08]"
              >
                <PenLine aria-hidden className="size-3" /> Editar
                <kbd className="ml-0.5 hidden rounded border border-white/20 px-1 font-sans text-[10px] leading-[14px] text-white/55 lg:inline">E</kbd>
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEditar}
          disabled={fondo}
          className="w-[88%] rounded-2xl border border-dashed border-white/25 bg-black/35 px-4 py-3 text-center text-[15px] text-white/75 outline-none [-webkit-tap-highlight-color:transparent] active:bg-black/50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:w-[80%] lg:text-[13.5px]"
        >
          {sinIa ? 'Tocá para escribir la respuesta' : borrador?.estado === 'error' ? 'Tex no pudo: tocá para escribirla vos' : 'Tex la está por escribir…'}
        </button>
      )}
      {borrador?.error && (
        <p className="mt-1.5 max-w-[88%] text-right text-[12.5px] leading-4 text-[#ffb340]">{borrador.error}</p>
      )}
    </li>
  )
}

// ── Abajo: la barra del chat ────────────────────────────────────────────────

function BotonDeLaBarra({ etiqueta, icono: Icono, atajo, ocultarTexto = false, onClick }: {
  etiqueta: string
  icono: LucideIcon
  atajo: string
  ocultarTexto?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      aria-keyshortcuts={atajo === '←' ? 'ArrowLeft' : 'ArrowDown'}
      className="flex h-full items-center gap-1.5 rounded-full px-4 text-[15px] font-medium text-white/90 outline-none transition-colors [-webkit-tap-highlight-color:transparent] active:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 lg:px-3.5 lg:text-[13.5px] lg:hover:bg-white/[0.07]"
    >
      <Icono aria-hidden className="size-[18px] shrink-0" strokeWidth={2.3} />
      <span className={cn(ocultarTexto && 'max-[379px]:sr-only')}>{etiqueta}</span>
      <kbd className="hidden rounded border border-white/15 px-1 font-sans text-[10.5px] leading-4 text-white/45 lg:inline">{atajo}</kbd>
    </button>
  )
}

/**
 * La barra de abajo, como la del chat: «Listo» y «Después» a la izquierda y la
 * acción verde a la derecha (el lado al que se desliza). Flota sobre la charla,
 * que pasa por debajo con un velo; su alto es --pr-dock (globals.css).
 */
function BarraDeAcciones({ accion, onListo, onDespues, onDerecha }: {
  accion: AccionDerecha
  onListo: () => void
  onDespues: () => void
  onDerecha: () => void
}) {
  const { texto, icono: Icono } = BOTON_DERECHA[accion]
  const esperando = accion === 'esperar'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,rgba(0,0,0,0.82),rgba(0,0,0,0.5)_55%,transparent)] pt-7">
      <div className="pointer-events-auto flex items-center justify-between gap-3 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] pt-2.5 lg:px-4 lg:pb-3.5 lg:pt-3">
        <div className="flex h-12 items-center rounded-full bg-[rgba(36,36,38,0.94)] p-1 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.09] lg:h-11">
          <BotonDeLaBarra etiqueta="Listo" icono={Check} atajo="←" onClick={onListo} />
          <span aria-hidden className="h-5 w-px shrink-0 bg-white/[0.12]" />
          <BotonDeLaBarra etiqueta="Después" icono={Clock3} atajo="↓" ocultarTexto onClick={onDespues} />
        </div>
        <button
          type="button"
          onClick={onDerecha}
          aria-label={esperando ? 'Tex todavía está escribiendo' : texto}
          aria-keyshortcuts="ArrowRight"
          className={cn(
            'flex h-12 shrink-0 items-center gap-2 rounded-full bg-[var(--wa-accent)] pl-5 pr-4 text-[16px] font-semibold text-[var(--wa-on-accent)] shadow-[0_14px_30px_-12px_rgba(33,192,99,0.85)] outline-none transition-[transform,background-color,opacity] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-95 focus-visible:ring-2 focus-visible:ring-white/70 lg:h-11 lg:pl-4 lg:pr-3.5 lg:text-[14px] lg:hover:bg-[var(--wa-accent-hover)]',
            esperando && 'opacity-50',
          )}
        >
          {texto}
          <Icono aria-hidden className={cn('size-5 shrink-0', Icono === SendHorizontal && 'translate-x-px')} strokeWidth={2.3} />
          <kbd className="hidden rounded border border-black/20 px-1 font-sans text-[10.5px] leading-4 text-black/55 lg:inline">→</kbd>
        </button>
      </div>
    </div>
  )
}

// ── La tarjeta ──────────────────────────────────────────────────────────────

// La forma de la tarjeta: a sangre en el celular (las esquinas se ven cuando
// se la arrastra), con su borde en la compu.
const FORMA = 'pr-tarjeta relative isolate flex h-full w-full flex-col overflow-hidden rounded-[30px] bg-[var(--wa-wallpaper-base)] text-[var(--wa-text)] lg:rounded-[22px] lg:ring-1 lg:ring-white/[0.08]'
// El encabezado, casi opaco sobre el fondo del chat (sin desenfoque: ver arriba).
const ENCABEZADO = 'relative z-20 shrink-0 bg-[rgba(14,14,14,0.95)] lg:bg-[rgba(22,23,23,0.96)]'

function BotonVolver({ onVolver }: { onVolver: () => void }) {
  return (
    <button
      type="button"
      data-sin-arrastre=""
      onClick={onVolver}
      aria-label="Volver a los chats"
      className="flex h-11 shrink-0 items-center pr-0.5 text-[var(--wa-accent)] outline-none transition-opacity [-webkit-tap-highlight-color:transparent] active:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 rounded-lg lg:hidden"
    >
      <ChevronLeft aria-hidden className="size-[30px]" strokeWidth={2.25} />
    </button>
  )
}

export function TarjetaPendiente({
  p,
  ahora,
  borrador,
  ia,
  fondo = false,
  progreso,
  menu,
  aviso,
  onVolver,
  onEditar,
  onAjuste,
  onPedirIgual,
  onVerChat,
  onListo,
  onDespues,
  onDerecha,
}: {
  p: Pendiente
  ahora: number
  borrador?: Borrador
  ia: DisponibilidadTex
  /** Una de las de atrás: sin toques, sin el borrador vivo. */
  fondo?: boolean
  /** Las rayitas de arriba: cuántas hay en la pila y cuál es ésta (0 = la primera). */
  progreso: { total: number; actual: number }
  /** El «…» de la pila (sólo en la de arriba, sólo en el celular). */
  menu?: ReactNode
  /** Un aviso arriba de la charla (activar los avisos), sólo en la de arriba. */
  aviso?: ReactNode
  /** El «‹» del celular. */
  onVolver?: (() => void) | null
  onEditar: () => void
  onAjuste: (a: AjusteBorrador) => void
  onPedirIgual: () => void
  onVerChat: () => void
  onListo: () => void
  onDespues: () => void
  onDerecha: () => void
}) {
  const minutos = minutosEsperando(p, ahora)
  const accion = accionDerecha(p, borrador, ahora)
  return (
    <article
      aria-roledescription="tarjeta"
      aria-label={`${p.tipo === 'resena' ? `Reseña de ${p.nota ?? '?'} estrellas` : 'Consulta'} de ${p.nombre}`}
      className={FORMA}
    >
      <div aria-hidden className="wa-wallpaper absolute inset-0" />

      {/* Los sellos del arrastre. */}
      <span aria-hidden className="pr-sello pr-sello-der">{SELLO_DERECHA[accion]}</span>
      <span aria-hidden className="pr-sello pr-sello-izq">LISTO</span>

      <header className={ENCABEZADO}>
        <Progreso total={progreso.total} actual={progreso.actual} />
        <div className="flex h-[52px] items-center gap-1 pl-0.5 pr-1.5 lg:h-14 lg:gap-2 lg:px-3">
          {onVolver && <BotonVolver onVolver={onVolver} />}
          <button
            type="button"
            onClick={onVerChat}
            disabled={fondo}
            aria-label={`Abrir el chat con ${p.nombre}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 text-left outline-none transition-opacity [-webkit-tap-highlight-color:transparent] active:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:gap-3 lg:hover:opacity-90"
          >
            <Avatar name={p.nombre} size={36} avatarUrl={p.avatarUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16.5px] font-semibold leading-[1.25] lg:text-[15px]">{p.nombre}</span>
              <span className={cn('flex min-w-0 items-center gap-1 text-[12.5px] font-medium leading-[1.3]', tonoDeEspera(minutos))}>
                {p.plataforma === 'instagram'
                  ? <Instagram aria-hidden className="size-3 shrink-0" />
                  : <WhatsAppIcon className="size-3 shrink-0" />}
                <span className="truncate">{textoDeEspera(p, ahora)}</span>
                {minutos >= 15 && !fondo && <span aria-hidden className="pr-latido ml-0.5 size-1.5 shrink-0 rounded-full bg-current" />}
              </span>
            </span>
          </button>
          <button
            type="button"
            data-sin-arrastre=""
            onClick={onVerChat}
            disabled={fondo}
            aria-label="Abrir el chat"
            title="Abrir el chat"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-accent)] outline-none transition-colors [-webkit-tap-highlight-color:transparent] active:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:size-9 lg:hover:bg-[var(--wa-hover)]"
          >
            <MessageSquareText aria-hidden className="size-[22px] lg:size-5" strokeWidth={2} />
          </button>
          {menu ?? <span aria-hidden className="size-10 shrink-0 lg:hidden" />}
        </div>
        <CasoFijado p={p} ahora={ahora} />
      </header>

      <Hilo p={p} fondo={fondo} aviso={aviso}>
        <Respuesta
          p={p}
          ahora={ahora}
          borrador={borrador}
          ia={ia}
          onEditar={onEditar}
          onAjuste={onAjuste}
          onPedirIgual={onPedirIgual}
          fondo={fondo}
        />
      </Hilo>

      <BarraDeAcciones accion={accion} onListo={onListo} onDespues={onDespues} onDerecha={onDerecha} />
    </article>
  )
}

/** La tarjeta gris mientras carga la primera vez (con el «‹» de verdad). */
export function TarjetaCargando({ onVolver }: { onVolver?: (() => void) | null }) {
  return (
    <div className={FORMA}>
      <div aria-hidden className="wa-wallpaper absolute inset-0 opacity-60" />
      <div className={ENCABEZADO}>
        <div className="mx-[22px] mt-2 h-[3px] rounded-full bg-white/[0.12]" />
        <div className="flex h-[52px] items-center gap-2.5 pl-0.5 pr-3 lg:h-14 lg:px-3">
          {onVolver && <BotonVolver onVolver={onVolver} />}
          <span className="pr-brillo size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <span className="pr-brillo block h-3.5 w-2/5 rounded-full" />
            <span className="pr-brillo block h-3 w-1/4 rounded-full" />
          </div>
        </div>
        <div className="space-y-1.5 border-t-[0.5px] border-[var(--wa-divider)] px-4 py-2.5">
          <span className="pr-brillo block h-3.5 w-3/5 rounded-full" />
          <span className="pr-brillo block h-3 w-2/5 rounded-full" />
        </div>
      </div>
      <div className="relative z-10 mt-auto space-y-2 px-4 pb-[calc(var(--pr-dock)+0.75rem)] lg:px-6">
        <span className="pr-brillo block h-10 w-3/5 rounded-2xl" />
        <span className="pr-brillo ml-auto block h-16 w-4/5 rounded-2xl" />
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-3 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] pt-2.5 lg:px-4 lg:pb-3.5 lg:pt-3">
        <span className="pr-brillo h-12 w-52 rounded-full lg:h-11" />
        <span className="pr-brillo h-12 w-28 rounded-full lg:h-11" />
      </div>
    </div>
  )
}
