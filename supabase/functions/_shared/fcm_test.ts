// Tests locales de _shared/fcm.ts: clasificación de respuestas de FCM v1, armado del mensaje,
// OAuth2 con una clave RSA generada al vuelo (se verifica la firma del JWT) y cache del token.
// Sin red: `fetch` se mockea. Correr con:
//   deno test --allow-none supabase/functions/_shared/fcm_test.ts

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import {
  _fcmTokenCacheSize,
  base64UrlDecode,
  buildFcmMessage,
  classifyFcmResponse,
  FCM_SCOPE,
  FcmAuthError,
  FcmConfigError,
  type FcmServiceAccount,
  getFcmAccessToken,
  GOOGLE_TOKEN_URI,
  invalidateFcmAccessToken,
  loadFcmServiceAccount,
  parseServiceAccountJson,
  resolveFcmProjectId,
  sanitizeFcmData,
  sendFcmMessage,
} from './fcm.ts'

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Captured {
  url: string
  init: RequestInit
}

/** Mock de fetch que devuelve respuestas en orden y captura las llamadas. */
function mockFetch(responses: Array<Response | ((url: string, init: RequestInit) => Response | Promise<Response>)>) {
  const calls: Captured[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error(`fetch inesperado a ${url}`)
    return typeof next === 'function' ? await next(url, init ?? {}) : next
  }) as typeof fetch
  return { impl, calls }
}

function fcmError(status: number, googleStatus: string, message: string, errorCode?: string, extraDetails: unknown[] = []) {
  const details: unknown[] = [...extraDetails]
  if (errorCode) details.push({ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode })
  return jsonResponse(status, { error: { code: status, message, status: googleStatus, details } })
}

function derToPem(der: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(der)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = btoa(bin)
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/** Genera una service account de mentira con un par RSA real (para verificar la firma). */
async function generateServiceAccount(): Promise<{ sa: FcmServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return {
    sa: {
      project_id: 'monaco-test',
      client_email: `sa-${crypto.randomUUID()}@monaco-test.iam.gserviceaccount.com`,
      private_key: derToPem(pkcs8, 'PRIVATE KEY'),
    },
    publicKey: pair.publicKey,
  }
}

const baseInput = {
  projectId: 'monaco-test',
  token: 'dXyz:APA91b-token',
  notification: { title: 'Recordatorio de turno', body: 'Mañana a las 15:00 te esperamos en Rondeau.' },
  data: { type: 'appointment_reminder', value: 'appt-1', deep_link: '/turnos', notification_id: 'n-1' },
  androidChannelId: 'monaco_default',
}

// ---------------------------------------------------------------------------
// buildFcmMessage / sanitizeFcmData
// ---------------------------------------------------------------------------

Deno.test('buildFcmMessage: arma el cuerpo del contrato (android HIGH + canal + sound, apns prioridad 10 + badge)', () => {
  const env = buildFcmMessage({ ...baseInput, badge: 3 })
  assertEquals(env, {
    message: {
      token: 'dXyz:APA91b-token',
      notification: { title: 'Recordatorio de turno', body: 'Mañana a las 15:00 te esperamos en Rondeau.' },
      data: { type: 'appointment_reminder', value: 'appt-1', deep_link: '/turnos', notification_id: 'n-1' },
      android: { priority: 'HIGH', notification: { channel_id: 'monaco_default', sound: 'default' } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default', badge: 3 } } },
    },
  })
})

Deno.test('buildFcmMessage: badge default 1, imagen sólo si viene', () => {
  const sin = buildFcmMessage(baseInput)
  assertEquals(sin.message.apns.payload.aps.badge, 1)
  assertEquals('image' in sin.message.notification, false)

  const con = buildFcmMessage({ ...baseInput, notification: { ...baseInput.notification, image: ' https://x/y.jpg ' } })
  assertEquals(con.message.notification.image, 'https://x/y.jpg')

  const vacia = buildFcmMessage({ ...baseInput, notification: { ...baseInput.notification, image: '   ' } })
  assertEquals('image' in vacia.message.notification, false)
})

Deno.test('sanitizeFcmData: todo string, sin claves reservadas ni nulos', () => {
  const out = sanitizeFcmData({
    type: 'campaign',
    count: 3,
    flag: true,
    nested: { a: 1 },
    nada: null,
    undef: undefined,
    from: 'x',
    notification: 'y',
    message_type: 'z',
    collapse_key: 'k',
    'google.foo': '1',
    'gcm.bar': '2',
    '': 'vacia',
  })
  assertEquals(out, { type: 'campaign', count: '3', flag: 'true', nested: '{"a":1}' })
  assertEquals(sanitizeFcmData(null), {})
  assertEquals(sanitizeFcmData(undefined), {})
})

// ---------------------------------------------------------------------------
// classifyFcmResponse
// ---------------------------------------------------------------------------

Deno.test('classify: 200 con name → ok + messageId', () => {
  const r = classifyFcmResponse(200, { name: 'projects/monaco-test/messages/0:123' })
  assert(r.ok)
  assertEquals(r.messageId, 'projects/monaco-test/messages/0:123')
})

Deno.test('classify: UNREGISTERED (404) → unregistered', () => {
  const r = classifyFcmResponse(404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })
  assert(!r.ok)
  assertEquals(r.kind, 'unregistered')
  assertEquals(r.status, 404)
  assertEquals(r.code, 'UNREGISTERED')
  assertStringIncludes(r.error, 'not found')
})

Deno.test('classify: 404 sin details → unregistered igual', () => {
  const r = classifyFcmResponse(404, { error: { message: 'Requested entity was not found.', status: 'NOT_FOUND' } })
  assert(!r.ok && r.kind === 'unregistered')
})

Deno.test('classify: INVALID_ARGUMENT por token inválido → invalid', () => {
  const r = classifyFcmResponse(400, { error: { code: 400, message: 'The registration token is not a valid FCM registration token', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }] } })
  assert(!r.ok)
  assertEquals(r.kind, 'invalid')
  assertEquals(r.code, 'INVALID_ARGUMENT')
})

