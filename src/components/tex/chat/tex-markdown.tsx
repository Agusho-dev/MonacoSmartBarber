'use client'

// El texto de Tex: markdown liviano sobre fondo oscuro, 15 px / 1.6 y no más de
// ~68 caracteres por línea (las tablas sí usan el ancho entero). Las tablas y
// el código tienen scroll horizontal propio y `data-sin-swipe`, así deslizar
// sobre ellos en el celular no cambia de sección.
//
// Seguridad: el texto lo escribe el modelo, y lo que lee de las herramientas
// (mensajes de clientes, por ejemplo) podría intentar meterle algo. Sin HTML
// crudo, sin imágenes (una imagen remota es un pedido a un servidor ajeno: sirve
// para filtrar datos en la URL) y sólo los enlaces internos del dashboard son
// clickeables; uno externo queda como texto. Misma regla que la síntesis del
// informe (bloques/tex-markdown.tsx).

import { memo } from 'react'
import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { sinEmojis } from './logica'

const PLUGINS = [remarkGfm]

const ENLACE =
  'font-medium text-[color:var(--tex-texto)] underline decoration-[color:var(--tex-texto)]/40 underline-offset-[3px] transition-colors hover:decoration-[color:var(--tex-texto)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60'

const COMPONENTES: Components = {
  p: ({ children }) => <p className="my-3 max-w-[68ch] first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-2 mt-5 max-w-[68ch] text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 max-w-[68ch] text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 max-w-[68ch] text-[15px] font-semibold text-foreground first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1.5 mt-4 max-w-[68ch] text-[15px] font-semibold text-foreground first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mb-1 mt-3 max-w-[68ch] text-sm font-semibold text-foreground first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mb-1 mt-3 max-w-[68ch] text-sm font-semibold text-foreground first:mt-0">{children}</h6>,
  ul: ({ children }) => (
    <ul className="my-3 max-w-[68ch] list-disc space-y-1.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 max-w-[68ch] list-decimal space-y-1.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  a: ({ href, children }) => {
    const destino = href?.trim() ?? ''
    if (/^\/(?!\/)/.test(destino)) {
      return (
        <Link href={destino} className={ENLACE}>
          {children}
        </Link>
      )
    }
    return <span className="font-medium text-foreground">{children}</span>
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 max-w-[68ch] border-l-2 border-white/15 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-5 border-border" />,
  code: ({ children }) => <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.86em]">{children}</code>,
  pre: ({ children }) => (
    <pre
      data-sin-swipe
      className="my-3 overflow-x-auto rounded-xl border bg-white/[0.03] p-3 font-mono text-[13px] leading-relaxed [&>code]:bg-transparent [&>code]:p-0"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div data-sin-swipe className="my-3 max-w-full overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-[13px] tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04] text-left text-xs text-muted-foreground">{children}</thead>,
  th: ({ node: _node, className, ...props }) => (
    <th {...props} className={cn('whitespace-nowrap px-3 py-2 font-medium', className)} />
  ),
  td: ({ node: _node, className, ...props }) => (
    <td {...props} className={cn('border-t border-border px-3 py-2 align-top', className)} />
  ),
  img: () => null,
}

export const TexMarkdown = memo(function TexMarkdown({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={cn('min-w-0 text-[15px] leading-[1.6] text-foreground/95 [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTES} skipHtml>
        {sinEmojis(texto)}
      </ReactMarkdown>
    </div>
  )
})
