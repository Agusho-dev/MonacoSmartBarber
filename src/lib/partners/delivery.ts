import { createAdminClient } from '@/lib/supabase/server'

/**
 * Entrega del magic link. Para el MVP:
 *  - El dashboard muestra el link para copiar.
 *  - Si el partner tiene contact_phone y la org tiene WhatsApp configurado,
 *    se envía por WhatsApp Cloud API usando la config de la org invitante.
 *
 * Email queda como TODO (no hay proveedor SMTP configurado).
 */
export async function sendMagicLinkViaWhatsApp(params: {
  organizationId: string
  phone: string
  businessName: string
  url: string
  purpose: 'invitation' | 'login'
}): Promise<{ sent: boolean; error?: string }> {
  const { organizationId, phone, businessName, url, purpose } = params

  const supabase = createAdminClient()
  const { data: cfg } = await supabase
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id, is_active')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!cfg?.is_active || !cfg.whatsapp_access_token || !cfg.whatsapp_phone_id) {
    return { sent: false, error: 'WhatsApp no configurado' }
  }

  const normalizedPhone = phone.replace(/[^\d]/g, '')
  if (!normalizedPhone) return { sent: false, error: 'Teléfono inválido' }

  const message =
    purpose === 'invitation'
      ? `¡Hola! Fuiste invitado a crear convenios comerciales con nosotros. Entrá al siguiente link para configurar tus beneficios:\n\n${url}\n\nEl link caduca en 72 horas.`
      : `Tu link de acceso a ${businessName}:\n\n${url}\n\nExpira en 15 minutos.`

  const endpoint = `https://graph.facebook.com/v22.0/${cfg.whatsapp_phone_id}/messages`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.whatsapp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'text',
        text: { body: message, preview_url: true },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { sent: false, error: `WhatsApp API: ${body}` }
    }

    return { sent: true }
  } catch (e) {
    return { sent: false, error: (e as Error).message }
  }
}
