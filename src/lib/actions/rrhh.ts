'use server'

/**
 * Recursos Humanos — candidatos a barbero que llegan por el CRM.
 *
 * Todo export de este archivo es un endpoint HTTP (Next.js server actions), así
 * que cada uno gatea por permiso Y por organización, y ningún id que llegue del
 * browser se usa sin validar. Las RPC de la migración 213 son SECURITY DEFINER
 * sin RLS de contención: `p_org` lo pone `getCurrentOrgId()`, nunca el cliente.
 *
 * ── Por qué el envío NO pasa por `broadcasts` ──
 * `scheduled_messages.client_id` y `broadcast_recipients.client_id` son NOT NULL,
 * así que difundir por ese camino obliga a fabricar un `clients` por candidato.
 * Ya se hizo una vez: la difusión del 27/07/2026 creó 134 fichas, de las que sólo
 * 19 tienen alguna visita, y 80 son estos mismos candidatos. Esas fichas suman al
 * total de /dashboard/clientes, entran en cualquier campaña "a todos" y serían
 * destinatarias de las reglas de fidelización. Acá el destinatario es la
 * CONVERSACIÓN, que es lo que la etiqueta ya nos da.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { currentUserCan } from './permissions-gate'
import { requireOrgAccessToEntity } from './guard'
import { isValidUUID } from '@/lib/validation'
import { sendToMeta, extractWhatsAppId, extractInstagramId } from '@/lib/meta-send'
import { revalidatePath } from 'next/cache'
import type {
  Candidato,
  MetricasRrhh,
  FiltrosCandidatos,
  MensajeCandidato,
  PlantillaRrhh,
  DifusionRrhh,
  DestinatarioDifusion,
  ResultadoLote,
  EstadoCandidato,
} from '@/lib/types/rrhh'

const META_API_VERSION = 'v22.0'

// ═══════════════════════════════════════════════════════════════════════════
// Gates
// ═══════════════════════════════════════════════════════════════════════════

type Gate = { orgId: string } | { error: string }

async function requireView(): Promise<Gate> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }
  if (!(await currentUserCan('rrhh.view'))) return { error: 'No tenés permiso para ver Recursos humanos.' }
  return { orgId }
}

async function requireManage(): Promise<Gate> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Sesión vencida. Recargá la página e iniciá sesión de nuevo.' }
  if (!(await currentUserCan('rrhh.manage'))) return { error: 'No tenés permiso para gestionar candidatos.' }
  return { orgId }
}

// ═══════════════════════════════════════════════════════════════════════════
// Etiquetas que definen quién es candidato
// ═══════════════════════════════════════════════════════════════════════════

export interface EtiquetaRrhh {
  id: string
  name: string
  color: string
  description: string | null
  ai_auto_assign: boolean
  es_candidato: boolean
  /** Cuántas conversaciones tiene hoy esa etiqueta. */
  conversaciones: number
}

export async function getEtiquetasRrhh(): Promise<{ data: EtiquetaRrhh[]; error: string | null }> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], error: gate.error }

  const supabase = createAdminClient()
  const { data: tags, error } = await supabase
    .from('conversation_tags')
    .select('id, name, color, description, ai_auto_assign, es_candidato')
    .eq('organization_id', gate.orgId)
    .order('es_candidato', { ascending: false })
    .order('name')

  if (error) return { data: [], error: error.message }

  // El conteo va por RPC y no trayendo las asignaciones: PostgREST corta en
  // 1.000 filas sin avisar (el `.limit()` sólo pone el header Range, el
  // `db-max-rows` del servidor manda igual). Contando en JS, esta pantalla —que
  // es donde el dueño ELIGE qué etiqueta alimenta la sección— decía "69
  // conversaciones" para una etiqueta que tiene 206, y el reparto entre
  // etiquetas dependía del plan de ejecución.
  const conteo = new Map<string, number>()
  const { data: conteos, error: errConteo } = await supabase.rpc('rrhh_conteo_etiquetas', { p_org: gate.orgId })
  if (errConteo) return { data: [], error: 'No pudimos contar las conversaciones por etiqueta: ' + errConteo.message }
  for (const c of (conteos ?? []) as Array<{ tag_id: string; conversaciones: number }>) {
    conteo.set(c.tag_id, Number(c.conversaciones))
  }

  return {
    data: (tags ?? []).map(t => ({ ...t, conversaciones: conteo.get(t.id) ?? 0 })) as EtiquetaRrhh[],
    error: null,
  }
}

export async function setEtiquetaEsCandidato(tagId: string, valor: boolean) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(tagId)) return { error: 'Etiqueta inválida' }

  const acceso = await requireOrgAccessToEntity('conversation_tags', tagId)
  if (!acceso.ok) return { error: 'Etiqueta no encontrada' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversation_tags')
    .update({ es_candidato: valor })
    .eq('id', tagId)
    .eq('organization_id', gate.orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/rrhh')
  return { success: true }
}

/** Los ids de etiqueta que alimentan la sección. Sin ninguna, la sección está vacía y lo dice. */
async function tagIdsDeCandidato(orgId: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('conversation_tags')
    .select('id')
    .eq('organization_id', orgId)
    .eq('es_candidato', true)
  return (data ?? []).map(t => t.id)
}

// ═══════════════════════════════════════════════════════════════════════════
// Listado y métricas
// ═══════════════════════════════════════════════════════════════════════════

export async function listarCandidatos(filtros: FiltrosCandidatos = {}): Promise<{
  data: Candidato[]
  total: number
  sinEtiqueta: boolean
  error: string | null
}> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], total: 0, sinEtiqueta: false, error: gate.error }

  const tags = await tagIdsDeCandidato(gate.orgId)
  if (tags.length === 0) return { data: [], total: 0, sinEtiqueta: true, error: null }

  const limit = Math.min(Math.max(filtros.limit ?? 60, 1), 200)
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('rrhh_listar_candidatos', {
    p_org: gate.orgId,
    p_tags: tags,
    p_estados: filtros.estados?.length ? filtros.estados : null,
    p_canal: filtros.canal ?? null,
    p_busqueda: filtros.busqueda?.trim() || null,
    p_solo_con_material: !!filtros.soloConMaterial,
    p_solo_alcanzables: !!filtros.soloAlcanzables,
    p_orden: filtros.orden ?? 'reciente',
    p_limit: limit,
    p_offset: Math.max(filtros.offset ?? 0, 0),
  })

  // Un error de lectura NO se degrada a lista vacía: "no hay candidatos" y "no
  // pudimos leer" se pintan distinto (patrón de /dashboard/clientes).
  if (error) return { data: [], total: 0, sinEtiqueta: false, error: error.message }

  const filas = (data ?? []) as Candidato[]
  // `total_rows` viaja dentro de las filas: una página fuera de rango no lo trae.
  const total = filas.length > 0 ? Number(filas[0].total_rows) : -1
  return { data: filas, total, sinEtiqueta: false, error: null }
}

