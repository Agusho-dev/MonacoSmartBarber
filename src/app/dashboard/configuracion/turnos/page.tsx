import { permanentRedirect } from 'next/navigation'

export default function TurnosLegacyRedirect() {
  permanentRedirect('/dashboard/turnos/configuracion')
}
