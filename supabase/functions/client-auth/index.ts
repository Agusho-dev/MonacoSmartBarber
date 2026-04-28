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
 * Migración Ola 3 perf audit: error checks completos en cada operación DB.
 * Patrón obligatorio (CLAUDE.md): chequear error de cada .insert()/.update()/.select().
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
  name?:         string
  org_id?:       string
  branch_id?:    string
}

interface AuthResponse {
  access_token:  string
  refresh_token: string
  client_id:     string
  is_new_client: boolean
}

function jsonError(status: number, message: string, code?: string): Response {
  return new Response(
    JSON.stringify({ error: message, ...(code ? { code } : {}) }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Método no permitido')
  }

  try {
    const body: AuthRequest = await req.json()
    const { phone, device_id, device_secret, name, org_id, branch_id } = body

    if (!phone || !device_id || !device_secret) {
      return jsonError(400, 'phone, device_id y device_secret son requeridos')
    }

    if (!org_id && !branch_id) {
      return jsonError(400, 'org_id o branch_id es requerido para identificar la organización')
    }

    const normalizedPhone = phone.replace(/[^\d+]/g, '')
    if (normalizedPhone.length < 8) {
      return jsonError(400, 'Número de teléfono inválido')
    }

    if (device_secret.length < 32) {
      return jsonError(400, 'device_secret inseguro')
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const email = `${normalizedPhone}@monaco.internal`
    const logCtx = `phone=${normalizedPhone}`

    // Resolver organization_id desde org_id directo o desde branch_id
    let organizationId: string | null = org_id || null
    if (!organizationId && branch_id) {
      const { data: branchData, error: branchErr } = await adminClient
        .from('branches')
        .select('organization_id')
        .eq('id', branch_id)
        .maybeSingle()
      if (branchErr) {
        console.error(`[client-auth] branches lookup error ${logCtx} branch_id=${branch_id}:`, branchErr.message)
        return jsonError(500, 'Error consultando branches', 'BRANCH_LOOKUP_FAILED')
      }
      organizationId = branchData?.organization_id ?? null
    }

    if (!organizationId) {
      return jsonError(400, 'No se pudo resolver la organización')
    }

    // Verificar que la organización existe y está activa
    const { data: orgData, error: orgErr } = await adminClient
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .eq('is_active', true)
      .maybeSingle()
    if (orgErr) {
      console.error(`[client-auth] organizations lookup error ${logCtx} org=${organizationId}:`, orgErr.message)
      return jsonError(500, 'Error consultando organización', 'ORG_LOOKUP_FAILED')
    }

    if (!orgData) {
      return jsonError(404, 'Organización no encontrada o inactiva')
    }

    // 1. Buscar cliente existente por teléfono dentro de la organización
    const { data: existingClient, error: clientErr } = await adminClient
      .from('clients')
      .select('id, auth_user_id, name')
      .eq('phone', normalizedPhone)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (clientErr) {
      console.error(`[client-auth] clients lookup error ${logCtx} org=${organizationId}:`, clientErr.message)
      return jsonError(500, 'Error consultando cliente', 'CLIENT_LOOKUP_FAILED')
    }

    let authUserId: string
    let clientId: string
    let isNewClient = false

    if (existingClient?.auth_user_id) {
      // --- CLIENTE EXISTENTE CON CUENTA AUTH ---
      const signInResult = await adminClient.auth.signInWithPassword({
        email,
        password: device_secret,
      })
      const signInError = signInResult.error
      let signInData = signInResult.data

      if (signInError || !signInData?.session) {
        // Auto-resetear password (dispositivo nuevo o reinstalación)
        const { error: updateError } = await adminClient.auth.admin.updateUserById(
          existingClient.auth_user_id,
          { password: device_secret }
        )
        if (updateError) {
          console.error(`[client-auth] reset password error ${logCtx}:`, updateError.message)
          return jsonError(500, 'Error actualizando credenciales', 'UPDATE_FAILED')
        }

        const { data: retryData, error: retryError } = await adminClient.auth.signInWithPassword({
          email,
          password: device_secret,
        })
        if (retryError || !retryData?.session) {
          console.error(`[client-auth] retry signin failed ${logCtx}:`, retryError?.message)
          return jsonError(401, 'Autenticación fallida tras actualización', 'RETRY_FAILED')
        }
        signInData = retryData
      }

      authUserId = signInData.session!.user.id
      clientId = existingClient.id

      // Actualizar last_login_at (no fatal si falla)
      const { error: lastLoginErr } = await adminClient
        .from('clients')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', clientId)
      if (lastLoginErr) {
        console.error(`[client-auth] last_login_at update error ${logCtx} client=${clientId}:`, lastLoginErr.message)
      }

      return new Response(
        JSON.stringify({
          access_token:  signInData.session!.access_token,
          refresh_token: signInData.session!.refresh_token,
          client_id:     clientId,
          is_new_client: false,
        } satisfies AuthResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- CLIENTE SIN CUENTA AUTH (o cliente nuevo) ---
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: device_secret,
      email_confirm: true,
      app_metadata: { organization_id: organizationId },
    })

    if (createError) {
      // Race condition o reinstalación: ya existe el email
      if (createError.message.includes('already been registered')) {
        const { data: retrySignIn, error: retryError } = await adminClient.auth.signInWithPassword({
          email,
          password: device_secret,
        })
        if (retryError || !retrySignIn.session) {
          console.error(`[client-auth] race signin failed ${logCtx}:`, retryError?.message)
          return jsonError(409, 'Cuenta existente con credencial diferente.', 'AUTH_CONFLICT')
        }
        authUserId = retrySignIn.session.user.id

        const { data: unlinkedClient, error: unlinkedErr } = await adminClient
          .from('clients')
          .select('id')
          .eq('phone', normalizedPhone)
          .eq('organization_id', organizationId)
          .maybeSingle()
        if (unlinkedErr) {
          console.error(`[client-auth] unlinked lookup error ${logCtx}:`, unlinkedErr.message)
          return jsonError(500, 'Error consultando cliente', 'CLIENT_LOOKUP_FAILED')
        }

        if (unlinkedClient) {
          const { error: linkErr } = await adminClient
            .from('clients')
            .update({ auth_user_id: authUserId, last_login_at: new Date().toISOString() })
            .eq('id', unlinkedClient.id)
          if (linkErr) {
            console.error(`[client-auth] link existing client error ${logCtx} client=${unlinkedClient.id}:`, linkErr.message)
            return jsonError(500, 'Error vinculando cuenta', 'LINK_FAILED')
          }
          clientId = unlinkedClient.id
        } else {
          // Cliente nuevo en esta org
          const { data: newClient, error: insertErr } = await adminClient
            .from('clients')
            .insert({
              phone: normalizedPhone,
              name: name || normalizedPhone,
              auth_user_id: authUserId,
              organization_id: organizationId,
            })
            .select('id')
            .single()
          if (insertErr || !newClient) {
            console.error(`[client-auth] insert client (race path) error ${logCtx}:`, insertErr?.message)
            return jsonError(500, 'Error creando cliente', 'CLIENT_INSERT_FAILED')
          }
          clientId = newClient.id
          isNewClient = true
        }

        // Asegurar app_metadata correcto
        const { error: metaErr } = await adminClient.auth.admin.updateUserById(authUserId, {
          app_metadata: { organization_id: organizationId },
        })
        if (metaErr) {
          console.error(`[client-auth] app_metadata update error ${logCtx} auth=${authUserId}:`, metaErr.message)
          // No fatal — el cliente puede operar y el metadata se reasigna en próximo login
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

      console.error(`[client-auth] createUser unhandled error ${logCtx}:`, createError.message)
      throw createError
    }

    authUserId = newUser.user!.id

    // Crear o actualizar cliente vinculando auth_user_id
    if (existingClient) {
      const { error: linkErr } = await adminClient
        .from('clients')
        .update({
          auth_user_id: authUserId,
          last_login_at: new Date().toISOString()
        })
        .eq('id', existingClient.id)
      if (linkErr) {
        console.error(`[client-auth] link client error ${logCtx} client=${existingClient.id}:`, linkErr.message)
        // Rollback: borrar el auth user creado
        const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(authUserId)
        if (rollbackErr) {
          console.error(`[client-auth] ROLLBACK FAILED ${logCtx} auth=${authUserId}:`, rollbackErr.message)
        }
        return jsonError(500, 'Error vinculando cliente', 'LINK_FAILED')
      }
      clientId = existingClient.id
    } else {
      const { data: newClientData, error: clientError } = await adminClient
        .from('clients')
        .insert({
          phone:           normalizedPhone,
          name:            name || normalizedPhone,
          auth_user_id:    authUserId,
          organization_id: organizationId,
        })
        .select('id')
        .single()

      if (clientError || !newClientData) {
        console.error(`[client-auth] insert new client error ${logCtx}:`, clientError?.message)
        // Rollback: eliminar usuario auth creado
        const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(authUserId)
        if (rollbackErr) {
          console.error(`[client-auth] ROLLBACK FAILED ${logCtx} auth=${authUserId}:`, rollbackErr.message)
        }
        return jsonError(500, 'Error creando cliente', 'CLIENT_INSERT_FAILED')
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
      console.error(`[client-auth] post-create signin error ${logCtx}:`, sessionError?.message)
      return jsonError(500, 'No se pudo obtener sesión tras registro', 'SIGNIN_AFTER_CREATE_FAILED')
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

  } catch (err: any) {
    console.error('[client-auth] unhandled error:', err?.message ?? err)
    return jsonError(500, 'Error interno del servidor')
  }
})
