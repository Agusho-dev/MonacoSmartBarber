'use client'

import Link from 'next/link'
import {
  CalendarDays,
  Clock,
  Info,
  MapPin,
  Scissors,
  ShieldCheck,
  Undo2,
  User,
} from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { glassPanel, glassInteractive } from '../glass'
import { fechaLarga } from '../fechas'
import { Avatar } from './avatar'
import type { CalculoSena, TextoPolitica } from '@/lib/senas/contrato'
import type { PublicService } from '@/lib/actions/public-booking'

interface Props {
  calculo: CalculoSena
  politica: TextoPolitica
  branchName: string
  branchAddress: string | null
  services: PublicService[]
  durationMinutes: number
  date: Date
  time: string
  staffName: string
  staffAvatarUrl: string | null
  clientName: string
  clientPhone: string
  aceptado: boolean
  onAceptar: (valor: boolean) => void
}

/**
 * La pantalla que el cliente lee justo antes de pagar.
 *
 * Todo lo que hay acá tiene una razón legal o una razón de expectativa, y las
 * dos apuntan al mismo lado:
 *
 *  · El **monto** es lo primero y lo más grande. El cliente eligió un servicio
 *    de $16.000 y va a ver un cobro de $8.000 en Mercado Pago: si el número no
 *    está en letra grande antes del checkout, la diferencia se lee como un
 *    error nuestro.
 *  · La **política va en texto, en esta misma pantalla y arriba del botón**, no
 *    detrás de un link. El art. 1111 CCyC exige que la información sobre la
 *    revocación se dé "en caracteres destacados inmediatamente antes de la
 *    aceptación", y si no se informa, el plazo de 10 días **no empieza a
 *    correr**: esconderla lo vuelve eterno en contra del negocio.
 *  · El aviso de que **el horario todavía no está reservado** (con
 *    `hold_minutes = 0`) va antes del pago y no después. Es lo que convierte
 *    una carrera perdida —dos personas pagando el mismo hueco— en un
 *    contratiempo entendible en vez de en un reclamo.
 *
 * Los textos NO se escriben acá: salen de `construirPolitica`, que los deriva de
 * la config de la sucursal y los comparten la app Flutter y el turnero. Escritos
 * dos veces, una superficie termina prometiendo algo que la otra no cumple —y lo
 * que se promete es plata del cliente.
 */
