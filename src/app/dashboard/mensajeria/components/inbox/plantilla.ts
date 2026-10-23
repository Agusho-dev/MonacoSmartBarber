// El texto de una plantilla en la burbuja del chat.
//
// Las plantillas que manda el envío automático quedan en messages.content
// como '[Template: nombre]' (el marcador: plantillaDelMarcador en helpers.ts) y
// la burbuja muestra el texto de la definición de Meta, que tiene variables
// ({{1}}, {{2}}…) cuyos valores no se guardaron. Esas variables van como un
// "…" apagado: nunca el {{1}} crudo.
//
// Lógica pura: la prueban nav-tests/chat.

export type TrozoDePlantilla =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'variable'; numero: number }

const VARIABLE = /\{\{\s*(\d+)\s*\}\}/g

/**
 * El texto partido en trozos de texto y variables, en orden. Con `valores`
 * (el número de la variable → lo que se mandó), las que lo tienen quedan como
 * texto; las demás, como variable sin valor.
 */
export function trozosDePlantilla(
  texto: string,
  valores?: Readonly<Record<number, string>>,
): TrozoDePlantilla[] {
  const trozos: TrozoDePlantilla[] = []
  const sumarTexto = (t: string) => {
    if (!t) return
    const ultimo = trozos[trozos.length - 1]
    if (ultimo?.tipo === 'texto') ultimo.texto += t
    else trozos.push({ tipo: 'texto', texto: t })
  }
  let desde = 0
  for (const m of texto.matchAll(VARIABLE)) {
    const inicio = m.index ?? 0
    sumarTexto(texto.slice(desde, inicio))
    const numero = Number(m[1])
    const valor = valores?.[numero]
    if (valor) sumarTexto(valor)
    else trozos.push({ tipo: 'variable', numero })
    desde = inicio + m[0].length
  }
  sumarTexto(texto.slice(desde))
  return trozos
}
