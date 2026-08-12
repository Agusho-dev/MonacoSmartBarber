'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clock, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DIAS_ABREV_3, textoDias, textoRangos } from '@/lib/franjas'
import { glassPanel, glassInteractive } from '../glass'
import { Avatar } from './avatar'
import type { PublicStaff, PublicWalkInStaff } from '@/lib/actions/public-booking'

/**
 * "Elegir barbero", en una hoja que sube desde abajo.
 *
 * El turnero resuelve el barbero solo (la agenda de Monaco es de uno por día),
 * así que esto NO es un paso del wizard: es una salida de emergencia para el
 * cliente que sí tiene con quién se quiere atender. Meterlo como paso obligaba
 * a los demás a decidir algo que el sistema ya sabía.
 *
 * Lo que se muestra de cada uno son sus DÍAS Y HORARIOS REALES de turnos —el
 * cruce de su agenda con lo que la sucursal abre, o sea exactamente lo que el
 * motor va a ofrecer—. Sin eso, elegir barbero es elegir a ciegas y termina en
 * "no hay turnos disponibles" tres pantallas después.
 *
 * Y los que no toman turnos aparecen igual, nombrados: un cliente que no
 * encuentra a su barbero en la lista concluye que el turnero está roto, no que
 * ese barbero atiende por orden de llegada.
 */

interface Props {
  abierto: boolean
  staff: PublicStaff[]
  walkIn: PublicWalkInStaff[]
  /** null = "cualquiera disponible". */
  seleccionado: string | null
  onSeleccionar: (id: string | null) => void
  onCerrar: () => void
}

