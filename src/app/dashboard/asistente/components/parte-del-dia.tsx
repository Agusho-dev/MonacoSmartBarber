'use client'

// El estado vacío de Tex: "el parte del día". Tex saluda (pose `saludo`), se
// presenta en una línea y muestra el pulso del día —hasta 3 cifras reales
// calculadas SIN IA (obtenerPulsoTex): un dato que no cargó no aparece— y
// cuatro pedidos que dicen qué devuelven. Tocar cualquiera se lo pregunta a Tex.

import { BarChart3, FileText, Scale, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import type { TexPulso } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { TexPose } from '@/components/tex/tex-pose'
import { iconoDominio } from '@/components/tex/chat/iconos'

interface Props {
  saludo: string
  orgNombre: string
  pulso: TexPulso[]
  puedeConciliacion: boolean
  onPreguntar: (texto: string) => void
}

interface Pedido {
  texto: string
  devuelve: string
  icono: LucideIcon
}

// Entradas escalonadas: `fill-mode-both` para que no aparezcan, desaparezcan y
// vuelvan a entrar durante el delay (las animate-* del repo usan `forwards`).
const ENTRADA =
  'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]'

const TONO_VALOR: Record<TexPulso['tono'], string> = {
  neutro: 'text-foreground',
  ok: 'text-emerald-400',
  revisar: 'text-amber-300',
  error: 'text-red-400',
}

const TONO_PUNTO: Record<TexPulso['tono'], string | null> = {
  neutro: null,
  ok: 'bg-emerald-400',
  revisar: 'bg-amber-300',
  error: 'bg-red-400',
}

export function ParteDelDia({ saludo, orgNombre, pulso, puedeConciliacion, onPreguntar }: Props) {
  const pedidos: Pedido[] = [
    { texto: 'Armame el informe del mes para mandar por WhatsApp', devuelve: 'Informe PDF', icono: FileText },
    puedeConciliacion
      ? { texto: '¿Cuadró la plata de ayer con Mercado Pago?', devuelve: 'Conciliación', icono: Scale }
      : { texto: '¿Cómo viene el mes contra el anterior a la misma fecha?', devuelve: 'Gráfico', icono: TrendingUp },
    { texto: '¿Qué barbero rindió más esta semana?', devuelve: 'Gráfico', icono: BarChart3 },
    { texto: '¿Qué clientes dejaron de venir?', devuelve: 'Lista', icono: Users },
  ]
  const tarjetas = pulso.slice(0, 3)

  return (
    <div className="flex flex-col items-center py-2 lg:my-auto lg:py-6">
      {/* 160 px en la compu, 120 en el celular: `zoom` escala también el lugar que ocupa (un transform no). */}
      <div className="max-lg:[zoom:0.75]">
        <TexPose pose="saludo" alto={160} halo prioridad />
      </div>

      <h1 className={cn('mt-5 text-center text-2xl font-semibold tracking-tight lg:text-[28px]', ENTRADA)} style={{ animationDelay: '60ms' }}>
        {saludo}
      </h1>
      <p
        className={cn('mt-2 max-w-md text-center text-[15px] leading-relaxed text-muted-foreground', ENTRADA)}
        style={{ animationDelay: '110ms' }}
      >
        Soy Tex. Leo los números de {orgNombre} y te los explico. Preguntame o pedime un informe.
      </p>

      {tarjetas.length > 0 && (
        <section aria-label="Pulso del día" className="mt-7 w-full">
          <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">Pulso del día</h2>
          <ul
            data-sin-swipe
            // scroll-px-4: sin él, el snap alinea la primera tarjeta contra el borde de la pantalla.
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
          >
            {tarjetas.map((p, i) => {
              const Icono = iconoDominio(p.icono)
              const punto = TONO_PUNTO[p.tono]
              return (
                <li key={p.id} className={cn('w-[78%] shrink-0 snap-start sm:w-auto', ENTRADA)} style={{ animationDelay: `${160 + i * 60}ms` }}>
                  <button
                    type="button"
                    onClick={() => onPreguntar(p.pregunta)}
                    title={p.pregunta}
                    className="flex h-full w-full flex-col items-start gap-1 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-white/20 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
                  >
                    <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                      <Icono className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.etiqueta}</span>
                      {punto && <span className={cn('size-1.5 shrink-0 rounded-full', punto)} aria-hidden />}
                    </span>
                    <span className={cn('font-mono text-lg font-semibold tabular-nums tracking-tight', TONO_VALOR[p.tono])}>{p.valor}</span>
                    {p.detalle && <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{p.detalle}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="Pedidos para empezar" className={cn('w-full', tarjetas.length > 0 ? 'mt-6' : 'mt-8')}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {pedidos.map((p, i) => {
            const Icono = p.icono
            return (
              <li key={p.texto} className={ENTRADA} style={{ animationDelay: `${(tarjetas.length > 0 ? 300 : 180) + i * 50}ms` }}>
                <button
                  type="button"
                  onClick={() => onPreguntar(p.texto)}
                  className="group flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
                >
                  <Icono className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--tex-texto)]" aria-hidden />
                  <span className="min-w-0 flex-1 text-sm leading-snug text-foreground/90">{p.texto}</span>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground">{p.devuelve}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
