'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { WhatsAppIcon } from '../shared/icons'
import { useMensajeria } from '../shared/mensajeria-context'
import { searchClients } from '@/lib/actions/clients'

export function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { handleSchedule, isSending } = useMensajeria()
  const [data, setData] = useState({ clientId: '', content: '', scheduledFor: '' })
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<{ id: string; name: string; phone: string }[]>([])
  const [selectedClientLabel, setSelectedClientLabel] = useState('')

  // Buscar clientes on-demand mientras el usuario escribe.
  // Diferimos los setState con queueMicrotask para evitar cascading renders.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (!clientSearch || clientSearch.trim().length < 2) {
      queueMicrotask(() => {
        if (!cancelled) setClientResults([])
      })
      return () => { cancelled = true }
    }
    const timer = setTimeout(async () => {
      const result = await searchClients(clientSearch)
      if (cancelled) return
      setClientResults(result.data ?? [])
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [clientSearch, open])

  const handleSubmit = () => {
    handleSchedule(data)
    onOpenChange(false)
    setData({ clientId: '', content: '', scheduledFor: '' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Programar mensaje</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cliente</Label>
            {data.clientId ? (
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-foreground">{selectedClientLabel}</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground ml-2"
                  onClick={() => {
                    setData(prev => ({ ...prev, clientId: '' }))
                    setSelectedClientLabel('')
                    setClientSearch('')
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
                  placeholder="Buscar por nombre o teléfono..."
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                />
                {clientResults.length > 0 && (
                  <div className="rounded-lg border border-border bg-popover shadow-md overflow-hidden max-h-40 overflow-y-auto">
                    {clientResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                        onClick={() => {
                          setData(prev => ({ ...prev, clientId: c.id }))
                          setSelectedClientLabel(`${c.name} — ${c.phone}`)
                          setClientResults([])
                          setClientSearch('')
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Mensaje</Label>
            <Textarea className="bg-muted border text-white placeholder:text-muted-foreground resize-none" rows={3}
              placeholder="Escribí el mensaje..." value={data.content}
              onChange={e => setData(prev => ({ ...prev, content: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Fecha y hora</Label>
            <Input type="datetime-local" className="bg-muted border text-white"
              value={data.scheduledFor} onChange={e => setData(prev => ({ ...prev, scheduledFor: e.target.value }))} />
          </div>
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground flex items-start gap-2">
            <WhatsAppIcon className="size-3.5 text-green-400 shrink-0 mt-0.5" />
            El mensaje se envía automáticamente vía WhatsApp Business API
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
          <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleSubmit} disabled={isSending}>Programar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
