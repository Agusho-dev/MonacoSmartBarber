'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRCodeSVG } from 'qrcode.react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { QrCode, Check } from 'lucide-react'

interface QrPhotoButtonProps {
  /** Called with { storagePath, publicUrl } every time a photo arrives from mobile */
  onPhotoReceived: (photo: { storagePath: string; publicUrl: string }) => void
  /** When the session is created/destroyed, pass the session id upward */
  onSessionChange?: (sessionId: string | null) => void
  disabled?: boolean
}

export function QrPhotoButton({
  onPhotoReceived,
  onSessionChange,
  disabled,
}: QrPhotoButtonProps) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [photoCount, setPhotoCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Create session when dialog opens
  const createSession = useCallback(async () => {
    // La organización sale de la cookie de sesión del barbero, resuelta en el
    // servidor. Acá antes se hacía `supabase.auth.getUser()`: este panel se
    // autentica por PIN, NO por Supabase Auth, así que `user` era null y la
    // función cortaba en su primera línea sin decir nada. Resultado: el QR no
    // se generaba nunca y nadie subió una foto por esta vía desde abril.
    setError(null)
    const { createQrPhotoSession } = await import('@/lib/actions/uploads')
    const res = await createQrPhotoSession()

    if ('error' in res) {
      setError(res.error)
      return
    }

    setSessionId(res.id)
    setToken(res.token)
    onSessionChange?.(res.id)
  }, [onSessionChange])

  // Deactivate session
  const deactivateSession = useCallback(async () => {
    if (!sessionId) return
    const { deactivateQrPhotoSession } = await import('@/lib/actions/uploads')
    await deactivateQrPhotoSession(sessionId)
    onSessionChange?.(null)
  }, [sessionId, onSessionChange])

  // Handle dialog open/close
  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      setPhotoCount(0)
      createSession()
    } else {
      deactivateSession()
      setSessionId(null)
      setToken(null)
    }
  }

  // Subscribe to realtime inserts on qr_photo_uploads for this session
  useEffect(() => {
    if (!sessionId || !open) return

    const channel = supabase
      .channel(`qr-uploads-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'qr_photo_uploads',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const storagePath = payload.new.storage_path as string
          const { data } = supabase.storage
            .from('visit-photos')
            .getPublicUrl(storagePath)
          onPhotoReceived({ storagePath, publicUrl: data.publicUrl })
          setPhotoCount((c) => c + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, sessionId, open, onPhotoReceived])

  const uploadUrl = token ? `${window.location.origin}/upload/${token}` : ''

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-14 flex-1 text-base"
        onClick={() => handleOpenChange(true)}
        disabled={disabled}
      >
        <QrCode className="mr-2 size-5" />
        QR
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Escanear con tu celular</DialogTitle>
            <DialogDescription>
              Escaneá el QR con la cámara de tu celular para sacar fotos del servicio
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {token ? (
              <div className="rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={uploadUrl}
                  size={220}
                  level="M"
                  includeMargin={false}
                />
              </div>
            ) : error ? (
              // Antes acá no había nada: cuando la sesión no se creaba, el
              // diálogo se quedaba en "Generando..." para siempre y el barbero
              // no tenía forma de saber que estaba roto.
              <div className="flex size-[252px] flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center">
                <p className="text-sm font-medium text-destructive">{error}</p>
                <Button type="button" size="sm" variant="outline" onClick={createSession}>
                  Reintentar
                </Button>
              </div>
            ) : (
              <div className="flex size-[252px] items-center justify-center rounded-2xl bg-muted">
                <span className="text-sm text-muted-foreground">Generando...</span>
              </div>
            )}

            {photoCount > 0 && (
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                <Check className="size-4" />
                {photoCount} foto{photoCount !== 1 ? 's' : ''} recibida{photoCount !== 1 ? 's' : ''}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Las fotos se cargarán automáticamente en el panel
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
