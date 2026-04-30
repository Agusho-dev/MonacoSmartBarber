import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Tiempo máximo de espera para cualquier request a Supabase.
// Si la DB no responde en este tiempo, se lanza un AbortError en lugar de
// colgar la request por hasta 60s (timeout por defecto de Node fetch).
const SUPABASE_FETCH_TIMEOUT_MS = 8_000

/**
 * Devuelve una función `fetch` que cancela la request si no responde
 * dentro de `timeoutMs` milisegundos. El error resultante es un DOMException
 * con `name === 'AbortError'`, que los layouts interpretan como error de red
 * (no como error de autenticación) y muestran DbDownError en lugar de
 * redirigir al login.
 */
function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    return fetch(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId)
    )
  }
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component context — ignorado
          }
        },
      },
      global: { fetch: fetchWithTimeout(SUPABASE_FETCH_TIMEOUT_MS) },
    }
  )
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: { fetch: fetchWithTimeout(SUPABASE_FETCH_TIMEOUT_MS) },
    }
  )
}
