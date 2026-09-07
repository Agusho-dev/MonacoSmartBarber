/**
 * Tests de la verificación del `id_token` de Google/Apple.
 *
 * Se firma un token de verdad con una clave RSA generada en el momento y se
 * sirve su JWK con un `fetch` stubbeado: así se ejercitan la firma, el `iss`,
 * el `aud`, el `exp` y el `nonce` sin depender de la red.
 *
 *   deno test supabase/functions/_shared/social_id_token_test.ts
 */

import { assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  esEmailRelayDeApple,
  olvidarJwksEnMemoria,
  parsearListaDeIds,
  verificarIdTokenSocial,
} from './social-id-token.ts'

const KID = 'kid-de-prueba'
const AUD = 'com.monaco.app'

const par = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)
const jwkPublico = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function firmar(payload: Record<string, unknown>, kid = KID): Promise<string> {
  const enc = new TextEncoder()
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(new Uint8Array(firma))}`
}

/** Corre `fn` con el JWKS servido por un `fetch` falso. */
async function conJwks(fn: () => Promise<void>, claves: unknown[] = [jwkPublico]): Promise<void> {
  const original = globalThis.fetch
  olvidarJwksEnMemoria()
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ keys: claves }), { headers: { 'Content-Type': 'application/json' } }))
  try {
    await fn()
  } finally {
    globalThis.fetch = original
    olvidarJwksEnMemoria()
  }
}

const ahora = () => Math.floor(Date.now() / 1000)

function claimsApple(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://appleid.apple.com',
    aud: AUD,
    sub: '001234.abcdef.0000',
    email: 'x@privaterelay.appleid.com',
    email_verified: 'true',
    iat: ahora(),
    exp: ahora() + 600,
    ...extra,
  }
}

Deno.test('token válido: sale la identidad', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple())
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, true)
    if (!r.ok) return
    assertStrictEquals(r.identidad.subject, '001234.abcdef.0000')
    // Apple manda "true" como string: acá ya está normalizado a booleano.
    assertStrictEquals(r.identidad.emailVerified, true)
    assertStrictEquals(r.identidad.name, null)
  })
})

Deno.test('aud de otra app se rechaza', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple({ aud: 'com.otra.app' }))
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
    if (r.ok) return
    assertStrictEquals(r.transitorio, false)
  })
})

Deno.test('iss de otro proveedor se rechaza', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple({ iss: 'https://accounts.google.com' }))
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
  })
})

Deno.test('token vencido se rechaza', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple({ iat: ahora() - 7200, exp: ahora() - 3600 }))
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
  })
})

Deno.test('firma alterada se rechaza', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple())
    const partes = token.split('.')
    // Se cambia el payload dejando la firma vieja.
    const otro = await firmar(claimsApple({ sub: 'otro' }))
    const roto = `${partes[0]}.${otro.split('.')[1]}.${partes[2]}`
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: roto, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
  })
})

Deno.test('alg none se rechaza sin mirar el JWKS', async () => {
  await conJwks(async () => {
    const enc = new TextEncoder()
    const head = b64url(enc.encode(JSON.stringify({ alg: 'none', kid: KID })))
    const body = b64url(enc.encode(JSON.stringify(claimsApple())))
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: `${head}.${body}.`, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
  })
})

Deno.test('nonce: se acepta el valor crudo y su sha256', async () => {
  await conJwks(async () => {
    const crudo = 'nonce-de-prueba'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(crudo))
    let hex = ''
    for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0')

    const conCrudo = await firmar(claimsApple({ nonce: crudo }))
    assertStrictEquals((await verificarIdTokenSocial({ provider: 'apple', idToken: conCrudo, audiencias: [AUD], nonce: crudo })).ok, true)

    const conHash = await firmar(claimsApple({ nonce: hex }))
    assertStrictEquals((await verificarIdTokenSocial({ provider: 'apple', idToken: conHash, audiencias: [AUD], nonce: crudo })).ok, true)

    const otro = await firmar(claimsApple({ nonce: 'cualquier-otra-cosa' }))
    assertStrictEquals((await verificarIdTokenSocial({ provider: 'apple', idToken: otro, audiencias: [AUD], nonce: crudo })).ok, false)
  })
})

Deno.test('sin audiencias configuradas es un error TRANSITORIO, no del usuario', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple())
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [] })
    assertStrictEquals(r.ok, false)
    if (r.ok) return
    assertStrictEquals(r.transitorio, true)
  })
})

Deno.test('JWKS caído sin cache previo: transitorio (503), no "token inválido"', async () => {
  const original = globalThis.fetch
  olvidarJwksEnMemoria()
  globalThis.fetch = () => Promise.reject(new Error('red caída'))
  try {
    const token = await firmar(claimsApple())
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
    if (r.ok) return
    assertStrictEquals(r.transitorio, true)
  } finally {
    globalThis.fetch = original
    olvidarJwksEnMemoria()
  }
})

Deno.test('kid desconocido se rechaza como token inválido', async () => {
  await conJwks(async () => {
    const token = await firmar(claimsApple(), 'kid-que-no-existe')
    const r = await verificarIdTokenSocial({ provider: 'apple', idToken: token, audiencias: [AUD] })
    assertStrictEquals(r.ok, false)
    if (r.ok) return
    assertStrictEquals(r.transitorio, false)
  })
})

Deno.test('parsearListaDeIds limpia, deduplica y tolera vacío', () => {
  assertStrictEquals(parsearListaDeIds(undefined).length, 0)
  assertStrictEquals(parsearListaDeIds('  ').length, 0)
  const l = parsearListaDeIds(' a.apps.googleusercontent.com , b , a.apps.googleusercontent.com ')
  assertStrictEquals(l.length, 2)
  assertStrictEquals(l[0], 'a.apps.googleusercontent.com')
})

Deno.test('esEmailRelayDeApple', () => {
  assertStrictEquals(esEmailRelayDeApple('x@privaterelay.appleid.com'), true)
  assertStrictEquals(esEmailRelayDeApple('x@gmail.com'), false)
  assertStrictEquals(esEmailRelayDeApple(null), false)
})
