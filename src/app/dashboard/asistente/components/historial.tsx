'use client'

// El historial de conversaciones: buscador, grupos (Fijadas · Hoy · Ayer · Esta
// semana · Antes), filas de 48 px con el título que pone Tex, y por fila:
// fijar, renombrar y borrar (con "Deshacer", que maneja la pantalla). Va en el
// riel de 264 px en la compu y en una hoja izquierda en el celular.
//
// La lista trae las conversaciones más recientes (hasta 200). El buscador
// filtra esa lista al instante y, desde 2 letras, también busca por título en
// el servidor (250 ms después de la última tecla): así se encuentra una
// conversación vieja que no está cargada. Las dos cosas se mezclan sin repetir.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Search, SquarePen, Trash2 } from 'lucide-react'
import type { TexConversacion } from '@/lib/tex/contrato'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  agruparConversaciones,
  filtrarConversaciones,
  HISTORIAL_VISIBLE,
  MIN_BUSQUEDA_SERVIDOR,
  mezclarBusqueda,
} from '@/components/tex/chat/logica'

/** Espera desde la última tecla antes de buscar en el servidor. */
const ESPERA_BUSQUEDA_MS = 250

interface Props {
  conversaciones: TexConversacion[]
  /** Borradas o con el "Deshacer" en pantalla: no se muestran (tampoco si las trae la búsqueda). */
  ocultas?: ReadonlySet<string>
  activaId: string
  cargandoId: string | null
  /** "Ahora" para agrupar por día (viene del servidor y se actualiza cada minuto). */
  ahora: number
  /** No se pudo leer el historial (al entrar o al actualizarlo). */
  error: boolean
  onElegir: (conversacion: TexConversacion) => void
  onNueva: () => void
  onRenombrar: (conversacion: TexConversacion, titulo: string) => void
  onFijar: (conversacion: TexConversacion, fijada: boolean) => void
  onBorrar: (conversacion: TexConversacion) => void
  onReintentar: () => void
  /** Busca por título en todas las conversaciones. Tira si no pudo leer. */
  onBuscar?: (consulta: string) => Promise<TexConversacion[]>
  pie?: ReactNode
}

type Remoto = { consulta: string; estado: 'listo' | 'error'; lista: TexConversacion[] }

const SIN_OCULTAS: ReadonlySet<string> = new Set()

export function TexHistorial({
  conversaciones,
  ocultas = SIN_OCULTAS,
  activaId,
  cargandoId,
  ahora,
  error,
  onElegir,
  onNueva,
  onRenombrar,
  onFijar,
  onBorrar,
  onReintentar,
  onBuscar,
  pie,
}: Props) {
  const [consulta, setConsulta] = useState('')
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [remoto, setRemoto] = useState<Remoto | null>(null)
  const [intento, setIntento] = useState(0)
  // La función de búsqueda del render actual, sin volver a programar la búsqueda cada vez que cambia.
  const buscarRef = useRef(onBuscar)
  useEffect(() => {
    buscarRef.current = onBuscar
  })

  const q = consulta.trim()
  const buscaEnServidor = q.length >= MIN_BUSQUEDA_SERVIDOR && Boolean(onBuscar)

  useEffect(() => {
    if (!buscaEnServidor) return
    let vigente = true
    const t = window.setTimeout(() => {
      const buscar = buscarRef.current
      if (!buscar) return
      buscar(q).then(
        (lista) => {
          if (vigente) setRemoto({ consulta: q, estado: 'listo', lista })
        },
        () => {
          if (vigente) setRemoto({ consulta: q, estado: 'error', lista: [] })
        },
      )
    }, ESPERA_BUSQUEDA_MS)
    return () => {
      vigente = false
      window.clearTimeout(t)
    }
  }, [q, buscaEnServidor, intento])

  const visibles = conversaciones.filter((c) => !ocultas.has(c.id))
  const remotoVigente = buscaEnServidor && remoto?.consulta === q ? remoto : null
  const buscando = buscaEnServidor && remotoVigente === null
  const errorBusqueda = remotoVigente?.estado === 'error'
  const lista = q ? mezclarBusqueda(filtrarConversaciones(visibles, q), remotoVigente?.lista ?? [], conversaciones, ocultas) : visibles
  const grupos = agruparConversaciones(lista, ahora)

  function reintentarBusqueda() {
    setRemoto(null)
    setIntento((n) => n + 1)
  }

  const avisoBusqueda = buscando ? (
    <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      Buscando en todas tus conversaciones…
    </p>
  ) : errorBusqueda ? (
    <div className="mx-1 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-2 text-xs text-amber-300" role="alert">
      <span>No pude buscar en las conversaciones anteriores.</span>
      <button
        type="button"
        onClick={reintentarBusqueda}
        className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 font-medium text-foreground/90 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
      >
        <RotateCcw className="size-3" aria-hidden />
        Reintentar
      </button>
    </div>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <Button variant="outline" className="h-10 w-full justify-start gap-2" onClick={onNueva}>
          <SquarePen className="size-4" aria-hidden />
          Nueva conversación
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar conversaciones"
            aria-label="Buscar conversaciones"
            className="h-10 w-full rounded-lg border bg-transparent pl-8 pr-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-[color:var(--tex)]/50 focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/30 lg:h-9 lg:text-sm"
          />
        </div>
      </div>

      <nav aria-label="Conversaciones" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {error && visibles.length === 0 && !buscaEnServidor ? (
          // Nunca "Todavía no hay conversaciones" (ni "No encontré…" con una letra en
          // el buscador, que filtra una lista que no se pudo leer) cuando en realidad
          // no se pudo leer. Desde 2 letras manda la búsqueda en el servidor.
          <div className="mx-1 mt-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3 text-sm" role="alert">
            <p className="text-foreground">No pude cargar el historial.</p>
            <Button size="sm" variant="outline" className="mt-2 h-9 gap-1.5" onClick={onReintentar}>
              <RotateCcw className="size-3.5" aria-hidden />
              Reintentar
            </Button>
          </div>
        ) : grupos.length === 0 ? (
          q ? (
            avisoBusqueda ?? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No encontré conversaciones con «{q}».</p>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Todavía no hay conversaciones.</p>
          )
        ) : (
          <>
            {error && (
              <div className="mx-1 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs text-amber-300" role="alert">
                <span>No pude actualizar el historial.</span>
                <button
                  type="button"
                  onClick={onReintentar}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 font-medium text-foreground/90 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Reintentar
                </button>
              </div>
            )}
            {grupos.map((g) => (
              <section key={g.grupo} className="mb-2" aria-label={g.grupo}>
                <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{g.grupo}</h3>
                <ul className="space-y-0.5">
                  {g.items.map((c) =>
                    renombrando === c.id ? (
                      <li key={c.id}>
                        <CampoRenombrar
                          inicial={c.titulo}
                          onGuardar={(titulo) => {
                            setRenombrando(null)
                            onRenombrar(c, titulo)
                          }}
                          onCancelar={() => setRenombrando(null)}
                        />
                      </li>
                    ) : (
                      <FilaConversacion
                        key={c.id}
                        conversacion={c}
                        activa={c.id === activaId}
                        cargando={c.id === cargandoId}
                        onElegir={onElegir}
                        onRenombrar={() => setRenombrando(c.id)}
                        onFijar={onFijar}
                        onBorrar={onBorrar}
                      />
                    ),
                  )}
                </ul>
              </section>
            ))}
            {q && avisoBusqueda}
            {!q && visibles.length >= HISTORIAL_VISIBLE && (
              <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                Se ven las {HISTORIAL_VISIBLE} más recientes. Para abrir una anterior, buscala por su título.
              </p>
            )}
          </>
        )}
      </nav>

      {pie}
    </div>
  )
}

