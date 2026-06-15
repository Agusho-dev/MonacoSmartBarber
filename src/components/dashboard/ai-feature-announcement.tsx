'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Sparkles, BarChart3, FileText, Search, ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'msb_ai_announce_v1'

/**
 * Popup de presentación del Asistente IA. Se muestra UNA vez (por navegador/usuario)
 * a quien tenga acceso a la feature (dueños/admins con el módulo activo).
 */
export function AiFeatureAnnouncement({ canUse, userKey }: { canUse: boolean; userKey?: string | null }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const key = userKey ? `${STORAGE_KEY}::${userKey}` : STORAGE_KEY

  useEffect(() => {
    if (!canUse) return
    let seen = false
    try { seen = localStorage.getItem(key) === '1' } catch { /* ignore */ }
    if (seen) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [canUse, key])

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

  const features = [
    { icon: BarChart3, title: 'Preguntá en lenguaje natural', desc: 'Facturación, ranking de barberos, clientes en riesgo… con números reales.' },
    { icon: FileText, title: 'Informes en PDF', desc: 'Pedile un reporte y descargalo con tu marca, listo para compartir.' },
    { icon: Search, title: 'Búsqueda inteligente', desc: 'Encontrá qué dicen tus clientes y activá el Modo Pro para consultas avanzadas.' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss() }}>
      <DialogContent className="max-w-md overflow-hidden p-0 gap-0">
        {/* Hero */}
        <div className="relative overflow-hidden px-6 pt-8 pb-6 text-center">
          <div className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: 'radial-gradient(120% 80% at 50% 0%, oklch(0.72 0.16 285 / 0.22), transparent 70%)' }} />
          <div className="relative mx-auto flex size-16 items-center justify-center rounded-2xl assistant-pro-ring border border-[oklch(0.78_0.12_85/0.4)] animate-scale-in">
            <Bot className="size-8 text-[oklch(0.82_0.12_285)]" />
            <Sparkles className="absolute -right-1 -top-1 size-4 text-[oklch(0.80_0.13_85)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
          </div>
          <div className="relative mt-4">
            <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.78_0.12_85/0.4)] bg-[oklch(0.78_0.12_85/0.1)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[oklch(0.80_0.13_85)]">
              <Sparkles className="size-3" /> Nuevo
            </span>
            <DialogTitle className="mt-2 text-xl font-bold tracking-tight">
              Conocé tu nuevo Asistente IA
            </DialogTitle>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Un copiloto que entiende tu negocio y responde con tus datos reales, al instante.
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-2 px-6">
          {features.map((f, i) => {
            const Icon = f.icon
            return (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 animate-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <Icon className="size-4 text-foreground/80" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-2 p-6 pt-5">
          <Button variant="ghost" className="flex-1" onClick={dismiss}>Ahora no</Button>
          <Button className="btn-gold flex-1" onClick={tryIt}>
            Probarlo <ArrowRight className="ml-1 size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
