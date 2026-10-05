/**
 * Tocar un aviso (toast de sonner) con un Dialog o un Sheet abierto NO es
 * "tocar afuera".
 *
 * Mientras hay un diálogo modal, Radix pone pointer-events:none en <body> y,
 * ante cualquier toque fuera del contenido, cierra el diálogo. Los avisos viven
 * fuera del diálogo (en el Toaster), así que tocar su X o su "Reintentar"
 * cerraba el cobro y se perdía lo cargado; y como además heredaban el
 * pointer-events:none, el toque caía en lo que hubiera debajo (el overlay, o el
 * botón "Cobrar"). Las dos mitades del arreglo:
 *
 *  1. globals.css le devuelve los toques a los avisos visibles.
 *  2. Los wrappers de Dialog y Sheet componen sus handlers de "afuera" con éste,
 *     que descarta los eventos que nacen dentro de [data-sonner-toaster].
 *
 * AlertDialog no lo necesita: Radix ya ignora ahí todo toque afuera.
 */
const SELECTOR_TOASTER = '[data-sonner-toaster]'

/** ¿El evento nació adentro de un aviso de sonner? */
export function nacioEnUnAviso(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SELECTOR_TOASTER) !== null
}

interface EventoDeAfuera {
  target: EventTarget | null
  defaultPrevented: boolean
  preventDefault(): void
}

/**
 * Compone el handler del consumidor (que corre primero, como siempre) con el
 * filtro de avisos: si el consumidor no lo previno y el evento nació en un
 * aviso, se previene y Radix no cierra.
 */
export function ignorandoAvisos<E extends EventoDeAfuera>(
  delConsumidor?: (evento: E) => void,
): (evento: E) => void {
  return (evento) => {
    delConsumidor?.(evento)
    if (!evento.defaultPrevented && nacioEnUnAviso(evento.target)) evento.preventDefault()
  }
}