export function DepositStep({
  calculo,
  politica,
  branchName,
  branchAddress,
  services,
  durationMinutes,
  date,
  time,
  staffName,
  staffAvatarUrl,
  clientName,
  clientPhone,
  aceptado,
  onAceptar,
}: Props) {
  const nombresServicios = services.map(s => s.name).join(' + ')

  return (
    <div className="space-y-4">
      {/* EL MONTO */}
      <section className={cn(glassPanel, 't-rise overflow-hidden p-5')} style={{ '--t-i': 2 } as React.CSSProperties}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--t-text-muted)]">
          Pagás ahora
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-[44px] font-bold leading-none tabular-nums tracking-tight text-[var(--t-text)]">
            {formatCurrency(calculo.sena)}
          </span>
          <span className="text-sm font-semibold text-[var(--t-text-muted)]">de seña</span>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--t-text-muted)]">
          {politica.detalle}
        </p>

        {calculo.resto > 0 && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
            style={{
              backgroundColor: 'var(--t-glass-inner)',
              boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
            }}
          >
            {/* Mismo rótulo que la hoja de la app: las dos pantallas hablan de
                la misma plata y tienen que nombrarla igual. */}
            <span className="text-sm font-semibold text-[var(--t-text-muted)]">
              Queda para el local
            </span>
            <span className="text-base font-bold tabular-nums text-[var(--t-text)]">
              {formatCurrency(calculo.resto)}
            </span>
          </div>
        )}
      </section>

      {/* QUÉ ESTÁS RESERVANDO */}
      <section className={cn(glassPanel, 't-rise p-4')} style={{ '--t-i': 5 } as React.CSSProperties}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          Tu turno
        </p>

        <div className="mt-3.5 flex items-center gap-3">
          <Avatar url={staffAvatarUrl} name={staffName} size={44} />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-[var(--t-text)]">{staffName}</p>
            <p className="truncate text-xs text-[var(--t-text-muted)]">{branchName}</p>
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--t-glass-border)' }}>
          <Fila icon={<CalendarDays className="h-4 w-4" />} label="Cuándo">
            <span className="font-semibold">{fechaLarga(date)}</span>
            <span className="ml-1.5 font-bold tabular-nums text-[var(--t-text)]">{time}</span>
          </Fila>

          <Fila icon={<Scissors className="h-4 w-4" />} label="Servicio">
            <span className="font-semibold">{nombresServicios || '—'}</span>
            <span className="ml-1.5 font-bold text-[var(--t-accent)]">
              {formatCurrency(calculo.total)}
            </span>
          </Fila>

          <Fila icon={<Clock className="h-4 w-4" />} label="Duración">
            {durationMinutes} min
          </Fila>

          {branchAddress && (
            <Fila icon={<MapPin className="h-4 w-4" />} label="Dónde">
              {branchAddress}
            </Fila>
          )}

          <Fila icon={<User className="h-4 w-4" />} label="A nombre de">
            {clientName}
            <span className="block text-[var(--t-text-muted)]">{clientPhone}</span>
          </Fila>
        </div>
      </section>

      {/* LA LETRA QUE NO ES CHICA */}
      <section className={cn(glassPanel, 't-rise p-4')} style={{ '--t-i': 8 } as React.CSSProperties}>
        <Parrafo icon={<Info className="h-4 w-4" />} titulo="Cómo queda el horario">
          {politica.reserva}
        </Parrafo>

        <Parrafo icon={<ShieldCheck className="h-4 w-4" />} titulo="Si cancelás">
          {politica.cancelacion}
        </Parrafo>

        {politica.arrepentimiento && (
          <Parrafo icon={<Undo2 className="h-4 w-4" />} titulo="Podés arrepentirte">
            {politica.arrepentimiento}{' '}
            <Link
              href="/arrepentimiento"
              className="font-semibold text-[var(--t-accent)] underline underline-offset-2"
            >
              Botón de arrepentimiento
            </Link>
            .
          </Parrafo>
        )}
      </section>

      {/* LA ACEPTACIÓN, PEGADA AL BOTÓN QUE COBRA */}
      <label
        htmlFor="acepta-sena"
        className={cn(
          glassInteractive,
          't-rise flex cursor-pointer items-start gap-3 rounded-2xl p-4'
        )}
        style={{ '--t-i': 11 } as React.CSSProperties}
      >
        <input
          id="acepta-sena"
          type="checkbox"
          checked={aceptado}
          onChange={e => onAceptar(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-[background-color,border-color] duration-200"
          style={{
            borderColor: aceptado ? 'var(--t-primary)' : 'var(--t-text-faint)',
            backgroundColor: aceptado ? 'var(--t-primary)' : 'transparent',
            color: 'var(--t-on-primary)',
          }}
          aria-hidden
        >
          {aceptado && <ShieldCheck className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--t-text-muted)]">
          Leí y acepto la seña de{' '}
          <strong className="font-bold text-[var(--t-text)]">
            {formatCurrency(calculo.sena)}
          </strong>{' '}
          y la política de cancelación, y los{' '}
          <Link
            href="/terminos"
            className="font-semibold text-[var(--t-accent)] underline underline-offset-2"
            // El link abre en otra pestaña a propósito: tocarlo no puede
            // desarmar el wizard que el cliente viene llenando hace tres pasos.
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            términos y condiciones
          </Link>
          .
        </span>
      </label>

      {/* Quién cobra. Va acá, debajo de la aceptación y antes del botón, por lo
          mismo que en la app: el cliente está por salir a otro dominio con su
          tarjeta, y saber que del otro lado está Mercado Pago es parte de poder
          confiar en la pantalla. */}
      <p className="flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-[var(--t-text-faint)]">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        El pago lo procesa Mercado Pago.
      </p>
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────

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

/**
 * Un párrafo de política.
 *
 * El encabezado NO usa el `Label` de shadcn: ese componente trae
 * `flex items-center gap-2`, así que cada corrida de texto rico que se le meta
 * adentro se convierte en un flex item y el párrafo se renderiza en columnas
 * (fue lo que partió en cuatro la caja de "Política de cancelación").
 */
function Parrafo({
  icon,
  titulo,
  children,
}: {
  icon: React.ReactNode
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div
      className="border-b pb-3.5 first:mt-0 last:border-b-0 last:pb-0 mt-3.5"
      style={{ borderColor: 'var(--t-glass-border)' }}
    >
      <p className="flex items-center gap-2 text-[13px] font-bold text-[var(--t-text)]">
        <span className="shrink-0 text-[var(--t-text-muted)]">{icon}</span>
        {titulo}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--t-text-muted)]">
        {children}
      </p>
    </div>
  )
}
