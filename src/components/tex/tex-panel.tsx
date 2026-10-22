'use client'

// El panel lateral de Tex, desde cualquier pantalla del dashboard.
//
// Se abre con ⌘K / Ctrl+K, con el lanzador del header o con `abrirTex()` (el
// "Preguntale a Tex" de Conciliación, Finanzas…). En la compu es un aside fijo
// a la derecha de 420 px, NO modal: la página se sigue usando y no hay
// `pointer-events: none` en el body (Known Risk #39). En el celular es una hoja
// inferior de 88 dvh (ahí sí modal).
//
// Este archivo es liviano a propósito (vive en el shell, en todas las
// pantallas): escucha los atajos y guarda el estado. El chat —AI SDK, markdown,
// bloques— se baja recién la primera vez que se abre (o antes, si el mouse pasó
// por el lanzador).

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { EVENTO_ABRIR_TEX, tomarAperturaPendiente, type PedidoAbrirTex } from './abrir-tex'
import { TexPensando } from './tex-pensando'
import { esAtajoTex, esNavegacionInterna, hayModalAbierto, useEsEscritorio } from './chat/hooks'
import { nuevoUuid } from './chat/ids'
import type { PedidoPanel } from './chat/panel-contenido'

const TexPanelContenido = dynamic(() => import('./chat/panel-contenido'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b px-3">
        <span className="h-4 w-12 rounded bg-white/[0.06]" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <TexPensando texto="Abriendo Tex" />
      </div>
    </div>
  ),
})

export interface TexPanelProps {
  orgNombre: string
  puedeConfigurar: boolean
  puedeConciliacion: boolean
  /** El nombre del ítem del menú activo (para pantallas sin sección propia de Tex). */
  etiquetaSeccion?: string | null
  /** Modo foco de Mensajería: el header del shell no está y el panel va desde arriba. */
  sinEncabezado?: boolean
  /** El shell esconde la barra inferior mientras la hoja del celular está abierta. */
  onAbiertoChange?: (abierto: boolean) => void
}

interface Sesion {
  id: string
  pedido: PedidoPanel | null
}

