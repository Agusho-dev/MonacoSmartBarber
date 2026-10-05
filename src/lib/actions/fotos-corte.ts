'use server'

import { RateLimits } from '@/lib/rate-limit'
import {
  autorizarSubidaPorToken,
  confirmarSubidaPorToken,
  estadoParaCelular,
  type ArchivoDeclarado,
} from '@/lib/fotos-corte/servidor'
import type { EstadoCelular } from '@/lib/fotos-corte/contrato'
import type { RespuestaConfirmarSubida, RespuestaPedirSubida } from '@/lib/types/fotos-corte'

/*
 * Fotos del corte desde el CELULAR del barbero (/upload/[token]). La página no
 * tiene sesión: la llave es el token del QR (una capability de 45 minutos,
 * atada a UN cobro). Nada de esto toca tablas con la anon key: todo pasa por
 * el servidor con service role (src/lib/fotos-corte/servidor.ts).
 *
 * Son server actions (y no la ruta de la tablet) porque en el celular no hay
 * cobro que pueda quedar encolado detrás: el celular sólo saca fotos. Los bytes
 * igual van directo a Storage con una URL firmada.
 *
 * Con límite por IP y por token: es una página pública y el token viaja en un
 * QR que puede quedar a la vista.
 */

const DEMASIADOS = 'Demasiados intentos seguidos. Esperá un momento y probá de nuevo.'

export async function estadoFotosCelular(token: string): Promise<EstadoCelular | { limitado: true }> {
  const gate = await RateLimits.fotosCelularEstado()
  if (!gate.allowed) return { limitado: true }
  return estadoParaCelular(String(token ?? ''))
}

export async function pedirSubidaCelular(token: string, archivo: ArchivoDeclarado): Promise<RespuestaPedirSubida> {
  const t = String(token ?? '')
  const [porToken, porIp] = await Promise.all([
    RateLimits.fotosCelularSubidaPorToken(t),
    RateLimits.fotosCelularSubidaPorIp(),
  ])
  if (!porToken.allowed || !porIp.allowed) return { ok: false, error: DEMASIADOS, motivo: 'datos' }
  return autorizarSubidaPorToken(t, archivo)
}

export async function confirmarSubidaCelular(token: string, ruta: string): Promise<RespuestaConfirmarSubida> {
  const t = String(token ?? '')
  const [porToken, porIp] = await Promise.all([
    RateLimits.fotosCelularSubidaPorToken(t),
    RateLimits.fotosCelularSubidaPorIp(),
  ])
  if (!porToken.allowed || !porIp.allowed) return { ok: false, error: DEMASIADOS, motivo: 'datos' }
  return confirmarSubidaPorToken(t, String(ruta ?? ''))
}
