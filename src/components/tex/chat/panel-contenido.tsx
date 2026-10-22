'use client'

// El contenido del panel lateral de Tex: encabezado con el contexto de la
// pantalla ("Viendo: Finanzas", se puede quitar), el chat en su variante
// compacta y las sugerencias de la sección. Es la parte pesada (AI SDK,
// markdown, bloques): `TexPanel` la carga recién cuando hace falta.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Maximize2, SquarePen, X } from 'lucide-react'
import { seccionDeRuta, TEX_SECCIONES } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { TexIcono } from '@/components/tex/tex-icono'
import { TexPose } from '@/components/tex/tex-pose'
import { TexLienzo, type ContenidoLienzo } from '@/components/tex/bloques'
import { TexChat, type TexChatHandle, type TexChatInfo } from './tex-chat'

export interface PedidoPanel {
  /** Cambia en cada pedido: el mismo texto dos veces también se procesa. */
  nonce: number
  pregunta?: string
  enviar?: boolean
  enfocar?: boolean
}

export interface TexPanelContenidoProps {
  conversacionId: string
  pedido: PedidoPanel | null
  pathname: string
  /** El nombre del ítem del menú en el que está la persona (para secciones sin entrada propia). */
  etiquetaSeccion: string | null
  orgNombre: string
  puedeConfigurar: boolean
  puedeConciliacion: boolean
  onCerrar: () => void
  onNueva: () => void
  onEstado: (estado: { ocupado: boolean; vacia: boolean }) => void
}

const SUGERENCIAS_GENERALES = TEX_SECCIONES.find((s) => s.prefijo === '/dashboard')?.sugerencias ?? []

const BOTON_ICONO =
  'flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:size-10'

