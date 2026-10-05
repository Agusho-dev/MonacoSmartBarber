/**
 * /api/fotos-corte/entradas/[id] — las fotos del corte de UNA entrada de la fila.
 *
 * Lo usan la tablet del barbero y el dashboard (/dashboard/fila, la agenda):
 * el diálogo de cobro es el mismo. Se autentica por cookies —la firmada del
 * barbero o la sesión de Supabase Auth— con el mismo criterio que la venta de
 * productos (resolverEntradaConAcceso).
 *
 *   GET   → la sesión vigente y TODAS las fotos del cobro (para el polling del
 *           QR y para retomar el cobro después de una recarga).
 *   POST  → { accion: 'abrir' | 'pedir' | 'confirmar' | 'quitar' | 'vincular'
 *                    | 'descartar' (una foto quitada antes de confirmarla)
 *                    | 'descartar_todo' (un corte que se cierra sin cobro) }
 *
 * POR QUÉ UN ROUTE HANDLER Y NO SERVER ACTIONS
 * --------------------------------------------
 * Next 16 ejecuta las server actions de a una por cliente: con las fotos por
 * action, `completeService` quedaba encolado detrás de cada subida, de cada
 * confirmación y de cada consulta del QR, y una confirmación colgada por el
 * wifi de la tablet dejaba el botón de Cobrar en "Procesando…" sin límite. Un
 * fetch a esta ruta corre en paralelo y lleva su propio timeout: la plata nunca
 * espera a las fotos. De paso, una ruta no cambia de id con cada deploy (los
 * ids de las actions sí), así que una tablet con el bundle viejo sigue andando.
 *
 * CSRF: las cookies son SameSite=Lax (no viajan en un POST de otro sitio) y,
 * además, si el navegador manda Origin tiene que ser el nuestro.
 */
import { NextResponse, type NextRequest } from 'next/server'
import {
  abrirSesionDeFotos,
  autorizarSubidaDeEntrada,
  confirmarSubidaDeEntrada,
  descartarFotosDeEntrada,
  descartarSubidaDeEntrada,
  fotosDeEntrada,
  quitarFotoDeEntrada,
  resolverEntradaConAcceso,
  vincularFotosDeEntrada,
} from '@/lib/fotos-corte/servidor'
import type { PedidoDeFotos } from '@/lib/fotos-corte/contrato'
import type { ErrorFotos, MotivoErrorFotos } from '@/lib/types/fotos-corte'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Contexto = { params: Promise<{ id: string }> }

const STATUS_DE_MOTIVO: Record<MotivoErrorFotos, number> = {
  datos: 400,
  sesion: 401,
  acceso: 403,
  entrada: 404,
  cobro_cerrado: 409,
  vencida: 409,
  tope: 409,
  formato: 422,
  pesada: 422,
  no_subida: 422,
  version: 409,
  red: 503,
  servidor: 503,
}

function responder(cuerpo: { ok: true } | ErrorFotos, status?: number) {
  const codigo = status ?? (cuerpo.ok ? 200 : STATUS_DE_MOTIVO[cuerpo.motivo] ?? 400)
  return NextResponse.json(cuerpo, { status: codigo, headers: { 'Cache-Control': 'no-store' } })
}

function errorDePedido(error: string): ErrorFotos {
  return { ok: false, error, motivo: 'datos' }
}

/** Si el navegador dice de dónde viene, tiene que ser de acá. */
function origenValido(req: NextRequest): boolean {
  const origen = req.headers.get('origin')
  if (!origen) return true
  try {
    return new URL(origen).host === req.nextUrl.host
  } catch {
    return false
  }
}

export async function GET(_req: NextRequest, ctx: Contexto) {
  const { id } = await ctx.params
  const acceso = await resolverEntradaConAcceso(id)
  if (!acceso.ok) {
    const { status, ...error } = acceso
    return responder(error, status)
  }
  return responder(await fotosDeEntrada(acceso.admin, acceso.entrada))
}

export async function POST(req: NextRequest, ctx: Contexto) {
  if (!origenValido(req)) return responder(errorDePedido('Pedido rechazado.'), 403)

  // Los pedidos son chiquitos (nunca llevan la foto): más de 2 KB es basura.
  const texto = await req.text().catch(() => '')
  if (!texto || texto.length > 2048) return responder(errorDePedido('El pedido llegó mal.'))
  let pedido: PedidoDeFotos
  try {
    pedido = JSON.parse(texto) as PedidoDeFotos
  } catch {
    return responder(errorDePedido('El pedido llegó mal.'))
  }
  if (!pedido || typeof pedido !== 'object' || typeof pedido.accion !== 'string') {
    return responder(errorDePedido('El pedido llegó mal.'))
  }

  const { id } = await ctx.params
  const acceso = await resolverEntradaConAcceso(id)
  if (!acceso.ok) {
    const { status, ...error } = acceso
    return responder(error, status)
  }
  const { admin, entrada } = acceso

  switch (pedido.accion) {
    case 'abrir':
      return responder(await abrirSesionDeFotos(admin, entrada))
    case 'pedir':
      return responder(
        await autorizarSubidaDeEntrada(admin, entrada, {
          contentType: String(pedido.contentType ?? ''),
          bytes: Number(pedido.bytes),
        }),
      )
    case 'confirmar':
      return responder(await confirmarSubidaDeEntrada(admin, entrada, String(pedido.ruta ?? '')))
    case 'quitar':
      return responder(await quitarFotoDeEntrada(admin, entrada, String(pedido.fotoId ?? '')))
    case 'vincular':
      return responder(await vincularFotosDeEntrada(admin, entrada))
    case 'descartar':
      return responder(await descartarSubidaDeEntrada(admin, entrada, String(pedido.ruta ?? '')))
    case 'descartar_todo':
      return responder(await descartarFotosDeEntrada(admin, entrada))
    default:
      return responder(errorDePedido('Acción desconocida.'))
  }
}
