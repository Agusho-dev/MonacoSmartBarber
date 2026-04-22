'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { revalidatePath } from 'next/cache'

const META_API_VERSION = 'v22.0'

export async function getOrgWhatsAppConfig() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('organization_whatsapp_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

/**
 * Guarda la config de WhatsApp de la org y sincroniza el canal social_channels
 * a nivel org (no por sucursal). Un solo canal WA sirve para todas las sucursales
 * de la organización.
 */
export async function saveOrgWhatsAppConfig(config: {
  whatsapp_access_token: string
  whatsapp_phone_id: string
  whatsapp_business_id: string
  app_secret?: string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // 1) Upsert de credenciales
  const { error } = await supabase
    .from('organization_whatsapp_config')
    .upsert(
      {
        organization_id: orgId,
        whatsapp_access_token: config.whatsapp_access_token,
        whatsapp_phone_id: config.whatsapp_phone_id,
        whatsapp_business_id: config.whatsapp_business_id,
        app_secret: config.app_secret || null,
        is_active: true,
      },
      { onConflict: 'organization_id' }
    )

  if (error) return { error: error.message }

  // 2) Canal org-default de WhatsApp (branch_id = NULL) — sirve para todas las sucursales
  const { data: existingChannel } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .maybeSingle()

  if (existingChannel) {
    await supabase
      .from('social_channels')
      .update({
        platform_account_id: config.whatsapp_phone_id,
        display_name: 'WhatsApp Business',
        is_active: true,
      })
      .eq('id', existingChannel.id)
  } else {
    await supabase.from('social_channels').insert({
      organization_id: orgId,
      branch_id: null,
      platform: 'whatsapp',
      platform_account_id: config.whatsapp_phone_id,
      display_name: 'WhatsApp Business',
      is_active: true,
    })
  }

  // 3) Auto-semilla de templates default (idempotente: skippea si ya existen)
  //    Lo hacemos best-effort; si falla, logueamos pero no bloqueamos el guardado.
  try {
    await seedDefaultTemplates()
  } catch (e) {
    console.error('[WhatsApp Meta] seedDefaultTemplates falló:', e)
  }

  // 4) Sync inicial desde Meta para traer lo que ya tenga el user
  try {
    await syncWhatsAppTemplates()
  } catch (e) {
    console.error('[WhatsApp Meta] syncWhatsAppTemplates inicial falló:', e)
  }

  const { data: saved } = await supabase
    .from('organization_whatsapp_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  revalidatePath('/dashboard/mensajeria')
  revalidatePath('/dashboard/turnos/configuracion')
  return { success: true, data: saved }
}

/**
 * Resuelve el canal de WA default de una org (branch_id IS NULL).
 */
async function getOrgWhatsAppChannel(orgId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('social_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'whatsapp')
    .is('branch_id', null)
    .eq('is_active', true)
    .maybeSingle()
  return data
}

// Envía un mensaje de texto vía Meta Cloud API e inserta el registro en DB
export async function sendMetaWhatsAppMessage(
  to: string,
  content: string,
  conversationId: string,
  staffId?: string
): Promise<{ success?: boolean; error?: string }> {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const orgId = orgAccess.orgId

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
    return { error: 'WhatsApp no configurado. Completá las credenciales en Configuración.' }
  }

  const phone = normalizeArgPhone(to)

  let res: Response
  try {
    res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_phone_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: content },
        }),
      }
    )
  } catch {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'text',
      content,
      status: 'failed',
      error_message: 'Error de red al contactar Meta API',
      sent_by_staff_id: staffId ?? null,
    })
    return { error: 'Error de red al contactar Meta API' }
  }

  const result = await res.json()

  if (!res.ok) {
    const errMsg: string = result.error?.message ?? 'Error al enviar mensaje'
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'text',
      content,
      status: 'failed',
      error_message: errMsg,
      sent_by_staff_id: staffId ?? null,
    })
    return { error: errMsg }
  }

  const platformMsgId: string | undefined = result.messages?.[0]?.id

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    content_type: 'text',
    content,
    platform_message_id: platformMsgId ?? null,
    status: 'sent',
    sent_by_staff_id: staffId ?? null,
  })

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

// Normaliza un teléfono argentino al formato E.164 sin + (para Meta Cloud API)
function normalizeArgPhone(raw: string): string {
  let phone = raw.replace(/\D/g, '')
  if (!phone.startsWith('54')) {
    if (phone.startsWith('9') && phone.length === 11) {
      phone = '54' + phone.slice(1)
    } else {
      phone = '54' + phone
    }
  } else if (phone.startsWith('549') && phone.length === 13) {
    phone = '54' + phone.slice(3)
  }
  return phone
}

