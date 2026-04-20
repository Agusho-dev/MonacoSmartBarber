import { redirect } from 'next/navigation'

// Redirigida a /barbero/cerrar-turno tras el rediseño UX:
// la nueva pantalla reemplaza a la vieja vista de "Caja" con el flujo
// de cierre de turno centrado en efectivo a rendir.
export default function BarberBillingPage() {
  redirect('/barbero/cerrar-turno')
}
