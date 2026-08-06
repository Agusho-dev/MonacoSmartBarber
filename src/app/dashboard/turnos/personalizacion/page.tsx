import { redirect } from 'next/navigation'

/**
 * La personalización del turnero (colores y saludo) pasó a ser una sección más
 * de Configuración: eran dos campos en una pantalla propia y el dueño tenía que
 * adivinar en cuál de las dos vivía cada cosa.
 *
 * La ruta se mantiene porque está linkeada desde el sub-nav y desde marcadores
 * viejos; el ancla deja al visitante parado en la sección correspondiente.
 */
export default function PersonalizacionPage() {
  redirect('/dashboard/turnos/configuracion#seccion-marca')
}
