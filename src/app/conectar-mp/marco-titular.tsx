import type { ReactNode } from 'react'
import { TexPose } from '@/components/tex/tex-pose'
import type { TexPoseNombre } from '@/components/tex/assets'

// El marco de las páginas que ve el TITULAR de una cuenta (un barbero, desde su
// celular, sin sesión): fondo CLARO con colores explícitos —nada de los tokens
// oscuros del dashboard—, ancho máximo de 440 y pensado primero para el
// celular. Estas rutas están fuera de /dashboard: el layout raíz no les pone el
// menú ni el encabezado del sistema.

/**
 * El html y el body del sitio son oscuros (globals.css). Sin esto, el rebote del
 * scroll en el iPhone mostraría franjas negras arriba y abajo de una página
 * blanca. Es un <style> sin capa: le gana a la base de Tailwind (@layer base).
 * Esta página no navega dentro de la app (el botón sale a Mercado Pago), así que
 * no queda pegado en otra pantalla.
 */
const FONDO_CLARO = 'html:root, html:root body { background: #ffffff; color-scheme: light; }'

export function MarcoTitular({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-white text-zinc-900" style={{ colorScheme: 'light' }}>
      <style href="msb-conectar-mp-fondo" precedence="default">
        {FONDO_CLARO}
      </style>
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  )
}

/** Una pantalla de un solo mensaje: el link venció, ya está conectada, listo… */
export function AvisoTitular({
  pose,
  titulo,
  texto,
  pie,
}: {
  pose: TexPoseNombre
  titulo: string
  texto?: string | null
  pie?: string | null
}) {
  return (
    <MarcoTitular>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10 text-center">
        <TexPose pose={pose} alto={96} entrada={pose === 'logro' ? 'logro' : 'suave'} prioridad />
        <h1 className="text-[22px] leading-snug font-semibold text-balance text-zinc-900">{titulo}</h1>
        {texto && <p className="max-w-[34ch] text-[15px] leading-relaxed text-pretty text-zinc-600">{texto}</p>}
      </div>
      {pie && <p className="text-center text-xs text-zinc-400">{pie}</p>}
    </MarcoTitular>
  )
}
