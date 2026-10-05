import type { Metadata, Viewport } from 'next'

import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'

import { WakeLock } from '@/components/ui/wake-lock'
import { OfflineBanner } from '@/components/barber/offline-banner'
import { DbDownError } from '@/components/dashboard/db-down-error'

import { BarberThemeClient } from '@/components/barber/barber-theme-client'
import { SwRegister } from '@/components/barber/sw-register'
import { KioskBackGuard } from '@/components/barber/kiosk-back-guard'
import { LoyaltyResultHost } from '@/components/barber/loyalty-result-host'
import { GiroPanelRaiz } from '@/components/barber/giro-panel-raiz'
import { ControlPantalla } from '@/components/barber/control-pantalla'
import { SCRIPT_GIRO_PRE_PAINT } from '@/lib/giro-panel/script-pre-paint'

// Metadata scopeada a /barbero: inyecta el manifest PWA y los meta de
// standalone SOLO en el panel (no en dashboard/kiosko/TV).
export const metadata: Metadata = {
  title: 'Panel Barbero',
  manifest: '/barbero.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Panel Barbero',
  },
}

export const viewport: Viewport = {
  // El panel es tema claro (bg #f2f2f2): status bar acorde en standalone/TWA.
  themeColor: '#f2f2f2',
}

/**
 * Giro 180° de la tablet (src/lib/giro-panel): corre antes del primer paint y
 * aplica la preferencia guardada en ESTA tablet. Va antes de #giro-raiz para que
 * ningún cuadro del panel se pinte sin girar. Sin preferencia no hace nada.
 */
function ScriptGiroPrePaint() {
  return <script id="giro-pre-paint" dangerouslySetInnerHTML={{ __html: SCRIPT_GIRO_PRE_PAINT }} />
}

export default async function BarberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getBarberSession() hace 3 queries a DB (staff, attendance_logs, roles).
  // Si la DB no responde, mostramos DbDownError en lugar de explotar la página.
  //
  // OJO: este layout se vuelve a ejecutar en CADA server action que revalida
  // (tomar cliente, cobrar, descansos…). Por eso la estructura del giro
  // (ScriptGiroPrePaint + GiroPanelRaiz) es la misma en todas las ramas y no
  // depende de ninguna consulta: un árbol distinto remontaría el panel en pleno
  // cobro. Tampoco se consulta nada para el giro en la rama de base caída.
  let session: Awaited<ReturnType<typeof getBarberSession>>
  try {
    session = await getBarberSession()
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const name = error.name.toLowerCase()
    const msg = error.message.toLowerCase()
    const esRedError =
      name === 'aborterror' ||
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('aborted') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset')

    if (esRedError) {
      console.error('[barbero/layout] Error de red en getBarberSession():', err)
      return (
        <>
          <ScriptGiroPrePaint />
          <GiroPanelRaiz>
            <div className="barber-theme min-h-dvh bg-background text-foreground">
              <BarberThemeClient />
              <DbDownError context="getBarberSession()" />
            </div>
          </GiroPanelRaiz>
        </>
      )
    }

    // Error no reconocido — dejamos que explote con el mensaje original
    console.error('[barbero/layout] Error inesperado en getBarberSession():', err)
    throw err
  }

  return (
    <>
      <ScriptGiroPrePaint />
      <GiroPanelRaiz>
        <div className="barber-theme min-h-dvh bg-background text-foreground pb-20">
          <BarberThemeClient />
          <SwRegister />
          <KioskBackGuard />
          <WakeLock />
          <OfflineBanner />
          {children}
          {/* "Pantalla" (girar 180° / pantalla completa) reemplaza al FullscreenButton
              en el panel: con sesión es un ítem de la barra; en el PIN, una pastilla. */}
          {session ? (
            <BarberNav extremo={<ControlPantalla variante="nav" />} />
          ) : (
            <ControlPantalla variante="flotante" />
          )}
          {/* Tarjeta del programa de fidelización tras el cobro (store global). */}
          <LoyaltyResultHost />
        </div>
      </GiroPanelRaiz>
    </>
  )
}