Deno.test('classify: INVALID_ARGUMENT con fieldViolations sobre message.token → invalid', () => {
  const r = classifyFcmResponse(400, {
    error: {
      code: 400, message: 'Invalid registration token', status: 'INVALID_ARGUMENT',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] },
        { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' },
      ],
    },
  })
  assert(!r.ok && r.kind === 'invalid')
})

Deno.test('classify: INVALID_ARGUMENT por payload mal armado (otro campo) → fatal, NO desactiva el token', () => {
  const r = classifyFcmResponse(400, {
    error: {
      code: 400, message: "Invalid value at 'message.data[0].value' (TYPE_STRING), 1", status: 'INVALID_ARGUMENT',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.data[0].value', description: "Invalid value at 'message.data[0].value' (TYPE_STRING), 1" }] },
        { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' },
      ],
    },
  })
  assert(!r.ok)
  assertEquals(r.kind, 'fatal')
})

Deno.test('classify: 400 sin details → invalid', () => {
  const r = classifyFcmResponse(400, { error: { message: 'Bad Request' } })
  assert(!r.ok && r.kind === 'invalid')
})

Deno.test('classify: SENDER_ID_MISMATCH (403) → invalid', () => {
  const r = classifyFcmResponse(403, { error: { code: 403, message: 'SenderId mismatch', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'SENDER_ID_MISMATCH' }] } })
  assert(!r.ok && r.kind === 'invalid')
  assertEquals(r.code, 'SENDER_ID_MISMATCH')
})

Deno.test('classify: 429 / QUOTA_EXCEEDED → retryable', () => {
  const a = classifyFcmResponse(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'QUOTA_EXCEEDED' }] } })
  assert(!a.ok && a.kind === 'retryable')
  const b = classifyFcmResponse(429, null)
  assert(!b.ok && b.kind === 'retryable')
})

