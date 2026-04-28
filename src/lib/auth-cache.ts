// Server-only utilities. NO 'use server' directive a propósito: estas funciones
// retornan objetos no-serializables (Supabase User) y por eso NO pueden estar
// expuestas como server actions desde el cliente.

import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Devuelve el usuario autenticado de Supabase Auth, deduplicado por request.
 * `auth.getUser()` valida el JWT vía red contra Supabase. Wrapearlo con
 * `cache()` evita pagar la roundtrip dos veces cuando el layout y un helper
 * (ej: getCurrentOrgId) lo necesitan en el mismo render.
 *
 * Server-only: NO debe llamarse desde client components.
 */
export const getCachedAuthUser = cache(async function getCachedAuthUser() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    return user
  } catch {
    return null
  }
})