export async function getMetricasRrhh(): Promise<{ data: MetricasRrhh | null; error: string | null }> {
  const gate = await requireView()
  if ('error' in gate) return { data: null, error: gate.error }

  const tags = await tagIdsDeCandidato(gate.orgId)
  if (tags.length === 0) return { data: null, error: null }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('rrhh_metricas', { p_org: gate.orgId, p_tags: tags })
  if (error) return { data: null, error: error.message }
  return { data: data as MetricasRrhh, error: null }
}

export async function getMensajesCandidato(conversationId: string): Promise<{
  data: MensajeCandidato[]
  error: string | null
}> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], error: gate.error }
  if (!isValidUUID(conversationId)) return { data: [], error: 'Conversación inválida' }

  const acceso = await requireOrgAccessToEntity('conversations', conversationId)
  if (!acceso.ok) return { data: [], error: 'Conversación no encontrada' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('rrhh_candidato_mensajes', {
    p_org: gate.orgId,
    p_conversation_id: conversationId,
  })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as MensajeCandidato[], error: null }
}

// ═══════════════════════════════════════════════════════════════════════════
// Triage
// ═══════════════════════════════════════════════════════════════════════════

export interface PatchCandidato {
  estado?: EstadoCandidato
  puntaje?: number | null
  notas?: string | null
  telefonoManual?: string | null
  nombreOverride?: string | null
  motivoDescarte?: string | null
}

/**
 * `undefined` = "no lo mandé, no lo toques"; `null` = "vaciá el campo".
 * Es la regla del Known Risk #21: `updateClientNotes` borraba el Instagram del
 * cliente porque el panel mandaba `''` en cada cobro.
 */
export async function guardarCandidato(conversationId: string, patch: PatchCandidato) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(conversationId)) return { error: 'Conversación inválida' }

  const acceso = await requireOrgAccessToEntity('conversations', conversationId)
  if (!acceso.ok) return { error: 'Conversación no encontrada' }

  const fila: Record<string, unknown> = {
    organization_id: gate.orgId,
    conversation_id: conversationId,
  }
  if (patch.estado !== undefined) fila.estado = patch.estado
  if (patch.puntaje !== undefined) fila.puntaje = patch.puntaje
  if (patch.notas !== undefined) fila.notas = patch.notas?.trim() || null
  if (patch.nombreOverride !== undefined) fila.nombre_override = patch.nombreOverride?.trim() || null
  if (patch.motivoDescarte !== undefined) fila.motivo_descarte = patch.motivoDescarte?.trim() || null

  if (patch.telefonoManual !== undefined) {
    const limpio = normalizarTelefonoAr(patch.telefonoManual ?? '')
    if (patch.telefonoManual && !limpio) {
      return { error: 'No pudimos entender ese teléfono. Escribilo con característica, por ejemplo 351 555 1234 o 0351 15 555 1234.' }
    }
    fila.telefono_manual = limpio
  }

  if (Object.keys(fila).length === 2) return { success: true } // nada que escribir

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('rrhh_candidatos')
    .upsert(fila, { onConflict: 'conversation_id' })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/rrhh')
  return { success: true }
}

/**
 * E.164 sin `+` para Meta, tolerando lo que la gente escribe.
 *
 * **Se rechaza todo lo que no se pueda interpretar sin ambigüedad.** La versión
 * anterior "limpiaba" el 15 mirando sólo la posición, y con el formato más común
 * de Córdoba —`0351 15 555 1234`— producía un número **de otra persona**: se
 * quedaba con los últimos 10 dígitos de una cadena a la que le había sacado el
 * 15 del medio y armaba un teléfono de Buenos Aires perfectamente válido. Mandar
 * una plantilla de marketing al número equivocado es peor que no mandar nada, así
 * que acá la duda se resuelve pidiéndole al usuario que lo escriba de nuevo.
 *
 * Lo que acepta, en todos los casos con o sin separadores:
 *   3515551234      → 543515551234   (10 dígitos: característica + abonado)
 *   03515551234     → 543515551234   (con 0)
 *   0351 15 5551234 → 543515551234   (con 0 y 15: el 0 confirma dónde termina la característica)
 *   +54 9 351 555-1234 / 5493515551234 → 543515551234
 *   543515551234    → 543515551234
 * Lo que rechaza (devuelve null, la UI pide reescribirlo):
 *   menos de 10 dígitos significativos
 *   un "15" sin 0 adelante, que no permite saber dónde corta la característica
 *   más de 13 dígitos
 */
