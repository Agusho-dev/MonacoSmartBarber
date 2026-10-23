'use client'

// Mensajes programados (inboxTab = 'scheduled'). En el celular es una CAPA
// sobre la lista de chats, como el chat y las secciones (barra-ios.tsx): entra
// desde la derecha, se vuelve con "‹ Chats" o deslizando desde el borde, y la
// lista queda debajo, quieta. En la compu ocupa la columna de la lista y la
// conversación abierta sigue a la derecha.
//
// Arriba los que todavía no salieron, del más próximo al más lejano (se pueden
// cancelar); abajo los últimos enviados o fallidos, del más nuevo al más viejo:
// es lo que trae leerProgramados (src/lib/mensajeria/programados.ts). Al abrirse
// la lista se vuelve a leer: el cron los manda mientras la pantalla está abierta.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarClock, CalendarPlus, Clock, LayoutTemplate, RefreshCw, X } from 'lucide-react'
import { obtenerProgramados } from '@/lib/actions/programados'
import { cn } from '@/lib/utils'
import { Avatar } from '../shared/avatar'
import { formatFechaHora, nombreLegibleDePlantilla, plantillaDelMarcador } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import type { ScheduledWithRelations } from '../shared/types'
import { BarraIos, CLASE_CAPA_IOS, useCapaIos } from '../navegacion/barra-ios'

const ESTADO: Record<string, { texto: string; clase: string }> = {
  sent: { texto: 'Enviado', clase: 'bg-[var(--wa-accent)]/15 text-[var(--wa-accent)]' },
  failed: { texto: 'Falló', clase: 'bg-[var(--wa-danger)]/15 text-[var(--wa-danger)]' },
}

const porFecha = (a: ScheduledWithRelations, b: ScheduledWithRelations) =>
  Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for)

