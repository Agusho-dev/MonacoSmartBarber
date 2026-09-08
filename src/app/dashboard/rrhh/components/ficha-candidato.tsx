'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Loader2, MessageSquare, Instagram, Phone, Save, ExternalLink, Send,
  ImageOff, FileText, Mic, UserPlus, Sparkles, AlertTriangle,
} from 'lucide-react'
import { getMensajesCandidato, guardarCandidato, contactarCandidato } from '@/lib/actions/rrhh'
import type { Candidato, EstadoCandidato, MensajeCandidato, PlantillaRrhh } from '@/lib/types/rrhh'
import { ESTADOS_CANDIDATO } from '@/lib/types/rrhh'
import {
  AvatarCandidato, ChipCanal, Estrellas, VisorMedios, IconoWhatsApp,
  haceCuanto, fechaHora, fechaLarga, textoAlcance, TONO_ESTADO, type Muestra,
} from './piezas'

export function FichaCandidato({
  candidato, plantillas, canManage, onCerrar, onCambio,
}: {
  candidato: Candidato | null
  plantillas: PlantillaRrhh[]
  canManage: boolean
  onCerrar: () => void
  onCambio: () => void
}) {
  const [mensajes, setMensajes] = useState<MensajeCandidato[]>([])
  const [cargando, setCargando] = useState(false)
  const [errorMensajes, setErrorMensajes] = useState<string | null>(null)
  const [visor, setVisor] = useState<number | null>(null)
  const [guardando, empezarGuardado] = useTransition()
  const [enviando, setEnviando] = useState(false)

  // Borradores locales: el estado y las estrellas guardan al toque, el resto con botón.
  const [notas, setNotas] = useState('')
  const [telefono, setTelefono] = useState('')
  const [nombre, setNombre] = useState('')
  const [sucio, setSucio] = useState(false)
  const [textoLibre, setTextoLibre] = useState('')

  useEffect(() => {
    if (!candidato) return
    setNotas(candidato.notas ?? '')
    setTelefono(candidato.canal === 'instagram' ? (candidato.telefono ?? '') : '')
    setNombre('')
    setSucio(false)
    setTextoLibre('')
    setVisor(null)
    setCargando(true)
    setErrorMensajes(null)
    getMensajesCandidato(candidato.conversation_id).then(r => {
      setMensajes(r.data)
      setErrorMensajes(r.error)
      setCargando(false)
    })
  }, [candidato])

  if (!candidato) return null

  const c = candidato
  const alcance = textoAlcance(c.alcance, c.canal)

  const medios: Muestra[] = mensajes
    .filter(m =>
      m.direction === 'inbound' && m.media_url &&
      (m.content_type === 'image' || m.content_type === 'video') &&
      !m.media_vencida &&
      !m.media_url.startsWith('https://www.instagram.com/') &&
      !m.media_url.startsWith('https://instagram.com/'))
    .map(m => ({ url: m.media_url!, tipo: m.content_type }))

  const documentos = mensajes.filter(m => m.direction === 'inbound' && m.content_type === 'document')
  const audios = mensajes.filter(m => m.direction === 'inbound' && m.content_type === 'audio' && m.media_url && !m.media_vencida)
  const vencidos = mensajes.filter(m => m.media_vencida).length

  async function aplicar(patch: Parameters<typeof guardarCandidato>[1], mensajeOk?: string) {
    if (!canManage) return
    const res = await guardarCandidato(c.conversation_id, patch)
    if (res?.error) { toast.error(res.error); return false }
    if (mensajeOk) toast.success(mensajeOk)
    onCambio()
    return true
  }

  function cambiarEstado(estado: EstadoCandidato) {
    empezarGuardado(async () => { await aplicar({ estado }) })
  }

  function guardarDetalle() {
    empezarGuardado(async () => {
      const ok = await aplicar(
        {
          notas,
          ...(c.canal === 'instagram' ? { telefonoManual: telefono.trim() || null } : {}),
          ...(nombre.trim() ? { nombreOverride: nombre.trim() } : {}),
        },
        'Guardado',
      )
      if (ok) setSucio(false)
    })
  }

  async function mandar(templateName?: string) {
    if (!canManage) return
    setEnviando(true)
    try {
      const res = await contactarCandidato(c.conversation_id, templateName ? { templateName } : { texto: textoLibre })
      if (res?.error) { toast.error(res.error); return }
      toast.success('Mensaje enviado')
      setTextoLibre('')
      onCambio()
      const r = await getMensajesCandidato(c.conversation_id)
      setMensajes(r.data)
    } finally {
      setEnviando(false)
    }
  }

  const aprobadas = plantillas.filter(p => p.status === 'approved' && p.variables === 0)
  const linkInstagram = c.handle
    ? `https://www.instagram.com/${c.handle.replace(/^@/, '')}/`
    : 'https://www.instagram.com/direct/inbox/'

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onCerrar()}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:!max-w-2xl">
          <SheetHeader className="border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-start gap-3">
              <AvatarCandidato nombre={c.nombre} url={c.avatar_url} size={12} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">{c.nombre}</SheetTitle>
                <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <ChipCanal canal={c.canal} />
                  <span>Escribió por primera vez {haceCuanto(c.primer_contacto_at ?? c.ultimo_mensaje_at)}</span>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-6 px-5 py-5">
            {/* ── Alcance: lo primero, porque decide qué se puede hacer ─────── */}
            <div className={cn('rounded-xl border p-3', alcance.tono.replace(/text-\S+/, ''))}>
              <div className="flex items-start gap-2.5">
                {c.alcance === 'no'
                  ? <Instagram className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  : c.alcance === 'instagram'
                    ? <Instagram className="mt-0.5 size-4 shrink-0 text-pink-400" />
                    : <IconoWhatsApp className="mt-0.5 size-4 shrink-0 text-emerald-400" />}
                <div className="min-w-0 space-y-1">
                  <p className={cn('text-sm font-semibold', alcance.tono.match(/text-\S+/)?.[0])}>{alcance.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{alcance.detalle}</p>
                  {c.telefono && (
                    <p className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                      <Phone className="mr-1 inline size-3" />+{c.telefono.replace(/\D/g, '')}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {c.es_staff && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <div className="text-xs leading-relaxed">
                  <p className="font-semibold text-amber-200">Este número es de alguien de tu equipo</p>
                  <p className="text-amber-200/70">
                    Lo etiquetó la IA por error. Queda excluido de las difusiones automáticamente; podés descartarlo para que no aparezca más.
                  </p>
                </div>
              </div>
            )}

            {/* ── Estado del proceso ─────────────────────────────────────────── */}
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estado</p>
              <div className="flex flex-wrap gap-1.5">
                {ESTADOS_CANDIDATO.map(e => (
                  <button
                    key={e.id}
                    type="button"
                    disabled={!canManage || guardando}
                    title={e.descripcion}
                    onClick={() => cambiarEstado(e.id)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                      c.estado === e.id
                        ? TONO_ESTADO[e.id]
                        : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground',
                    )}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs text-muted-foreground">Puntaje</span>
                <Estrellas
                  valor={c.puntaje}
                  readonly={!canManage}
                  onChange={(v) => empezarGuardado(async () => { await aplicar({ puntaje: v }) })}
                />
                {c.contactado_at && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Contactado el {fechaLarga(c.contactado_at)}
                  </span>
                )}
              </div>
            </section>

            {/* ── Trabajos ───────────────────────────────────────────────────── */}
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sus trabajos
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {medios.length > 0 ? `${medios.length} ${medios.length === 1 ? 'archivo' : 'archivos'}` : ''}
                </span>
              </div>

              {cargando ? (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
                </div>
              ) : medios.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {medios.map((m, i) => (
                    <button
                      key={m.url + i}
                      type="button"
                      onClick={() => setVisor(i)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-white/[0.06]"
                    >
                      {m.tipo === 'video' ? (
                        <video src={m.url} muted playsInline preload="metadata" className="size-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-muted-foreground">
                  No mandó fotos ni videos.
                </div>
              )}

              {vencidos > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/80">
                  <ImageOff className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <span>
                    {vencidos} {vencidos === 1 ? 'archivo de Instagram venció' : 'archivos de Instagram vencieron'}.
                    Instagram los servía desde un link propio que caduca a los pocos días y su API no permite volver a pedirlos.
                    Lo que manden de ahora en más se guarda y no se pierde.
                  </span>
                </div>
              )}

              {(documentos.length > 0 || audios.length > 0) && (
                <div className="space-y-1.5 pt-1">
                  {documentos.map(d => (
                    d.media_url ? (
                      <a
                        key={d.id}
                        href={d.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs transition-colors hover:border-white/20"
                      >
                        <FileText className="size-3.5 shrink-0 text-sky-400" />
                        <span className="truncate">{d.content?.trim() || 'Documento adjunto'}</span>
                        <ExternalLink className="ml-auto size-3 shrink-0 opacity-50" />
                      </a>
                    ) : (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-muted-foreground">
                        <FileText className="size-3.5 shrink-0 opacity-40" />
                        <span className="truncate">Mandó un documento que no se pudo guardar</span>
                      </div>
                    )
                  ))}
                  {audios.map(a => (
                    <div key={a.id} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                      <Mic className="size-3.5 shrink-0 text-violet-400" />
                      <audio src={a.media_url!} controls className="h-8 w-full" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Lo que escribió ────────────────────────────────────────────── */}
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversación</p>
              {errorMensajes && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/[0.07] p-2.5 text-xs text-red-200">
                  No pudimos leer la conversación: {errorMensajes}
                </p>
              )}
              {cargando ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3">
                  {mensajes.filter(m => m.content?.trim()).length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">Sin mensajes de texto.</p>
                  )}
                  {mensajes.filter(m => m.content?.trim()).map(m => (
                    <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed',
                        m.direction === 'outbound'
                          ? 'bg-emerald-900/40 text-emerald-50'
                          : 'bg-white/[0.05]',
                        m.status === 'failed' && 'border border-red-500/40',
                      )}>
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p className="mt-1 text-[10px] opacity-50">
                          {fechaHora(m.created_at)}{m.status === 'failed' ? ' · no se envió' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Escribirle ─────────────────────────────────────────────────── */}
            {canManage && (
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Escribirle</p>

                {c.alcance === 'whatsapp' && (
                  aprobadas.length > 0 ? (
                    <div className="space-y-1.5">
                      {aprobadas.map(p => (
                        <button
                          key={p.name}
                          type="button"
                          disabled={enviando}
                          onClick={() => mandar(p.name)}
                          className="flex w-full items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.05] disabled:opacity-50"
                        >
                          <Send className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium">{p.name}</span>
                            <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">{p.cuerpo}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-white/10 p-3 text-xs leading-relaxed text-muted-foreground">
                      Todavía no tenés ninguna plantilla de WhatsApp aprobada para candidatos.
                      Creá una desde <span className="font-medium text-foreground">Mandar difusión</span> y Meta la aprueba en minutos.
                    </p>
                  )
                )}

                {c.alcance === 'instagram' && (
                  <div className="space-y-2">
                    <Textarea
                      value={textoLibre}
                      onChange={e => setTextoLibre(e.target.value)}
                      rows={3}
                      placeholder="Escribile por Instagram…"
                      className="text-sm"
                    />
                    <Button size="sm" disabled={enviando || !textoLibre.trim()} onClick={() => mandar()}>
                      {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      Mandar por Instagram
                    </Button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      La ventana de Instagram dura 24 h desde su último mensaje. Si se cierra mientras escribís, Meta rechaza el envío.
                    </p>
                  </div>
                )}

                {c.alcance === 'no' && (
                  <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Meta no permite mandar plantillas por Instagram y su ventana de 24 h ya se cerró. Dos salidas:
                    </p>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href={linkInstagram} target="_blank" rel="noopener noreferrer">
                        <Instagram className="size-4" /> Abrir su perfil en Instagram
                      </Link>
                    </Button>
                    <div className="space-y-1.5">
                      <Label className="text-xs">O cargale el teléfono y entra en la difusión de WhatsApp</Label>
                      <div className="flex gap-2">
                        <Input
                          value={telefono}
                          onChange={e => { setTelefono(e.target.value); setSucio(true) }}
                          placeholder="351 555 1234"
                          inputMode="tel"
                          className="text-sm"
                        />
                        <Button size="sm" disabled={guardando || !sucio} onClick={guardarDetalle}>
                          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Notas y datos ──────────────────────────────────────────────── */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notas</p>
              <Textarea
                value={notas}
                disabled={!canManage}
                onChange={e => { setNotas(e.target.value); setSucio(true) }}
                rows={3}
                placeholder="Qué te pareció, qué quedaron, cuándo viene…"
                className="text-sm"
              />
              {c.canal === 'whatsapp' && canManage && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Corregir el nombre</Label>
                  <Input
                    value={nombre}
                    onChange={e => { setNombre(e.target.value); setSucio(true) }}
                    placeholder={c.nombre}
                    className="text-sm"
                  />
                </div>
              )}
              {canManage && (
                <Button size="sm" variant="outline" disabled={!sucio || guardando} onClick={guardarDetalle}>
                  {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Guardar
                </Button>
              )}
            </section>

            {/* ── Acciones ───────────────────────────────────────────────────── */}
            <section className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {c.client_id && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/mensajeria?clientId=${c.client_id}`}>
                    <MessageSquare className="size-4" /> Ver en Mensajería
                  </Link>
                </Button>
              )}
              {c.canal === 'instagram' && (
                <Button asChild variant="outline" size="sm">
                  <Link href={linkInstagram} target="_blank" rel="noopener noreferrer">
                    <Instagram className="size-4" /> Instagram
                  </Link>
                </Button>
              )}
              {canManage && c.estado !== 'contratado' && (
                <Button asChild variant="outline" size="sm" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                  <Link href={`/dashboard/barberos?alta=1&nombre=${encodeURIComponent(c.nombre)}${c.telefono ? `&telefono=${encodeURIComponent(c.telefono)}` : ''}&candidato=${c.conversation_id}`}>
                    <UserPlus className="size-4" /> Contratar
                  </Link>
                </Button>
              )}
            </section>

            {c.es_cliente_real && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3" /> Además es cliente de la barbería.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {visor != null && medios.length > 0 && (
        <VisorMedios medios={medios} indice={visor} onCerrar={() => setVisor(null)} onMover={setVisor} />
      )}
    </>
  )
}
