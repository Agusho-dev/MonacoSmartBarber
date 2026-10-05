'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ToasterProps } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { ContenedorPortalContext } from '@/components/ui/contenedor-portal'
import { useGiroCss } from '@/hooks/use-giro-panel'
import {
  esModoCss,
  girarTeclado,
  iniciarGiro,
  leerGiro,
  suscribirAvisosGiro,
} from '@/lib/giro-panel/store'
import { avisarSistemaGira, avisarTecladoAlReves } from '@/lib/giro-panel/avisos'
import { RecargaPorVersion } from '@/components/recarga-por-version'

/** Con la capa girada, el swipe de sonner (clientX/Y de pantalla) movería el aviso al revés del dedo. */
const SIN_DESLIZAR: NonNullable<ToasterProps['swipeDirections']> = []

const TIPOS_SIN_TECLADO = new Set([
  'button', 'checkbox', 'radio', 'file', 'range', 'submit', 'reset', 'color', 'hidden', 'image',
])

/** ¿Enfocar este elemento abre el teclado de Android? */
function abreTecladoDelSistema(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    if (TIPOS_SIN_TECLADO.has(el.type) || el.readOnly || el.disabled) return false
    return el.inputMode !== 'none'
  }
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * Raíz del giro 180° del panel del barbero. Estructura SIEMPRE presente en
 * /barbero (también en la pantalla de base caída):
 *
 *   #giro-raiz
 *     ├─ #giro-scroll    → el panel
 *     ├─ #giro-portales  → Dialog / AlertDialog / Sheet (ContenedorPortalContext)
 *     └─ <Toaster />     → los avisos giran con el panel
 *
 * Sin html[data-giro="css"] los tres divs son inertes y el documento scrollea
 * como siempre. Con él, globals.css fija #giro-raiz al tamaño de la ventana, lo
 * gira 180° y el scroll pasa a #giro-scroll (se gira una caja que no scrollea:
 * el elemento con transform es el containing block de TODOS los fixed de adentro).
 *
 * Que la estructura NO dependa de nada es lo que la hace segura: el layout de
 * /barbero se vuelve a ejecutar en cada server action que revalida (tomar
 * cliente, cobrar…) y cualquier diferencia de árbol remontaría el panel en pleno
 * cobro. Girar sólo cambia un atributo en <html>: React no remonta nada.
 */
export function GiroPanelRaiz({ children }: { children: React.ReactNode }) {
  const [capa, setCapa] = useState<HTMLDivElement | null>(null)
  const css = useGiroCss()
  const pathname = usePathname()

  useLayoutEffect(() => iniciarGiro(), [])

  // En modo CSS cada pantalla arranca arriba. Next decide si scrollear al navegar
  // midiendo getBoundingClientRect() —coordenadas de PANTALLA, espejadas con el
  // panel girado— y puede dejar la pantalla nueva scrolleada hasta el fondo.
  // Layout effect del padre: corre después del de Next (hijo), así gana.
  useLayoutEffect(() => {
    if (!esModoCss()) return
    document.getElementById('giro-scroll')?.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])

  // react-remove-scroll (el bloqueo de scroll de Dialog, Sheet, Select y
  // DropdownMenu) decide si cancelar un touchmove comparando el delta en
  // coordenadas de PANTALLA con el scrollTop del contenido: con la UI girada el
  // signo se invierte y traba el scroll de los diálogos justo en el tope y en el
  // fondo (el cobro, la ficha del cliente, la agenda). En este modo html y body no
  // scrollean y el overlay tapa la app, así que ese bloqueo no protege nada: el
  // touchmove se corta antes de llegar a document. Es pasivo, así que el scroll
  // nativo sigue intacto.
  // OJO: mientras dure el modo CSS, NINGÚN handler de touchmove del panel recibe
  // eventos (tampoco los onTouchMove de React). Usar pointer events.
  useEffect(() => {
    if (!css) return
    const cortar = (e: TouchEvent) => e.stopPropagation()
    window.addEventListener('touchmove', cortar, { capture: true, passive: true })
    return () => window.removeEventListener('touchmove', cortar, { capture: true })
  }, [css])

  // El teclado de Android no gira: aviso una vez por sesión al enfocar un campo
  // de texto (montos y cantidades ya usan el teclado del panel).
  useEffect(() => {
    if (!css) return
    const alEnfocar = (e: FocusEvent) => {
      if (!abreTecladoDelSistema(e.target)) return
      avisarTecladoAlReves({ nativoPosible: leerGiro().nativoPosible, girarTeclado })
    }
    document.addEventListener('focusin', alEnfocar)
    return () => document.removeEventListener('focusin', alEnfocar)
  }, [css])

  // Lo que el sistema hace por su cuenta (no un toque del barbero).
  useEffect(
    () =>
      suscribirAvisosGiro((aviso) => {
        if (aviso.tipo === 'sistema_gira') avisarSistemaGira()
      }),
    [],
  )

  return (
    <ContenedorPortalContext.Provider value={capa}>
      <div id="giro-raiz">
        <div id="giro-scroll">{children}</div>
        <div id="giro-portales" ref={setCapa} />
        {/* theme="light": el panel es SIEMPRE claro (barber-theme). Con "system", en
            un equipo en modo oscuro sonner pintaba la descripción en gris claro
            sobre la tarjeta blanca del panel y no se leía. */}
        <Toaster theme="light" swipeDirections={css ? SIN_DESLIZAR : undefined} closeButton={css} />
        {/* Recarga por versión del panel: vive acá porque ésta es la raíz client
            que está SIEMPRE en /barbero (también en el PIN y con la base caída) y
            no se remonta nunca. No dibuja nada. */}
        <RecargaPorVersion superficie="panel" />
      </div>
    </ContenedorPortalContext.Provider>
  )
}
