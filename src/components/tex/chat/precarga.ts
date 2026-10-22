// Baja el contenido del panel de Tex (el chat, el AI SDK, el markdown) antes de
// que haga falta: el lanzador lo pide al pasar el mouse o al enfocarlo, así el
// primer ⌘K no espera la descarga. Webpack lo separa en su propio chunk y el
// import se resuelve una sola vez.

let pedido: Promise<unknown> | null = null

export function precargarPanelTex(): void {
  if (pedido) return
  pedido = import('./panel-contenido').catch(() => {
    // Si falló (red), que el próximo intento vuelva a pedirlo.
    pedido = null
  })
}