export function BarberSheet({
  abierto,
  staff,
  walkIn,
  seleccionado,
  onSeleccionar,
  onCerrar,
}: Props) {
  const cerrarRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!abierto) return

    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alTeclear)

    // Sin esto, el scroll del dedo sobre la hoja arrastra la página de atrás
    // (scroll chaining) y el wizard se mueve solo mientras se elige.
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cerrarRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = previo
    }
  }, [abierto, onCerrar])

  // `abierto` arranca en false y sólo lo prende un toque del cliente, así que
  // este return corta antes de tocar `document` en el render del servidor: no
  // hace falta un flag de "ya monté".
  if (!abierto) return null

  function elegir(id: string | null) {
    onSeleccionar(id)
    onCerrar()
  }

  // Va por portal, no donde está escrita. El contenedor del wizard es
  // `relative z-10`, y un z-index distinto de `auto` abre un CONTEXTO DE
  // APILAMIENTO: adentro de él, el z-index de esta hoja no compite con el z-30
  // del header pegajoso — compite contra sus hermanos y pierde. El resultado
  // era el header de la sucursal dibujado por encima del título de la hoja.
  //
  // El destino es la raíz del turnero y NO `document.body`: los tokens `--t-*`
  // se publican como custom properties de ese contenedor, así que fuera de él
  // la hoja se quedaba sin un solo color del tema.
  const hoja = (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="presentation">
      {/* El velo cierra al tocarlo, pero NO es un control anunciable: darle un
          `aria-label="Cerrar"` duplicaba el botón X para un lector de pantalla
          (dos "Cerrar" seguidos, uno de ellos un rectángulo invisible). El
          camino accesible es el botón real; el teclado cierra con Escape. */}
      <div
        aria-hidden
        onClick={onCerrar}
        className="t-veil absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Elegir barbero"
        className="t-sheet relative mx-auto flex max-h-[86vh] w-full max-w-2xl flex-col rounded-t-3xl border-t bg-[var(--t-chrome-bg)] backdrop-blur-2xl pb-[env(safe-area-inset-bottom)]"
        style={{ borderColor: 'var(--t-glass-border-strong)' }}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-3">
          <span
            className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full"
            style={{ backgroundColor: 'var(--t-text-faint)' }}
            aria-hidden
          />
          <div className="mt-3 min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight text-[var(--t-text)]">
              ¿Con quién te querés atender?
            </h2>
            <p className="mt-0.5 text-sm text-[var(--t-text-muted)]">
              Elegir barbero puede achicar los horarios que te quedan.
            </p>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className={cn(
              glassInteractive,
              'mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--t-text)]'
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 pb-6 pt-1">
          <Opcion
            activo={seleccionado === null}
            onClick={() => elegir(null)}
            icono={
              <span
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
              >
                <Users className="h-5 w-5" />
              </span>
            }
            titulo="Cualquiera disponible"
            detalle="Te asignamos al barbero que tenga lugar en el horario que elijas. Es la opción con más horarios."
            recomendado
          />

          {staff.map((s, i) => (
            <Opcion
              key={s.id}
              activo={seleccionado === s.id}
              onClick={() => elegir(s.id)}
              indice={i + 1}
              icono={<Avatar url={s.avatar_url} name={s.full_name} size={44} />}
              titulo={s.full_name}
              detalle={s.days.length ? `Toma turnos ${textoDias(s.days)}` : undefined}
              horarios={s.days
                .map(d => ({ dia: d, rangos: s.windows?.[d] ?? [] }))
                .filter(x => x.rangos.length > 0)}
            />
          ))}

          {walkIn.length > 0 && (
            <div className="pt-3">
              <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
                Atienden sin turno
              </p>
              <div className={cn(glassPanel, 'space-y-3 p-4')}>
                <p className="text-sm text-[var(--t-text-muted)]">
                  A estos barberos se los atiende por orden de llegada: no hace falta reservar,
                  acercate y anotate en la tablet.
                </p>
                <ul className="space-y-2.5">
                  {walkIn.map(w => (
                    <li key={w.id} className="flex items-center gap-3">
                      <Avatar url={w.avatar_url} name={w.full_name} size={36} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--t-text)]">
                        {w.full_name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--t-text-muted)]">
                        Por orden de llegada
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(
    hoja,
    document.querySelector('[data-turnero-root]') ?? document.body
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────

function Opcion({
  activo,
  onClick,
  icono,
  titulo,
  detalle,
  horarios,
  recomendado,
  indice = 0,
}: {
  activo: boolean
  onClick: () => void
  icono: React.ReactNode
  titulo: string
  detalle?: string
  horarios?: Array<{ dia: number; rangos: Array<{ start: string; end: string }> }>
  recomendado?: boolean
  indice?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        glassInteractive,
        't-rise w-full rounded-2xl p-4 text-left',
        activo && 't-glass-sel'
      )}
      style={{ '--t-i': Math.min(indice, 6) } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        {icono}
        <div className="min-w-0 flex-1">
          {/* Sin `truncate`: con el chip "Sugerido" al lado, en un celular
              angosto el título se comía a sí mismo ("Cualquiera disp…"). Que
              envuelva es preferible a que se corte el nombre del barbero. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-bold leading-tight text-[var(--t-text)]">
            <span>{titulo}</span>
            {recomendado && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{ backgroundColor: 'var(--t-glass-inner)', color: 'var(--t-text-muted)' }}
              >
                Sugerido
              </span>
            )}
          </p>
          {detalle && (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--t-text-muted)]">{detalle}</p>
          )}
        </div>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200"
          style={{
            borderColor: activo ? 'var(--t-primary)' : 'var(--t-text-faint)',
            backgroundColor: activo ? 'var(--t-primary)' : 'transparent',
            color: 'var(--t-on-primary)',
          }}
          aria-hidden
        >
          {activo && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      </div>

      {horarios && horarios.length > 0 && (
        <div
          className="mt-3 space-y-1.5 rounded-xl p-3"
          style={{
            backgroundColor: 'var(--t-glass-inner)',
            boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
          }}
        >
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
            <Clock className="h-3 w-3" />
            Da turnos
          </p>
          {horarios.map(h => (
            <p key={h.dia} className="flex gap-2 text-xs text-[var(--t-text)]">
              <span className="w-8 shrink-0 font-bold">{DIAS_ABREV_3[h.dia]}</span>
              <span className="text-[var(--t-text-muted)]">{textoRangos(h.rangos)}</span>
            </p>
          ))}
        </div>
      )}
    </button>
  )
}
