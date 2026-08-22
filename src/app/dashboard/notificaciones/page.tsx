import { redirect } from 'next/navigation'

/**
 * /dashboard/notificaciones → pestaña "Notificaciones" de App Móvil.
 *
 * La pantalla de push nació como página propia y quedó como ítem suelto del
 * menú; el dueño pidió que TODO lo de la app (puntos, catálogo, cartelera,
 * notificaciones) se gestione desde un solo lugar. Los componentes siguen
 * viviendo en esta carpeta (los importa `app-movil`); la ruta queda para
 * cualquier link viejo.
 */
export default function NotificacionesRedirect() {
  redirect('/dashboard/app-movil?tab=notificaciones')
}
