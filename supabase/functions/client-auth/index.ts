/**
 * Edge Function: client-auth (v2 — OTP por WhatsApp)
 *
 * Login de clientes de la app mobile. Contrato completo en CONTRACTS.md §2;
 * esquema de la tabla `client_otp_challenges` en la migración 191.
 *
 * Dos acciones, un solo endpoint (`POST`, `apikey: <anon>`, sin JWT):
 *
 *   `start`  → si el dispositivo ya es conocido (su `device_secret` sigue
 *              siendo la password del usuario de Auth) devuelve la sesión sin
 *              mandar nada. Si no, genera un código de 6 dígitos, guarda SÓLO
 *              su hash y lo manda por WhatsApp con un template AUTHENTICATION.
 *   `verify` → valida el código (máx. 5 intentos, 10 minutos), crea o vincula
 *              el cliente y el usuario de Auth, fija la password al
 *              `device_secret` de ESTE dispositivo y devuelve la sesión.
 *
 * Lo que cambió respecto de la v1 y NO hay que deshacer:
 *   - NUNCA se resetea la password sin un código verificado. La v1 lo hacía
 *     ante cualquier mismatch del `device_secret`, así que cualquiera que
 *     supiera un teléfono entraba como ese cliente con un `curl`.
 *   - `app_metadata` lleva `{ user_type: 'client', client_id, organization_id: null }`.
 *     Un JWT de cliente NO tiene `organization_id`: `get_user_org_id()` devuelve
 *     NULL y las policies org-wide del staff no lo alcanzan (mig 192).
 *   - El cliente se busca por últimos 10 dígitos (`find_client_id_by_phone`),
 *     igual que el check-in y el turnero. El match exacto de la v1 duplicaba
 *     clientes cuando el teléfono estaba guardado con otro formato.
 *   - Rate-limit por teléfono (3/10 min) y por IP (10/h) con la RPC
 *     `check_rate_limit`, la misma que usa el dashboard.
 *
 * Secrets (además de los que inyecta Supabase):
 *   OTP_PEPPER            pepper del hash del código (si falta: 32 chars de la service key)
 *   AUTH_TEST_PHONES      `national10=code,...` — números que NO reciben WhatsApp y
 *                         aceptan un código fijo (reviewer de Apple/Google, tests)
 *   AUTH_WA_TEMPLATE      nombre del template AUTHENTICATION (default monaco_codigo_acceso)
 *   AUTH_WA_TEMPLATE_LANG idioma REGISTRADO en Meta para ese template (default es)
 *
 * Deploy: supabase functions deploy client-auth --no-verify-jwt
 */

import { createClient, type SupabaseClient, type Session, type User } from 'https://esm.sh/@supabase/supabase-js@2'
import { json, preflight } from '../_shared/cors.ts'
import {
  nombreEsPlaceholder,
  normalizarTelefonoAR,
  phoneTail,
  primerNombre,
  type TelefonoNormalizado,
} from '../_shared/phone.ts'
import {
  generarCodigoOtp,
  hashCodigoOtp,
  igualesEnTiempoConstante,
  limpiarCodigoOtp,
} from '../_shared/otp.ts'
import { componentesOtp, describirErrorMeta, sendTemplate } from '../_shared/meta-wa.ts'

// ── Configuración ───────────────────────────────────────────────────────────

// Va primero: lo usa `parseTestPhones` durante la inicialización del módulo.
const LOG = '[client-auth]'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// El sign-in se hace con la anon key: es el mismo endpoint que usaría la app,
// y así el cliente que firma sesiones nunca es el que tiene la service role.
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || SERVICE_ROLE_KEY
const OTP_PEPPER = Deno.env.get('OTP_PEPPER') || SERVICE_ROLE_KEY.slice(0, 32)
const WA_TEMPLATE = Deno.env.get('AUTH_WA_TEMPLATE') || 'monaco_codigo_acceso'
const WA_TEMPLATE_LANG = Deno.env.get('AUTH_WA_TEMPLATE_LANG') || 'es'
const TEST_PHONES = parseTestPhones(Deno.env.get('AUTH_TEST_PHONES'))

