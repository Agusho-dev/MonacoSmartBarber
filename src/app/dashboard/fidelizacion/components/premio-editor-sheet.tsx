'use client'

// Editor lateral de un premio del catálogo: todos los campos de reward_catalog
// que usa el programa, con subida de imagen y vista previa.

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, ImageIcon, Loader2, Scissors, Shirt, Sparkles, Trash2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { saveReward, uploadRewardImage } from '@/lib/actions/loyalty'
import { compressToWebP } from '@/lib/image-utils'
import type { LoyaltyReward, LoyaltyRewardInput, LoyaltyRewardKind, LoyaltyService, LoyaltySettings, LoyaltyTier, LoyaltyTierCode } from '@/lib/types/loyalty'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  reward: LoyaltyReward | null
  tiers: LoyaltyTier[]
  services: LoyaltyService[]
  settings: LoyaltySettings
  onSaved: (r: LoyaltyReward) => void
}

interface Form {
  name: string
  description: string
  kind: LoyaltyRewardKind
  points_cost: string
  discount_pct: string
  service_id: string
  stock: string
  validity_days: string
  allowed: Record<LoyaltyTierCode, boolean>
  allow_stacking: boolean
  valid_from: string
  valid_until: string
  is_active: boolean
  is_featured: boolean
  category: '' | 'cortes' | 'merch'
  image_url: string
  sort_order: string
}

const TODAS: Record<LoyaltyTierCode, boolean> = { bronce: true, plata: true, oro: true, platinum: true }

function aForm(r: LoyaltyReward | null): Form {
  if (!r) {
    return {
      name: '', description: '', kind: 'descuento', points_cost: '', discount_pct: '30', service_id: '', stock: '', validity_days: '',
      allowed: { ...TODAS }, allow_stacking: false, valid_from: '', valid_until: '', is_active: true, is_featured: false, category: '', image_url: '', sort_order: '0',
    }
  }
  const allowed = { ...TODAS }
  if (r.allowed_tiers) for (const k of Object.keys(allowed) as LoyaltyTierCode[]) allowed[k] = r.allowed_tiers.includes(k)
  return {
    name: r.name, description: r.description ?? '', kind: r.kind, points_cost: String(r.points_cost),
    discount_pct: r.discount_pct != null ? String(r.discount_pct) : '30', service_id: r.service_id ?? '',
    stock: r.stock != null ? String(r.stock) : '', validity_days: r.validity_days != null ? String(r.validity_days) : '',
    allowed, allow_stacking: r.allow_stacking, valid_from: aFechaInput(r.valid_from), valid_until: aFechaInput(r.valid_until),
    is_active: r.is_active, is_featured: r.is_featured, category: r.category ?? '', image_url: r.image_url ?? '', sort_order: String(r.sort_order),
  }
}

function aFechaInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Se muestra en la zona del navegador: es una fecha de vigencia, no una hora.
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function deFechaInput(v: string, finDeDia: boolean): string | null {
  if (!v) return null
  const d = new Date(`${v}T${finDeDia ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const KIND_ICON: Record<LoyaltyRewardKind, typeof Scissors> = { descuento: Scissors, merch: Shirt, especial: Sparkles }

// ─── Servicios homónimos entre sucursales ────────────────────────────────────
// `services` trae una fila POR SUCURSAL: «Corte» existe en cada local como un
// id distinto (y no hay servicios org-wide: el server rechaza branch_id NULL).
// El scope real de `service_id` es "el servicio homónimo en la sucursal del
// cobro" (RPC `redeem_coupon_for_visit` + su espejo en la tablet), así que acá
// se ofrece UNA opción por nombre normalizado y se guarda el id de cualquiera
// de las filas homónimas. Nombres distintos entre locales ("Corte + Barba" vs
// "Corte y Barba") NO se emparejan: unificar los nombres es dato del dueño, y
// por eso el grupo que no cubre todas las sucursales lleva una advertencia.

function normNombre(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

function listaY(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

interface GrupoServicio {
  key: string
  nombre: string
  label: string
  ids: string[]
  sucursales: string[]
}

function agruparServicios(services: LoyaltyService[]): { grupos: GrupoServicio[]; totalSucursales: number } {
  const porClave = new Map<string, GrupoServicio>()
  const sucursales = new Set<string>()
  for (const s of services) {
    if (s.branch_name) sucursales.add(s.branch_name)
    // Un servicio sin sucursal no puede anclar un premio (el server lo
    // rechaza): queda como opción individual, igual que antes.
    const key = s.branch_id ? `n:${normNombre(s.name)}` : `id:${s.id}`
    const g = porClave.get(key)
    if (g) {
      g.ids.push(s.id)
      if (s.branch_name && !g.sucursales.includes(s.branch_name)) g.sucursales.push(s.branch_name)
    } else {
      porClave.set(key, { key, nombre: s.name.trim(), label: '', ids: [s.id], sucursales: s.branch_name ? [s.branch_name] : [] })
    }
  }
  const grupos = Array.from(porClave.values())
  for (const g of grupos) {
    g.label = g.sucursales.length === 0
      ? g.nombre
      : sucursales.size > 1 && g.sucursales.length === sucursales.size
        ? `${g.nombre} · todas las sucursales`
        : `${g.nombre} · ${g.sucursales.join(', ')}`
  }
  return { grupos, totalSucursales: sucursales.size }
}

export function PremioEditorSheet({ open, onOpenChange, reward, tiers, services, settings, onSaved }: Props) {
  // key en el padre remonta el sheet por premio: acá el estado nace del prop.
  const [form, setForm] = useState<Form>(() => aForm(reward))
  const [guardando, startSave] = useTransition()
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))
  const Icon = KIND_ICON[form.kind]
  const todasLasCategorias = Object.values(form.allowed).every(Boolean)
  const ninguna = Object.values(form.allowed).every(v => !v)
  const pct = parseInt(form.discount_pct, 10) || 0
  const { grupos, totalSucursales } = agruparServicios(services)
  const grupoElegido = form.service_id ? grupos.find(g => g.ids.includes(form.service_id)) ?? null : null

  async function subir(file: File) {
    setSubiendo(true)
    try {
      // Misma regla que la campaña y el avatar del barbero: se achica en el
      // browser antes de mandarla. Una foto de iPhone pesa 3–10 MB; sin esto,
      // entre 5 y 8 MB el servidor la rechazaba con mensaje y por encima de
      // 8 MB Next cortaba la llamada antes de ejecutar la action (413) y la
      // promesa se rechazaba SIN ningún aviso.
      const { blob, contentType } = await compressToWebP(file, 1200, 0.85)
      if (blob.size > 5 * 1024 * 1024) {
        // Cubre el caso en que compressToWebP devuelva el original (un HEIC
        // que el browser no decodifica): evita el 413 y deja que el mensaje
        // del tipo lo dé el servidor cuando el formato no sirve.
        toast.error('La imagen pesa más de 5 MB. Probá con una más liviana.')
        return
      }
      const fd = new FormData()
      const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'webp'
      fd.append('file', new File([blob], `premio.${ext}`, { type: contentType }))
      const r = await uploadRewardImage(fd)
      if ('error' in r) { toast.error(r.error); return }
      set('image_url', r.url)
      toast.success('Imagen subida')
    } catch (e) {
      // El catch es lo que hace visible cualquier rechazo de Next (413 u
      // otro): sin él, `void subir(f)` se lo tragaba y la foto "no aparecía".
      console.error('[premio-editor] subir', e)
      toast.error('No pudimos subir la imagen: ' + (e instanceof Error ? e.message : 'probá con una más liviana'))
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function guardar() {
    if (ninguna) { toast.error('Elegí al menos una categoría habilitada.'); return }
    const input: LoyaltyRewardInput = {
      id: reward?.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      points_cost: parseInt(form.points_cost, 10) || 0,
      discount_pct: form.kind === 'descuento' ? (parseInt(form.discount_pct, 10) || 0) : null,
      service_id: form.kind === 'descuento' && form.service_id ? form.service_id : null,
      stock: form.stock === '' ? null : Math.max(0, parseInt(form.stock, 10) || 0),
      validity_days: form.validity_days === '' ? null : Math.max(1, parseInt(form.validity_days, 10) || 1),
      allowed_tiers: todasLasCategorias ? null : (Object.keys(form.allowed) as LoyaltyTierCode[]).filter(k => form.allowed[k]),
      allow_stacking: form.allow_stacking,
      valid_from: deFechaInput(form.valid_from, false),
      valid_until: deFechaInput(form.valid_until, true),
      is_active: form.is_active,
      is_featured: form.is_featured,
      category: form.category || null,
      image_url: form.image_url.trim() || null,
      sort_order: parseInt(form.sort_order, 10) || 0,
    }
    startSave(async () => {
      const r = await saveReward(input)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(reward ? 'Premio actualizado' : 'Premio creado')
      onSaved(r.data)
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {reward ? 'Editar premio' : 'Nuevo premio'}
          </SheetTitle>
          <SheetDescription>
            Los descuentos son porcentuales sobre el precio vigente del servicio. El merchandising administra stock y se retira en el local.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-6 py-5">
          {/* Vista previa + imagen */}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="space-y-2">
              <div
                className={cn('relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-white/10', !form.image_url && (form.kind === 'merch' ? 'bg-[linear-gradient(135deg,#1f2937,#4b5563)]' : form.kind === 'especial' ? 'bg-[linear-gradient(135deg,#312e81,#6d28d9)]' : 'bg-[linear-gradient(135deg,#27272a,#52525b)]'))}
              >
                {form.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.image_url} alt="" className="size-full object-cover" />
                ) : (
                  <Icon className="size-10 text-white/70" />
                )}
                {subiendo && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><Loader2 className="size-5 animate-spin" /></div>}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void subir(f) }} />
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" className="flex-1" disabled={subiendo} onClick={() => fileRef.current?.click()}>
                  <Upload className="size-3.5" /> Subir
                </Button>
                {form.image_url && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => set('image_url', '')} aria-label="Quitar imagen">
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground"><ImageIcon className="mr-1 inline size-3" />JPG, PNG o WEBP, hasta 5 MB. Sin foto se muestra una lámina de color.</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="rw-name" className="text-xs">Nombre</Label>
                <Input id="rw-name" value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="30 % OFF en tu corte" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rw-desc" className="text-xs">Descripción</Label>
                <Textarea id="rw-desc" rows={3} value={form.description} maxLength={400} onChange={e => set('description', e.target.value)} placeholder="Lo que ve el cliente en la app antes de canjear." className="text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={form.kind} onValueChange={v => set('kind', v as LoyaltyRewardKind)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="descuento">Descuento en un servicio</SelectItem>
                      <SelectItem value="merch">Merchandising (con stock)</SelectItem>
                      <SelectItem value="especial">Beneficio especial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rw-pts" className="text-xs">Puntos necesarios</Label>
                  <Input id="rw-pts" type="number" min={1} value={form.points_cost} onChange={e => set('points_cost', e.target.value)} className="tabular-nums" placeholder="300" />
                </div>
              </div>
            </div>
          </div>

          {/* Descuento */}
          {form.kind === 'descuento' && (
            <section className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="rw-pct" className="text-xs">Descuento (%)</Label>
                  <Input id="rw-pct" type="number" min={1} max={100} value={form.discount_pct} onChange={e => set('discount_pct', e.target.value)} className="tabular-nums" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Servicio al que aplica</Label>
                  <Select
                    value={form.service_id ? (grupoElegido?.key ?? '__perdido') : '__any'}
                    onValueChange={v => {
                      if (v === '__any') { set('service_id', ''); return }
                      const g = grupos.find(x => x.key === v)
                      if (!g) return
                      // Si el id guardado ya es de este grupo, se conserva.
                      set('service_id', g.ids.includes(form.service_id) ? form.service_id : g.ids[0])
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">Cualquier servicio</SelectItem>
                      {grupos.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
                      {form.service_id && !grupoElegido && <SelectItem value="__perdido">Un servicio que ya no está activo</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {grupoElegido && totalSucursales > 1 && grupoElegido.sucursales.length > 0 && grupoElegido.sucursales.length < totalSucursales && (
                <p className="text-[11px] leading-snug text-amber-400/90">
                  «{grupoElegido.nombre}» sólo existe en {listaY(grupoElegido.sucursales)}: en las otras sucursales el beneficio se rechaza al cobrar.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {[30, 50, 75, 100].map(p => (
                  <button key={p} type="button" onClick={() => set('discount_pct', String(p))} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', pct === p ? 'border-transparent bg-white text-black' : 'border-white/10 text-muted-foreground hover:text-foreground')}>
                    {p === 100 ? 'Gratis' : `${p} %`}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {pct >= 100 ? 'Con 100 % el servicio queda sin cargo: cuenta como visita pero no genera puntos.' : 'Se calcula sobre el precio vigente al momento de aplicarlo; nunca un monto fijo.'}
              </p>
            </section>
          )}

          {/* Stock, vigencia, categorías */}
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rw-stock" className="text-xs">Stock</Label>
              <Input id="rw-stock" type="number" min={0} value={form.stock} onChange={e => set('stock', e.target.value)} placeholder="Ilimitado" className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Vacío = ilimitado. En 0 figura AGOTADO.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rw-val" className="text-xs">Vigencia del beneficio (días)</Label>
              <Input id="rw-val" type="number" min={1} max={365} value={form.validity_days} onChange={e => set('validity_days', e.target.value)} placeholder={String(settings.reward_validity_days)} className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Vacío = {settings.reward_validity_days} días (el default del programa).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rw-order" className="text-xs">Orden en la app</Label>
              <Input id="rw-order" type="number" min={0} value={form.sort_order} onChange={e => set('sort_order', e.target.value)} className="tabular-nums" />
              <p className="text-[10px] text-muted-foreground">Menor = primero.</p>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Categorías habilitadas</Label>
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => set('allowed', { ...TODAS })}>Todas</button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiers.map(t => {
                const on = form.allowed[t.code]
                return (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => set('allowed', { ...form.allowed, [t.code]: !on })}
                    aria-pressed={on}
                    className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors', on ? 'border-transparent' : 'border-white/10 text-muted-foreground')}
                    style={on ? { backgroundImage: `linear-gradient(135deg, ${t.color_primary}, ${t.color_secondary})`, color: t.text_color } : undefined}
                  >
                    {t.name}
                    <span aria-hidden className={cn('flex size-4 items-center justify-center rounded-full border', on ? 'border-current' : 'border-white/20')}>
                      {on && <Check className="size-3" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">{todasLasCategorias ? 'Disponible para todas las categorías.' : ninguna ? 'Ninguna categoría puede canjearlo.' : `Sólo ${tiers.filter(t => form.allowed[t.code]).map(t => t.name).join(' y ')}.`}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rw-from" className="text-xs">Disponible desde</Label>
              <Input id="rw-from" type="date" value={form.valid_from} onChange={e => set('valid_from', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rw-until" className="text-xs">Hasta</Label>
              <Input id="rw-until" type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5">
              <span className="text-sm">Activo</span>
              <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5">
              <span className="text-sm">Destacado en la app</span>
              <Switch checked={form.is_featured} onCheckedChange={v => set('is_featured', v)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5 sm:col-span-2">
              <span className="text-sm">
                Acumulable con otros beneficios
                <span className="block text-[11px] text-muted-foreground">Por default un servicio admite un solo beneficio promocional.</span>
              </span>
              <Switch checked={form.allow_stacking} onCheckedChange={v => set('allow_stacking', v)} />
            </label>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Categoría en la app</Label>
              <Select value={form.category || '__auto'} onValueChange={v => set('category', v === '__auto' ? '' : (v as 'cortes' | 'merch'))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Automática (descuentos en Cortes, el resto en Merch)</SelectItem>
                  <SelectItem value="cortes">Cortes</SelectItem>
                  <SelectItem value="merch">Merch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !form.name.trim() || !(parseInt(form.points_cost, 10) > 0)}>
            {guardando && <Loader2 className="size-4 animate-spin" />}
            {reward ? 'Guardar cambios' : 'Crear premio'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
