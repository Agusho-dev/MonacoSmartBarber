'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

const META_API_VERSION = 'v22.0'

export async function getOrgInstagramConfig() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('organization_instagram_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function saveOrgInstagramConfig(config: {
  instagram_page_id: string
  instagram_page_access_token: string
  instagram_account_id?: string
  app_secret?: string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organization_instagram_config')
    .upsert(
      {
        organization_id: orgId,
        instagram_page_id: config.instagram_page_id,
        instagram_page_access_token: config.instagram_page_access_token,
        instagram_account_id: config.instagram_account_id ?? null,
        app_secret: config.app_secret || null,
        is_active: true,
      },
      { onConflict: 'organization_id' }
    )

  if (error) return { error: error.message }

  // Crear/actualizar canal social de Instagram para la primera sucursal
  const { data: firstBranch } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle()

  if (firstBranch) {
    await supabase
      .from('social_channels')
      .upsert(
        {
          branch_id: firstBranch.id,
          platform: 'instagram',
          platform_account_id: config.instagram_page_id,
          display_name: 'Instagram Business',
          is_active: true,
        },
        { onConflict: 'branch_id, platform' }
      )
  }

  const { data: saved } = await supabase
    .from('organization_instagram_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  revalidatePath('/dashboard/mensajeria')
  return { success: true, data: saved }
}

// Envía un mensaje de texto vía Instagram Messaging API e inserta el registro en DB
export async function sendInstagramMessage(
  to: string,
  content: string,
  conversationId: string,
  staffId?: string
): Promise<{ success?: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: igConfig } = await supabase
    .from('organization_instagram_config')
    .select('instagram_page_id, instagram_page_access_token')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!igConfig?.instagram_page_id || !igConfig?.instagram_page_access_token) {
    return { error: 'Instagram no configurado. Completá las credenciales en Configuración.' }
  }

  let res: Response
  try {
    // Instagram Messaging API usa graph.instagram.com con /me/messages
    res = await fetch(
      `https://graph.instagram.com/${META_API_VERSION}/me/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${igConfig.instagram_page_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: to },
          message: { text: content },
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

  const platformMsgId: string | undefined = result.message_id

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