function normalizarTelefonoAr(raw: string): string | null {
  const crudo = (raw ?? '').replace(/\D/g, '')
  if (!crudo) return null
  if (crudo.length > 13) return null

  let d = crudo

  // Prefijo internacional y el 9 de móvil argentino.
  if (d.startsWith('549') && d.length === 13) d = d.slice(3)
  else if (d.startsWith('54') && d.length === 12) d = d.slice(2)

  // Formato local con 0 adelante: el 0 marca el inicio de la característica, así
  // que un 15 después de ella es inequívoco y se puede sacar.
  if (d.startsWith('0')) {
    d = d.slice(1)
    const m = d.match(/^(\d{2,4})15(\d{6,8})$/)
    if (m && (m[1] + m[2]).length === 10) d = m[1] + m[2]
  }

  if (d.length !== 10) return null
  // Un 10 dígitos que empieza con 15 no es un teléfono: es un móvil sin
  // característica y no sabemos de qué ciudad.
  if (d.startsWith('15')) return null

  return '54' + d
}

// ═══════════════════════════════════════════════════════════════════════════
// Plantillas de WhatsApp
// ═══════════════════════════════════════════════════════════════════════════

interface ComponenteMeta {
  type?: string
  text?: string
  format?: string
}

function cuerpoDe(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const body = (components as ComponenteMeta[]).find(c => (c?.type ?? '').toUpperCase() === 'BODY')
  return body?.text ?? null
}

function variablesDe(texto: string | null): number {
  if (!texto) return 0
  const nums = new Set<string>()
  for (const m of texto.matchAll(/\{\{(\d+)\}\}/g)) nums.add(m[1])
  return nums.size
}

/**
 * Plantillas aprobadas de la org. El idioma sale de acá y viaja tal cual: mandar
 * `es_AR` a una plantilla registrada como `es` devuelve 132001 y el mensaje muere
 * sin reintento (Known Risk #4). Por eso NO hay ningún default de idioma en todo
 * este archivo.
 */
export async function getPlantillasRrhh(sincronizar = false): Promise<{
  data: PlantillaRrhh[]
  error: string | null
}> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], error: gate.error }

  if (sincronizar) {
    const { syncWhatsAppTemplates } = await import('./whatsapp-meta')
    await syncWhatsAppTemplates()
  }

  const supabase = createAdminClient()
  const { data: canales } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', gate.orgId)
    .eq('platform', 'whatsapp')

  const ids = (canales ?? []).map(c => c.id)
  if (ids.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('message_templates')
    .select('name, language, category, status, components')
    .in('channel_id', ids)
    .order('name')

  if (error) return { data: [], error: error.message }

  const plantillas = (data ?? []).map(t => {
    const cuerpo = cuerpoDe(t.components)
    return {
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      cuerpo,
      variables: variablesDe(cuerpo),
    } as PlantillaRrhh
  })

  return { data: plantillas, error: null }
}

/**
 * Crea la plantilla en Meta y la deja en revisión. La app ya sabe hacerlo
 * (`ensureDefaultTemplates` usa el mismo endpoint), así que no hay que entrar a
 * Business Manager. Meta suele aprobar una MARKETING en minutos.
 *
 * Sin variables a propósito: una variable de más o de menos en el envío es un
 * 132000 que tira TODO el mensaje, y una convocatoria no necesita personalizarse.
 */
export async function crearPlantillaRrhh(input: { nombre: string; cuerpo: string; footer?: string }) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }

  const nombre = (input.nombre ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
  const cuerpo = (input.cuerpo ?? '').trim()
  if (!nombre) return { error: 'Poné un nombre para la plantilla.' }
  if (cuerpo.length < 20) return { error: 'El mensaje es muy corto. Escribí al menos un par de líneas.' }
  if (cuerpo.length > 1024) return { error: 'El cuerpo no puede superar los 1024 caracteres.' }
  if (/\{\{\s*\d+\s*\}\}/.test(cuerpo)) {
    return { error: 'Sacá los {{1}}: esta plantilla se crea sin variables para que el envío no pueda fallar por un parámetro de más.' }
  }

  const supabase = createAdminClient()
  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_business_id')
    .eq('organization_id', gate.orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_business_id) {
    return { error: 'WhatsApp no está configurado. Cargá las credenciales en Mensajería → Configuración.' }
  }

  const { data: canal } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', gate.orgId)
    .eq('platform', 'whatsapp')
    .order('branch_id', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()

  const componentes: Array<Record<string, unknown>> = [{ type: 'BODY', text: cuerpo }]
  if (input.footer?.trim()) componentes.push({ type: 'FOOTER', text: input.footer.trim().slice(0, 60) })

  let res: Response
  try {
    res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_business_id}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nombre,
          // 'es' y no 'es_AR': es el idioma con el que están registradas las
          // plantillas vivas de esta WABA, y el que devuelve el sync.
          language: 'es',
          category: 'MARKETING',
          components: componentes,
        }),
        signal: AbortSignal.timeout(20000),
      }
    )
  } catch (e) {
    return { error: `No pudimos contactar a Meta: ${(e as Error).message}` }
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg: string = json?.error?.error_user_msg ?? json?.error?.message ?? 'Meta rechazó la plantilla'
    if (typeof msg === 'string' && msg.toLowerCase().includes('already exists')) {
      return { error: `Ya existe una plantilla llamada "${nombre}". Poné otro nombre o usá la que ya está.` }
    }
    return { error: msg }
  }

  if (canal?.id) {
    await supabase.from('message_templates').upsert(
      {
        channel_id: canal.id,
        name: nombre,
        language: 'es',
        category: 'marketing',
        // Meta las deja en revisión; el estado real llega con el próximo sync.
        status: (json?.status as string | undefined)?.toLowerCase() ?? 'pending',
        components: componentes,
      },
      { onConflict: 'channel_id, name' }
    )
  }

  revalidatePath('/dashboard/rrhh')
  return { success: true, nombre, estado: (json?.status as string | undefined) ?? 'PENDING' }
}


