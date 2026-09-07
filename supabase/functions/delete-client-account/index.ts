/**
 * Edge Function: delete-client-account
 *
 * Cumple con Apple App Store Review Guideline 5.1.1(v): el cliente puede
 * eliminar su cuenta y sus datos personales desde dentro de la app.
 *
 * Flujo:
 *   1. Valida el JWT del cliente (header Authorization).
 *   2. Resuelve su ficha y deja constancia de qué se va a borrar (incluidas las
 *      identidades sociales de Google/Apple, mig 210).
 *   3. Llama al RPC `public.delete_client_account(auth_user_id)`, que borra los
 *      datos de `public` en una sola transacción.
 *   4. Verifica que no haya quedado ninguna identidad social colgada.
 *   5. Elimina el usuario de `auth.users` vía admin API.
 *
 * `client_social_identities.client_id` es `ON DELETE CASCADE` (verificado
 * contra producción el 3/9/2026), así que el `DELETE FROM clients` del RPC se
 * las lleva. El chequeo del paso 4 está igual: si alguna vez alguien cambia esa
 * FK, la cuenta de Google del cliente borrado quedaría vinculada a una ficha que
 * ya no existe y el próximo `social` la encontraría. Es barato y no es
 * redundante con la confianza, es redundante con la FK — que es lo que puede
 * cambiar.
 *
 * Deploy: supabase functions deploy delete-client-account
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const LOG = '[delete-client-account]'

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

    // 2. Constancia de lo que se va a borrar. El RPC no devuelve el detalle y
    //    después del borrado ya no hay a quién preguntarle: si esto no se
    //    registra ahora, no queda rastro de que la cuenta tenía un Google o un
    //    Apple vinculado.
    const { data: cliente, error: clienteError } = await adminClient
      .from('clients')
      .select('id')
      .eq('auth_user_id', authUserId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (clienteError) {
      console.error(LOG, 'select clients falló:', clienteError.message)
      return json({ error: 'No se pudo eliminar los datos del cliente' }, 500)
    }

    const clientId = cliente?.id ?? null
    let identidades: string[] = []
    if (clientId) {
      const { data: filas, error: idErr } = await adminClient
        .from('client_social_identities')
        .select('provider')
        .eq('client_id', clientId)
      if (idErr) console.error(LOG, 'select client_social_identities falló:', idErr.message)
      else identidades = (filas ?? []).map((f) => (f as { provider: string }).provider)
    }
    console.log(
      LOG,
      `baja pedida: auth_user=${authUserId} client=${clientId ?? '(sin ficha)'} identidades_sociales=[${identidades.join(',')}]`,
    )

    // 3. Borrar datos PII del cliente (RPC atómico)
    const { error: rpcError } = await adminClient.rpc('delete_client_account', {
      p_auth_user_id: authUserId,
    })

    if (rpcError) {
      if (rpcError.message.includes('client_not_found')) {
        // El auth user existe pero no tiene cliente linkeado — borramos igual el auth user
        console.warn(LOG, 'client_not_found para', authUserId)
      } else {
        console.error(LOG, 'RPC error:', rpcError)
        return json({ error: 'No se pudo eliminar los datos del cliente' }, 500)
      }
    }

    // 4. Red de seguridad: si la FK dejara de cascadear, una identidad social
    //    huérfana volvería a hacer entrar al que pidió la baja.
    if (clientId) {
      const { data: sobrantes, error: sobrErr } = await adminClient
        .from('client_social_identities')
        .select('id')
        .eq('client_id', clientId)
      if (sobrErr) {
        console.error(LOG, 'no se pudo verificar client_social_identities:', sobrErr.message)
      } else if ((sobrantes ?? []).length > 0) {
        console.error(LOG, `quedaron ${sobrantes!.length} identidades sociales sin borrar; se borran a mano`)
        const { error: delErr } = await adminClient
          .from('client_social_identities')
          .delete()
          .eq('client_id', clientId)
        if (delErr) {
          console.error(LOG, 'no se pudieron borrar las identidades sociales:', delErr.message)
          return json(
            { error: 'No se pudieron eliminar todos tus datos. Escribinos para completarlo.' },
            500,
          )
        }
      }
    }

    // 5. Borrar el user de auth.users
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(authUserId)
    if (deleteUserError) {
      console.error(LOG, 'deleteUser error:', deleteUserError)
      return json(
        { error: 'Datos eliminados, pero no se pudo eliminar la cuenta de autenticación. Contactá soporte.' },
        500,
      )
    }

    console.log(LOG, `baja completa: auth_user=${authUserId} client=${clientId ?? '(sin ficha)'}`)
    return json({ success: true }, 200)

  } catch (err) {
    console.error(LOG, 'Error:', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
