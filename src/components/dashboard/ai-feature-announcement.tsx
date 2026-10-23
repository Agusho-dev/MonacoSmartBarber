'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TexPose } from '@/components/tex/tex-pose'
import { TexIcono } from '@/components/tex/tex-icono'
import { abrirTex } from '@/components/tex/abrir-tex'
import { useAtajoTex, useMediaQuery } from '@/components/tex/chat/hooks'

// Clave nueva (antes `msb_ai_announce_v1`): quien ya vio el popup del
// "Asistente IA" tiene que conocer a Tex igual.
const STORAGE_KEY = 'msb_tex_announce_v1'

/**
 * "Conocé a Tex": la presentación de la IA del dashboard. Se muestra UNA vez
 * (por navegador y usuario) a quien puede usarla (módulo de IA + estadísticas o
 * configuración). Señala el botón flotante de abajo a la derecha, que es por
 * donde se abre Tex desde cualquier pantalla, y "Hablar con Tex" abre el panel
 * ahí mismo, sin irse de la pantalla.
 */
export function AiFeatureAnnouncement({ canUse, userKey }: { canUse: boolean; userKey?: string | null }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // En la pantalla de Tex la presentación sobra: quien llegó ahí ya lo conoce.
  const enTex = pathname === '/dashboard/asistente' || (pathname?.startsWith('/dashboard/asistente/') ?? false)
  // En Mensajería no está el botón (abajo van su composer y su barra): la
  // presentación, que lo señala, espera a la próxima pantalla.
  const sinBoton = pathname === '/dashboard/mensajeria' || (pathname?.startsWith('/dashboard/mensajeria/') ?? false)
  // El atajo sólo se menciona con teclado y mouse (en el celular no existe).
  const conMouse = useMediaQuery('(pointer: fine)')
  const atajoTex = useAtajoTex()
  const atajo = conMouse ? atajoTex : null
  const key = userKey ? `${STORAGE_KEY}::${userKey}` : STORAGE_KEY
  // "Hablar con Tex" le pasa el foco al panel: al cerrarse, el diálogo no lo
  // devuelve a donde estaba (se lo sacaría al composer de Tex).
  const haciaTexRef = useRef(false)

  useEffect(() => {
    if (!canUse) return
    if (enTex) {
      try { localStorage.setItem(key, '1') } catch { /* ignore */ }
      return
    }
    if (sinBoton) return
    // Sin almacenamiento (datos del sitio bloqueados) no hay cómo recordar que ya
    // se vio y aparecería en cada carga: no se muestra, como la invitación del
    // botón flotante (tex-boton-flotante.tsx).
    let seen = true
    try { seen = localStorage.getItem(key) === '1' } catch { /* sin almacenamiento */ }
    if (seen) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [canUse, key, enTex, sinBoton])

  function markSeen() {
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }

  function dismiss() {
    markSeen()
    setOpen(false)
  }

  function tryIt() {
    markSeen()
    haciaTexRef.current = true
    setOpen(false)
    abrirTex()
  }

  if (!canUse) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss() }}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(e) => {
          if (!haciaTexRef.current) return
          haciaTexRef.current = false
          e.preventDefault()
        }}
      >
        <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
          <TexPose pose="saludo" alto={128} halo prioridad />
          <DialogTitle className="mt-5 text-xl font-semibold tracking-tight">Conocé a Tex</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Te contesta con los números reales de tu negocio, te arma informes y cada mañana te dice si cuadró la plata.
          </DialogDescription>
          <div className="mt-5 flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-left">
            {/* El botón tal como se ve abajo a la derecha, en chico. */}
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(to_bottom,oklch(0.205_0.026_258),oklch(0.155_0.022_262))] ring-1 ring-[color:var(--tex)]/40"
            >
              <TexIcono className="size-[22px] translate-y-px" />
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Lo abrís desde cualquier pantalla con el botón de abajo a la derecha
              {atajo && (
                <>
                  {' '}o con{' '}
                  <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground/80">
                    {atajo}
                  </kbd>
                </>
              )}
              .
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t px-6 py-4">
          <Button variant="ghost" className="h-10 flex-1" onClick={dismiss}>Ahora no</Button>
          <Button className="h-10 flex-1 gap-1.5" onClick={tryIt}>
            Hablar con Tex
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
