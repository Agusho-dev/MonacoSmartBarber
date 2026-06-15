'use client'

import { useState } from 'react'
import type { UIMessage } from 'ai'
import { Bot, Copy, Check, RotateCcw } from 'lucide-react'
import { AssistantMarkdown } from './assistant-markdown'
import { ToolActivityRail, type ToolActivity } from './tool-activity'
import { ToolResultBlock } from './blocks'

interface AnyPart {
  type: string
  text?: string
  state?: string
  output?: unknown
  toolName?: string
  toolCallId?: string
}

function toolNameOf(p: AnyPart): string {
  if (p.type === 'dynamic-tool') return p.toolName ?? 'tool'
  return p.type.replace(/^tool-/, '')
}

export function ChatMessage({
  message,
  orgName,
  isLast,
  streaming,
  onRegenerate,
  proMode,
}: {
  message: UIMessage
  orgName?: string
  isLast: boolean
  streaming: boolean
  onRegenerate?: () => void
  proMode?: boolean
}) {
  const parts = (message.parts ?? []) as unknown as AnyPart[]
  const isUser = message.role === 'user'

  const textContent = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n').trim()

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="animate-msg-in max-w-[80%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed text-secondary-foreground whitespace-pre-wrap">
          {textContent}
        </div>
      </div>
    )
  }

  const toolParts = parts.filter((p) => p.type.startsWith('tool-') || p.type === 'dynamic-tool')
  const activities: ToolActivity[] = toolParts.map((p, i) => ({
    id: p.toolCallId ?? `${i}`,
    name: toolNameOf(p),
    done: p.state === 'output-available' || p.state === 'output-error',
  }))
  const outputs = toolParts.filter((p) => p.state === 'output-available')

  const showShimmer = streaming && isLast && !textContent && activities.every((a) => !a.done)

  return (
    <div className={`flex gap-3 ${proMode ? 'assistant-pro' : ''}`}>
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${proMode ? 'assistant-pro-ring border-[oklch(0.78_0.12_85/0.4)]' : 'border-border bg-card'}`}>
        <Bot className={`size-4 ${proMode ? 'text-[oklch(0.78_0.12_85)]' : 'text-foreground/80'}`} />
      </div>

      <div className="min-w-0 flex-1">
        <ToolActivityRail tools={activities} />

        {showShimmer && (
          <div className="space-y-2 py-1">
            <div className="asst-shimmer h-3.5 w-3/4 rounded" />
            <div className="asst-shimmer h-3.5 w-1/2 rounded" />
            <div className="asst-shimmer h-3.5 w-2/3 rounded" />
          </div>
        )}

        {textContent && (
          <AssistantMarkdown content={textContent} />
        )}
        {streaming && isLast && textContent && <span className="typing-caret" />}

        {outputs.map((p, i) => (
          <ToolResultBlock key={p.toolCallId ?? i} name={toolNameOf(p)} output={p.output} orgName={orgName} />
        ))}

        {!streaming && (textContent || outputs.length > 0) && (
          <MessageActions text={textContent} isLast={isLast} onRegenerate={onRegenerate} />
        )}
      </div>
    </div>
  )
}

function MessageActions({ text, isLast, onRegenerate }: { text: string; isLast: boolean; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100 has-[:focus]:opacity-100 max-lg:opacity-60">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Copiar"
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
      {isLast && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Regenerar"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  )
}
