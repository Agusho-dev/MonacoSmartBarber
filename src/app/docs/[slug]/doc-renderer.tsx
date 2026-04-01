'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface DocRendererProps {
  content: string
}

export default function DocRenderer({ content }: DocRendererProps) {
  return (
    <div className="prose-doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-3xl font-bold mt-0 mb-4 pb-3 border-b border-border">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-2xl font-semibold mt-10 mb-4 pb-2 border-b border-border">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-6 mb-3">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold mt-4 mb-2 text-muted-foreground">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="my-3 leading-7 text-sm">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-3 pl-5 space-y-1 list-disc text-sm">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 pl-5 space-y-1 list-decimal text-sm">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-6">{children}</li>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <code
                  className="block bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre my-4"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => <pre className="not-prose">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-border pl-4 italic text-muted-foreground my-4 text-sm">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border my-8" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-6 rounded-lg border border-border">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border">{children}</tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-xs leading-5">{children}</td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
