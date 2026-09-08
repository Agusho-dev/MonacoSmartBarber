'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Instagram, ImageOff, Scissors, X, Play, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AlcanceCandidato, EstadoCandidato } from '@/lib/types/rrhh'

// ── Íconos y color por canal ────────────────────────────────────────────────

export function IconoWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export function ChipCanal({ canal, className }: { canal: 'whatsapp' | 'instagram'; className?: string }) {
  return canal === 'whatsapp' ? (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300', className)}>
      <IconoWhatsApp className="size-2.5" /> WhatsApp
    </span>
  ) : (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 text-[10px] font-medium text-pink-300', className)}>
      <Instagram className="size-2.5" /> Instagram
    </span>
  )
}

// ── Estados del proceso ─────────────────────────────────────────────────────

export const TONO_ESTADO: Record<EstadoCandidato, string> = {
  nuevo:      'border-sky-500/35 bg-sky-500/10 text-sky-300',
  contactado: 'border-violet-500/35 bg-violet-500/10 text-violet-300',
  entrevista: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  prueba:     'border-teal-500/35 bg-teal-500/10 text-teal-300',
  contratado: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  descartado: 'border-white/10 bg-white/[0.04] text-muted-foreground',
}

export const LABEL_ESTADO: Record<EstadoCandidato, string> = {
  nuevo: 'Sin revisar',
  contactado: 'Contactado',
  entrevista: 'Entrevista',
  prueba: 'En prueba',
  contratado: 'Contratado',
  descartado: 'Descartado',
}

export function ChipEstado({ estado, className }: { estado: EstadoCandidato; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', TONO_ESTADO[estado], className)}>
      {LABEL_ESTADO[estado]}
    </span>
  )
}

// ── Alcance: la única forma honesta de decir "a este le podés escribir" ─────

export function textoAlcance(alcance: AlcanceCandidato, canal: 'whatsapp' | 'instagram'): {
  label: string
  detalle: string
  tono: string
} {
  if (alcance === 'whatsapp') {
    return {
      label: 'Se le puede escribir',
      detalle: canal === 'instagram'
        ? 'Tiene teléfono cargado, así que entra en la difusión de WhatsApp.'
        : 'Le llega la plantilla de WhatsApp aunque hayan pasado meses.',
      tono: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    }
  }
  if (alcance === 'instagram') {
    return {
      label: 'Ventana de Instagram abierta',
      detalle: 'Escribió hace menos de 24 h: se le puede mandar un mensaje de texto por Instagram.',
      tono: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
    }
  }
  return {
    label: 'Solo desde Instagram',
    detalle: 'Instagram no tiene plantillas y su ventana de 24 h está cerrada. Escribile desde la app o cargale el teléfono para sumarlo a la difusión.',
    tono: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  }
}

// ── Fechas en castellano, sin librería ──────────────────────────────────────

export function haceCuanto(iso: string | null): string {
  if (!iso) return 'sin fecha'
  const ms = Date.now() - new Date(iso).getTime()
  const dias = Math.floor(ms / 86400000)
  if (dias < 0) return 'recién'
  if (dias === 0) {
    const h = Math.floor(ms / 3600000)
    if (h < 1) return 'hace minutos'
    return `hace ${h} h`
  }
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  if (dias < 31) {
    const s = Math.floor(dias / 7)
    return s === 1 ? 'hace 1 semana' : `hace ${s} semanas`
  }
  const m = Math.floor(dias / 30)
  if (m < 12) return m === 1 ? 'hace 1 mes' : `hace ${m} meses`
  const a = Math.floor(dias / 365)
  return a === 1 ? 'hace 1 año' : `hace ${a} años`
}

export function fechaLarga(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

export function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

// ── Avatar ──────────────────────────────────────────────────────────────────

const COLORES = ['bg-emerald-700', 'bg-sky-700', 'bg-violet-700', 'bg-rose-700', 'bg-amber-700', 'bg-teal-700']

// Tailwind escanea el código fuente: una clase armada con template string
// (`size-${n}`) no existe en el CSS generado. Van explícitas.
const TAM_AVATAR = {
  8: 'size-8 text-[10px]',
  9: 'size-9 text-[11px]',
  10: 'size-10 text-xs',
  12: 'size-12 text-sm',
  14: 'size-14 text-base',
  16: 'size-16 text-lg',
} as const
export type TamAvatar = keyof typeof TAM_AVATAR

export function iniciales(nombre: string): string {
  const t = nombre.trim().replace(/^@/, '')
  if (/^\d+$/.test(t)) return '#'
  const partes = t.split(/\s+/).filter(Boolean)
  return (partes.map(p => p[0]).join('').slice(0, 2) || '?').toUpperCase()
}

export function AvatarCandidato({ nombre, url, size = 10 }: { nombre: string; url?: string | null; size?: TamAvatar }) {
  const [roto, setRoto] = useState(false)
  const clase = TAM_AVATAR[size] ?? TAM_AVATAR[10]
  if (url && !roto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        onError={() => setRoto(true)}
        className={cn(clase.split(' ')[0], 'shrink-0 rounded-full object-cover ring-1 ring-white/10')}
      />
    )
  }
  return (
    <div className={cn(clase, 'flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-1 ring-white/10',
      COLORES[(nombre.charCodeAt(0) || 0) % COLORES.length])}>
      {iniciales(nombre)}
    </div>
  )
}

// ── Mosaico de trabajos + visor ─────────────────────────────────────────────

export interface Muestra { url: string; tipo: string }

/**
 * El "CV" de un barbero son las fotos de sus cortes, así que la tarjeta las
 * muestra antes que cualquier texto. Sin fotos hay una lámina de color con
 * tijeras: la tarjeta está diseñada para verse bien vacía, porque la mayoría de
 * los candidatos de Instagram todavía tiene su material vencido.
 */
