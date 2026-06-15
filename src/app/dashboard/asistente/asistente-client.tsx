'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Bot, History, Settings, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import {
  getAssistantThreads,
  getThreadMessages,
  deleteThread as deleteThreadAction,
  type AssistantThread,
} from '@/lib/actions/asistente'
import { modelLabel } from '@/lib/asistente/models'
import { ThreadSidebar } from './components/thread-sidebar'
import { ChatMessage } from './components/chat-message'
import { Composer } from './components/composer'
import { EmptyState } from './components/empty-state'
import { LockedState, NoKeyState, ErrorRetry } from './components/states'

interface Props {
  initialThreads: AssistantThread[]
  hasKey: boolean
  locked: boolean
  orgName: string
  firstName: string | null
  proMode: boolean
  modelId: string
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function AsistenteClient(props: Props) {
  const { initialThreads, hasKey, locked, orgName, firstName, proMode, modelId } = props

  const [threads, setThreads] = useState<AssistantThread[]>(initialThreads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const conversationIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/asistente/chat' }), [])
  const { messages, sendMessage, status, stop, regenerate, setMessages, error } = useChat({
    transport,
    onFinish: () => { void refreshThreads() },
  })

  // El conversationId se pasa por-envío (no en render) para no leer el ref durante el render.
  const sendBody = useCallback(() => ({ conversationId: conversationIdRef.current }), [])

  const busy = status === 'submitted' || status === 'streaming'

  const refreshThreads = useCallback(async () => {
    const t = await getAssistantThreads()
    setThreads(t)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function startNew() {
    conversationIdRef.current = null
    setActiveId(null)
    setMessages([])
    setSheetOpen(false)
  }

  async function selectThread(id: string) {
    setSheetOpen(false)
    conversationIdRef.current = id
    setActiveId(id)
    const rows = await getThreadMessages(id)
    const loaded: UIMessage[] = rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => ({
        id: r.id,
        role: r.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: r.content ?? '' }],
      }))
    setMessages(loaded)
  }

  async function removeThread(id: string) {
    await deleteThreadAction(id)
    setThreads((t) => t.filter((x) => x.id !== id))
    if (activeId === id) startNew()
  }

  function handleSend(text: string) {
    if (!conversationIdRef.current) {
      conversationIdRef.current = uuid()
      setActiveId(conversationIdRef.current)
    }
    sendMessage({ text }, { body: sendBody() })
  }

  if (locked) return <LockedState />

  const showEmpty = messages.length === 0

  return (
    <div className="-m-3 flex h-[calc(100dvh-3.5rem)] min-h-0 lg:-m-6 lg:h-[calc(100dvh-3.5rem)]">
      {/* Sidebar de hilos (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
        <ThreadSidebar threads={threads} activeId={activeId} onSelect={selectThread} onNew={startNew} onDelete={removeThread} />
      </aside>

      {/* Columna de conversación */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            {/* Threads en mobile */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger className="lg:hidden flex size-8 items-center justify-center rounded-lg hover:bg-accent" aria-label="Historial">
                <History className="size-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetTitle className="sr-only">Conversaciones</SheetTitle>
                <ThreadSidebar threads={threads} activeId={activeId} onSelect={selectThread} onNew={startNew} onDelete={removeThread} />
              </SheetContent>
            </Sheet>

            <div className={`flex size-7 items-center justify-center rounded-lg border ${proMode ? 'assistant-pro-ring border-[oklch(0.78_0.12_85/0.4)]' : 'border-border bg-card'}`}>
              <Bot className={`size-4 ${proMode ? 'text-[oklch(0.78_0.12_85)]' : 'text-foreground/80'}`} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Asistente IA</p>
              <p className="text-[10px] text-muted-foreground">{modelLabel(modelId)}</p>
            </div>
            {proMode && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-[oklch(0.78_0.12_85/0.4)] px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.78_0.12_85)]">
                <Sparkles className="size-2.5" /> PRO
              </span>
            )}
          </div>
          <Link href="/dashboard/asistente/configuracion" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" title="Configurar">
            <Settings className="size-4" />
          </Link>
        </header>

        {/* Mensajes */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {showEmpty ? (
            hasKey ? (
              <EmptyState firstName={firstName} onPick={handleSend} />
            ) : (
              <NoKeyState />
            )
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {messages.map((m, i) => (
                <div key={m.id} className="group/msg">
                  <ChatMessage
                    message={m}
                    orgName={orgName}
                    isLast={i === messages.length - 1}
                    streaming={busy}
                    onRegenerate={() => regenerate({ body: sendBody() })}
                    proMode={proMode}
                  />
                </div>
              ))}
              {error && <ErrorRetry message="No pude completar la respuesta." onRetry={() => regenerate({ body: sendBody() })} />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <Composer
          onSubmit={handleSend}
          onStop={stop}
          busy={busy}
          disabled={!hasKey}
          placeholder={hasKey ? undefined : 'Conectá una clave de API para empezar…'}
        />
      </div>
    </div>
  )
}
