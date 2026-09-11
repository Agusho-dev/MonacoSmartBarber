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
 *   3. Revoca Sign in with Apple con el refresh token guardado en el alta
 *      (`POST https://appleid.apple.com/auth/revoke`). Apple lo exige desde
 *      jun/2022: sin esto la app sigue apareciendo en Ajustes → Apple ID.
 *   4. Llama al RPC `public.delete_client_account(auth_user_id)`, que borra los
 *      datos de `public` en una sola transacción y devuelve
 *      `{client_id, client_ids, auth_user_ids}`. Si el cliente tiene una seña
 *      PAGADA sin resolver, el RPC corta con `deposit_pending` y acá se traduce
 *      a un 409 `DEPOSIT_PENDING` que la app muestra con un camino de salida
 *      (mig 215): es plata del cliente, no se borra en silencio.
 *   4-bis. Borra las fotos de cara de Storage, que ningún DELETE de Postgres
 *      alcanza.
 *   5. Verifica que no haya quedado ninguna identidad social colgada.
 *   6. Elimina los usuarios de `auth.users` (el que pidió la baja y los de las
 *      fichas duplicadas del mismo teléfono) vía admin API.
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
import {
  estaConfigurado as appleConfigurado,
  revocarRefreshToken,
} from '../_shared/apple-token.ts'

/** Bucket con las fotos de cara que saca la tablet del local. */
const BUCKET_CARAS = 'face-references'

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
    /**
     * Refresh tokens de Sign in with Apple. Se leen ANTES del RPC porque el
     * borrado se lleva la fila que los guarda, y se revocan ANTES también: si
     * el `POST /auth/revoke` se hiciera después y fallara, ya no habría de
     * dónde sacarlos y la app quedaría para siempre en Ajustes → Apple ID del
     * cliente. Apple lo exige para la 5.1.1(v).
     */
    let tokensApple: string[] = []
    if (clientId) {
      const { data: filas, error: idErr } = await adminClient
        .from('client_social_identities')
        .select('provider, apple_refresh_token')
        .eq('client_id', clientId)
      if (idErr) console.error(LOG, 'select client_social_identities falló:', idErr.message)
      else {
        const rows = (filas ?? []) as { provider: string; apple_refresh_token: string | null }[]
        identidades = rows.map((f) => f.provider)
        tokensApple = rows
          .filter((f) => f.provider === 'apple' && f.apple_refresh_token)
          .map((f) => f.apple_refresh_token as string)
      }
    }
    console.log(
      LOG,
      `baja pedida: auth_user=${authUserId} client=${clientId ?? '(sin ficha)'} identidades_sociales=[${identidades.join(',')}]`,
    )

    // 3. Revocar Sign in with Apple. Best-effort: si falla, se loguea y el
    //    borrado sigue — negarle la baja a alguien porque Apple no contestó
    //    sería peor, y es justamente lo que la 5.1.1(v) quiere evitar.
    for (const rt of tokensApple) {
      if (!appleConfigurado()) {
        console.warn(LOG, 'hay refresh token de Apple pero faltan los secrets APPLE_*: no se puede revocar')
        break
      }
      const r = await revocarRefreshToken(rt)
      if (r.ok) console.log(LOG, 'Sign in with Apple revocado para', authUserId)
      else console.error(LOG, 'no se pudo revocar Sign in with Apple:', r.motivo)
    }
    if (identidades.includes('apple') && tokensApple.length === 0) {
      // Pasa con las cuentas creadas antes de que existiera el canje del
      // `authorization_code`, o cuando los secrets no estaban cargados.
      console.warn(LOG, 'identidad de Apple SIN refresh token guardado: la autorización queda viva en el Apple ID de', authUserId)
    }

    // 4. Borrar datos PII del cliente (RPC atómico)
    const { data: rpcData, error: rpcError } = await adminClient.rpc('delete_client_account', {
      p_auth_user_id: authUserId,
    })

    if (rpcError) {
      const detalle = `${rpcError.code ?? 'sin-código'}: ${rpcError.message}`
      if (rpcError.message.includes('deposit_pending')) {
        // No es un fallo: es el único caso en que la baja NO se hace, porque
        // hay plata del cliente sin resolver (mig 215). El texto va en `error`
        // Y en `message`: la app reconoce el CÓDIGO para abrir su propio
        // cartel, y cualquier otro cliente muestra el campo `error` tal cual.
        console.warn(LOG, 'baja rechazada por seña pagada sin resolver:', authUserId)
        return json(
          {
            error: 'DEPOSIT_PENDING',
            message:
              'Tenés una seña pagada que todavía no se resolvió. Cancelá ese turno desde la app ' +
              'o escribinos, y apenas se resuelva podés borrar la cuenta.',
          },
          409,
        )
      }
      if (rpcError.message.includes('client_not_found')) {
        // El auth user existe pero no tiene cliente linkeado — borramos igual el auth user
        console.warn(LOG, 'client_not_found para', authUserId)
      } else {
        console.error(LOG, 'RPC error:', detalle)
        return json({ error: 'No se pudo eliminar los datos del cliente' }, 500)
      }
    }

    // 4-bis. Las fotos de cara son binarios en Storage: ningún DELETE de
    //    Postgres se las lleva. El RPC devuelve TODAS las fichas del mismo
    //    teléfono que borró, que son las carpetas a limpiar.
    const resultado = (rpcData ?? {}) as { client_ids?: string[]; auth_user_ids?: string[] }
    const idsBorrados = Array.isArray(resultado.client_ids) && resultado.client_ids.length > 0
      ? resultado.client_ids
      : (clientId ? [clientId] : [])
    for (const id of idsBorrados) {
      const { data: archivos, error: listErr } = await adminClient.storage.from(BUCKET_CARAS).list(id)
      if (listErr) {
        console.error(LOG, `no se pudo listar ${BUCKET_CARAS}/${id}:`, listErr.message)
        continue
      }
      const rutas = (archivos ?? []).map((f) => `${id}/${f.name}`)
      if (rutas.length === 0) continue
      const { error: rmErr } = await adminClient.storage.from(BUCKET_CARAS).remove(rutas)
      if (rmErr) console.error(LOG, `no se pudieron borrar ${rutas.length} fotos de ${id}:`, rmErr.message)
      else console.log(LOG, `borradas ${rutas.length} fotos de cara de ${id}`)
    }

    // 5. Red de seguridad: si la FK dejara de cascadear, una identidad social
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

    // 6. Borrar los users de auth.users. Además del que pidió la baja, los de
    //    las fichas duplicadas del mismo teléfono que el RPC también borró: un
    //    usuario de Auth sin ficha entra a una cuenta que ya no existe.
    for (const otro of (resultado.auth_user_ids ?? [])) {
      if (!otro || otro === authUserId) continue
      const { error: e } = await adminClient.auth.admin.deleteUser(otro)
      if (e) console.error(LOG, `no se pudo borrar el auth user duplicado ${otro}:`, e.message)
      else console.log(LOG, 'borrado auth user duplicado', otro)
    }

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
