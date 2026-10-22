// =============================================================================
// src/lib/tex/titulo.ts
// El título corto que Tex le pone a una conversación en su primer turno
// ("Resultado de octubre en Paraná"). Es lo que se lee en el historial.
//
// Una llamada chica a Claude Haiku 5.5, en paralelo al turno: sin pensamiento
// (`thinking: disabled` sólo se acepta con effort hasta 'high'; se usa 'low'),
// 60 tokens y 6 segundos. Si falla o tarda, quedan las primeras palabras del
// mensaje: el historial nunca se queda sin título por esto.
//
// `tituloProvisorio` es el que se guarda al crear la conversación, antes de
// que exista el bueno.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk'
import { TEX_MODELO, type TexUso } from './contrato'
import { sumarPedido, usoVacio } from './costo'

const MAX_TITULO = 80

/** Las primeras 60 letras del mensaje: el título mientras Tex no puso el suyo. */
export function tituloProvisorio(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (!limpio) return 'Nueva conversación'
  return limpio.length <= 60 ? limpio : `${limpio.slice(0, 59).trimEnd()}…`
}

/** Si Claude no contesta: las primeras palabras del mensaje, sin signos sueltos. */
export function tituloDeRespaldo(texto: string): string {
  const palabras = texto
    .replace(/[¿?¡!.,;:"«»“”]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
  if (palabras.length === 0) return 'Nueva conversación'
  const frase = palabras.join(' ')
  const recortada = frase.length > 60 ? `${frase.slice(0, 59).trimEnd()}…` : frase
  return recortada.charAt(0).toLocaleUpperCase('es-AR') + recortada.slice(1)
}

/**
 * Limpia lo que devolvió el modelo: sin comillas, sin "Título:", sin punto
 * final, una sola línea. null si no sirve (vacío o más de 8 palabras: no
 * siguió la consigna y es preferible el respaldo).
 */
export function limpiarTitulo(crudo: string): string | null {
  let t = crudo.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  t = t.replace(/^(t[ií]tulo)\s*:\s*/i, '')
  t = t.replace(/^[\s"'«“*#]+|[\s"'»”*]+$/g, '')
  t = t.replace(/[.!¡]+$/g, '').trim()
  if (!t) return null
  if (t.split(/\s+/).length > 8) return null
  if (t.length > MAX_TITULO) t = `${t.slice(0, MAX_TITULO - 1).trimEnd()}…`
  return t.charAt(0).toLocaleUpperCase('es-AR') + t.slice(1)
}

export async function generarTituloTex(
  cliente: Pick<Anthropic, 'messages'>,
  texto: string,
  signal: AbortSignal,
): Promise<{ titulo: string; uso: TexUso | null }> {
  const respaldo = tituloDeRespaldo(texto)
  if (signal.aborted) return { titulo: respaldo, uso: null }
  try {
    // `satisfies`: `create` tiene sobrecargas y esto asegura que no viaje
    // `temperature`, `top_p` ni `top_k` (400 con anthropic-version 2026-10-21).
    const params = {
      model: TEX_MODELO,
      max_tokens: 60,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system:
        'Ponés títulos a conversaciones entre el dueño de una barbería y su asistente de negocio. Respondé SOLO con el título: de 3 a 6 palabras, en español rioplatense, sin comillas, sin emojis y sin punto final.',
      messages: [
        {
          role: 'user',
          content: `Primer mensaje de la conversación:\n«${texto.slice(0, 600)}»\n\nEscribí el título.`,
        },
      ],
    } satisfies Anthropic.MessageCreateParamsNonStreaming
    const r = await cliente.messages.create(params, { signal, timeout: 6_000, maxRetries: 0 })
    const crudo = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ')
    // Tokens y costo de este pedido (con su tarifa: el del título nunca pasa los 100K).
    const uso: TexUso = usoVacio()
    sumarPedido(uso, r.usage)
    return { titulo: limpiarTitulo(crudo) ?? respaldo, uso }
  } catch {
    // Sin log del error: puede traer el request entero, y un título que falla no es noticia.
    return { titulo: respaldo, uso: null }
  }
}
