/**
 * Edge Function: client-auth (v3 — OTP por WhatsApp + alta propia con Google/Apple)
 *
 * Login y alta de clientes de la app mobile. Contrato completo en el README de
 * esta carpeta; `client_otp_challenges` en la migración 191,
 * `client_social_identities` / `organizations.allow_client_signup` en la 210.
 *
 * Tres acciones, un solo endpoint (`POST`, `apikey: <anon>`, sin JWT):
 *
 *   `social` → verifica el `id_token` de Google/Apple CONTRA EL PROVEEDOR. Si esa
 *              identidad ya está vinculada a un cliente, devuelve la sesión sin
 *              código ni WhatsApp (el login de un toque). Si no, no crea nada:
 *              devuelve `need_phone` + un `signup_token` de 15 minutos.
 *   `start`  → si el dispositivo ya es conocido (su `device_secret` sigue siendo
 *              la password del usuario de Auth) devuelve la sesión sin mandar
 *              nada. Si no, genera un código de 6 dígitos, guarda SÓLO su hash y
 *              lo manda por WhatsApp con un template AUTHENTICATION.
 *   `verify` → valida el código (máx. 5 intentos, 10 minutos), crea el cliente si
 *              hace falta y la org lo permite, vincula la identidad social si
 *              vino el `signup_token`, fija la password al `device_secret` de
 *              ESTE dispositivo y devuelve la sesión.
 *
 * LA IDENTIDAD DEL NEGOCIO SIGUE SIENDO EL TELÉFONO (mig 210). Es lo que ata la
 * cuenta con la fila del local, con WhatsApp, con los puntos y con el historial,
 * y es lo único que la tablet sabe buscar. Google y Apple son login de un toque
 * y recuperación de cuenta, NO una identidad paralela: toda cuenta nueva termina
 * con un teléfono verificado por OTP, venga de donde venga.
 *
 * Por eso el `id_token` se verifica en el SERVIDOR (`_shared/social-id-token.ts`)
 * y no con `signInWithIdToken` desde Flutter: ese camino crearía un usuario de
 * Supabase suelto —sin fila en `clients`, con JWT válido y sin
 * `app_metadata.user_type='client'`, que es de lo que depende toda la RLS de la
 * mig 192— y después habría que fusionarlo a mano con el usuario-alias del
 * teléfono. Un humano, una cuenta.
 *
 * El alta propia la habilita `organizations.allow_client_signup` (hoy sólo
 * Monaco). Con `false`, `start`/`verify` contestan el 404 CLIENT_NOT_FOUND de
 * siempre y `social` contesta 403 SIGNUP_DISABLED: ninguna otra organización de
 * esta base se abre sola.
 *
 * Lo que NO hay que deshacer:
 *   - NUNCA se resetea la password sin una prueba de identidad verificada (un
 *     código de WhatsApp, o un id_token válido del proveedor). La v1 lo hacía
 *     ante cualquier mismatch del `device_secret`, así que cualquiera que
 *     supiera un teléfono entraba como ese cliente con un `curl`.
 *   - `app_metadata` lleva `{ user_type: 'client', client_id, organization_id: null }`.
 *     Un JWT de cliente NO tiene `organization_id`: `get_user_org_id()` devuelve
 *     NULL y las policies org-wide del staff no lo alcanzan (mig 192).
 *   - El cliente se busca por últimos 10 dígitos (`find_client_id_by_phone`),
 *     igual que el check-in y el turnero. El match exacto de la v1 duplicaba
 *     clientes cuando el teléfono estaba guardado con otro formato.
 *   - Los rate-limits van ANTES del chequeo de existencia, para que no se pueda
 *     enumerar qué números son clientes a velocidad de máquina.
 *
 * Secrets (además de los que inyecta Supabase):
 *   OTP_PEPPER            pepper del hash del código (si falta: 32 chars de la service key)
 *   GOOGLE_CLIENT_IDS     client IDs de Google separados por coma (iOS, Android, Web)
 *   APPLE_BUNDLE_IDS      bundle ids de Apple separados por coma (flujo nativo)
 *   SIGNUP_TOKEN_SECRET   secreto del HMAC del `signup_token` (si falta: OTP_PEPPER)
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
import {
  parsearListaDeIds,
  verificarIdTokenSocial,
  type IdentidadSocial,
  type ProveedorSocial,
} from '../_shared/social-id-token.ts'
import { firmarSignupToken, verificarSignupToken, type SignupTokenPayload } from '../_shared/signup-token.ts'

// ── Configuración ───────────────────────────────────────────────────────────

// Va primero: lo usa `parseTestPhones` durante la inicialización del módulo.
const LOG = '[client-auth]'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// El sign-in se hace con la anon key: es el mismo endpoint que usaría la app,
// y así el cliente que firma sesiones nunca es el que tiene la service role.
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || SERVICE_ROLE_KEY
const OTP_PEPPER = Deno.env.get('OTP_PEPPER') || SERVICE_ROLE_KEY.slice(0, 32)
// Mismo criterio de fallback que el pepper: sin secreto propio, se reusa el del
// OTP. Sin ninguno de los dos la función no arranca (se chequea el entorno).
const SIGNUP_TOKEN_SECRET = Deno.env.get('SIGNUP_TOKEN_SECRET') || OTP_PEPPER
const WA_TEMPLATE = Deno.env.get('AUTH_WA_TEMPLATE') || 'monaco_codigo_acceso'
const WA_TEMPLATE_LANG = Deno.env.get('AUTH_WA_TEMPLATE_LANG') || 'es'
const TEST_PHONES = parseTestPhones(Deno.env.get('AUTH_TEST_PHONES'))
const AUDIENCIAS: Record<ProveedorSocial, string[]> = {
  google: parsearListaDeIds(Deno.env.get('GOOGLE_CLIENT_IDS')),
  apple: parsearListaDeIds(Deno.env.get('APPLE_BUNDLE_IDS')),
}

const EMAIL_DOMAIN = 'monaco.internal'
const OTP_TTL_SECONDS = 600
const OTP_RESEND_SECONDS = 45
const OTP_MAX_ATTEMPTS = 5
const SIGNUP_TOKEN_TTL_SECONDS = 900
const META_TIMEOUT_MS = 10_000
const RL_PHONE = { bucket: 'client_otp_phone', limit: 3, window: 600 }
const RL_IP = { bucket: 'client_otp_ip', limit: 10, window: 3600 }
// Tercer bucket (v3): con el alta abierta, el teléfono deja de ser un límite
// natural —antes sólo se le podía pedir código a un número que YA era cliente—,
// así que el dispositivo pasa a ser la unidad que hay que acotar.
const RL_DEVICE = { bucket: 'client_otp_device', limit: 5, window: 3600 }
// `social` no manda WhatsApp ni escribe nada, pero cada intento baja un JWKS y
// hace criptografía: se acota igual, con la mano más suelta.
const RL_SOCIAL_IP = { bucket: 'client_social_ip', limit: 30, window: 3600 }
const MSG_CLIENT_NOT_FOUND =
  'Este número todavía no está registrado como cliente. Tu cuenta se crea en tu primera visita a la barbería: registrate en la tablet del local con tu celular.'
const MSG_SOCIAL_INVALID = 'No pudimos validar tu cuenta. Probá de nuevo o entrá con tu teléfono.'
const DEVICE_SECRET_MIN = 32
const DEVICE_SECRET_MAX = 256
const DEVICE_ID_MAX = 128
const ID_TOKEN_MAX = 8192
const SIGNUP_TOKEN_MAX = 2048
const NONCE_MAX = 512
const NAME_MIN = 2
const NAME_MAX = 80
const EMAIL_MAX = 254
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Tipos ───────────────────────────────────────────────────────────────────

type Action = 'start' | 'verify' | 'social'

interface ReqBody {
  action: Action
  /** Obligatorio en `start`/`verify`; ausente en `social` (todavía no lo sabemos). */
  phone?: string
  device_id: string
  device_secret: string
  org_id: string
  code?: string
  name?: string
  /** Sólo `social`. */
  provider?: ProveedorSocial
  id_token?: string
  nonce?: string
  /** Sólo `start`/`verify`: el pase que devolvió `social`. */
  signup_token?: string
}

