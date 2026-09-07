import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import {
  publicGetBranchServices,
  publicGetAvailableStaff,
  publicGetBranchBarbers,
} from '@/lib/actions/public-booking'
import { getBranchAppointmentHours } from '@/lib/actions/appointment-hours'
import { leerConfigSena } from '@/lib/senas/repo'
import { isValidUUID } from '@/lib/validation'
import { BookingWizard } from './booking-wizard'
import { OrgLanding, type LandingBranch } from './org-landing'
import { LinkInvalido } from './link-invalido'
import { PieLegal } from './pie-legal'
import { estadoHorario } from './horarios'
import { buildTurneroTheme, themeVars } from './theme'
import type { BranchDepositSettings } from '@/lib/senas/contrato'
import { MapPin, Phone, Users } from 'lucide-react'
import type { AppointmentSettings } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

// ─── Resolución de slug ──────────────────────────────────────────────
// El mismo segmento acepta slug de SUCURSAL (/turnos/caseros) y slug de
// ORGANIZACIÓN (/turnos/monaco). El link público y el QR que genera el
// dashboard usan el slug de la ORG, así que resolver sólo sucursales dejaba
// ese link en 404.
//
// Orden: sucursal primero. `branches.slug` es UNIQUE global y puede coincidir
// con un `organizations.slug` (hoy existe el caso "test"): ganar por sucursal
// mantiene el link más específico (el que lleva directo a reservar).

async function findBranch(slug: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('branches')
    .select('id, name, slug, organization_id, operation_mode, address, phone, timezone')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  return data
}

async function findOrg(slug: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params
  const normalized = slug.toLowerCase()

  const branch = await findBranch(normalized)
  if (branch) return { title: `Turnos | ${branch.name}` }

  const org = await findOrg(normalized)
  if (org) return { title: `Turnos | ${org.name}` }

  return { title: 'Turnos online' }
}

export default async function TurnosPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { slug } = await params
  const normalized = slug.toLowerCase()

  const sp = await searchParams
  const branch = await findBranch(normalized)
  if (branch) return renderBranch(branch, sp)

  const org = await findOrg(normalized)
  if (org) return renderOrg(org, sp)

  return <LinkInvalido slug={slug} />
}

/** Primer valor de un query param, acotado para no inyectar basura en el form. */
function param(
  sp: Record<string, string | string[] | undefined>,
  key: string,
  maxLength = 60
): string {
  const raw = sp[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return ''
  return value.slice(0, maxLength).trim()
}

// ─── Landing de organización ─────────────────────────────────────────

type Org = { id: string; name: string; slug: string; logo_url: string | null }

async function renderOrg(
  org: Org,
  searchParams: Record<string, string | string[] | undefined>
) {
  const supabase = createAdminClient()

  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, slug, address, phone, timezone, operation_mode, latitude, longitude, business_hours_open, business_hours_close, business_days')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .order('name')

  const list = branches ?? []

  // Deep-link del dashboard: /turnos/{org}?branch={uuid} salta el selector.
  const rawBranch = searchParams.branch
  const branchParam = Array.isArray(rawBranch) ? rawBranch[0] : rawBranch
  if (branchParam && isValidUUID(branchParam)) {
    const target = list.find(b => b.id === branchParam)
    if (target?.slug) redirect(`/turnos/${target.slug}`)
  }

  // Settings efectivos por sucursal: un solo query para toda la org en vez de
  // N llamadas a getAppointmentSettings.
  const { data: allSettings } = await supabase
    .from('appointment_settings')
    .select('*')
    .eq('organization_id', org.id)

  const settingsRows = (allSettings ?? []) as AppointmentSettings[]
  const orgDefaults = settingsRows.find(s => !s.branch_id) ?? null
  const settingsFor = (branchId: string): AppointmentSettings | null =>
    settingsRows.find(s => s.branch_id === branchId) ?? orgDefaults

  const landingBranches: LandingBranch[] = list.map(b => {
    const settings = settingsFor(b.id)
    const estado = estadoHorario(
      b.business_hours_open,
      b.business_hours_close,
      b.business_days,
      b.timezone
    )
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      address: b.address,
      phone: b.phone,
      latitude: b.latitude,
      longitude: b.longitude,
      bookable: b.operation_mode !== 'walk_in' && !!settings?.is_enabled,
      openNow: estado.openNow,
      hoursLabel: estado.label,
    }
  })

  // Una sola sucursal reservable: no tiene sentido pedirle al cliente que
  // "elija" entre una. Va directo al wizard.
  const bookables = landingBranches.filter(b => b.bookable)
  if (bookables.length === 1 && landingBranches.length === 1) {
    redirect(`/turnos/${bookables[0].slug}`)
  }

  return (
    <OrgLanding
      orgName={org.name}
      branches={landingBranches}
      branding={{
        bg: orgDefaults?.brand_bg_color ?? '#f8fafc',
        primary: orgDefaults?.brand_primary_color ?? '#0f172a',
        text: orgDefaults?.brand_text_color ?? '#0f172a',
        logo_url: org.logo_url,
        welcome_message: orgDefaults?.welcome_message ?? null,
      }}
    />
  )
}

