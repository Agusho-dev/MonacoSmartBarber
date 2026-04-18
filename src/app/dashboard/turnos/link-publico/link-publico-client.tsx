'use client'

import { useMemo, useState } from 'react'
import { Copy, Check, Link2, QrCode, Download, ExternalLink, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Copiado')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }
  return { copied, copy }
}

function ShareChip({ label, text }: { label: string; text: string }) {
  const { copied, copy } = useCopy(text)
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        copied
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground'
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copiado' : label}
    </button>
  )
}

function BranchCard({ branch, publicUrl, orgSlug }: { branch: Branch; publicUrl: string; orgSlug: string }) {
  const url = `${publicUrl}?branch=${branch.id}`
  const { copied, copy } = useCopy(url)
  const [expanded, setExpanded] = useState(false)
  const qrId = `qr-branch-${branch.id}`

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold truncate">{branch.name}</p>
          {branch.address && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{branch.address}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded(v => !v)}
          >
            <QrCode className="mr-1 h-3.5 w-3.5" />
            QR
            {expanded ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={copy}
          >
            {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" asChild>
            <a href={url} target="_blank" rel="noreferrer" aria-label="Abrir">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input value={url} readOnly onFocus={e => e.currentTarget.select()} className="h-7 font-mono text-[11px]" />
      </div>

      {expanded && (
        <div className="flex items-center gap-4 pt-1">
          <div id={qrId} className="rounded-lg border border-border bg-white p-3">
            <QRCodeSVG value={url} size={120} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadSvg(qrId, `turnos-${orgSlug}-${branch.name.replace(/\s+/g, '-').toLowerCase()}.svg`)}
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar SVG
          </Button>
        </div>
      )}
    </div>
  )
}

export function LinkPublicoClient({ isEnabled, baseUrl, orgSlug, orgName, branches }: Props) {
  const publicUrl = useMemo(() => `${baseUrl}/turnos/${orgSlug}`, [baseUrl, orgSlug])
  const { copied: copiedMain, copy: copyMain } = useCopy(publicUrl)

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

  const shareTexts = [
    {
      label: 'Publicación IG',
      text: `Reserva tu turno facil y rapido en ${orgName}: ${publicUrl}`,
    },
    {
      label: 'WhatsApp status',
      text: `Ahora podes reservar tu turno online las 24hs. Entra aca: ${publicUrl}`,
    },
    {
      label: 'Para la vidriera',
      text: `Reserva tu turno en ${orgName}\n${publicUrl}`,
    },
  ]

  return (
    <div className="space-y-6">
      {!isEnabled && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-muted-foreground">
            El turnero está deshabilitado. Los clientes no podrán reservar hasta que lo actives desde{' '}
            <a href="/dashboard/turnos/configuracion" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
              Configuración
            </a>
            .
          </p>
        </div>
      )}

      {/* Card HERO: QR + URL */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            <CardTitle>Link público de {orgName}</CardTitle>
            {isEnabled ? (
              <Badge variant="secondary" className="ml-auto text-xs">Activo</Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">Inactivo</Badge>
            )}
          </div>
          <CardDescription>Compartí este link para que tus clientes reserven online.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* QR en marco */}
            <div id="qr-general" className="shrink-0 self-center rounded-xl border border-border bg-white p-4 shadow-sm sm:self-start">
              <QRCodeSVG value={publicUrl} size={160} />
            </div>

            {/* URL + acciones */}
            <div className="flex flex-1 flex-col gap-4">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL pública</p>
                <div className="flex gap-2">
                  <Input
                    value={publicUrl}
                    readOnly
                    onFocus={e => e.currentTarget.select()}
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyMain}
                    aria-label="Copiar URL"
                    className="shrink-0"
                  >
                    {copiedMain ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" asChild aria-label="Abrir en nueva pestaña" className="shrink-0">
                    <a href={publicUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => downloadSvg('qr-general', `turnos-${orgSlug}.svg`)}
              >
                <Download className="mr-2 h-4 w-4" />
                Descargar QR en SVG
              </Button>

              {/* Chips de uso sugerido */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Copialo listo para compartir en:</p>
                <div className="flex flex-wrap gap-2">
                  {shareTexts.map(s => (
                    <ShareChip key={s.label} label={s.label} text={s.text} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Links por sucursal — solo si hay mas de 1 */}
      {branches.length > 1 && (
        <div className="space-y-4">
          <div>
            <h4 className="flex items-center gap-2 font-semibold">
              <QrCode className="h-4 w-4" />
              Links por sucursal
            </h4>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Deep-link que salta el paso de selección de sucursal.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {branches.map(b => (
              <BranchCard key={b.id} branch={b} publicUrl={publicUrl} orgSlug={orgSlug} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
