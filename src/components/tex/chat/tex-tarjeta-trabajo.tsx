'use client'

// La tarjeta de trabajo: lo que Tex está consultando, paso por paso, mientras
// corren las herramientas ("Leyendo las finanzas · Paraná · octubre · 0,8 s").
// Cuando empieza el texto se pliega en una línea —"Consulté Finanzas y
// Estadísticas · 2,1 s ›"— que se puede volver a abrir. Un paso que no pudo
// leer queda en ámbar con su texto: un dato que falta nunca se esconde.

import { useState, type ReactNode } from 'react'
import { Check, ChevronRight, CircleStop, Loader2, TriangleAlert } from 'lucide-react'
import { metaHerramienta } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { TexPose } from '@/components/tex/tex-pose'
import { useTiemposPasos } from './hooks'
import { iconoDominio } from './iconos'
import { formatearDuracion, resumenPlegado, textoDePaso, type PasoTex } from './logica'

interface Props {
  pasos: PasoTex[]
  /** El mensaje sigue llegando. */
  enCurso: boolean
  /** Ya hay texto después de las herramientas: la tarjeta se pliega. */
  textoEmpezo: boolean
  compacto?: boolean
  /** "Está tardando más de lo normal." + [Detener], si corresponde. */
  aviso?: ReactNode
}

export function TexTarjetaTrabajo({ pasos, enCurso, textoEmpezo, compacto = false, aviso }: Props) {
  const tiempos = useTiemposPasos()
  // null = la decide el estado del turno; true/false = la abrió o cerró la persona.
  const [manual, setManual] = useState<boolean | null>(null)

  // Un paso sin terminar en un mensaje que ya no llega (Detener, corte de red)
  // quedó interrumpido: no gira para siempre.
  const corriendo = enCurso && pasos.some((p) => p.estado === 'corriendo')
  const plegadaSola = !corriendo && (textoEmpezo || !enCurso)
  const abierta = corriendo || (manual ?? !plegadaSola)

  let inicio = Infinity
  let fin = -Infinity
  let medidos = 0
  for (const p of pasos) {
    const t = tiempos[p.id]
    if (t?.fin !== undefined) {
      inicio = Math.min(inicio, t.inicio)
      fin = Math.max(fin, t.fin)
      medidos++
    }
  }
  const total = medidos === pasos.length && medidos > 0 ? fin - inicio : null
  const resumen = resumenPlegado(pasos, total)
  const conFallas = pasos.some((p) => p.estado === 'error')

  return (
    <div
      className={cn(
        'rounded-[14px] border transition-[border-color,background-color] duration-[240ms] motion-reduce:transition-none',
        abierta ? 'border-border bg-card' : 'border-transparent bg-transparent',
      )}
    >
      {!corriendo && (
        <button
          type="button"
          onClick={() => setManual(!abierta)}
          aria-expanded={abierta}
          className={cn(
            // Plegada es una línea ("Consulté Finanzas · 2,1 s ›") con el chevron
            // pegado al texto; abierta, el encabezado de la tarjeta.
            'flex min-h-8 max-w-full items-center gap-1.5 rounded-[14px] text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/50',
            abierta ? 'w-full px-3 pt-2' : '-mx-0.5 px-0.5',
          )}
        >
          {conFallas && <TriangleAlert className="size-3.5 shrink-0 text-amber-300" aria-hidden />}
          <span className={cn('min-w-0 truncate', abierta && 'flex-1')}>{resumen}</span>
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none', abierta && 'rotate-90')}
          />
        </button>
      )}

      {/* El pliegue: grid 1fr ↔ 0fr anima el alto real sin medirlo. */}
      <div
        className="grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: abierta ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden" inert={!abierta}>
          <div className={cn('flex items-start gap-3', corriendo ? 'p-3' : 'px-3 pb-3 pt-1.5')}>
            {corriendo && <TexPose pose="analiza" alto={compacto ? 40 : 48} entrada="suave" className="mt-0.5" />}
            <div className="min-w-0 flex-1">
              <ol className="space-y-1" aria-label="Pasos de Tex">
                {pasos.map((p) => {
                  const Icono = iconoDominio(metaHerramienta(p.nombre).icono)
                  const t = tiempos[p.id]
                  const duracion = t?.fin !== undefined ? formatearDuracion(t.fin - t.inicio) : null
                  const activo = p.estado === 'corriendo' && enCurso
                  const cortado = p.estado === 'corriendo' && !enCurso
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        'flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-[13px]',
                        activo && 'bg-[color:var(--tex)]/[0.07] ring-1 ring-[color:var(--tex)]/45',
                        p.estado === 'error' ? 'text-amber-300' : 'text-foreground/90',
                      )}
                    >
                      <Icono
                        aria-hidden
                        className={cn('size-3.5 shrink-0', p.estado === 'error' ? 'text-amber-300/80' : 'text-muted-foreground')}
                      />
                      <span className="min-w-0 flex-1 truncate">{textoDePaso(p, true)}</span>
                      {activo ? (
                        <Loader2
                          aria-label="En curso"
                          className="size-3.5 shrink-0 animate-spin text-[color:var(--tex-texto)] motion-reduce:animate-none"
                        />
                      ) : cortado ? (
                        <CircleStop aria-label="Interrumpido" className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : p.estado === 'ok' ? (
                        <Check
                          aria-label="Listo"
                          className="size-3.5 shrink-0 text-emerald-400 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-150"
                        />
                      ) : (
                        <TriangleAlert aria-label="No se pudo leer" className="size-3.5 shrink-0 text-amber-300" />
                      )}
                      {duracion && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{duracion}</span>}
                    </li>
                  )
                })}
              </ol>
              {aviso}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