const EMAIL_DOMAIN = 'monaco.internal'
const OTP_TTL_SECONDS = 600
const OTP_RESEND_SECONDS = 45
const OTP_MAX_ATTEMPTS = 5
const META_TIMEOUT_MS = 10_000
const RL_PHONE = { bucket: 'client_otp_phone', limit: 3, window: 600 }
const RL_IP = { bucket: 'client_otp_ip', limit: 10, window: 3600 }
const DEVICE_SECRET_MIN = 32
const DEVICE_SECRET_MAX = 256
const DEVICE_ID_MAX = 128
const NAME_MIN = 2
const NAME_MAX = 80
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Tipos ───────────────────────────────────────────────────────────────────

type Action = 'start' | 'verify'

interface ReqBody {
  action: Action
  phone: string
  device_id: string
  device_secret: string
  org_id: string
  code?: string
  name?: string
}

interface ClienteRow {
  id: string
  name: string
  auth_user_id: string | null
  phone: string
}

interface DesafioRow {
  id: string
  code_hash: string
  attempts: number
  expires_at: string
}

interface Ctx {
  /** Service role: base + admin de Auth. NUNCA hace sign-in (si lo hiciera, `from()` pasaría a correr como el cliente). */
  admin: SupabaseClient
  /** Anon key: sólo `signInWithPassword`. */
  auth: SupabaseClient
  orgId: string
  tel: TelefonoNormalizado
  tail: string
  deviceId: string
  deviceSecret: string
  ip: string
  /** Contexto corto para los logs (sin datos sensibles de más). */
  log: string
}

type AuthUserListo = { email: string; userId: string }

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return fail(405, 'BAD_REQUEST', 'Método no permitido.')

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(LOG, 'faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno')
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return fail(400, 'BAD_REQUEST', 'El cuerpo tiene que ser JSON.')
  }

  const parsed = validarBody(raw)
  if (!parsed.ok) return parsed.res
  const body = parsed.body

  const tel = normalizarTelefonoAR(body.phone)
  if (!tel) return fail(400, 'INVALID_PHONE', 'Ingresá un número de teléfono válido.')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const auth = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const tail = phoneTail(tel.whatsapp)
  const ctx: Ctx = {
    admin,
    auth,
    orgId: body.org_id,
    tel,
    tail,
    deviceId: body.device_id,
    deviceSecret: body.device_secret,
    ip: obtenerIp(req),
    log: `action=${body.action} org=${body.org_id.slice(0, 8)} tail=${tail} dev=${body.device_id.slice(0, 8)}`,
  }

  try {
    const orgError = await verificarOrganizacion(ctx)
    if (orgError) return orgError

    return body.action === 'start'
      ? await handleStart(ctx)
      : await handleVerify(ctx, body)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(LOG, 'error no controlado', ctx.log, msg)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
})

// ── start ───────────────────────────────────────────────────────────────────