interface ClienteRow {
  id: string
  name: string
  auth_user_id: string | null
  phone: string
  email: string | null
  organization_id: string
}

const CLIENTE_COLS = 'id, name, auth_user_id, phone, email, organization_id'

interface DesafioRow {
  id: string
  code_hash: string
  attempts: number
  expires_at: string
}

interface IdentidadRow {
  id: string
  client_id: string
  organization_id: string
}

/** Lo que necesita cualquier acción, con o sin teléfono. */
interface CtxBase {
  /** Service role: base + admin de Auth. NUNCA hace sign-in (si lo hiciera, `from()` pasaría a correr como el cliente). */
  admin: SupabaseClient
  /** Anon key: sólo `signInWithPassword`. */
  auth: SupabaseClient
  orgId: string
  deviceId: string
  deviceSecret: string
  ip: string
  /** `organizations.allow_client_signup` de esta org (mig 210). */
  altaHabilitada: boolean
  /** Contexto corto para los logs (sin datos sensibles de más). */
  log: string
}

/** Ctx de `start`/`verify`: ahí el teléfono siempre existe. */
interface Ctx extends CtxBase {
  tel: TelefonoNormalizado
  tail: string
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

  // `social` es la única acción sin teléfono: justamente lo pide después.
  let tel: TelefonoNormalizado | null = null
  if (body.action !== 'social') {
    tel = normalizarTelefonoAR(body.phone ?? '')
    if (!tel) return fail(400, 'INVALID_PHONE', 'Ingresá un número de teléfono válido.')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const auth = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const tail = tel ? phoneTail(tel.whatsapp) : null
  const base: CtxBase = {
    admin,
    auth,
    orgId: body.org_id,
    deviceId: body.device_id,
    deviceSecret: body.device_secret,
    ip: obtenerIp(req),
    altaHabilitada: false, // lo fija `verificarOrganizacion`
    log:
      `action=${body.action} org=${body.org_id.slice(0, 8)}` +
      (tail ? ` tail=${tail}` : '') +
      (body.provider ? ` prov=${body.provider}` : '') +
      ` dev=${body.device_id.slice(0, 8)}`,
  }

  try {
    const org = await verificarOrganizacion(base)
    if (org instanceof Response) return org
    base.altaHabilitada = org.altaHabilitada

    if (body.action === 'social') return await handleSocial(base, body)

    const ctx: Ctx = { ...base, tel: tel!, tail: tail! }
    return body.action === 'start' ? await handleStart(ctx, body) : await handleVerify(ctx, body)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(LOG, 'error no controlado', base.log, msg)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
})

// ── social ──────────────────────────────────────────────────────────────────

/**
 * Entrar (o empezar a registrarse) con Google/Apple.
 *
 * Dos finales posibles y ninguno crea un cliente:
 *  - la identidad ya está vinculada → sesión, sin código y sin WhatsApp;
 *  - no lo está → `need_phone` + `signup_token`, y sigue el OTP de siempre.
 */
async function handleSocial(ctx: CtxBase, body: ReqBody): Promise<Response> {
  const provider = body.provider!
  const idToken = body.id_token!

  const limitado = await rateLimit(ctx, RL_SOCIAL_IP.bucket, ctx.ip, RL_SOCIAL_IP)
  if (!limitado.allowed) {
    return fail(429, 'RATE_LIMITED', 'Demasiados intentos desde esta conexión. Probá más tarde.', {
      retry_in: limitado.retryIn,
    })
  }

  // 1. El token, contra el proveedor. Un fallo de RED no es un token inválido:
  //    ahí contestamos 503, no 401 (decirle "tu cuenta de Google no sirve" a
  //    alguien porque Google estaba caído es el peor mensaje posible).
  const verificado = await verificarIdTokenSocial({
    provider,
    idToken,
    audiencias: AUDIENCIAS[provider],
    nonce: body.nonce ?? null,
  })
  if (!verificado.ok) {
    // El motivo va SÓLO al log: a la app no se le cuenta qué parte falló.
    console.warn(LOG, 'id_token rechazado', ctx.log, verificado.motivo)
    if (verificado.transitorio) {
      return fail(503, 'SOCIAL_VERIFY_UNAVAILABLE', 'No pudimos verificar tu cuenta en este momento. Probá de nuevo en un rato.')
    }
    return fail(401, 'SOCIAL_TOKEN_INVALID', MSG_SOCIAL_INVALID)
  }
  const identidad = verificado.identidad

  // 2. ¿Ya conocemos esta identidad? La clave es (provider, subject): el email
  //    puede cambiar, el `sub` no.
  const fila = await buscarIdentidadSocial(ctx, provider, identidad.subject)
  if (fila instanceof Response) return fila

  if (fila) {
    if (fila.organization_id !== ctx.orgId) {
      // UNIQUE(provider, subject) es global en esta base: la misma cuenta de
      // Google no puede estar en dos organizaciones. Se dice con todas las
      // letras en vez de mandarlo a un alta que va a chocar contra el índice.
      console.warn(LOG, 'identidad social de otra organización', ctx.log, `otra_org=${fila.organization_id.slice(0, 8)}`)
      return fail(409, 'SOCIAL_ALREADY_LINKED', 'Esta cuenta ya está vinculada a otra barbería. Entrá con tu teléfono.')
    }

    const cliente = await buscarClientePorId(ctx, fila.client_id)
    if (cliente instanceof Response) return cliente
    if (!cliente) {
      // No debería pasar: la FK es ON DELETE CASCADE. Si pasó, la fila quedó
      // colgada de un borrado raro: se limpia y se sigue como alta nueva.
      console.error(LOG, 'identidad social apunta a un cliente inexistente; se borra', ctx.log, `identidad=${fila.id}`)
      const { error: delErr } = await ctx.admin.from('client_social_identities').delete().eq('id', fila.id)
      if (delErr) console.error(LOG, 'no se pudo borrar la identidad huérfana', ctx.log, delErr.message)
      return await responderNeedPhone(ctx, identidad, body)
    }

    // 3. Login de un toque: el id_token verificado es prueba de identidad, así
    //    que se puede fijar la password al `device_secret` de ESTE dispositivo.
    //    Es el mismo criterio que el OTP; por eso un teléfono nuevo entra sin
    //    código en el segundo ingreso.
    const authUser = await asegurarAuthUser(ctx, cliente, null)
    if (authUser instanceof Response) return authUser

    const { data: signIn, error: signErr } = await ctx.auth.auth.signInWithPassword({
      email: authUser.email,
      password: ctx.deviceSecret,
    })
    if (signErr || !signIn.session) {
      console.error(LOG, 'signInWithPassword post-social falló', ctx.log, signErr?.message)
      return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
    }

    const { error: lastErr } = await ctx.admin
      .from('client_social_identities')
      .update({ last_login_at: new Date().toISOString(), email: identidad.email ?? null })
      .eq('id', fila.id)
    if (lastErr) console.error(LOG, 'update last_login_at de la identidad falló', ctx.log, lastErr.message)

    return responderSesion(ctx, signIn.session, cliente, false, null)
  }

  // 4. Identidad desconocida: NO se crea nada todavía. El teléfono es la
  //    identidad del negocio, así que el alta la termina el OTP.
  if (!ctx.altaHabilitada) {
    return fail(403, 'SIGNUP_DISABLED', MSG_CLIENT_NOT_FOUND)
  }
  return await responderNeedPhone(ctx, identidad, body)
}

/** `need_phone` + el `signup_token` de 15 minutos que ata el proveedor con el OTP. */
async function responderNeedPhone(ctx: CtxBase, identidad: IdentidadSocial, body: ReqBody): Promise<Response> {
  // El nombre que manda la app gana sobre el del token: en Apple el token NO
  // trae nombre nunca (llega aparte, en la credencial, y sólo en la primera
  // autorización de ese Apple ID). Si no lo guardamos ahora, no se recupera.
  const nombre = limpiarNombre(body.name) ?? limpiarNombre(identidad.name)
  const payload: SignupTokenPayload = {
    provider: identidad.provider,
    subject: identidad.subject,
    email: limpiarEmail(identidad.email),
    name: nombre,
    orgId: ctx.orgId,
  }
  const token = await firmarSignupToken(payload, SIGNUP_TOKEN_SECRET, SIGNUP_TOKEN_TTL_SECONDS)

  return json({
    status: 'need_phone',
    signup_token: token,
    expires_in: SIGNUP_TOKEN_TTL_SECONDS,
    suggested_name: nombre,
    email: payload.email,
    provider: identidad.provider,
  })
}

// ── start ───────────────────────────────────────────────────────────────────

async function handleStart(ctx: Ctx, body: ReqBody): Promise<Response> {
  const social = await resolverSignupToken(ctx, body)
  if (social instanceof Response) return social

  const cliente = await buscarCliente(ctx)
  if (cliente instanceof Response) return cliente

  // 1. Login silencioso: dispositivo conocido → sesión sin mandar nada.
  //    Si falla, NO se toca la password: se sigue a OTP.
  if (cliente?.auth_user_id) {
    const sesion = await loginSilencioso(ctx, cliente)
    if (sesion) {
      // Si venía con `signup_token`, la vinculación se hace ACÁ. Sin esto, un
      // cliente que ya se había logueado en este mismo teléfono (el
      // `device_secret` sigue siendo el mismo aunque haya cerrado sesión)
      // entraría con su Google, recibiría la sesión y la identidad NUNCA
      // quedaría guardada: la próxima vez volvería a pedirle el teléfono, para
      // siempre.
      let final = cliente
      if (social) {
        const vinculado = await aplicarIdentidadSocial(ctx, final, social)
        if (vinculado instanceof Response) return vinculado
        final = vinculado
      }
      return responderSesion(ctx, sesion, final, false, ctx.tel)
    }
  }

  // 2. Rate-limit (teléfono, IP y dispositivo) antes de generar nada. Va ANTES
  //    del chequeo de existencia: así tampoco se puede enumerar qué números son
  //    clientes a velocidad de máquina.
  //
  //    `esAlta` decide qué pasa si la RPC de rate-limit se cae. Para un cliente
  //    que YA existe seguimos fail-open (no lo dejamos afuera de su cuenta
  //    porque una tabla auxiliar hipó). Para un número que todavía no es
  //    cliente, fail-CLOSED: con el alta abierta (mig 210) este endpoint puede
  //    mandarle un WhatsApp a CUALQUIER número del mundo, y sin límites eso es
  //    un cañón de mensajes con el nombre de Monaco encima — la factura de Meta
  //    es lo de menos, lo caro es que los denuncien como spam y la WABA pierda
  //    calidad, que se lleva puesta toda la automatización del negocio.
  const limitado = await chequearRateLimits(ctx, !cliente)
  if (limitado) return limitado

  // 2b. ¿Se puede mandar código a un número que todavía no es cliente? Sólo si
  //     la org tiene el alta abierta (mig 210) o si el pedido viene con un
  //     `signup_token` válido (o sea, ya verificamos su Google/Apple).
  const puedeAltaPropia = ctx.altaHabilitada || !!social
  if (!cliente && !puedeAltaPropia) return fail(404, 'CLIENT_NOT_FOUND', MSG_CLIENT_NOT_FOUND)

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
  //
  //    Mandarle un código a alguien que NUNCA habló con el negocio está
  //    permitido: es un opt-in explícito hecho fuera de WhatsApp (el usuario
  //    tocó "Enviarme el código" en la app), que es exactamente el caso que
  //    Meta acepta para los templates AUTHENTICATION. No hay que "arreglar"
  //    esto agregando un chequeo de "¿ya nos escribió?": rompería el alta.
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
    // La app tiene que pedir el nombre ANTES de mandar `verify` cuando el
    // número es nuevo; si no, se come un 400 NAME_REQUIRED con el código ya
    // tipeado.
    name_required: !cliente && !social?.name,
    first_name: primerNombre(cliente?.name) ?? social?.name?.split(/\s+/)[0] ?? null,
  })
}

