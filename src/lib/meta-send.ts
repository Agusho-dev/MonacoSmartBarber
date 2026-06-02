/**
 * Helper compartido para enviar mensajes a la Meta Graph API
 * (WhatsApp Cloud API e Instagram Messaging API) con reintentos ante errores
 * transitorios y captura completa del error de Meta.
 *
 * ── Por qué existe (incidente 02/jun/2026) ──
 * Los envíos de Instagram fallaban de forma TRANSITORIA (rate-limit/5xx de Meta)
 * y el `workflow-engine` NO reintentaba ni guardaba `data.error`: los mensajes
 * quedaban en `status='failed'` con `error_message=NULL` (sin diagnóstico) y el
 * cliente nunca recibía la auto-respuesta. Forense en DB: de 27 conversaciones
 * con fallas, 18 se recuperaban solas en el mismo hilo → confirmado transitorio.
 *
 * Este helper centraliza: timeout, parseo del error de Meta (code/subcode/
 * message/fbtrace_id) y reintento con backoff exponencial SOLO para errores
 * transitorios (no para errores de política/permiso, que reintentar no arregla).
 *
 * No agrega ningún cron (Vercel Hobby limita crons): el reintento es inline.
 */

// Códigos de error de Meta considerados transitorios (reintentar tiene sentido).
//  1  = API Unknown / temporal
//  2  = API Service — servicio temporalmente caído
//  4  = Application request limit reached (rate limit a nivel app)
//  17 = User request limit reached
//  32 = Page request limit reached
//  613= Calls to this API have exceeded the rate limit (custom rate limit)
//  80007 = Instagram rate limit
//  -1 = Error desconocido / red interna de Meta
// (368 "temporarily blocked for policies violations" se EXCLUYE a propósito:
//  reintentar de inmediato no lo resuelve.)
const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 613, 80007, -1])
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504])

export interface MetaSendOutcome {
  ok: boolean
  /** ID del mensaje en la plataforma (null si falló). */
  platformMessageId: string | null
  /** Mensaje de error legible para guardar en messages.error_message (null si ok). */
  errorMessage: string | null
  /** Código de error de Meta, si lo hubo. */
  errorCode: number | null
  /** Cantidad de intentos realizados (1 = no hubo reintentos). */
  attempts: number
}

interface MetaErrorJson {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

function formatMetaError(json: MetaErrorJson, httpStatus: number): { message: string; code: number | null } {
  const err = json?.error
  if (err && (err.message || err.code != null)) {
    const idParts = [
      err.code != null ? `code ${err.code}` : null,
      err.error_subcode != null ? `subcode ${err.error_subcode}` : null,
    ].filter(Boolean).join('/')
    const trace = err.fbtrace_id ? ` · ${err.fbtrace_id}` : ''
    const head = idParts || `HTTP ${httpStatus}`
    return {
      message: `[${head}] ${err.message ?? 'Error de Meta'}${trace}`.slice(0, 500),
      code: typeof err.code === 'number' ? err.code : null,
    }
  }
  return { message: `HTTP ${httpStatus}: ${JSON.stringify(json).slice(0, 300)}`, code: null }
}

function isTransient(httpStatus: number | null, code: number | null): boolean {
  if (httpStatus != null && TRANSIENT_HTTP.has(httpStatus)) return true
  if (code != null && TRANSIENT_META_CODES.has(code)) return true
  return false
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * POSTea a la Meta Graph API con reintentos ante errores transitorios.
 * Devuelve un outcome normalizado (nunca lanza por errores HTTP/red).
 *
 * `extractId` lee el ID del mensaje del JSON exitoso: WhatsApp usa
 * `messages[0].id`, Instagram usa `message_id`.
 */
export async function sendToMeta(opts: {
  url: string
  token: string
  payload: unknown
  extractId: (json: Record<string, unknown>) => string | null | undefined
  maxRetries?: number
  timeoutMs?: number
}): Promise<MetaSendOutcome> {
  const maxRetries = opts.maxRetries ?? 2
  const timeoutMs = opts.timeoutMs ?? 10000
  let lastError = 'Error desconocido al enviar a Meta'
  let lastCode: number | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Backoff exponencial con jitter: ~400ms, ~800ms, cap 2.5s.
      const base = Math.min(400 * 2 ** (attempt - 1), 2000)
      await sleep(base + Math.floor(Math.random() * 250))
    }

    let res: Response
    try {
      res = await fetch(opts.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts.payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      // Timeout / error de red → transitorio: reintentar.
      lastError = `Error de red al contactar Meta API: ${(e as Error).message}`.slice(0, 500)
      lastCode = null
      continue
    }

    let json: Record<string, unknown> = {}
    try {
      json = (await res.json()) as Record<string, unknown>
    } catch {
      json = {}
    }

    const id = opts.extractId(json)
    if (res.ok && id) {
      return { ok: true, platformMessageId: String(id), errorMessage: null, errorCode: null, attempts: attempt + 1 }
    }

    const { message, code } = formatMetaError(json as MetaErrorJson, res.status)
    lastError = message
    lastCode = code

    // Error permanente (política, token inválido, recipient inválido, etc.) → no reintentar.
    if (!isTransient(res.status, code)) break
  }

  return { ok: false, platformMessageId: null, errorMessage: lastError, errorCode: lastCode, attempts: maxRetries + 1 }
}

/** Extractor de ID para respuestas de WhatsApp Cloud API. */
export function extractWhatsAppId(json: Record<string, unknown>): string | null {
  const messages = json?.messages as Array<{ id?: string }> | undefined
  return messages?.[0]?.id ?? null
}

/** Extractor de ID para respuestas de Instagram Messaging API. */
export function extractInstagramId(json: Record<string, unknown>): string | null {
  return (json?.message_id as string | undefined) ?? null
}
