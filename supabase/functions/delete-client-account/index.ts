/**
 * Edge Function: delete-client-account
 *
 * Cumple con Apple App Store Review Guideline 5.1.1(v):
 * el cliente puede eliminar su cuenta y datos PII desde dentro de la app.
 *
 * Flujo:
 *   1. Valida el JWT del cliente (header Authorization).
 *   2. Llama al RPC public.delete_client_account(auth_user_id) — borra datos de public.
 *   3. Elimina el usuario de auth.users vía admin API.
 *
 * Deploy: supabase functions deploy delete-client-account
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido' }, 405)
  }

  try {
    // 1. Validar JWT del cliente
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Falta token de autenticación' }, 401)
    }
    const token = authHeader.slice(7)

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await adminClient.auth.getUser(token)
    if (userError || !userData.user) {
      return json({ error: 'Token inválido o expirado' }, 401)
    }

    const authUserId = userData.user.id

    // 2. Borrar datos PII del cliente (RPC atómico)
    const { error: rpcError } = await adminClient.rpc('delete_client_account', {
      p_auth_user_id: authUserId,
    })

    if (rpcError) {
      if (rpcError.message.includes('client_not_found')) {
        // El auth user existe pero no tiene cliente linkeado — borramos igual el auth user
        console.warn('[delete-client-account] client_not_found para', authUserId)
      } else {
        console.error('[delete-client-account] RPC error:', rpcError)
        return json({ error: 'No se pudo eliminar los datos del cliente' }, 500)
      }
    }

    // 3. Borrar el user de auth.users
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(authUserId)
    if (deleteUserError) {
      console.error('[delete-client-account] deleteUser error:', deleteUserError)
      return json(
        { error: 'Datos eliminados, pero no se pudo eliminar la cuenta de autenticación. Contactá soporte.' },
        500,
      )
    }

    return json({ success: true }, 200)

  } catch (err) {
    console.error('[delete-client-account] Error:', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