// ── verify ──────────────────────────────────────────────────────────────────

async function handleVerify(ctx: Ctx, body: ReqBody): Promise<Response> {
  const social = await resolverSignupToken(ctx, body)
  if (social instanceof Response) return social

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

  // 3. Código correcto. Resolvemos al cliente.
  let cliente = await buscarCliente(ctx)
  if (cliente instanceof Response) return cliente
  const nombre = limpiarNombre(body.name) ?? social?.name ?? null
  let esNuevo = false

  // 3a. Los chequeos que NO consumen el desafío van primero: el código sigue
  //     siendo válido y la app puede reintentar `verify` con lo que le falta
  //     (el nombre) sin pedir uno nuevo.
  if (!cliente) {
    if (!ctx.altaHabilitada && !social) {
      // Sin alta propia no hay creación (no debería pasar: `start` ya lo
      // rechazó; cubre el caso de una ficha borrada entre medio).
      await consumirDesafio(ctx, desafio.id)
      return fail(404, 'CLIENT_NOT_FOUND', MSG_CLIENT_NOT_FOUND)
    }
    if (!nombre) {
      return fail(400, 'NAME_REQUIRED', 'Decinos cómo te llamás para crear tu cuenta.')
    }
  }

  // 3b. Si viene identidad social y ya está vinculada a OTRO cliente, se corta
  //     ANTES de consumir el código: quemarle el código a alguien por un
  //     conflicto que no puede resolver desde la app sería doblemente injusto.
  if (social) {
    const choque = await identidadVinculadaAOtro(ctx, social, cliente?.id ?? null)
    if (choque instanceof Response) return choque
    if (choque) {
      return fail(
        409,
        'SOCIAL_ALREADY_LINKED',
        'Esta cuenta de Google o Apple ya está vinculada a otro cliente. Entrá con el teléfono de esa cuenta o escribinos.',
      )
    }
  }

  // 4. Consumo idempotente del desafío.
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

  // 5. Alta propia: recién acá nace el cliente, con el teléfono ya verificado.
  if (!cliente) {
    const creado = await crearCliente(ctx, nombre!, social?.email ?? null)
    if (creado instanceof Response) return creado
    cliente = creado.cliente
    esNuevo = creado.esNuevo
  } else if (nombre && nombreEsPlaceholder(cliente.name)) {
    // 5b. Nombre: si la ficha no tiene un nombre real (alta por teléfono, "Sin
    //     nombre", etc.) y la app mandó uno, lo adoptamos. Si ya tenía, no se toca.
    const { error: nomErr } = await ctx.admin.from('clients').update({ name: nombre }).eq('id', cliente.id)
    if (nomErr) console.error(LOG, 'no se pudo actualizar el nombre', ctx.log, nomErr.message)
    else cliente = { ...cliente, name: nombre }
  }

  // 6. Vinculación de la identidad social. Éste es el caso de los clientes que
  //    YA existían y un día entran con Google: no se duplica nada, se le pega la
  //    identidad encima a la cuenta que ya tenía.
  if (social) {
    const vinculado = await aplicarIdentidadSocial(ctx, cliente, social)
    if (vinculado instanceof Response) return vinculado
    cliente = vinculado
  }

  // 7. Usuario de Auth: password = device_secret de ESTE dispositivo.
  const authUser = await asegurarAuthUser(ctx, cliente, ctx.tel)
  if (authUser instanceof Response) return authUser

  // 8. Sesión.
  const { data: signIn, error: signErr } = await ctx.auth.auth.signInWithPassword({
    email: authUser.email,
    password: ctx.deviceSecret,
  })
  if (signErr || !signIn.session) {
    console.error(LOG, 'signInWithPassword post-verify falló', ctx.log, signErr?.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }

  return responderSesion(ctx, signIn.session, cliente, esNuevo, ctx.tel)
}

// ── Piezas ──────────────────────────────────────────────────────────────────

/**
 * 404 ORG_NOT_FOUND si la org no existe o está inactiva; si está bien, devuelve
 * si tiene el alta propia habilitada (`allow_client_signup`, mig 210).
 */
async function verificarOrganizacion(ctx: CtxBase): Promise<{ altaHabilitada: boolean } | Response> {
  const { data, error } = await ctx.admin
    .from('organizations')
    .select('id, allow_client_signup')
    .eq('id', ctx.orgId)
    .eq('is_active', true)
    .maybeSingle<{ id: string; allow_client_signup: boolean | null }>()
  if (error) {
    console.error(LOG, 'select organizations falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  if (!data) return fail(404, 'ORG_NOT_FOUND', 'La barbería no está disponible.')
  return { altaHabilitada: data.allow_client_signup === true }
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
  return await buscarClientePorId(ctx, clientId as string)
}

async function buscarClientePorId(ctx: CtxBase, id: string): Promise<ClienteRow | null | Response> {
  const { data, error } = await ctx.admin
    .from('clients')
    .select(CLIENTE_COLS)
    .eq('id', id)
    .maybeSingle<ClienteRow>()
  if (error) {
    console.error(LOG, 'select clients falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  return data ?? null
}

/**
 * Crea la ficha del cliente que se registró desde la app.
 *
 * `phone` se guarda en la forma NACIONAL de 10 dígitos, que es lo que tiene
 * toda la base (verificado en prod) y lo que buscan por igualdad exacta el
 * kiosko y el turnero antes de caer al match por últimos 10 dígitos. Guardarlo
 * en E.164 haría que la tablet no lo encuentre y cree un DUPLICADO: es
 * exactamente el bug que arreglaron las migraciones 149/150. Para un número que
 * no tiene forma nacional (fijo sin característica, otro país) se guarda el
 * E.164, que es la única forma completa que queda.
 *
 * El 23505 del UNIQUE(organization_id, phone) NO es un error: es que otro
 * dispositivo registró el mismo número entre nuestro `find` y nuestro `insert`.
 * Se relee y se sigue con esa ficha.
 */
async function crearCliente(
  ctx: Ctx,
  nombre: string,
  email: string | null,
): Promise<{ cliente: ClienteRow; esNuevo: boolean } | Response> {
  const phone = ctx.tel.national10 ?? ctx.tel.e164
  const { data, error } = await ctx.admin
    .from('clients')
    .insert({
      organization_id: ctx.orgId,
      phone,
      name: nombre,
      signup_source: 'app',
      ...(email ? { email } : {}),
    })
    .select(CLIENTE_COLS)
    .maybeSingle<ClienteRow>()

  if (!error && data) {
    console.log(LOG, 'cliente creado desde la app', ctx.log, `client=${data.id}`)
    return { cliente: data, esNuevo: true }
  }

  if (error && error.code === '23505') {
    console.warn(LOG, 'carrera creando el cliente (23505), se relee', ctx.log)
    const otra = await buscarCliente(ctx)
    if (otra instanceof Response) return otra
    if (otra) return { cliente: otra, esNuevo: false }

    // `find_client_id_by_phone` descarta los teléfonos degenerados (todos los
    // dígitos iguales), así que el índice puede haber chocado con una fila que
    // la RPC no devuelve nunca. Se busca por igualdad exacta.
    const { data: exacta, error: exErr } = await ctx.admin
      .from('clients')
      .select(CLIENTE_COLS)
      .eq('organization_id', ctx.orgId)
      .eq('phone', phone)
      .maybeSingle<ClienteRow>()
    if (exErr) console.error(LOG, 'select clients por teléfono exacto falló', ctx.log, exErr.message)
    if (exacta) return { cliente: exacta, esNuevo: false }
  }

  console.error(LOG, 'insert clients falló', ctx.log, error?.message ?? 'sin fila devuelta')
  return fail(500, 'AUTH_FAILED', 'No pudimos crear tu cuenta. Probá de nuevo.')
}

/** Identidad social por (provider, subject). `null` si no está. */
async function buscarIdentidadSocial(
  ctx: CtxBase,
  provider: ProveedorSocial,
  subject: string,
): Promise<IdentidadRow | null | Response> {
  const { data, error } = await ctx.admin
    .from('client_social_identities')
    .select('id, client_id, organization_id')
    .eq('provider', provider)
    .eq('subject', subject)
    .maybeSingle<IdentidadRow>()
  if (error) {
    console.error(LOG, 'select client_social_identities falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }
  return data ?? null
}

/** `true` si esa identidad ya pertenece a un cliente distinto del que resolvimos. */
async function identidadVinculadaAOtro(
  ctx: CtxBase,
  social: SignupTokenPayload,
  clienteId: string | null,
): Promise<boolean | Response> {
  const fila = await buscarIdentidadSocial(ctx, social.provider, social.subject)
  if (fila instanceof Response) return fila
  if (!fila) return false
  return fila.client_id !== clienteId || fila.organization_id !== ctx.orgId
}

/**
 * Vincula la identidad social a este cliente y, si la ficha no tenía email,
 * guarda el del proveedor. Devuelve el cliente actualizado o el error a
 * contestar. Es el único lugar que escribe `client_social_identities` fuera de
 * la limpieza de huérfanas.
 */
async function aplicarIdentidadSocial(
  ctx: CtxBase,
  cliente: ClienteRow,
  social: SignupTokenPayload,
): Promise<ClienteRow | Response> {
  const choque = await identidadVinculadaAOtro(ctx, social, cliente.id)
  if (choque instanceof Response) return choque
  if (choque) {
    return fail(
      409,
      'SOCIAL_ALREADY_LINKED',
      'Esta cuenta de Google o Apple ya está vinculada a otro cliente. Entrá con el teléfono de esa cuenta o escribinos.',
    )
  }

  const vinculo = await vincularIdentidadSocial(ctx, cliente, social)
  if (vinculo instanceof Response) return vinculo

  if (social.email && !cliente.email) {
    const { error } = await ctx.admin.from('clients').update({ email: social.email }).eq('id', cliente.id)
    if (error) console.error(LOG, 'no se pudo guardar el email del proveedor', ctx.log, error.message)
    else return { ...cliente, email: social.email }
  }
  return cliente
}

/**
 * Deja la identidad social apuntando a este cliente. Upsert por
 * (provider, subject): volver a entrar con Google desde otro teléfono no crea
 * una segunda fila.
 */
async function vincularIdentidadSocial(
  ctx: CtxBase,
  cliente: ClienteRow,
  social: SignupTokenPayload,
): Promise<true | Response> {
  const ahora = new Date().toISOString()
  const { error } = await ctx.admin
    .from('client_social_identities')
    .upsert(
      {
        organization_id: ctx.orgId,
        client_id: cliente.id,
        provider: social.provider,
        subject: social.subject,
        email: social.email,
        name: social.name,
        raw: { linked_at: ahora, provider: social.provider },
        last_login_at: ahora,
      },
      { onConflict: 'provider,subject' },
    )
  if (error) {
    if (error.code === '23505') {
      // Otro request la vinculó a otro cliente entre el chequeo y el upsert.
      console.warn(LOG, 'carrera vinculando la identidad social', ctx.log, error.message)
      return fail(
        409,
        'SOCIAL_ALREADY_LINKED',
        'Esta cuenta de Google o Apple ya está vinculada a otro cliente. Entrá con el teléfono de esa cuenta o escribinos.',
      )
    }
    // No es fatal para la sesión —el teléfono ya está verificado— pero sí es un
    // fallo real: sin la fila no hay login de un toque la próxima vez.
    console.error(LOG, 'upsert client_social_identities falló', ctx.log, error.message)
    return fail(500, 'AUTH_FAILED', 'No pudimos vincular tu cuenta. Probá de nuevo.')
  }
  return true
}

/**
 * Verifica el `signup_token` del body, si vino. Devuelve `null` si no vino,
 * el payload si es válido, o un 400 si no lo es. Un token roto NO se ignora en
 * silencio: si se ignorara, el alta seguiría adelante y la identidad social
 * nunca quedaría vinculada, que es justo lo que el usuario pidió.
 */
async function resolverSignupToken(ctx: CtxBase, body: ReqBody): Promise<SignupTokenPayload | null | Response> {
  if (!body.signup_token) return null
  const r = await verificarSignupToken(body.signup_token, SIGNUP_TOKEN_SECRET)
  if (!r.ok) {
    console.warn(LOG, 'signup_token rechazado', ctx.log, r.motivo)
    return fail(
      400,
      'SIGNUP_TOKEN_INVALID',
      r.vencido
        ? 'Pasó demasiado tiempo. Volvé a entrar con Google o Apple.'
        : 'No pudimos validar tu cuenta. Volvé a entrar con Google o Apple.',
      { expired: r.vencido },
    )
  }
  if (r.payload.orgId !== ctx.orgId) {
    console.warn(LOG, 'signup_token de otra organización', ctx.log)
    return fail(400, 'SIGNUP_TOKEN_INVALID', 'No pudimos validar tu cuenta. Volvé a entrar con Google o Apple.', {
      expired: false,
    })
  }
  return r.payload
}

/**
 * Intenta la sesión con la password actual del usuario de Auth (el
 * `device_secret` del último dispositivo verificado). Devuelve la sesión o
 * `null`. NUNCA modifica la password.
 */
async function loginSilencioso(ctx: CtxBase, cliente: ClienteRow): Promise<Session | null> {
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

/**
 * 429 RATE_LIMITED si algún bucket está lleno; `null` si se puede seguir.
 *
 * `esAlta` = el teléfono todavía no es cliente, o sea que el WhatsApp que sigue
 * va a un número del que no sabemos nada. En ese caso los tres buckets fallan
 * CERRADO (ver el comentario en `handleStart`); para un cliente conocido siguen
 * fallando abierto, que es lo que corresponde a un login.
 */
async function chequearRateLimits(ctx: Ctx, esAlta: boolean): Promise<Response | null> {
  const porTelefono = await rateLimit(ctx, RL_PHONE.bucket, `${ctx.orgId}:${ctx.tel.national10 ?? ctx.tel.e164}`, RL_PHONE, esAlta)
  if (!porTelefono.allowed) {
    return fail(429, 'RATE_LIMITED', 'Ya te mandamos varios códigos. Esperá unos minutos y volvé a intentar.', {
      retry_in: porTelefono.retryIn,
    })
  }
  // Con el alta abierta, el teléfono deja de acotar: cualquiera puede pedir
  // códigos para números que no son suyos. El dispositivo sí acota — hasta
  // donde puede: `device_id` lo elige el cliente, así que este bucket frena a la
  // app real, no a un atacante que lo aleatoriza. El que de verdad acota a un
  // atacante es el de IP (verificado el 3/9/2026: la plataforma reescribe
  // `X-Forwarded-For`, así que el primer valor es la IP real y no se puede
  // falsear desde el body ni desde los headers).
  const porDispositivo = await rateLimit(ctx, RL_DEVICE.bucket, `${ctx.orgId}:${ctx.deviceId}`, RL_DEVICE, esAlta)
  if (!porDispositivo.allowed) {
    return fail(429, 'RATE_LIMITED', 'Pediste demasiados códigos desde este teléfono. Probá más tarde.', {
      retry_in: porDispositivo.retryIn,
    })
  }
  const porIp = await rateLimit(ctx, RL_IP.bucket, ctx.ip, RL_IP, esAlta)
  if (!porIp.allowed) {
    return fail(429, 'RATE_LIMITED', 'Demasiados intentos desde esta conexión. Probá más tarde.', {
      retry_in: porIp.retryIn,
    })
  }
  return null
}

/**
 * Envoltorio de la RPC `check_rate_limit`.
 *
 * `fallaCerrado` invierte qué pasa cuando la RPC no contesta. Por default
 * fail-open: un login de un cliente que ya existe no se cae porque una tabla
 * auxiliar hipó. Con `fallaCerrado`, un fallo se responde como "límite
 * alcanzado": es preferible que las altas nuevas queden en pausa —ruidosa, con
 * 429 y con este log— a quedarnos sin ningún tope sobre un endpoint que manda
 * WhatsApps a números arbitrarios.
 */
async function rateLimit(
  ctx: CtxBase,
  bucket: string,
  key: string,
  opts: { limit: number; window: number },
  fallaCerrado = false,
): Promise<{ allowed: boolean; retryIn: number }> {
  const { data, error } = await ctx.admin.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.window,
  })
  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; reset_at: string } | undefined) : undefined
  if (error || !row) {
    console.error(
      LOG,
      `check_rate_limit(${bucket}) falló, ${fallaCerrado ? 'fail-CLOSED' : 'fail-open'}`,
      ctx.log,
      error?.message,
    )
    return { allowed: !fallaCerrado, retryIn: fallaCerrado ? 60 : 0 }
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
 * `tel` es el teléfono normalizado del request cuando lo hay (`start`/`verify`);
 * en el login social no hay teléfono en el body y el alias se deriva del que
 * tiene guardado el cliente.
 *
 * Caminos:
 *  a) `clients.auth_user_id` ya apunta a un usuario vivo → update password + metadata.
 *  b) no hay usuario → `createUser` con el alias `${national10 ?? e164sinmás}@monaco.internal`.
 *  c) el alias ya existe en Auth:
 *     - si no está vinculado a OTRO cliente → se adopta (password + metadata + vínculo);
 *     - si sí lo está → se intenta el alias secundario `${e164sinmás}@…`;
 *       si también está tomado → 409 CONFLICT.
 */
async function asegurarAuthUser(
  ctx: CtxBase,
  cliente: ClienteRow,
  tel: TelefonoNormalizado | null,
): Promise<AuthUserListo | Response> {
  const appMeta = appMetadataCliente(cliente.id)

  // a) Usuario ya vinculado.
  if (cliente.auth_user_id) {
    const { data, error } = await ctx.admin.auth.admin.updateUserById(cliente.auth_user_id, {
      password: ctx.deviceSecret,
      app_metadata: appMeta,
      // Ver la nota de `email_confirm` más abajo: un alias sin confirmar no
      // puede firmar sesión y no hay forma de confirmarlo (el dominio no
      // recibe correo).
      email_confirm: true,
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
  const aliases = aliasesDeCliente(tel, cliente)
  if (aliases.length === 0) {
    console.error(LOG, 'no se pudo derivar un alias de email para el cliente', ctx.log, `client=${cliente.id}`)
    return fail(500, 'AUTH_FAILED', 'No pudimos iniciar sesión. Probá de nuevo.')
  }

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
    //
    // `email_confirm: true` NO es decorativo. El alias vive en un dominio que no
    // recibe correo, así que un usuario sin confirmar es un usuario que NUNCA va
    // a poder firmar sesión: `signInWithPassword` contesta `email_not_confirmed`
    // y ese teléfono queda fuera de la app para siempre, sin pantalla desde
    // donde destrabarlo. Los que creamos nosotros nacen con `email_confirm` en
    // `createUser`; el que adoptamos acá puede venir de cualquier lado (una
    // creación a mano en el Studio, un alta vieja, o —el día que GoTrue afloje
    // su validador de emails, que hoy es lo único que lo impide— un
    // `POST /auth/v1/signup` hecho con la anon key contra el alias de una
    // víctima). Confirmarlo al adoptar cierra los tres casos de una.
    const { error: updErr } = await ctx.admin.auth.admin.updateUserById(existente.id, {
      password: ctx.deviceSecret,
      app_metadata: appMeta,
      email_confirm: true,
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

/**
 * Aliases candidatos, en orden. Se prefiere el teléfono del request; si no hay
 * (login social) se normaliza el que tiene guardado el cliente, y si ni eso se
 * puede, sus dígitos crudos.
 */
function aliasesDeCliente(tel: TelefonoNormalizado | null, cliente: ClienteRow): string[] {
  const t = tel ?? normalizarTelefonoAR(cliente.phone ?? '')
  if (!t) {
    const d = (cliente.phone ?? '').replace(/\D/g, '')
    return d ? [`${d}@${EMAIL_DOMAIN}`] : []
  }
  const e164SinMas = t.e164.replace(/^\+/, '')
  return unicos([`${t.national10 ?? e164SinMas}@${EMAIL_DOMAIN}`, `${e164SinMas}@${EMAIL_DOMAIN}`])
}

/** `clients.auth_user_id = uid`. Devuelve el mensaje de error o `null`. */
async function vincularAuthUser(ctx: CtxBase, clienteId: string, uid: string): Promise<string | null> {
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
async function buscarAuthUserPorEmail(ctx: CtxBase, email: string): Promise<User | null> {
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
async function responderSesion(
  ctx: CtxBase,
  sesion: Session,
  cliente: ClienteRow,
  esNuevo: boolean,
  tel: TelefonoNormalizado | null,
): Promise<Response> {
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
    phone: tel ? (tel.national10 ?? tel.e164) : cliente.phone,
  })
}

async function consumirDesafio(ctx: CtxBase, id: string): Promise<void> {
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
  if (action !== 'start' && action !== 'verify' && action !== 'social') {
    return { ok: false, res: fail(400, 'BAD_REQUEST', "action tiene que ser 'start', 'verify' o 'social'.") }
  }
  // `social` es la única sin teléfono: justamente lo pide después.
  if (action !== 'social' && (typeof b.phone !== 'string' || !b.phone.trim())) {
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

  let provider: ProveedorSocial | undefined
  let idToken: string | undefined
  let nonce: string | undefined
  if (action === 'social') {
    if (b.provider !== 'google' && b.provider !== 'apple') {
      return { ok: false, res: fail(400, 'BAD_REQUEST', "provider tiene que ser 'google' o 'apple'.") }
    }
    provider = b.provider
    if (typeof b.id_token !== 'string' || !b.id_token.trim() || b.id_token.length > ID_TOKEN_MAX) {
      return { ok: false, res: fail(400, 'BAD_REQUEST', 'id_token inválido.') }
    }
    idToken = b.id_token.trim()
    if (b.nonce !== undefined && b.nonce !== null) {
      if (typeof b.nonce !== 'string' || b.nonce.length > NONCE_MAX) {
        return { ok: false, res: fail(400, 'BAD_REQUEST', 'nonce inválido.') }
      }
      nonce = b.nonce.trim() || undefined
    }
  }

  let signupToken: string | undefined
  if (b.signup_token !== undefined && b.signup_token !== null) {
    if (typeof b.signup_token !== 'string' || b.signup_token.length > SIGNUP_TOKEN_MAX) {
      return { ok: false, res: fail(400, 'BAD_REQUEST', 'signup_token inválido.') }
    }
    signupToken = b.signup_token.trim() || undefined
  }

  if (b.name !== undefined && b.name !== null && typeof b.name !== 'string') {
    return { ok: false, res: fail(400, 'BAD_REQUEST', 'name inválido.') }
  }

  return {
    ok: true,
    body: {
      action,
      phone: typeof b.phone === 'string' ? b.phone : undefined,
      device_id: b.device_id.trim(),
      device_secret: b.device_secret,
      org_id: b.org_id.trim().toLowerCase(),
      code,
      name: typeof b.name === 'string' ? b.name : undefined,
      provider,
      id_token: idToken,
      nonce,
      signup_token: signupToken,
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

/**
 * Email en minúscula, o `null`. Puede ser un relay de Apple
 * (`@privaterelay.appleid.com`): es un identificador válido y se guarda, pero
 * NO es un canal de contacto — el canal es el teléfono.
 */
function limpiarEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const e = email.trim().toLowerCase()
  if (!e || e.length > EMAIL_MAX || !e.includes('@')) return null
  return e
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