export function VistaProgramados({ onVolver, onProgramar }: { onVolver: () => void; onProgramar: () => void }) {
  const { scheduled, setScheduled, handleCancelScheduled } = useMensajeria()
  const { capaRef, volver } = useCapaIos<HTMLElement>(onVolver)
  const [lectura, setLectura] = useState<{ pedido: number; error: string | null }>({ pedido: 0, error: null })

  // Al abrirse (y con "Reintentar"), la lista se vuelve a leer con el mismo
  // alcance que la página. Si falla se queda la que había, y se dice.
  useEffect(() => {
    let vigente = true
    obtenerProgramados()
      .then((r) => {
        if (!vigente) return
        if (r.error) setLectura((l) => ({ ...l, error: r.error }))
        else {
          setScheduled(r.data)
          setLectura((l) => (l.error ? { ...l, error: null } : l))
        }
      })
      .catch(() => {
        if (vigente) setLectura((l) => ({ ...l, error: 'No pudimos actualizar la lista' }))
      })
    return () => { vigente = false }
  }, [lectura.pedido, setScheduled])

  const pendientes = useMemo(() => scheduled.filter((m) => m.status === 'pending').sort(porFecha), [scheduled])
  const anteriores = useMemo(
    () => scheduled.filter((m) => m.status !== 'pending').sort((a, b) => porFecha(b, a)),
    [scheduled],
  )

  return (
    <section
      ref={capaRef}
      aria-label="Mensajes programados"
      // El shell cambia de sección deslizando de costado: acá no.
      data-sin-swipe=""
      className={cn(
        // Sin overflow en el celular: recortaría el oscurecido de wa-capa, que
        // se dibuja a su izquierda (globals.css).
        'wa-capa flex min-h-0 w-full shrink-0 flex-col bg-[var(--wa-bg)] lg:w-[var(--ancho-lista)] lg:overflow-clip lg:border-r lg:border-[var(--wa-divider)]',
        CLASE_CAPA_IOS,
      )}
    >
      <BarraIos titulo="Mensajes programados" onVolver={volver} className="lg:h-14" />
      <div
        className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain max-lg:touch-pan-y max-lg:touch-pinch-zoom"
        // La capa llega hasta el borde de abajo: que la rayita de inicio no tape el último.
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        {/* Como "Nuevo grupo" en la pantalla de chat nuevo de WhatsApp: una fila con el ícono verde. */}
        <button
          type="button"
          onClick={onProgramar}
          className="flex w-full items-center gap-3 pl-4 text-left outline-none [-webkit-tap-highlight-color:transparent] transition-colors duration-100 active:bg-[var(--wa-hover)] focus-visible:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)] lg:mx-2 lg:mt-1 lg:w-[calc(100%-1rem)] lg:rounded-xl lg:pl-3 lg:hover:bg-[var(--wa-hover)]"
        >
          <span className="flex size-13 shrink-0 items-center justify-center rounded-full bg-[var(--wa-accent)] text-[var(--wa-on-accent)] lg:size-12">
            <CalendarPlus aria-hidden className="size-6" strokeWidth={2} />
          </span>
          <span className="flex min-h-[64px] flex-1 items-center border-b-[0.5px] border-[var(--wa-divider)] pr-4 text-[17px] font-medium text-[var(--wa-accent)] lg:min-h-[60px] lg:border-transparent lg:text-[15px]">
            Programar mensaje
          </span>
        </button>

        {lectura.error && (
          <div role="status" className="mx-4 mt-3 flex items-center gap-3 rounded-xl bg-[var(--wa-danger)]/10 px-3.5 py-2.5 text-[14px] text-[var(--wa-danger)] lg:mx-3 lg:text-[13px]">
            <span className="min-w-0 flex-1">{lectura.error}</span>
            <button
              type="button"
              onClick={() => setLectura((l) => ({ pedido: l.pedido + 1, error: l.error }))}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium outline-none transition-colors hover:bg-[var(--wa-danger)]/15 focus-visible:ring-2 focus-visible:ring-[var(--wa-danger)]/50"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Reintentar
            </button>
          </div>
        )}

        {scheduled.length === 0 ? (
          <div className="flex flex-col items-center px-8 pb-10 pt-16 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[var(--wa-field)]">
              <CalendarClock aria-hidden className="size-7 text-[var(--wa-text-2)]" strokeWidth={1.8} />
            </span>
            <p className="mt-4 text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">Sin mensajes programados</p>
            <p className="mt-1 max-w-xs text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">
              Un mensaje programado sale solo, el día y a la hora que elijas.
            </p>
          </div>
        ) : (
          <>
            {pendientes.length > 0 && (
              <Grupo titulo="Por salir">
                {pendientes.map((msg, i) => (
                  <FilaProgramado key={msg.id} msg={msg} ultima={i === pendientes.length - 1} onCancelar={handleCancelScheduled} />
                ))}
              </Grupo>
            )}
            {anteriores.length > 0 && (
              <Grupo titulo="Enviados y fallidos">
                {anteriores.map((msg, i) => (
                  <FilaProgramado key={msg.id} msg={msg} ultima={i === anteriores.length - 1} />
                ))}
              </Grupo>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="pt-4">
      <h2 className="px-4 pb-1 text-[13px] font-semibold text-[var(--wa-text-2)] lg:px-5 lg:text-[12px]">{titulo}</h2>
      <ul>{children}</ul>
    </section>
  )
}

function FilaProgramado({
  msg,
  ultima,
  onCancelar,
}: {
  msg: ScheduledWithRelations
  ultima: boolean
  /** Sólo los pendientes se pueden cancelar. */
  onCancelar?: (id: string) => void
}) {
  const estado = ESTADO[msg.status]
  const nombre = msg.client?.name || 'Cliente'
  // Casi todos los de difusiones y reseñas salen con una plantilla y sin texto
  // propio: se muestra cuál, legible ("Plantilla · resenia").
  const marcador = plantillaDelMarcador(msg.content)
  const plantilla = marcador ?? (msg.content ? null : msg.template_name ?? null)
  const texto = plantilla !== null ? null : msg.content
  return (
    <li className="flex gap-3 pl-4 lg:mx-2 lg:pl-3">
      <span className="shrink-0 pt-3">
        <Avatar name={nombre} size={52} className="lg:size-12 lg:text-[18px]" />
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 space-y-1 border-b-[0.5px] py-3 pr-4 lg:pr-3',
          ultima ? 'border-transparent' : 'border-[var(--wa-divider)]',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">
            {nombre}
          </span>
          {estado && (
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium', estado.clase)}>
              {estado.texto}
            </span>
          )}
        </div>
        {plantilla !== null ? (
          <p className="flex items-center gap-1.5 text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[14px]">
            <LayoutTemplate aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{plantilla ? `Plantilla · ${nombreLegibleDePlantilla(plantilla)}` : 'Plantilla'}</span>
          </p>
        ) : texto ? (
          <p className="line-clamp-2 text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[14px]">{texto}</p>
        ) : null}
        {msg.status === 'failed' && msg.error_message && (
          <p className="line-clamp-2 text-[13px] leading-snug text-[var(--wa-danger)]">{msg.error_message}</p>
        )}
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <span className="flex items-center gap-1.5 text-[13px] tabular-nums text-[var(--wa-text-2)]">
            <Clock aria-hidden className="size-3.5" />
            {formatFechaHora(msg.scheduled_for)}
          </span>
          {onCancelar && (
            <button
              type="button"
              onClick={() => onCancelar(msg.id)}
              className="-mr-1 flex h-8 items-center gap-1 rounded-full px-2.5 text-[14px] font-medium text-[var(--wa-danger)] outline-none transition-colors active:bg-[var(--wa-danger)]/15 focus-visible:ring-2 focus-visible:ring-[var(--wa-danger)]/50 lg:h-7 lg:text-[13px] lg:hover:bg-[var(--wa-danger)]/10"
            >
              <X aria-hidden className="size-4" />
              Cancelar
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
