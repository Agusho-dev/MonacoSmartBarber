// "Pensando" con los tres píxeles de Tex: el estado mientras Haiku 5.5 piensa
// antes de escribir (pensamiento adaptativo, oculto). Nada de spinner genérico.

import { cn } from '@/lib/utils'

export function TexPensando({ texto = 'Pensando', className }: { texto?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground', className)} role="status">
      <span className="tex-pixeles" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {texto}
    </span>
  )
}
