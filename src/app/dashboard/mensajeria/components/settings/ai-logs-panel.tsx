'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, ChevronDown, Bot, User } from 'lucide-react'
import { getAiExecutionLogs, type AiExecutionLog } from '@/lib/actions/ai-config'
import { formatRelativeDate } from '../shared/helpers'

export function AiLogsPanel() {
  const [logs, setLogs] = useState<AiExecutionLog[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const [filter, setFilter] = useState<'all' | 'error'>('all')

  const load = () => {
    startLoading(async () => {
      const res = await getAiExecutionLogs(50)
      if (!res.error) setLogs(res.data)
    })
  }

  useEffect(() => { load() }, [])

  const visible = filter === 'all' ? logs : logs.filter(l => l.status === 'error' || l.used_fallback)
  const errorCount = logs.filter(l => l.status === 'error' || l.used_fallback).length

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Diagnóstico de IA</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Últimas 50 ejecuciones del nodo de IA. Si un error aparece acá, copialo y ajustá el modelo o la API key.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            Todas <span className="opacity-60">({logs.length})</span>
          </button>
          <button
            onClick={() => setFilter('error')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${filter === 'error' ? 'bg-red-500/15 text-red-300' : 'text-muted-foreground hover:text-foreground'}`}>
            Errores <span className="opacity-60">({errorCount})</span>
          </button>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent/50 transition-colors">
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Bot className="mb-2 size-8 opacity-30" />
          <p className="text-xs">{filter === 'error' ? 'Sin errores recientes ✨' : 'Todavía no hay ejecuciones de IA'}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {visible.map(log => {
          const isOpen = expanded === log.id
          const isError = log.status === 'error' || log.used_fallback
          return (
            <div
              key={log.id}
              className={`rounded-lg border transition-all duration-200 overflow-hidden ${isError ? 'border-red-500/30 bg-red-500/5' : 'border bg-card'}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : log.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors">
                <div className="shrink-0 mt-0.5">
                  {isError
                    ? <AlertCircle className="size-4 text-red-400" />
                    : <CheckCircle2 className="size-4 text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-foreground truncate">{log.model ?? 'modelo desconocido'}</span>
                    {log.used_fallback && (
                      <span className="text-[9px] bg-orange-500/15 text-orange-300 px-1.5 py-px rounded font-medium">FALLBACK</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{formatRelativeDate(log.executed_at)}</span>
                  </div>
                  {(log.client_name || log.client_phone) && (
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                      <User className="size-2.5" />
                      <span className="truncate">{log.client_name ?? log.client_phone}</span>
                    </div>
                  )}
                  <p className={`text-[11px] mt-1 line-clamp-1 ${isError ? 'text-red-300' : 'text-muted-foreground'}`}>
                    {log.error_message ?? log.response_preview ?? '(sin contenido)'}
                  </p>
                </div>
                <ChevronDown className={`size-3.5 text-muted-foreground shrink-0 mt-0.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              <div
                className={`grid transition-all duration-200 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border/50">
                    {log.error_message && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-red-300/80 mb-1">Error</p>
                        <pre className="text-[11px] text-red-200 bg-red-950/40 border border-red-500/20 rounded p-2 whitespace-pre-wrap break-all font-mono">
                          {log.error_message}
                        </pre>
                      </div>
                    )}
                    {log.response_preview && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Respuesta (preview)</p>
                        <p className="text-[11px] text-foreground bg-muted rounded p-2 whitespace-pre-wrap">{log.response_preview}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                      <span>Modelo: <code className="text-foreground">{log.model ?? '—'}</code></span>
                      <span>Estado: <code className={isError ? 'text-red-300' : 'text-emerald-300'}>{log.status}</code></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
