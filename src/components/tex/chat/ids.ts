// Ids de conversación y de mensaje. Módulo sin dependencias a propósito: lo
// usa el panel lateral liviano (que vive en el shell) y no tiene que arrastrar
// el contrato, zod ni el AI SDK.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s)
}

/**
 * UUID v4 (assistant_conversations.id y assistant_messages.id son uuid).
 * `randomUUID` sólo existe en contextos seguros; `getRandomValues`, en todos.
 */
export function nuevoUuid(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
