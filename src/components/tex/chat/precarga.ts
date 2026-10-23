// Baja el contenido del panel de Tex (el chat, el AI SDK, el markdown) antes de
// que haga falta: el botón flotante lo pide al pasar el mouse, al enfocarlo o
// al apoyar el dedo, así abrirlo no espera la descarga. Webpack lo separa en su
// propio chunk y el import se resuelve una sola vez.

let pedido: Promise<unknown> | null = null

export function precargarPanelTex(): void {
  if (pedido) return
  pedido = import('./panel-contenido').catch(() => {
    // Si falló (red), que el próximo intento vuelva a pedirlo.
    pedido = null
  })
}
