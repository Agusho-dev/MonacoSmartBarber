import 'server-only'

// =============================================================================
// src/lib/tex/herramientas/presentacion.ts
// Las herramientas con las que Tex MUESTRA en vez de leer. Son las únicas cuyos
// bloques se dibujan en la respuesta (`TEX_HERRAMIENTAS_VISIBLES` del contrato):
// lo que traen las herramientas de datos queda plegado en la tarjeta de trabajo
// ("Consulté Reseñas · 3,2 s ›", con un "Ver datos" por paso).
//
//   mostrar          pone en la respuesta lo que YA trajo una herramienta de
//                    datos de este turno (por su id "r1", "r2"…).
//   graficar         un gráfico armado con cifras ya traídas.
//   generar_informe  un informe que la persona descarga en PDF.
//
// No tocan la base: el modelo arma el contenido con cifras que ya trajo con las
// herramientas de datos, y acá se valida que el dibujo sea posible (series del
// largo de las etiquetas, números finitos, límites que entran en una pantalla y
// en un A4).
//
// Lo que vuelve al modelo es mínimo: el gráfico o el informe ya lo tiene en su
// propio input, devolvérselo sería pagar dos veces los mismos tokens.
// =============================================================================

import { z } from 'zod'
import { estrellasEnTexto } from '../bloques-formato'
import { metaHerramienta, type TexGrafico, type TexInforme, type TexSalidaUI } from '../contrato'
import { comoHerramienta } from './comun'
import { definirHerramienta, type TexHerramienta, type TexResultadoDelTurno } from './tipos'

// ─────────────────────────────────────────────────────────────────────────────
// mostrar
// ─────────────────────────────────────────────────────────────────────────────

const MAX_A_MOSTRAR = 4

/** Lo que el modelo necesita para elegir bien: qué es cada resultado mostrable. */
function describirValidos(mapa: ReadonlyMap<string, TexResultadoDelTurno>): { id: string; herramienta: string; fuente: string | null }[] {
  return [...mapa.values()].map((r) => ({ id: r.id, herramienta: metaHerramienta(r.herramienta).etiqueta, fuente: r.salida.fuente ?? null }))
}

