import 'server-only'

// =============================================================================
// src/lib/tex/herramientas/index.ts
// El registro: qué herramientas ve Claude en cada pedido y cómo se le declaran.
//
// ORDEN FIJO (alfabético por nombre). Las herramientas son el comienzo del
// prefijo cacheable (tools → system → mensajes): si el orden cambiara entre
// pedidos, la caché no se reutilizaría nunca. Por la misma razón el JSON
// Schema sale de una función determinística (`aJsonSchema`).
//
// Una herramienta que no está `disponible` (sin permiso, dominio apagado, sin
// Modo Pro) NI SE DECLARA: el modelo no puede pedir lo que no ve. Igual cada
// una vuelve a chequear el permiso al ejecutarse (defensa en profundidad).
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk'
import { herramientasConciliacion } from './conciliacion'
import { herramientasNegocio } from './negocio'
import { herramientasPresentacion } from './presentacion'
import { aJsonSchema, type TexContexto, type TexHerramienta } from './tipos'

export function todasLasHerramientas(): TexHerramienta[] {
  return [...herramientasNegocio, ...herramientasPresentacion, ...herramientasConciliacion]
}

/** Las herramientas de este pedido, filtradas por `disponible(ctx)` y en orden alfabético. */
export function herramientasDisponibles(ctx: TexContexto): TexHerramienta[] {
  const porNombre = new Map<string, TexHerramienta>()
  for (const h of todasLasHerramientas()) {
    if (porNombre.has(h.nombre)) {
      // Dos módulos declarando el mismo nombre: gana la primera y queda registrado.
      console.error(`[tex] herramienta duplicada: ${h.nombre}`)
      continue
    }
    let disponible = true
    try {
      disponible = h.disponible ? h.disponible(ctx) : true
    } catch {
      disponible = false
    }
    if (disponible) porNombre.set(h.nombre, h)
  }
  return [...porNombre.values()].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0))
}

/**
 * Las definiciones para la API: `eager_input_streaming` en cada una (el input
 * llega a medida que se genera; la API ya no lo valida y se valida con zod
 * antes de ejecutar) y `cache_control` en la ÚLTIMA (breakpoint 1 de 3).
 */
export function definicionesParaClaude(lista: TexHerramienta[]): Anthropic.Tool[] {
  return lista.map((h, i) => {
    const definicion: Anthropic.Tool = {
      name: h.nombre,
      description: h.descripcion,
      input_schema: aJsonSchema(h.esquema),
      eager_input_streaming: true,
    }
    if (i === lista.length - 1) definicion.cache_control = { type: 'ephemeral' }
    return definicion
  })
}
