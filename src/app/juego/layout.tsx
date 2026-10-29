import type { Metadata, Viewport } from 'next'
import { fuenteNumeros, fuenteTitulo } from './fuentes'
import './juego.css'

export const metadata: Metadata = {
  title: 'Corte Final · Monaco',
  description:
    'El juego de pelea de Monaco: elegí a tu barbero, cargá la máquina y peleá mientras esperás tu turno.',
  applicationName: 'Corte Final',
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: 'Corte Final · Monaco',
    description: 'Elegí a tu barbero y peleá. ¿Llegás al primer puesto del ranking?',
    type: 'website',
    locale: 'es_AR',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function LayoutJuego({ children }: { children: React.ReactNode }) {
  return <div className={`cf-raiz ${fuenteTitulo.variable} ${fuenteNumeros.variable}`}>{children}</div>
}