const mostrar = definirHerramienta({
  nombre: 'mostrar',
  descripcion:
    'Pone en tu respuesta las tarjetas, gráficos y tablas de resultados que YA trajiste en esta respuesta con las herramientas de datos: pasá sus ids `mostrar_con` ("r1", "r2"…) en el orden en que querés que aparezcan. Lo que traen las herramientas de datos NO se ve en el chat si no lo mostrás. Mostrá sólo lo que sostiene tu respuesta (casi siempre uno o dos resultados): nunca resultados vacíos, fallidos ni intermedios.',
  esquema: z
    .object({
      resultados: z
        .array(z.string().trim().min(1).max(12))
        .min(1)
        .max(MAX_A_MOSTRAR)
        .describe('Los ids `mostrar_con` de los resultados de ESTA respuesta, en el orden en que se muestran.'),
    })
    .strict(),
  ejecutar: async ({ resultados }, { resultadosDelTurno }) => {
    const mapa: ReadonlyMap<string, TexResultadoDelTurno> = resultadosDelTurno ?? new Map()
    const pedidos = [...new Set(resultados.map((r) => r.trim().toLowerCase()))]
    const desconocidos = pedidos.filter((id) => !mapa.has(id))
    if (desconocidos.length > 0) {
      const validos = describirValidos(mapa)
      return {
        paraModelo: {
          error: 'resultado_desconocido',
          mensaje:
            validos.length > 0
              ? `No hay resultados con ${desconocidos.length === 1 ? 'ese id' : 'esos ids'} en esta respuesta: ${desconocidos.join(', ')}. Usá uno de los válidos.`
              : `No hay resultados para mostrar en esta respuesta (${desconocidos.join(', ')} no existe${desconocidos.length === 1 ? '' : 'n'}): primero traé los datos con una herramienta.`,
          validos,
        },
        // Nada a la vista: un error de referencia no es algo que la persona tenga que leer.
        paraUI: { bloques: [] },
      }
    }
    const elegidos = pedidos.map((id) => mapa.get(id) as TexResultadoDelTurno)
    // Copia profunda: lo que se dibuja en la respuesta no comparte objetos con el trabajo.
    const bloques = elegidos.flatMap((r) => JSON.parse(JSON.stringify(r.salida.bloques)) as TexSalidaUI['bloques'])
    const fuentes = [...new Set(elegidos.map((r) => r.salida.fuente?.trim()).filter((f): f is string => Boolean(f)))]
    const enlace = elegidos.find((r) => r.salida.enlace)?.salida.enlace
    return {
      paraModelo: {
        ok: true,
        mostrado: pedidos,
        nota: 'La persona ya ve esos datos en tu respuesta: en el texto contá la conclusión con 2 a 4 cifras clave, sin repetir la tabla.',
      },
      paraUI: {
        bloques,
        ...(fuentes.length > 0 ? { fuente: fuentes.join(' / ') } : {}),
        ...(enlace ? { enlace: { href: enlace.href, texto: enlace.texto } } : {}),
      },
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// graficar
// ─────────────────────────────────────────────────────────────────────────────

const SERIE = z
  .object({
    nombre: z.string().trim().min(1).max(60),
    valores: z.array(z.number().finite()).min(1).max(40),
  })
  .strict()

const GRAFICO_BASE = z
  .object({
    titulo: z
      .string()
      .trim()
      .min(3)
      .max(140)
      .describe('La CONCLUSIÓN, no el tema: "Paraná explica el 41 % del crecimiento", no "Ingresos por sucursal".'),
    tipo: z
      .enum(['barras', 'barras_horizontales', 'lineas', 'area', 'torta'])
      .describe('barras = comparar pocas categorías; barras_horizontales = rankings; lineas/area = evolución en el tiempo; torta = partes de un total (pocas porciones).'),
    unidad: z.enum(['pesos', 'cantidad', 'porcentaje', 'minutos']).describe('pesos = plata (sin decimales); cantidad = cortes, clientes; porcentaje; minutos.'),
    etiquetas: z.array(z.string().trim().min(1).max(60)).min(1).max(40).describe('Categorías del eje X (o porciones de la torta), en orden.'),
    series: z
      .array(SERIE)
      .min(1)
      .max(6)
      .describe('1 a 6 series. Cada una tiene UN valor por etiqueta, en el mismo orden. La torta usa sólo la primera.'),
    destacar: z.number().int().min(0).optional().describe('Índice (desde 0) de la etiqueta de la que habla tu texto: se pinta con el color de Tex.'),
    nota: z.string().trim().max(300).optional().describe('Aclaración corta debajo del gráfico (por ejemplo, "octubre va al día 21").'),
  })
  .strict()

type GraficoEntrada = z.infer<typeof GRAFICO_BASE>

/**
 * Lo que zod no puede decir con tipos: que el dibujo tenga sentido.
 *
 * OJO: zod 3 corre este refinamiento TAMBIÉN sobre un valor que ya falló un
 * `.min()` (son errores no fatales): `series` puede llegar vacía y `etiquetas`
 * también. Nada de acá puede asumir un índice: un `series[0].valores` sobre una
 * lista vacía hacía TIRAR a `safeParse` en vez de devolver success:false, y el
 * turno entero se perdía (motor-tex-5).
 */
function validarGrafico(g: GraficoEntrada, agregar: (mensaje: string, ruta: (string | number)[]) => void): void {
  g.series.forEach((s, i) => {
    if (s.valores.length !== g.etiquetas.length) {
      agregar(`La serie "${s.nombre}" tiene ${s.valores.length} valores y hay ${g.etiquetas.length} etiquetas: tiene que haber uno por etiqueta.`, [
        'series',
        i,
        'valores',
      ])
    }
  })
  if (g.destacar != null && g.destacar >= g.etiquetas.length) {
    agregar(`"destacar" tiene que ser el índice de una etiqueta (0 a ${Math.max(g.etiquetas.length - 1, 0)}).`, ['destacar'])
  }
  const primera = g.series.at(0)
  if (g.tipo === 'torta' && primera && primera.valores.some((v) => v < 0)) {
    agregar('Una torta no puede tener valores negativos: usá barras.', ['series', 0, 'valores'])
  }
}

export const esquemaGrafico = GRAFICO_BASE.superRefine((g, ctx) =>
  validarGrafico(g, (message, path) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path })),
)

const graficar = definirHerramienta({
  nombre: 'graficar',
  descripcion:
    'Le muestra a la persona un gráfico armado con cifras que YA trajiste con otras herramientas (nunca inventadas ni estimadas). Usalo cuando un ranking, una tendencia o una comparación se entienden mejor viéndolos: máximo 2 por respuesta. Si una herramienta ya trajo ese gráfico, mostralo con `mostrar` en vez de rearmarlo. El título es la conclusión.',
  esquema: esquemaGrafico,
  ejecutar: async (grafico) => ({
    paraModelo: { ok: true, mostrado: 'gráfico', nota: 'La persona ya ve el gráfico: en el texto contá la conclusión, no repitas los valores.' },
    paraUI: { bloques: [{ tipo: 'grafico', grafico: grafico as TexGrafico }] },
  }),
})

// ─────────────────────────────────────────────────────────────────────────────
// generar_informe
// ─────────────────────────────────────────────────────────────────────────────

const KPI = z
  .object({
    etiqueta: z.string().trim().min(1).max(60),
    valor: z.string().trim().min(1).max(40).describe('Ya formateado: "$1.420.300", "32 %", "108,4".'),
    delta: z.string().trim().max(20).optional().describe('"+12 %". Sin `base` no se muestra.'),
    tono: z.enum(['sube', 'baja', 'neutro']).optional(),
    base: z.string().trim().max(80).optional().describe('Contra qué se compara: "vs. los mismos 21 días de septiembre".'),
  })
  .strict()

/** Lo que entra en una celda del informe (en la pantalla y en una fila del PDF). */
const MAX_CELDA = 200

/**
 * Una celda de texto más larga se RECORTA con "…" en vez de rechazar el informe.
 * Los comentarios de `reviews_crm` llegan al modelo con hasta 500 caracteres (en un
 * año, 28 de 243 pasan los 200) y el modelo los copia tal cual a la tabla: con el
 * rechazo tenía que volver a generar el informe entero, un paso más y lento. El
 * esquema que lee Claude no cambia (sigue diciendo 200): `preprocess` no se ve en el
 * JSON Schema, así que la definición de la herramienta queda idéntica.
 */
const CELDA = z.preprocess(
  (v) => (typeof v === 'string' && v.length > MAX_CELDA ? `${v.slice(0, MAX_CELDA - 1).trimEnd()}…` : v),
  z.union([z.string().max(MAX_CELDA), z.number().finite(), z.null()]),
)

const TABLA_BASE = z
  .object({
    titulo: z.string().trim().min(1).max(120),
    columnas: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
    filas: z.array(z.array(CELDA)).max(40).describe('Hasta 40 filas, cada una con un valor por columna. La plata ya formateada ("$18.000").'),
    alinear: z.array(z.enum(['izq', 'der'])).max(10).optional().describe('Una alineación por columna; por defecto los números van a la derecha.'),
  })
  .strict()

const TABLA = TABLA_BASE.superRefine((t, ctx) => {
  t.filas.forEach((f, i) => {
    if (f.length !== t.columnas.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filas', i],
        message: `La fila ${i + 1} tiene ${f.length} valores y la tabla tiene ${t.columnas.length} columnas.`,
      })
    }
  })
  if (t.alinear && t.alinear.length !== t.columnas.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['alinear'], message: 'Tiene que haber una alineación por columna.' })
  }
})

