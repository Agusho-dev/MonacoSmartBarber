'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'

const MAX_PX = 200

export function Composer({
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder,
}: {
  onSubmit: (text: string) => void
  onStop: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, MAX_PX)}px`
  }, [value])

  function send() {
    const t = value.trim()
    if (!t || disabled) return
    onSubmit(t)
    setValue('')
  }

  return (
    <div className="border-t border-border bg-background/80 px-3 pb-[env(safe-area-inset-bottom)] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 focus-within:border-foreground/30 transition-colors">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            if (e.key === 'Escape' && busy) { e.preventDefault(); onStop() }
          }}
          placeholder={placeholder ?? 'Preguntá lo que quieras sobre tu negocio…'}
          className="min-h-[28px] flex-1 resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          style={{ maxHeight: MAX_PX }}
        />
        {busy ? (
          <button
            onClick={onStop}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/90 text-white transition-transform hover:scale-105 active:scale-95"
            title="Detener (Esc)"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={disabled || !value.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            title="Enviar (Enter)"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-[10px] text-muted-foreground/60">
        El asistente usa tus datos reales. Verificá las cifras antes de decisiones importantes.
      </p>
    </div>
  )
}
