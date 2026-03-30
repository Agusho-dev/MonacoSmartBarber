'use server'

// Server actions para interactuar con el microservicio WhatsApp (Baileys)
// La URL del microservicio se guarda en app_settings.wa_api_url

import { createAdminClient, createClient } from '@/lib/supabase/server'

async function requireAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado')
}

async function getWaConfig(): Promise<{ url: string; apiKey: string } | null> {
  const { getCurrentOrgId } = await import('./org')
  const orgId = await getCurrentOrgId()
  const supabase = createAdminClient()

  let query = supabase.from('app_settings').select('wa_api_url')
  if (orgId) query = query.eq('organization_id', orgId)
  const { data } = await query.maybeSingle()

  const url = data?.wa_api_url as string | undefined
  const apiKey = process.env.WA_API_KEY

  if (!url || !apiKey) return null
  return { url, apiKey }
}

export async function getWhatsAppStatus(): Promise<{
  status: 'connected' | 'disconnected' | 'qr_pending' | 'not_configured'
  error?: string
}> {
  try {
    await requireAuth()
  } catch {
    return { status: 'not_configured', error: 'No autorizado' }
  }

  const config = await getWaConfig()
  if (!config) return { status: 'not_configured' }

  try {
    const res = await fetch(`${config.url}/status`, {
      headers: { 'x-api-key': config.apiKey },
      cache: 'no-store',
    })
    if (!res.ok) return { status: 'disconnected', error: 'Error al conectar con el microservicio' }
    const data = await res.json()
    return { status: data.status }
  } catch {
    return { status: 'disconnected', error: 'Microservicio no disponible' }
  }
}

export async function getWhatsAppQR(): Promise<{ qr: string | null; error?: string }> {
  try {
    await requireAuth()
  } catch {
    return { qr: null, error: 'No autorizado' }
  }

  const config = await getWaConfig()
  if (!config) return { qr: null, error: 'Microservicio no configurado' }

  try {
    const res = await fetch(`${config.url}/qr`, {
      headers: { 'x-api-key': config.apiKey },
      cache: 'no-store',
    })
    if (res.status === 404) return { qr: null }
    if (!res.ok) return { qr: null, error: 'Error al obtener QR' }
    const data = await res.json()
    return { qr: data.qr ?? null }
  } catch {
    return { qr: null, error: 'Microservicio no disponible' }
  }
}

export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAuth()
  } catch {
    return { success: false, error: 'No autorizado' }
  }

  const config = await getWaConfig()
  if (!config) return { success: false, error: 'Microservicio no configurado' }

  try {
    const res = await fetch(`${config.url}/send`, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone, message }),
    })
    const data = await res.json()
    if (!res.ok || data.error) return { success: false, error: data.error || 'Error al enviar mensaje' }
    return { success: true }
  } catch {
    return { success: false, error: 'Microservicio no disponible' }
  }
}

export async function logoutWhatsApp(): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAuth()
  } catch {
    return { success: false, error: 'No autorizado' }
  }

  const config = await getWaConfig()
  if (!config) return { success: false, error: 'Microservicio no configurado' }

  try {
    const res = await fetch(`${config.url}/logout`, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey },
    })
    if (!res.ok) return { success: false, error: 'Error al desconectar' }
    return { success: true }
  } catch {
    return { success: false, error: 'Microservicio no disponible' }
  }
}
