import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/links.ts
// El link que el dueño le manda al titular de una cuenta para que autorice
// desde su celular (/conectar-mp/<token>): un uso, 72 h.
//
// En la base sólo está el SHA-256 del token (un dump no alcanza para usar un
// link). La página es pública, así que lo que devuelve no lleva ningún id
// interno: alias, nombre de pila, nombre de la org, vencimiento y estado.
// =============================================================================

import { createHash, randomBytes } from 'crypto'

import { createAdminClient } from '@/lib/supabase/server'
import type { EstadoLink } from './contrato'
import { CONCILIACION } from './contrato'
import { oauthDisponible } from './oauth'

export interface LinkPublico {
  estado: EstadoLink
  /** Alias de la cuenta a autorizar (monacoparana4). */
  alias: string | null
  /** Nombre de pila del titular cargado en el sistema, para saludarlo. */
  titularNombre: string | null
  orgNombre: string
  /** ISO */
  venceEn: string
  /** La app de OAuth de conciliación está configurada. */
  oauthDisponible: boolean
}

/** 32 bytes base64url = 43 caracteres. */
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function generarTokenLink(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function tokenConFormaValida(token: string | null | undefined): token is string {
  return typeof token === 'string' && RE_TOKEN.test(token)
}

export const HORAS_LINK = CONCILIACION.linkHoras

export interface FilaLink {
  id: string
  organization_id: string
  payment_account_id: string
  expires_at: string
  abierto_at: string | null
  used_at: string | null
  revoked_at: string | null
  mp_cuenta_id: string | null
  resultado: string | null
}

export function estadoDeLink(l: Pick<FilaLink, 'expires_at' | 'abierto_at' | 'used_at' | 'revoked_at' | 'resultado'>): EstadoLink {
  if (l.used_at || l.resultado === 'conectada') return 'conectada'
  if (l.revoked_at) return 'anulado'
  if (new Date(l.expires_at).getTime() <= Date.now()) return 'vencido'
  return l.abierto_at ? 'abierto' : 'pendiente'
}

/** El link por su token (comparando el SHA-256). null si no existe. TIRA si la base falla. */
export async function buscarLinkPorToken(token: string): Promise<FilaLink | null> {
  if (!tokenConFormaValida(token)) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mp_conexion_links')
    .select('id, organization_id, payment_account_id, expires_at, abierto_at, used_at, revoked_at, mp_cuenta_id, resultado')
    .eq('token_hash', hashToken(token))
    .maybeSingle<FilaLink>()
  if (error) throw new Error(`No pudimos leer el link: ${error.message}`)
  return data
}

/**
 * Marca que el titular abrió el link (la primera vez; si dos pestañas lo abren
 * a la vez, queda la primera hora). Sólo un link vigente: usado, anulado o
 * vencido no se toca. Devuelve si quedó marcado; TIRA si la base falla.
 */
export async function marcarAbierto(link: Pick<FilaLink, 'id' | 'abierto_at' | 'used_at' | 'revoked_at' | 'expires_at'>): Promise<boolean> {
  if (link.abierto_at || link.used_at || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) return false
  const { data, error } = await createAdminClient()
    .from('mp_conexion_links')
    .update({ abierto_at: new Date().toISOString() })
    .eq('id', link.id)
    .is('abierto_at', null)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
  if (error) throw new Error(`No pudimos marcar el link como abierto: ${error.message}`)
  return (data ?? []).length > 0
}

function nombreDePila(nombre: string | null | undefined): string | null {
  const t = (nombre ?? '').trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null
}

/**
 * Lee un link por su token (se compara contra el SHA-256 guardado). SÓLO LEE:
 * no marca `abierto_at`. La página corre en el servidor con cualquier GET, y la
 * vista previa que arma WhatsApp al pegar el link (o un escáner de enlaces) lo
 * pide sin que el barbero lo haya tocado: la tarjeta decía "Link abierto"
 * cuando todavía no lo había visto. Lo marca `marcarLinkAbierto`, que llama la
 * página desde el navegador después de hidratar (una vista previa no corre JS).
 */
export async function leerLinkPublico(token: string): Promise<LinkPublico | null> {
  let link: FilaLink | null
  try {
    link = await buscarLinkPorToken(token)
  } catch (e) {
    console.error('[conciliacion-links] leer link:', e instanceof Error ? e.message : e)
    return null
  }
  if (!link) return null

  const supabase = createAdminClient()
  const [{ data: cuenta, error: errCuenta }, { data: org, error: errOrg }] = await Promise.all([
    supabase.from('payment_accounts').select('name, alias_or_cbu').eq('id', link.payment_account_id).maybeSingle<{ name: string | null; alias_or_cbu: string | null }>(),
    supabase.from('organizations').select('name').eq('id', link.organization_id).maybeSingle<{ name: string }>(),
  ])
  if (errCuenta || errOrg) {
    console.error('[conciliacion-links] datos del link:', errCuenta?.message ?? errOrg?.message)
    return null
  }

  return {
    estado: estadoDeLink(link),
    alias: cuenta?.alias_or_cbu?.trim() || null,
    titularNombre: nombreDePila(cuenta?.name),
    orgNombre: org?.name ?? 'La barbería',
    venceEn: link.expires_at,
    oauthDisponible: oauthDisponible(),
  }
}