export function MosaicoTrabajos({
  muestras, total, nombre, mediaRota, onAbrir,
}: {
  muestras: Muestra[]
  total: number
  nombre: string
  mediaRota: number
  onAbrir?: (m: Muestra) => void
}) {
  const [rotas, setRotas] = useState<Set<number>>(new Set())
  const vivas = muestras.filter((_, i) => !rotas.has(i))

  if (vivas.length === 0) {
    return (
      <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#27272a,#3f3f46)]">
        <span className="text-3xl font-black tracking-tight text-white/15">{iniciales(nombre)}</span>
        <Scissors className="absolute size-8 text-white/25" />
        {mediaRota > 0 && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-amber-300 backdrop-blur">
            <ImageOff className="size-3" /> {mediaRota} {mediaRota === 1 ? 'archivo vencido' : 'archivos vencidos'}
          </span>
        )}
      </div>
    )
  }

  const cel = (m: Muestra, i: number, extra?: string) => (
    <button
      key={m.url + i}
      type="button"
      onClick={onAbrir ? (e) => { e.stopPropagation(); onAbrir(m) } : undefined}
      className={cn('group/cel relative overflow-hidden bg-zinc-800', extra)}
    >
      {m.tipo === 'video' ? (
        <>
          <video src={m.url} muted playsInline preload="metadata" className="size-full object-cover" onError={() => setRotas(s => new Set(s).add(i))} />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Play className="size-5 fill-white text-white drop-shadow" />
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.url}
          alt=""
          loading="lazy"
          onError={() => setRotas(s => new Set(s).add(i))}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      )}
    </button>
  )

  return (
    <div className="relative aspect-[16/10] overflow-hidden">
      {vivas.length === 1 && <div className="grid size-full">{cel(vivas[0], 0)}</div>}
      {vivas.length === 2 && <div className="grid size-full grid-cols-2 gap-px">{vivas.map((m, i) => cel(m, i))}</div>}
      {vivas.length === 3 && (
        <div className="grid size-full grid-cols-3 grid-rows-2 gap-px">
          {cel(vivas[0], 0, 'col-span-2 row-span-2')}
          {cel(vivas[1], 1, '')}
          {cel(vivas[2], 2, '')}
        </div>
      )}
      {vivas.length >= 4 && (
        <div className="grid size-full grid-cols-2 grid-rows-2 gap-px">{vivas.slice(0, 4).map((m, i) => cel(m, i))}</div>
      )}

      {total > vivas.length && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
          +{total - vivas.length}
        </span>
      )}
    </div>
  )
}

/** Visor a pantalla completa con flechas. Existe acá porque el del inbox es una función local de chat-view. */
export function VisorMedios({
  medios, indice, onCerrar, onMover,
}: {
  medios: Muestra[]
  indice: number
  onCerrar: () => void
  onMover: (i: number) => void
}) {
  // Se guarda QUÉ url falló en vez de un booleano: así no hace falta resetear
  // el estado por efecto cuando se pasa a la siguiente foto.
  const [urlRota, setUrlRota] = useState<string | null>(null)

  // Escape para cerrar y flechas para navegar: sin esto el visor tapaba toda la
  // pantalla y sólo se salía con el mouse.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
      if (e.key === 'ArrowLeft' && medios.length > 1) onMover((indice - 1 + medios.length) % medios.length)
      if (e.key === 'ArrowRight' && medios.length > 1) onMover((indice + 1) % medios.length)
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [indice, medios.length, onCerrar, onMover])

  const m = medios[indice]
  if (!m) return null
  const rota = urlRota === m.url
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 animate-fade-in"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Trabajos del candidato"
    >
      <button
        type="button"
        onClick={onCerrar}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        aria-label="Cerrar"
      >
        <X className="size-5" />
      </button>

      {medios.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMover((indice - 1 + medios.length) % medios.length) }}
            className="absolute left-3 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
            aria-label="Anterior"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMover((indice + 1) % medios.length) }}
            className="absolute right-3 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
            aria-label="Siguiente"
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}

      <div className="max-h-[88vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {rota ? (
          <p className="rounded-lg border border-white/10 bg-zinc-900 px-6 py-10 text-center text-sm text-muted-foreground">
            Este archivo ya no está disponible.
          </p>
        ) : m.tipo === 'video' ? (
          <video src={m.url} controls autoPlay onError={() => setUrlRota(m.url)} className="max-h-[88vh] max-w-[92vw] rounded-lg" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.url} alt="" onError={() => setUrlRota(m.url)} className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain" />
        )}
      </div>

      {medios.length > 1 && (
        <span className="absolute bottom-5 rounded-full bg-black/70 px-3 py-1 text-xs font-medium tabular-nums text-white">
          {indice + 1} / {medios.length}
        </span>
      )}
    </div>
  )
}

// ── Estrellas ───────────────────────────────────────────────────────────────

const TAM_ESTRELLA = { 3.5: 'size-3.5', 4: 'size-4', 5: 'size-5' } as const

export function Estrellas({
  valor, onChange, size = 4, readonly,
}: {
  valor: number | null
  onChange?: (v: number | null) => void
  size?: keyof typeof TAM_ESTRELLA
  readonly?: boolean
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          aria-label={`${n} de 5`}
          onClick={(e) => { e.stopPropagation(); onChange?.(valor === n ? null : n) }}
          className={cn('transition-colors', readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110')}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn(TAM_ESTRELLA[size] ?? 'size-4', (valor ?? 0) >= n ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-white/25')}
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  )
}
