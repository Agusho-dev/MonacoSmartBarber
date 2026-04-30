import { notFound } from 'next/navigation'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { publicGetBranchServices, publicGetAvailableStaff } from '@/lib/actions/public-booking'
import { BookingWizard } from './booking-wizard'
import { MapPin, Phone } from 'lucide-react'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('name')
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  return { title: branch ? `Turnos | ${branch.name}` : 'Turnos online' }
}

export default async function TurnosPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createAdminClient()

  // Lookup de sucursal por slug
  const { data: branch } = await supabase
    .from('branches')
    .select('id, name, slug, organization_id, operation_mode, address, phone, timezone')
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  if (!branch) notFound()

  // Obtener logo de la org para el branding
  const { data: org } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', branch.organization_id)
    .maybeSingle()

  const settings = await getAppointmentSettings(branch.organization_id, branch.id)

  // Modo walk-in: mostrar página informativa sin wizard
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
    />
  )
}
