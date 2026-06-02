'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'
import { sendToMeta, extractInstagramId } from '@/lib/meta-send'

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

  // Gate: Instagram es Enterprise.
  const { requireFeature } = await import('./entitlements')
  const { EntitlementError } = await import('@/lib/billing/types')
  try {
    await requireFeature('messaging.instagram')
  } catch (e) {
    if (e instanceof EntitlementError) return { error: e.message, entitlement: e.toResponse() }
    throw e
  }

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

  // Instagram Messaging API usa graph.instagram.com con /me/messages.
  // sendToMeta reintenta ante errores transitorios (rate-limit/5xx) y captura
  // el error completo de Meta — los fallos transitorios de IG eran la causa raíz
  // de "no se envían los mensajes" (incidente 02/jun/2026).
  const outcome = await sendToMeta({
    url: `https://graph.instagram.com/${META_API_VERSION}/me/messages`,
    token: igConfig.instagram_page_access_token,
    payload: {
      recipient: { id: to },
      message: { text: content },
    },
    extractId: extractInstagramId,
  })

  if (!outcome.ok) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'text',
      content,
      status: 'failed',
      error_message: outcome.errorMessage,
      sent_by_staff_id: staffId ?? null,
    })
    return { error: outcome.errorMessage ?? 'Error al enviar mensaje' }
  }

  const { error: insErr } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    content_type: 'text',
    content,
    platform_message_id: outcome.platformMessageId,
    status: 'sent',
    sent_by_staff_id: staffId ?? null,
  })
  if (insErr) console.error('[Instagram Meta] Mensaje enviado a Meta pero no registrado en DB:', insErr.message)

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
