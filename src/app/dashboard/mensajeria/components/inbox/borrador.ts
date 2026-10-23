// Lo que se escribe mientras sale un mensaje no se pierde.
//
// El campo ya no se deshabilita mientras sale un mensaje (en el iPhone eso
// cierra el teclado), así que se puede seguir escribiendo. Pero el contexto
// (mensajeria-context.tsx, que no se toca) vacía el campo al mandar y, si el
// envío falla, vuelve a poner lo que no salió con setMessageInput(contenido):
// eso pisaba lo escrito mientras tanto. El chat ve ese cambio y une los dos.
//
// Lógica pura: la prueban nav-tests/chat.

/**
 * Lo que tiene que quedar en el campo si el último cambio fue el contexto
 * devolviendo un envío que falló encima de un borrador: lo que falló, un salto
 * de línea y el borrador. Null si el cambio no fue ése (y el campo queda como
 * vino). Si el envío sale bien, el contexto no toca el campo: el borrador queda.
 * - enVuelo: lo que se mandó (ya recortado, como lo manda el contexto) y
 *   todavía no volvió; null sin envío en curso.
 * - antes / ahora: el valor del campo antes y después del cambio.
 * - propio: el último valor que puso el chat (al escribir, al elegir una
 *   respuesta rápida…). Si el cambio es ése, lo hizo la persona: escribir
 *   justo lo mismo que está saliendo no es una devolución.
 */
export function campoTrasDevolucion(cambio: {
  enVuelo: string | null
  antes: string
  ahora: string
  propio: string | null
}): string | null {
  const { enVuelo, antes, ahora, propio } = cambio
  if (enVuelo === null || ahora !== enVuelo || ahora === propio) return null
  // Sin nada escrito mientras tanto, la devolución no pisó nada.
  if (!antes.trim() || antes === ahora) return null
  return `${ahora}\n${antes}`
}
