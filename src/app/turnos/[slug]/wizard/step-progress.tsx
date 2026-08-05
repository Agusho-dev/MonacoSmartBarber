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
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-300"
            style={{
              backgroundColor:
                i < current ? 'var(--t-accent)' : 'var(--t-surface-alt)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