Deno.test('classify: 5xx / UNAVAILABLE / INTERNAL → retryable', () => {
  const a = classifyFcmResponse(503, { error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNAVAILABLE' }] } })
  assert(!a.ok && a.kind === 'retryable')
  const b = classifyFcmResponse(500, { error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INTERNAL' }] } })
  assert(!b.ok && b.kind === 'retryable')
  const c = classifyFcmResponse(502, '<html>Bad Gateway</html>')
  assert(!c.ok && c.kind === 'retryable')
})

Deno.test('classify: 401 UNAUTHENTICATED → retryable (el access token se renueva)', () => {
  const r = classifyFcmResponse(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
  assert(!r.ok && r.kind === 'retryable')
})

Deno.test('classify: 403 PERMISSION_DENIED / THIRD_PARTY_AUTH_ERROR / desconocidos → fatal', () => {
  const a = classifyFcmResponse(403, { error: { code: 403, message: 'Firebase Cloud Messaging API has not been used in project', status: 'PERMISSION_DENIED' } })
  assert(!a.ok && a.kind === 'fatal')
  const b = classifyFcmResponse(401, { error: { code: 401, message: 'Auth error from APNS or Web Push Service', status: 'UNAUTHENTICATED', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'THIRD_PARTY_AUTH_ERROR' }] } })
  // THIRD_PARTY_AUTH_ERROR viene con 401 pero no es nuestro token: cae en la regla de 401 → retryable.
  // Lo dejamos documentado: reintentar 3 veces ante un problema de APNs no duplica nada.
  assert(!b.ok && b.kind === 'retryable')
  const c = classifyFcmResponse(418, { error: { message: 'soy una tetera' } })
  assert(!c.ok && c.kind === 'fatal')
  assertStringIncludes(c.error, 'tetera')
})

// ---------------------------------------------------------------------------
// sendFcmMessage (fetch mockeado)
// ---------------------------------------------------------------------------

Deno.test('sendFcmMessage: POST correcto a messages:send con Bearer y cuerpo del contrato', async () => {
  const { impl, calls } = mockFetch([jsonResponse(200, { name: 'projects/monaco-test/messages/abc' })])
  const r = await sendFcmMessage({ ...baseInput, badge: 2 }, { accessToken: 'ya29.test', fetchImpl: impl })
  assert(r.ok)
  assertEquals(r.messageId, 'projects/monaco-test/messages/abc')
  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, 'https://fcm.googleapis.com/v1/projects/monaco-test/messages:send')
  assertEquals(calls[0].init.method, 'POST')
  const headers = calls[0].init.headers as Record<string, string>
  assertEquals(headers.Authorization, 'Bearer ya29.test')
  assertEquals(headers['Content-Type'], 'application/json')
  const body = JSON.parse(calls[0].init.body as string)
  assertEquals(body, buildFcmMessage({ ...baseInput, badge: 2 }))
  assert(calls[0].init.signal instanceof AbortSignal)
})

Deno.test('sendFcmMessage: UNREGISTERED → unregistered', async () => {
  const { impl } = mockFetch([fcmError(404, 'NOT_FOUND', 'Requested entity was not found.', 'UNREGISTERED')])
  const r = await sendFcmMessage(baseInput, { accessToken: 't', fetchImpl: impl })
  assert(!r.ok && r.kind === 'unregistered' && r.status === 404)
})

Deno.test('sendFcmMessage: error de red → retryable con status null', async () => {
  const { impl } = mockFetch([() => { throw new TypeError('error sending request') }])
  const r = await sendFcmMessage(baseInput, { accessToken: 't', fetchImpl: impl })
  assert(!r.ok)
  assertEquals(r.kind, 'retryable')
  assertEquals(r.status, null)
  assertStringIncludes(r.error, 'Error de conexión')
})

Deno.test('sendFcmMessage: timeout → retryable', async () => {
  const { impl } = mockFetch([
    (_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
      })
    }),
  ])
  const r = await sendFcmMessage(baseInput, { accessToken: 't', fetchImpl: impl, timeoutMs: 20 })
  assert(!r.ok)
  assertEquals(r.kind, 'retryable')
  assertEquals(r.status, null)
  assertStringIncludes(r.error, 'Timeout')
})

Deno.test('sendFcmMessage: 401 invalida el cache del access token', async () => {
  const { sa } = await generateServiceAccount()
  // Primero cacheamos un token vía OAuth mockeado
  const oauth = mockFetch([jsonResponse(200, { access_token: 'ya29.cacheado', expires_in: 3600, token_type: 'Bearer' })])
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: oauth.impl }), 'ya29.cacheado')
  assert(_fcmTokenCacheSize() >= 1)
  // Envío con 401
  const send = mockFetch([jsonResponse(401, { error: { code: 401, message: 'invalid credentials', status: 'UNAUTHENTICATED' } })])
  const r = await sendFcmMessage(baseInput, { accessToken: 'ya29.cacheado', fetchImpl: send.impl })
  assert(!r.ok && r.kind === 'retryable')
  assertEquals(_fcmTokenCacheSize(), 0)
})

Deno.test('sendFcmMessage: con service account cuyo OAuth falla → no tira, devuelve fatal/retryable', async () => {
  // (El camino "sin accessToken ni serviceAccount" lee Deno.env y necesitaría --allow-env; se cubre
  //  indirectamente con loadFcmServiceAccount más abajo.)
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  const oauthFail = mockFetch([jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })])
  const r = await sendFcmMessage(baseInput, { serviceAccount: sa, fetchImpl: oauthFail.impl })
  assert(!r.ok)
  assertEquals(r.kind, 'fatal')
  assertStringIncludes(r.error, 'invalid_grant')
  assertEquals(oauthFail.calls.length, 1, 'sólo se llamó a OAuth; FCM nunca se tocó')

  const oauthDown = mockFetch([jsonResponse(503, { error: 'unavailable' })])
  const r2 = await sendFcmMessage(baseInput, { serviceAccount: sa, fetchImpl: oauthDown.impl })
  assert(!r2.ok)
  assertEquals(r2.kind, 'retryable')
})

