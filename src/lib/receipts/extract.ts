import 'server-only'
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { comprobanteSchema, normalizeExtraction, EXTRACTION_PROMPT, type ExtractedReceipt } from './schema'

// Modelo de visión para el path IA (pago). Sonnet = rápido/barato en el hot path.
// Mismo id que usa el asistente del proyecto (src/lib/asistente/models.ts).
const VISION_MODEL = 'claude-sonnet-4-6'

/**
 * Extrae los datos de un comprobante con Claude vision (path IA / pago).
 * Usa generateObject + Zod → JSON válido garantizado contra el schema.
 * El fetch propio del AI SDK esquiva el timeout de 8s de Supabase.
 */
export async function extractWithAi(
  image: Buffer,
  mediaType: string,
  apiKey: string,
): Promise<ExtractedReceipt> {
  const anthropic = createAnthropic({ apiKey })
  const { object } = await generateObject({
    model: anthropic(VISION_MODEL),
    schema: comprobanteSchema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image', image, mediaType },
        ],
      },
    ],
  })
  return { ...normalizeExtraction(object), raw: { engine: 'ai', ...object } }
}
