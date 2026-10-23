import { formatearTelefonoAr } from '../shared/helpers'
import type { ConversationWithRelations } from '../shared/types'

/**
 * El renglón de abajo del nombre, en el encabezado del chat y en la info. del
 * contacto: el teléfono, o el @ de Instagram. Null si no hay nada que mostrar.
 *
 * El teléfono va como lo escribe WhatsApp ("+54 9 351 612-4478"), igual que el
 * nombre de un contacto sin nombre en la lista (displayName): así el encabezado
 * reconoce que son lo mismo y no lo repite.
 */
export function subtituloDeContacto(
  conv: ConversationWithRelations,
): { texto: string; esInstagram: boolean } | null {
  if (conv.channel?.platform === 'instagram') {
    // La ficha del cliente puede tener el usuario con @ o la dirección del perfil.
    const usuario = (conv.client?.instagram || conv.platform_user_handle || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@/, '')
    return { texto: usuario ? `@${usuario}` : 'Instagram', esInstagram: true }
  }
  // La ficha guarda el teléfono como lo cargaron: si no se reconoce, va tal cual.
  if (conv.client?.phone) return { texto: formatearTelefonoAr(conv.client.phone) ?? conv.client.phone, esInstagram: false }
  // WhatsApp manda el número sin el +.
  const digitos = (conv.platform_user_id || '').replace(/\D/g, '')
  return digitos ? { texto: formatearTelefonoAr(digitos) ?? `+${digitos}`, esInstagram: false } : null
}
