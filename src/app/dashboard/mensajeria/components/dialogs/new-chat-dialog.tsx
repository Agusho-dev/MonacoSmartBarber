'use client'

import { useState, useMemo } from 'react'
import { Search, Check, Pencil, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Avatar } from '../shared/avatar'
import { useMensajeria } from '../shared/mensajeria-context'

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { clients, isConfigured, isStarting, handleStartConversation } = useMensajeria()
  const [newChatClientId, setNewChatClientId] = useState('')
  const [newChatSearch, setNewChatSearch] = useState('')

  const filteredClients = useMemo(() => {
    if (!newChatSearch) return clients.slice(0, 20)
    const s = newChatSearch.toLowerCase()
    return clients.filter(c =>
      c.name.toLowerCase().includes(s) || (c.phone || '').toLowerCase().includes(s)
    ).slice(0, 20)
  }, [clients, newChatSearch])

  const handleStart = () => {
    handleStartConversation(newChatClientId)
    onOpenChange(false)
    setNewChatClientId('')
    setNewChatSearch('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-green-400" /> Nueva conversación
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full rounded-lg bg-muted pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
              placeholder="Buscar cliente..." value={newChatSearch} onChange={(e) => setNewChatSearch(e.target.value)} />
          </div>
          <ScrollArea className="h-64 rounded-lg bg-muted">
            {filteredClients.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm py-8">Sin resultados</div>
            ) : (
              <div>
                {filteredClients.map(c => (
                  <button key={c.id} onClick={() => setNewChatClientId(c.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 transition-colors border-b border ${newChatClientId === c.id ? 'bg-green-600/20' : 'hover:bg-muted'}`}>
                    <Avatar name={c.name} size={8} />
                    <div className="text-left min-w-0">
                      <p className="text-sm text-foreground font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.phone || 'Sin teléfono'}</p>
                    </div>
                    {newChatClientId === c.id && <Check className="size-4 text-green-400 ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          {!isConfigured && (
            <p className="text-xs text-orange-400 flex items-center gap-1.5">
              <AlertCircle className="size-3.5" /> Necesitás configurar WhatsApp primero
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">Cancelar</Button>
          <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleStart}
            disabled={!newChatClientId || !isConfigured || isStarting}>
            {isStarting ? 'Abriendo...' : 'Abrir chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