/**
 * Manda UNA plantilla de WhatsApp al teléfono de una conversación y la registra
 * en el hilo, salga o no salga.
 *
 * Existe para que el lote y el envío individual usen el MISMO camino. La
 * alternativa —`sendTemplateToConversation`— resuelve el destino por la
 * plataforma de la conversación y rechaza Instagram, así que un candidato de IG
 * con teléfono cargado a mano nunca podría recibir la plantilla. Además hace un
 * `revalidatePath` por mensaje, que en un lote de 8 son 8 revalidaciones.
 */
async function mandarPlantillaAConversacion(
  orgId: string,
  conversationId: string,
  templateName: string,
  templateLanguage: string,
  telefonoDirecto?: string | null,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
    return { error: 'WhatsApp no está configurado. Cargá las credenciales en Mensajería → Configuración.' }
  }

  let destino = telefonoDirecto ?? null
  if (!destino) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('platform_user_id, channel:social_channels(platform)')
      .eq('id', conversationId)
      .maybeSingle()
    const plataforma = (conv?.channel as { platform?: string } | null)?.platform
    if (plataforma === 'whatsapp') destino = conv?.platform_user_id ?? null
    if (!destino) {
      // Instagram sin teléfono cargado: no hay a dónde mandar la plantilla.
      const { data: cand } = await supabase
        .from('rrhh_candidatos')
        .select('telefono_manual')
        .eq('conversation_id', conversationId)
        .maybeSingle()
      destino = cand?.telefono_manual ?? null
    }
  }

  const telefono = normalizarTelefonoAr(destino ?? '')
  if (!telefono) return { error: 'No tenemos un teléfono válido para este candidato.' }

  const out = await sendToMeta({
    url: `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_phone_id}/messages`,
    token: waConfig.whatsapp_access_token,
    payload: {
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'template',
      template: { name: templateName, language: { code: templateLanguage } },
    },
    extractId: extractWhatsAppId,
  })

  const { error: errMsg } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    content_type: 'template',
    content: `[Template: ${templateName}]`,
    template_name: templateName,
    platform_message_id: out.platformMessageId,
    status: out.ok ? 'sent' : 'failed',
    error_message: out.ok ? null : out.errorMessage,
  })
  if (errMsg) console.error('[rrhh] plantilla enviada pero no registrada:', errMsg.message)

  return out.ok ? {} : { error: out.errorMessage ?? 'Error al enviar' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Difusión
// ═══════════════════════════════════════════════════════════════════════════

export async function getDifusionesRrhh(): Promise<{ data: DifusionRrhh[]; error: string | null }> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], error: gate.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('rrhh_difusiones')
    .select('*')
    .eq('organization_id', gate.orgId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as DifusionRrhh[], error: null }
}

export async function getDestinatariosDifusion(difusionId: string): Promise<{
  data: DestinatarioDifusion[]
  error: string | null
}> {
  const gate = await requireView()
  if ('error' in gate) return { data: [], error: gate.error }
  if (!isValidUUID(difusionId)) return { data: [], error: 'Difusión inválida' }

  const supabase = createAdminClient()
  const { data: dif } = await supabase
    .from('rrhh_difusiones')
    .select('id')
    .eq('id', difusionId)
    .eq('organization_id', gate.orgId)
    .maybeSingle()
  if (!dif) return { data: [], error: 'Difusión no encontrada' }

  const { data, error } = await supabase
    .from('rrhh_difusion_destinatarios')
    .select('id, conversation_id, canal, nombre, destino, estado, motivo, sent_at')
    .eq('difusion_id', difusionId)
    .order('estado')
    .order('nombre')
    .limit(1000)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as DestinatarioDifusion[], error: null }
}

type DestinatarioPlan = {
  conversation_id: string
  canal: 'whatsapp' | 'instagram'
  nombre: string
  destino: string | null
  estado: 'pendiente' | 'omitido'
  motivo: string | null
}

/**
 * Decide, candidato por candidato, si entra en la difusión y por dónde.
 *
 * Es PURA y la comparten la vista previa y el envío real: es lo que garantiza
 * que el número que ve el dueño sea el que va a salir. Calcular la previa en el
 * browser sobre la página cargada mostraría 48 y mandaría 206.
 * (Mismo criterio que `planificarFacturacion()` en el módulo de ARCA.)
 */
function planificarDestinatarios(
  candidatos: Candidato[],
  opciones: { mandaInstagram: boolean; omitirYaContactados: boolean },
): DestinatarioPlan[] {
  const plan: DestinatarioPlan[] = []
  for (const c of candidatos) {
    const base = { conversation_id: c.conversation_id, nombre: c.nombre }
    // Nunca al propio equipo: el etiquetado automático los marca de vez en
    // cuando y mandarle una convocatoria a un barbero que ya trabaja ahí es
    // peor que no mandar nada.
    if (c.es_staff) {
      plan.push({ ...base, canal: c.canal, destino: c.telefono, estado: 'omitido', motivo: 'Son de tu equipo' })
    } else if (c.estado === 'descartado') {
      plan.push({ ...base, canal: c.canal, destino: c.telefono, estado: 'omitido', motivo: 'Descartados' })
    } else if (c.estado === 'contratado') {
      plan.push({ ...base, canal: c.canal, destino: c.telefono, estado: 'omitido', motivo: 'Ya contratados' })
    } else if (opciones.omitirYaContactados && c.contactado_at) {
      plan.push({ ...base, canal: c.canal, destino: c.telefono, estado: 'omitido', motivo: 'Ya los contactamos antes' })
    } else if (c.alcance === 'whatsapp') {
      plan.push({ ...base, canal: 'whatsapp', destino: c.telefono, estado: 'pendiente', motivo: null })
    } else if (c.alcance === 'instagram' && opciones.mandaInstagram) {
      plan.push({ ...base, canal: 'instagram', destino: c.handle ?? c.platform_user_id, estado: 'pendiente', motivo: null })
    } else {
      plan.push({
        ...base,
        canal: c.canal,
        destino: c.handle ?? c.telefono,
        estado: 'omitido',
        motivo: c.canal === 'instagram'
          ? (opciones.mandaInstagram ? 'Instagram sin ventana abierta' : 'Instagram: no incluiste mensaje de IG')
          : 'Sin teléfono',
      })
    }
  }
  return plan
}

