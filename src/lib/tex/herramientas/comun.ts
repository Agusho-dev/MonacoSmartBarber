// =============================================================================
// src/lib/tex/herramientas/comun.ts
//
// `TexHerramienta<S>` es INVARIANTE en su esquema: `S` aparece en `esquema`
// (covariante) y en el input de `ejecutar` (contravariante). Por eso una
// herramienta concreta (`definirHerramienta({ esquema: z.object(...) })`) no
// entra en un `TexHerramienta[]` sin una conversión.
//
// La conversión es segura por cómo se usan: el motor SIEMPRE valida el input
// con `h.esquema.safeParse` y le pasa a `ejecutar` el dato ya parseado por ese
// mismo esquema, así que el tipo de entrada que espera cada herramienta se
// cumple en runtime aunque el arreglo común lo olvide.
// =============================================================================

import type { ZodTypeAny } from 'zod'
import type { TexHerramienta } from './tipos'

export function comoHerramienta<S extends ZodTypeAny>(h: TexHerramienta<S>): TexHerramienta {
  return h as unknown as TexHerramienta
}
