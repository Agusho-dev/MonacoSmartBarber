'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Render de markdown para las respuestas del asistente.
 * Portado de docs/[slug]/doc-renderer para mantener consistencia visual.
 */
export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1.5">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-7">{children}</p>,
          ul: ({ children }) => <ul className="my-2 pl-5 space-y-1 list-disc marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 pl-5 space-y-1 list-decimal marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="leading-6">{children}</li>,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <code className="block bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre my-3" {...props}>
                  {children}
                </code>
              )
            }
            return <code className="bg-muted px-1.5 py-0.5 rounded text-[0.85em] font-mono" {...props}>{children}</code>
          },
          pre: ({ children }) => <pre className="not-prose">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-3">{children}</blockquote>
          ),
          hr: () => <hr className="border-border my-4" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-border">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
          th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wide">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-xs leading-5">{children}</td>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
