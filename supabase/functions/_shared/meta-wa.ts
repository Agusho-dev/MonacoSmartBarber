/**
 * Envío de templates de WhatsApp por Meta Cloud API (Graph API).
 *
 * Un solo punto de salida hacia Meta para las edge functions: arma el payload,
 * pone el timeout, y traduce la respuesta de Meta a un resultado tipado con el
 * `error.code` / `error.message` / `error_data` que Meta devuelve. El caller
 * decide qué hacer con eso (reintentar, borrar el desafío, etc.).
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/template-messages
 */

export const META_API_VERSION = 'v21.0'
export const META_GRAPH_URL = 'https://graph.facebook.com'

const DEFAULT_TIMEOUT_MS = 10_000

/** Parámetro de un componente (texto, imagen, etc.). */
export type MetaTemplateParameter =
  | { type: 'text'; text: string }
  | { type: 'payload'; payload: string }
  | { type: 'image'; image: { link: string } }
  | { type: 'document'; document: { link: string; filename?: string } }
  | { type: 'video'; video: { link: string } }

/** Componente del template (body / header / button). */
export interface MetaTemplateComponent {
  type: 'body' | 'header' | 'button'
  /** Sólo para `type: 'button'`. Meta exige `sub_type` e `index` juntos. */
  sub_type?: 'url' | 'quick_reply' | 'copy_code'
  /** Sólo para `type: 'button'`. Posición del botón en el template (string u número). */
  index?: string | number
  parameters: MetaTemplateParameter[]
}

export interface SendTemplateInput {
  /** Token de acceso de la WABA (`organization_whatsapp_config.whatsapp_access_token`). */
  accessToken: string
  /** Phone number ID del emisor (`organization_whatsapp_config.whatsapp_phone_id`). */
  phoneId: string
  /** Destinatario en dígitos, sin `+` (p. ej. `5493512125249`). */
  to: string
  /** Nombre del template tal como está aprobado en Meta. */
  templateName: string
  /** Código de idioma REGISTRADO en Meta para ese template (`es`, `es_AR`, `en`…). */
  language: string
  components?: MetaTemplateComponent[]
  /** Timeout total del request (default 10 s). */
  timeoutMs?: number
  /** Versión de Graph API (default `META_API_VERSION`). */
  apiVersion?: string
}

/** Error tal como lo devuelve Meta, ya desarmado. */
export interface MetaSendError {
  /** Status HTTP de la respuesta, o `null` si no hubo respuesta (timeout / red). */
  status: number | null
  /** `error.code` de Meta (p. ej. 132001 template inexistente, 131026 destinatario inválido, 190 token vencido). */
  code: number | null
  /** `error.error_subcode`. */
  subcode: number | null
  /** `error.message` (o el motivo de red/timeout). */
  message: string
  /** `error.error_data.details` — el texto largo que explica el motivo. */
  details: string | null
  /** `error.error_user_msg` si viene. */
  userMessage: string | null
  /** `error.fbtrace_id` para reclamar a Meta. */
  fbtraceId: string | null
  /** `true` si tiene sentido reintentar (timeout, red, 429, 5xx). */
  transient: boolean
  /** Cuerpo crudo de la respuesta (para el log). */
  raw: unknown
}

export type SendTemplateResult =
  | { ok: true; messageId: string; status: number; raw: unknown }
  | { ok: false; error: MetaSendError }

interface MetaErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_msg?: string
    error_data?: { details?: string; messaging_product?: string }
    fbtrace_id?: string
  }
  messages?: Array<{ id?: string }>
}

/**
 * Manda un template por Meta Cloud API.
 *
 * No tira excepciones por errores de Meta ni de red: siempre devuelve un
 * `SendTemplateResult`. Sólo puede tirar si los argumentos son inválidos.
 */
export async function sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
  const to = input.to.replace(/\D/g, '')
  if (!to) throw new Error('[meta-wa] `to` vacío')
  if (!input.accessToken || !input.phoneId) throw new Error('[meta-wa] faltan accessToken/phoneId')

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language },
      ...(input.components && input.components.length > 0
        ? { components: input.components.map(normalizarComponente) }
        : {}),
    },
  }

  const url = `${META_GRAPH_URL}/${input.apiVersion ?? META_API_VERSION}/${input.phoneId}/messages`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch (e: unknown) {
    clearTimeout(timer)
    const err = e as { name?: string; message?: string }
    const esTimeout = err?.name === 'AbortError'
    return {
      ok: false,
      error: {
        status: null,
        code: null,
        subcode: null,
        message: esTimeout
          ? `Timeout al contactar Meta API (${input.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms)`
          : `Error de conexión con Meta API: ${err?.message ?? String(e)}`,
        details: null,
        userMessage: null,
        fbtraceId: null,
        transient: true,
        raw: null,
      },
    }
  }
  clearTimeout(timer)

  let body: MetaErrorBody | null = null
  let rawText: string | null = null
  try {
    rawText = await res.text()
    body = rawText ? (JSON.parse(rawText) as MetaErrorBody) : null
  } catch {
    body = null
  }

  const messageId = body?.messages?.[0]?.id
  if (res.ok && messageId) {
    return { ok: true, messageId, status: res.status, raw: body }
  }

  const metaErr = body?.error
  return {
    ok: false,
    error: {
      status: res.status,
      code: typeof metaErr?.code === 'number' ? metaErr.code : null,
      subcode: typeof metaErr?.error_subcode === 'number' ? metaErr.error_subcode : null,
      message: metaErr?.message ?? (res.ok ? 'Meta no devolvió id de mensaje' : `Error HTTP ${res.status} de Meta API`),
      details: metaErr?.error_data?.details ?? null,
      userMessage: metaErr?.error_user_msg ?? null,
      fbtraceId: metaErr?.fbtrace_id ?? null,
      transient: res.status === 429 || res.status >= 500,
      raw: body ?? rawText,
    },
  }
}

/**
 * Componentes para un template AUTHENTICATION (código OTP): el body lleva el
 * código como única variable y el botón `COPY_CODE` (index 0) lo repite.
 * Es el payload exacto de CONTRACTS.md §2.4.
 */
export function componentesOtp(code: string): MetaTemplateComponent[] {
  return [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
  ]
}

/** Formato corto para loguear un error de Meta en una línea. */
export function describirErrorMeta(e: MetaSendError): string {
  const partes = [
    e.status !== null ? `http=${e.status}` : 'http=-',
    e.code !== null ? `code=${e.code}` : null,
    e.subcode !== null ? `subcode=${e.subcode}` : null,
    `msg=${JSON.stringify(e.message)}`,
    e.details ? `details=${JSON.stringify(e.details)}` : null,
    e.fbtraceId ? `fbtrace=${e.fbtraceId}` : null,
  ].filter(Boolean)
  return partes.join(' ')
}

// ── interno ──────────────────────────────────────────────────────────────

/**
 * Un componente de botón sin `sub_type`/`index` es un 400 de Meta; en un
 * componente de body esas claves sobran. Se copian sólo cuando corresponde.
 */
function normalizarComponente(c: MetaTemplateComponent): Record<string, unknown> {
  const out: Record<string, unknown> = { type: c.type, parameters: c.parameters }
  if (c.type === 'button') {
    if (c.sub_type) out.sub_type = c.sub_type
    if (c.index !== undefined) out.index = String(c.index)
  }
  return out
}
