import { notFound } from 'next/navigation'
import { getAppointmentByToken, getAppointmentSettings } from '@/lib/actions/appointments'
import { createAdminClient } from '@/lib/supabase/server'
import { leerConfigSena, leerSenaDeTurno } from '@/lib/senas/repo'
import { getTzOffsetISO } from '@/lib/time-utils'
import { formatCurrency } from '@/lib/format'
import { buildTurneroTheme } from '../../[slug]/theme'
import { GestionarClient, type SenaDelTurno } from './gestionar-client'
import type { BranchDepositSettings, BookingDeposit } from '@/lib/senas/contrato'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Gestionar turno' }

const TZ_FALLBACK = 'America/Argentina/Buenos_Aires'

/**
 * El instante real del turno, resuelto en la zona de la SUCURSAL.
 *
 * `appointment_date` + `start_time` son hora de PARED de la barbería.
 * `new Date('2026-09-10T15:00:00')` los interpreta en la zona de quien mira —el
 * teléfono del cliente, que puede estar de viaje, y en el servidor de Vercel es
 * UTC— así que la cuenta de "cuántas horas faltan" salía corrida y la pantalla
 * podía ofrecer cancelar un turno que ya estaba fuera de ventana (o negarlo
 * cuando todavía estaba adentro). Mismo criterio que `appointmentInstant`.
 */
function instanteDelTurno(fecha: string, hora: string, timezone: string | null): Date {
  const hhmmss = hora.length === 5 ? `${hora}:00` : hora.substring(0, 8)
  let offset: string
  try {
    offset = getTzOffsetISO(new Date(`${fecha}T12:00:00Z`), timezone || TZ_FALLBACK)
  } catch {
    // Intl tira RangeError con una TZ inválida cargada en la sucursal.
    offset = getTzOffsetISO(new Date(`${fecha}T12:00:00Z`), TZ_FALLBACK)
  }
  return new Date(`${fecha}T${hhmmss}${offset}`)
}

/**
 * Qué le pasa a la seña según cuándo cancele.
 *
 * Se resuelven las DOS ramas acá y el cliente elige cuál mostrar con la misma
 * cuenta de horas que usa para habilitar el botón. La regla es exactamente la
 * de `resolverSenaDeTurnoCancelado` (`refund_on_early_cancel` /
 * `forfeit_on_late_cancel`): decirle una cosa y hacer otra es la forma más
 * rápida de convertir una política razonable en un reclamo.
 */
function consecuencias(cfg: BranchDepositSettings, monto: number) {
  const plata = formatCurrency(monto)

  const aTiempo = (() => {
    switch (cfg.refund_on_early_cancel) {
      case 'devolucion':
        return `Te devolvemos los ${plata} por Mercado Pago. La acreditación puede tardar unos días hábiles según tu medio de pago.`
      case 'ninguno':
        return `Según la política de esta sucursal, los ${plata} de la seña no se devuelven.`
      case 'credito':
      default:
        return `Los ${plata} te quedan a favor para tu próximo turno. Avisanos cuando reserves y te los descontamos.`
    }
  })()

  const tarde = cfg.forfeit_on_late_cancel
    ? `Los ${plata} de la seña quedan para el local: es el tiempo que el barbero te reservó y ya no puede vender.`
    : `Te devolvemos los ${plata} igual, aunque canceles sobre la hora.`

  return { aTiempo, tarde }
}

/** Fecha en la que se le vence el derecho de arrepentimiento, si sigue vigente. */
function ventanaDeArrepentimiento(
  sena: BookingDeposit,
  cfg: BranchDepositSettings,
): { hasta: string; diasRestantes: number } | null {
  if (cfg.arrepentimiento_days <= 0 || !sena.paid_at) return null

  const vence = new Date(new Date(sena.paid_at).getTime() + cfg.arrepentimiento_days * 86_400_000)
  const restanMs = vence.getTime() - Date.now()
  if (restanMs <= 0) return null

  return {
    hasta: vence.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }),
    diasRestantes: Math.max(1, Math.ceil(restanMs / 86_400_000)),
  }
}

export default async function GestionarTurnoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const appointment = await getAppointmentByToken(token)

  if (!appointment) notFound()

  // Misma marca que el turnero: el cliente llega acá desde el WhatsApp de la
  // barbería, no desde un sistema genérico.
  const settings = await getAppointmentSettings(
    appointment.organization_id,
    appointment.branch_id
  )

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('slug, timezone')
    .eq('id', appointment.branch_id)
    .maybeSingle()

  const theme = buildTurneroTheme({
    bg: settings?.brand_bg_color,
    primary: settings?.brand_primary_color,
    text: settings?.brand_text_color,
  })

  // La seña se lee FALLANDO ABIERTO: si no se puede, la pantalla muestra el
  // turno sin el bloque en vez de tirar un 500 sobre el único link que el
  // cliente tiene para cancelar.
  const [sena, cfgSena] = await Promise.all([
    leerSenaDeTurno(appointment.id).catch(e => {
      console.error('[gestionar] leerSenaDeTurno:', e)
      return null
    }),
    leerConfigSena(appointment.branch_id).catch(e => {
      console.error('[gestionar] leerConfigSena:', e)
      return null
    }),
  ])

  let senaProp: SenaDelTurno | null = null
  if (sena && cfgSena) {
    const monto = Number(sena.amount)
    const resto = Math.max(0, Number(sena.service_total) - monto)
    const { aTiempo, tarde } = consecuencias(cfgSena, monto)

    senaProp = {
      montoTexto: formatCurrency(monto),
      restoTexto: resto > 0 ? formatCurrency(resto) : null,
      // `consumida` = el servicio ya se cobró y la seña se imputó al precio.
      // Mostrarle "si cancelás te devolvemos" a alguien que ya se cortó el pelo
      // no tiene sentido.
      consumida: sena.status === 'consumida',
      siCancelaATiempo: aTiempo,
      siCancelaTarde: tarde,
      arrepentimiento: ventanaDeArrepentimiento(sena, cfgSena),
    }
  }

  return (
    <GestionarClient
      appointment={appointment}
      token={token}
      theme={theme}
      cancellationMinHours={settings?.cancellation_min_hours ?? 2}
      instanteISO={instanteDelTurno(
        appointment.appointment_date,
        appointment.start_time,
        branch?.timezone ?? null
      ).toISOString()}
      sucursalSlug={branch?.slug ?? null}
      sena={senaProp}
    />
  )
}
