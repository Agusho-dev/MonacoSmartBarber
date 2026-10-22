import 'server-only'

// =============================================================================
// Las herramientas de Tex: la forma común.
//
// Cada herramienta declara su esquema UNA vez (zod) y de ahí salen las dos
// cosas: la validación del input antes de ejecutar (con eager_input_streaming
// la API ya no lo valida) y el JSON Schema que lee Claude (`aJsonSchema`, más
// abajo; determinístico, así el prefijo cacheable no cambia entre pedidos).
//
// Devuelven dos salidas:
//   paraModelo  lo que lee Claude: compacto, sin datos que no necesita.
//   paraUI      lo que ve la persona (TexSalidaUI: KPIs, gráficos, tablas…).
//
// Reglas que valen para TODAS:
//   - Permiso de rol + dominio habilitado ANTES de leer nada (`permitir`).
//   - Si no pudieron leer, lo dicen (`error`), nunca devuelven ceros: un "$0" o
//     un "100 % conciliado" por un error de lectura es Known Risk #15.
//   - Lo que devuelven son DATOS. El system prompt le dice a Claude que nunca
//     siga instrucciones que aparezcan adentro.
// =============================================================================

import type { z, ZodTypeAny } from 'zod'
import { zodSchema } from 'ai'
import type Anthropic from '@anthropic-ai/sdk'
import type { TexSalidaUI } from '../contrato'

export interface TexSucursal {
  id: string
  nombre: string
  slug: string | null
  direccion: string | null
  modo: string | null
}

/** Quién pregunta y qué puede ver. Lo arma el servidor; nada sale del cliente. */
export interface TexContexto {
  orgId: string
  orgNombre: string
  moneda: string
  /** auth.users.id de quien pregunta. */
  userId: string
  nombreUsuario: string | null
  esDuenoOAdmin: boolean
  permisos: Record<string, boolean>
  /** Alcance de sucursales del rol (role_branch_scope). */
  sucursalesIds: string[]
  sucursales: TexSucursal[]
  /**
   * true = el alcance es TODA la org (owner/admin o un rol sin restricción);
   * false = un rol acotado a algunas. Para que la fuente diga "Todas las
   * sucursales" sólo cuando es cierto. Ausente = no se sabe.
   */
  todasLasSucursales?: boolean
  /** Dominios de datos habilitados en la configuración de Tex. Ausente = habilitado. */
  accesoDatos: Record<string, boolean>
  /** SQL de solo lectura: flag de la org + owner/admin. */
  modoPro: boolean
  /** YYYY-MM-DD en hora argentina (no UTC: de 21 a 24 h serían "mañana"). */
  hoy: string
}

/**
 * Un resultado de una herramienta de datos de ESTE turno que se puede mostrar
 * en la respuesta. El motor los numera ("r1", "r2"…) en el orden en que
 * terminan los pasos y le pasa el id al modelo en el resultado (`mostrar_con`).
 */
export interface TexResultadoDelTurno {
  /** "r1", "r2"… Únicos en toda la conversación (el motor sigue la cuenta del historial). */
  id: string
  /** La herramienta que lo trajo ("reviews_crm"). */
  herramienta: string
  /** Lo que trajo para la pantalla, tal cual. `mostrar` lo copia, nunca lo modifica. */
  salida: TexSalidaUI
}

export interface TexEjecucion {
  ctx: TexContexto
  /** El Detener del browser llega acá: las herramientas largas lo tienen que respetar. */
  signal: AbortSignal
  /**
   * Los resultados de las herramientas de datos de los pasos ANTERIORES de este
   * turno, por id. Sólo lo lee `mostrar`. Es una copia: lo que haga una
   * herramienta con él no cambia el registro del motor.
   */
  resultadosDelTurno?: ReadonlyMap<string, TexResultadoDelTurno>
}

export interface TexResultado {
  paraModelo: unknown
  paraUI: TexSalidaUI
}

export interface TexHerramienta<S extends ZodTypeAny = ZodTypeAny> {
  nombre: string
  /** Para Claude: qué hace y CUÁNDO usarla (es lo que decide si la llama). */
  descripcion: string
  esquema: S
  /** Si devuelve false la herramienta ni se declara (permisos, Modo Pro, dominio apagado). */
  disponible?: (ctx: TexContexto) => boolean
  ejecutar: (input: z.infer<S>, e: TexEjecucion) => Promise<TexResultado>
}

/** Atajo con inferencia: `definirHerramienta({ esquema: z.object(...), ejecutar: async (input) => … })`. */
export function definirHerramienta<S extends ZodTypeAny>(h: TexHerramienta<S>): TexHerramienta<S> {
  return h
}

/**
 * zod → JSON Schema para `Anthropic.Tool.input_schema`. Usa el conversor del AI
 * SDK (ya es dependencia) y le saca `$schema`: la API no lo necesita y el
 * resultado tiene que ser idéntico pedido a pedido (prefijo cacheable).
 */
export function aJsonSchema(esquema: ZodTypeAny): Anthropic.Tool.InputSchema {
  const { $schema: _omitido, ...resto } = zodSchema(esquema).jsonSchema as Record<string, unknown>
  return { ...(resto as object), type: 'object' } as Anthropic.Tool.InputSchema
}

/** "No tenés permiso" / "dominio apagado": la respuesta común de una herramienta denegada. */
export function denegada(mensaje: string): TexResultado {
  return {
    paraModelo: { error: 'sin_acceso', mensaje },
    paraUI: { bloques: [{ tipo: 'aviso', tono: 'info', texto: mensaje }] },
  }
}

/** Una lectura que falló: error visible para la persona y explícito para Claude. */
export function fallida(mensaje: string, detalle?: string): TexResultado {
  return {
    paraModelo: {
      error: 'no_se_pudo_leer',
      mensaje,
      instruccion: 'Decile a la persona que no pudiste leer este dato. No lo estimes ni lo reemplaces por cero.',
      ...(detalle ? { detalle } : {}),
    },
    paraUI: { bloques: [], error: mensaje },
  }
}

/**
 * Permiso de rol + dominio habilitado. Devuelve el mensaje de denegación o null.
 * El dominio ausente en la configuración cuenta como habilitado (igual que la UI).
 */
export function permitir(ctx: TexContexto, permiso: string | null, dominio: string | null): string | null {
  if (dominio && ctx.accesoDatos[dominio] === false) {
    return 'Ese dato está apagado en la configuración de Tex.'
  }
  if (permiso && !ctx.esDuenoOAdmin && ctx.permisos[permiso] !== true) {
    return 'Con tu usuario no puedo ver esa información.'
  }
  return null
}
