// Catálogo de modelos del Asistente IA + helpers de provider.
// Chat: Claude (default) con Opus 4.8 / 4.7 / Sonnet 4.6 seleccionables + GPT-4o.
// Embeddings: OpenAI text-embedding-3-small (1536d).

export type ChatProvider = 'anthropic' | 'openai' | 'openrouter'

export interface AssistantModelOption {
  id: string
  label: string
  provider: ChatProvider
  hint?: string
  recommended?: boolean
}

/** Modelos ofrecidos en el selector de la configuración visual. */
export const ASSISTANT_CHAT_MODELS: AssistantModelOption[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', hint: 'Equilibrio ideal', recommended: true },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', hint: 'Máxima capacidad' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', hint: 'Muy capaz' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', hint: 'Rápido y económico' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', hint: 'OpenAI · multimodal' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', hint: 'Rápido y económico' },
]

export const DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

export function providerForModel(model: string): ChatProvider {
  if (model.startsWith('claude')) return 'anthropic'
  if (model.includes('/')) return 'openrouter'
  return 'openai'
}

export function modelLabel(id: string): string {
  return ASSISTANT_CHAT_MODELS.find((m) => m.id === id)?.label ?? id
}
