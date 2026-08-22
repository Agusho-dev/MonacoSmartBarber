#!/usr/bin/env node
/**
 * Crea (una sola vez) el template AUTHENTICATION de WhatsApp que usa la Edge
 * Function `client-auth` para mandar el código de acceso (CONTRACTS.md §2.4).
 *
 * Node 18+ (usa `fetch` nativo). Sin dependencias.
 *
 * Cómo correrlo:
 *
 *   META_ACCESS_TOKEN='EAAG...' META_WABA_ID='1234567890' \
 *     node scripts/meta/crear-template-otp.mjs
 *
 *   - META_ACCESS_TOKEN: token de sistema/usuario con permiso
 *     `whatsapp_business_management` sobre la WABA. Es el mismo
 *     `organization_whatsapp_config.whatsapp_access_token` si ese token tiene
 *     el permiso de administración (el de sólo envío NO alcanza).
 *   - META_WABA_ID: id de la cuenta de WhatsApp Business
 *     (`organization_whatsapp_config.whatsapp_business_id`), NO el phone id.
 *
 * Opcionales:
 *   AUTH_WA_TEMPLATE       nombre del template (default `monaco_codigo_acceso`;
 *                          tiene que coincidir con el secret de la edge function)
 *   AUTH_WA_TEMPLATE_LANG  idioma (default `es`; idem)
 *   --dry-run              imprime el payload y no llama a Meta
 *
 * Qué hace:
 *   1. GET  /{WABA}/message_templates?name=<nombre>  → si ya existe en ese
 *      idioma, imprime su `status` (APPROVED / PENDING / REJECTED) y termina.
 *   2. POST /{WABA}/message_templates con el payload AUTHENTICATION:
 *      BODY con `add_security_recommendation`, FOOTER con
 *      `code_expiration_minutes: 10`, botón OTP `COPY_CODE`.
 *   3. Vuelve a consultar y muestra el `status` final.
 *
 * Los templates AUTHENTICATION suelen aprobarse en segundos/minutos (el texto
 * lo arma Meta; no se puede personalizar más que eso). Mientras esté PENDING,
 * `client-auth` va a responder OTP_DELIVERY_FAILED: conviene correr esto
 * ANTES de deployar la función. Si sale REJECTED, el motivo viene en
 * `rejected_reason`.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

const TOKEN = process.env.META_ACCESS_TOKEN
const WABA = process.env.META_WABA_ID
const NOMBRE = process.env.AUTH_WA_TEMPLATE || 'monaco_codigo_acceso'
const IDIOMA = process.env.AUTH_WA_TEMPLATE_LANG || 'es'
const DRY_RUN = process.argv.includes('--dry-run')

const payload = {
  name: NOMBRE,
  language: IDIOMA,
  category: 'AUTHENTICATION',
  components: [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 10 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
  ],
}

main().catch((e) => {
  console.error('[crear-template-otp] error:', e instanceof Error ? e.message : e)
  process.exit(1)
})

async function main() {
  if (DRY_RUN) {
    console.log(`[dry-run] POST ${GRAPH}/${WABA ?? '{WABA}'}/message_templates`)
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (!TOKEN || !WABA) {
    console.error('Faltan META_ACCESS_TOKEN y/o META_WABA_ID en el entorno.')
    console.error("Uso: META_ACCESS_TOKEN='…' META_WABA_ID='…' node scripts/meta/crear-template-otp.mjs")
    process.exit(2)
  }

  // 1. ¿Ya existe?
  const existente = await buscarTemplate()
  if (existente) {
    console.log(`El template "${NOMBRE}" (${IDIOMA}) ya existe en la WABA ${WABA}.`)
    imprimirEstado(existente)
    return
  }

  // 2. Crear.
  console.log(`Creando template "${NOMBRE}" (${IDIOMA}, AUTHENTICATION) en la WABA ${WABA}…`)
  const res = await fetch(`${GRAPH}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await leerJson(res)
  if (!res.ok) {
    console.error(`Meta respondió HTTP ${res.status}:`)
    imprimirErrorMeta(body)
    // Caso típico: ya existía con otro idioma / carrera con otra corrida.
    if (body?.error?.code === 100 && /already exists/i.test(body?.error?.message ?? '')) {
      const otra = await buscarTemplate()
      if (otra) imprimirEstado(otra)
    }
    process.exit(1)
  }
  console.log(`Creado: id=${body.id ?? '?'} status=${body.status ?? '?'} category=${body.category ?? '?'}`)

  // 3. Estado final (pequeña espera: la aprobación de AUTHENTICATION suele ser inmediata).
  await new Promise((r) => setTimeout(r, 3000))
  const final = await buscarTemplate()
  if (final) imprimirEstado(final)
  else console.log('No se pudo releer el template recién creado (probá de nuevo en un minuto).')
}

/** Devuelve el template con ese nombre e idioma, o `null`. */
async function buscarTemplate() {
  const url = new URL(`${GRAPH}/${WABA}/message_templates`)
  url.searchParams.set('name', NOMBRE)
  url.searchParams.set('fields', 'id,name,language,status,category,rejected_reason,quality_score')
  url.searchParams.set('limit', '50')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const body = await leerJson(res)
  if (!res.ok) {
    console.error(`GET message_templates → HTTP ${res.status}`)
    imprimirErrorMeta(body)
    throw new Error('No se pudo consultar la WABA (token sin permiso whatsapp_business_management o WABA id incorrecto).')
  }
  const lista = Array.isArray(body?.data) ? body.data : []
  // `name` en Meta filtra por prefijo: chequeamos nombre exacto e idioma.
  return lista.find((t) => t.name === NOMBRE && t.language === IDIOMA) ?? null
}

function imprimirEstado(t) {
  console.log(`  id=${t.id}  name=${t.name}  language=${t.language}  category=${t.category}`)
  console.log(`  status=${t.status}${t.rejected_reason && t.rejected_reason !== 'NONE' ? `  rejected_reason=${t.rejected_reason}` : ''}`)
  if (t.status === 'APPROVED') {
    console.log('  Listo: la edge function client-auth ya puede mandar códigos con este template.')
  } else if (t.status === 'PENDING') {
    console.log('  Pendiente de aprobación: volvé a correr el script en unos minutos.')
  } else if (t.status === 'REJECTED') {
    console.log('  Rechazado: revisá el motivo en Business Manager → WhatsApp Manager → Plantillas.')
  }
}

function imprimirErrorMeta(body) {
  const e = body?.error
  if (!e) {
    console.error(JSON.stringify(body, null, 2))
    return
  }
  console.error(`  code=${e.code ?? '-'} subcode=${e.error_subcode ?? '-'} type=${e.type ?? '-'}`)
  console.error(`  message=${e.message ?? '-'}`)
  if (e.error_user_title) console.error(`  user_title=${e.error_user_title}`)
  if (e.error_user_msg) console.error(`  user_msg=${e.error_user_msg}`)
  if (e.error_data?.details) console.error(`  details=${e.error_data.details}`)
  if (e.fbtrace_id) console.error(`  fbtrace_id=${e.fbtrace_id}`)
}

async function leerJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { raw: text }
  }
}
