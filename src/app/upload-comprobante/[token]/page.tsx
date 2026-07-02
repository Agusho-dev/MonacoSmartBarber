'use client'

import { useEffect, useRef, useState } from 'react'
import { compressToWebP } from '@/lib/image-utils'
import { submitReceiptUpload } from '@/lib/actions/receipts'
import { Check, Loader2, AlertCircle, ScanLine, ImageUp } from 'lucide-react'

export default function UploadComprobantePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)
  useEffect(() => { params.then((p) => setToken(p.token)) }, [params])

  if (!token) {
    return (
      <div className="grid min-h-dvh place-items-center bg-neutral-950">
        <Loader2 className="size-8 animate-spin text-white/40" />
      </div>
    )
  }
  return <Uploader token={token} />
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

type Phase = 'idle' | 'uploading' | 'done' | 'error'

function Uploader({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(files: FileList | null) {
    if (!files?.length) return
    setPhase('uploading'); setError(null)
    try {
      const webp = await compressToWebP(files[0], 1600, 0.85)
      const base64 = await blobToBase64(webp)
      const res = await submitReceiptUpload(token, base64, 'image/webp')
      if ('error' in res) { setError(res.error); setPhase('error'); return }
      setPhase('done')
    } catch {
      setError('No se pudo subir. Probá de nuevo.')
      setPhase('error')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-neutral-950 px-6 py-10 text-white">
      <div className="flex items-center gap-2 text-emerald-400">
        <ScanLine className="size-6" />
        <span className="text-lg font-bold tracking-tight">Comprobante</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />

      {phase === 'done' ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="animate-pro-celebrate grid size-24 place-items-center rounded-full border-2 border-emerald-400 bg-emerald-500/20">
            <Check className="size-12 text-emerald-300" />
          </div>
          <p className="text-2xl font-bold">¡Comprobante enviado!</p>
          <p className="max-w-xs text-white/60">Ya podés guardar el celular. Mirá la pantalla del local para confirmar.</p>
        </div>
      ) : phase === 'uploading' ? (
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-12 animate-spin text-emerald-400" />
          <p className="text-lg font-medium">Enviando…</p>
        </div>
      ) : (
        <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center">
          <div className="grid size-24 place-items-center rounded-3xl border border-white/10 bg-white/5">
            <ImageUp className="size-11 text-white/70" />
          </div>
          <p className="text-white/70">Elegí la captura de la transferencia que le hiciste al local.</p>
          {phase === 'error' && error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="h-14 w-full rounded-2xl bg-emerald-500 text-lg font-bold text-neutral-950 transition-colors hover:bg-emerald-400"
          >
            {phase === 'error' ? 'Reintentar' : 'Subir comprobante'}
          </button>
        </div>
      )}
    </div>
  )
}
