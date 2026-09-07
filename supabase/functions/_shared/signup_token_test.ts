/**
 * Tests del `signup_token` (HMAC autocontenido, 15 minutos).
 *
 *   deno test supabase/functions/_shared/signup_token_test.ts
 */

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { firmarSignupToken, verificarSignupToken, type SignupTokenPayload } from './signup-token.ts'

const SECRETO = 'un-secreto-de-prueba-suficientemente-largo'
const OTRO = 'otro-secreto-distinto-igual-de-largo-1234'

const PAYLOAD: SignupTokenPayload = {
  provider: 'apple',
  subject: '001234.abcdef0123456789.0000',
  email: 'alguien@privaterelay.appleid.com',
  name: 'Nacho Baldovino',
  orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
}

Deno.test('ida y vuelta: lo que se firma es lo que se lee', async () => {
  const token = await firmarSignupToken(PAYLOAD, SECRETO, 900)
  const r = await verificarSignupToken(token, SECRETO)
  assertStrictEquals(r.ok, true)
  if (!r.ok) return
  assertEquals(r.payload, PAYLOAD)
})

Deno.test('otro secreto no lo valida', async () => {
  const token = await firmarSignupToken(PAYLOAD, SECRETO, 900)
  const r = await verificarSignupToken(token, OTRO)
  assertStrictEquals(r.ok, false)
  if (r.ok) return
  assertStrictEquals(r.vencido, false)
})

Deno.test('un payload manipulado no valida (la firma cubre el cuerpo)', async () => {
  const token = await firmarSignupToken(PAYLOAD, SECRETO, 900)
  const [v, cuerpo, firma] = token.split('.')
  const json = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
  json.s = 'otro-subject'
  const cuerpoRoto = btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const r = await verificarSignupToken(`${v}.${cuerpoRoto}.${firma}`, SECRETO)
  assertStrictEquals(r.ok, false)
})

Deno.test('vencido se distingue de inválido', async () => {
  const token = await firmarSignupToken(PAYLOAD, SECRETO, -1)
  const r = await verificarSignupToken(token, SECRETO)
  assertStrictEquals(r.ok, false)
  if (r.ok) return
  assertStrictEquals(r.vencido, true)
})

Deno.test('basura y formas raras no tiran', async () => {
  for (const t of ['', 'nada', 'v1.solo-dos', 'v2.a.b', 'v1..', 'v1.###.###']) {
    const r = await verificarSignupToken(t, SECRETO)
    assertStrictEquals(r.ok, false, `debería rechazar ${JSON.stringify(t)}`)
  }
})