// ─── Página de sucursal ──────────────────────────────────────────────

type Branch = {
  id: string
  name: string
  slug: string
  organization_id: string
  operation_mode: string | null
  address: string | null
  phone: string | null
  timezone: string
}

async function renderBranch(
  branch: Branch,
  searchParams: Record<string, string | string[] | undefined>
) {
  const supabase = createAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', branch.organization_id)
    .maybeSingle()

  const settings = await getAppointmentSettings(branch.organization_id, branch.id)

  // Modo walk-in: página informativa sin wizard
  if (branch.operation_mode === 'walk_in' || !settings?.is_enabled) {
    // Mismo tema derivado que el wizard: la tarjeta era `bg-white/90` con el
    // texto de marca encima, así que con texto blanco no se leía nada.
    const theme = buildTurneroTheme({
      bg: settings?.brand_bg_color,
      primary: settings?.brand_primary_color,
      text: settings?.brand_text_color,
    })
    const mapsUrl = branch.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`
      : null

    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--t-bg)] p-4 text-[var(--t-text)]"
        style={themeVars(theme)}
      >
        <div
          className="w-full max-w-md rounded-3xl border p-8 text-center"
          style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
        >
          {org?.logo_url ? (
            <Image
              src={org.logo_url}
              alt={branch.name}
              width={72}
              height={72}
              unoptimized
              className="mx-auto mb-4 h-18 w-18 rounded-full object-cover"
            />
          ) : (
            <div
              className="mx-auto mb-4 flex h-18 w-18 items-center justify-center rounded-full text-2xl font-bold"
              style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
            >
              {branch.name.charAt(0).toUpperCase()}
            </div>
          )}

          <h1 className="text-2xl font-bold tracking-tight text-[var(--t-text)]">
            {branch.name}
          </h1>

          <span
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide"
            style={{
              backgroundColor: 'var(--t-surface-alt)',
              borderColor: 'var(--t-border)',
              color: 'var(--t-text)',
            }}
          >
            <Users className="h-3.5 w-3.5" />
            Sin turno previo
          </span>

          <p className="mt-4 text-sm leading-relaxed text-[var(--t-text-muted)]">
            Acá se atiende por orden de llegada. Acercate cuando quieras, no hace falta
            reservar.
          </p>

          <div
            className="mt-6 space-y-3 rounded-2xl border p-4 text-left"
            style={{ backgroundColor: 'var(--t-surface-alt)', borderColor: 'var(--t-border)' }}
          >
            {branch.address && (
              <div className="flex items-start gap-2.5 text-sm text-[var(--t-text)]">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-text-muted)]" />
                <span>{branch.address}</span>
              </div>
            )}
            {branch.phone && (
              <div className="flex items-center gap-2.5 text-sm text-[var(--t-text)]">
                <Phone className="h-4 w-4 shrink-0 text-[var(--t-text-muted)]" />
                <a href={`tel:${branch.phone}`} className="font-semibold text-[var(--t-accent)] hover:underline">
                  {branch.phone}
                </a>
              </div>
            )}
          </div>

          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
            >
              <MapPin className="h-4 w-4" />
              Cómo llegar
            </a>
          )}
        </div>

        {/* Esta sucursal no cobra seña —no toma turnos online— pero el botón de
            arrepentimiento tiene que estar en todo el sitio donde se ofrece el
            servicio, no sólo donde se cobra (Disp. 954/2025). */}
        <div className="w-full max-w-md">
          <PieLegal sucursal={branch.slug} />
        </div>
      </div>
    )
  }

  // Cargar datos necesarios para el wizard en paralelo
  const [services, staff, barberos, horario, deposito] = await Promise.all([
    publicGetBranchServices(branch.id),
    publicGetAvailableStaff(branch.id),
    publicGetBranchBarbers(branch.id),
    getBranchAppointmentHours(branch.id),
    // La config de la seña FALLA ABIERTA hacia "sin seña": si la lectura se
    // cae, el turnero sigue reservando gratis como toda la vida en vez de
    // quedarse mudo. Es un cobro opcional, no un requisito del turno — trabar
    // la reserva entera porque no pudimos leer un porcentaje sería cambiar un
    // problema chico por uno grande.
    leerConfigSena(branch.id).catch((e): BranchDepositSettings | null => {
      console.error('[turnos/[slug]] leerConfigSena:', e)
      return null
    }),
  ])

  // ¿Esta sucursal puede cobrar de verdad?
  //
  // Prender `branch_deposit_settings.is_enabled` es una casilla del dashboard;
  // conectar la cuenta de Mercado Pago es un trámite aparte. Con la casilla
  // prendida y la cuenta sin conectar, el wizard llevaría al cliente hasta el
  // botón de pagar para morir ahí con "esta sucursal todavía no tiene los pagos
  // conectados" — y como el paso de la seña reemplaza al de confirmar, ese
  // turnero queda MUERTO: no se puede reservar ni con seña ni sin ella.
  //
  // Falla hacia el lado seguro: sin cuenta conectada, la sucursal reserva gratis
  // como toda la vida. Se pierde una seña, no un turno.
  //
  // Los filtros espejan a `resolverProveedor`, que es quien de verdad va a
  // buscar el token al momento de cobrar (produccion + no revocado + con token
  // guardado): si acá dijéramos que sí y allá que no, volvemos al mismo pozo.
  const senaCobrable = await (async () => {
    if (!deposito?.is_enabled) return false
    const { data, error } = await supabase
      .from('branch_payment_providers')
      .select('id')
      .eq('branch_id', branch.id)
      .eq('provider', 'mercadopago')
      .eq('environment', 'produccion')
      .neq('status', 'revocado')
      .not('access_token_cifrado', 'is', null)
      .maybeSingle()

    if (error) {
      console.error('[turnos/[slug]] branch_payment_providers:', error.message)
      return false
    }
    return !!data
  })()

  // Los que atienden sólo por orden de llegada = todos los barberos menos los
  // que de verdad se pueden reservar. No se puede reservar con ellos, pero
  // nombrarlos evita que el cliente que abre "Elegir barbero" y no encuentra al
  // suyo concluya que el turnero está roto (ver `barber-sheet.tsx`).
  const reservables = new Set(staff.map(s => s.id))
  const walkInStaff = barberos.filter(b => !reservables.has(b.id))

  // Con franjas cargadas (mig 172), los días habilitados son los que tienen al
  // menos una franja: `appointment_days` deja de mandar. Si no, la tira de días
  // ofrecería días que el motor rechaza.
  const diasHabilitados = horario.usaFranjas
    ? Object.entries(horario.franjas)
        .filter(([, franjas]) => franjas.length > 0)
        .map(([dia]) => Number(dia))
    : settings.appointment_days

  const branding = {
    bg: settings.brand_bg_color ?? '#ffffff',
    primary: settings.brand_primary_color ?? '#0f172a',
    text: settings.brand_text_color ?? '#0f172a',
    logo_url: org?.logo_url ?? null,
    welcome_message: settings.welcome_message ?? null,
    branch_name: branch.name,
    branch_address: branch.address,
    branch_phone: branch.phone,
  }

  return (
    <BookingWizard
      branch={{
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        address: branch.address,
        phone: branch.phone,
        timezone: branch.timezone,
      }}
      services={services}
      staff={staff}
      walkInStaff={walkInStaff}
      settings={{
        max_advance_days: settings.max_advance_days,
        appointment_days: diasHabilitados,
        slot_interval_minutes: settings.slot_interval_minutes,
        cancellation_min_hours: settings.cancellation_min_hours ?? 2,
      }}
      branding={branding}
      prefill={{
        name: param(searchParams, 'name'),
        phone: param(searchParams, 'phone', 20),
        // La app mobile abre el turnero en un WebView con ?from=app.
        embedded: param(searchParams, 'from') === 'app',
      }}
      deposito={senaCobrable ? deposito : null}
    />
  )
}