/** Los candidatos que entran en la difusión, resueltos SIEMPRE en el servidor. */
async function universoParaDifusion(
  orgId: string,
  conversationIds: string[] | undefined,
): Promise<{ data: Candidato[] } | { error: string }> {
  const tags = await tagIdsDeCandidato(orgId)
  if (tags.length === 0) return { error: 'No hay ninguna etiqueta marcada como "candidatos".' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('rrhh_listar_candidatos', {
    p_org: orgId, p_tags: tags, p_estados: null, p_canal: null, p_busqueda: null,
    p_solo_con_material: false, p_solo_alcanzables: false, p_orden: 'reciente',
    p_limit: 100000, p_offset: 0,
  })
  if (error) return { error: 'No pudimos leer la lista de candidatos: ' + error.message }

  const universo = (data ?? []) as Candidato[]
  const elegidos = new Set((conversationIds ?? []).filter(isValidUUID))
  return { data: elegidos.size > 0 ? universo.filter(c => elegidos.has(c.conversation_id)) : universo }
}

export interface PreviaDifusion {
  whatsapp: number
  instagram: number
  /** Motivo → cuántos. Se muestra tal cual, para que nadie desaparezca en silencio. */
  omitidos: Record<string, number>
  total: number
  error?: string
}

/**
 * La audiencia exacta que va a recibir la difusión. Se resuelve en el servidor
 * sobre TODOS los candidatos, no sobre la página que el browser tenga cargada.
 */
export async function previsualizarDifusion(opciones: {
  conversationIds?: string[]
  mandaInstagram?: boolean
  omitirYaContactados?: boolean
}): Promise<PreviaDifusion> {
  const vacio: PreviaDifusion = { whatsapp: 0, instagram: 0, omitidos: {}, total: 0 }
  const gate = await requireView()
  if ('error' in gate) return { ...vacio, error: gate.error }

  const universo = await universoParaDifusion(gate.orgId, opciones.conversationIds)
  if ('error' in universo) return { ...vacio, error: universo.error }

  const plan = planificarDestinatarios(universo.data, {
    mandaInstagram: !!opciones.mandaInstagram,
    omitirYaContactados: !!opciones.omitirYaContactados,
  })

  const omitidos: Record<string, number> = {}
  let whatsapp = 0, instagram = 0
  for (const d of plan) {
    if (d.estado === 'pendiente') {
      if (d.canal === 'whatsapp') whatsapp++; else instagram++
    } else if (d.motivo) {
      omitidos[d.motivo] = (omitidos[d.motivo] ?? 0) + 1
    }
  }
  return { whatsapp, instagram, omitidos, total: plan.length }
}

export interface NuevaDifusion {
  nombre: string
  templateName: string
  /** Sólo por Instagram y sólo a quien tenga la ventana abierta. Vacío = no se intenta. */
  textoInstagram?: string
  /** Conversaciones elegidas. Vacío = todos los alcanzables de la etiqueta. */
  conversationIds?: string[]
  /** Excluir a los que ya fueron contactados por una difusión anterior. */
  omitirYaContactados?: boolean
}

export async function crearDifusionRrhh(input: NuevaDifusion): Promise<{
  id?: string
  resumen?: { whatsapp: number; instagram: number; omitidos: number }
  error?: string
}> {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }

  const nombre = (input.nombre ?? '').trim()
  if (!nombre) return { error: 'Poné un nombre para identificar la difusión.' }
  if (!input.templateName) return { error: 'Elegí la plantilla de WhatsApp.' }

  const supabase = createAdminClient()

  // 1) La plantilla tiene que existir, estar aprobada y traer su idioma real.
  const { data: plantillas } = await getPlantillasRrhh(false)
  const tpl = plantillas.find(p => p.name === input.templateName)
  if (!tpl) return { error: 'No encontramos esa plantilla. Actualizá la lista e intentá de nuevo.' }
  if (tpl.status !== 'approved') {
    return { error: `La plantilla "${tpl.name}" está en estado "${tpl.status}". Meta sólo deja enviar las aprobadas.` }
  }
  if (tpl.variables > 0) {
    return {
      error: `"${tpl.name}" declara ${tpl.variables} variable(s). Esta pantalla sólo manda plantillas sin variables: una de más o de menos hace que Meta rechace el mensaje entero (132000).`,
    }
  }

  // 2) Audiencia: siempre la que resuelve el servidor sobre TODOS los
  //    candidatos, nunca lo que mande el browser. La misma función que arma la
  //    vista previa arma la lista real: el número prometido es el enviado.
  const universo = await universoParaDifusion(gate.orgId, input.conversationIds)
  if ('error' in universo) return { error: universo.error }

  const destinatarios = planificarDestinatarios(universo.data, {
    mandaInstagram: !!input.textoInstagram?.trim(),
    omitirYaContactados: !!input.omitirYaContactados,
  })

  const pendientes = destinatarios.filter(d => d.estado === 'pendiente')
  if (pendientes.length === 0) {
    return { error: 'Ningún candidato de la selección se puede contactar. Revisá los filtros o cargá teléfonos.' }
  }

  // 3) La difusión nace en 'borrador': crear no envía. El envío es un paso
  //    aparte y explícito (el wizard de difusiones viejo dice "Crear y enviar" y
  //    NO envía; acá el botón dice lo que hace).
  const { data: dif, error: errDif } = await supabase
    .from('rrhh_difusiones')
    .insert({
      organization_id: gate.orgId,
      nombre,
      template_name: tpl.name,
      template_language: tpl.language,
      texto_instagram: input.textoInstagram?.trim() || null,
      estado: 'borrador',
      total: destinatarios.length,
      omitidos: destinatarios.length - pendientes.length,
    })
    .select('id')
    .single()

  if (errDif || !dif) return { error: 'No pudimos crear la difusión: ' + (errDif?.message ?? '') }

  const CHUNK = 400
  for (let i = 0; i < destinatarios.length; i += CHUNK) {
    const lote = destinatarios.slice(i, i + CHUNK).map(d => ({ ...d, difusion_id: dif.id }))
    const { error } = await supabase.from('rrhh_difusion_destinatarios').insert(lote)
    if (error) {
      await supabase.from('rrhh_difusiones').delete().eq('id', dif.id)
      return { error: 'No pudimos armar la lista de destinatarios: ' + error.message }
    }
  }

  revalidatePath('/dashboard/rrhh')
  return {
    id: dif.id,
    resumen: {
      whatsapp: pendientes.filter(d => d.canal === 'whatsapp').length,
      instagram: pendientes.filter(d => d.canal === 'instagram').length,
      omitidos: destinatarios.length - pendientes.length,
    },
  }
}

