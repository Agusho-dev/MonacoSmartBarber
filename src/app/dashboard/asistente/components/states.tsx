'use client'

import Link from 'next/link'
import { Bot, RotateCcw, KeyRound, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LockedState() {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="glass-card max-w-md rounded-3xl p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-[oklch(0.78_0.12_85/0.4)]">
          <Bot className="size-7 text-[oklch(0.78_0.12_85)]" />
        </div>
        <h2 className="mt-4 text-xl font-bold">El Asistente IA es parte de Enterprise</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu copiloto de negocio: analiza tus números en tiempo real, arma informes en PDF y responde lo que le preguntes.
        </p>
        <ul className="mx-auto mt-4 max-w-xs space-y-1.5 text-left text-sm text-muted-foreground">
          <li className="flex items-center gap-2"><Sparkles className="size-3.5 text-[oklch(0.78_0.12_85)]" /> Reportes y P&L al instante</li>
          <li className="flex items-center gap-2"><Sparkles className="size-3.5 text-[oklch(0.78_0.12_85)]" /> Búsqueda inteligente de clientes y reseñas</li>
          <li className="flex items-center gap-2"><Sparkles className="size-3.5 text-[oklch(0.78_0.12_85)]" /> Modo Pro con consultas SQL</li>
        </ul>
        <Button asChild className="btn-gold mt-6">
          <Link href="/dashboard/billing">Ver planes</Link>
        </Button>
      </div>
    </div>
  )
}

export function NoKeyState() {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-md rounded-3xl border border-border bg-card/60 p-8 text-center">
        <div className="relative mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
          <span className="absolute inset-0 rounded-2xl bg-foreground/5" style={{ animation: 'pulseRing 2.4s ease-in-out infinite' }} />
          <KeyRound className="size-7 text-foreground/80" />
        </div>
        <h2 className="mt-4 text-xl font-bold">Tu copiloto está casi listo</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo falta conectar una clave de API (Anthropic para el chat, OpenAI para la búsqueda semántica). Se configura en un minuto.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard/asistente/configuracion">
            <KeyRound className="mr-1.5 size-4" /> Conectar una clave de API
          </Link>
        </Button>
      </div>
    </div>
  )
}

export function ErrorRetry({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="mx-auto my-3 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <p>{message ?? 'No pude completar la respuesta.'}</p>
      <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/30">
        <RotateCcw className="size-3.5" /> Reintentar
      </button>
    </div>
  )
}
