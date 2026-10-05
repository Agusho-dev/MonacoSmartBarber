'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'

/**
 * Columnas de `staff` que necesita el kiosko, y ni una más.
 *
 * `getCheckinData` es una server action PÚBLICA (la llama la tablet de entrada,
 * sin sesión) que corre con service role: lo que devuelve llega tal cual al
 * browser de una tablet que está en el salón, al alcance de cualquiera. Con
 * `select('*')` viajaban el PIN de 4 dígitos de cada barbero —en texto plano—,
 * su email, su teléfono y su `auth_user_id`. Con el PIN se entra al panel como
 * ese barbero: es exactamente lo que la mig 212 le cerró a la anon key, y esta
 * action lo seguía entregando por la puerta de al lado.
 *
 * Son las que lee `checkin-walk-in.tsx` (tarjeta: nombre, avatar y estado;
 * filtro de ocultos) y las de `barber-utils` a las que les pasa el staff: `id`
 * en todas, `hidden_from_checkin` en la asignación dinámica, `is_active`,
 * `role` e `is_also_barber` en el contador de barberos capaces y `status` en
 * `getMobileBarberStatus`. Si una pantalla del kiosko necesita otra columna se
 * agrega acá con nombre — nunca `*`, y nunca `pin`, `email` ni `auth_user_id`.
 */
const STAFF_KIOSKO_COLS =
  'id, full_name, avatar_url, status, is_active, role, is_also_barber, hidden_from_checkin, branch_id'

type ErrorDeLectura = { message: string } | null

