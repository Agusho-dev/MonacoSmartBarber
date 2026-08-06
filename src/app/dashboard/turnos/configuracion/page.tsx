import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getAppointmentSettings, getAppointmentStaff } from '@/lib/actions/appointments'
import { getBranchAppointmentDays } from '@/lib/actions/appointment-days'
import { getBranchAppointmentHours } from '@/lib/actions/appointment-hours'
import { listTemplatesForPicker } from '@/lib/actions/messaging'
import { createAdminClient } from '@/lib/supabase/server'
import { TurnosConfigClient } from './turnos-config-client'
import type {
  AgendaTurnos,
  BarberoConfig,
  JornadaSemanal,
  Tramo,
  ServicioReservable,
} from '@/components/appointments/config/tipos'
import { normalizarHora, normalizarTramos, semanaSinFranjas } from '@/components/appointments/config/tipos'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Configuración de Turnos | Monaco Smart Barber',
}

interface Props {
  searchParams: Promise<{ sucursal?: string }>
}

export default async function TurnosConfigPage({ searchParams }: Props) {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  // Guard de permiso: `appointments.configure` sólo escondía el ítem del
  // sidebar, pero entrar por URL directa mostraba todo igual.
  if (!(await currentUserCan('appointments.configure'))) redirect('/dashboard')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()

  const { data: branchRows } = branchIds.length
    ? await supabase
        .from('branches')
        .select('id, name, slug, operation_mode, timezone, business_hours_open, business_hours_close')
        .eq('organization_id', orgId)
        .in('id', branchIds)
        .eq('is_active', true)
        .order('name')
    : { data: [] }

  const sucursales = (branchRows ?? []).map(b => ({
    id: b.id as string,
    nombre: b.name as string,
    slug: (b.slug as string | null) ?? null,
    modo: ((b.operation_mode as BranchOperationMode | null) ?? 'walk_in') as BranchOperationMode,
  }))

  // Sucursal en pantalla: la del query param si es accesible; si no, la primera
  // que ya trabaja con turnos (es la que el dueño quiere configurar) y recién
  // ahí la primera de la lista.
  const { sucursal: sucursalParam } = await searchParams
  const sucursalActiva =
    sucursales.find(s => s.id === sucursalParam) ??
    sucursales.find(s => s.modo !== 'walk_in') ??
    sucursales[0] ??
    null

  if (!sucursalActiva) {
    return (
      <TurnosConfigClient
        sucursales={[]}
        sucursalActivaId={null}
        modoSucursal="walk_in"
        slugSucursal={null}
        alcanceReglas="org"
        settings={null}
        barberos={[]}
        agenda={{}}
        jornada={{}}
        usaAgendaPorDia={false}
        hayDiasDeBarberosOcultos={false}
        franjas={semanaSinFranjas()}
        usaFranjasGuardadas={false}
        horarioComercial={{ inicio: '08:00', fin: '22:00' }}
        servicios={[]}
        templates={[]}
        hasWhatsAppChannel={false}
        org={{ nombre: '', slug: '', logoUrl: null }}
      />
    )
  }

  const [
    settings,
    staffTurnos,
    diasDeTurnos,
    horarioTurnero,
    { data: staffRows },
    { data: servicioRows },
    templatesResult,
    { data: orgRow },
    { data: overrideRow },
  ] =
    await Promise.all([
      getAppointmentSettings(orgId, sucursalActiva.id),
      getAppointmentStaff(orgId),
      // Agenda de turnos por día (mig 171). Es lo que edita la grilla semanal:
      // un eje distinto de `staff_schedules`, que acá es sólo contexto.
      getBranchAppointmentDays(sucursalActiva.id),
      // Franjas en que la sucursal acepta turnos (mig 172). Con al menos una,
      // el motor deja de mirar appointment_hours_open/close + appointment_days.
      getBranchAppointmentHours(sucursalActiva.id),
      supabase
        .from('staff')
        .select('id, full_name, avatar_url')
        .eq('organization_id', orgId)
        .eq('branch_id', sucursalActiva.id)
        .eq('is_active', true)
        .or('role.eq.barber,is_also_barber.eq.true')
        .order('full_name'),
      // Mismo filtro que usa el turnero público (`publicGetBranchServices`):
      // si acá se listara otra cosa, el checklist mentiría sobre qué se puede
      // reservar online.
      supabase
        .from('services')
        .select('id, name, duration_minutes')
        .eq('is_active', true)
        .in('booking_mode', ['self_service', 'both'])
        .or(`branch_id.is.null,branch_id.eq.${sucursalActiva.id}`)
        .order('name'),
      listTemplatesForPicker(),
      supabase.from('organizations').select('name, slug, logo_url').eq('id', orgId).maybeSingle(),
      supabase
        .from('appointment_settings')
        .select('id')
        .eq('organization_id', orgId)
        .eq('branch_id', sucursalActiva.id)
        .maybeSingle(),
    ])

  const barberosDeLaSucursal = (staffRows ?? []) as Array<{ id: string; full_name: string; avatar_url: string | null }>
  const idsBarberos = barberosDeLaSucursal.map(s => s.id)

  // `branch_id` NULL = la jornada aplica a todas las sucursales del staff. Es el
  // caso de todas las filas de producción; el `.or` respeta el mismo criterio
  // que el motor de disponibilidad.
  const { data: horarioRows } = idsBarberos.length
    ? await supabase
        .from('staff_schedules')
        .select('staff_id, day_of_week, start_time, end_time')
        .in('staff_id', idsBarberos)
        .eq('is_active', true)
        .or(`branch_id.is.null,branch_id.eq.${sucursalActiva.id}`)
    : { data: [] }

  // Jornada de trabajo: en esta pantalla es SÓLO contexto ("¿el día que estoy
  // asignando es un día que este barbero trabaja?"). No se escribe.
  const jornada: JornadaSemanal = {}
  for (const id of idsBarberos) jornada[id] = {}
  for (const fila of (horarioRows ?? []) as Array<{ staff_id: string; day_of_week: number; start_time: string; end_time: string }>) {
    const dias = jornada[fila.staff_id]
    if (!dias) continue
    const tramo: Tramo = { inicio: fila.start_time, fin: fila.end_time }
    dias[fila.day_of_week] = [...(dias[fila.day_of_week] ?? []), tramo]
  }
  // Dedup: `staff_schedules` no tiene UNIQUE(staff_id, day_of_week) y en prod
  // hay jornadas cargadas dos veces.
  for (const dias of Object.values(jornada)) {
    for (const dia of Object.keys(dias)) {
      dias[Number(dia)] = normalizarTramos(dias[Number(dia)])
    }
  }

  // Agenda de turnos: lo que sí edita la grilla. Que la clave del día exista ya
  // significa "toma turnos ese día"; `franja` null = toda su jornada.
  const agenda: AgendaTurnos = {}
  for (const id of idsBarberos) agenda[id] = {}
  let hayDiasDeBarberosOcultos = false
  for (const dia of diasDeTurnos.dias) {
    // Puede haber filas de barberos que ya no están activos en la sucursal: no
    // tienen fila en la grilla, así que no se dibujan — pero mantienen a la
    // sucursal en el modelo por día, igual que para el motor.
    if (!agenda[dia.staff_id]) {
      hayDiasDeBarberosOcultos = true
      continue
    }
    agenda[dia.staff_id][dia.day_of_week] = {
      franja: dia.start_time && dia.end_time ? { inicio: dia.start_time, fin: dia.end_time } : null,
    }
  }

  const habilitados = new Map(staffTurnos.map(s => [s.staff_id, s]))

  const barberos: BarberoConfig[] = barberosDeLaSucursal.map(s => {
    const cfg = habilitados.get(s.id)
    return {
      id: s.id,
      nombre: s.full_name?.trim() || 'Sin nombre',
      avatarUrl: s.avatar_url,
      recibeTurnos: !!cfg,
      soloTurnos: cfg?.walkin_mode === 'appointments_only',
    }
  })

  const servicios: ServicioReservable[] = ((servicioRows ?? []) as Array<{ id: string; name: string; duration_minutes: number | null }>)
    .map(s => ({ id: s.id, nombre: s.name, duracionMinutos: s.duration_minutes }))

  // Horario comercial: acota la grilla de pintar a horas que existen. Sin dato
  // cargado se usa 08:00–22:00, que cubre a cualquier barbería.
  const filaSucursal = (branchRows ?? []).find(b => b.id === sucursalActiva.id) as
    | { business_hours_open: string | null; business_hours_close: string | null }
    | undefined
  const horarioComercial: Tramo = {
    inicio: normalizarHora(filaSucursal?.business_hours_open) || '08:00',
    fin: normalizarHora(filaSucursal?.business_hours_close) || '22:00',
  }

  const totalFranjas = Object.values(horarioTurnero.franjas).reduce((n, f) => n + f.length, 0)

  return (
    <TurnosConfigClient
      // La `key` fuerza el remount cuando cambia la verdad del servidor:
      //  - otra sucursal (el estado local entero pertenece a una sucursal),
      //  - settings recién guardados (`updated_at`),
      //  - modo de operación cambiado desde el diálogo, que además prende el
      //    turnero y da de alta barberos por debajo,
      //  - la sucursal pasó a tener (o dejó de tener) agenda por día, que
      //    cambia el modelo entero de la grilla,
      //  - cambió la cantidad de franjas del turnero, que cambia el otro modelo
      //    (rango único vs. franjas).
      // Sin esto el formulario seguiría mostrando los valores viejos sobre
      // datos nuevos y el checklist mentiría.
      key={`${sucursalActiva.id}:${settings?.updated_at ?? 'sin-settings'}:${sucursalActiva.modo}:${diasDeTurnos.dias.length}:${totalFranjas}`}
      sucursales={sucursales}
      sucursalActivaId={sucursalActiva.id}
      modoSucursal={sucursalActiva.modo}
      slugSucursal={sucursalActiva.slug}
      alcanceReglas={overrideRow ? 'sucursal' : 'org'}
      settings={settings}
      barberos={barberos}
      agenda={agenda}
      jornada={jornada}
      usaAgendaPorDia={diasDeTurnos.usaAgendaPorDia}
      hayDiasDeBarberosOcultos={hayDiasDeBarberosOcultos}
      franjas={horarioTurnero.franjas}
      usaFranjasGuardadas={horarioTurnero.usaFranjas}
      horarioComercial={horarioComercial}
      servicios={servicios}
      templates={templatesResult.data}
      hasWhatsAppChannel={templatesResult.hasChannel}
      org={{
        nombre: orgRow?.name ?? '',
        slug: orgRow?.slug ?? '',
        logoUrl: orgRow?.logo_url ?? null,
      }}
    />
  )
}
