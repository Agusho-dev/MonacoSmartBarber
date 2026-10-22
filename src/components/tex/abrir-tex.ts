// Abrir el panel de Tex desde cualquier pantalla del dashboard, con una
// pregunta ya escrita (y opcionalmente enviada). Lo escucha <TexPanel/>, que
// vive en el shell. Es un CustomEvent y no un store: así una pantalla que
// quiere "Preguntale a Tex" no depende de que el panel esté montado ni del
// orden de carga de los chunks.
//
// El panel se baja diferido (next/dynamic): con mala señal, un `abrirTex()`
// apenas carga la pantalla ("Preguntale a Tex" de Conciliación, el lanzador)
// llegaba antes de que hubiera quién lo escuchara y el botón parecía muerto.
// Por eso cada pedido además queda guardado unos segundos: quien lo atiende
// (el panel, al recibir el evento o al montarse; la pantalla de Tex, que
// escucha el mismo evento) lo toma con `tomarAperturaPendiente()`.

export const EVENTO_ABRIR_TEX = 'tex:abrir'

export interface PedidoAbrirTex {
  /** Texto para el composer. */
  pregunta?: string
  /** true: la manda sola apenas abre. false: la deja escrita para que la persona la ajuste. */
  enviar?: boolean
}

/** Pasado este tiempo sin que nadie lo atienda, un pedido ya no se ejecuta (la persona siguió con otra cosa). */
export const VIGENCIA_APERTURA_MS = 10_000

let pendiente: { pedido: PedidoAbrirTex; en: number } | null = null

export function abrirTex(pedido: PedidoAbrirTex = {}): void {
  if (typeof window === 'undefined') return
  pendiente = { pedido, en: Date.now() }
  window.dispatchEvent(new CustomEvent<PedidoAbrirTex>(EVENTO_ABRIR_TEX, { detail: pedido }))
}

/**
 * El pedido que nadie atendió todavía, si es reciente, y lo borra: se atiende
 * una sola vez. Lo llama todo el que escucha el evento (si no, un pedido ya
 * atendido volvería a abrir el panel al montarse en la pantalla siguiente).
 */
export function tomarAperturaPendiente(ahora: number = Date.now()): PedidoAbrirTex | null {
  const p = pendiente
  pendiente = null
  if (!p || ahora - p.en > VIGENCIA_APERTURA_MS) return null
  return p.pedido
}
