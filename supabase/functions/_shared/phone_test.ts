// Tests de la normalización de teléfonos (CONTRACTS.md §2.3).
// Correr: deno test --allow-none supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { nombreEsPlaceholder, normalizarTelefonoAR, phoneTail, primerNombre } from './phone.ts'

const CORDOBA = {
  e164: '+5493512125249',
  national10: '3512125249',
  whatsapp: '5493512125249',
  masked: '+54 9 351 ••• 5249',
}

Deno.test('10 dígitos nacionales → móvil argentino canónico', () => {
  assertEquals(normalizarTelefonoAR('3512125249'), CORDOBA)
  assertEquals(phoneTail(CORDOBA.whatsapp), '3512125249')
})

Deno.test('+54 9 con espacios y guiones', () => {
  assertEquals(normalizarTelefonoAR('+54 9 351 212-5249'), CORDOBA)
})

Deno.test('549 + 10 dígitos sin +', () => {
  assertEquals(normalizarTelefonoAR('5493512125249'), CORDOBA)
})

Deno.test('54 + 10 dígitos sin el 9 → se agrega el 9', () => {
  assertEquals(normalizarTelefonoAR('543512125249'), CORDOBA)
})

Deno.test('0 troncal se descarta', () => {
  assertEquals(normalizarTelefonoAR('0351 212-5249'), CORDOBA)
})

Deno.test('9 + 10 dígitos sin país', () => {
  assertEquals(normalizarTelefonoAR('93512125249'), CORDOBA)
})

Deno.test('+54 sin el 9 también normaliza', () => {
  assertEquals(normalizarTelefonoAR('+54 351 212 5249'), CORDOBA)
})

Deno.test('0054 equivale a +54', () => {
  assertEquals(normalizarTelefonoAR('0054 9 351 212 5249'), CORDOBA)
})

Deno.test('teléfono de prueba 1100000000', () => {
  assertEquals(normalizarTelefonoAR('1100000000'), {
    e164: '+5491100000000',
    national10: '1100000000',
    whatsapp: '5491100000000',
    masked: '+54 9 110 ••• 0000',
  })
  assertEquals(phoneTail('5491100000000'), '1100000000')
})

Deno.test('8 dígitos (fijo sin característica) → sin national10, sin el 9', () => {
  const r = normalizarTelefonoAR('42123456')
  assertEquals(r, {
    e164: '+5442123456',
    national10: null,
    whatsapp: '5442123456',
    masked: '+54 4 ••• 3456',
  })
  // phone_tail = últimos 10 del whatsapp (acá son todos)
  assertEquals(phoneTail(r!.whatsapp), '5442123456')
})

Deno.test('9 dígitos (fijo sin característica)', () => {
  assertEquals(normalizarTelefonoAR('421234567'), {
    e164: '+54421234567',
    national10: null,
    whatsapp: '54421234567',
    masked: '+54 42 ••• 4567',
  })
})

Deno.test('7 dígitos → inválido (menos de 8)', () => {
  assertEquals(normalizarTelefonoAR('4212345'), null)
})

Deno.test('otro país con + → e164 tal cual, sin national10', () => {
  const r = normalizarTelefonoAR('+1 415 555 2671')
  assertEquals(r, {
    e164: '+14155552671',
    national10: null,
    whatsapp: '14155552671',
    masked: '+1415 ••• 2671',
  })
  assertEquals(phoneTail(r!.whatsapp), '4155552671')
})

Deno.test('otro país que empieza con 9 y tiene 11 dígitos NO se confunde con móvil AR', () => {
  // Sri Lanka +94 71 234 5678
  const r = normalizarTelefonoAR('+94712345678')
  assertEquals(r?.e164, '+94712345678')
  assertEquals(r?.national10, null)
  assertEquals(r?.whatsapp, '94712345678')
})

Deno.test('menos de 8 dígitos → null', () => {
  assertEquals(normalizarTelefonoAR('123'), null)
  assertEquals(normalizarTelefonoAR(''), null)
  assertEquals(normalizarTelefonoAR('   '), null)
  assertEquals(normalizarTelefonoAR('+54'), null)
})

Deno.test('formas que no se pueden interpretar → null (no se adivina)', () => {
  // 11 dígitos que no empiezan con 9 ni son 0-troncal
  assertEquals(normalizarTelefonoAR('35121252490'), null)
  // 12 dígitos sin 54 y sin +
  assertEquals(normalizarTelefonoAR('919876543210'), null)
  // 14 dígitos
  assertEquals(normalizarTelefonoAR('55493512125249'), null)
})

Deno.test('el enmascarado oculta 3 dígitos antes de los últimos 4', () => {
  assertEquals(normalizarTelefonoAR('1145678901')?.masked, '+54 9 114 ••• 8901')
})

Deno.test('nombreEsPlaceholder / primerNombre', () => {
  assertEquals(nombreEsPlaceholder(''), true)
  assertEquals(nombreEsPlaceholder('   '), true)
  assertEquals(nombreEsPlaceholder('3512125249'), true)
  assertEquals(nombreEsPlaceholder('+54 9 351 212-5249'), true)
  assertEquals(nombreEsPlaceholder('.'), true)
  assertEquals(nombreEsPlaceholder('Sin nombre'), true)
  assertEquals(nombreEsPlaceholder(null), true)
  assertEquals(nombreEsPlaceholder('Ignacio Baldovino'), false)
  assertEquals(nombreEsPlaceholder('M4ti'), false)
  assertEquals(primerNombre('Ignacio Baldovino'), 'Ignacio')
  assertEquals(primerNombre('  Juan  '), 'Juan')
  assertEquals(primerNombre('3512125249'), null)
  assertEquals(primerNombre(null), null)
})
