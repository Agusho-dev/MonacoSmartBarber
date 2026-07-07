// Catálogo de modelos del Asistente IA + helpers de provider.
// Chat: familia GPT-5 de OpenAI (default) + Claude seleccionables.
// Embeddings: OpenAI text-embedding-3-small (1536d).

export type ChatProvider = 'anthropic' | 'openai' | 'openrouter'

export interface AssistantModelOption {
  id: string
  label: string
  provider: ChatProvider
  hint?: string
  recommended?: boolean
}

/**
 * Diccionario de etiquetas de modelos (alineado con el selector visual `MODEL_GROUPS`).
 * `modelLabel()` lo usa para mostrar un nombre lindo en el header/config; para ids que no
 * están acá (ej. custom de OpenRouter) cae al id crudo.
 */
export const ASSISTANT_CHAT_MODELS: AssistantModelOption[] = [
  { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai', hint: 'Recomendado · máxima precisión', recommended: true },
  { id: 'gpt-5.1', label: 'GPT-5.1', provider: 'openai', hint: 'Rápido e inteligente' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai', hint: 'Económico' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai', hint: 'Sin razonamiento · veloz' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', hint: 'Básico' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', hint: 'Legacy · evitar para análisis' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', hint: 'Equilibrio ideal' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', hint: 'Máxima capacidad' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', hint: 'Muy capaz' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', hint: 'Rápido y económico' },
]

// Default seguro para orgs que no eligieron modelo: capaz, universal en keys OpenAI
// modernas, params estándar (sin gotchas de razonamiento). El selector recomienda GPT-5.2.
export const DEFAULT_CHAT_MODEL = 'gpt-4.1'
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

export function providerForModel(model: string): ChatProvider {
  if (model.startsWith('claude')) return 'anthropic'
  if (model.includes('/')) return 'openrouter'
  return 'openai'
}

/**
 * Modelos de razonamiento de OpenAI (familia GPT-5, o1/o3/o4).
 * Tienen dos diferencias de API que rompen "sin fallos" si se ignoran:
 *  1) NO aceptan `temperature` distinta de 1 (error 400 si mandás 0.4).
 *  2) `max_output_tokens` incluye los tokens de razonamiento → hay que dar headroom
 *     o la respuesta sale vacía.
 */
export function isReasoningModel(model: string): boolean {
  return /^gpt-5/.test(model) || /^o[1-4](-|$)/.test(model)
}

/** ¿El modelo acepta el parámetro `temperature`? (los de razonamiento no). */
export function supportsTemperature(model: string): boolean {
  return !isReasoningModel(model)
}

export function modelLabel(id: string): string {
  return ASSISTANT_CHAT_MODELS.find((m) => m.id === id)?.label ?? id
}
