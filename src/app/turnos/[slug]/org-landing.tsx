'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  CalendarCheck,
  ChevronRight,
  Clock,
  Compass,
  Loader2,
  MapPin,
  Phone,
  Search,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Tipos ───────────────────────────────────────────────────────────

export interface LandingBranch {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  /** true = acepta reservas online (modo appointments/hybrid + turnero activo) */
  bookable: boolean
  openNow: boolean
  /** "Abierto hasta las 21:00", "Abre hoy 09:00", "Cerrado hoy" */
  hoursLabel: string
}

interface Branding {
  bg: string
  primary: string
  text: string
  logo_url: string | null
  welcome_message: string | null
}

interface Props {
  orgName: string
  branches: LandingBranch[]
  branding: Branding
}

// ─── Distancia (Haversine, km) ───────────────────────────────────────

function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

function mapsUrlFor(branch: LandingBranch): string | null {
  if (branch.latitude != null && branch.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${branch.latitude},${branch.longitude}`
  }
  if (branch.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`
  }
  return null
}

// ─── Componente ──────────────────────────────────────────────────────

export function OrgLanding({ orgName, branches, branding }: Props) {
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  // Ordenar por cercanía sólo tiene sentido si al menos 2 sucursales
  // tienen coordenadas cargadas.
  const geoCapable =
    branches.filter(b => b.latitude != null && b.longitude != null).length >= 2

  const showSearch = branches.length > 5

  const bookableCount = branches.filter(b => b.bookable).length

  const decorated = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? branches.filter(
          b =>
            b.name.toLowerCase().includes(q) ||
            (b.address ?? '').toLowerCase().includes(q)
        )
      : branches

    const withDistance = filtered.map(b => ({
      branch: b,
      distance:
        coords && b.latitude != null && b.longitude != null
          ? distanceKm(coords.lat, coords.lon, b.latitude, b.longitude)
          : null,
    }))

    if (coords) {
      withDistance.sort((a, b) => {
        // Sin coordenadas cargadas van al final, nunca intercaladas.
        if (a.distance == null && b.distance == null) return 0
        if (a.distance == null) return 1
        if (b.distance == null) return -1
        return a.distance - b.distance
      })
    }

    return withDistance
  }, [branches, query, coords])

  function locate() {
    if (!navigator.geolocation) {
      setGeoError('Tu navegador no permite compartir la ubicación.')
      return
    }
    setLocating(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setGeoError('No pudimos obtener tu ubicación. Elegí la sucursal a mano.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: branding.bg }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: branding.bg, borderColor: 'rgba(0,0,0,0.08)' }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {branding.logo_url ? (
            <Image
              src={branding.logo_url}
              alt={orgName}
              width={36}
              height={36}
              unoptimized
              className="h-9 w-9 shrink-0 rounded-full object-cover shadow-sm"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: branding.primary }}
            >
              {orgName.charAt(0).toUpperCase()}
            </div>
          )}
          <p
            className="truncate text-sm font-bold leading-tight"
            style={{ color: branding.text }}
          >
            {orgName}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        {/* Título */}
        <div className="mb-5">
          <h1 className="text-xl font-bold" style={{ color: branding.text }}>
            {bookableCount > 0 ? 'Elegí tu sucursal' : 'Nuestras sucursales'}
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: branding.text, opacity: 0.6 }}
          >
            {branding.welcome_message ??
              (bookableCount > 0
                ? 'Reservá tu turno online en el local que te quede más cómodo.'
                : 'Acercate cuando quieras, te atendemos por orden de llegada.')}
          </p>
        </div>

        {/* Controles */}
        {(showSearch || geoCapable) && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            {showSearch && (
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: branding.text, opacity: 0.4 }}
                />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por nombre o dirección"
                  aria-label="Buscar sucursal"
                  className="h-11 w-full rounded-xl border bg-white/70 pl-9 pr-3 text-sm outline-none transition-colors focus:border-current"
                  style={{
                    borderColor: 'rgba(0,0,0,0.12)',
                    color: branding.text,
                  }}
                />
              </div>
            )}
            {geoCapable && (
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-opacity disabled:opacity-60"
                style={{
                  borderColor: coords ? branding.primary : 'rgba(0,0,0,0.12)',
                  color: coords ? '#ffffff' : branding.primary,
                  backgroundColor: coords ? branding.primary : 'transparent',
                }}
              >
                {locating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Compass className="h-4 w-4" />
                )}
                {coords ? 'Ordenado por cercanía' : 'La más cercana'}
              </button>
            )}
          </div>
        )}

        {geoError && (
          <p className="mb-3 text-xs" style={{ color: '#b91c1c' }}>
            {geoError}
          </p>
        )}

        {/* Lista de sucursales */}
        {decorated.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center"
            style={{ borderColor: 'rgba(0,0,0,0.10)' }}
          >
            <Search className="h-7 w-7 opacity-30" style={{ color: branding.text }} />
            <p className="text-sm font-medium" style={{ color: branding.text }}>
              No encontramos ninguna sucursal con ese nombre
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {decorated.map(({ branch, distance }) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                distance={distance}
                branding={branding}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Card de sucursal ────────────────────────────────────────────────

function BranchCard({
  branch,
  distance,
  branding,
}: {
  branch: LandingBranch
  distance: number | null
  branding: Branding
}) {
  const maps = mapsUrlFor(branch)

  // Card entera como contenedor (no como <a>): las acciones secundarias tienen
  // que quedar DENTRO de su tarjeta. Colgadas afuera se leían como si
  // pertenecieran a la sucursal siguiente. Además evita anidar anchors.
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-2xl border bg-white/80 transition-shadow',
        branch.bookable && 'hover:shadow-md'
      )}
      style={{ borderColor: 'rgba(0,0,0,0.08)' }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p
                className="truncate text-base font-bold leading-tight"
                style={{ color: branding.text }}
              >
                {branch.name}
              </p>
              {distance != null && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    backgroundColor: `${branding.primary}12`,
                    color: branding.primary,
                  }}
                >
                  {formatDistance(distance)}
                </span>
              )}
            </div>

            {branch.address && (
              <p
                className="mt-1 flex items-center gap-1 truncate text-xs"
                style={{ color: branding.text, opacity: 0.6 }}
              >
                <MapPin className="h-3 w-3 shrink-0" />
                {branch.address}
              </p>
            )}

            <p
              className="mt-1.5 flex items-center gap-1 text-xs font-medium"
              style={{
                color: branch.openNow ? '#15803d' : branding.text,
                opacity: branch.openNow ? 1 : 0.55,
              }}
            >
              <Clock className="h-3 w-3 shrink-0" />
              {branch.hoursLabel}
            </p>
          </div>

          {!branch.bookable && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{
                backgroundColor: `${branding.text}0d`,
                color: branding.text,
                opacity: 0.7,
              }}
            >
              <Users className="h-3 w-3" />
              Sin turno
            </span>
          )}
        </div>

        {branch.bookable && (
          <Link
            href={`/turnos/${branch.slug}`}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.99]"
            style={{ backgroundColor: branding.primary }}
          >
            <CalendarCheck className="h-4 w-4" />
            Reservar turno
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}

        {!branch.bookable && (
          <p className="mt-2 text-xs" style={{ color: branding.text, opacity: 0.55 }}>
            Acercate cuando quieras, se atiende por orden de llegada.
          </p>
        )}
      </div>

      {(maps || branch.phone) && (
        <div
          className="flex divide-x border-t"
          style={{ borderColor: 'rgba(0,0,0,0.06)' }}
        >
          {maps && (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors hover:bg-black/[0.03]"
              style={{ color: branding.primary, borderColor: 'rgba(0,0,0,0.06)' }}
            >
              <MapPin className="h-3.5 w-3.5" />
              Cómo llegar
            </a>
          )}
          {branch.phone && (
            <a
              href={`tel:${branch.phone}`}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors hover:bg-black/[0.03]"
              style={{ color: branding.primary, borderColor: 'rgba(0,0,0,0.06)' }}
            >
              <Phone className="h-3.5 w-3.5" />
              Llamar
            </a>
          )}
        </div>
      )}
    </div>
  )
}