export default function TexPanelContenido({
  conversacionId,
  pedido,
  pathname,
  etiquetaSeccion,
  orgNombre,
  puedeConfigurar,
  puedeConciliacion,
  onCerrar,
  onNueva,
  onEstado,
}: TexPanelContenidoProps) {
  const chatRef = useRef<TexChatHandle>(null)
  const [lienzo, setLienzo] = useState<ContenidoLienzo | null>(null)
  // El contexto se quita por pantalla: al pasar a otra sección vuelve a aparecer.
  const [sinContextoEn, setSinContextoEn] = useState<string | null>(null)

  const seccion = seccionDeRuta(pathname)
  // TEX_SECCIONES termina en '/dashboard' (Inicio): para una pantalla sin entrada
  // propia (Equipo, Servicios…) el nombre sale del menú, no "Inicio".
  const generica = !seccion || (seccion.prefijo === '/dashboard' && pathname !== '/dashboard')
  const nombreSeccion = generica ? etiquetaSeccion : seccion.nombre
  const sugerencias = generica ? SUGERENCIAS_GENERALES : seccion.sugerencias
  const conContexto = sinContextoEn !== pathname && Boolean(nombreSeccion)

  // Lo que pidió `abrirTex()` (o ⌘K): mandar, dejar escrito o sólo enfocar. Un
  // tick después, cuando el chat de esta conversación ya está montado.
  useEffect(() => {
    if (!pedido) return
    const t = window.setTimeout(() => {
      const chat = chatRef.current
      if (!chat) return
      if (pedido.pregunta && pedido.enviar && chat.enviar(pedido.pregunta)) return
      if (pedido.pregunta) chat.escribir(pedido.pregunta)
      else if (pedido.enfocar) chat.enfocar()
    }, 0)
    return () => window.clearTimeout(t)
  }, [pedido])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TexChat
        key={conversacionId}
        ref={chatRef}
        conversacionId={conversacionId}
        mensajesIniciales={[]}
        variante="panel"
        orgNombre={orgNombre}
        puedeConfigurar={puedeConfigurar}
        puedeConciliacion={puedeConciliacion}
        pagina={conContexto ? pathname.slice(0, 160) : null}
        onAbrirLienzo={setLienzo}
        onNueva={onNueva}
        encabezado={(info) => (
          <Encabezado
            info={info}
            conversacionId={conversacionId}
            nombreSeccion={conContexto ? nombreSeccion : null}
            onQuitarContexto={() => setSinContextoEn(pathname)}
            onNueva={onNueva}
            onCerrar={onCerrar}
            onEstado={onEstado}
          />
        )}
        vacio={({ enviar }) => (
          <div className="my-auto flex flex-col items-center py-4 text-center">
            <TexPose pose="saludo" alto={88} halo prioridad />
            <p className="mt-4 text-[15px] font-medium text-foreground">
              {conContexto && nombreSeccion ? `¿Qué querés saber de ${nombreSeccion}?` : '¿En qué te ayudo?'}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">Te contesto con los números reales de {orgNombre}.</p>
            {sugerencias.length > 0 && (
              <ul className="mt-5 w-full space-y-2 text-left">
                {sugerencias.map((s, i) => (
                  <li
                    key={s}
                    className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-200"
                    style={{ animationDelay: `${80 + i * 50}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => enviar(s)}
                      className="group flex min-h-11 w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm text-foreground/90 transition-colors hover:border-white/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
                    >
                      <span className="min-w-0 flex-1">{s}</span>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--tex-texto)]" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      />
      {/* En el panel no hay columna: el informe, la tabla o el gráfico se abren en una hoja. */}
      <TexLienzo contenido={lienzo} onCerrar={() => setLienzo(null)} orgNombre={orgNombre} variante="hoja" />
    </div>
  )
}

function Encabezado({
  info,
  conversacionId,
  nombreSeccion,
  onQuitarContexto,
  onNueva,
  onCerrar,
  onEstado,
}: {
  info: TexChatInfo
  conversacionId: string
  nombreSeccion: string | null
  onQuitarContexto: () => void
  onNueva: () => void
  onCerrar: () => void
  onEstado: (estado: { ocupado: boolean; vacia: boolean }) => void
}) {
  const { ocupado, vacia, linea } = info
  // El panel necesita saber si la conversación sigue respondiendo (para no
  // empezar otra al reabrir): se lo cuenta acá, después de dibujar.
  useEffect(() => {
    onEstado({ ocupado, vacia })
  }, [ocupado, vacia, onEstado])

  const enGrande = vacia ? '/dashboard/asistente' : `/dashboard/asistente?c=${conversacionId}`

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b pl-3 pr-2">
      <TexIcono className="size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-sm font-semibold text-[color:var(--tex-texto)]">Tex</h2>
          {nombreSeccion && (
            <span className="inline-flex min-w-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pl-2 pr-0.5 text-[11px] text-muted-foreground">
              <span className="truncate">Viendo: {nombreSeccion}</span>
              <button
                type="button"
                onClick={onQuitarContexto}
                aria-label={`No usar ${nombreSeccion} como contexto`}
                title="Quitar el contexto"
                // 20 px a la vista y 40 al dedo: el ::after agranda la zona de toque sin agrandar el chip.
                className="relative flex size-5 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-2.5 after:rounded-full hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          )}
        </div>
        <p aria-live="polite" className="h-4 truncate text-[11px] leading-4 text-muted-foreground">
          {linea}
        </p>
      </div>
      {!vacia && (
        <button type="button" onClick={onNueva} disabled={ocupado} aria-label="Nueva conversación" title="Nueva conversación" className={BOTON_ICONO}>
          <SquarePen className="size-4" aria-hidden />
        </button>
      )}
      {ocupado ? (
        <button type="button" disabled aria-label="Abrir en grande" className={BOTON_ICONO}>
          <Maximize2 className="size-4" aria-hidden />
        </button>
      ) : (
        <Link href={enGrande} onClick={onCerrar} aria-label="Abrir en grande" title="Abrir en grande" className={cn(BOTON_ICONO)}>
          <Maximize2 className="size-4" aria-hidden />
        </Link>
      )}
      <button type="button" onClick={onCerrar} aria-label="Cerrar Tex" title="Cerrar (Esc)" className={BOTON_ICONO}>
        <X className="size-4" aria-hidden />
      </button>
    </header>
  )
}
