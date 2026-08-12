'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressToWebP, extensionDe } from '@/lib/image-utils'
import { Camera, Check, X, AlertCircle } from 'lucide-react'

export default function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => setToken(p.token))
  }, [params])

  if (!token) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black">
        <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    )
  }

  return <UploadClient token={token} />
}

function UploadClient({ token }: { token: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid' | 'expired'>('loading')
  const [uploads, setUploads] = useState<{ url: string; uploading: boolean; failed?: boolean }[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Validate token on mount
  useEffect(() => {
    async function validate() {
      const { data, error } = await supabase
        .from('qr_photo_sessions')
        .select('id, is_active')
        .eq('token', token)
        .single()

      if (error || !data) {
        setStatus('invalid')
        return
      }
      if (!data.is_active) {
        setStatus('expired')
        return
      }
      setSessionId(data.id)
      setStatus('ready')
    }
    validate()
  }, [supabase, token])

  // Listen for session deactivation
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`qr-session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qr_photo_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.new.is_active === false) {
            setStatus('expired')
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, sessionId])

  async function handleFiles(files: FileList | null) {
    if (!files || !sessionId || status !== 'ready') return
    setUploading(true)
    setUploadError(null)

    for (const file of Array.from(files)) {
      const previewUrl = URL.createObjectURL(file)
      const idx = uploads.length
      setUploads((prev) => [...prev, { url: previewUrl, uploading: true }])

      try {
        // El helper compartido: si no puede decodificar (un HEIC de iPhone,
        // por ejemplo) devuelve el archivo original en vez de tirar la subida
        // abajo, y avisa cuál es el tipo REAL de los bytes.
        const imagen = await compressToWebP(file)
        const filename = `${crypto.randomUUID()}.${extensionDe(imagen.contentType)}`
        const storagePath = `qr-${token}/${filename}`

        const { error: uploadError } = await supabase.storage
          .from('visit-photos')
          .upload(storagePath, imagen.blob, {
            contentType: imagen.contentType,
            cacheControl: '31536000',
          })

        if (uploadError) throw uploadError

        // Sin esta fila el panel del barbero nunca se entera: la foto queda en
        // el bucket y no aparece en ningún lado. El error se chequea — antes
        // era un `await` pelado, o sea un fallo invisible.
        const { error: dbError } = await supabase
          .from('qr_photo_uploads')
          .insert({ session_id: sessionId, storage_path: storagePath })

        if (dbError) throw dbError

        setUploads((prev) =>
          prev.map((u, i) => (i === idx ? { ...u, uploading: false } : u))
        )
      } catch (err) {
        console.error('Upload failed', err)
        setUploadError(
          err instanceof Error
            ? `No se pudo subir "${file.name}": ${err.message}`
            : `No se pudo subir "${file.name}".`
        )
        setUploads((prev) =>
          prev.map((u, i) => (i === idx ? { ...u, uploading: false, failed: true } : u))
        )
      }
    }
    setUploading(false)

    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Invalid / expired states ──
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black">
        <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-red-500/20">
          <X className="size-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Enlace inválido</h1>
        <p className="text-sm text-white/60">
          Este código QR no es válido. Generá uno nuevo desde el panel.
        </p>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-amber-500/20">
          <Check className="size-8 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Sesión finalizada</h1>
        <p className="text-sm text-white/60">
          {uploads.length > 0
            ? `${uploads.length} foto${uploads.length !== 1 ? 's' : ''} enviada${uploads.length !== 1 ? 's' : ''} correctamente.`
            : 'El barbero cerró la sesión de fotos.'}
        </p>
      </div>
    )
  }

  // ── Ready state ──
  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h1 className="text-lg font-bold">BarberOS</h1>
        {uploads.length > 0 && (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400">
            {uploads.length} foto{uploads.length !== 1 ? 's' : ''}
          </span>
        )}
      </header>

      {/* Photo previews */}
      {uploads.length > 0 && (
        <div className="flex gap-2 overflow-x-auto p-4 pb-2">
          {uploads.map((u, i) => (
            <div key={i} className="relative shrink-0">
              {/* Blob URL de URL.createObjectURL — Image no soporta blobs eficientemente */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u.url}
                alt={`Foto ${i + 1}`}
                className="size-20 rounded-xl border border-white/10 object-cover"
              />
              {u.uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                  <div className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </div>
              )}
              {!u.uploading && !u.failed && (
                <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="size-3 text-white" />
                </div>
              )}
              {u.failed && (
                <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500">
                  <AlertCircle className="size-3 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main action area */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex size-36 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-white/20 bg-white/5 transition-colors active:bg-white/10 disabled:opacity-50"
        >
          <Camera className="size-12 text-white/80" />
          <span className="text-sm font-medium text-white/80">
            {uploading ? 'Subiendo...' : 'Sacar Foto'}
          </span>
        </button>

        {/* El fallo se DICE. Antes sólo se pintaba de rojo la miniatura y el
            barbero se quedaba esperando una foto que nunca iba a llegar. */}
        {uploadError && (
          <p
            className="flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-xs text-red-200"
            role="alert"
          >
            <AlertCircle className="mt-px size-4 shrink-0" />
            <span>{uploadError}</span>
          </p>
        )}

        <p className="text-center text-xs text-white/40">
          Las fotos se envían automáticamente al panel del barbero
        </p>
      </div>
    </div>
  )
}
