/*
 * Service Worker · Avisos de Mensajería  (scope: /dashboard/)
 * ------------------------------------------------------------------
 * Muestra los avisos push de «Por responder» (reseñas bajas y consultas sin
 * contestar) y, al tocarlos, abre la bandeja en la tarjeta del aviso.
 *
 * A propósito NO tiene manejador de `fetch`: no intercepta ni cachea nada del
 * dashboard (la carga y los datos siguen yendo directo a la red). El del panel
 * del barbero es otro (public/sw.js, scope /barbero/).
 *
 * El aviso llega cifrado (src/lib/push/web-push.ts) con
 *   { titulo, cuerpo, url, tag, pendientes }
 * `pendientes` es el número del ícono de la app (Badging API: en el iPhone,
 * con la app agregada a la pantalla de inicio y el permiso de avisos).
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const URL_POR_DEFECTO = '/dashboard/mensajeria?responder=1'

self.addEventListener('push', (event) => {
  let datos = {}
  try {
    datos = event.data ? event.data.json() : {}
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : '' }
  }

  const titulo = typeof datos.titulo === 'string' && datos.titulo ? datos.titulo : 'Por responder'
  const opciones = {
    body: typeof datos.cuerpo === 'string' && datos.cuerpo ? datos.cuerpo : 'Hay mensajes esperando una respuesta.',
    tag: typeof datos.tag === 'string' && datos.tag ? datos.tag : 'por-responder',
    // Con el mismo tag, el aviso nuevo reemplaza al anterior pero vuelve a sonar.
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    timestamp: Date.now(),
    data: { url: typeof datos.url === 'string' && datos.url.startsWith('/') ? datos.url : URL_POR_DEFECTO },
  }

  const tareas = [self.registration.showNotification(titulo, opciones)]
  const nav = self.navigator
  if (typeof datos.pendientes === 'number' && nav && typeof nav.setAppBadge === 'function') {
    tareas.push(
      (datos.pendientes > 0 ? nav.setAppBadge(datos.pendientes) : nav.clearAppBadge()).catch(() => undefined),
    )
  }
  event.waitUntil(Promise.all(tareas))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const ruta = (event.notification.data && event.notification.data.url) || URL_POR_DEFECTO
  const destino = new URL(ruta, self.location.origin)

  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Con Mensajería abierta: le avisa a la página y la trae al frente, sin
      // recargar (la bandeja se abre sola en la tarjeta del aviso).
      for (const v of ventanas) {
        const u = new URL(v.url)
        if (u.origin !== destino.origin) continue
        if (u.pathname.startsWith('/dashboard/mensajeria')) {
          v.postMessage({ tipo: 'abrir-por-responder', conv: destino.searchParams.get('conv') })
          return 'focus' in v ? v.focus() : undefined
        }
      }
      // Con el dashboard abierto en otra pantalla: lo lleva a Mensajería.
      for (const v of ventanas) {
        if (new URL(v.url).origin !== destino.origin || !('focus' in v)) continue
        try {
          const navegada = 'navigate' in v ? await v.navigate(destino.href) : null
          return (navegada || v).focus()
        } catch {
          // Una ventana que este SW no controla no se puede navegar: se abre otra.
        }
      }
      return self.clients.openWindow(destino.href)
    })(),
  )
})
