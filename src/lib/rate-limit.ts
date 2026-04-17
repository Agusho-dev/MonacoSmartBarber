// NOTA: este archivo NO lleva 'use server' — exporta un objeto (RateLimits) con helpers,
// y Next.js 16 solo permite async functions en archivos 'use server'. Los callers son
// server actions que llaman estas functions desde dentro de sus propios 'use server'.
// Todas las funciones exportadas son async y solo corren en server (usan createAdminClient + next/headers).

import 'server-only'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Fixed-window rate limiter backed by DB (`rate_limits` tabla).
 * Usar desde server actions de endpoints públicos (kiosk, login PIN, review submit, lookup).
 *
 * Ejemplo:
 *   const gate = await rateLimit('pin_login', `ip:${ip}:${branchId}`, { limit: 5, window: 60 })
 *   if (!gate.allowed) return { error: 'Demasiados intentos, esperá un minuto' }
 */

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset_at: string
}

export interface RateLimitOptions {
  limit: number        // max requests por ventana
  window: number       // ventana en segundos
}

export async function rateLimit(
  bucket: string,
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.window,
  })

  if (error || !data?.[0]) {
    // Fail-open en caso de error DB (no queremos bloquear producción por un glitch)
    console.error('[rateLimit] DB error:', error)
    return { allowed: true, remaining: opts.limit, reset_at: new Date().toISOString() }
  }

  return data[0] as RateLimitResult
}

/**
 * Obtiene el IP real del cliente desde headers (Vercel / proxies).
 * Fallback a 'unknown' si no está disponible.
 */
export async function getClientIP(): Promise<string> {
  const h = await headers()
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? h.get('x-real-ip')?.trim()
    ?? h.get('cf-connecting-ip')?.trim()
    ?? 'unknown'
  )
}

/**
 * Helpers conveniencias para los buckets más usados.
 */
export const RateLimits = {
  // Login PIN de barbero: 5 intentos por IP+branch cada 60s
  pinLogin: async (branchId: string) => {
    const ip = await getClientIP()
    return rateLimit('pin_login', `${ip}:${branchId}`, { limit: 5, window: 60 })
  },

  // Check-in kiosk: 20 por branch cada 60s (permisivo para uso real, restrictivo contra bots)
  kioskCheckin: async (branchId: string) => {
    const ip = await getClientIP()
    return rateLimit('kiosk_checkin', `${ip}:${branchId}`, { limit: 20, window: 60 })
  },

  // Review submit: 1 por token (tokens son únicos, redundante pero defensa extra)
  reviewSubmit: async (token: string) => {
    return rateLimit('review_submit', token, { limit: 3, window: 300 })
  },

  // Lookup por teléfono (staff): 10 por user cada 60s
  lookupClientPhone: async (userId: string) => {
    return rateLimit('lookup_phone', userId, { limit: 10, window: 60 })
  },

  // Register org: 3 por IP cada hora (anti-spam de orgs creadas)
  registerOrg: async () => {
    const ip = await getClientIP()
    return rateLimit('register_org', ip, { limit: 3, window: 3600 })
  },
}
