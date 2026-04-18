import 'server-only'
import { headers } from 'next/headers'

/**
 * Resuelve el origin de la app. Prioridad:
 * 1. Env explícito (NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL) — para custom domain
 * 2. Headers del request (x-forwarded-host + x-forwarded-proto) — funciona en cualquier deploy
 * 3. VERCEL env vars — fallback si no hay request context (cron, background jobs)
 * 4. http://localhost:3000 — dev
 *
 * Usar para construir URLs absolutas que salen del servidor hacia clientes
 * externos (WhatsApp, emails, QR). NUNCA usar paths relativos en mensajes
 * que se envían fuera del dashboard.
 */
export async function buildAppUrl(): Promise<string> {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') || h.get('host')
    const proto = h.get('x-forwarded-proto') || 'https'
    if (host) return `${proto}://${host}`
  } catch {
    // Fuera de request context (cron, workers) — caer a env
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost}`

  return 'http://localhost:3000'
}

/**
 * Construye una URL absoluta uniendo el base con un path relativo.
 * Acepta paths con o sin leading slash.
 */
export async function absoluteUrl(path: string): Promise<string> {
  const base = await buildAppUrl()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}