export function TexPanel({
  orgNombre,
  puedeConfigurar,
  puedeConciliacion,
  etiquetaSeccion = null,
  sinEncabezado = false,
  onAbiertoChange,
}: TexPanelProps) {
  const pathname = usePathname()
  const esEscritorio = useEsEscritorio()
  const [abierto, setAbierto] = useState(false)
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const estadoRef = useRef({ ocupado: false, vacia: true })
  const focoPrevioRef = useRef<HTMLElement | null>(null)
  const nonceRef = useRef(0)
  const asideRef = useRef<HTMLElement>(null)

  // En /dashboard/asistente la página es Tex: el panel no se mete.
  const enPantallaTex = pathname.startsWith('/dashboard/asistente')

  // En el celular la hoja es modal y tapa el 88 % de la pantalla: un enlace del
  // panel ("Ver la conciliación", "Abrir Finanzas", un enlace del texto) cambiaba
  // la ruta de atrás y la hoja quedaba abierta, como si el botón no hubiera hecho
  // nada. Al cambiar de pantalla se cierra (y antes, al tocar el enlace: ver
  // `onClickCapture` abajo). En la compu no: el aside no es modal y acompaña.
  const [rutaVista, setRutaVista] = useState(pathname)
  if (rutaVista !== pathname) {
    setRutaVista(pathname)
    if (abierto && !esEscritorio) setAbierto(false)
  }

  // El shell esconde la barra inferior mientras la hoja del celular está abierta.
  useEffect(() => {
    onAbiertoChange?.(abierto)
  }, [abierto, onAbiertoChange])

  function abrir(pedido: PedidoAbrirTex = {}) {
    if (enPantallaTex) return
    const nuevo: PedidoPanel = {
      nonce: ++nonceRef.current,
      pregunta: pedido.pregunta?.trim() || undefined,
      enviar: pedido.enviar === true,
      // En el celular no se abre el teclado solo: taparía la mitad de la hoja.
      enfocar: esEscritorio,
    }
    if (!abierto) {
      const activo = document.activeElement
      focoPrevioRef.current = activo instanceof HTMLElement && activo !== document.body ? activo : null
      // Una conversación nueva por apertura, salvo que la anterior siga
      // respondiendo o esté vacía. En el celular la hoja desmonta el chat al
      // cerrarse: siempre empieza otra.
      const { ocupado, vacia } = estadoRef.current
      const reusar = sesion !== null && esEscritorio && (ocupado || vacia)
      setSesion(reusar ? { id: sesion.id, pedido: nuevo } : { id: nuevoUuid(), pedido: nuevo })
      if (!reusar) estadoRef.current = { ocupado: false, vacia: true }
      setAbierto(true)
      return
    }
    setSesion((s) => (s ? { ...s, pedido: nuevo } : { id: nuevoUuid(), pedido: nuevo }))
  }

  function cerrar() {
    if (!abierto) return
    setAbierto(false)
    // Devolver el foco a donde estaba (en el celular lo hace la hoja de Radix).
    if (esEscritorio) {
      const anterior = focoPrevioRef.current
      focoPrevioRef.current = null
      if (anterior?.isConnected) requestAnimationFrame(() => anterior.focus({ preventScroll: true }))
    }
  }

  function nueva() {
    estadoRef.current = { ocupado: false, vacia: true }
    setSesion({ id: nuevoUuid(), pedido: { nonce: ++nonceRef.current, enfocar: esEscritorio } })
  }

  // Si el shell lo desmonta abierto (por ejemplo, "Abrir en grande" lleva a la
  // pantalla de Tex), que no le quede la barra inferior escondida.
  useEffect(() => () => onAbiertoChange?.(false), [onAbiertoChange])

  // Un `abrirTex()` de antes de que este chunk cargara (el lanzador, el
  // "Preguntale a Tex" de Conciliación con mala señal): se atiende ahora.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const pendiente = tomarAperturaPendiente()
      if (pendiente) abrir(pendiente)
    }, 0)
    return () => window.clearTimeout(t)
    // Sólo al montarse: después, los pedidos llegan por el evento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ⌘K / Ctrl+K y abrirTex(): se vuelve a suscribir en cada render para ver el estado actual.
  useEffect(() => {
    function alPedido(e: Event) {
      tomarAperturaPendiente()
      abrir((e as CustomEvent<PedidoAbrirTex>).detail ?? {})
    }
    function alTeclear(e: KeyboardEvent) {
      if (e.defaultPrevented || !esAtajoTex(e) || enPantallaTex) return
      // Los editores ricos usan ⌘K para enlaces.
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return
      if (!abierto && hayModalAbierto()) return
      e.preventDefault()
      if (!abierto) {
        abrir({})
        return
      }
      // Abierto: si el foco ya está en el panel, ⌘K lo cierra; si no, lo enfoca.
      if (esEscritorio && asideRef.current?.contains(document.activeElement)) cerrar()
      else abrir({})
    }
    // Si la ventana cruza el breakpoint con el panel abierto, el chat pasaría
    // del aside a la hoja (otro árbol) y se volvería a montar vacío: se cierra.
    const mq = window.matchMedia('(min-width: 1024px)')
    const alCambiarModo = () => {
      cerrar()
      setSesion(null)
      estadoRef.current = { ocupado: false, vacia: true }
    }
    window.addEventListener(EVENTO_ABRIR_TEX, alPedido)
    window.addEventListener('keydown', alTeclear)
    mq.addEventListener('change', alCambiarModo)
    return () => {
      window.removeEventListener(EVENTO_ABRIR_TEX, alPedido)
      window.removeEventListener('keydown', alTeclear)
      mq.removeEventListener('change', alCambiarModo)
    }
  })

  const alEstado = (estado: { ocupado: boolean; vacia: boolean }) => {
    estadoRef.current = estado
  }

  const contenido = sesion ? (
    <TexPanelContenido
      conversacionId={sesion.id}
      pedido={sesion.pedido}
      pathname={pathname}
      etiquetaSeccion={etiquetaSeccion}
      orgNombre={orgNombre}
      puedeConfigurar={puedeConfigurar}
      puedeConciliacion={puedeConciliacion}
      onCerrar={cerrar}
      onNueva={nueva}
      onEstado={alEstado}
    />
  ) : null

  if (esEscritorio) {
    return (
      <aside
        ref={asideRef}
        aria-label="Tex"
        inert={!abierto}
        onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
          // Radix (menús, diálogos) previene el Esc que usa para cerrarse a sí mismo.
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault()
            cerrar()
          }
        }}
        className={cn(
          'fixed bottom-0 right-0 z-[45] flex w-[420px] max-w-[calc(100vw-1rem)] flex-col border-l bg-background',
          'transition-[transform,visibility,box-shadow] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
          sinEncabezado ? 'top-0' : 'top-14',
          abierto
            ? 'visible translate-x-0 shadow-[-24px_0_48px_-12px_rgba(0,0,0,0.55)] duration-[260ms]'
            : 'invisible translate-x-full shadow-none duration-200',
        )}
      >
        {contenido}
      </aside>
    )
  }

  return (
    <Sheet open={abierto} onOpenChange={(o) => (o ? abrir({}) : cerrar())}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] data-[state=closed]:duration-[220ms] data-[state=open]:duration-[320ms]"
        // Mientras Tex responde, Esc lo detiene (lo maneja el composer) en vez de cerrar la hoja.
        onEscapeKeyDown={(e) => {
          if (estadoRef.current.ocupado) e.preventDefault()
        }}
        // Un enlace a otra pantalla cierra la hoja en el momento del toque, sin
        // esperar a que la página nueva termine de cargar.
        onClickCapture={(e) => {
          const enlace = e.target instanceof Element ? e.target.closest('a[href]') : null
          if (enlace && esNavegacionInterna(e, enlace.getAttribute('href'), enlace.getAttribute('target'))) cerrar()
        }}
      >
        <SheetTitle className="sr-only">Tex</SheetTitle>
        {contenido}
      </SheetContent>
    </Sheet>
  )
}
