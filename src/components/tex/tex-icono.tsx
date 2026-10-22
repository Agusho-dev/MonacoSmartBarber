// La cara de Tex quieta, como ícono: el ítem del menú, botones, chips. Acepta
// `className` igual que un ícono de lucide (el menú del shell lo pinta con
// `<item.icon className="size-4 …" />`), y el dibujo se encaja con
// object-contain dentro de esa caja cuadrada.

import { cn } from '@/lib/utils'
import { srcCara } from './assets'

export function TexIcono({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={srcCara(1, 96)}
      alt=""
      aria-hidden
      width={20}
      height={20}
      decoding="async"
      draggable={false}
      className={cn('size-5 shrink-0 select-none object-contain', className)}
    />
  )
}
