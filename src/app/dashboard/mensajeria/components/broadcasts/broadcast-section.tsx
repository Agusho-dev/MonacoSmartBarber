'use client'

// Difusiones, como una pantalla de WhatsApp para iOS (23/oct/2026, tercera
// ronda): una lista agrupada con una celda por difusión (el ícono del color de
// su estado, el nombre, la plantilla con su nombre legible, la audiencia, el
// estado y la fecha en 24 h) y sus acciones de 44 px. En la compu, la misma
// lista con la piel de WhatsApp para Mac, en una columna. La nueva difusión es
// una hoja (asistente-difusion.tsx): en el celular, la de iOS de pantalla
// entera; en la compu, el diálogo de la Mac.

import { useEffect, useState, useTransition } from 'react'
import { CalendarClock, LayoutTemplate, Megaphone, Plus, RefreshCw, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { cancelBroadcast, getBroadcasts, sendBroadcast } from '@/lib/actions/broadcasts'
import { cn } from '@/lib/utils'
import { formatFechaHora, formatRelativeDate } from '../shared/helpers'
import { useDiaLocal } from '../shared/use-dia-local'
import { AccionDeBarraIos, BotonMasIos, BotonPrincipal, EncabezadoSeccion } from '../navegacion/barra-ios'
import {
  BotonPildoraIos, BotonTextoCeldaIos, CargandoIos, CLASE_CELDA, CLASE_CUERPO, ConfirmacionIos, ContenidoSeccion,
  GrupoIos, IconoCeldaIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos, avisarFalla, nombreDePlantilla,
  type ColorIcono,
} from '../navegacion/lista-ios'
import { AsistenteDifusion, type Difusion } from './asistente-difusion'

const ESTADO: Record<string, { texto: string; color: ColorIcono; clase: string }> = {
  draft: { texto: 'Borrador', color: 'gris', clase: 'text-[var(--wa-text-2)]' },
  scheduled: { texto: 'Programada', color: 'azul', clase: 'text-[#5aaeff]' },
  sending: { texto: 'Enviando', color: 'naranja', clase: 'text-[#ffa733]' },
  sent: { texto: 'Enviada', color: 'verde', clase: 'text-[var(--wa-accent)]' },
  cancelled: { texto: 'Cancelada', color: 'gris', clase: 'text-[var(--wa-text-2)]' },
}

export function BroadcastSection() {
  const [broadcasts, setBroadcasts] = useState<Difusion[]>([])
  const [lectura, setLectura] = useState<{ pedido: number; cargando: boolean; error: string | null }>({ pedido: 0, cargando: true, error: null })
  // Cada apertura del asistente lo monta de nuevo (vez): arranca vacío.
  const [asistente, setAsistente] = useState({ abierto: false, vez: 0 })
  // La difusión a cancelar sigue guardada mientras la confirmación se cierra
  // (si no, el texto se vaciaba en la animación de salida).
  const [aCancelar, setACancelar] = useState<{ difusion: Difusion; abierta: boolean } | null>(null)
  const [isSending, startSending] = useTransition()
  // La fecha de cada celda ("14:32", "Ayer", "martes") cambia sola a la medianoche.
  const dia = useDiaLocal()

  // Load broadcasts (y con «Reintentar»)
  useEffect(() => {
    let vigente = true
    getBroadcasts()
      .then(result => {
        if (!vigente) return
        if (result.data) setBroadcasts(result.data as Difusion[])
        setLectura(l => ({ ...l, cargando: false, error: result.error }))
      })
      .catch(() => {
        if (vigente) setLectura(l => ({ ...l, cargando: false, error: 'No pudimos leer las difusiones. Revisá la conexión.' }))
      })
    return () => { vigente = false }
  }, [lectura.pedido])

  const abrirAsistente = () => setAsistente(a => ({ abierto: true, vez: a.vez + 1 }))

  const handleSend = (difusion: Difusion) => {
    startSending(async () => {
      try {
        const result = await sendBroadcast(difusion.id)
        if (result.error) { toast.error(result.error); return }
        toast.success(
          difusion.scheduled_for
            ? `Programada para ${result.recipientCount} destinatarios`
            : `Enviando a ${result.recipientCount} destinatarios`,
        )
        // El mismo estado que deja sendBroadcast: con fecha queda programada.
        setBroadcasts(prev => prev.map(b => b.id === difusion.id
          ? { ...b, status: b.scheduled_for ? 'scheduled' : 'sending', audience_count: result.recipientCount ?? b.audience_count }
          : b))
      } catch (e) {
        avisarFalla(e, 'No se pudo enviar la difusión. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleCancel = async (id: string) => {
    try {
      const result = await cancelBroadcast(id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Difusión cancelada')
      setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b))
    } catch (e) {
      avisarFalla(e, 'No se pudo cancelar la difusión. Revisá la conexión y probá de nuevo.')
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AccionDeBarraIos>
        <BotonMasIos etiqueta="Nueva difusión" onClick={abrirAsistente} />
      </AccionDeBarraIos>
      <EncabezadoSeccion titulo="Difusiones">
        <BotonPrincipal onClick={abrirAsistente}>
          <Plus aria-hidden className="size-3.5" strokeWidth={2.5} /> Nueva difusión
        </BotonPrincipal>
      </EncabezadoSeccion>

      <ContenidoSeccion>
        {lectura.cargando && broadcasts.length === 0 ? (
          <CargandoIos texto="Cargando difusiones…" />
        ) : lectura.error && broadcasts.length === 0 ? (
          <VacioIos icono={Megaphone} titulo="No pudimos leer las difusiones" texto={lectura.error}>
            <BotonPildoraIos icono={RefreshCw} onClick={() => setLectura(l => ({ pedido: l.pedido + 1, cargando: true, error: null }))}>
              Reintentar
            </BotonPildoraIos>
          </VacioIos>
        ) : broadcasts.length === 0 ? (
          <VacioIos
            icono={Megaphone}
            titulo="Sin difusiones"
            texto="Una difusión le manda una plantilla de WhatsApp a muchos clientes a la vez."
          >
            <BotonPildoraIos icono={Plus} onClick={abrirAsistente}>Nueva difusión</BotonPildoraIos>
          </VacioIos>
        ) : (
          <GrupoIos pie={broadcasts.length >= 50 ? 'Las últimas 50.' : undefined}>
            {broadcasts.map(b => (
              <CeldaDifusion
                key={b.id}
                difusion={b}
                dia={dia}
                enviando={isSending}
                onEnviar={() => handleSend(b)}
                onCancelar={() => setACancelar({ difusion: b, abierta: true })}
              />
            ))}
          </GrupoIos>
        )}
      </ContenidoSeccion>

      <AsistenteDifusion
        key={asistente.vez}
        open={asistente.abierto}
        onOpenChange={(abierto) => setAsistente(a => ({ ...a, abierto }))}
        onCreada={(b) => setBroadcasts(prev => [b, ...prev])}
      />

      <ConfirmacionIos
        abierta={!!aCancelar?.abierta}
        onAbiertaCambio={(abierta) => setACancelar(c => (c ? { ...c, abierta } : c))}
        titulo="¿Cancelar la difusión?"
        texto={aCancelar ? textoDeCancelar(aCancelar.difusion) : ''}
        accion="Cancelar difusión"
        onConfirmar={() => { if (aCancelar) void handleCancel(aCancelar.difusion.id) }}
      />
    </div>
  )
}

/** «1 contacto», «138 contactos». */
function cantidad(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

function textoDeCancelar(b: Difusion): string {
  if (b.status === 'sending') return `De «${b.name}» no sale ningún mensaje más. No se puede deshacer.`
  if (b.status === 'scheduled') {
    const a = b.audience_count > 0 ? ` a ${cantidad(b.audience_count, 'contacto', 'contactos')}` : ''
    return `«${b.name}» no va a salir${a}. No se puede deshacer.`
  }
  return `El borrador «${b.name}» queda cancelado. No se puede deshacer.`
}

function CeldaDifusion({
  difusion: b,
  dia,
  enviando,
  onEnviar,
  onCancelar,
}: {
  difusion: Difusion
  /** El día del navegador (useDiaLocal): null mientras no se sabe. */
  dia: string | null
  enviando: boolean
  onEnviar: () => void
  onCancelar: () => void
}) {
  const estado = ESTADO[b.status] ?? { texto: b.status, color: 'gris' as const, clase: 'text-[var(--wa-text-2)]' }
  const cancelable = b.status === 'draft' || b.status === 'scheduled' || b.status === 'sending'
  const conCuentas = b.status === 'sent' || b.status === 'sending'
  // Una programada (o un borrador con fecha) dice para cuándo; las demás, cuándo se crearon.
  const linea =
    b.status === 'scheduled' && b.scheduled_for
      ? `Programada · sale el ${formatFechaHora(b.scheduled_for)}`
      : b.status === 'draft' && b.scheduled_for
        ? `Borrador · para el ${formatFechaHora(b.scheduled_for)}`
        : b.status === 'sending'
          ? 'Enviando…'
          : estado.texto
  return (
    <li className={cn(CLASE_CELDA, 'items-start')}>
      <IconoCeldaIos icono={b.status === 'scheduled' ? CalendarClock : Megaphone} color={estado.color} className="mt-3 lg:mt-2.5" />
      <div className={cn(CLASE_CUERPO, 'flex-col items-stretch gap-0.5 py-3 lg:py-2.5')}>
        <div className="flex items-baseline gap-3">
          <p className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate font-semibold')}>{b.name}</p>
          {dia && <span className={cn(TEXTO_TERCIARIO, 'shrink-0 tabular-nums')}>{formatRelativeDate(b.created_at)}</span>}
        </div>
        <p className={cn(TEXTO_SECUNDARIO, 'flex min-w-0 items-center gap-1.5')}>
          <LayoutTemplate aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            <span className="sr-only">Plantilla: </span>
            {b.template_name ? nombreDePlantilla(b.template_name) : 'Sin plantilla'}
            {b.audience_count > 0 && ` · ${cantidad(b.audience_count, 'contacto', 'contactos')}`}
          </span>
        </p>
        <p className={cn('text-[15px] leading-5 lg:text-[13px] lg:leading-[18px]', estado.clase)}>{linea}</p>
        {conCuentas && (
          <p className={cn(TEXTO_TERCIARIO, 'tabular-nums')}>
            {cantidad(b.sent_count, 'enviado', 'enviados')} · {cantidad(b.delivered_count, 'entregado', 'entregados')}
            {b.failed_count > 0 && <span className="text-[var(--wa-danger)]"> · {cantidad(b.failed_count, 'fallido', 'fallidos')}</span>}
          </p>
        )}
        {cancelable && (
          <div className="-mb-1.5 mt-0.5 flex items-center gap-4 lg:-mb-1 lg:gap-3">
            {b.status === 'draft' && (
              <BotonTextoCeldaIos
                icono={b.scheduled_for ? CalendarClock : Send}
                onClick={onEnviar}
                deshabilitado={enviando}
                etiqueta={`${b.scheduled_for ? 'Programar' : 'Enviar'} «${b.name}»`}
              >
                {b.scheduled_for ? 'Programar' : 'Enviar'}
              </BotonTextoCeldaIos>
            )}
            <BotonTextoCeldaIos tono="peligro" icono={X} onClick={onCancelar} etiqueta={`Cancelar «${b.name}»`}>
              Cancelar
            </BotonTextoCeldaIos>
          </div>
        )}
      </div>
    </li>
  )
}
