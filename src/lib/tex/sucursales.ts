// Resolución tolerante de sucursal para las herramientas de Tex.
//
// Claude nunca ve ni inventa UUIDs: pasa el nombre que dijo la persona
// ("Rondeau", "en Paraná") y acá se resuelve contra el directorio YA acotado al
// rol (ctx.sucursales). Una sucursal fuera del alcance no matchea nunca.
//
// Orden: UUID exacto → nombre o slug exacto → prefijo → substring. El substring
// es en UN sentido (el nombre contiene lo pedido, nunca al revés) y exige 3
// letras: si no, "Test" adentro de un texto largo resolvería mal y en silencio.

import type { TexContexto, TexSucursal } from './herramientas/tipos'

export type SucursalElegida =
  | null // todas las del alcance
  | { id: string; nombre: string }
  | { error: 'sucursal_no_resuelta'; mensaje: string; disponibles: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function esErrorSucursal(
  s: SucursalElegida,
): s is { error: 'sucursal_no_resuelta'; mensaje: string; disponibles: string[] } {
  return s !== null && 'error' in s
}

export function resolverSucursal(ctx: Pick<TexContexto, 'sucursales'>, pedido?: string | null): SucursalElegida {
  if (pedido == null || pedido.trim() === '') return null
  const crudo = pedido.trim()
  const lista = ctx.sucursales
  const nombres = lista.map((b) => b.nombre)
  const error = (mensaje: string, disponibles: string[] = nombres): SucursalElegida => ({
    error: 'sucursal_no_resuelta',
    mensaje,
    disponibles,
  })
  if (lista.length === 0) return error('No hay sucursales en tu alcance.', [])

  if (UUID.test(crudo)) {
    const hit = lista.find((b) => b.id === crudo)
    return hit
      ? { id: hit.id, nombre: hit.nombre }
      : error(`No tenés acceso a esa sucursal. Disponibles: ${nombres.join(', ')}.`)
  }

  const q = normalizarTexto(crudo)
  const exacta = lista.find((b) => normalizarTexto(b.nombre) === q || (b.slug ? normalizarTexto(b.slug) === q : false))
  if (exacta) return { id: exacta.id, nombre: exacta.nombre }

  const elegir = (candidatas: TexSucursal[]): SucursalElegida | undefined => {
    if (candidatas.length === 1) return { id: candidatas[0].id, nombre: candidatas[0].nombre }
    if (candidatas.length > 1) {
      return error(
        `"${crudo}" coincide con varias sucursales: ${candidatas.map((b) => b.nombre).join(', ')}. ¿Cuál querés?`,
        candidatas.map((b) => b.nombre),
      )
    }
    return undefined
  }

  const porPrefijo = elegir(
    lista.filter((b) => normalizarTexto(b.nombre).startsWith(q) || (b.slug ? normalizarTexto(b.slug).startsWith(q) : false)),
  )
  if (porPrefijo !== undefined) return porPrefijo

  if (q.length >= 3) {
    const porSubstring = elegir(
      lista.filter((b) => normalizarTexto(b.nombre).includes(q) || (b.slug ? normalizarTexto(b.slug).includes(q) : false)),
    )
    if (porSubstring !== undefined) return porSubstring
  }

  return error(`No encontré una sucursal que coincida con "${crudo}". Disponibles: ${nombres.join(', ')}.`)
}