const INFORME = z
  .object({
    titulo: z.string().trim().min(3).max(120).describe('"Informe de octubre · Paraná".'),
    periodo: z.string().trim().max(80).optional().describe('"1 al 31 de octubre de 2026".'),
    alcance: z.string().trim().max(80).optional().describe('"Todas las sucursales" o el nombre de la sucursal.'),
    kpis: z.array(KPI).max(8).default([]),
    graficos: z.array(esquemaGrafico).max(4).default([]),
    tablas: z.array(TABLA).max(4).default([]),
    sintesis: z.string().trim().max(4000).optional().describe('Síntesis ejecutiva en markdown liviano, de 2 a 4 párrafos: la conclusión primero.'),
  })
  .strict()
  .superRefine((inf, ctx) => {
    if (inf.kpis.length === 0 && inf.graficos.length === 0 && inf.tablas.length === 0 && !inf.sintesis) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El informe está vacío: agregá KPIs, gráficos, tablas o una síntesis.' })
    }
  })

/**
 * `estrellasEnTexto` en el informe entero: `reviews_crm` usa ★ en sus etiquetas
 * ("5★ · 94,3 %") y el modelo las copia al informe, pero el PDF no puede dibujar
 * la ★. Se cambia acá y no sólo en el PDF para que la pantalla y el archivo que
 * se manda digan lo mismo. Una ★ suelta, sin número, queda.
 */
function estrellasEnPalabras<T>(valor: T): T {
  if (typeof valor === 'string') return estrellasEnTexto(valor) as T
  if (Array.isArray(valor)) return valor.map((v) => estrellasEnPalabras(v)) as T
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, estrellasEnPalabras(v)])) as T
  }
  return valor
}

const generarInforme = definirHerramienta({
  nombre: 'generar_informe',
  descripcion:
    'Arma un informe (KPIs, gráficos, tablas y una síntesis) que la persona ve en el chat y descarga en PDF, para mandarlo por WhatsApp o al contador. Llamalo SOLO después de traer los datos con las otras herramientas, con las cifras tal cual vinieron (nada inventado ni estimado). Hasta 8 KPIs, 4 gráficos y 4 tablas de 40 filas.',
  esquema: INFORME,
  ejecutar: async (informe) => ({
    paraModelo: {
      ok: true,
      mostrado: 'informe',
      nota: 'La persona ya ve el informe y lo puede descargar en PDF: no repitas su contenido, contá en 2 o 3 frases lo más importante.',
    },
    paraUI: { bloques: [{ tipo: 'informe', informe: estrellasEnPalabras(informe as TexInforme) }] },
  }),
})

export const herramientasPresentacion: TexHerramienta[] = [comoHerramienta(mostrar), comoHerramienta(graficar), comoHerramienta(generarInforme)]
