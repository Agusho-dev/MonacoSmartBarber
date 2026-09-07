'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Loader2, MapPin, Scissors, Undo2, User, Wallet, XCircle } from 'lucide-react'
import { publicCancelByToken } from '@/lib/actions/public-booking'
import { themeVars, type TurneroTheme } from '../../[slug]/theme'
import { fechaLargaDeStr } from '../../[slug]/fechas'
import { PieLegal } from '../../[slug]/pie-legal'
import type { Appointment } from '@/lib/types/database'

/**
 * La seña de este turno, con las consecuencias ya resueltas por el servidor.
 *
 * Las dos frases (`siCancelaATiempo` / `siCancelaTarde`) vienen calculadas
 * porque la regla vive en la config de la sucursal y en el motor, no acá: si la
 * pantalla la reimplementara, tarde o temprano prometería una devolución que el
 * sistema no hace.
 */
export interface SenaDelTurno {
  montoTexto: string
  restoTexto: string | null
  consumida: boolean
  siCancelaATiempo: string
  siCancelaTarde: string
  arrepentimiento: { hasta: string; diasRestantes: number } | null
}

const ESTADOS: Record<string, string> = {
  confirmed: 'Confirmado',
  checked_in: 'Ya llegaste',
  in_progress: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'Ausente',
  pending_payment: 'Pendiente de pago',
}

interface Props {
  appointment: Appointment
  token: string
  theme: TurneroTheme
  cancellationMinHours: number
  /**
   * El instante del turno, ya resuelto en la zona de la SUCURSAL por el
   * servidor. No se calcula acá: `new Date('2026-09-10T15:00:00')` lo
   * interpreta en la zona del teléfono, y un cliente de viaje —o cualquiera
   * después de un cambio de horario— veía la ventana de cancelación corrida.
   */
  instanteISO: string
  sucursalSlug: string | null
  sena: SenaDelTurno | null
}

