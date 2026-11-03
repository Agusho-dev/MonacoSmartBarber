// Recalcula las tardanzas de una organización desde una fecha, con la misma regla que se
// usa al fichar (src/lib/tardanza.ts). Sin `--aplicar` no escribe nada: muestra el resultado.
//
//   npx tsx --env-file=.env scripts/recalcular-tardanzas.ts --org <uuid> --desde 2026-10-01 \
//     [--excluir "Test"] [--aplicar]
//
// `--aplicar` sólo INSERTA las nuevas e imprime el corte. Las viejas se borran aparte, con
// `created_at < <corte>` y después de guardarlas, porque es una decisión que hay que mirar
// (ver supabase/migrations/236_tardanzas_por_entrada.sql). Toca únicamente eventos de
// `source = 'system'`: una tardanza o una falta cargada a mano no se recalcula.

import { createClient } from '@supabase/supabase-js'
import {
  aMinutos,
  evaluarLlegada,
  horaEnZona,
  leerReglaTardanza,
  notaDeTardanza,
  type MarcaDelDia,
} from '../src/lib/tardanza'

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const org = argumento('org')
const desde = argumento('desde')
const excluir = argumento('excluir')
const aplicar = process.argv.includes('--aplicar')
if (!org || !desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
  console.error('Faltan --org <uuid> y --desde YYYY-MM-DD')
  process.exit(1)
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function todas<T>(armar: (d: number, h: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await armar(d, d + 999)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) return filas
  }
}

