/**
 * Tests de `apple-token.ts`. Correr con:
 *   deno test --allow-net=appleid.apple.com supabase/functions/_shared/apple_token_test.ts
 *
 * No hace falta la clave real de Apple: se genera un par P-256 con WebCrypto y
 * se exporta a PKCS#8/PEM, que es exactamente la forma del `.p8`. Lo que se
 * verifica es lo que se puede romper sin darse cuenta: la forma del JWT, que la
 * firma valide, que el PEM se parsee con y sin saltos escapados, y que la falta
 * de secrets NO se reporte como un error de la cuenta del cliente.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  armarClientSecret,
  canjearAuthorizationCode,
  credencialesApple,
  estaConfigurado,
  revocarRefreshToken,
  type CredencialesApple,
} from './apple-token.ts'

// ── Utilidades ─────────────────────────────────────────────────────────────

async function parDePrueba(): Promise<{ pem: string; publica: CryptoKey }> {
  const par = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  let b64 = ''
  for (const b of pkcs8) b64 += String.fromCharCode(b)
  const cuerpo = btoa(b64).replace(/(.{64})/g, '$1\n')
  const pem = `-----BEGIN PRIVATE KEY-----\n${cuerpo}\n-----END PRIVATE KEY-----\n`
  return { pem, publica: par.publicKey }
}

function credConPem(pem: string): CredencialesApple {
  return { teamId: 'TEAM123456', keyId: 'KEY7890AB', privateKeyPem: pem, clientId: 'com.monacobarber.monacoMobile' }
}

function decodificar(parte: string): Record<string, unknown> {
  const b64 = parte.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return JSON.parse(atob(relleno))
}

function bytesDeBase64Url(parte: string): Uint8Array {
  const b64 = parte.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(relleno)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── El client_secret ───────────────────────────────────────────────────────

Deno.test('el client_secret tiene la forma que pide Apple', async () => {
  const { pem } = await parDePrueba()
  const jwt = await armarClientSecret(credConPem(pem), 1_700_000_000)
  const [h, p, s] = jwt.split('.')
  assertEquals(jwt.split('.').length, 3)

  const header = decodificar(h)
  assertEquals(header.alg, 'ES256')
  assertEquals(header.typ, 'JWT')
  assertEquals(header.kid, 'KEY7890AB', 'el kid identifica qué clave firmó: sin él Apple no puede validar')

  const payload = decodificar(p)
  assertEquals(payload.iss, 'TEAM123456')
  assertEquals(payload.sub, 'com.monacobarber.monacoMobile', 'para el flujo nativo el sub es el bundle id')
  assertEquals(payload.aud, 'https://appleid.apple.com')
  assertEquals(payload.iat, 1_700_000_000)
  assertEquals(payload.exp, 1_700_000_300, 'vida corta: el JWT se arma para una sola llamada')

  // ES256 en JWS va en formato P1363 (r||s): 64 bytes exactos, NO DER.
  assertEquals(bytesDeBase64Url(s).length, 64)
})

Deno.test('la firma del client_secret valida con la clave pública', async () => {
  const { pem, publica } = await parDePrueba()
  const jwt = await armarClientSecret(credConPem(pem), 1_700_000_000)
  const [h, p, s] = jwt.split('.')
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publica,
    bytesDeBase64Url(s) as unknown as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
  )
  assert(ok, 'si esto falla, Apple contesta invalid_client y el canje nunca funciona')
})

Deno.test('un PEM pegado en una sola línea con \\n escapados también sirve', async () => {
  const { pem } = await parDePrueba()
  const enUnaLinea = pem.replace(/\n/g, '\\n')
  const jwt = await armarClientSecret(credConPem(enUnaLinea), 1_700_000_000)
  assertEquals(jwt.split('.').length, 3, 'pegar el .p8 en el panel de secrets suele escapar los saltos')
})

// ── Configuración ──────────────────────────────────────────────────────────

Deno.test('sin los tres secrets, no está configurado', () => {
  const vacio = () => undefined
  assertEquals(credencialesApple(vacio), null)
  assertEquals(estaConfigurado(vacio), false)
})

Deno.test('el clientId cae al bundle id cuando no se declara', () => {
  const env = (k: string) =>
    ({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P' })[k]
  assertEquals(credencialesApple(env)?.clientId, 'com.monacobarber.monacoMobile')
})

Deno.test('falta un secret y falla ABIERTO, marcado como no configurado', async () => {
  const canje = await canjearAuthorizationCode('c0d1g0', { cred: null })
  assertEquals(canje.ok, false)
  assert(!canje.ok && canje.noConfigurado === true,
    'el caller tiene que poder distinguir "no está configurado" de "Apple rechazó": lo primero no puede hacer fallar el login')

  const revoca = await revocarRefreshToken('rt', { cred: null })
  assertEquals(revoca.ok, false)
  assert(!revoca.ok && revoca.noConfigurado === true)
})

// ── Canje y revocación, con Apple simulado ─────────────────────────────────

Deno.test('el canje manda el form que Apple espera y devuelve el refresh token', async () => {
  const { pem } = await parDePrueba()
  let visto: { url: string; body: URLSearchParams } | null = null
  const fetchFalso = ((url: string, init: RequestInit) => {
    visto = { url: String(url), body: new URLSearchParams(String(init.body)) }
    return Promise.resolve(new Response(JSON.stringify({ refresh_token: 'rt_abc', access_token: 'at' }), { status: 200 }))
  }) as unknown as typeof fetch

  const r = await canjearAuthorizationCode('c0d1g0', { cred: credConPem(pem), fetchImpl: fetchFalso })
  assert(r.ok && r.refreshToken === 'rt_abc')
  assertEquals(visto!.url, 'https://appleid.apple.com/auth/token')
  assertEquals(visto!.body.get('grant_type'), 'authorization_code')
  assertEquals(visto!.body.get('code'), 'c0d1g0')
  assertEquals(visto!.body.get('client_id'), 'com.monacobarber.monacoMobile')
  assert((visto!.body.get('client_secret') ?? '').split('.').length === 3)
})

Deno.test('si Apple no devuelve refresh_token, es un fallo explícito', async () => {
  const { pem } = await parDePrueba()
  const fetchFalso = (() => Promise.resolve(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))) as unknown as typeof fetch
  const r = await canjearAuthorizationCode('c0d1g0', { cred: credConPem(pem), fetchImpl: fetchFalso })
  assertEquals(r.ok, false)
  assert(!r.ok && r.motivo.includes('refresh_token'))
})

Deno.test('un 400 de Apple no se confunde con un problema de configuración', async () => {
  const { pem } = await parDePrueba()
  const fetchFalso = (() => Promise.resolve(new Response('{"error":"invalid_grant"}', { status: 400 }))) as unknown as typeof fetch
  const r = await canjearAuthorizationCode('viejo', { cred: credConPem(pem), fetchImpl: fetchFalso })
  assertEquals(r.ok, false)
  assert(!r.ok && r.noConfigurado === undefined, 'noConfigurado sólo cuando faltan los secrets')
  assert(!r.ok && r.motivo.includes('400'))
})

Deno.test('la revocación toma el 200 con cuerpo vacío como éxito', async () => {
  const { pem } = await parDePrueba()
  let visto: URLSearchParams | null = null
  const fetchFalso = ((_u: string, init: RequestInit) => {
    visto = new URLSearchParams(String(init.body))
    return Promise.resolve(new Response('', { status: 200 }))
  }) as unknown as typeof fetch

  const r = await revocarRefreshToken('rt_abc', { cred: credConPem(pem), fetchImpl: fetchFalso })
  assert(r.ok, 'Apple contesta 200 sin cuerpo: parsear JSON acá tiraría y se leería como fallo')
  assertEquals(visto!.get('token'), 'rt_abc')
  assertEquals(visto!.get('token_type_hint'), 'refresh_token')
})

Deno.test('una caída de red no se traga: se reporta con motivo', async () => {
  const { pem } = await parDePrueba()
  const fetchFalso = (() => Promise.reject(new Error('connection refused'))) as unknown as typeof fetch
  const r = await revocarRefreshToken('rt', { cred: credConPem(pem), fetchImpl: fetchFalso })
  assertEquals(r.ok, false)
  assert(!r.ok && r.motivo.includes('red:'))
})
