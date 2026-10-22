import 'server-only'

// =============================================================================
// src/lib/tex/cliente.ts
// La clave de Anthropic de Tex y el cliente del SDK oficial.
//
// DE DÓNDE SALE LA CLAVE, EN ORDEN
//   1. organization_ai_config.anthropic_api_key_cifrada → la que el dueño cargó
//      en Configurar Tex, CIFRADA con AES-256-GCM (clave maestra en Vault,
//      `src/lib/crypto/secretos.ts`, la misma de ARCA y Mercado Pago).
//   2. ANTHROPIC_API_KEY del entorno → una clave de la plataforma.
//   3. organization_ai_config.anthropic_api_key → la columna vieja, en texto
//      plano. Tex nunca la escribe: /dashboard/mensajeria hace `select('*')` de
//      esa fila y la manda al navegador (relevamiento, 1.3). Se lee sólo como
//      último recurso para no dejar sin Tex a quien ya la tenía cargada.
//
// La clave NUNCA se loguea ni se devuelve (tampoco truncada): sólo el origen.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'
import { descifrarSecreto } from '@/lib/crypto/secretos'
import { TEX_MODELO, TEX_MODELO_ETIQUETA, type TexOrigenClave } from './contrato'

interface FilaClaves {
  anthropic_api_key_cifrada: string | null
  anthropic_api_key: string | null
}

async function leerFilaClaves(orgId: string): Promise<FilaClaves | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('organization_ai_config')
    .select('anthropic_api_key_cifrada, anthropic_api_key')
    .eq('organization_id', orgId)
    .maybeSingle()
  // Sin poder leer no se sabe si hay clave: "no hay" sería mentir (Known Risk #15).
  if (error) throw new Error(`[tex] no se pudo leer la configuración de la clave: ${error.message}`)
  return (data as FilaClaves | null) ?? null
}

function claveDelEntorno(): string | null {
  const clave = process.env.ANTHROPIC_API_KEY?.trim()
  return clave ? clave : null
}

/**
 * La clave de Anthropic de la organización, EN CLARO. No loguearla ni mandarla
 * al browser. Orden: la cifrada de Tex (organization_ai_config.anthropic_api_key_cifrada)
 * → la variable de entorno ANTHROPIC_API_KEY → la columna vieja en texto plano.
 * null = no hay ninguna. Tira si no pudo leer la configuración.
 */
export async function resolverClaveTex(orgId: string): Promise<{ clave: string; origen: TexOrigenClave } | null> {
  const fila = await leerFilaClaves(orgId)
  if (fila?.anthropic_api_key_cifrada) {
    try {
      const clave = (await descifrarSecreto(fila.anthropic_api_key_cifrada)).trim()
      if (clave) return { clave, origen: 'org' }
    } catch (err) {
      // Mal formada o cifrada con otra clave maestra. Se sigue con las otras fuentes;
      // Configurar Tex muestra el origen real y el dueño la vuelve a cargar.
      console.error('[tex] no se pudo descifrar la clave de Anthropic de la org', orgId, err instanceof Error ? err.message : '')
    }
  }
  const entorno = claveDelEntorno()
  if (entorno) return { clave: entorno, origen: 'entorno' }
  const legado = fila?.anthropic_api_key?.trim()
  if (legado) return { clave: legado, origen: 'legado' }
  return null
}

/** ¿Hay clave? (sin descifrar si no hace falta). Para la página. Tira si no pudo leer. */
export async function origenClaveTex(orgId: string): Promise<TexOrigenClave | null> {
  const fila = await leerFilaClaves(orgId)
  if (fila?.anthropic_api_key_cifrada) return 'org'
  if (claveDelEntorno()) return 'entorno'
  if (fila?.anthropic_api_key?.trim()) return 'legado'
  return null
}

/**
 * El cliente de Tex. El SDK 1.1.0 manda `anthropic-version: 2026-10-21`: con
 * esa versión `temperature`, `top_p` y `top_k` son un 400 en todos los modelos.
 * Los reintentos sólo cubren el arranque del request (antes de que empiece el
 * stream); un corte a mitad de una respuesta lo maneja el motor.
 */
export function crearClienteTex(clave: string): Anthropic {
  return new Anthropic({ apiKey: clave, maxRetries: 2, timeout: 120_000 })
}

/**
 * Valida una clave contra la API sin gastar tokens: `GET /v1/models/claude-haiku-5-5`.
 * 200 = sirve; 401 = Anthropic la rechaza; 403/404 = la clave no tiene acceso al modelo.
 */
export async function probarClaveAnthropic(clave: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cliente = new Anthropic({ apiKey: clave, maxRetries: 1, timeout: 15_000 })
  try {
    await cliente.models.retrieve(TEX_MODELO)
    return { ok: true }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Anthropic rechazó la clave.' }
    if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: `Esa clave no tiene acceso a ${TEX_MODELO_ETIQUETA}.` }
    }
    if (err instanceof Anthropic.APIError && !(err instanceof Anthropic.APIConnectionError)) {
      console.error('[tex] validando una clave de Anthropic:', err.constructor.name, err.status ?? '-', err.type ?? '-')
    }
    return { ok: false, error: 'No pudimos validar la clave. Probá de nuevo.' }
  }
}
