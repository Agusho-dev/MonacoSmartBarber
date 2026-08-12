'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, Loader2, Pencil, Phone, Sparkles, User } from 'lucide-react'
import { publicLookupClient } from '@/lib/actions/public-booking'
import { cn } from '@/lib/utils'
import { glassPanel, glassInteractive } from '../glass'
import { fechaLargaDeStr } from '../fechas'

/**
 * Primer paso: el teléfono.
 *
 * El orden es la decisión de diseño, no el estilo. Preguntando el teléfono
 * ANTES que nada, el 80% de los clientes —los que ya vinieron— no vuelven a
 * tipear su nombre nunca más, y el turnero puede tratarlos por su nombre desde
 * la primera pantalla. El precio es pedir un dato antes de mostrar precios; se
 * paga barato porque es UN campo y porque la recompensa se ve al instante.
 *
 * Los campos de nombre no existen hasta que sabemos si hacen falta: mostrarlos
 * vacíos junto al teléfono le pide al cliente conocido que complete algo que ya
 * sabemos, y al nuevo le adelanta trabajo antes de tiempo.
 */

export type EstadoIdentidad = 'vacio' | 'buscando' | 'conocido' | 'nuevo'

export interface Identidad {
  phone: string
  firstName: string
  lastName: string
}

interface Props {
  branchId: string
  valor: Identidad
  estado: EstadoIdentidad
  /** Turno activo que ya tiene este cliente, si el lookup encontró uno. */
  turnoExistente: { date: string; time: string } | null
  onCambio: (v: Identidad) => void
  onEstado: (e: EstadoIdentidad) => void
  onTurnoExistente: (t: { date: string; time: string } | null) => void
}

/** Dígitos pelados, para decidir si vale la pena consultar. */
function digitos(s: string): string {
  return s.replace(/\D/g, '')
}

export function esTelefonoValido(phone: string): boolean {
  const d = digitos(phone)
  return d.length >= 8 && d.length <= 15
}

/**
 * El Input de shadcn asume fondo claro (`bg-transparent`, `border-input`,
 * `placeholder:text-muted-foreground`): sobre el fondo de marca el borde
 * desaparecía y el placeholder quedaba gris sobre gris. Se lo viste con los
 * tokens del tema en vez de tocar `src/components/ui/`, que es compartido.
 */
const CAMPO =
  'h-14 w-full rounded-2xl border bg-[var(--t-glass-bg)] px-4 text-base text-[var(--t-text)] ' +
  'outline-none backdrop-blur-xl placeholder:text-[var(--t-text-faint)] ' +
  'border-[var(--t-glass-border-strong)] shadow-[var(--t-glass-shadow)] ' +
  'transition-[border-color,box-shadow] duration-200 ' +
  'focus:border-[var(--t-accent)] focus:shadow-[0_0_0_3px_var(--t-ring)]'

const DEBOUNCE_MS = 550

