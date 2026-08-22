/**
 * GET /api/mobile/turnos/[slug]
 *
 * Bootstrap del wizard de turnos de la app: el MISMO armado que hace
 * `src/app/turnos/[slug]/page.tsx` (renderBranch) para el turnero web —
 * servicios, barberos reservables con sus ventanas reales, barberos que
 * atienden sin turno, franjas, settings y branding— más los datos del cliente
 * autenticado (nombre y próximo turno). Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RateLimits } from '@/lib/rate-limit'
import { getLocalDateStr } from '@/lib/time-utils'
import {
  getAppointmentSettings,
  getPublicBranchAppointmentStaff,
} from '@/lib/actions/appointments'
import { publicGetBranchServices, publicGetBranchBarbers } from '@/lib/actions/public-booking'
import { getBranchAppointmentHours } from '@/lib/actions/appointment-hours'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import {
  DEFAULT_TZ,
  findMobileBranch,
  isBookable,
  publicBranchShape,
} from '@/lib/mobile/branches'
import { jsonOk, jsonError, rateLimited, withMobileHandler } from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Estados que cuentan como "turno vivo" (mismo set que `publicLookupClient`). */
const ESTADOS_ACTIVOS = ['pending_payment', 'confirmed', 'checked_in', 'in_progress']

/**
 * Nombre del cliente partido por el primer espacio (`clients.name` es una sola
 * columna). Un nombre que es sólo dígitos —clientes viejos creados con
 * `name || phone`— no es un nombre: se devuelve vacío para que la app pida uno
 * en vez de saludar a "1100000099".
 */
function partirNombre(name: string): { first_name: string; last_name: string } {
  const limpio = name.trim()
  if (!limpio || /^\d+$/.test(limpio)) return { first_name: '', last_name: '' }
  const partes = limpio.split(/\s+/).filter(Boolean)
  return { first_name: partes[0] ?? '', last_name: partes.slice(1).join(' ') }
}

export const GET = withMobileHandler(
  'turnos/[slug]',
  async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const auth = await requireMobileClient(req)
    if (isMobileAuthError(auth)) return auth

    const gate = await RateLimits.mobileBootstrap(auth.userId)
    if (!gate.allowed) return rateLimited()

    const { slug } = await ctx.params
    const branch = await findMobileBranch(slug, auth.client.organizationId)
    if (!branch) return jsonError(404, 'BRANCH_NOT_FOUND', 'No encontramos esa sucursal.')

    const settings = await getAppointmentSettings(branch.organization_id, branch.id)
    if (!settings || !isBookable(branch, settings)) {
      return jsonError(
        409,
        'NOT_BOOKABLE',
        'Esta sucursal atiende por orden de llegada, sin turno previo.'
      )
    }

    const supabase = createAdminClient()
    const tz = branch.timezone || DEFAULT_TZ
    const serverToday = getLocalDateStr(tz)

    const [services, staff, barberos, horario, orgRes, upcomingRes] = await Promise.all([
      publicGetBranchServices(branch.id),
      // Con clave por usuario: detrás del CGNAT el gate por IP se comparte entre
      // clientes que no tienen nada que ver entre sí.
      getPublicBranchAppointmentStaff(branch.id, { rateLimitKey: auth.userId }),
      publicGetBranchBarbers(branch.id),
      getBranchAppointmentHours(branch.id),
      supabase
        .from('organizations')
        .select('logo_url')
        .eq('id', branch.organization_id)
        .maybeSingle(),
      // Misma query que `publicLookupClient`, pero con el `client.id` del JWT:
      // sin RPC por teléfono ni rate-limit de lookup.
      supabase
        .from('appointments')
        .select('appointment_date, start_time')
        .eq('organization_id', branch.organization_id)
        .eq('client_id', auth.client.id)
        .in('status', ESTADOS_ACTIVOS)
        .gte('appointment_date', serverToday)
        .order('appointment_date')
        .order('start_time')
        .limit(1),
    ])

    if (upcomingRes.error) {
      // Es un aviso anticipado ("ya tenés un turno ese día"); si no se pudo
      // leer, la reserva igual lo rechaza después. Se loguea y sigue.
      console.error('[api/mobile] turnos/[slug] upcoming:', upcomingRes.error.message)
    }

    // Los que atienden sólo por orden de llegada = todos los barberos menos los
    // que de verdad se pueden reservar (misma resta que el turnero web).
    const reservables = new Set(staff.map(s => s.id))
    const walkInStaff = barberos.filter(b => !reservables.has(b.id))

    // Con franjas cargadas (mig 172), los días habilitados son los que tienen
    // al menos una franja: `appointment_days` deja de mandar.
    const diasHabilitados = horario.usaFranjas
      ? Object.entries(horario.franjas)
          .filter(([, franjas]) => franjas.length > 0)
          .map(([dia]) => Number(dia))
      : settings.appointment_days

    const proximo = upcomingRes.data?.[0]

    return jsonOk({
      server_today: serverToday,
      server_now: new Date().toISOString(),
      branch: publicBranchShape(branch),
      bookable: true,
      settings: {
        max_advance_days: settings.max_advance_days,
        appointment_days: diasHabilitados,
        slot_interval_minutes: settings.slot_interval_minutes,
        cancellation_min_hours: settings.cancellation_min_hours ?? 2,
        lead_time_minutes: settings.lead_time_minutes ?? 0,
        buffer_minutes: settings.buffer_minutes ?? 0,
      },
      branding: {
        logo_url: orgRes.data?.logo_url ?? null,
        welcome_message: settings.welcome_message ?? null,
      },
      services,
      staff,
      walk_in_staff: walkInStaff,
      client: {
        ...partirNombre(auth.client.name),
        phone: auth.client.phone,
        upcoming: proximo
          ? { date: proximo.appointment_date, time: String(proximo.start_time).slice(0, 5) }
          : null,
      },
    })
  }
)
