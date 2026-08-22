'use client'

// =============================================================================
// Composer de campaña push. Hoja lateral con: mensaje (título/cuerpo/imagen),
// destino al tocar, audiencia (filtros + alcance real), envío (ahora /
// programado / borrador), prueba al propio celular y vista previa iOS.
// =============================================================================

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  AlertCircle, CalendarClock, ImagePlus, Link2, Loader2, Send, Smartphone, Users, X, FileEdit, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { compressToWebP } from '@/lib/image-utils'
import type { AudienceFilters as AudienceFiltersShape } from '@/lib/actions/client-segments'
import {
  createPushCampaign, previewPushAudience, sendTestPush, uploadPushImage,
  type PushAudiencePreview, type PushCampaignRow, type PushEnvioResultado,
} from '@/lib/actions/push-notifications'
import {
  PUSH_BODY_MAX, PUSH_DESTINOS, PUSH_NAME_MAX, PUSH_TITLE_MAX, branchIdDeDeepLink,
} from '@/lib/push/constants'
import { AudienceFilters, type AudienceBranch, type AudienceTag } from './audience-filters'
import { NotificationPreview } from './notification-preview'
import { hoyEn } from './helpers'

export interface CampaignPrefill {
  name?: string
  title?: string
  body?: string
  imageUrl?: string | null
  deepLink?: string | null
  audienceFilters?: AudienceFiltersShape
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
  org: { name: string; logoUrl: string | null }
  branches: AudienceBranch[]
  tags: AudienceTag[]
  prefill?: CampaignPrefill | null
  onCreated: (campaign: PushCampaignRow, envio: PushEnvioResultado | null) => void
}

type Modo = 'now' | 'schedule' | 'draft'

