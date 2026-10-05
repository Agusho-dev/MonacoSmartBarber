/**
 * Salvavidas del corte de Menor espera: lo usa el webhook de WhatsApp cuando el
 * módulo del corte (`./webhook`, importado dinámicamente) NO cargó y el mensaje
 * es uno de nuestros botones (mig 222, hallazgo menor-espera-06).
 *
 * Antes, en ese caso el botón sólo se descartaba: el cliente tocaba «Sí,
 * pasarme», no recibía nada, seguía esperando creyendo que lo habían pasado y
 * la recepción no se enteraba. Ahora queda una alerta urgente y, si la firma de
 * Meta validó, el cliente recibe «No pudimos cambiarte…».
 *
 * Se importa ESTÁTICAMENTE desde la ruta, así que tiene que ser mínimo: sólo
 * `fetch`, el cliente de Supabase que le pasan y textos puros. Nada que pueda
 * fallar al cargar y tumbar el webhook entero. Por eso no usa `sendToMeta` ni
 * el módulo del corte.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { respuestaDeBoton } from './plantilla'
import { ALERTA_ERROR_TITULO, alertaErrorBoton, textoError } from './textos'

const META_API_VERSION = 'v22.0'

export async function salvavidasBotonMenorEspera(p: {
  supabase: SupabaseClient
  orgId: string
  conversationId: string
  from: string
  button: { text?: string | null; payload?: string | null } | null | undefined
  firmaValida: boolean
  waConfig: { whatsapp_access_token: string | null; whatsapp_phone_id: string | null }
  motivo: string
}): Promise<void> {
  try {
    const boton = p.button?.text || p.button?.payload || null
    const { error: alErr } = await p.supabase.from('crm_alerts').insert({
      organization_id: p.orgId,
      conversation_id: p.conversationId,
      alert_type: 'urgent',
      title: ALERTA_ERROR_TITULO,
      message: alertaErrorBoton(boton, p.motivo),
      metadata: { origen: 'menor_espera', platform: 'whatsapp', motivo: p.motivo, firma_valida: p.firmaValida },
    })
    if (alErr) console.error('[menor-espera] salvavidas: crm_alerts.insert:', alErr.message)

    // Sin firma verificada no se le escribe a nadie: no sabemos si lo mandó él.
    const token = p.waConfig.whatsapp_access_token
    const phoneId = p.waConfig.whatsapp_phone_id
    if (!p.firmaValida || !token || !phoneId) return

    const cuerpo = textoError(respuestaDeBoton(p.button, null))
    let wamid: string | null = null
    let falla: string | null = null
    try {
      const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: p.from, type: 'text', text: { body: cuerpo } }),
        signal: AbortSignal.timeout(6000),
      })
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } }
      wamid = json.messages?.[0]?.id ?? null
      if (!res.ok || !wamid) falla = json.error?.message ?? `HTTP ${res.status}`
    } catch (e) {
      falla = e instanceof Error ? e.message : String(e)
    }

    const { error: insErr } = await p.supabase.from('messages').insert({
      conversation_id: p.conversationId,
      direction: 'outbound',
      content_type: 'text',
      content: cuerpo,
      platform_message_id: wamid,
      status: falla ? 'failed' : 'sent',
      error_message: falla,
    })
    if (insErr) console.error('[menor-espera] salvavidas: messages.insert:', insErr.message)
    if (falla) console.error('[menor-espera] salvavidas: la respuesta no salió:', falla)
  } catch (e) {
    console.error('[menor-espera] salvavidas:', e)
  }
}
