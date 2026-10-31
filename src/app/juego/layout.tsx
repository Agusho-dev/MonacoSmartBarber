import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
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

/**
 * El <Suspense> alrededor de {children} NO es decorativo: arregla el error de hidratación #418 que
 * salía en ≈ 5–10 % de las primeras visitas (y hacía que React tirara el HTML del servidor y
 * redibujara toda la raíz en el cliente). El único hijo de este div es la referencia perezosa del
 * layout-router (lleva el módulo de error.tsx): si ese chunk todavía no llegó cuando la hidratación
 * pasa por el div, el hijo se suspende y React vuelve a ejecutar el div SIN rebobinar el cursor de
 * hidratación (React 19.2 de Next 16.1.6: replay de un HostComponent) y lo compara contra su propio
 * primer hijo (el comentario del Suspense de loading.tsx) → «no coincide». Con el Suspense en el
 * medio, lo que se suspende es ese límite (que queda deshidratado y se reintenta solo) y el div no
 * se vuelve a ejecutar. El HTML del servidor sólo suma un par de comentarios <!--$--><!--/$-->.
 * Se eligió esto y no sacar el div del layout porque deja .cf-raiz y las variables de las fuentes
 * en un solo lugar (página, carga y error) sin tocar el CSS. Si un React nuevo corrige el replay, se
 * puede sacar; antes, correr el arnés de hidratación (40 visitas en frío, cero #418).
 */
export default function LayoutJuego({ children }: { children: React.ReactNode }) {
  return (
    <div className={`cf-raiz ${fuenteTitulo.variable} ${fuenteNumeros.variable}`}>
      <Suspense>{children}</Suspense>
    </div>
  )
}