// Envía un mensaje de template vía Meta Cloud API
export async function sendMetaWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  conversationId: string,
  components?: Record<string, unknown>[],
  staffId?: string
): Promise<{ success?: boolean; error?: string }> {
  const orgAccess = await requireOrgAccessToEntity('conversations', conversationId)
  if (!orgAccess.ok) return { error: 'Acceso denegado' }

  const orgId = orgAccess.orgId

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
    return { error: 'WhatsApp no configurado. Completá las credenciales en Configuración.' }
  }

  const phone = normalizeArgPhone(to)

  const templatePayload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components && components.length > 0 ? { components } : {}),
    },
  }

  let res: Response
  try {
    res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_phone_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(templatePayload),
      }
    )
  } catch {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'template',
      content: `[Template: ${templateName}]`,
      template_name: templateName,
      status: 'failed',
      error_message: 'Error de red al contactar Meta API',
      sent_by_staff_id: staffId ?? null,
    })
    return { error: 'Error de red al contactar Meta API' }
  }

  const result = await res.json()

  if (!res.ok) {
    const errMsg: string = result.error?.message ?? 'Error al enviar template'
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'template',
      content: `[Template: ${templateName}]`,
      template_name: templateName,
      status: 'failed',
      error_message: errMsg,
      sent_by_staff_id: staffId ?? null,
    })
    return { error: errMsg }
  }

  const platformMsgId: string | undefined = result.messages?.[0]?.id

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    content_type: 'template',
    content: `[Template: ${templateName}]`,
    template_name: templateName,
    platform_message_id: platformMsgId ?? null,
    status: 'sent',
    sent_by_staff_id: staffId ?? null,
  })

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      can_reply_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', conversationId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

/**
 * Sincroniza templates (todos, no sólo approved) desde Meta con paginación cursor-based.
 * Up/dates por (channel_id, name).
 */
export async function syncWhatsAppTemplates(): Promise<{
  data?: Array<{ name: string; language: string; category: string; status: string; components: unknown }>
  error?: string
  count?: number
}> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_business_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_business_id) {
    return { error: 'WhatsApp no configurado' }
  }

  const channel = await getOrgWhatsAppChannel(orgId)
  if (!channel) return { error: 'Canal WhatsApp no encontrado. Guardá la configuración primero.' }

  const MAX_PAGES = 10 // hard cap por seguridad
  const PAGE_SIZE = 100
  let next: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_business_id}/message_templates?limit=${PAGE_SIZE}`

  const allTemplates: Array<{ name: string; language: string; category: string; status: string; components: unknown }> = []

  for (let page = 0; page < MAX_PAGES && next; page++) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${waConfig.whatsapp_access_token}` },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { error: err.error?.message ?? 'Error al obtener templates de Meta' }
    }

    const json = await res.json()
    const pageData = json?.data
    if (!Array.isArray(pageData)) {
      return { error: 'Respuesta inesperada de Meta' }
    }

    for (const t of pageData) {
      allTemplates.push({
        name: t.name,
        language: t.language,
        category: (t.category as string)?.toLowerCase?.() ?? 'utility',
        status: (t.status as string)?.toLowerCase?.() ?? 'pending',
        components: t.components,
      })
    }

    next = json?.paging?.next ?? null
  }

  // Upsert por (channel_id, name). Guardamos todos los status (approved, pending, rejected)
  // así el picker puede mostrar solo los approved pero el admin ve el resto.
  for (const tpl of allTemplates) {
    await supabase
      .from('message_templates')
      .upsert(
        {
          channel_id: channel.id,
          name: tpl.name,
          language: tpl.language,
          category: tpl.category,
          status: tpl.status,
          components: tpl.components,
        },
        { onConflict: 'channel_id, name' }
      )
  }

  revalidatePath('/dashboard/mensajeria')
  revalidatePath('/dashboard/turnos/configuracion')
  return { data: allTemplates, count: allTemplates.length }
}

// ===========================================================================
// Auto-seed de templates para turnos
// ===========================================================================

interface TemplateSpec {
  name: string
  category: 'UTILITY' | 'MARKETING'
  body_text: string
  body_examples: string[]  // ejemplos por variable {{1}}, {{2}}, ...
}

/**
 * Templates default que creamos automáticamente en la WABA del cliente al
 * conectar WA por primera vez. Esto elimina la fricción de configurar el CRM
 * antes de usar turnos.
 *
 * IMPORTANTE: Meta requiere que templates con variables tengan `example` en el
 * body. Usamos la sintaxis de `body_text` con placeholders {{1}}, {{2}}, etc.
 */