async function handleStart(ctx: Ctx): Promise<Response> {
  const cliente = await buscarCliente(ctx)
  if (cliente instanceof Response) return cliente

  // 1. Login silencioso: dispositivo conocido → sesión sin mandar nada.
  //    Si falla, NO se toca la password: se sigue a OTP.
  if (cliente?.auth_user_id) {
    const sesion = await loginSilencioso(ctx, cliente)
    if (sesion) return responderSesion(ctx, sesion, cliente, false)
  }

  // 2. Rate-limit (por teléfono y por IP) antes de generar nada.
  const limitado = await chequearRateLimits(ctx)
  if (limitado) return limitado

  // 3. Código: fijo para los teléfonos de prueba, aleatorio para el resto.
  const codigoFijo = codigoDePrueba(ctx.tel)
  const code = codigoFijo ?? generarCodigoOtp()
  const codeHash = await hashCodigoOtp(code, OTP_PEPPER)
  const ahora = new Date()

  // 4. Invalidar desafíos previos del mismo (org, teléfono, dispositivo).
  //    No es fatal si falla: verify toma siempre el más reciente.
  const { error: invErr } = await ctx.admin
    .from('client_otp_challenges')
    .update({ consumed_at: ahora.toISOString() })
    .eq('organization_id', ctx.orgId)
    .eq('phone_tail', ctx.tail)
    .eq('device_id', ctx.deviceId)
    .is('consumed_at', null)
  if (invErr) console.error(LOG, 'no se pudieron invalidar desafíos previos', ctx.log, invErr.message)

  const { data: desafio, error: insErr } = await ctx.admin
    .from('client_otp_challenges')
    .insert({
      organization_id: ctx.orgId,
      phone_e164: ctx.tel.e164,
      phone_tail: ctx.tail,
      device_id: ctx.deviceId,
      code_hash: codeHash,
      attempts: 0,
      expires_at: new Date(ahora.getTime() + OTP_TTL_SECONDS * 1000).toISOString(),
      ip: ctx.ip,
    })
    .select('id')
    .single()
  if (insErr || !desafio) {
    console.error(LOG, 'insert client_otp_challenges falló', ctx.log, insErr?.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos generar el código. Probá de nuevo.')
  }

  // 5. Envío por WhatsApp. Si Meta rechaza, el desafío no sirve: se borra.
  if (codigoFijo) {
    console.log(LOG, 'teléfono de prueba: no se envía WhatsApp', ctx.log)
  } else {
    const enviado = await enviarCodigoPorWhatsApp(ctx, code)
    if (!enviado) {
      const { error: delErr } = await ctx.admin.from('client_otp_challenges').delete().eq('id', desafio.id)
      if (delErr) console.error(LOG, 'no se pudo borrar el desafío tras fallo de envío', ctx.log, delErr.message)
      return fail(502, 'OTP_DELIVERY_FAILED', 'No pudimos mandarte el código por WhatsApp. Probá de nuevo en un rato.')
    }
  }

  return json({
    status: 'otp_sent',
    phone_masked: ctx.tel.masked,
    expires_in: OTP_TTL_SECONDS,
    resend_in: OTP_RESEND_SECONDS,
    client_known: !!cliente,
    first_name: primerNombre(cliente?.name),
  })
}

// ── verify ──────────────────────────────────────────────────────────────────

async function handleVerify(ctx: Ctx, body: ReqBody): Promise<Response> {
  // `validarBody` ya lo dejó en 6 dígitos; el chequeo acá es defensivo.
  const code = limpiarCodigoOtp(body.code)
  if (!code) return fail(400, 'BAD_REQUEST', 'El código tiene que tener 6 dígitos.')

  // 1. Desafío pendiente más reciente para (org, teléfono, dispositivo).
  const { data: desafio, error: selErr } = await ctx.admin
    .from('client_otp_challenges')
    .select('id, code_hash, attempts, expires_at')
    .eq('organization_id', ctx.orgId)
    .eq('phone_tail', ctx.tail)
    .eq('device_id', ctx.deviceId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DesafioRow>()
  if (selErr) {
    console.error(LOG, 'select client_otp_challenges falló', ctx.log, selErr.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos validar el código. Probá de nuevo.')
  }
  if (!desafio) {
    return fail(404, 'OTP_NOT_FOUND', 'No encontramos un código vigente para este número. Pedí uno nuevo.')
  }

  if (new Date(desafio.expires_at).getTime() <= Date.now()) {
    await consumirDesafio(ctx, desafio.id)
    return fail(410, 'OTP_EXPIRED', 'El código venció. Pedí uno nuevo.')
  }

  if (desafio.attempts >= OTP_MAX_ATTEMPTS) {
    return fail(429, 'RATE_LIMITED', 'Demasiados intentos con este código. Pedí uno nuevo.', {
      retry_in: segundosHasta(desafio.expires_at),
    })
  }

  // 2. Comparación en tiempo constante del hash.
  const hash = await hashCodigoOtp(code, OTP_PEPPER)
  if (!igualesEnTiempoConstante(hash, desafio.code_hash)) {
    const attempts = desafio.attempts + 1
    const { error: upErr } = await ctx.admin
      .from('client_otp_challenges')
      .update({ attempts })
      .eq('id', desafio.id)
    if (upErr) console.error(LOG, 'no se pudo incrementar attempts', ctx.log, upErr.message)
    const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts)
    return fail(
      401,
      'OTP_INVALID',
      left > 0
        ? `Código incorrecto. Te queda${left === 1 ? '' : 'n'} ${left} intento${left === 1 ? '' : 's'}.`
        : 'Código incorrecto. Pedí un código nuevo.',
      { attempts_left: left },
    )
  }

  // 3. Código correcto. Antes de consumirlo, resolvemos al cliente: si es
  //    nuevo y no vino el nombre, el código sigue vigente para que la app lo
  //    pida y reintente sin obligar a un segundo OTP.
  let cliente = await buscarCliente(ctx)
  if (cliente instanceof Response) return cliente
  const nombre = limpiarNombre(body.name)
  if (!cliente && !nombre) {
    return fail(400, 'NAME_REQUIRED', 'Decinos tu nombre para crear tu cuenta.')
  }

  const { data: consumido, error: conErr } = await ctx.admin
    .from('client_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', desafio.id)
    .is('consumed_at', null)
    .select('id')
  if (conErr) {
    console.error(LOG, 'no se pudo consumir el desafío', ctx.log, conErr.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos validar el código. Probá de nuevo.')
  }
  if (!consumido || consumido.length === 0) {
    // Otro request lo consumió entre el select y el update (doble tap).
    return fail(404, 'OTP_NOT_FOUND', 'No encontramos un código vigente para este número. Pedí uno nuevo.')
  }

  // 4. Find-or-create del cliente.
  let esNuevo = false
  if (!cliente) {
    const { data: creado, error: insErr } = await ctx.admin
      .from('clients')
      .insert({
        organization_id: ctx.orgId,
        phone: ctx.tel.national10 ?? ctx.tel.e164,
        name: nombre,
      })
      .select('id, name, auth_user_id, phone')
      .single<ClienteRow>()
    if (insErr || !creado) {
      if (insErr?.code === '23505') {
        // Carrera con otro alta del mismo teléfono (kiosko, dashboard): lo tomamos.
        const otraVez = await buscarCliente(ctx)
        if (otraVez instanceof Response) return otraVez
        cliente = otraVez
      }
      if (!cliente) {
        console.error(LOG, 'insert clients falló', ctx.log, insErr?.code, insErr?.message)
        return fail(500, 'AUTH_FAILED', 'No pudimos crear tu cuenta. Probá de nuevo.')
      }
    } else {
      cliente = creado
      esNuevo = true
    }
  } else if (nombre && nombreEsPlaceholder(cliente.name)) {
    // Cliente existente sin nombre real (alta por teléfono, "Sin nombre", etc.):
    // adoptamos el que mandó. Si ya tenía nombre, no se toca.
    const { error: nomErr } = await ctx.admin.from('clients').update({ name: nombre }).eq('id', cliente.id)
    if (nomErr) console.error(LOG, 'no se pudo actualizar el nombre', ctx.log, nomErr.message)
    else cliente = { ...cliente, name: nombre }
  }

  // 5. Usuario de Auth: password = device_secret de ESTE dispositivo.
  const authUser = await asegurarAuthUser(ctx, cliente)
  if (authUser instanceof Response) return authUser

  // 6. Sesión.
  const { data: signIn, error: signErr } = await ctx.auth.auth.signInWithPassword({
    email: authUser.email,
    password: ctx.deviceSecret,
  })
  if (signErr || !signIn.session) {
    console.error(LOG, 'signInWithPassword post-verify falló', ctx.log, signErr?.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }

  return responderSesion(ctx, signIn.session, cliente, esNuevo)
}

// ── Piezas ──────────────────────────────────────────────────────────────────

/** 404 ORG_NOT_FOUND si la org no existe o está inactiva; `null` si está bien. */
async function verificarOrganizacion(ctx: Ctx): Promise<Response | null> {
  const { data, error } = await ctx.admin
    .from('organizations')
    .select('id')
    .eq('id', ctx.orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    console.error(LOG, 'select organizations falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  if (!data) return fail(404, 'ORG_NOT_FOUND', 'La barbería no está disponible.')
  return null
}

/**
 * Cliente de la org con ese teléfono (últimos 10 dígitos, vía
 * `find_client_id_by_phone`, service role). `null` si no existe; `Response`
 * 500 si la base falló.
 */
async function buscarCliente(ctx: Ctx): Promise<ClienteRow | null | Response> {
  const { data: clientId, error: rpcErr } = await ctx.admin.rpc('find_client_id_by_phone', {
    p_org: ctx.orgId,
    p_phone: ctx.tel.national10 ?? ctx.tel.e164,
  })
  if (rpcErr) {
    console.error(LOG, 'find_client_id_by_phone falló', ctx.log, rpcErr.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  if (!clientId) return null

  const { data, error } = await ctx.admin
    .from('clients')
    .select('id, name, auth_user_id, phone')
    .eq('id', clientId as string)
    .maybeSingle<ClienteRow>()
  if (error) {
    console.error(LOG, 'select clients falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  return data ?? null
}

/**
 * Intenta la sesión con la password actual del usuario de Auth (el
 * `device_secret` del último dispositivo verificado). Devuelve la sesión o
 * `null`. NUNCA modifica la password.
 */
async function loginSilencioso(ctx: Ctx, cliente: ClienteRow): Promise<Session | null> {
  if (!cliente.auth_user_id) return null
  const { data, error } = await ctx.admin.auth.admin.getUserById(cliente.auth_user_id)
  if (error || !data.user?.email) {
    // El auth user ya no existe (cuenta borrada sin limpiar clients, etc.): a OTP.
    console.warn(LOG, 'getUserById sin resultado en login silencioso', ctx.log, error?.message)
    return null
  }

  // Self-healing de los claims: si este usuario viene de la v1 (tenía
  // organization_id y no user_type) se corrigen ANTES de firmar la sesión,
  // así el JWT que devolvemos ya sale con los claims correctos.
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>
  if (meta.user_type !== 'client' || meta.client_id !== cliente.id || meta.organization_id != null) {
    const { error: metaErr } = await ctx.admin.auth.admin.updateUserById(data.user.id, {
      app_metadata: appMetadataCliente(cliente.id),
    })
    if (metaErr) console.error(LOG, 'no se pudo corregir app_metadata', ctx.log, metaErr.message)
  }

  const { data: signIn, error: signErr } = await ctx.auth.auth.signInWithPassword({
    email: data.user.email,
    password: ctx.deviceSecret,
  })
  if (signErr || !signIn.session) return null // dispositivo nuevo: camino normal a OTP
  return signIn.session
}

/** 429 RATE_LIMITED si algún bucket está lleno; `null` si se puede seguir. */
async function chequearRateLimits(ctx: Ctx): Promise<Response | null> {
  const porTelefono = await rateLimit(ctx, RL_PHONE.bucket, `${ctx.orgId}:${ctx.tel.national10 ?? ctx.tel.e164}`, RL_PHONE)
  if (!porTelefono.allowed) {
    return fail(429, 'RATE_LIMITED', 'Ya te mandamos varios códigos. Esperá unos minutos y volvé a intentar.', {
      retry_in: porTelefono.retryIn,
    })
  }
  const porIp = await rateLimit(ctx, RL_IP.bucket, ctx.ip, RL_IP)
  if (!porIp.allowed) {
    return fail(429, 'RATE_LIMITED', 'Demasiados intentos desde esta conexión. Probá más tarde.', {
      retry_in: porIp.retryIn,
    })
  }
  return null
}

/** Envoltorio de la RPC `check_rate_limit`. Fail-open si la RPC falla (con log). */
async function rateLimit(
  ctx: Ctx,
  bucket: string,
  key: string,
  opts: { limit: number; window: number },
): Promise<{ allowed: boolean; retryIn: number }> {
  const { data, error } = await ctx.admin.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.window,
  })
  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; reset_at: string } | undefined) : undefined
  if (error || !row) {
    console.error(LOG, `check_rate_limit(${bucket}) falló, fail-open`, ctx.log, error?.message)
    return { allowed: true, retryIn: 0 }
  }
  return { allowed: !!row.allowed, retryIn: segundosHasta(row.reset_at) }
}

/** `true` si el WhatsApp salió; `false` (ya logueado) si no hay config o Meta rechazó. */
async function enviarCodigoPorWhatsApp(ctx: Ctx, code: string): Promise<boolean> {
  const { data: cfg, error } = await ctx.admin
    .from('organization_whatsapp_config')
    .select('whatsapp_access_token, whatsapp_phone_id')
    .eq('organization_id', ctx.orgId)
    .eq('is_active', true)
    .maybeSingle<{ whatsapp_access_token: string | null; whatsapp_phone_id: string | null }>()
  if (error) {
    console.error(LOG, 'select organization_whatsapp_config falló', ctx.log, error.message)
    return false
  }
  if (!cfg?.whatsapp_access_token || !cfg.whatsapp_phone_id) {
    console.error(LOG, 'la organización no tiene config de WhatsApp activa', ctx.log)
    return false
  }

  const r = await sendTemplate({
    accessToken: cfg.whatsapp_access_token,
    phoneId: cfg.whatsapp_phone_id,
    to: ctx.tel.whatsapp,
    templateName: WA_TEMPLATE,
    language: WA_TEMPLATE_LANG,
    components: componentesOtp(code),
    timeoutMs: META_TIMEOUT_MS,
  })
  if (!r.ok) {
    console.error(
      LOG,
      `Meta rechazó el OTP (template=${WA_TEMPLATE} lang=${WA_TEMPLATE_LANG})`,
      ctx.log,
      describirErrorMeta(r.error),
      'raw=' + safeJson(r.error.raw),
    )
    return false
  }
  console.log(LOG, 'OTP enviado', ctx.log, `wamid=${r.messageId}`)
  return true
}

/**
 * Deja al cliente con un usuario de Auth cuya password es el `device_secret`
 * de este dispositivo y cuyo `app_metadata` es el de cliente. Devuelve el
 * email con el que hay que firmar la sesión.
 *
 * Caminos:
 *  a) `clients.auth_user_id` ya apunta a un usuario vivo → update password + metadata.
 *  b) no hay usuario → `createUser` con el alias `${national10 ?? e164sinmás}@monaco.internal`.
 *  c) el alias ya existe en Auth:
 *     - si no está vinculado a OTRO cliente → se adopta (password + metadata + vínculo);
 *     - si sí lo está → se intenta el alias secundario `${e164sinmás}@…`;
 *       si también está tomado → 409 CONFLICT.
 */
async function asegurarAuthUser(ctx: Ctx, cliente: ClienteRow): Promise<AuthUserListo | Response> {
  const appMeta = appMetadataCliente(cliente.id)

  // a) Usuario ya vinculado.
  if (cliente.auth_user_id) {
    const { data, error } = await ctx.admin.auth.admin.updateUserById(cliente.auth_user_id, {
      password: ctx.deviceSecret,
      app_metadata: appMeta,
    })
    if (!error && data.user?.email) {
      return { email: data.user.email, userId: data.user.id }
    }
    if (!esUserNotFound(error)) {
      console.error(LOG, 'updateUserById falló', ctx.log, `uid=${cliente.auth_user_id}`, error?.message)
      return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
    }
    // El usuario de Auth desapareció: seguimos como si nunca hubiera existido.
    console.warn(LOG, 'clients.auth_user_id apunta a un usuario inexistente; se recrea', ctx.log)
  }

  // b) / c) Crear o adoptar.
  const e164SinMas = ctx.tel.e164.replace(/^\+/, '')
  const aliases = unicos([
    `${ctx.tel.national10 ?? e164SinMas}@${EMAIL_DOMAIN}`,
    `${e164SinMas}@${EMAIL_DOMAIN}`,
  ])

  for (const email of aliases) {
    const { data: creado, error: createErr } = await ctx.admin.auth.admin.createUser({
      email,
      password: ctx.deviceSecret,
      email_confirm: true,
      app_metadata: appMeta,
    })

    if (!createErr && creado.user) {
      const linkErr = await vincularAuthUser(ctx, cliente.id, creado.user.id)
      if (linkErr) {
        // Rollback: sin vínculo, el usuario quedaría huérfano y el alias tomado.
        const { error: delErr } = await ctx.admin.auth.admin.deleteUser(creado.user.id)
        if (delErr) console.error(LOG, 'ROLLBACK deleteUser falló', ctx.log, `uid=${creado.user.id}`, delErr.message)
        return fail(500, 'AUTH_FAILED', 'No pudimos crear tu cuenta. Probá de nuevo.')
      }
      return { email, userId: creado.user.id }
    }

    if (!esEmailExistente(createErr)) {
      console.error(LOG, 'createUser falló', ctx.log, `email=${email}`, createErr?.message)
      return fail(500, 'AUTH_FAILED', 'No pudimos crear tu cuenta. Probá de nuevo.')
    }

    // El alias ya existe en Auth: ¿de quién es?
    const existente = await buscarAuthUserPorEmail(ctx, email)
    if (!existente) {
      console.error(LOG, 'el alias existe en Auth pero no se pudo recuperar el usuario', ctx.log, `email=${email}`)
      continue
    }
    const { data: dueno, error: duenoErr } = await ctx.admin
      .from('clients')
      .select('id')
      .eq('auth_user_id', existente.id)
      .neq('id', cliente.id)
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (duenoErr) {
      console.error(LOG, 'select clients por auth_user_id falló', ctx.log, duenoErr.message)
      return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
    }
    if (dueno) {
      console.warn(LOG, 'alias tomado por otro cliente, se prueba el siguiente', ctx.log, `email=${email} otro=${dueno.id}`)
      continue
    }

    // Huérfano o de este mismo cliente: lo adoptamos.
    const { error: updErr } = await ctx.admin.auth.admin.updateUserById(existente.id, {
      password: ctx.deviceSecret,
      app_metadata: appMeta,
    })
    if (updErr) {
      console.error(LOG, 'updateUserById (adopción) falló', ctx.log, `uid=${existente.id}`, updErr.message)
      return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
    }
    const linkErr = await vincularAuthUser(ctx, cliente.id, existente.id)
    if (linkErr) return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
    return { email, userId: existente.id }
  }

  console.error(LOG, 'todos los alias de email están tomados por otros clientes', ctx.log)
  return fail(409, 'CONFLICT', 'Este número ya está asociado a otra cuenta. Escribinos para resolverlo.')
}

/** `clients.auth_user_id = uid`. Devuelve el mensaje de error o `null`. */
async function vincularAuthUser(ctx: Ctx, clienteId: string, uid: string): Promise<string | null> {
  const { error } = await ctx.admin.from('clients').update({ auth_user_id: uid }).eq('id', clienteId)
  if (error) {
    console.error(LOG, 'update clients.auth_user_id falló', ctx.log, `client=${clienteId} uid=${uid}`, error.message)
    return error.message
  }
  return null
}

/**
 * Busca un usuario de Auth por email exacto. Primero con el `filter` del
 * endpoint admin (el que usa el Studio para buscar); si no está o el
 * endpoint no lo soporta, pagina `listUsers`. Siempre se verifica el email
 * exacto sobre lo que vuelve, así un `filter` ignorado no da falsos positivos.
 */
async function buscarAuthUserPorEmail(ctx: Ctx, email: string): Promise<User | null> {
  const objetivo = email.toLowerCase()
  try {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50&filter=${encodeURIComponent(email)}`
    const res = await fetch(url, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    if (res.ok) {
      const body = (await res.json()) as { users?: User[] }
      const match = (body.users ?? []).find((u) => (u.email ?? '').toLowerCase() === objetivo)
      if (match) return match
    }
  } catch (e: unknown) {
    console.warn(LOG, 'admin/users?filter falló, se pagina', ctx.log, e instanceof Error ? e.message : String(e))
  }

  const PER_PAGE = 1000
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await ctx.admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) {
      console.error(LOG, 'listUsers falló', ctx.log, error.message)
      return null
    }
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === objetivo)
    if (match) return match
    if (data.users.length < PER_PAGE) break
  }
  return null
}

/** Respuesta `status: 'ok'` + `last_login_at` (no fatal). */
async function responderSesion(ctx: Ctx, sesion: Session, cliente: ClienteRow, esNuevo: boolean): Promise<Response> {
  const { error } = await ctx.admin
    .from('clients')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', cliente.id)
  if (error) console.error(LOG, 'update last_login_at falló', ctx.log, error.message)

  return json({
    status: 'ok',
    access_token: sesion.access_token,
    refresh_token: sesion.refresh_token,
    client_id: cliente.id,
    name: nombreEsPlaceholder(cliente.name) ? '' : cliente.name,
    is_new_client: esNuevo,
    phone: ctx.tel.national10 ?? ctx.tel.e164,
  })
}

async function consumirDesafio(ctx: Ctx, id: string): Promise<void> {
  const { error } = await ctx.admin
    .from('client_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', id)
    .is('consumed_at', null)
  if (error) console.error(LOG, 'no se pudo consumir el desafío', ctx.log, error.message)
}

// ── Validación y utilidades ─────────────────────────────────────────────────

function validarBody(raw: unknown): { ok: true; body: ReqBody } | { ok: false; res: Response } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'El cuerpo tiene que ser un objeto JSON.') }
  }
  const b = raw as Record<string, unknown>

  const action = b.action
  if (action !== 'start' && action !== 'verify') {
    return { ok: false, res: fail(400, 'BAD_REQUEST', "action tiene que ser 'start' o 'verify'.") }
  }
  if (typeof b.phone !== 'string' || !b.phone.trim()) {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'Falta el teléfono.') }
  }
  if (typeof b.device_id !== 'string' || !b.device_id.trim() || b.device_id.length > DEVICE_ID_MAX) {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'device_id inválido.') }
  }
  if (
    typeof b.device_secret !== 'string' ||
    b.device_secret.length < DEVICE_SECRET_MIN ||
    b.device_secret.length > DEVICE_SECRET_MAX
  ) {
    return { ok: false, res: fail(400, 'BAD_REQUEST', `device_secret tiene que tener entre ${DEVICE_SECRET_MIN} y ${DEVICE_SECRET_MAX} caracteres.`) }
  }
  if (typeof b.org_id !== 'string' || !UUID_RE.test(b.org_id.trim())) {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'org_id inválido.') }
  }
  let code: string | undefined
  if (action === 'verify') {
    if (typeof b.code !== 'string') {
      return { ok: false, res: fail(400, 'BAD_REQUEST', 'Falta el código.') }
    }
    const limpio = limpiarCodigoOtp(b.code)
    if (!limpio) {
      return { ok: false, res: fail(400, 'BAD_REQUEST', 'El código tiene que tener 6 dígitos.') }
    }
    code = limpio
  }
  if (b.name !== undefined && b.name !== null && typeof b.name !== 'string') {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'name inválido.') }
  }

  return {
    ok: true,
    body: {
      action,
      phone: b.phone,
      device_id: b.device_id.trim(),
      device_secret: b.device_secret,
      org_id: b.org_id.trim().toLowerCase(),
      code,
      name: typeof b.name === 'string' ? b.name : undefined,
    },
  }
}

/** Nombre limpio (2..80 chars, espacios colapsados) o `null` si no sirve. */
function limpiarNombre(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const n = name.trim().replace(/\s+/g, ' ')
  if (n.length < NAME_MIN || n.length > NAME_MAX) return null
  if (nombreEsPlaceholder(n)) return null
  return n
}

function appMetadataCliente(clientId: string): Record<string, unknown> {
  // `organization_id: null` BORRA la clave en GoTrue (merge con null = delete):
  // un JWT de cliente no debe llevar organización (CONTRACTS.md §0.5).
  return { user_type: 'client', client_id: clientId, organization_id: null }
}

/** `AUTH_TEST_PHONES="1100000000=123456,1100000001=654321"` → Map(dígitos → código). */
function parseTestPhones(env: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!env) return map
  for (const par of env.split(',')) {
    const [tel, code] = par.split('=').map((s) => (s ?? '').trim())
    const digitos = (tel ?? '').replace(/\D/g, '')
    if (digitos.length >= 8 && /^\d{6}$/.test(code ?? '')) map.set(digitos, code)
    else if (par.trim()) console.warn(LOG, `AUTH_TEST_PHONES: entrada ignorada "${par.trim()}"`)
  }
  return map
}

/** Código fijo si el teléfono está en `AUTH_TEST_PHONES`; si no, `null`. */
function codigoDePrueba(tel: TelefonoNormalizado): string | null {
  if (TEST_PHONES.size === 0) return null
  const candidatos = [tel.national10, tel.whatsapp, tel.e164.replace(/^\+/, '')].filter(
    (x): x is string => !!x,
  )
  for (const c of candidatos) {
    const code = TEST_PHONES.get(c)
    if (code) return code
  }
  return null
}

function obtenerIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  const primero = xff?.split(',')[0]?.trim()
  return primero || req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function segundosHasta(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 1000))
}

function esEmailExistente(err: { code?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'email_exists') return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('already been registered') || m.includes('already registered') || m.includes('already exists')
}

function esUserNotFound(err: { code?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'user_not_found') return true
  if (err.status === 404) return true
  return (err.message ?? '').toLowerCase().includes('not found')
}

function unicos(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Error con la forma del contrato: `{ error: CODE, message, ...extra }`. */
function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, message, ...extra }, status)
}
