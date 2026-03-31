'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
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

export async function saveOrgWhatsAppConfig(config: {
  whatsapp_access_token: string
  whatsapp_phone_id: string
  whatsapp_business_id: string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organization_whatsapp_config')
    .upsert(
      {
        organization_id: orgId,
        whatsapp_access_token: config.whatsapp_access_token,
        whatsapp_phone_id: config.whatsapp_phone_id,
        whatsapp_business_id: config.whatsapp_business_id,
        is_active: true,
      },
      { onConflict: 'organization_id' }
    )

  if (error) return { error: error.message }

  // Retornar la config completa (incluyendo verify_token generado) para mostrarlo en la UI
  const { data: saved } = await supabase
    .from('organization_whatsapp_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  revalidatePath('/dashboard/mensajeria')
  return { success: true, data: saved }
}

// Envía un mensaje de texto vía Meta Cloud API e inserta el registro en DB
export async function sendMetaWhatsAppMessage(
  to: string,
  content: string,
  conversationId: string,
  staffId?: string
): Promise<{ success?: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: waConfig } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!waConfig?.whatsapp_access_token || !waConfig?.whatsapp_phone_id) {
    return { error: 'WhatsApp no configurado. Completá las credenciales en Configuración.' }
  }

  const phone = to.replace(/\D/g, '')

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