function Contador({ n, max }: { n: number; max: number }) {
  const pasado = n > max
  return (
    <span className={`tabular-nums text-[11px] ${pasado ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
      {n}/{max}
    </span>
  )
}

export function CampaignSheet({ open, onOpenChange, timezone, org, branches, tags, prefill, onCreated }: Props) {
  // Cada apertura arranca limpia (o con el prefill de "duplicar"): la hoja se
  // remonta por `key` desde el padre, así que el estado inicial alcanza.
  const [name, setName] = useState(prefill?.name ?? '')
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [body, setBody] = useState(prefill?.body ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(prefill?.imageUrl ?? null)
  const [imageMode, setImageMode] = useState<'none' | 'upload' | 'url'>(prefill?.imageUrl ? 'url' : 'none')
  const [imageUrlInput, setImageUrlInput] = useState(prefill?.imageUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const prefBranch = branchIdDeDeepLink(prefill?.deepLink)
  const [destino, setDestino] = useState<string>(prefBranch ? 'branch' : (prefill?.deepLink ?? '/home'))
  const [destinoBranch, setDestinoBranch] = useState<string>(prefBranch ?? branches[0]?.id ?? '')

  const [filters, setFilters] = useState<AudienceFiltersShape>(prefill?.audienceFilters ?? { hasPhone: true })
  const [preview, setPreview] = useState<PushAudiencePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [modo, setModo] = useState<Modo>('now')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')

  const [isSaving, startSaving] = useTransition()
  const [isTesting, startTesting] = useTransition()
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  const deepLink = destino === 'branch' ? (destinoBranch ? `/branch/${destinoBranch}` : null) : destino

  // Alcance de la audiencia, con debounce. Es la pregunta que más importa:
  // "¿cuántos de verdad van a recibir esto?"
  useEffect(() => {
    if (!open) return
    setPreviewLoading(true)
    const t = setTimeout(() => {
      previewPushAudience(filters).then(r => {
        setPreview(r)
        setPreviewLoading(false)
      })
    }, 450)
    return () => clearTimeout(t)
  }, [open, filters])

  const titleOk = title.trim().length > 0 && title.trim().length <= PUSH_TITLE_MAX
  const bodyOk = body.trim().length > 0 && body.trim().length <= PUSH_BODY_MAX
  const nameOk = name.trim().length >= 2 && name.trim().length <= PUSH_NAME_MAX
  const scheduleOk = modo !== 'schedule' || (!!fecha && !!hora)
  const destinoOk = destino !== 'branch' || !!destinoBranch
  const puedeGuardar = titleOk && bodyOk && nameOk && scheduleOk && destinoOk && !uploading

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const { blob, contentType } = await compressToWebP(file, 1200, 0.8)
      const fd = new FormData()
      const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'webp'
      fd.append('file', new File([blob], `campania.${ext}`, { type: contentType }))
      const r = await uploadPushImage(fd)
      if ('error' in r) { toast.error(r.error); return }
      setImageUrl(r.url)
      toast.success('Imagen lista')
    } catch (e) {
      toast.error('No pudimos procesar la imagen: ' + (e instanceof Error ? e.message : 'error desconocido'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const aplicarUrl = () => {
    const u = imageUrlInput.trim()
    if (!u) { setImageUrl(null); return }
    if (!/^https:\/\//i.test(u)) { toast.error('La imagen tiene que ser una URL https'); return }
    setImageUrl(u)
  }

  const handleTest = () => {
    if (!titleOk || !bodyOk) { toast.error('Completá título y cuerpo antes de probar'); return }
    startTesting(async () => {
      const r = await sendTestPush({ title: title.trim(), body: body.trim(), imageUrl, deepLink })
      if ('error' in r) { toast.error(r.error, { duration: 7000 }); return }
      toast.success(`Prueba encolada para ${r.clientName} (${r.dispositivos} dispositivo${r.dispositivos === 1 ? '' : 's'}). Llega en menos de un minuto.`)
    })
  }

  const handleSubmit = () => {
    if (!puedeGuardar) return
    setErrorGeneral(null)
    startSaving(async () => {
      const r = await createPushCampaign({
        name: name.trim(),
        title: title.trim(),
        body: body.trim(),
        imageUrl,
        deepLink,
        audienceFilters: filters,
        mode: modo,
        scheduledDate: modo === 'schedule' ? fecha : undefined,
        scheduledTime: modo === 'schedule' ? hora : undefined,
      })
      if (r.error !== null) {
        if (r.data) {
          // Se creó pero no se pudo encolar (p. ej. nadie con la app): quedó
          // guardada. La sumamos a la lista y cerramos, así no se duplica al
          // reintentar; el motivo va en el toast.
          toast.error(r.error, { duration: 10000, description: 'La campaña quedó guardada en la lista; podés enviarla más tarde.' })
          onCreated(r.data, null)
          onOpenChange(false)
          return
        }
        setErrorGeneral(r.error)
        toast.error(r.error, { duration: 8000 })
        return
      }
      if (modo === 'draft') toast.success('Borrador guardado')
      else if (r.envio?.estado === 'scheduled') toast.success(`Campaña programada para ${r.envio.encolados} cliente${r.envio.encolados === 1 ? '' : 's'}`)
      else toast.success(`Enviando a ${r.envio?.encolados ?? 0} cliente${r.envio?.encolados === 1 ? '' : 's'} con la app`)
      onCreated(r.data, r.envio)
      onOpenChange(false)
    })
  }

  const alcanzables = preview?.alcanzables ?? null
  const sinNadie = preview !== null && !previewLoading && alcanzables === 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Send className="size-4 text-muted-foreground" /> Nueva campaña push
          </SheetTitle>
          <SheetDescription>
            Llega a los clientes que tienen la app instalada y las notificaciones activas.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* ───────────────────────── Formulario ───────────────────────── */}
          <div className="space-y-7">
            {/* Mensaje */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Mensaje</h3>
              <div className="grid gap-2">
                <Label htmlFor="camp-name">Nombre interno</Label>
                <Input id="camp-name" value={name} maxLength={PUSH_NAME_MAX} onChange={e => setName(e.target.value)}
                  placeholder="Ej: Promo invierno VIP" />
                <p className="text-[11px] text-muted-foreground">Sólo lo ves vos, para encontrar la campaña después.</p>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="camp-title">Título</Label>
                  <Contador n={title.length} max={PUSH_TITLE_MAX} />
                </div>
                <Input id="camp-title" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="Ej: Esta semana 20% off en barba" aria-invalid={title.length > PUSH_TITLE_MAX} />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="camp-body">Cuerpo</Label>
                  <Contador n={body.length} max={PUSH_BODY_MAX} />
                </div>
                <Textarea id="camp-body" rows={4} value={body} onChange={e => setBody(e.target.value)}
                  placeholder="Contá en una o dos líneas qué hay y qué tiene que hacer el cliente."
                  aria-invalid={body.length > PUSH_BODY_MAX} />
              </div>

              {/* Imagen */}
              <div className="grid gap-2">
                <Label>Imagen (opcional)</Label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { k: 'none' as const, label: 'Sin imagen', icon: X },
                    { k: 'upload' as const, label: 'Subir', icon: ImagePlus },
                    { k: 'url' as const, label: 'Pegar URL', icon: Link2 },
                  ]).map(o => (
                    <button key={o.k} type="button" onClick={() => { setImageMode(o.k); if (o.k === 'none') setImageUrl(null) }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        imageMode === o.k ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                      }`}>
                      <o.icon className="size-3.5" /> {o.label}
                    </button>
                  ))}
                </div>
                {imageMode === 'upload' && (
                  <div className="flex items-center gap-3">
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                      {imageUrl ? 'Cambiar imagen' : 'Elegir imagen'}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">JPG, PNG o WEBP. Se comprime antes de subir.</span>
                  </div>
                )}
                {imageMode === 'url' && (
                  <div className="flex gap-2">
                    <Input value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} onBlur={aplicarUrl}
                      placeholder="https://…/imagen.jpg" />
                    <Button type="button" variant="outline" size="sm" className="h-9" onClick={aplicarUrl}>Usar</Button>
                  </div>
                )}
                {imageUrl && (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="" className="size-12 rounded-md object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{imageUrl}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar imagen"
                      onClick={() => { setImageUrl(null); setImageUrlInput('') }}>
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </section>

            {/* Destino */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Al tocar la notificación, abrir</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={destino} onValueChange={setDestino}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Elegí un destino" /></SelectTrigger>
                  <SelectContent>
                    {PUSH_DESTINOS.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {destino === 'branch' && (
                  <Select value={destinoBranch} onValueChange={setDestinoBranch}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {PUSH_DESTINOS.find(d => d.value === destino)?.descripcion}
              </p>
            </section>

            {/* Audiencia */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Audiencia</h3>
              </div>
              <AudienceFilters branches={branches} tags={tags} initial={prefill?.audienceFilters} onChange={setFilters} />

              <div className={`rounded-xl border p-4 ${sinNadie ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-card'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <span className="text-sm">Clientes que cumplen los filtros</span>
                  </div>
                  <span className="text-lg font-semibold tabular-nums">
                    {previewLoading ? <Loader2 className="inline size-4 animate-spin text-muted-foreground" /> : (preview?.total ?? '—').toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="size-4 text-emerald-500" />
                    <span className="text-sm">Con la app y notificaciones activas</span>
                  </div>
                  <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {previewLoading ? <Loader2 className="inline size-4 animate-spin" /> : (alcanzables ?? '—').toLocaleString('es-AR')}
                  </span>
                </div>
                {preview && !previewLoading && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {preview.conApp.toLocaleString('es-AR')} con la app instalada
                    {preview.optOut > 0 && ` · ${preview.optOut.toLocaleString('es-AR')} apagaron las campañas`}
                    {preview.total - preview.conApp > 0 && ` · ${(preview.total - preview.conApp).toLocaleString('es-AR')} sin la app`}
                    {preview.error && <span className="text-destructive"> · {preview.error}</span>}
                  </p>
                )}
                {sinNadie && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    Nadie de esta audiencia tiene la app con notificaciones activas. Podés guardarla como borrador, pero hoy no llegaría a nadie.
                  </p>
                )}
              </div>
            </section>

            {/* Envío */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Envío</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  { k: 'now' as const, label: 'Enviar ahora', desc: 'Sale en el próximo minuto', icon: Zap },
                  { k: 'schedule' as const, label: 'Programar', desc: 'Elegí día y hora', icon: CalendarClock },
                  { k: 'draft' as const, label: 'Guardar borrador', desc: 'La mandás después', icon: FileEdit },
                ]).map(o => (
                  <button key={o.k} type="button" onClick={() => setModo(o.k)} aria-pressed={modo === o.k}
                    className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                      modo === o.k ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/40'
                    }`}>
                    <o.icon className={`mt-0.5 size-4 shrink-0 ${modo === o.k ? 'text-foreground' : 'text-muted-foreground'}`} />
                    <span>
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              {modo === 'schedule' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="camp-fecha">Fecha</Label>
                    <Input id="camp-fecha" type="date" min={hoyEn(timezone)} value={fecha} onChange={e => setFecha(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="camp-hora">Hora</Label>
                    <Input id="camp-hora" type="time" value={hora} onChange={e => setHora(e.target.value)} />
                  </div>
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    Hora local de la barbería ({timezone}). La campaña queda encolada y sale a esa hora; podés cancelarla antes.
                  </p>
                </div>
              )}
            </section>

            {errorGeneral && (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{errorGeneral}</span>
              </div>
            )}
          </div>

          {/* ───────────────────────── Vista previa ───────────────────────── */}
          <aside className="space-y-3 lg:sticky lg:top-5 lg:self-start">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vista previa</p>
            <NotificationPreview appName={org.name} logoUrl={org.logoUrl} title={title} body={body} imageUrl={imageUrl} />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Así se ve en la pantalla bloqueada de un iPhone. En Android el corte del texto puede variar un poco.
            </p>
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleTest} disabled={isTesting || !titleOk || !bodyOk}>
              {isTesting ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
              Enviarme una prueba
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Le llega al cliente registrado con tu mismo teléfono de Equipo.
            </p>
          </aside>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleSubmit} disabled={!puedeGuardar || isSaving}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : modo === 'draft' ? <FileEdit className="size-4" /> : modo === 'schedule' ? <CalendarClock className="size-4" /> : <Send className="size-4" />}
            {modo === 'draft' ? 'Guardar borrador' : modo === 'schedule' ? 'Programar campaña' : `Enviar ahora${alcanzables != null && !previewLoading ? ` a ${alcanzables.toLocaleString('es-AR')}` : ''}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