export function IdentifyStep({
  branchId,
  valor,
  estado,
  turnoExistente,
  onCambio,
  onEstado,
  onTurnoExistente,
}: Props) {
  /** El cliente tocó el nombre a mano: a partir de ahí no se autocompleta. */
  const [editando, setEditando] = useState(false)
  const editadoRef = useRef(false)
  /**
   * Último número YA resuelto. Se siembra con el que traiga el padre porque
   * este paso se remonta cada vez que el cliente vuelve atrás (el wizard usa
   * `key={step}`): sin la semilla, volver al paso 1 re-consultaba el mismo
   * teléfono y, peor, el autocompletado le pisaba el nombre a quien lo había
   * corregido a mano con "No soy yo".
   *
   * El argumento de `useRef` sólo se evalúa en el primer render, que es
   * exactamente la semántica que hace falta acá.
   */
  const ultimaConsulta = useRef(
    estado === 'conocido' || estado === 'nuevo' ? digitos(valor.phone) : ''
  )

  // ─── Lookup ──────────────────────────────────────────────────────
  //
  // Se dispara solo, con debounce, mientras el cliente tipea. No hay botón
  // "buscar": un botón obliga a entender que hay una búsqueda, y acá la
  // búsqueda es un detalle de implementación — lo único que el cliente tiene
  // que percibir es que el turnero lo reconoció.
  useEffect(() => {
    const limpio = digitos(valor.phone)

    if (!esTelefonoValido(valor.phone)) {
      ultimaConsulta.current = ''
      onEstado('vacio')
      onTurnoExistente(null)
      return
    }

    // Mismo número ya resuelto: no se vuelve a consultar (gasta cuota del
    // rate-limit y parpadea la tarjeta sin motivo).
    if (ultimaConsulta.current === limpio) return

    let cancelado = false
    onEstado('buscando')

    const t = window.setTimeout(async () => {
      const res = await publicLookupClient(branchId, valor.phone)
      if (cancelado) return

      ultimaConsulta.current = limpio
      onTurnoExistente(res.upcoming)

      if (res.found && res.firstName) {
        onEstado('conocido')
        // Si el cliente ya escribió su nombre a mano, mandan sus letras: el
        // autocompletado ayuda, no corrige.
        if (!editadoRef.current) {
          onCambio({
            phone: valor.phone,
            firstName: res.firstName,
            lastName: res.lastName,
          })
        }
        return
      }

      onEstado('nuevo')
    }, DEBOUNCE_MS)

    return () => {
      cancelado = true
      window.clearTimeout(t)
    }
    // `onCambio`/`onEstado` son estables (definidas en el padre sin deps): no
    // entran como dependencias para no re-disparar la consulta en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor.phone, branchId])

  function cambiarTelefono(v: string) {
    // Sólo lo que puede formar parte de un teléfono. Bloquear el resto en la
    // entrada evita el cartel de error para un caso que no debería existir.
    const limpio = v.replace(/[^\d\s+()-]/g, '').slice(0, 20)
    if (digitos(limpio) !== digitos(valor.phone)) {
      editadoRef.current = false
      setEditando(false)
    }
    onCambio({ ...valor, phone: limpio })
  }

  function cambiarNombre(campo: 'firstName' | 'lastName', v: string) {
    editadoRef.current = true
    onCambio({ ...valor, [campo]: v.slice(0, 60) })
  }

  const mostrarCampos = estado === 'nuevo' || editando
  const nombreCompleto = [valor.firstName, valor.lastName].filter(Boolean).join(' ')

  return (
    <div className="space-y-4">
      {/* ── Teléfono ─────────────────────────────────────────────── */}
      <div className="t-rise space-y-2" style={{ '--t-i': 0 } as React.CSSProperties}>
        <label
          htmlFor="ident-phone"
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--t-text)]"
        >
          <Phone className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
          Tu número de WhatsApp
        </label>

        <div className="relative">
          <input
            id="ident-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="3584402511"
            value={valor.phone}
            onChange={e => cambiarTelefono(e.target.value)}
            className={cn(CAMPO, 'pl-[4.25rem] pr-12 text-lg font-semibold tracking-wide')}
            aria-describedby="ident-phone-help"
          />
          {/* El prefijo es una etiqueta, no parte del valor: el servidor
              normaliza igual y meterlo en el input obliga al cliente a
              pelearse con el cursor. */}
          <span
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 border-r pr-2.5 text-base font-semibold text-[var(--t-text-muted)]"
            style={{ borderColor: 'var(--t-glass-border-strong)' }}
            aria-hidden
          >
            +54
          </span>
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            {estado === 'buscando' && (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--t-text-muted)]" />
            )}
            {estado === 'conocido' && (
              <Check className="h-5 w-5 text-[var(--t-success-text)]" strokeWidth={3} />
            )}
          </span>
        </div>

        <p id="ident-phone-help" className="text-xs text-[var(--t-text-muted)]">
          {estado === 'buscando'
            ? 'Fijándonos si ya sos cliente…'
            : 'Te mandamos la confirmación por acá.'}
        </p>
      </div>

      {/* ── Te reconocimos ───────────────────────────────────────── */}
      {estado === 'conocido' && !editando && (
        <div className={cn(glassPanel, 't-pop-in flex items-center gap-3.5 p-4')}>
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold"
            style={{ backgroundColor: 'var(--t-success)', color: 'var(--t-on-success)' }}
            aria-hidden
          >
            {(valor.firstName.charAt(0) || '?').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-success-text)]">
              Te reconocimos
            </p>
            <p className="truncate text-lg font-bold leading-tight text-[var(--t-text)]">
              ¡Hola, {valor.firstName}!
            </p>
            {/* El nombre completo, pelado. Antes decía "Reservamos a nombre de
                X" y en un celular angosto el prefijo se comía justamente el
                dato: "Reservamos a nombre de An…". */}
            <p className="truncate text-xs text-[var(--t-text-muted)]">
              {nombreCompleto || valor.firstName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              editadoRef.current = true
              setEditando(true)
            }}
            className={cn(
              glassInteractive,
              'flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-[var(--t-text)]'
            )}
          >
            <Pencil className="h-3.5 w-3.5" />
            No soy yo
          </button>
        </div>
      )}

      {/* ── Primera vez / corrección manual ──────────────────────── */}
      {mostrarCampos && (
        <div className={cn(glassPanel, 't-pop-in space-y-3.5 p-4')}>
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--t-text)]">
            <Sparkles className="h-4 w-4 text-[var(--t-accent)]" />
            {estado === 'conocido' ? '¿A nombre de quién va?' : 'Es tu primera vez acá'}
          </p>
          {estado !== 'conocido' && (
            <p className="-mt-2 text-xs text-[var(--t-text-muted)]">
              Contanos cómo te llamás y listo, la próxima ya te reconocemos.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="ident-first"
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--t-text-muted)]"
              >
                <User className="h-3 w-3" />
                Nombre
              </label>
              {/* `autoComplete="off"` y un `name` que no es el estándar: con
                  `given-name`/`family-name` Chrome rellenaba estos campos con
                  el perfil guardado del DUEÑO ("Nacho / ADMIN") apenas
                  aparecían, incluso para un teléfono que no existe en la base.
                  Un nombre precargado que no es el del cliente es peor que un
                  campo vacío: se confirma sin mirar y el turno queda a nombre
                  de otra persona. Acá el único autocompletado legítimo es el
                  nuestro, el que sale del teléfono. */}
              <input
                id="ident-first"
                name="turnero-nombre"
                type="text"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                placeholder="Juan"
                value={valor.firstName}
                onChange={e => cambiarNombre('firstName', e.target.value)}
                className={CAMPO}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="ident-last"
                className="text-xs font-semibold text-[var(--t-text-muted)]"
              >
                Apellido
              </label>
              <input
                id="ident-last"
                name="turnero-apellido"
                type="text"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                placeholder="García"
                value={valor.lastName}
                onChange={e => cambiarNombre('lastName', e.target.value)}
                className={CAMPO}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Ya tenía un turno ────────────────────────────────────── */}
      {/* Se avisa ACÁ y no al confirmar: el servidor rechaza un segundo turno el
          mismo día, y hasta ahora el cliente se enteraba después de haber
          elegido servicio, día y horario. */}
      {turnoExistente && (
        <div
          className={cn(glassPanel, 't-pop-in flex items-start gap-3 p-4')}
          role="status"
        >
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--t-accent)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[var(--t-text)]">Ya tenés un turno reservado</p>
            <p className="mt-0.5 text-sm text-[var(--t-text-muted)]">
              {fechaLargaDeStr(turnoExistente.date)} a las {turnoExistente.time}. Podés sacar otro
              para un día distinto; para ese día ya está tomado tu lugar.
            </p>
          </div>
        </div>
      )}

      {/* Placeholder mientras se resuelve: sin esto la pantalla queda con un
          solo campo y un vacío enorme abajo, y el cliente no sabe si tiene que
          esperar o si eso es todo. */}
      {estado === 'buscando' && !mostrarCampos && (
        <div className="t-skel h-[104px] rounded-2xl" aria-hidden />
      )}
    </div>
  )
}
