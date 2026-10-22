'use client'

// Lo que dibujan los bloques lo arma en parte el modelo (gráficos e informes):
// un dato raro no puede tirar abajo la conversación entera. Cada bloque va
// dentro de este límite y, si falla, queda una línea honesta en su lugar.

import { Component, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}

export class LimiteDeError extends Component<Props, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError(): { fallo: boolean } {
    return { fallo: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[tex/bloques] no se pudo dibujar un bloque', error)
  }

  render(): ReactNode {
    if (this.state.fallo) {
      return (
        <p className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] text-zinc-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          No pude dibujar este bloque.
        </p>
      )
    }
    return this.props.children
  }
}
