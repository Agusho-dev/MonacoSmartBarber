// =============================================================================
// El borrador de Tex: los datos que se leen de la base (server-only, sin
// 'use server'). El prompt se arma en borrador-prompt.ts (puro).
//
// «Datos del negocio» sale de tres lugares:
//   - las sucursales activas (nombre y dirección);
//   - los servicios activos que se cobran solos (sin los «agregados» de upsell),
//     con el precio más común entre sucursales;
//   - los textos de las automatizaciones activas (send_message / send_buttons):
//     es lo que el dueño ya les escribe a todos, con los horarios y precios
//     reales. Medido el 6/nov/2026: la base dice Caseros 9 a 21 y el texto de
//     Bienvenida «Lun a Vie 10 a 19 | Sábados 10 a 17». Manda el texto.
// Se guarda 10 minutos por org en memoria: cambia muy de vez en cuando y cada
// tarjeta pide un borrador.
// =============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CasoParaPrompt, DatosDelNegocio, MensajeParaPrompt } from './borrador-prompt'
import { esCierreDeCharla, nombreDePila } from './por-responder'

const DURACION_MS = 10 * 60_000
const enMemoria = new Map<string, { hasta: number; datos: DatosDelNegocio }>()

// Sucursales de prueba: no se le ofrecen a un cliente.
const ES_DE_PRUEBA = /^(test|prueba|demo)\b/i

/** Saca las variables sin resolver de un texto de automatización («{{nombre}}» → «…»). */
function sinVariables(texto: string): string {
  return texto.replace(/\{\{\s*[^}]+\s*\}\}/g, '…').trim()
}

