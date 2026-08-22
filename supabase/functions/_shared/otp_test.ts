// Tests de generación/hash/comparación de códigos OTP.
// Correr: deno test --allow-none supabase/functions/_shared/
import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1'
import {
  OTP_LENGTH,
  generarCodigoOtp,
  hashCodigoOtp,
  igualesEnTiempoConstante,
  limpiarCodigoOtp,
} from './otp.ts'

Deno.test('generarCodigoOtp: 6 dígitos, con ceros a la izquierda', () => {
  for (let i = 0; i < 500; i++) {
    const c = generarCodigoOtp()
    assertEquals(c.length, OTP_LENGTH)
    assertMatch(c, /^\d{6}$/)
  }
})

Deno.test('generarCodigoOtp: no devuelve siempre lo mismo', () => {
  const vistos = new Set<string>()
  for (let i = 0; i < 50; i++) vistos.add(generarCodigoOtp())
  assert(vistos.size > 1, 'el generador devolvió un solo valor en 50 corridas')
})

Deno.test('hashCodigoOtp: sha256("code:pepper") en hex, determinista', async () => {
  const h1 = await hashCodigoOtp('123456', 'pepper')
  const h2 = await hashCodigoOtp('123456', 'pepper')
  assertEquals(h1, h2)
  assertMatch(h1, /^[0-9a-f]{64}$/)
  // Vector conocido: echo -n "123456:pepper" | shasum -a 256
  assertEquals(h1, '576344861ab6721db8aff712192e20c53def192e8bac8b58f141401025f21254')
})

Deno.test('hashCodigoOtp: el pepper cambia el hash', async () => {
  const a = await hashCodigoOtp('123456', 'pepper-a')
  const b = await hashCodigoOtp('123456', 'pepper-b')
  assertNotEquals(a, b)
})

Deno.test('hashCodigoOtp: "12:3456" y "123:456" no colisionan con el separador', async () => {
  // sha256("1:23456:p") vs sha256("12:3456:p") — códigos distintos, hashes distintos.
  const a = await hashCodigoOtp('123456', 'p')
  const b = await hashCodigoOtp('123457', 'p')
  assertNotEquals(a, b)
})

Deno.test('igualesEnTiempoConstante', () => {
  assertEquals(igualesEnTiempoConstante('abc', 'abc'), true)
  assertEquals(igualesEnTiempoConstante('abc', 'abd'), false)
  assertEquals(igualesEnTiempoConstante('abc', 'ab'), false)
  assertEquals(igualesEnTiempoConstante('', ''), true)
  assertEquals(igualesEnTiempoConstante('', 'a'), false)
  assertEquals(igualesEnTiempoConstante('ñandú', 'ñandú'), true)
  assertEquals(igualesEnTiempoConstante('ñandú', 'nandu'), false)
})

Deno.test('hash + comparación: el camino real de verify', async () => {
  const pepper = 'x'.repeat(32)
  const code = generarCodigoOtp()
  const guardado = await hashCodigoOtp(code, pepper)
  assertEquals(igualesEnTiempoConstante(await hashCodigoOtp(code, pepper), guardado), true)
  const otro = code === '000000' ? '000001' : '000000'
  assertEquals(igualesEnTiempoConstante(await hashCodigoOtp(otro, pepper), guardado), false)
})

Deno.test('limpiarCodigoOtp', () => {
  assertEquals(limpiarCodigoOtp('123456'), '123456')
  assertEquals(limpiarCodigoOtp(' 123 456 '), '123456')
  assertEquals(limpiarCodigoOtp('123-456'), '123456')
  assertEquals(limpiarCodigoOtp('12345'), null)
  assertEquals(limpiarCodigoOtp('1234567'), null)
  assertEquals(limpiarCodigoOtp('abcdef'), null)
  assertEquals(limpiarCodigoOtp(123456), null)
  assertEquals(limpiarCodigoOtp(null), null)
  assertEquals(limpiarCodigoOtp(undefined), null)
})
