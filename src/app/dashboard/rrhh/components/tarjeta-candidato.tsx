'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Camera, Video, FileText, ShieldAlert, CheckCheck } from 'lucide-react'
import type { Candidato } from '@/lib/types/rrhh'
import {
  AvatarCandidato, ChipCanal, ChipEstado, Estrellas, MosaicoTrabajos,
  haceCuanto, textoAlcance, type Muestra,
} from './piezas'

/**
 * La tarjeta muestra el trabajo antes que el texto: para un barbero el CV son
 * las fotos de sus cortes, no un PDF (de 206 candidatos hay 8 documentos vivos
 * contra 242 imágenes). Debajo va su primer mensaje, que es la carta de
 * presentación que efectivamente escribió.
 */
export const TarjetaCandidato = memo(function TarjetaCandidato({
  c, seleccionado, modoSeleccion, onAbrir, onToggleSeleccion, onVerMedios,
}: {
  c: Candidato
  seleccionado: boolean
  modoSeleccion: boolean
  onAbrir: (c: Candidato) => void
  onToggleSeleccion: (id: string) => void
  onVerMedios: (c: Candidato, m: Muestra) => void
}) {
  const muestras = (Array.isArray(c.muestras) ? c.muestras : []) as Muestra[]
  const totalMedios = c.n_fotos + c.n_videos
  const alcance = textoAlcance(c.alcance, c.canal)
  const atenuado = c.estado === 'descartado'

  return (
    <article
      role={modoSeleccion ? 'checkbox' : 'button'}
      aria-checked={modoSeleccion ? seleccionado : undefined}
      aria-label={`${c.nombre}${c.primer_mensaje ? ': ' + c.primer_mensaje.slice(0, 80) : ''}`}
      tabIndex={0}
      onClick={() => (modoSeleccion ? onToggleSeleccion(c.conversation_id) : onAbrir(c))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (modoSeleccion) onToggleSeleccion(c.conversation_id); else onAbrir(c)
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border bg-zinc-900/40 text-left transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
        seleccionado
          ? 'border-white/40 ring-2 ring-white/25'
          : 'border-white/[0.06] hover:border-white/[0.14]',
        atenuado && !seleccionado && 'opacity-55 hover:opacity-90',
      )}
    >
      {modoSeleccion && (
        <span
          className={cn(
            'absolute left-3 top-3 z-10 flex size-6 items-center justify-center rounded-md border-2 backdrop-blur transition-colors',
            seleccionado ? 'border-white bg-white text-zinc-950' : 'border-white/70 bg-black/40',
          )}
          aria-hidden
        >
          {seleccionado && <CheckCheck className="size-4" />}
        </span>
      )}

      <MosaicoTrabajos
        muestras={muestras}
        total={totalMedios}
        nombre={c.nombre}
        mediaRota={c.n_media_rota}
        // En modo selección el mosaico deja de capturar el toque: ocupa el 60 %
        // del alto de la tarjeta y en una tablet es donde cae el dedo.
        onAbrir={modoSeleccion ? undefined : (m) => onVerMedios(c, m)}
      />

      {/* Canal y estado flotan sobre el mosaico: el fondo es una foto, así que van con velo. */}
      <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
        <ChipCanal canal={c.canal} className="bg-black/70 backdrop-blur" />
        {c.estado !== 'nuevo' && <ChipEstado estado={c.estado} className="bg-black/70 backdrop-blur" />}
      </div>

      <div className="space-y-2.5 p-4">
        <div className="flex items-start gap-2.5">
          <AvatarCandidato nombre={c.nombre} url={c.avatar_url} size={10} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{c.nombre}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {c.handle ? `@${c.handle.replace(/^@/, '')} · ` : ''}
              {haceCuanto(c.ultimo_mensaje_at)}
            </p>
          </div>
          {c.puntaje != null && <Estrellas valor={c.puntaje} size={3.5} readonly />}
        </div>

        {c.primer_mensaje ? (
          <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {c.primer_mensaje}
          </p>
        ) : (
          <p className="text-[12.5px] italic leading-relaxed text-muted-foreground/60">
            Mandó material sin escribir nada.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {c.n_fotos > 0 && <span className="inline-flex items-center gap-1"><Camera className="size-3" />{c.n_fotos}</span>}
          {c.n_videos > 0 && <span className="inline-flex items-center gap-1"><Video className="size-3" />{c.n_videos}</span>}
          {c.n_docs > 0 && <span className="inline-flex items-center gap-1"><FileText className="size-3" />{c.n_docs} CV</span>}
          {totalMedios === 0 && c.n_docs === 0 && <span className="opacity-60">Sin material</span>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-2.5">
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', alcance.tono)}>
            {alcance.label}
          </span>
          {c.es_staff && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300"
              title="El teléfono coincide con alguien de tu equipo. La IA lo etiquetó por error."
            >
              <ShieldAlert className="size-3" /> Es del equipo
            </span>
          )}
        </div>
      </div>
    </article>
  )
})
