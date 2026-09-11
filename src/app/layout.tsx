import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

/**
 * Metadata RAÍZ. Es el título de toda pantalla que no exporte el suyo.
 *
 * Decía "BarberOS" —el nombre del producto SaaS— y este layout envuelve también
 * las páginas públicas que Apple y Google visitan al revisar la app: `/`,
 * `/soporte`, `/privacidad`, `/terminos`, `/eliminar-cuenta`, `/arrepentimiento`
 * y el turnero. Un revisor que abre la Support URL de "Monaco" y ve otra marca
 * en la pestaña tiene motivo para rechazar la ficha (guideline 1.5: el soporte
 * tiene que ser identificable con la app).
 *
 * Las seis páginas legales y de soporte exportan su propio `metadata`, así que
 * este valor sólo se ve en `/` y en las pantallas internas sin metadata propia.
 * Ver el informe del 10/9/2026: `/dashboard/*` (su layout no exporta metadata),
 * el kiosko `(tablet)`, `/tv`, `/pricing`, `/docs`, `/onboarding` y el login del
 * staff quedan heredando esto. `/barbero/*` NO: su layout ya fija "Panel
 * Barbero". Para las que son producto y no marca —`/pricing`, `/docs` y el
 * dashboard multi-tenant— corresponde metadata propia con el nombre del
 * producto; queda anotado como pendiente y no se toca desde acá.
 */
export const metadata: Metadata = {
  title: 'Monaco Barber Studio',
  description:
    'Barbería en Córdoba, Argentina. Reservá tu turno online, sumá puntos en cada corte y canjeá premios desde la app Monaco.',
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