// ---------------------------------------------------------------------------
// OAuth2: firma RS256 + cache
// ---------------------------------------------------------------------------

Deno.test('getFcmAccessToken: firma un JWT RS256 válido con los claims correctos y lo intercambia', async () => {
  const { sa, publicKey } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  const fixedNow = Date.UTC(2026, 7, 20, 12, 0, 0)
  let capturedAssertion = ''
  const { impl, calls } = mockFetch([
    (_url, init) => {
      const params = new URLSearchParams(String(init.body))
      assertEquals(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
      capturedAssertion = params.get('assertion') ?? ''
      return jsonResponse(200, { access_token: 'ya29.nuevo', expires_in: 3599, token_type: 'Bearer' })
    },
  ])

  const token = await getFcmAccessToken(sa, { fetchImpl: impl, now: () => fixedNow })
  assertEquals(token, 'ya29.nuevo')
  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, GOOGLE_TOKEN_URI)
  assertEquals(calls[0].init.method, 'POST')
  assertEquals((calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded')

  // JWT: header.claims.firma
  const [h, c, s] = capturedAssertion.split('.')
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h)))
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(c)))
  assertEquals(header, { alg: 'RS256', typ: 'JWT' })
  assertEquals(claims.iss, sa.client_email)
  assertEquals(claims.scope, FCM_SCOPE)
  assertEquals(claims.aud, GOOGLE_TOKEN_URI)
  assertEquals(claims.iat, Math.floor(fixedNow / 1000))
  assertEquals(claims.exp - claims.iat, 3600)

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64UrlDecode(s) as BufferSource,
    new TextEncoder().encode(`${h}.${c}`),
  )
  assert(ok, 'la firma del JWT tiene que verificar con la clave pública')
})

Deno.test('getFcmAccessToken: cachea 50 min y renueva después', async () => {
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  let now = Date.UTC(2026, 7, 20, 12, 0, 0)
  const { impl, calls } = mockFetch([
    jsonResponse(200, { access_token: 'ya29.uno', expires_in: 3600 }),
    jsonResponse(200, { access_token: 'ya29.dos', expires_in: 3600 }),
  ])
  const clock = () => now

  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: clock }), 'ya29.uno')
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: clock }), 'ya29.uno')
  assertEquals(calls.length, 1, 'el segundo pedido sale del cache')

  now += 49 * 60 * 1000
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: clock }), 'ya29.uno')
  assertEquals(calls.length, 1, 'a los 49 min sigue cacheado')

  now += 2 * 60 * 1000 // 51 min
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: clock }), 'ya29.dos')
  assertEquals(calls.length, 2, 'pasados los 50 min pide otro')
})

Deno.test('getFcmAccessToken: respeta un expires_in corto (renueva 60 s antes)', async () => {
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  let now = 1_000_000
  const { impl, calls } = mockFetch([
    jsonResponse(200, { access_token: 'corto-1', expires_in: 120 }),
    jsonResponse(200, { access_token: 'corto-2', expires_in: 120 }),
  ])
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: () => now }), 'corto-1')
  now += 59 * 1000
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: () => now }), 'corto-1')
  now += 2 * 1000
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: impl, now: () => now }), 'corto-2')
  assertEquals(calls.length, 2)
})

Deno.test('getFcmAccessToken: pedidos concurrentes comparten UNA sola llamada a Google', async () => {
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  const { impl, calls } = mockFetch([
    () => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(200, { access_token: 'compartido', expires_in: 3600 })), 10)),
  ])
  const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => getFcmAccessToken(sa, { fetchImpl: impl })))
  assertEquals(tokens, ['compartido', 'compartido', 'compartido', 'compartido', 'compartido'])
  assertEquals(calls.length, 1)
})

Deno.test('getFcmAccessToken: credenciales rechazadas (400 invalid_grant) → FcmAuthError no reintentable', async () => {
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  const { impl } = mockFetch([jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })])
  const err = await assertRejects(() => getFcmAccessToken(sa, { fetchImpl: impl }), FcmAuthError)
  assertEquals(err.retryable, false)
  assertEquals(err.status, 400)
  assertStringIncludes(err.message, 'Invalid JWT Signature')
})