function FilaConversacion({
  conversacion: c,
  activa,
  cargando,
  onElegir,
  onRenombrar,
  onFijar,
  onBorrar,
}: {
  conversacion: TexConversacion
  activa: boolean
  cargando: boolean
  onElegir: (conversacion: TexConversacion) => void
  onRenombrar: () => void
  onFijar: (conversacion: TexConversacion, fijada: boolean) => void
  onBorrar: (conversacion: TexConversacion) => void
}) {
  const titulo = c.titulo?.trim() || 'Conversación sin título'
  return (
    <li className={cn('group relative rounded-lg transition-colors', activa ? 'bg-accent' : 'hover:bg-accent/50')}>
      <button
        type="button"
        onClick={() => onElegir(c)}
        aria-current={activa ? 'page' : undefined}
        title={titulo}
        className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg py-2 pl-2.5 pr-11 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
      >
        {c.fijada && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fijada" />}
        <span className={cn('min-w-0 flex-1 truncate', activa ? 'text-foreground' : 'text-foreground/85')}>{titulo}</span>
        {cargando && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Abriendo" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Opciones de «${titulo}»`}
            className={cn(
              'absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground',
              'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 data-[state=open]:opacity-100',
              // Con mouse aparece al pasar; en táctil, siempre.
              '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(pointer:coarse)]:size-10',
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onFijar(c, !c.fijada)}>
            {c.fijada ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            {c.fijada ? 'Desfijar' : 'Fijar'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRenombrar}>
            <Pencil aria-hidden />
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onBorrar(c)}>
            <Trash2 aria-hidden />
            Borrar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function CampoRenombrar({
  inicial,
  onGuardar,
  onCancelar,
}: {
  inicial: string
  onGuardar: (titulo: string) => void
  onCancelar: () => void
}) {
  const [valor, setValor] = useState(inicial)
  const ref = useRef<HTMLInputElement>(null)
  const listoRef = useRef(false)

  // Un cuadro después: el menú que lo abrió termina de cerrarse y devolver su foco.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [])

  function terminar(guardar: boolean) {
    if (listoRef.current) return
    listoRef.current = true
    const t = valor.replace(/\s+/g, ' ').trim()
    if (guardar && t && t !== inicial) onGuardar(t)
    else onCancelar()
  }

  return (
    <input
      ref={ref}
      value={valor}
      maxLength={80}
      aria-label="Nuevo título de la conversación"
      onChange={(e) => setValor(e.target.value)}
      onBlur={() => terminar(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          terminar(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          terminar(false)
        }
      }}
      className="h-12 w-full rounded-lg border border-[color:var(--tex)]/50 bg-background px-2.5 text-base outline-none ring-2 ring-[color:var(--tex)]/25 lg:text-sm"
    />
  )
}
