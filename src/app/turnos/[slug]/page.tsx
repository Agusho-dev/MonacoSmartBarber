import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { publicGetBranchServices, publicGetAvailableStaff } from '@/lib/actions/public-booking'
import { isValidUUID } from '@/lib/validation'
import { BookingWizard } from './booking-wizard'
import { OrgLanding, type LandingBranch } from './org-landing'
import { LinkInvalido } from './link-invalido'
import { estadoHorario } from './horarios'
import { MapPin, Phone } from 'lucide-react'
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
    const bg = settings?.brand_bg_color ?? '#f8fafc'
    const primary = settings?.brand_primary_color ?? '#0f172a'
    const textColor = settings?.brand_text_color ?? '#0f172a'
    const mapsUrl = branch.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`
      : null

    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: bg }}
      >
        <div
          className="w-full max-w-md rounded-2xl border bg-white/90 p-8 text-center shadow-lg"
          style={{ borderColor: 'rgba(0,0,0,0.08)' }}
        >
          {org?.logo_url ? (
            <Image
              src={org.logo_url}
              alt={branch.name}
              width={64}
              height={64}
              unoptimized
              className="mx-auto mb-4 h-16 w-16 rounded-full object-cover shadow-sm"
            />
          ) : (
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white"
              style={{ backgroundColor: primary }}
            >
              {branch.name.charAt(0).toUpperCase()}
            </div>
          )}

          <h1 className="mb-1 text-2xl font-bold" style={{ color: textColor }}>
            {branch.name}
          </h1>
          <p className="mb-6 text-sm font-medium text-amber-600">
            Esta sucursal trabaja sin turno previo
          </p>
          <p className="mb-6 text-sm" style={{ color: textColor, opacity: 0.75 }}>
            Podés acercarte directamente sin reserva. Te atendemos por orden de llegada.
          </p>

          <div className="space-y-3">
            {branch.address && (
              <div className="flex items-start gap-2 text-sm" style={{ color: textColor }}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                <span>{branch.address}</span>
              </div>
            )}
            {branch.phone && (
              <div className="flex items-center gap-2 text-sm" style={{ color: textColor }}>
                <Phone className="h-4 w-4 shrink-0 opacity-60" />
                <a href={`tel:${branch.phone}`} className="hover:underline">
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
              className="mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: primary }}
            >
              <MapPin className="h-4 w-4" />
              Ver en Google Maps
            </a>
          )}
        </div>
      </div>
    )
  }

  // Cargar datos necesarios para el wizard en paralelo
  const [services, staff] = await Promise.all([
    publicGetBranchServices(branch.id),
    publicGetAvailableStaff(branch.id),
  ])

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
      settings={{
        max_advance_days: settings.max_advance_days,
        appointment_days: settings.appointment_days,
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
    />
  )
}