export function GestionarClient({
  appointment,
  token,
  theme,
  cancellationMinHours,
  instanteISO,
  sucursalSlug,
  sena,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [cancelado, setCancelado] = useState(false)
  const [error, setError] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const estado = ESTADOS[appointment.status] ?? appointment.status

  const fecha = fechaLargaDeStr(appointment.appointment_date)

  const hora = appointment.start_time.substring(0, 5)

  const branch = appointment.branch as { name?: string; address?: string; phone?: string } | null
  const service = appointment.service as { name?: string } | null
  const barber = appointment.barber as { full_name?: string } | null

  const cancelable = ['confirmed', 'checked_in'].includes(appointment.status)

  const [ahora] = useState(() => Date.now())
  const horasRestantes = (new Date(instanteISO).getTime() - ahora) / 3_600_000
  const enVentana = horasRestantes >= cancellationMinHours

  /** Lo que le va a pasar a la seña si cancela AHORA. */
  const consecuenciaSena = sena && !sena.consumida
    ? (enVentana ? sena.siCancelaATiempo : sena.siCancelaTarde)
    : null

  function handleCancel() {
    setError('')
    startTransition(async () => {
      const result = await publicCancelByToken(token)
      if ('error' in result) {
        setError(
          result.error === 'NOT_FOUND_OR_NOT_CANCELLABLE'
            ? 'No se pudo cancelar. Puede que el turno ya esté cancelado o el link haya expirado.'
            : result.error
        )
        setConfirmando(false)
        return
      }
      setCancelado(true)
    })
  }

  if (cancelado) {
    return (
      <Marco theme={theme} sucursal={sucursalSlug}>
        <div
          className="rounded-3xl border p-8 text-center"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
          >
            <XCircle className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-[var(--t-text)]">Turno cancelado</h1>
          <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
            Listo, liberamos el horario. Si cambiás de idea, reservá uno nuevo cuando quieras.
          </p>

          {/* El destino de la plata se repite DESPUÉS de cancelar y no sólo
              antes: es el momento en que el cliente se lo pregunta, y hacerlo
              volver a leer la pantalla anterior no es una respuesta. */}
          {consecuenciaSena && (
            <p
              className="mt-4 rounded-2xl p-3.5 text-left text-sm text-[var(--t-text-muted)]"
              style={{ backgroundColor: 'var(--t-surface-alt)' }}
            >
              <strong className="block font-bold text-[var(--t-text)]">
                Tu seña de {sena?.montoTexto}
              </strong>
              {consecuenciaSena}
            </p>
          )}
        </div>
      </Marco>
    )
  }

  return (
    <Marco theme={theme} sucursal={sucursalSlug}>
      <div
        className="rounded-3xl border p-6"
        style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
              Tu turno
            </p>
            <p className="mt-1 text-3xl font-bold leading-none tabular-nums text-[var(--t-text)]">
              {hora}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--t-text-muted)]">
              {fecha}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{
              backgroundColor: 'var(--t-surface-alt)',
              borderColor: 'var(--t-border)',
              color: 'var(--t-text)',
            }}
          >
            {estado}
          </span>
        </div>

        <div
          className="mt-5 space-y-3 border-t pt-5"
          style={{ borderColor: 'var(--t-border)' }}
        >
          <Fila icon={<User className="h-4 w-4" />} label="Te atiende">
            {barber?.full_name ?? 'Por asignar'}
          </Fila>
          {/* Fecha y hora NO se repiten acá: ya están en grande arriba. */}
          <Fila icon={<Scissors className="h-4 w-4" />} label="Servicio">
            {service?.name ?? '—'}
          </Fila>
          <Fila icon={<MapPin className="h-4 w-4" />} label="Sucursal">
            {branch?.name ?? '—'}
            {branch?.address && (
              <span className="block text-[var(--t-text-muted)]">{branch.address}</span>
            )}
          </Fila>
        </div>
      </div>

      {/* LA SEÑA. Va inmediatamente debajo del turno y arriba de todo lo demás:
          es plata del cliente y es lo que va a buscar cuando abra este link. */}
      {sena && (
        <div
          className="rounded-3xl border p-5"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
            <Wallet className="h-3.5 w-3.5" />
            Seña pagada
          </p>
          <p className="mt-1.5 text-3xl font-bold leading-none tabular-nums text-[var(--t-text)]">
            {sena.montoTexto}
          </p>
          {sena.restoTexto && (
            <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
              {sena.consumida
                ? 'Este turno ya se cobró.'
                : `Los ${sena.restoTexto} que faltan los pagás en el local.`}
            </p>
          )}

          {consecuenciaSena && (
            <div
              className="mt-4 rounded-2xl p-3.5"
              style={{ backgroundColor: 'var(--t-surface-alt)' }}
            >
              <p className="text-[13px] font-bold text-[var(--t-text)]">Si cancelás ahora</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--t-text-muted)]">
                {consecuenciaSena}
              </p>
            </div>
          )}

          {/* El art. 1110 CCyC da 10 días corridos IRRENUNCIABLES para revocar
              un contrato a distancia, y la Disp. 377/2026 declara abusiva la
              cláusula que lo limite. O sea que mientras la ventana esté abierta
              esto pisa a cualquier política de cancelación de la sucursal — y
              por eso se muestra incluso cuando el bloque de arriba dice que la
              seña se pierde. */}
          {sena.arrepentimiento && !sena.consumida && (
            <div
              className="mt-3 rounded-2xl p-3.5"
              style={{
                backgroundColor: 'var(--t-surface-alt)',
                boxShadow: 'inset 0 0 0 1px var(--t-border)',
              }}
            >
              <p className="flex items-center gap-2 text-[13px] font-bold text-[var(--t-text)]">
                <Undo2 className="h-4 w-4" />
                Podés pedir la devolución total
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--t-text-muted)]">
                Tenés {sena.arrepentimiento.diasRestantes}{' '}
                {sena.arrepentimiento.diasRestantes === 1 ? 'día' : 'días'} más —hasta el{' '}
                {sena.arrepentimiento.hasta}— para arrepentirte y que te devolvamos los{' '}
                {sena.montoTexto} completos, sin explicar por qué.
              </p>
              <Link
                href={sucursalSlug ? `/arrepentimiento?suc=${encodeURIComponent(sucursalSlug)}` : '/arrepentimiento'}
                className="mt-3 flex min-h-[46px] items-center justify-center gap-2 rounded-xl border text-sm font-bold"
                style={{
                  backgroundColor: 'var(--t-surface)',
                  borderColor: 'var(--t-border)',
                  color: 'var(--t-text)',
                }}
              >
                <Undo2 className="h-4 w-4" />
                Botón de arrepentimiento
              </Link>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl p-3.5 text-sm font-medium"
          style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {appointment.status === 'completed' && (
        <div
          className="flex items-center justify-center gap-2 rounded-2xl border p-4 text-sm font-semibold text-[var(--t-text)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          <Check className="h-5 w-5 text-[var(--t-accent)]" />
          Este turno ya fue completado
        </div>
      )}

      {appointment.status === 'cancelled' && (
        <div
          className="rounded-2xl border p-4 text-center text-sm text-[var(--t-text-muted)]"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          Este turno ya fue cancelado.
        </div>
      )}

      {cancelable && !enVentana && (
        <div
          className="rounded-2xl border p-4 text-sm"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}
        >
          Ya no se puede cancelar online: la cancelación cierra{' '}
          <strong className="font-semibold text-[var(--t-text)]">
            {cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'} antes
          </strong>{' '}
          del turno.
          {branch?.phone && (
            <>
              {' '}Si no vas a poder venir, avisanos al{' '}
              <a href={`tel:${branch.phone}`} className="font-semibold text-[var(--t-accent)] underline underline-offset-2">
                {branch.phone}
              </a>
              .
            </>
          )}
        </div>
      )}

      {cancelable && enVentana && (
        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          {confirmando ? (
            <>
              <p className="text-sm font-semibold text-[var(--t-text)]">
                ¿Seguro que querés cancelar?
              </p>
              <p className="mt-1 text-sm text-[var(--t-text-muted)]">
                El horario se libera para otro cliente y no se puede deshacer.
              </p>
              {/* Con seña, la última pantalla antes de perder plata tiene que
                  decir cuánta y a dónde va. */}
              {consecuenciaSena && (
                <p
                  className="mt-3 rounded-xl p-3 text-[13px] leading-relaxed text-[var(--t-text-muted)]"
                  style={{ backgroundColor: 'var(--t-surface-alt)' }}
                >
                  <strong className="font-bold text-[var(--t-text)]">
                    Seña de {sena?.montoTexto}:
                  </strong>{' '}
                  {consecuenciaSena}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  disabled={isPending}
                  className="h-13 flex-1 rounded-xl border text-sm font-semibold"
                  style={{
                    backgroundColor: 'var(--t-surface-alt)',
                    borderColor: 'var(--t-border)',
                    color: 'var(--t-text)',
                  }}
                >
                  Mantener turno
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isPending}
                  className="flex h-13 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                  style={{ backgroundColor: 'var(--t-danger)' }}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Sí, cancelar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--t-text-muted)]">
                Podés cancelar hasta{' '}
                <strong className="font-semibold text-[var(--t-text)]">
                  {cancellationMinHours} {cancellationMinHours === 1 ? 'hora' : 'horas'}
                </strong>{' '}
                antes del turno.
              </p>
              {/* Confirmación en dos pasos: el link viaja por WhatsApp y un
                  toque accidental no puede borrarle el turno al cliente. */}
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold"
                style={{
                  backgroundColor: 'var(--t-surface-alt)',
                  borderColor: 'var(--t-border)',
                  color: 'var(--t-text)',
                }}
              >
                <XCircle className="h-4 w-4" />
                Cancelar mi turno
              </button>
            </>
          )}
        </div>
      )}

      {branch?.phone && !cancelable && (
        <p className="text-center text-sm text-[var(--t-text-muted)]">
          ¿Necesitás ayuda?{' '}
          <a href={`tel:${branch.phone}`} className="font-semibold text-[var(--t-accent)] underline underline-offset-2">
            Llamá al {branch.phone}
          </a>
        </p>
      )}
    </Marco>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────

function Marco({
  theme,
  sucursal,
  children,
}: {
  theme: TurneroTheme
  sucursal?: string | null
  children: React.ReactNode
}) {
  return (
    <div
      // `justify-center` sólo mientras el contenido entre: con la tarjeta de la
      // seña y el pie legal la columna crece, y centrada verticalmente el
      // encabezado se iba arriba de la pantalla y no se podía scrollear hasta él.
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--t-bg)] p-4 text-[var(--t-text)]"
      style={themeVars(theme)}
    >
      <div className="w-full max-w-md space-y-4">{children}</div>
      <div className="w-full max-w-md">
        <PieLegal sucursal={sucursal} />
      </div>
    </div>
  )
}

function Fila({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-[var(--t-text-muted)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--t-text-muted)]">
          {label}
        </p>
        <p className="text-sm text-[var(--t-text)]">{children}</p>
      </div>
    </div>
  )
}
