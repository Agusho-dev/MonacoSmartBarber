'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { moverMes, nombreDelMes } from '@/lib/disciplina-mes'

/** ‹ octubre de 2026 ›, igual que en Finanzas. Nunca deja ir a un mes que todavía no pasó. */
export function SelectorMes({
  mes,
  mesMaximo,
  onCambiar,
}: {
  mes: string
  mesMaximo: string
  onCambiar: (mes: string) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Mes">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => onCambiar(moverMes(mes, -1))}
        aria-label="Mes anterior"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-[150px] text-center text-sm font-medium" aria-live="polite">
        {nombreDelMes(mes)}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => onCambiar(moverMes(mes, 1))}
        disabled={mes >= mesMaximo}
        aria-label="Mes siguiente"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
