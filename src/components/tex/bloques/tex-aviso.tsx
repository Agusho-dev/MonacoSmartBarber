'use client'

// Avisos de una herramienta (info / ok / error) y la tarjeta de "No pude leer".
// Una lectura que falló se dice así, en rojo y con palabras: nunca se muestra
// como un cero (Known Risk #15).
//
// Sin role="alert": las respuestas viejas vuelven a montarse al reabrir una
// conversación y un lector de pantalla las anunciaría otra vez.

import { CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CLASES_TONO, textoNoPudeLeer, type TonoBloque } from './formato'

const META: Record<'info' | 'ok' | 'error', { tono: TonoBloque; Icono: LucideIcon }> = {
  info: { tono: 'info', Icono: Info },
  ok: { tono: 'ok', Icono: CheckCircle2 },
  error: { tono: 'error', Icono: XCircle },
}

export function TexAviso({ tono, texto, className }: { tono: 'info' | 'ok' | 'error'; texto: string; className?: string }) {
  const meta = META[tono] ?? META.info
  const clases = CLASES_TONO[meta.tono]
  const { Icono } = meta
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-5', clases.caja, className)}>
      <Icono className={cn('mt-0.5 size-4 shrink-0', clases.icono)} aria-hidden />
      <p className={cn('min-w-0', clases.texto)}>{texto}</p>
    </div>
  )
}

/** `salida.error` de una herramienta: "No pude leer: …". */
export function TexNoPudeLeer({ error, className }: { error: string; className?: string }) {
  return <TexAviso tono="error" texto={textoNoPudeLeer(error)} className={className} />
}
