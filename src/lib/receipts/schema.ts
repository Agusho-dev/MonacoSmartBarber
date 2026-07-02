import { z } from 'zod'

/**
 * Schema de extracción de un comprobante de transferencia argentino.
 * Cubre transferencia bancaria (CBU), billetera (CVU/alias, Mercado Pago) y
 * pagos. Plano a propósito: es más fácil de completar para el modelo de visión
 * y de mapear a columnas. Todo nullable — el modelo devuelve null, no inventa.
 */
export const comprobanteSchema = z.object({
  tipo_comprobante: z.enum(['transferencia', 'pago', 'deposito', 'otro']).nullable(),
  canal: z.enum(['banco', 'mercado_pago', 'billetera_virtual', 'otro']).nullable(),
  monto: z.number().nullable(),                    // 15000.5 — sin símbolo, punto decimal
  moneda: z.string().nullable(),                   // 'ARS'
  fecha: z.string().nullable(),                    // ISO 8601: '2026-07-02T14:33:00-03:00'
  nro_operacion: z.string().nullable(),            // nº de operación / comprobante
  remitente_nombre: z.string().nullable(),
  remitente_cbu_alias: z.string().nullable(),      // CBU 22 díg o alias del que envía
  destinatario_nombre: z.string().nullable(),
  destinatario_cbu_alias: z.string().nullable(),   // CBU/CVU o alias del que recibe
  banco_o_billetera: z.string().nullable(),        // 'Mercado Pago', 'Banco Galicia', ...
  estado: z.string().nullable(),                   // 'Aprobada' / 'Realizada' si figura
  confianza: z.number().min(0).max(1).nullable(),  // autoevaluación del modelo
})

export type ComprobanteExtraction = z.infer<typeof comprobanteSchema>

/**
 * Forma normalizada que consumen el route handler, la conciliación y la UI.
 * Es el contrato COMÚN a los dos motores (IA Claude y OCR Tesseract), para que
 * el toggle sea transparente aguas abajo.
 */
export interface ExtractedReceipt {
  amount: number | null
  datetime: string | null            // ISO 8601
  operationNumber: string | null
  senderName: string | null
  senderCbuAlias: string | null
  recipientName: string | null
  recipientCbuAlias: string | null
  bankOrWallet: string | null
  canal: string | null
  confidence: number | null
  raw: Record<string, unknown>
}

/** Mapea la salida cruda del modelo de visión al contrato normalizado. */
export function normalizeExtraction(c: ComprobanteExtraction): ExtractedReceipt {
  return {
    amount: c.monto,
    datetime: c.fecha,
    operationNumber: c.nro_operacion,
    senderName: c.remitente_nombre,
    senderCbuAlias: c.remitente_cbu_alias,
    recipientName: c.destinatario_nombre,
    recipientCbuAlias: c.destinatario_cbu_alias,
    bankOrWallet: c.banco_o_billetera ?? c.canal,
    canal: c.canal,
    confidence: c.confianza,
    raw: c as Record<string, unknown>,
  }
}

/** Prompt de extracción para el modelo de visión (path IA/pago). */
export const EXTRACTION_PROMPT =
  'Sos un extractor de datos de comprobantes de transferencia argentinos ' +
  '(bancos, Mercado Pago, billeteras virtuales). Analizá la imagen — que puede ser ' +
  'una foto de la pantalla de un celular, con reflejos — y devolvé los datos. Reglas: ' +
  'monto como número sin símbolo y con punto decimal (15000.50, no "$15.000,50"); ' +
  'IMPORTANTE: el monto es el importe TRANSFERIDO/ENVIADO/PAGADO, NUNCA el saldo, ' +
  'el "dinero disponible" ni el balance "antes y después"; ' +
  'fecha en ISO 8601; CBU/CVU de 22 dígitos; nº de operación tal cual figura; ' +
  'devolvé null en todo campo que no aparezca (NO inventes montos ni números de operación); ' +
  'confianza entre 0 y 1 según qué tan legible estaba la imagen.'
