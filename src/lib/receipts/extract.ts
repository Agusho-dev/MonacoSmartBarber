import 'server-only'
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { comprobanteSchema, normalizeExtraction, EXTRACTION_PROMPT, type ExtractedReceipt } from './schema'

export type VisionProvider = 'openai' | 'anthropic'

// Defaults por proveedor. gpt-4o-mini: rápido y barato (centavos por lectura),
// reusa la key de OpenAI que la org ya tiene cargada. Sonnet como alternativa.
export const DEFAULT_OPENAI_VISION = 'gpt-4o-mini'
export const DEFAULT_ANTHROPIC_VISION = 'claude-sonnet-4-6'

export interface VisionOpts {
  provider: VisionProvider
  apiKey: string
  model: string
}

/**
 * Extrae los datos de un comprobante con un modelo de visión (path IA / pago).
 * Provider-flexible: OpenAI (gpt-4o-mini) o Anthropic (Claude). Usa generateObject
 * + Zod → JSON válido garantizado. El fetch propio del AI SDK esquiva el timeout
 * de 8s de Supabase.
 */
export async function extractWithVision(
  image: Buffer,
  mediaType: string,
  opts: VisionOpts,
): Promise<ExtractedReceipt> {
  const model =
    opts.provider === 'openai'
      ? createOpenAI({ apiKey: opts.apiKey })(opts.model)
      : createAnthropic({ apiKey: opts.apiKey })(opts.model)

  const { object } = await generateObject({
    model,
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
  return { ...normalizeExtraction(object), raw: { engine: opts.provider, model: opts.model, ...object } }
}
