'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => Promise<void>
}

export function RejectDialog({ open, onOpenChange, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (reason.trim().length < 3) return
    setLoading(true)
    try {
      await onConfirm(reason.trim())
      setReason('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar convenio</DialogTitle>
          <DialogDescription>
            El partner verá el motivo para corregirlo y volver a enviar.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Ej: La imagen no muestra bien el producto, actualizá y volvé a enviar."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={400}
          disabled={loading}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">{reason.length}/400</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={loading || reason.trim().length < 3}
          >
            {loading && <Loader2 className="size-4 animate-spin mr-2" />}
            Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
