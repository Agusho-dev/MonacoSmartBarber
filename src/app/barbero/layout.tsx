import type { Metadata, Viewport } from 'next'

import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'
import { metasVisiblesEnSucursal } from '@/lib/metas-en-panel'

import { WakeLock } from '@/components/ui/wake-lock'
import { OfflineBanner } from '@/components/barber/offline-banner'
import { DbDownError } from '@/components/dashboard/db-down-error'

import { BarberThemeClient } from '@/components/barber/barber-theme-client'
import { SwRegister } from '@/components/barber/sw-register'
import { KioskBackGuard } from '@/components/barber/kiosk-back-guard'
import { LoyaltyResultHost } from '@/components/barber/loyalty-result-host'
import { GiroPanelRaiz } from '@/components/barber/giro-panel-raiz'
import { ControlPantalla } from '@/components/barber/control-pantalla'
import { BandaReloj } from '@/components/barber/reloj/banda-reloj'
import { VigiaSesion } from '@/components/barber/vigia-sesion'
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
  // El panel es tema claro (esmalte #eff1f4 = --background de .barber-theme):
  // status bar acorde en standalone/TWA.
  themeColor: '#eff1f4',
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
              <BandaReloj />
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

  // Metas se apaga por sucursal (mig 226). Sólo cambia qué ítems tiene la
  // barra: no toca la estructura del árbol (ver el OJO de arriba). Si la
  // lectura falla, la sección no se muestra (metasVisiblesEnSucursal no tira).
  const mostrarMetas = session ? await metasVisiblesEnSucursal(session.branch_id) : false

  return (
    <>
      <ScriptGiroPrePaint />
      <GiroPanelRaiz>
        {/* El padding de abajo reserva el lugar de la barra fija (--alto-nav, en
            globals.css). En el PIN no hay barra, pero el lugar sobra igual: esa
            pantalla centra su contenido en el alto disponible. */}
        <div className="barber-theme min-h-dvh bg-background text-foreground pb-[calc(var(--alto-nav)+env(safe-area-inset-bottom))]">
          <BarberThemeClient />
          <SwRegister />
          <KioskBackGuard />
          <WakeLock />
          <OfflineBanner />
          {/* La hora, arriba y en todas las pantallas: con la tablet en pantalla
              completa la barra de Android (y su reloj) no se ve. */}
          <BandaReloj />
          {children}
          {/* "Pantalla" (girar 180° / pantalla completa) reemplaza al FullscreenButton
              en el panel: con sesión es un ítem de la barra; en el PIN, una pastilla. */}
          {session ? (
            <BarberNav extremo={<ControlPantalla variante="nav" />} mostrarMetas={mostrarMetas} />
          ) : (
            <ControlPantalla variante="flotante" />
          )}
          {/* La cookie del PIN dura 14 h y el panel queda abierto de un día para
              el otro: sin esto, la fila se seguía viendo y ninguna acción andaba. */}
          {session && <VigiaSesion staffId={session.staff_id} />}
          {/* Tarjeta del programa de fidelización tras el cobro (store global). */}
          <LoyaltyResultHost />
        </div>
      </GiroPanelRaiz>
    </>
  )
}
