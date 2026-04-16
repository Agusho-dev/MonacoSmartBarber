'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, useRef } from 'react'
import {
  ArrowLeft,
  Upload,
  Loader2,
  Save,
  ImageIcon,
  AlertCircle,
  Calendar,
  MapPin,
  Tag,
  FileText,
  Building2,
  X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { createBenefit, updateBenefit, uploadBenefitImage } from '@/lib/actions/partner-portal'
import type { PartnerBenefit } from '@/lib/types/database'

type OrgOption = { id: string; name: string; logo_url: string | null }

interface Props {
  mode: 'create' | 'edit'
  orgs: OrgOption[]
  initial?: Partial<PartnerBenefit> & { id?: string; organization_id?: string }
}

export function BenefitFormClient({ mode, orgs, initial }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const [form, setForm] = useState({
    organization_id: initial?.organization_id ?? (orgs[0]?.id ?? ''),
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    discount_text: initial?.discount_text ?? '',
    image_url: initial?.image_url ?? '',
    terms: initial?.terms ?? '',
    location_address: initial?.location_address ?? '',
    location_map_url: initial?.location_map_url ?? '',
    valid_from: toLocalInput(initial?.valid_from),
    valid_until: toLocalInput(initial?.valid_until),
  })

  const onUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen supera 5 MB')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      const r = await uploadBenefitImage(fd)
      if (r.success && r.url) {
        setForm((f) => ({ ...f, image_url: r.url! }))
        toast.success('Imagen subida')
      } else {
        toast.error(r.error ?? 'No se pudo subir')
      }
    } finally {
      setUploading(false)
    }
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!form.organization_id) {
      toast.error('Elegí una barbería')
      return
    }
    if (form.title.trim().length < 3) {
      toast.error('El título debe tener al menos 3 caracteres')
      return
    }

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ''))

    startTransition(async () => {
      const r =
        mode === 'create'
          ? await createBenefit(fd)
          : await updateBenefit(initial!.id!, fd)

      if (r.success) {
        toast.success(
          mode === 'create'
            ? 'Beneficio enviado a revisión'
            : 'Beneficio actualizado. Se re-envía a revisión si cambiaste algo sensible.'
        )
        router.push('/partners/dashboard')
      } else {
        toast.error(r.error ?? 'Error')
      }
    })
  }

  const selectedOrg = orgs.find((o) => o.id === form.organization_id)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={mode === 'create' ? '/partners/dashboard' : `/partners/dashboard/benefits/${initial?.id}`}>
          <ArrowLeft className="size-4 mr-2" />
          Volver
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === 'create' ? 'Nuevo beneficio' : 'Editar beneficio'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === 'create'
            ? 'La barbería lo revisará antes de publicarlo en la app de sus clientes.'
            : 'Si cambiás el título, descripción, imagen, descuento o términos vuelve a revisión automáticamente.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="grid lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          {/* Org selector */}
          {mode === 'create' && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="size-4" /> Barbería *
                </Label>
                <Select
                  value={form.organization_id}
                  onValueChange={(v) => setForm({ ...form, organization_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí una barbería" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-5">
                            {o.logo_url && <AvatarImage src={o.logo_url} alt={o.name} />}
                            <AvatarFallback className="text-[10px]">
                              {o.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          {o.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Este beneficio se mostrará solo a los clientes de la barbería elegida.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Info principal */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <h2 className="font-semibold">Información del beneficio</h2>

              <div className="space-y-2">
                <Label htmlFor="title">Título *</Label>
                <Input
                  id="title"
                  placeholder="Ej: 50% off en hamburguesa doble"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  maxLength={120}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="discount_text" className="flex items-center gap-1.5">
                  <Tag className="size-3.5" /> Chip de descuento
                </Label>
                <Input
                  id="discount_text"
                  placeholder="Ej: 50% OFF, 2x1, $1500 gratis"
                  value={form.discount_text}
                  onChange={(e) => setForm({ ...form, discount_text: e.target.value })}
                  maxLength={40}
                />
                <p className="text-xs text-muted-foreground">
                  Aparece destacado sobre la imagen en la app.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  placeholder="Describí brevemente el beneficio, en qué consiste y quién puede usarlo."
                  rows={4}
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="terms" className="flex items-center gap-1.5">
                  <FileText className="size-3.5" /> Términos y condiciones
                </Label>
                <Textarea
                  id="terms"
                  placeholder="Ej: No acumulable con otras promos. Un uso por cliente. Válido de lun a vie."
                  rows={3}
                  maxLength={2000}
                  value={form.terms}
                  onChange={(e) => setForm({ ...form, terms: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Validez */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <h2 className="font-semibold flex items-center gap-1.5">
                <Calendar className="size-4" /> Validez
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="valid_from">Desde</Label>
                  <Input
                    id="valid_from"
                    type="date"
                    value={form.valid_from}
                    onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="valid_until">Hasta</Label>
                  <Input
                    id="valid_until"
                    type="date"
                    value={form.valid_until}
                    onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Dejá en blanco para que no tenga fecha límite.
              </p>
            </CardContent>
          </Card>

          {/* Ubicación */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <h2 className="font-semibold flex items-center gap-1.5">
                <MapPin className="size-4" /> Ubicación
              </h2>
              <div className="space-y-2">
                <Label htmlFor="location_address">Dirección</Label>
                <Input
                  id="location_address"
                  placeholder="Av. Corrientes 1234, CABA"
                  value={form.location_address}
                  onChange={(e) => setForm({ ...form, location_address: e.target.value })}
                  maxLength={300}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location_map_url">Link al mapa (opcional)</Label>
                <Input
                  id="location_map_url"
                  type="url"
                  placeholder="https://maps.google.com/..."
                  value={form.location_map_url}
                  onChange={(e) => setForm({ ...form, location_map_url: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: imagen + preview + submit */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardContent className="p-4 space-y-3">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="size-4" /> Imagen del beneficio
              </Label>

              <div className="relative aspect-[16/10] rounded-lg overflow-hidden border bg-muted">
                {form.image_url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.image_url} alt="Preview" className="w-full h-full object-cover" />
                    {form.discount_text && (
                      <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-md">
                        {form.discount_text}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, image_url: '' })}
                      className="absolute top-2 right-2 size-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ImageIcon className="size-10 opacity-40" />
                    <p className="text-xs">Sin imagen todavía</p>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                  e.target.value = ''
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Subiendo...
                  </>
                ) : (
                  <>
                    <Upload className="size-4 mr-2" />
                    {form.image_url ? 'Cambiar imagen' : 'Subir imagen'}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                JPG, PNG o WebP. Máx 5 MB. Recomendamos 1200×750 px.
              </p>
            </CardContent>
          </Card>

          {selectedOrg && (
            <div className="rounded-lg bg-muted/50 border p-3 text-xs flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              <p className="text-muted-foreground">
                Será publicado solo a clientes de <strong>{selectedOrg.name}</strong> tras su aprobación.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" asChild disabled={isPending}>
              <Link href="/partners/dashboard">Cancelar</Link>
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending || uploading}>
              {isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              {mode === 'create' ? 'Enviar a revisión' : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