/**
 * Manda UN lote y devuelve el progreso. El browser lo llama en bucle hasta que
 * `terminado`, así que cada request es corta (no hay riesgo de timeout con 200
 * destinatarios) y la barra de progreso es real, no una animación.
 *
 * El claim es atómico (`rrhh_claim_destinatarios`, FOR UPDATE SKIP LOCKED): dos
 * pestañas abiertas no mandan el mismo mensaje dos veces.
 */
export async function enviarLoteDifusion(difusionId: string, limite = 8): Promise<ResultadoLote & { error?: string }> {
  const vacio: ResultadoLote = { enviados: 0, fallidos: 0, pendientes: 0, omitidos: 0, total: 0, terminado: true, errores: [] }

  const gate = await requireManage()
  if ('error' in gate) return { ...vacio, error: gate.error }
  if (!isValidUUID(difusionId)) return { ...vacio, error: 'Difusión inválida' }

  const supabase = createAdminClient()
  const { data: dif } = await supabase
    .from('rrhh_difusiones')
    .select('id, template_name, template_language, texto_instagram, estado')
    .eq('id', difusionId)
    .eq('organization_id', gate.orgId)
    .maybeSingle()

  if (!dif) return { ...vacio, error: 'Difusión no encontrada' }
  if (dif.estado === 'cancelada') return { ...vacio, error: 'La difusión está cancelada' }

  // Credenciales UNA vez por lote, no una por mensaje.
  const [{ data: waConfig }, { data: igConfig }] = await Promise.all([
    supabase.from('organization_whatsapp_config')
      .select('whatsapp_access_token, whatsapp_phone_id')
      .eq('organization_id', gate.orgId).maybeSingle(),
    supabase.from('organization_instagram_config')
      .select('instagram_page_access_token')
      .eq('organization_id', gate.orgId).maybeSingle(),
  ])

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
    return { ...vacio, error: 'WhatsApp no está configurado. Cargá las credenciales en Mensajería → Configuración.' }
  }

  const { data: claimed, error: errClaim } = await supabase.rpc('rrhh_claim_destinatarios', {
    p_org: gate.orgId,
    p_difusion: difusionId,
    p_limite: Math.min(Math.max(limite, 1), 15),
  })
  if (errClaim) return { ...vacio, error: 'No pudimos tomar el lote: ' + errClaim.message }

  const lote = (claimed ?? []) as Array<{
    id: string; conversation_id: string; canal: 'whatsapp' | 'instagram'; nombre: string | null; destino: string | null
  }>

  const errores: Array<{ nombre: string; motivo: string }> = []

  for (const d of lote) {
    let ok = false
    let motivo: string | null = null
    let platformId: string | null = null

    if (d.canal === 'whatsapp') {
      const telefono = normalizarTelefonoAr(d.destino ?? '')
      if (!telefono) {
        motivo = 'Teléfono inválido'
      } else {
        const out = await sendToMeta({
          url: `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_phone_id}/messages`,
          token: waConfig.whatsapp_access_token,
          payload: {
            messaging_product: 'whatsapp',
            to: telefono,
            type: 'template',
            template: { name: dif.template_name, language: { code: dif.template_language } },
          },
          extractId: extractWhatsAppId,
        })
        ok = out.ok
        motivo = out.errorMessage
        platformId = out.platformMessageId
      }

      // El envío queda en el hilo del inbox, salga o no salga: un fallo que no se
      // ve es un fallo que nadie arregla.
      const { error: errMsg } = await supabase.from('messages').insert({
        conversation_id: d.conversation_id,
        direction: 'outbound',
        content_type: 'template',
        content: `[Template: ${dif.template_name}]`,
        template_name: dif.template_name,
        platform_message_id: platformId,
        status: ok ? 'sent' : 'failed',
        error_message: ok ? null : motivo,
      })
      if (errMsg) console.error('[rrhh] mensaje enviado pero no registrado:', errMsg.message)
    } else {
      const texto = dif.texto_instagram?.trim()
      if (!texto) {
        motivo = 'La difusión no tiene mensaje de Instagram'
      } else if (!igConfig?.instagram_page_access_token) {
        motivo = 'Instagram no está configurado'
      } else {
        // El destinatario de IG es el IGSID, que está en la conversación.
        const { data: conv } = await supabase
          .from('conversations')
          .select('platform_user_id, can_reply_until')
          .eq('id', d.conversation_id)
          .maybeSingle()

        if (!conv) {
          motivo = 'Conversación no encontrada'
        } else if (!conv.can_reply_until || new Date(conv.can_reply_until) <= new Date()) {
          // Se revalida acá y no sólo al armar la lista: entre crear la difusión
          // y mandarla la ventana pudo cerrarse.
          motivo = 'Se cerró la ventana de 24 h de Instagram'
        } else {
          const out = await sendToMeta({
            url: `https://graph.instagram.com/${META_API_VERSION}/me/messages`,
            token: igConfig.instagram_page_access_token,
            payload: { recipient: { id: conv.platform_user_id }, message: { text: texto } },
            extractId: extractInstagramId,
          })
          ok = out.ok
          motivo = out.errorMessage
          platformId = out.platformMessageId

          const { error: errIg } = await supabase.from('messages').insert({
            conversation_id: d.conversation_id,
            direction: 'outbound',
            content_type: 'text',
            content: texto,
            platform_message_id: platformId,
            status: ok ? 'sent' : 'failed',
            error_message: ok ? null : motivo,
          })
          if (errIg) console.error('[rrhh] DM enviado pero no registrado:', errIg.message)
        }
      }
    }

    // Si este UPDATE falla, el mensaje YA salió y la fila queda en 'enviando'.
    // El claim la rescata a los 5 minutos (mig 214), pero hay que avisarlo: es
    // el único caso en que alguien podría recibir el mensaje dos veces.
    const { error: errEstado } = await supabase
      .from('rrhh_difusion_destinatarios')
      .update({
        estado: ok ? 'enviado' : 'fallido',
        motivo: ok ? null : (motivo ?? 'Error desconocido'),
        sent_at: ok ? new Date().toISOString() : null,
      })
      .eq('id', d.id)

    if (errEstado) {
      console.error('[rrhh] no se pudo marcar el destinatario:', errEstado.message)
      errores.push({
        nombre: d.nombre ?? 'Sin nombre',
        motivo: 'El mensaje salió pero no se pudo registrar. Se reintenta en 5 minutos.',
      })
    }

    if (ok) {
      // El contacto mueve el pipeline: quien estaba "sin revisar" pasa a
      // "contactado" y queda la fecha. Sólo avanza desde 'nuevo': si alguien ya
      // lo puso en entrevista, la difusión no lo retrocede.
      await supabase.rpc('rrhh_marcar_contactado', {
        p_org: gate.orgId,
        p_conversation_id: d.conversation_id,
      })
    } else {
      errores.push({ nombre: d.nombre ?? 'Sin nombre', motivo: motivo ?? 'Error desconocido' })
    }

    // Un respiro entre mensajes: Meta tiene rate-limit por número y no vale la
    // pena descubrirlo con 120 envíos seguidos.
    await new Promise(r => setTimeout(r, 220))
  }

  // Los contadores se RECALCULAN desde los destinatarios, no se incrementan
  // (Known Risk #13: un contador denormalizado que nadie verifica miente).
  const { data: estado, error: errRecalc } = await supabase.rpc('rrhh_recalcular_difusion', {
    p_org: gate.orgId,
    p_difusion: difusionId,
  })

  revalidatePath('/dashboard/rrhh')

  // Si el recálculo falla, `data` es null. Derivar `terminado` de un objeto
  // vacío daba `(undefined ?? 0) === 0` = TRUE: la pantalla decía "Difusión
  // terminada" con 100 destinatarios sin mandar. Es literalmente el Known
  // Risk #5, así que el error se propaga en vez de asumir el caso feliz.
  if (errRecalc || !estado) {
    return {
      ...vacio,
      terminado: false,
      errores,
      error: 'No pudimos leer el avance de la difusión. Volvé a abrirla para seguir.',
    }
  }

  const st = estado as {
    total?: number; enviados?: number; fallidos?: number
    omitidos?: number; pendientes?: number; en_vuelo?: number
  }

  return {
    enviados: st.enviados ?? 0,
    fallidos: st.fallidos ?? 0,
    pendientes: st.pendientes ?? 0,
    omitidos: st.omitidos ?? 0,
    total: st.total ?? 0,
    // `pendientes` incluye los que están en vuelo: sólo está terminado cuando el
    // servidor dice explícitamente que no queda ninguno.
    terminado: st.pendientes === 0,
    errores,
  }
}