export async function getCheckinData(branchId: string) {
  if (!branchId || !isValidUUID(branchId)) return { error: 'No branch provided' }

  const supabase = createAdminClient()

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su org.
  // `*` sólo para leer `menor_espera_aviso` (mig 218) y `asesoria_habilitada`
  // (mig 217) de forma TOLERANTE (ver el final): esta fila no sale del servidor,
  // lo único que viaja son esos dos booleanos.
  const { data: branchCheck, error: branchError } = await supabase
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  // Una base caída no es una sucursal inexistente: decirlo así mandaba a buscar
  // el problema en la configuración de la tablet.
  if (branchError) {
    console.error('[getCheckinData] branches', { branchId, error: branchError.message })
    return { error: 'No pudimos verificar la sucursal' }
  }
  if (!branchCheck) return { error: 'Sucursal no encontrada o inactiva' }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  try {
    // Envuelto en una promesa real a propósito: el builder de PostgREST dispara
    // la request en CADA `.then()`, y este resultado lo esperan dos (el
    // Promise.all y la consulta de jornadas). Sin envolverlo, el staff se
    // pediría dos veces.
    const staffP = Promise.resolve(
      supabase
        .from('staff')
        .select(STAFF_KIOSKO_COLS)
        .eq('branch_id', branchId)
        .or('role.eq.barber,is_also_barber.eq.true')
        .eq('is_active', true)
        .order('full_name')
    )

    // Jornadas del día SÓLO de los barberos que devolvemos. Antes se pedían las
    // de todas las organizaciones, sin filtro: el kiosko las cruza por
    // `staff_id` y en pantalla no cambiaba nada, pero el browser de la tablet
    // recibía los horarios del equipo de los otros tenants. Filtrar por
    // `staff_schedules.branch_id` no alcanzaba: NULL significa "todas las
    // sucursales del barbero", así que el corte va por el barbero. (Las
    // columnas no son el problema acá —una jornada no tiene nada sensible—,
    // por eso siguen enteras.)
    const jornadasP = staffP.then(async (staffRes) => {
      // Sin barberos no hay jornadas que pedir; la falla ya la reporta `staff`.
      if (staffRes.error) return { data: null, error: null as ErrorDeLectura }
      const ids = (staffRes.data ?? []).map((s) => s.id as string)
      if (ids.length === 0) return { data: [], error: null as ErrorDeLectura }
      const { data, error } = await supabase
        .from('staff_schedules')
        .select('*')
        .in('staff_id', ids)
        .eq('day_of_week', new Date().getDay())
        .eq('is_active', true)
      return { data, error: error as ErrorDeLectura }
    })

    const [staffRes, queueRes, visitsRes, availableRes, openRes, attendanceRes, servicesRes, schedulesRes, settingsRes, todayVisitsRes] = await Promise.all([
      staffP,
      // `*` acá sí: `queue_entries` no guarda credenciales y la anon key ya la
      // lee entera (es lo que re-lee el propio kiosko por Realtime). Listar
      // columnas sólo haría que las nuevas de la fila no le lleguen.
      supabase
        .from('queue_entries')
        .select('*')
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress']),
      supabase
        .from('visits')
        .select('barber_id, started_at, completed_at')
        .eq('branch_id', branchId)
        .order('completed_at', { ascending: false })
        .limit(200),
      supabase.rpc('get_available_barbers_today', { p_branch_id: branchId }),
      supabase.rpc('get_branch_open_status', { p_branch_id: branchId }),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .eq('branch_id', branchId)
        .gte('recorded_at', dayStart.toISOString())
        .order('recorded_at', { ascending: false }),
      supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .in('availability', ['checkin', 'both'])
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('name'),
      jornadasP,
      // `*` por la misma tolerancia que `branches` (mig 218). Abajo se arma a
      // mano lo que viaja: nunca la fila entera, que no es asunto del kiosko.
      supabase
        .from('app_settings')
        .select('*')
        .eq('organization_id', branchCheck.organization_id)
        .maybeSingle(),
      supabase
        .from('visits')
        .select('barber_id')
        .eq('branch_id', branchId)
        .gte('completed_at', dayStart.toISOString())
        .not('barber_id', 'is', null),
    ])

    // Ninguna lectura falla en silencio (Known Risk #13). Hay dos clases:
    //
    // · Las que deciden QUIÉN puede atender y en qué estado está la fila
    //   (barberos, fila, fichajes, jornadas). Si una falla devolvemos error y el
    //   kiosko conserva lo último que tenía: dibujar con esa pieza vacía
    //   mostraría a todos "Aún no llegó", o una fila sin nadie esperando, y el
    //   cliente elegiría barbero sobre un estado falso.
    // · Las que sólo afinan (promedios, cortes de hoy, servicios, margen de fin
    //   de turno, horario). Se loguean y viajan en `null`: el kiosko no pisa lo
    //   que ya tenía (`if (res.x)`) y en la primera carga usa sus defaults.
    const criticas: Array<[string, ErrorDeLectura]> = [
      ['staff', staffRes.error],
      ['queue_entries', queueRes.error],
      ['attendance_logs', attendanceRes.error],
      ['staff_schedules', schedulesRes.error],
    ]
    const fallidas = criticas.filter(([, error]) => error)
    if (fallidas.length > 0) {
      for (const [tabla, error] of fallidas) {
        console.error(`[getCheckinData] ${tabla}`, { branchId, error: error?.message })
      }
      return { error: `No pudimos leer la fila de la sucursal (${fallidas.map(([tabla]) => tabla).join(', ')})` }
    }

    const opcionales: Array<[string, ErrorDeLectura]> = [
      ['visits', visitsRes.error],
      ['get_available_barbers_today', availableRes.error],
      ['get_branch_open_status', openRes.error],
      ['services', servicesRes.error],
      ['app_settings', settingsRes.error],
      ['visits (hoy)', todayVisitsRes.error],
    ]
    for (const [origen, error] of opcionales) {
      if (error) console.error(`[getCheckinData] ${origen}`, { branchId, error: error.message })
    }

    const ajustes = settingsRes.error
      ? null
      : (settingsRes.data as Record<string, unknown> | null)

    // Menor espera por WhatsApp (mig 218): si la sucursal lo tiene prendido, el
    // paso de barbero le avisa al que elige un barbero puntual que, si la espera
    // se estira, le vamos a ofrecer pasarse. Se lee TOLERANTE porque este código
    // puede llegar a producción antes que la migración: con `select('*')` una
    // columna que todavía no existe simplemente no viene (= apagado), en vez de
    // tumbar la consulta con un 42703.
    const avisoMenorEspera = (branchCheck as Record<string, unknown>).menor_espera_aviso === true
    const minutosMenorEspera = ajustes?.menor_espera_minutos

    // Asesoría sin costo (mig 217): el interruptor es POR SUCURSAL y sale de la
    // misma fila de `branches` que ya se leyó arriba, sin consulta extra. Si esa
    // lectura hubiera fallado ya se devolvió error, así que lo que viaja acá es
    // un valor CONFIRMADO: sin confirmación el kiosko no muestra el botón. Y sólo
    // `=== true`: una columna ausente o rara se lee como apagada.
    const asesoriaHabilitada = (branchCheck as Record<string, unknown>).asesoria_habilitada === true

    return {
      staff: staffRes.data ?? [],
      queueEntries: queueRes.data ?? [],
      visits: visitsRes.error ? null : (visitsRes.data ?? []),
      availableBarbers: availableRes.error ? null : (availableRes.data ?? []),
      openStatus: openRes.error ? null : (openRes.data ?? []),
      attendance: attendanceRes.data ?? [],
      services: servicesRes.error ? null : (servicesRes.data ?? []),
      schedules: schedulesRes.data ?? [],
      settings: ajustes
        ? { shift_end_margin_minutes: ajustes.shift_end_margin_minutes as number | null }
        : null,
      todayVisits: todayVisitsRes.error ? null : (todayVisitsRes.data ?? []),
      menorEspera: {
        aviso: avisoMenorEspera,
        minutos: typeof minutosMenorEspera === 'number' ? minutosMenorEspera : 45,
      },
      // «¿No sabés qué hacerte?» en el paso de servicio y «Pedir asesoría» en
      // «Mi turno». El servidor lo vuelve a validar al anotar (checkinClient,
      // checkinClientByFace, pedirAsesoriaDesdeMiTurno).
      asesoria: {
        habilitada: asesoriaHabilitada,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