export async function leerDatosDelNegocio(supabase: SupabaseClient, orgId: string): Promise<DatosDelNegocio> {
  const guardado = enMemoria.get(orgId)
  if (guardado && guardado.hasta > Date.now()) return guardado.datos

  const [org, sucursales, flujos] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    supabase
      .from('branches')
      .select('id, name, address')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('automation_workflows')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true),
  ])
  if (sucursales.error) throw new Error(`[borrador] branches: ${sucursales.error.message}`)
  if (flujos.error) throw new Error(`[borrador] automation_workflows: ${flujos.error.message}`)

  const deVerdad = ((sucursales.data ?? []) as { id: string; name: string; address: string | null }[])
    .filter((b) => !ES_DE_PRUEBA.test(b.name.trim()))
  const idsSucursales = deVerdad.map((b) => b.id)
  const idsFlujos = ((flujos.data ?? []) as { id: string }[]).map((w) => w.id)

  const [servicios, nodos] = await Promise.all([
    idsSucursales.length > 0
      ? supabase
          .from('services')
          .select('name, price, availability')
          .in('branch_id', idsSucursales)
          .eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    idsFlujos.length > 0
      ? supabase
          .from('workflow_nodes')
          .select('node_type, config, created_at')
          .in('workflow_id', idsFlujos)
          .in('node_type', ['send_message', 'send_buttons'])
          .order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (servicios.error) throw new Error(`[borrador] services: ${servicios.error.message}`)
  if (nodos.error) throw new Error(`[borrador] workflow_nodes: ${nodos.error.message}`)

  // Un servicio por nombre (sin mayúsculas ni espacios de más), con el precio más repetido.
  const porNombre = new Map<string, { nombre: string; precios: Map<number, number> }>()
  for (const s of (servicios.data ?? []) as { name: string; price: number | string | null; availability: string | null }[]) {
    if (s.availability === 'upsell') continue
    const precio = Number(s.price)
    if (!Number.isFinite(precio) || precio <= 0) continue
    const nombre = s.name.replace(/\s+/g, ' ').trim()
    const clave = nombre.toLocaleLowerCase('es-AR').replace(/\by\b/g, '+').replace(/\s*\+\s*/g, '+')
    const fila = porNombre.get(clave) ?? { nombre, precios: new Map<number, number>() }
    fila.precios.set(precio, (fila.precios.get(precio) ?? 0) + 1)
    porNombre.set(clave, fila)
  }
  const listaServicios = Array.from(porNombre.values())
    .map((f) => {
      const [precio] = Array.from(f.precios.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
      return { nombre: f.nombre.charAt(0).toLocaleUpperCase('es-AR') + f.nombre.slice(1), precio }
    })
    .sort((a, b) => a.precio - b.precio)

  // Los textos oficiales, sin repetir y sin los muy cortos («¡Gracias!»), hasta ~3.000 caracteres.
  const vistos = new Set<string>()
  const textos: string[] = []
  let total = 0
  for (const n of (nodos.data ?? []) as { config: Record<string, unknown> | null }[]) {
    const c = n.config ?? {}
    const crudo = [c.message, c.text, c.body].find((v) => typeof v === 'string') as string | undefined
    if (!crudo) continue
    const texto = sinVariables(crudo)
    if (texto.length < 25) continue
    const clave = texto.toLocaleLowerCase('es-AR').replace(/\s+/g, ' ')
    if (vistos.has(clave)) continue
    vistos.add(clave)
    if (total + texto.length > 3000) break
    total += texto.length
    textos.push(texto)
  }

  const datos: DatosDelNegocio = {
    nombre: ((org.data as { name: string | null } | null)?.name ?? '').trim() || 'la barbería',
    sucursales: deVerdad.map((b) => ({ nombre: b.name.trim(), direccion: b.address?.trim() || null })),
    servicios: listaServicios,
    textosOficiales: textos,
  }
  enMemoria.set(orgId, { hasta: Date.now() + DURACION_MS, datos })
  return datos
}

/** La charla (los últimos 24 mensajes) y lo que hay que responder, de una conversación. */
export async function leerCasoParaBorrador(
  supabase: SupabaseClient,
  args: { orgId: string; conversationId: string },
): Promise<{ mensajes: MensajeParaPrompt[]; caso: CasoParaPrompt; esCierre: boolean }> {
  const [conv, mensajes, alertas] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, client_id, platform_user_name, channel:social_channels(platform), client:clients(name, loyalty:client_loyalty_state(total_visits))')
      .eq('id', args.conversationId)
      .maybeSingle(),
    supabase
      .from('messages')
      .select('direction, content_type, content, template_name, created_at, status')
      .eq('conversation_id', args.conversationId)
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('crm_alerts')
      .select('metadata, created_at')
      .eq('organization_id', args.orgId)
      .eq('conversation_id', args.conversationId)
      .eq('is_read', false)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .order('created_at', { ascending: true }),
  ])
  if (conv.error) throw new Error(`[borrador] conversations: ${conv.error.message}`)
  if (mensajes.error) throw new Error(`[borrador] messages: ${mensajes.error.message}`)
  if (alertas.error) throw new Error(`[borrador] crm_alerts: ${alertas.error.message}`)

  type FilaConv = {
    client_id: string | null
    platform_user_name: string | null
    channel: { platform: string | null } | null
    client: { name: string | null; loyalty: { total_visits: number | null } | { total_visits: number | null }[] | null } | null
  }
  const c = conv.data as unknown as FilaConv | null
  const lista = ((mensajes.data ?? []) as {
    direction: 'inbound' | 'outbound'
    content_type: string | null
    content: string | null
    template_name: string | null
    created_at: string
    status: string | null
  }[])
    .filter((m) => !(m.direction === 'outbound' && m.status === 'failed'))
    .reverse()
    .map((m): MensajeParaPrompt => ({ dir: m.direction, tipo: m.content_type, texto: m.content, plantilla: m.template_name, at: m.created_at }))

  // La nota: el primer botón numérico de una alerta sin leer, y el último número que tocó después.
  const notas = ((alertas.data ?? []) as { metadata: Record<string, unknown> | null; created_at: string }[])
    .map((a) => String(a.metadata?.button_pressed ?? ''))
    .filter((b) => /^[1-5]$/.test(b))
  const nota = notas.length > 0 ? Number(notas[0]) : null
  const ultimoNumero = [...lista].reverse().find((m) => m.dir === 'inbound' && m.tipo === 'interactive' && /^[1-5]$/.test((m.texto ?? '').trim()))
  const notaFinal = nota !== null && ultimoNumero ? Number((ultimoNumero.texto ?? '').trim()) : nota
  const pidioHumano = (alertas.data ?? []).length > notas.length

  // La última visita del cliente (la de la reseña, casi siempre: el pedido sale minutos después del corte).
  let visita: CasoParaPrompt['visita'] = null
  if (c?.client_id) {
    const { data: v } = await supabase
      .from('visits')
      .select('started_at, barber:staff!visits_barber_id_fkey(full_name), branch:branches(name), service:services(name)')
      .eq('client_id', c.client_id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fila = v as unknown as {
      started_at: string | null
      barber: { full_name: string | null } | null
      branch: { name: string | null } | null
      service: { name: string | null } | null
    } | null
    if (fila) {
      visita = {
        at: fila.started_at,
        barbero: fila.barber?.full_name?.trim() ?? null,
        sucursal: fila.branch?.name ?? null,
        servicio: fila.service?.name ?? null,
      }
    }
  }

  const loyalty = c?.client?.loyalty
  const visitasTotales = Array.isArray(loyalty) ? loyalty[0]?.total_visits ?? null : loyalty?.total_visits ?? null
  const nombre = c?.client?.name ?? c?.platform_user_name ?? null
  const ultimosDelCliente = [...lista].reverse()
  const ultimaSalida = ultimosDelCliente.findIndex((m) => m.dir === 'outbound')
  const esperan = (ultimaSalida === -1 ? ultimosDelCliente : ultimosDelCliente.slice(0, ultimaSalida))
    .filter((m) => m.dir === 'inbound' && m.tipo !== 'interactive')

  return {
    mensajes: lista,
    esCierre: nota === null && esperan.length > 0 && esperan.every((m) => esCierreDeCharla(m.texto)),
    caso: {
      tipo: nota !== null ? 'resena' : 'consulta',
      nombrePila: nombreDePila(nombre),
      plataforma: c?.channel?.platform === 'instagram' ? 'instagram' : 'whatsapp',
      nota,
      notaFinal,
      pidioHumano,
      visitasTotales,
      visita,
    },
  }
}
