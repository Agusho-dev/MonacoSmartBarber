/*
 * Service Worker · Panel de Barberos  (scope: /barbero/)
 * ------------------------------------------------------------------
 * Objetivo: carga instantánea en tablets de gama baja + resistencia a
 * wifi flojo, SIN comprometer la frescura de los datos (fila en vivo).
 *
 * Estrategia deliberada:
 *   1. Assets versionados de Next (_next/static, _next/image) y estáticos
 *      (js/css/fuentes/imágenes) → CACHE-FIRST. Son inmutables y hasheados,
 *      así que servirlos desde caché es seguro y elimina el cuello de botella
 *      de descarga/parseo repetido en hardware lento. Este es el gran ahorro.
 *   2. Navegaciones (HTML) dentro de /barbero/ → NETWORK-ONLY con fallback a
 *      una página offline. NO cacheamos el HTML: el panel necesita datos
 *      frescos (cola, cobros); mostrar un shell viejo sería peor que avisar
 *      "sin conexión".
 *   3. API same-origin, Supabase, Meta, cross-origin, no-GET → PASSTHROUGH.
 *      Nunca tocamos datos ni el realtime.
 *
 * Nota: el Cache API ignora el header `no-store` de las respuestas, así que
 * cachear los assets funciona aunque next.config aplique no-store a rutas
 * dinámicas (esos assets viven bajo /_next/static y están excluidos).
 */

const CACHE = 'barbero-v1'
const OFFLINE_URL = '/barbero/__offline'

// HTML de fallback offline, inline para no depender de una ruta de Next.
// Tema claro para matchear el panel (bg #f2f2f2). Auto-reintenta cada 5s.
const OFFLINE_HTML = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<title>Sin conexión · Panel Barbero</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f2f2f2; color: #1c1c1c;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; padding: 24px; text-align: center;
  }
  .ring {
    width: 46px; height: 46px; border-radius: 50%;
    border: 3px solid rgba(0,0,0,.12); border-top-color: #1c1c1c;
    animation: spin .9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
  p { font-size: 14px; color: #666; margin: 0; max-width: 22rem; line-height: 1.5; }
  button {
    margin-top: 4px; appearance: none; border: 0; cursor: pointer;
    background: #1c1c1c; color: #fff; font-size: 14px; font-weight: 600;
    padding: 12px 22px; border-radius: 12px;
  }
  button:active { transform: scale(.98); }
</style>
</head>
<body>
  <div class="ring" aria-hidden="true"></div>
  <h1>Sin conexión</h1>
  <p>No pudimos contactar el servidor. Revisá el wifi de la tablet; reintentamos solos en unos segundos.</p>
  <button onclick="location.reload()">Reintentar ahora</button>
  <script>
    // Reintento automático mientras la tablet siga offline.
    setTimeout(function () { location.reload() }, 5000)
    window.addEventListener('online', function () { location.reload() })
  </script>
</body>
</html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.put(
        OFFLINE_URL,
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpiar caches de versiones viejas.
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico)$/.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }

  // Solo mismo origen: Supabase / Meta / CDNs externos van directo a la red.
  if (url.origin !== self.location.origin) return

  // 1) Assets inmutables → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        try {
          const res = await fetch(req)
          // Solo cacheamos respuestas propias y OK (evita cachear errores/opacas).
          if (res && res.ok && res.type === 'basic') {
            const cache = await caches.open(CACHE)
            cache.put(req, res.clone())
          }
          return res
        } catch {
          // Sin red y sin caché: devolvemos error de red real.
          return cached || Response.error()
        }
      })()
    )
    return
  }

  // 2) Navegaciones → network-only con fallback offline. NUNCA servimos HTML viejo.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req)
        } catch {
          const offline = await caches.match(OFFLINE_URL)
          return offline || new Response('Sin conexión', { status: 503 })
        }
      })()
    )
    return
  }

  // 3) Resto (fetch de datos same-origin, /api/*) → red directa, sin cachear.
})
