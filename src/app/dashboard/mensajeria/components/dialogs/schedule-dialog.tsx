'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { WhatsAppIcon } from '../shared/icons'
import { useMensajeria } from '../shared/mensajeria-context'

export function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { clients, handleSchedule, isSending } = useMensajeria()
  const [data, setData] = useState({ clientId: '', content: '', scheduledFor: '' })

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
            <select className="w-full rounded-lg bg-muted px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-green-500/40"
              value={data.clientId} onChange={e => setData(prev => ({ ...prev, clientId: e.target.value }))}>
              <option value="" className="bg-muted">Seleccioná un cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id} className="bg-muted">{c.name} — {c.phone}</option>)}
            </select>
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
