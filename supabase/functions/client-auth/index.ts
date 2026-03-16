/**
 * Edge Function: client-auth
 *
 * Autenticación de clientes móviles sin OTP SMS (v1).
 * Estrategia:
 *   - Primer uso: crea cuenta Supabase Auth con email={phone}@monaco.internal
 *     y password=device_secret (secreto generado y guardado en SecureStorage del dispositivo).
 *   - Usos posteriores: signInWithPassword usando el mismo device_secret.
 *   - La biometría (Face ID / Touch ID) actúa como gate LOCAL en el dispositivo.
 *
 * Deploy: supabase functions deploy client-auth --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AuthRequest {
  phone:         string
  device_id:     string
  device_secret: string
  name?:         string   // solo en registro inicial
}

interface AuthResponse {
  access_token:  string
  refresh_token: string
  client_id:     string
  is_new_client: boolean
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Método no permitido' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body: AuthRequest = await req.json()
    const { phone, device_id, device_secret, name } = body

    // Validaciones básicas
    if (!phone || !device_id || !device_secret) {
      return new Response(
        JSON.stringify({ error: 'phone, device_id y device_secret son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Normalizar teléfono (quitar espacios y caracteres no numéricos excepto +)
    const normalizedPhone = phone.replace(/[^\d+]/g, '')
    if (normalizedPhone.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Número de teléfono inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // device_secret mínimo 32 chars (SHA256 hex = 64 chars)
    if (device_secret.length < 32) {
      return new Response(
        JSON.stringify({ error: 'device_secret inseguro' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const email = `${normalizedPhone}@monaco.internal`

    // 1. Buscar cliente existente por teléfono
    const { data: existingClient } = await adminClient
      .from('clients')
      .select('id, auth_user_id, name')
      .eq('phone', normalizedPhone)
      .maybeSingle()

    let authUserId: string
    let clientId: string
    let isNewClient = false

    if (existingClient?.auth_user_id) {
      // --- CLIENTE EXISTENTE CON CUENTA AUTH ---
      // Intentar login con device_secret
      const { data: signInData, error: signInError } = await adminClient.auth.signInWithPassword({
        email,
        password: device_secret,
      })

      if (signInError || !signInData.session) {
        // El device_secret no coincide → podría ser un dispositivo nuevo
        // Verificar si el cliente existe pero intenta desde otro dispositivo
        return new Response(
          JSON.stringify({
            error: 'Autenticación fallida. Si cambiaste de dispositivo, contacta al local.',
            code: 'INVALID_DEVICE_SECRET'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      authUserId = signInData.session.user.id
      clientId = existingClient.id

      // Actualizar last_login_at
      await adminClient
        .from('clients')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', clientId)

      return new Response(
        JSON.stringify({
          access_token:  signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
          client_id:     clientId,
          is_new_client: false,
        } satisfies AuthResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- CLIENTE SIN CUENTA AUTH (o cliente nuevo) ---

    // Crear usuario en Supabase Auth
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: device_secret,
      email_confirm: true,  // auto-confirmar sin email
    })

    if (createError) {
      // Si ya existe el email en auth (race condition o reinstalación)
      // intentar login directo
      if (createError.message.includes('already been registered')) {
        const { data: retrySignIn, error: retryError } = await adminClient.auth.signInWithPassword({
          email,
          password: device_secret,
        })
        if (retryError || !retrySignIn.session) {
          return new Response(
            JSON.stringify({ error: 'Cuenta existente con credencial diferente.', code: 'AUTH_CONFLICT' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        authUserId = retrySignIn.session.user.id

        // Buscar cliente y vincularlo si aún no está vinculado
        const { data: unlinkedClient } = await adminClient
          .from('clients')
          .select('id')
          .eq('phone', normalizedPhone)
          .maybeSingle()

        if (unlinkedClient) {
          await adminClient
            .from('clients')
            .update({ auth_user_id: authUserId, last_login_at: new Date().toISOString() })
            .eq('id', unlinkedClient.id)
          clientId = unlinkedClient.id
        } else {
          // Crear cliente si no existe
          const { data: newClient } = await adminClient
            .from('clients')
            .insert({ phone: normalizedPhone, name: name || normalizedPhone, auth_user_id: authUserId })
            .select('id')
            .single()
          clientId = newClient!.id
          isNewClient = true
        }

        return new Response(
          JSON.stringify({
            access_token:  retrySignIn.session.access_token,
            refresh_token: retrySignIn.session.refresh_token,
            client_id:     clientId,
            is_new_client: isNewClient,
          } satisfies AuthResponse),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      throw createError
    }

    authUserId = newUser.user!.id

    // Crear o actualizar cliente vinculando auth_user_id
    if (existingClient) {
      // Cliente existente sin auth → vincularlo
      await adminClient
        .from('clients')
        .update({
          auth_user_id: authUserId,
          last_login_at: new Date().toISOString()
        })
        .eq('id', existingClient.id)
      clientId = existingClient.id
    } else {
      // Cliente completamente nuevo
      const { data: newClientData, error: clientError } = await adminClient
        .from('clients')
        .insert({
          phone:        normalizedPhone,
          name:         name || normalizedPhone,
          auth_user_id: authUserId,
        })
        .select('id')
        .single()

      if (clientError || !newClientData) {
        // Rollback: eliminar usuario auth creado
        await adminClient.auth.admin.deleteUser(authUserId)
        throw clientError || new Error('No se pudo crear el cliente')
      }

      clientId = newClientData.id
      isNewClient = true
    }

    // Obtener session para el nuevo usuario
    const { data: sessionData, error: sessionError } = await adminClient.auth.signInWithPassword({
      email,
      password: device_secret,
    })

    if (sessionError || !sessionData.session) {
      throw sessionError || new Error('No se pudo obtener sesión')
    }

    return new Response(
      JSON.stringify({
        access_token:  sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        client_id:     clientId,
        is_new_client: isNewClient,
      } satisfies AuthResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[client-auth] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
