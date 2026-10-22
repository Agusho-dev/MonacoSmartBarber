'use client'

// Un mensaje del hilo. La respuesta de Tex se arma siempre en el mismo orden
// (especificación B, "Anatomía de una respuesta"): "Tex · 14:32" → tarjeta de
// trabajo → texto → bloques de las herramientas VISIBLES → avisos → acciones.
// Sin avatar por mensaje: la única cara viva es la del composer.
//
// Respuesta y trabajo (oct/2026): el dueño veía cada consulta dibujando su
// tabla —SQL crudo, fechas ISO, "La base de conocimiento está vacía"— y no
// encontraba la respuesta. Ahora sólo `mostrar`, `graficar` y
// `generar_informe` dibujan en la respuesta; lo que traen las herramientas de
// datos (y lo que Tex dijo entre consulta y consulta) queda plegado en la
// tarjeta de trabajo, con "Ver datos" por paso (logica.ts: anatomiaDeRespuesta).
// Vale también para las conversaciones viejas al reabrirlas.
//
// Los mensajes terminados van con `memo`: durante el stream sólo cambia el
// último (useChat reemplaza ese objeto y deja los demás con la misma identidad),
// así que el resto no vuelve a parsear su markdown en cada chunk.

import { memo, useState, type ReactNode } from 'react'
import { Check, CircleStop, Copy, History, Loader2, RotateCcw, Share2, SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import { metaHerramienta, type TexCodigoAviso, type TexUIMessage } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TexPensando } from '@/components/tex/tex-pensando'
import { TexPose } from '@/components/tex/tex-pose'
import { TexBloques, type ContenidoLienzo } from '@/components/tex/bloques'
import { TexMarkdown } from './tex-markdown'
import { TexTarjetaTrabajo } from './tex-tarjeta-trabajo'
import { anatomiaDeRespuesta, horaCorta, textoDeAviso, textoDeMensaje, textoParaCompartir, tienePartesVisibles } from './logica'

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
  const { pasos, trabajo, texto, piezas } = anatomiaDeRespuesta(mensaje)
  const avisos = mensaje.parts.filter((p) => p.type === 'data-aviso')
  const visible = tienePartesVisibles(mensaje)
  const creadoEn = mensaje.metadata?.creadoEn
  const avisoInterrumpidoServidor = avisos.some((a) => a.data.codigo === 'interrumpido')
  // Detenida antes de la primera letra: no hay nada que copiar ni la barra de
  // acciones; se ofrece preguntar de nuevo (Volver a generar: la misma pregunta,
  // con su id, y el servidor reemplaza el turno cortado).
  const volverAPreguntar = !enCurso && !texto && pasos.length === 0 && puedeRegenerar ? onRegenerar : undefined

  const textoEmpezo = texto !== ''
  // Una consulta que falló no alarma si Tex igual respondió (se recuperó con
  // otra). Sí cuando la respuesta no llegó: sin texto ni bloques, o el turno
  // se cortó por los pasos o por un error. Detener lo decidió la persona.
  const respuestaLlego = textoEmpezo || piezas.some((p) => p.salida !== null)
  const turnoCortado = avisos.some((a) => a.data.codigo === 'pasos' || a.data.codigo === 'error')
  const alarma = !enCurso && !interrumpido && !avisoInterrumpidoServidor && (!respuestaLlego || turnoCortado)
  // Una herramienta visible que corre con la respuesta ya empezada (la tarjeta
  // está plegada) avisa en su lugar: "Preparando la respuesta…".
  const lugares = piezas.filter((p) => p.salida !== null || (enCurso && textoEmpezo))
  // La respuesta ya está a la vista (texto o bloques): desde acá el hilo puede
  // quedarse con su comienzo en pantalla en vez de seguir al final (tex-chat.tsx).
  const respuestaALaVista = textoEmpezo || lugares.some((p) => p.salida !== null)

  return (
    <article className="group/msg min-w-0" aria-label="Respuesta de Tex" data-tex-respuesta={respuestaALaVista ? '' : undefined}>
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
          trabajo={trabajo}
          enCurso={enCurso}
          textoEmpezo={textoEmpezo}
          alarma={alarma}
          compacto={compacto}
          aviso={enCurso && !texto ? aviso : null}
          orgNombre={orgNombre}
          onAbrirLienzo={onAbrirLienzo}
        />
      )}

      {texto && <TexMarkdown texto={texto} className={pasos.length > 0 ? 'mt-3' : undefined} />}

      {lugares.length > 0 && (
        <div className={cn('space-y-4', (texto || pasos.length > 0) && 'mt-4')}>
          {lugares.map((p) =>
            p.salida ? (
              <TexBloques key={p.id} salida={p.salida} orgNombre={orgNombre} onAbrirLienzo={onAbrirLienzo} compacto={compacto} />
            ) : (
              <PiezaPreparandose key={p.id} nombre={p.nombre} />
            ),
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

/**
 * El lugar de un bloque que se está armando ("Preparando la respuesta…",
 * "Armando el informe…"). Sin `role="status"`: la línea del encabezado ya lo
 * anuncia (aria-live) y se escucharía dos veces.
 */
function PiezaPreparandose({ nombre }: { nombre: string }) {
  return (
    <p className="flex min-h-8 items-center gap-2 text-[13px] text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-[color:var(--tex-texto)] motion-reduce:animate-none" aria-hidden />
      {metaHerramienta(nombre).haciendo}…
    </p>
  )
}

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
  // Lo que se copia es lo que se ve como respuesta. Un turno que no llegó a
  // responder (se cortó por los pasos) no tiene nada que copiar: queda
  // "Volver a generar" solo, en vez de dos botones que no hacen nada.
  const aCompartir = textoParaCompartir(mensaje)

  async function alCopiar() {
    const texto = aCompartir
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
    const texto = aCompartir
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

  // Un turno viejo sin nada que copiar (y que ya no es el último): sin barra vacía.
  if (!aCompartir && !onRegenerar) return null

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-0.5 transition-opacity duration-150',
        // Con mouse aparecen al pasar por el mensaje; en táctil quedan visibles al 60 %.
        '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 [@media(hover:hover)]:focus-within:opacity-100',
        '[@media(hover:none)]:opacity-60',
      )}
    >
      {aCompartir && (
        <BotonAccion etiqueta={copiado ? 'Copiado' : 'Copiar para WhatsApp'} onClick={alCopiar}>
          {copiado ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
        </BotonAccion>
      )}
      {onRegenerar && (
        <BotonAccion etiqueta="Volver a generar" onClick={onRegenerar}>
          <RotateCcw className="size-4" />
        </BotonAccion>
      )}
      {aCompartir && (
        <BotonAccion etiqueta="Compartir" onClick={alCompartir}>
          <Share2 className="size-4" />
        </BotonAccion>
      )}
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