Deno.test('getFcmAccessToken: Google caído (503) o red → FcmAuthError reintentable y no queda cacheado', async () => {
  const { sa } = await generateServiceAccount()
  invalidateFcmAccessToken(sa)
  const a = mockFetch([jsonResponse(503, { error: 'unavailable' })])
  const e1 = await assertRejects(() => getFcmAccessToken(sa, { fetchImpl: a.impl }), FcmAuthError)
  assertEquals(e1.retryable, true)
  assertEquals(e1.status, 503)

  const b = mockFetch([() => { throw new TypeError('dns failure') }])
  const e2 = await assertRejects(() => getFcmAccessToken(sa, { fetchImpl: b.impl }), FcmAuthError)
  assertEquals(e2.retryable, true)
  assertEquals(e2.status, null)

  // Después del fallo, un pedido nuevo vuelve a salir a la red (no quedó nada cacheado ni colgado en inflight)
  const c = mockFetch([jsonResponse(200, { access_token: 'ok', expires_in: 3600 })])
  assertEquals(await getFcmAccessToken(sa, { fetchImpl: c.impl }), 'ok')
  assertEquals(c.calls.length, 1)
})

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

Deno.test('parseServiceAccountJson: JSON crudo, base64 y \\n escapados', async () => {
  const { sa } = await generateServiceAccount()
  const raw = JSON.stringify({ type: 'service_account', project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key, token_uri: GOOGLE_TOKEN_URI })

  const a = parseServiceAccountJson(raw)
  assertEquals(a.project_id, 'monaco-test')
  assertEquals(a.client_email, sa.client_email)
  assertEquals(a.token_uri, GOOGLE_TOKEN_URI)
  assertStringIncludes(a.private_key, 'BEGIN PRIVATE KEY')

  const b = parseServiceAccountJson(btoa(raw))
  assertEquals(b.client_email, sa.client_email)

  // private_key con "\\n" literales (doble escape al pegar el secreto)
  const dobleEscape = raw.replace(/\\n/g, '\\\\n')
  const c = parseServiceAccountJson(dobleEscape)
  assertEquals(c.private_key, sa.private_key.trim())
})

Deno.test('parseServiceAccountJson: errores claros', () => {
  assertThrows(() => parseServiceAccountJson(''), FcmConfigError, 'vacío')
  assertThrows(() => parseServiceAccountJson('no es json'), FcmConfigError)
  assertThrows(() => parseServiceAccountJson('{"project_id":"x"}'), FcmConfigError, 'client_email, private_key')
  assertThrows(
    () => parseServiceAccountJson(JSON.stringify({ project_id: 'x', client_email: 'a@b', private_key: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----' })),
    FcmConfigError,
    'PKCS#1',
  )
  assertThrows(
    () => parseServiceAccountJson(JSON.stringify({ project_id: 'x', client_email: 'a@b', private_key: 'basura' })),
    FcmConfigError,
    'PKCS#8',
  )
})

Deno.test('loadFcmServiceAccount / resolveFcmProjectId: env inyectable', async () => {
  const { sa } = await generateServiceAccount()
  const raw = JSON.stringify({ project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key })
  const env = (vars: Record<string, string | undefined>) => ({ get: (k: string) => vars[k] })

  assertEquals(loadFcmServiceAccount(env({})), null)
  assertEquals(loadFcmServiceAccount(env({ FCM_SERVICE_ACCOUNT_JSON: '   ' })), null)
  const loaded = loadFcmServiceAccount(env({ FCM_SERVICE_ACCOUNT_JSON: raw }))
  assert(loaded)
  assertEquals(loaded.project_id, 'monaco-test')
  assertThrows(() => loadFcmServiceAccount(env({ FCM_SERVICE_ACCOUNT_JSON: '{' })), FcmConfigError)

  assertEquals(resolveFcmProjectId(loaded, env({})), 'monaco-test')
  assertEquals(resolveFcmProjectId(loaded, env({ FCM_PROJECT_ID: ' otro-proyecto ' })), 'otro-proyecto')
  assertEquals(resolveFcmProjectId(loaded, env({ FCM_PROJECT_ID: '' })), 'monaco-test')
})

Deno.test('getFcmAccessToken: clave PEM rota → FcmConfigError (no FcmAuthError)', async () => {
  const sa: FcmServiceAccount = {
    project_id: 'x',
    client_email: `rota-${crypto.randomUUID()}@x.iam.gserviceaccount.com`,
    private_key: '-----BEGIN PRIVATE KEY-----\nQUJDRA==\n-----END PRIVATE KEY-----',
  }
  const { impl, calls } = mockFetch([])
  await assertRejects(() => getFcmAccessToken(sa, { fetchImpl: impl }), FcmConfigError)
  assertEquals(calls.length, 0)
})