export async function reintentarFallidos(difusionId: string) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(difusionId)) return { error: 'Difusión inválida' }

  const supabase = createAdminClient()
  const { data: dif } = await supabase
    .from('rrhh_difusiones').select('id').eq('id', difusionId).eq('organization_id', gate.orgId).maybeSingle()
  if (!dif) return { error: 'Difusión no encontrada' }

  const { error } = await supabase
    .from('rrhh_difusion_destinatarios')
    .update({ estado: 'pendiente', motivo: null, claimed_at: null })
    .eq('difusion_id', difusionId)
    .eq('estado', 'fallido')

  if (error) return { error: error.message }
  await supabase.rpc('rrhh_recalcular_difusion', { p_org: gate.orgId, p_difusion: difusionId })
  revalidatePath('/dashboard/rrhh')
  return { success: true }
}

export async function cancelarDifusionRrhh(difusionId: string) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(difusionId)) return { error: 'Difusión inválida' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('rrhh_difusiones')
    .update({ estado: 'cancelada' })
    .eq('id', difusionId)
    .eq('organization_id', gate.orgId)
    .in('estado', ['borrador', 'enviando'])

  if (error) return { error: error.message }

  await supabase
    .from('rrhh_difusion_destinatarios')
    .update({ estado: 'omitido', motivo: 'Difusión cancelada' })
    .eq('difusion_id', difusionId)
    .in('estado', ['pendiente', 'enviando'])

  revalidatePath('/dashboard/rrhh')
  return { success: true }
}

