'use client'

import { useMemo, useState } from 'react'
import { Copy, Check, Link2, QrCode, Download, ExternalLink, AlertTriangle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'

interface Branch { id: string; name: string; address: string | null }

interface Props {
  isEnabled: boolean
  baseUrl: string
  orgSlug: string
  orgName: string
  branches: Branch[]
}

function downloadSvg(id: string, filename: string) {
  const node = document.getElementById(id)
  if (!node) return
  const svg = node.querySelector('svg')
  if (!svg) return
  const serializer = new XMLSerializer()
  const source = '<?xml version="1.0" standalone="no"?>\r\n' + serializer.serializeToString(svg)
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function CopyLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button variant="outline" size="icon" onClick={copy} aria-label="Copiar">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button variant="outline" size="icon" asChild aria-label="Abrir">
          <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a>
        </Button>
      </div>
    </div>
  )
}

export function LinkPublicoClient({ isEnabled, baseUrl, orgSlug, orgName, branches }: Props) {
  const publicUrl = useMemo(() => `${baseUrl}/turnos/${orgSlug}`, [baseUrl, orgSlug])

  if (!orgSlug) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="size-10 text-amber-500" />
          <div>
            <p className="font-medium">Tu organización no tiene un slug público configurado.</p>
            <p className="text-sm text-muted-foreground">Contactá a soporte para generar el link.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {!isEnabled && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <p>El turnero está deshabilitado. Los clientes no podrán reservar hasta que lo actives desde Configuración.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="size-5" /> Link público de {orgName}</CardTitle>
          <CardDescription>Compartí este link para que tus clientes reserven online.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyLinkRow label="Link general" url={publicUrl} />

          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[auto_1fr]">
            <div id="qr-general" className="rounded-md bg-white p-3">
              <QRCodeSVG value={publicUrl} size={140} />
            </div>
            <div className="flex flex-col justify-between gap-3">
              <div>
                <p className="font-medium">Código QR</p>
                <p className="text-sm text-muted-foreground">Pegalo en la vidriera o imprimilo en tarjetas.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadSvg('qr-general', `turnos-${orgSlug}.svg`)}
                className="self-start"
              >
                <Download className="mr-2 size-4" /> Descargar SVG
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {branches.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><QrCode className="size-5" /> Links por sucursal</CardTitle>
            <CardDescription>Deep-link que salta el paso de elegir sucursal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {branches.map((b) => {
              const url = `${publicUrl}?branch=${b.id}`
              return (
                <div key={b.id} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{b.name}</p>
                    {b.address && <p className="text-xs text-muted-foreground">{b.address}</p>}
                  </div>
                  <CopyLinkRow label="Link directo" url={url} />
                  <details className="group">
                    <summary className="cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground">
                      Ver QR
                    </summary>
                    <div className="mt-3 flex items-center gap-3">
                      <div id={`qr-${b.id}`} className="rounded-md bg-white p-3">
                        <QRCodeSVG value={url} size={120} />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadSvg(`qr-${b.id}`, `turnos-${orgSlug}-${b.name.replace(/\s+/g, '-').toLowerCase()}.svg`)}
                      >
                        <Download className="mr-2 size-4" /> Descargar SVG
                      </Button>
                    </div>
                  </details>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
