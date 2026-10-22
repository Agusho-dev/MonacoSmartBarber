'use client'

// Un mensaje del hilo. La respuesta de Tex se arma siempre en el mismo orden
// (especificación B, "Anatomía de una respuesta"): "Tex · 14:32" → tarjeta de
// trabajo → texto → bloques de las herramientas → avisos → acciones. Sin avatar
// por mensaje: la única cara viva es la del composer.
//
// Los mensajes terminados van con `memo`: durante el stream sólo cambia el
// último (useChat reemplaza ese objeto y deja los demás con la misma identidad),
// así que el resto no vuelve a parsear su markdown en cada chunk.

import { memo, useState, type ReactNode } from 'react'
import { Check, CircleStop, Copy, History, RotateCcw, Share2, SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import type { TexCodigoAviso, TexUIMessage } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TexPensando } from '@/components/tex/tex-pensando'
import { TexPose } from '@/components/tex/tex-pose'
import { TexBloques, type ContenidoLienzo } from '@/components/tex/bloques'
import { TexMarkdown } from './tex-markdown'
import { TexTarjetaTrabajo } from './tex-tarjeta-trabajo'
import {
  hayTextoDespuesDeHerramientas,
  horaCorta,
  pasosDeMensaje,
  textoDeAviso,
  textoDeMensaje,
  textoParaCompartir,
  tienePartesVisibles,
} from './logica'

const ENTRADA =
  'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-[180ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]'

// ─────────────────────────────────────────────────────────────────────────────
// Pregunta de la persona
// ─────────────────────────────────────────────────────────────────────────────

export const TexMensajeUsuario = memo(function TexMensajeUsuario({
  mensaje,
  animar,
}: {
  mensaje: TexUIMessage
  animar: boolean
}) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-[1.6] text-secondary-foreground [overflow-wrap:anywhere]',
          animar && ENTRADA,
        )}
      >
        {textoDeMensaje(mensaje)}
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Respuesta de Tex
// ─────────────────────────────────────────────────────────────────────────────

interface TexMensajeTexProps {
  mensaje: TexUIMessage
  compacto: boolean
  /** Es la respuesta que está llegando ahora. */
  enCurso: boolean
  /** Última respuesta del hilo y el chat está libre: se puede volver a generar. */
  puedeRegenerar: boolean
  /** La persona apretó Detener en este mensaje. */
  interrumpido: boolean
  orgNombre: string
  /** "Está tardando más de lo normal." + [Detener] (sólo en el mensaje en curso). */
  aviso?: ReactNode
  onRegenerar?: () => void
  onAbrirLienzo?: (contenido: ContenidoLienzo) => void
  /** Respuestas rápidas de los avisos ("Seguí", "Resumila"); sólo en el último. */
  onEnviar?: (texto: string) => void
}

export const TexMensajeTex = memo(function TexMensajeTex({
  mensaje,
  compacto,
  enCurso,
  puedeRegenerar,
  interrumpido,
  orgNombre,
  aviso,
  onRegenerar,
  onAbrirLienzo,
  onEnviar,
}: TexMensajeTexProps) {
  const pasos = pasosDeMensaje(mensaje)
  const texto = textoDeMensaje(mensaje)
  const avisos = mensaje.parts.filter((p) => p.type === 'data-aviso')
  const visible = tienePartesVisibles(mensaje)
  const creadoEn = mensaje.metadata?.creadoEn
  const avisoInterrumpidoServidor = avisos.some((a) => a.data.codigo === 'interrumpido')
  // Detenida antes de la primera letra: no hay nada que copiar ni la barra de
  // acciones; se ofrece preguntar de nuevo (Volver a generar: la misma pregunta,
  // con su id, y el servidor reemplaza el turno cortado).
  const volverAPreguntar = !enCurso && !texto && pasos.length === 0 && puedeRegenerar ? onRegenerar : undefined

  return (
    <article className="group/msg min-w-0" aria-label="Respuesta de Tex">
      <p className="mb-2 text-xs text-muted-foreground">
        Tex{typeof creadoEn === 'number' && Number.isFinite(creadoEn) ? ` · ${horaCorta(creadoEn)}` : ''}
      </p>

      {!visible && enCurso && (
        <div className="space-y-2">
          <TexPensando />
          {aviso}
        </div>
      )}

      {pasos.length > 0 && (
        <TexTarjetaTrabajo
          pasos={pasos}
          enCurso={enCurso}
          textoEmpezo={hayTextoDespuesDeHerramientas(mensaje)}
          compacto={compacto}
          aviso={enCurso && !texto ? aviso : null}
        />
      )}

      {texto && <TexMarkdown texto={texto} className={pasos.length > 0 ? 'mt-3' : undefined} />}

      {pasos.some((p) => p.salida) && (
        <div className="mt-4 space-y-4">
          {pasos.map((p) =>
            p.salida ? (
              <TexBloques key={p.id} salida={p.salida} orgNombre={orgNombre} onAbrirLienzo={onAbrirLienzo} compacto={compacto} />
            ) : null,
          )}
        </div>
      )}

      {avisos.map((a, i) => (
        <TexAvisoTurno
          key={a.id ?? `aviso-${i}`}
          codigo={a.data.codigo}
          texto={a.data.texto}
          onEnviar={!enCurso ? onEnviar : undefined}
          onVolverAPreguntar={a.data.codigo === 'interrumpido' ? volverAPreguntar : undefined}
        />
      ))}
      {interrumpido && !avisoInterrumpidoServidor && (
        <TexAvisoTurno codigo="interrumpido" texto="" onVolverAPreguntar={volverAPreguntar} />
      )}

      {!enCurso && (texto || pasos.length > 0) && (
        <AccionesMensaje mensaje={mensaje} onRegenerar={puedeRegenerar ? onRegenerar : undefined} />
      )}
    </article>
  )
})

