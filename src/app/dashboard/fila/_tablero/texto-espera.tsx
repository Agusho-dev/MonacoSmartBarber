import { partesDeEspera } from '@/components/barber/fila/espera'
import { cn } from '@/lib/utils'

/**
 * Una duración en minutos dicha como se lee: las cifras en mono (miden) y las
 * unidades en la letra del texto, más chicas ("34 min", "1 h 05"). Con todo en
 * mono, "1 h 18" se leía como tres números sueltos.
 */
export function TextoEspera({
  minutos,
  className,
  claseUnidad,
}: {
  minutos: number
  className?: string
  claseUnidad?: string
}) {
  const partes = partesDeEspera(minutos)
  return (
    <span className={cn('whitespace-nowrap font-mono tabular-nums', className)}>
      {partes.map((p, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {p.valor}
          {p.unidad && <span className={cn('ml-0.5 font-sans text-[0.75em] font-medium', claseUnidad)}>{p.unidad}</span>}
        </span>
      ))}
    </span>
  )
}