const DEFAULT_TEMPLATES: TemplateSpec[] = [
  {
    name: 'monaco_turno_confirmacion',
    category: 'UTILITY',
    body_text:
      'Hola {{1}}! Tu turno para {{2}} el {{3}} a las {{4}} en {{5}} fue confirmado. Te esperamos.',
    body_examples: ['Juan', 'Corte clásico', 'lunes 21 de abril', '15:30', 'Monaco Rondeau'],
  },
  {
    name: 'monaco_turno_recordatorio',
    category: 'UTILITY',
    body_text:
      'Hola {{1}}, te recordamos tu turno para {{2}} el {{3}} a las {{4}} en {{5}}.',
    body_examples: ['Juan', 'Corte clásico', 'mañana', '15:30', 'Monaco Rondeau'],
  },
  {
    name: 'monaco_turno_reprogramado',
    category: 'UTILITY',
    body_text:
      'Hola {{1}}, reprogramamos tu turno de {{2}}. Nueva fecha: {{3}} a las {{4}} en {{5}}. Cualquier duda, respondenos.',
    body_examples: ['Juan', 'Corte clásico', 'martes 22 de abril', '16:00', 'Monaco Rondeau'],
  },
  {
    name: 'monaco_turno_cancelado',
    category: 'UTILITY',
    body_text:
      'Hola {{1}}, tu turno para {{2}} el {{3}} a las {{4}} fue cancelado. Podés agendar otro cuando quieras.',
    body_examples: ['Juan', 'Corte clásico', 'lunes 21 de abril', '15:30'],
  },
  {
    name: 'monaco_turno_waitlist_disponible',
    category: 'UTILITY',
    body_text:
      'Hola {{1}}! Se liberó un turno para {{2}} el {{3}} a las {{4}} en {{5}}. Respondé "SI" en los próximos 30 minutos para reservarlo.',
    body_examples: ['Juan', 'Corte clásico', 'lunes 21 de abril', '15:30', 'Monaco Rondeau'],
  },
]

/**
 * Crea templates default en la WABA del cliente si no existen. Idempotente.
 * Se llama tras saveOrgWhatsAppConfig() exitoso. Los templates necesitan
 * aprobación de Meta (~minutos). Hasta que se aprueban, status=pending.
 */
export async function seedDefaultTemplates(): Promise<{ created: number; skipped: number; errors: Array<{ name: string; message: string }> }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { created: 0, skipped: 0, errors: [{ name: '', message: 'No autorizado' }] }

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_business_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_business_id) {
    return { created: 0, skipped: 0, errors: [{ name: '', message: 'WhatsApp no configurado' }] }
  }

  const channel = await getOrgWhatsAppChannel(orgId)
  if (!channel) {
    return { created: 0, skipped: 0, errors: [{ name: '', message: 'Canal WhatsApp no encontrado' }] }
  }

  // Traer templates existentes (un sync rápido) para saber cuáles skippear
  const { data: existing } = await supabase
    .from('message_templates')
    .select('name')
    .eq('channel_id', channel.id)

  const existingNames = new Set((existing ?? []).map(t => t.name))

  let created = 0
  let skipped = 0
  const errors: Array<{ name: string; message: string }> = []

  for (const tpl of DEFAULT_TEMPLATES) {
    if (existingNames.has(tpl.name)) {
      skipped++
      continue
    }

    const payload = {
      name: tpl.name,
      language: 'es',
      category: tpl.category,
      components: [
        {
          type: 'BODY',
          text: tpl.body_text,
          example: {
            body_text: [tpl.body_examples],
          },
        },
      ],
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${waConfig.whatsapp_business_id}/message_templates`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${waConfig.whatsapp_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        }
      )

      const result = await res.json()

      if (!res.ok) {
        const metaErr = result?.error?.message ?? 'Error desconocido'
        // Si Meta ya tiene el template con ese nombre, no es un error real
        if (typeof metaErr === 'string' && metaErr.toLowerCase().includes('already exists')) {
          skipped++
          continue
        }
        errors.push({ name: tpl.name, message: metaErr })
        continue
      }

      // Guardar registro local
      await supabase.from('message_templates').upsert(
        {
          channel_id: channel.id,
          name: tpl.name,
          language: 'es',
          category: tpl.category.toLowerCase(),
          status: 'pending', // Meta los marca así hasta aprobación
          components: payload.components,
        },
        { onConflict: 'channel_id, name' }
      )

      created++
    } catch (e) {
      errors.push({
        name: tpl.name,
        message: e instanceof Error ? e.message : 'Error de red',
      })
    }
  }

  revalidatePath('/dashboard/mensajeria')
  revalidatePath('/dashboard/turnos/configuracion')
  return { created, skipped, errors }
}

