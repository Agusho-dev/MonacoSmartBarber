'use server'

// =============================================================================
// Las acciones de la página pública del titular (/conectar-mp/<token>).
// Sin sesión: lo que autoriza es el link vigente (un uso, 72 h, comparado por
// SHA-256), con límite de pedidos por IP para que nadie pruebe tokens a mano.
//   - marcarLinkAbierto: la página la llama desde el navegador, ya hidratada.
//     Una vista previa de WhatsApp o un escáner de enlaces no corren JS: el
//     dueño ve "Link abierto" sólo si lo abrió una persona.
//   - iniciarAutorizacionDesdeLink: devuelve la URL de autorización de Mercado
//     Pago; el resto lo hace el callback.
// =============================================================================

import { getClientIP, rateLimit } from '@/lib/rate-limit'
import { buscarLinkPorToken, estadoDeLink, marcarAbierto } from '@/lib/conciliacion-mp/links'
import { prepararAutorizacion } from '@/lib/conciliacion-mp/oauth'

/**
 * Marca que el titular abrió el link. No devuelve nada que diga si el token
 * existe (no es un oráculo de tokens) y nunca rompe la página: si falla, el
 * link queda como "enviado" y el titular sigue igual.
 */
export async function marcarLinkAbierto(token: string): Promise<void> {
  try {
    const ip = await getClientIP()
    const gate = await rateLimit('mp_link_abierto', ip, { limit: 30, window: 600 })
    if (!gate.allowed) return
    const link = await buscarLinkPorToken(typeof token === 'string' ? token.trim() : '')
    if (link) await marcarAbierto(link)
  } catch (e) {
    console.error('[conectar-mp] marcar abierto:', e instanceof Error ? e.message : e)
  }
}

/** Crea el `state` de OAuth (un uso, 10 min) y devuelve la URL de autorización de Mercado Pago. */
export async function iniciarAutorizacionDesdeLink(
  token: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ip = await getClientIP()
  const gate = await rateLimit('mp_link', ip, { limit: 10, window: 600 })
  if (!gate.allowed) return { ok: false, error: 'Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.' }

  let link
  try {
    link = await buscarLinkPorToken(typeof token === 'string' ? token.trim() : '')
  } catch (e) {
    console.error('[conectar-mp] buscar link:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'No pudimos abrir el link. Probá de nuevo en un momento.' }
  }
  if (!link) return { ok: false, error: 'Este link no existe o venció.' }

  const estado = estadoDeLink(link)
  if (estado === 'conectada') return { ok: false, error: 'Esta cuenta ya quedó conectada.' }
  if (estado === 'vencido' || estado === 'anulado') {
    return { ok: false, error: 'Este link venció. Pedile uno nuevo a quien te lo mandó.' }
  }

  // Tocó "Continuar a Mercado Pago": lo abrió una persona, aunque la marca al cargar no haya llegado.
  try {
    await marcarAbierto(link)
  } catch (e) {
    console.error('[conectar-mp] marcar abierto:', e instanceof Error ? e.message : e)
  }

  const r = await prepararAutorizacion({
    orgId: link.organization_id,
    paymentAccountId: link.payment_account_id,
    linkId: link.id,
    creadoPor: null,
  })
  if (!r.ok) {
    // Al titular no le sirve saber que falta una variable de entorno.
    return { ok: false, error: 'Ahora no se puede autorizar desde este link. Avisale a quien te lo mandó.' }
  }
  return r
}
