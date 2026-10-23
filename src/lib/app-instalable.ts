import type { Metadata } from 'next'

/**
 * El dashboard como app instalada (pantalla de inicio del celular o ventana de
 * app en la compu). 23/oct/2026.
 *
 * El problema. Desde iOS 26, toda página que se agrega a la pantalla de inicio
 * abre como app. Una navegación que iOS considera fuera del alcance de la app se
 * abre en la hoja de Safari: una X arriba con la URL y una barra abajo con
 * atrás, compartir y recargar. Todo lo que pasa después sigue adentro de esa
 * hoja. El dueño lo vio en Mensajería y en Equipo ("ocupa muchísimo margen… le
 * saca la esencia de app"). Sin manifest, el alcance lo decide iOS. Hay reportes
 * de que sale de la carpeta de la página agregada (/dashboard/: el redirect a
 * /login quedaba afuera), y Apple dijo en 2023 que es el dominio entero. No se
 * pudo probar en el teléfono cuál de las dos fue.
 *
 * `/dashboard.webmanifest` (public/) lo declara: alcance "/", con `start_url`
 * en /dashboard y `display` standalone. Así cualquier ruta propia queda adentro
 * con cualquiera de las dos lecturas.
 * Lo que sigue abriendo la hoja es lo que sale a otro dominio en la misma
 * ventana (el OAuth de Mercado Pago, pendiente) o con target=_blank. Se enlaza SÓLO desde el dashboard y desde (auth) —login y alta—:
 * las páginas públicas, el kiosko y la TV no son esta app, y el panel del
 * barbero tiene la suya (`/barbero.webmanifest`, alcance /barbero/).
 *
 * La barra de estado va 'black' (opaca) y NO 'black-translucent': desde iOS
 * 26.1 la translúcida dibuja un velo oscuro encima de la página. Opaca, la
 * página empieza debajo de la hora y la batería (`safe-area-inset-top` = 0) y
 * nada necesita correrse hacia abajo.
 *
 * iOS lee el manifest y estos meta AL AGREGAR el ícono: si algo de esto cambia,
 * hay que borrar el ícono y volver a agregarlo desde Safari.
 */
export const METADATA_APP_INSTALABLE = {
  manifest: '/dashboard.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'BarberOS',
    statusBarStyle: 'black',
  },
} satisfies Pick<Metadata, 'manifest' | 'appleWebApp'>

// Sólo standalone, que es lo que declara el manifest y lo que informan la app de
// iOS, la de Android y la ventana de app en la compu. `fullscreen` no: la cumple
// también un Chrome cualquiera en F11 o en modo kiosko.
const CONSULTA_MODO_APP = '(display-mode: standalone)'

/**
 * ¿La página corre como app instalada? En el servidor, siempre false.
 * `navigator.standalone` es el de Safari en iOS (no está en los tipos del DOM).
 */
export function esAppInstalada(): boolean {
  if (typeof window === 'undefined') return false
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(CONSULTA_MODO_APP).matches
}

/** Avisa si cambia el modo (en la compu, "Abrir en la app" pasa una pestaña a ventana de app). */
export function suscribirAModoApp(alCambiar: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const lista = window.matchMedia(CONSULTA_MODO_APP)
  lista.addEventListener('change', alCambiar)
  return () => lista.removeEventListener('change', alCambiar)
}
