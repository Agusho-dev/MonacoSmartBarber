import { notFound } from 'next/navigation'

// Una dirección que no existe bajo /dashboard (un enlace viejo, una ruta que
// escribió Tex) cae acá y muestra not-found.tsx ADENTRO del menú. Sin esto la
// atendía el 404 raíz, sin menú: en la app instalada, sin botón de atrás, no
// había forma de salir. Las rutas que existen tienen prioridad sobre ésta.
export default function RutaDesconocida() {
  notFound()
}
