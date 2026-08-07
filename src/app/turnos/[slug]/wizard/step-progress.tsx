'use client'

interface Props {
  /** Paso actual, base 1. */
  current: number
  total: number
  label: string
}

/**
 * Indicador de progreso del wizard.
 *
 * Reemplaza al stepper de círculos + conectores: aquél repartía los pasos en
 * celdas `flex-1` iguales y le colgaba el conector adentro, así que el último
 * círculo quedaba pegado a la izquierda de SU celda en vez de al borde derecho
 * — el tramo 3→4 se veía más largo y el 4 desalineado. Una barra segmentada es
 * simétrica por construcción (N segmentos iguales, un solo gap) y en celular se
 * lee mejor que cuatro círculos con etiquetas de 10px.
 *
 * Cada segmento se LLENA con un `scaleX` sobre una capa interna en vez de
 * cambiar de color de golpe. Se anima `transform` y no `width` a propósito: el
 * ancho re-maquetaría la fila entera en cada frame, y son cuatro elementos
 * hermanos midiéndose entre sí.
 */
export function StepProgress({ current, total, label }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          Paso {current} de {total}
        </p>
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--t-text-muted)]">
          {label}
        </p>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={`Paso ${current} de ${total}: ${label}`}
      >
        {Array.from({ length: total }, (_, i) => {
          const lleno = i < current
          return (
            <span
              key={i}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full"
              style={{
                backgroundColor: 'var(--t-glass-bg)',
                boxShadow: 'inset 0 0 0 1px var(--t-glass-border)',
              }}
            >
              <span
                className="absolute inset-0 origin-left rounded-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{
                  backgroundColor: 'var(--t-accent)',
                  transform: `scaleX(${lleno ? 1 : 0})`,
                  // El segmento que se acaba de completar arranca un pelo
                  // después que el anterior: la barra se lee como un avance y
                  // no como cuatro luces prendiéndose juntas.
                  transitionDelay: lleno ? `${Math.min(i, 4) * 60}ms` : '0ms',
                }}
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}