/** Mensaje suelto a UN candidato, por el canal que corresponda. */
export async function contactarCandidato(conversationId: string, opciones: {
  templateName?: string
  texto?: string
}) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(conversationId)) return { error: 'Conversación inválida' }

  const acceso = await requireOrgAccessToEntity('conversations', conversationId)
  if (!acceso.ok) return { error: 'Conversación no encontrada' }

  if (opciones.templateName) {
    const { data: plantillas } = await getPlantillasRrhh(false)
    const tpl = plantillas.find(p => p.name === opciones.templateName)
    if (!tpl) return { error: 'Plantilla no encontrada' }
    if (tpl.status !== 'approved') return { error: `La plantilla está en estado "${tpl.status}".` }
    if (tpl.variables > 0) return { error: `"${tpl.name}" tiene ${tpl.variables} variable(s) y esta pantalla manda sólo plantillas sin variables.` }

    // Ojo: `sendTemplateToConversation` resuelve el destino por la PLATAFORMA de
    // la conversación y rechaza Instagram ("Templates solo disponibles para
    // WhatsApp"). Un candidato de IG al que le cargamos el teléfono a mano tiene
    // que salir por WhatsApp igual que en la difusión, así que se manda con el
    // mismo primitivo que el lote.
    const enviado = await mandarPlantillaAConversacion(gate.orgId, conversationId, tpl.name, tpl.language)
    if (enviado.error) return { error: enviado.error }
  } else if (opciones.texto?.trim()) {
    const { sendMessage } = await import('./messaging')
    const res = await sendMessage(conversationId, opciones.texto.trim())
    if (res?.error) return { error: res.error }
  } else {
    return { error: 'No hay nada para mandar.' }
  }

  const supabase = createAdminClient()
  await supabase.rpc('rrhh_marcar_contactado', { p_org: gate.orgId, p_conversation_id: conversationId })
  revalidatePath('/dashboard/rrhh')
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Las fotos de Instagram
// ═══════════════════════════════════════════════════════════════════════════
//
// Las que ya vencieron NO se pueden recuperar, y conviene dejarlo escrito para
// que nadie vuelva a intentarlo:
//
// El webhook de Instagram guardaba la `payload.url` cruda que manda Meta, que
// apunta a `lookaside.fbsbx.com` con una firma que caduca a los ~3 días (medido:
// un adjunto de hoy responde 200, uno de abril responde 404 "Resource has
// expired"). WhatsApp nunca tuvo el problema porque baja el binario al bucket
// `chat-media` desde el día uno.
//
// La salida obvia sería pedirle a Meta el mensaje de nuevo por su
// `platform_message_id` y quedarse con la firma nueva. NO FUNCIONA con esta
// integración: el campo `attachments` **nunca** viene. Probado el 8/sep/2026
// contra producción, con el token vivo y el scope `instagram_manage_messages`
// presente:
//
//   GET graph.instagram.com/v22.0/{message_id}?fields=attachments      → 200, sin el campo
//   ...?fields=id,created_time,from,message,attachments                → 200, devuelve message/from/created_time y OMITE attachments
//   ...?fields=attachments{image_data,video_data,file_url,mime_type}   → 200, sin el campo
//   GET /me/conversations?user_id=…&fields=messages{id,attachments}    → 200, sólo ids
//   graph.facebook.com con el token de WhatsApp (EAA)                  → 500 / 190
//
// Y no es un problema de retención: falla igual con un mensaje de hace 4 horas
// cuya URL original sigue devolviendo 200. La API de Instagram Login
// (graph.instagram.com + token IGAA) simplemente no expone el adjunto. La
// Messenger Platform sobre una Página de Facebook sí lo haría, pero esta cuenta
// está conectada por Instagram Login, no por Página.
//
// Lo que SÍ se hizo: `src/app/api/webhooks/instagram/route.ts` ahora baja el
// archivo y lo guarda en `chat-media` como el de WhatsApp. De acá en adelante no
// se pierde nada. Los 186 archivos anteriores se dan por perdidos y la pantalla
// lo dice con palabras en vez de dibujar imágenes rotas.

// ═══════════════════════════════════════════════════════════════════════════
// Contratar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vincula al candidato con la fila de `staff` que se creó y lo marca contratado.
 * NO crea el staff: el alta son cuatro llamadas encadenadas con decisiones que
 * RRHH no tiene (sucursal, PIN, rol, esquema de comisión). Desde acá se abre
 * /dashboard/barberos con los datos prellenados y se vuelve con el id.
 */
export async function marcarContratado(conversationId: string, staffId: string) {
  const gate = await requireManage()
  if ('error' in gate) return { error: gate.error }
  if (!isValidUUID(conversationId) || !isValidUUID(staffId)) return { error: 'Datos inválidos' }

  const [conv, st] = await Promise.all([
    requireOrgAccessToEntity('conversations', conversationId),
    requireOrgAccessToEntity('staff', staffId),
  ])
  if (!conv.ok) return { error: 'Conversación no encontrada' }
  if (!st.ok) return { error: 'El barbero no pertenece a esta organización' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('rrhh_candidatos')
    .upsert(
      {
        organization_id: gate.orgId,
        conversation_id: conversationId,
        estado: 'contratado' as EstadoCandidato,
        staff_id: staffId,
      },
      { onConflict: 'conversation_id' }
    )

  if (error) return { error: error.message }
  revalidatePath('/dashboard/rrhh')
  return { success: true }
}