/** La respuesta que todavía no llegó (enviado, sin el primer chunk). */
export function TexMensajePendiente({ aviso }: { aviso?: ReactNode }) {
  return (
    <div className={cn('min-w-0 space-y-2', ENTRADA)} aria-label="Tex está pensando">
      <p className="text-xs text-muted-foreground">Tex</p>
      <TexPensando />
      {aviso}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Avisos del turno (data-aviso)
// ─────────────────────────────────────────────────────────────────────────────

export function TexAvisoTurno({
  codigo,
  texto,
  onEnviar,
  onVolverAPreguntar,
}: {
  codigo: TexCodigoAviso
  texto: string
  onEnviar?: (texto: string) => void
  /** Detener antes de la primera letra: la misma pregunta otra vez (con su id: el servidor no la duplica). */
  onVolverAPreguntar?: () => void
}) {
  const frase = textoDeAviso(codigo, texto)
  // Detener lo decidió la persona: no es un problema, va sin escena.
  if (codigo === 'interrumpido') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <CircleStop className="size-3.5 shrink-0" aria-hidden />
          {frase}
        </p>
        {onVolverAPreguntar && (
          <button
            type="button"
            onClick={onVolverAPreguntar}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-medium text-[color:var(--tex-texto)] transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Volver a preguntar
          </button>
        )}
      </div>
    )
  }
  const neutro = codigo === 'rechazo'
  return (
    <div
      role="status"
      className={cn(
        'mt-4 flex items-start gap-3 rounded-[14px] border p-3',
        neutro ? 'border-white/10 bg-white/[0.03]' : 'border-amber-500/30 bg-amber-500/[0.07]',
      )}
    >
      <TexPose pose="ayuda" alto={56} entrada="suave" />
      <div className="min-w-0 flex-1 pt-1">
        <p className={cn('text-sm leading-relaxed', neutro ? 'text-foreground/90' : 'text-amber-100')}>{frase}</p>
        {codigo === 'limite_respuesta' && onEnviar && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-9" onClick={() => onEnviar('Seguí')}>
              Seguí
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => onEnviar('Resumila')}>
              Resumila
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * La conversación ya es más larga de lo que Tex lee entero: el servidor le
 * manda a Claude sólo los últimos turnos (`historialRecortado` en la metadata
 * de la respuesta). Sin este aviso, "¿y la sucursal que te dije al principio?"
 * se contestaba sin ese contexto y nadie se enteraba.
 */
export function TexAvisoHistorialRecortado({ onNueva }: { onNueva?: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] leading-snug text-muted-foreground"
    >
      <p className="flex min-w-0 flex-1 basis-56 items-start gap-2">
        <History className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>Tex ya no recuerda el principio de esta conversación: es larga y lee sólo los últimos mensajes.</span>
      </p>
      {onNueva && (
        <button
          type="button"
          onClick={onNueva}
          className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-[color:var(--tex-texto)] transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
        >
          <SquarePen className="size-3.5" aria-hidden />
          Empezar una nueva
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Acciones por mensaje
// ─────────────────────────────────────────────────────────────────────────────

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

function AccionesMensaje({ mensaje, onRegenerar }: { mensaje: TexUIMessage; onRegenerar?: () => void }) {
  const [copiado, setCopiado] = useState(false)

  async function alCopiar() {
    const texto = textoParaCompartir(mensaje)
    if (!texto) return
    if (await copiar(texto)) {
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1600)
      toast.success('Copiado para WhatsApp.')
    } else {
      toast.error('No pude copiar. Probá de nuevo.')
    }
  }

  async function alCompartir() {
    const texto = textoParaCompartir(mensaje)
    if (!texto) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: texto })
        return
      } catch (e) {
        // Cerrar la hoja de compartir no es un error.
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    if (await copiar(texto)) toast.success('Copiado. Pegalo donde quieras.')
    else toast.error('No pude compartir. Probá de nuevo.')
  }

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-0.5 transition-opacity duration-150',
        // Con mouse aparecen al pasar por el mensaje; en táctil quedan visibles al 60 %.
        '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 [@media(hover:hover)]:focus-within:opacity-100',
        '[@media(hover:none)]:opacity-60',
      )}
    >
      <BotonAccion etiqueta={copiado ? 'Copiado' : 'Copiar para WhatsApp'} onClick={alCopiar}>
        {copiado ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
      </BotonAccion>
      {onRegenerar && (
        <BotonAccion etiqueta="Volver a generar" onClick={onRegenerar}>
          <RotateCcw className="size-4" />
        </BotonAccion>
      )}
      <BotonAccion etiqueta="Compartir" onClick={alCompartir}>
        <Share2 className="size-4" />
      </BotonAccion>
    </div>
  )
}

function BotonAccion({ etiqueta, onClick, children }: { etiqueta: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/50 [@media(pointer:coarse)]:size-10"
    >
      {children}
    </button>
  )
}
