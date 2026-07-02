import type { ExtractedReceipt } from './schema'

/**
 * Parser heurístico de comprobantes argentinos a partir del TEXTO crudo que
 * devuelve el motor OCR (Tesseract). Es la "inteligencia" del motor gratuito:
 * determinístico, sin costo, corre en el navegador de la tablet.
 *
 * No pretende ser perfecto — si falla, el comprobante queda 'needs_review' y
 * el admin lo revisa a mano. Pero cubre bien Mercado Pago y apps bancarias AR.
 */

/** '$ 15.300,50' | '15.300,50' | '15300.50' → 15300.5 */
function parseArNumber(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, '').trim()
  if (!s) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // formato AR: '.' miles, ',' decimal
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    // sólo coma → decimal AR
    s = s.replace(',', '.')
  } else if (hasDot) {
    // sólo punto: si hay más de un punto o el grupo final tiene 3 díg, son miles
    const parts = s.split('.')
    if (parts.length > 2 || (parts[1]?.length === 3)) s = parts.join('')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Convierte fecha AR (dd/mm/yyyy [hh:mm]) a ISO best-effort. */
function parseArDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/)
  if (!m) return null
  const [, d, mo, yRaw] = m
  const y = yRaw.length === 2 ? '20' + yRaw : yRaw
  const time = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/)
  const hh = time ? time[1].padStart(2, '0') : '00'
  const mm = time ? time[2] : '00'
  const dd = d.padStart(2, '0')
  const MM = mo.padStart(2, '0')
  const iso = `${y}-${MM}-${dd}T${hh}:${mm}:00-03:00`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function detectCanal(t: string): string | null {
  const l = t.toLowerCase()
  if (/mercado\s*pago|mercadopago/.test(l)) return 'mercado_pago'
  if (/ual[aá]|brubank|naranja\s*x|prex|personal\s*pay|cuenta\s*dni|mmodo/.test(l)) return 'billetera_virtual'
  if (/banco|galicia|santander|bbva|macro|naci[oó]n|provincia|itau|hsbc|supervielle|comafi|patagonia|credicoop/.test(l)) return 'banco'
  return null
}

const AMOUNT_LABEL = /(?:monto|importe|total|transferiste|enviaste|pagaste)[^\d$]{0,20}(\$?\s?[\d.]+(?:,\d{1,2})?)/i
const ANY_AMOUNT = /\$\s?([\d]{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g
const OP_NUMBER = /(?:n[°º.]?\s*(?:de\s*)?(?:operaci[oó]n|comprobante|transacci[oó]n|referencia|control)|c[oó]digo(?:\s*de\s*transferencia)?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/i
const CBU_CVU = /\b(\d{22})\b/g
const ALIAS = /alias\s*[:\-]?\s*([a-zA-Z0-9][a-zA-Z0-9.\-]{3,})/i

/** Parsea el texto OCR de un comprobante AR a la forma normalizada. */
export function parseComprobanteAR(text: string): ExtractedReceipt {
  const clean = text.replace(/ /g, ' ')

  // Monto: preferir el que está junto a una etiqueta; si no, el mayor plausible.
  let amount: number | null = null
  const labeled = clean.match(AMOUNT_LABEL)
  if (labeled) amount = parseArNumber(labeled[1])
  if (amount == null) {
    const all = [...clean.matchAll(ANY_AMOUNT)].map((m) => parseArNumber(m[1])).filter((n): n is number => n != null)
    if (all.length) amount = Math.max(...all)
  }

  const op = clean.match(OP_NUMBER)?.[1] ?? null
  const cbus = [...clean.matchAll(CBU_CVU)].map((m) => m[1])
  const alias = clean.match(ALIAS)?.[1] ?? null

  // Señales de confianza: cuántos campos fuertes encontramos.
  const strong = [amount != null, op != null, cbus.length > 0 || alias != null].filter(Boolean).length
  const confidence = strong >= 2 ? 0.6 : strong === 1 ? 0.35 : 0.15

  return {
    amount,
    datetime: parseArDate(clean),
    operationNumber: op,
    senderName: null,                       // difícil de atribuir por texto plano
    senderCbuAlias: cbus[0] ?? null,
    recipientName: null,
    recipientCbuAlias: alias ?? cbus[1] ?? null,
    bankOrWallet: null,
    canal: detectCanal(clean),
    confidence,
    raw: { engine: 'ocr_local', text: clean.slice(0, 4000), cbus, alias, op },
  }
}