const fechaEnZona = (instante: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(instante)
const diaDeLaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay()

async function principal() {
  const { data: ajustes, error: errAjustes } = await db
    .from('app_settings')
    .select('tardanza_entradas, tardanza_vuelta, tardanza_tolerancia_minutos')
    .eq('organization_id', org!)
    .maybeSingle()
  if (errAjustes) throw new Error(errAjustes.message)
  const regla = leerReglaTardanza(ajustes)
  if (!regla) throw new Error('La organización no tiene entradas cargadas en app_settings: no hay nada para recalcular.')

  const { data: sucursales, error: errSuc } = await db.from('branches').select('id, name, timezone').eq('organization_id', org!)
  if (errSuc) throw new Error(errSuc.message)
  const validas = (sucursales ?? []).filter((s) => s.name !== excluir)
  const zonaDe = new Map(validas.map((s) => [s.id as string, (s.timezone as string) || 'America/Argentina/Buenos_Aires']))
  const nombreSuc = new Map(validas.map((s) => [s.id as string, s.name as string]))

  const { data: personal, error: errStaff } = await db.from('staff').select('id, full_name').eq('organization_id', org!)
  if (errStaff) throw new Error(errStaff.message)
  const nombreDe = new Map((personal ?? []).map((p) => [p.id as string, (p.full_name as string).trim()]))
  const ids = [...nombreDe.keys()]

  const horarios = await todas<{ staff_id: string; day_of_week: number; start_time: string; end_time: string; block_index: number }>((d, h) =>
    db.from('staff_schedules').select('staff_id, day_of_week, start_time, end_time, block_index').in('staff_id', ids).eq('is_active', true).order('id').range(d, h),
  )

  const inicio = `${desde}T00:00:00-03:00`
  const marcas = await todas<{ id: string; staff_id: string; branch_id: string; action_type: 'clock_in' | 'clock_out'; recorded_at: string }>((d, h) =>
    db.from('attendance_logs').select('id, staff_id, branch_id, action_type, recorded_at').in('branch_id', [...zonaDe.keys()]).gte('recorded_at', inicio).order('recorded_at').order('id').range(d, h),
  )

  // Una lista de marcas por persona y día local.
  const porDia = new Map<string, typeof marcas>()
  for (const m of marcas) {
    const fecha = fechaEnZona(new Date(m.recorded_at), zonaDe.get(m.branch_id)!)
    const clave = `${m.staff_id}|${fecha}`
    const lista = porDia.get(clave)
    if (lista) lista.push(m)
    else porDia.set(clave, [m])
  }

  type Fila = {
    staff_id: string
    branch_id: string
    event_type: 'late'
    event_date: string
    occurrence_number: number
    notes: string
    source: 'system'
    hora_llegada: string
    hora_esperada: string
    minutos_tarde: number
  }
  const filas: Fila[] = []

  for (const [clave, delDia] of porDia) {
    const [staffId, fecha] = clave.split('|')
    if (!nombreDe.has(staffId)) continue
    const dow = diaDeLaSemana(fecha)
    const bloques = horarios
      .filter((h) => h.staff_id === staffId && h.day_of_week === dow)
      .sort((a, b) => a.block_index - b.block_index)

    const previas: MarcaDelDia[] = []
    for (const m of delDia) {
      const hora = horaEnZona(new Date(m.recorded_at), zonaDe.get(m.branch_id)!)
      const minutos = aMinutos(hora)
      if (m.action_type === 'clock_in') {
        const r = evaluarLlegada({ llegadaMin: minutos, marcasPrevias: previas, bloques, regla })
        if (r.tarde) {
          // Una tardanza por día, como al fichar.
          filas.push({
            staff_id: staffId,
            branch_id: m.branch_id,
            event_type: 'late',
            event_date: fecha,
            occurrence_number: 0,
            notes: notaDeTardanza(minutos, r.esperadaMin, r.motivo),
            source: 'system',
            hora_llegada: hora,
            hora_esperada: `${String(Math.floor(r.esperadaMin / 60)).padStart(2, '0')}:${String(r.esperadaMin % 60).padStart(2, '0')}:00`,
            minutos_tarde: r.minutosTarde,
          })
          break
        }
      }
      previas.push({ action_type: m.action_type, minutos })
    }
  }

  // La ocurrencia cuenta dentro del mes, por persona y en orden de fecha.
  filas.sort((a, b) => a.event_date.localeCompare(b.event_date))
  const cuenta = new Map<string, number>()
  for (const f of filas) {
    const clave = `${f.staff_id}|${f.event_date.slice(0, 7)}`
    const n = (cuenta.get(clave) ?? 0) + 1
    cuenta.set(clave, n)
    f.occurrence_number = n
  }

  const { data: actuales, error: errAct } = await db
    .from('disciplinary_events')
    .select('id, staff_id, event_date, event_type, source')
    .in('branch_id', [...zonaDe.keys()])
    .gte('event_date', desde)
    .limit(5000)
  if (errAct) throw new Error(errAct.message)
  const delSistema = (actuales ?? []).filter((e) => e.source === 'system' && e.event_type === 'late')

  const resumen = new Map<string, { sucursal: string; ahora: number; nuevas: number; vueltas: number }>()
  const fila = (id: string, sucursal: string) => {
    const nombre = nombreDe.get(id) ?? id
    let r = resumen.get(nombre)
    if (!r) {
      r = { sucursal, ahora: 0, nuevas: 0, vueltas: 0 }
      resumen.set(nombre, r)
    }
    return r
  }
  for (const f of filas) {
    const r = fila(f.staff_id, nombreSuc.get(f.branch_id) ?? '')
    r.nuevas += 1
    if (f.notes.startsWith('Volvió')) r.vueltas += 1
  }
  for (const e of delSistema) fila(e.staff_id as string, '').ahora += 1

  console.log(`Regla: entradas ${regla.entradas.map((m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`).join(' y ')}, vuelta ${regla.vuelta}, tolerancia ${regla.toleranciaMin} min`)
  console.log(`Desde ${desde}: ${delSistema.length} tardanzas hoy → ${filas.length} con la regla. Días-persona evaluados: ${porDia.size}.`)
  console.table([...resumen.entries()].sort((a, b) => a[1].sucursal.localeCompare(b[1].sucursal) || a[0].localeCompare(b[0])).map(([nombre, r]) => ({ nombre, sucursal: r.sucursal, hoy: r.ahora, nuevas: r.nuevas, 'de ellas, vuelta 16': r.vueltas })))
  const hoy = fechaEnZona(new Date(), 'America/Argentina/Buenos_Aires')
  console.log('Las de hoy:', filas.filter((f) => f.event_date === hoy).map((f) => `${nombreDe.get(f.staff_id)}: ${f.notes}`))

  if (!aplicar) {
    console.log('\nNo se escribió nada. Con --aplicar se insertan las nuevas.')
    return
  }
  const corte = new Date().toISOString()
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await db.from('disciplinary_events').insert(filas.slice(i, i + 200))
    if (error) throw new Error(`Se insertaron ${i} de ${filas.length}: ${error.message}`)
  }
  console.log(`\nInsertadas ${filas.length}. Corte para borrar las viejas: created_at < '${corte}'`)
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
