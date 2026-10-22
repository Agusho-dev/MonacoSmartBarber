'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TexPose } from '@/components/tex/tex-pose'
import { useAtajoTex, useMediaQuery } from '@/components/tex/chat/hooks'

// Clave nueva (antes `msb_ai_announce_v1`): quien ya vio el popup del
// "Asistente IA" tiene que conocer a Tex igual.
const STORAGE_KEY = 'msb_tex_announce_v1'

/**
 * "Conocé a Tex": la presentación de la IA del dashboard. Se muestra UNA vez
 * (por navegador y usuario) a quien puede usarla (módulo de IA + estadísticas o
 * configuración).
 */
export function AiFeatureAnnouncement({ canUse, userKey }: { canUse: boolean; userKey?: string | null }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  // En la pantalla de Tex la presentación sobra (y su botón llevaría a la misma
  // pantalla): quien llegó ahí ya lo conoce.
  const enTex = usePathname()?.startsWith('/dashboard/asistente') ?? false
  // El atajo sólo se menciona con teclado y mouse (en el celular no existe).
  const conMouse = useMediaQuery('(pointer: fine)')
  const atajoTex = useAtajoTex()
  const atajo = conMouse ? atajoTex : null
  const key = userKey ? `${STORAGE_KEY}::${userKey}` : STORAGE_KEY

  useEffect(() => {
    if (!canUse) return
    if (enTex) {
      try { localStorage.setItem(key, '1') } catch { /* ignore */ }
      return
    }
    let seen = false
    try { seen = localStorage.getItem(key) === '1' } catch { /* ignore */ }
    if (seen) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [canUse, key, enTex])

  function markSeen() {
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }

  function dismiss() {
    markSeen()
    setOpen(false)
  }

  function tryIt() {
    markSeen()
    setOpen(false)
    router.push('/dashboard/asistente')
  }

  if (!canUse) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss() }}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
          <TexPose pose="saludo" alto={128} halo prioridad />
          <DialogTitle className="mt-5 text-xl font-semibold tracking-tight">Conocé a Tex</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Te contesta con los números reales de tu negocio, te arma informes y cada mañana te dice si cuadró la plata.
          </DialogDescription>
          {atajo && (
            <p className="mt-4 text-xs text-muted-foreground">
              Lo abrís desde cualquier pantalla con{' '}
              <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground/80">
                {atajo}
              </kbd>
              .
            </p>
          )}
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
