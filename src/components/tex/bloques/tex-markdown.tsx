'use client'

// La síntesis de un informe (markdown que escribe el modelo) en el Lienzo.
// Tipografía de lectura: 15 px / 1.6, ~68 caracteres por renglón.
//
// Seguridad: el texto lo escribe el modelo y un contenido de herramienta podría
// intentar inyectarle algo. Las imágenes NO se dibujan (una imagen remota es un
// pedido a un servidor ajeno: sirve para filtrar datos en la URL) y sólo los
// enlaces internos ("/dashboard/…") son clickeables; el resto queda como texto.

import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { enlaceSeguro } from './formato'

const COMPONENTES: Components = {
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-[17px] font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-[16px] font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold text-foreground first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold text-foreground first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1.5 pl-5 marker:text-zinc-500">{children}</ul>,
  ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1.5 pl-5 marker:text-zinc-500">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-zinc-200 italic">{children}</em>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-white/15 pl-3 text-zinc-400">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border" />,
  code: ({ children }) => <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.88em]">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-white/[0.04] p-3 text-[13px]">{children}</pre>,
  img: () => null,
  a: ({ href, children }) => {
    const seguro = enlaceSeguro(href)
    if (!seguro?.interno) return <span>{children}</span>
    return (
      <Link href={seguro.href} className="font-medium text-[color:var(--tex-texto)] underline-offset-2 hover:underline">
        {children}
      </Link>
    )
  },
  table: ({ children }) => (
    <div data-sin-swipe className="my-3 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-separate border-spacing-0 text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#111111]">{children}</thead>,
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b border-border px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-white/[0.06] px-3 py-2 whitespace-nowrap text-zinc-300 tabular-nums">
      {children}
    </td>
  ),
}

/**
 * Sin emojis, como el resto de la interfaz (y como el PDF, que no los puede
 * dibujar): si el modelo igual escribe uno, no se muestra.
 */
function sinEmojis(texto: string): string {
  // ©, ® y ™ también son "pictográficos" para Unicode, pero son texto ("Wahl®").
  const limpio = texto.replace(/(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu, '')
  return limpio === texto ? texto : limpio.replace(/[ \t]+([.,;:!?)])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

export function TexMarkdown({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={cn('max-w-[68ch] text-[15px] leading-[1.6] text-zinc-300', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES} skipHtml>
        {sinEmojis(texto)}
      </ReactMarkdown>
    </div>
  )
}
