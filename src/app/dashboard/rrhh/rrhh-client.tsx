'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  IdCard, Search, Megaphone, Loader2, AlertTriangle, Users, Instagram,
  ImageOff, Settings2, CheckCheck, X, Camera, Inbox, Tag, ArrowDownWideNarrow,
  ShieldAlert, History, Send, RefreshCw, ChevronRight,
} from 'lucide-react'
import {
  listarCandidatos, setEtiquetaEsCandidato, getDestinatariosDifusion,
  cancelarDifusionRrhh, enviarLoteDifusion, reintentarFallidos,
} from '@/lib/actions/rrhh'
import type {
  Candidato, MetricasRrhh, PlantillaRrhh, DifusionRrhh, EstadoCandidato, FiltrosCandidatos,
  DestinatarioDifusion,
} from '@/lib/types/rrhh'
import type { EtiquetaRrhh } from '@/lib/actions/rrhh'
import { TarjetaCandidato } from './components/tarjeta-candidato'
import { FichaCandidato } from './components/ficha-candidato'
import { DifusionSheet } from './components/difusion-sheet'
import { IconoWhatsApp, VisorMedios, LABEL_ESTADO, TONO_ESTADO, haceCuanto, fechaHora, type Muestra } from './components/piezas'

/** Tamaño de página. Lo comparte `page.tsx`: dos tamaños distintos duplican filas al paginar. */
export const PAGINA_RRHH = 48

const TILES: Array<{ id: EstadoCandidato; icono: typeof Users }> = [
  { id: 'nuevo', icono: Inbox },
  { id: 'contactado', icono: Megaphone },
  { id: 'entrevista', icono: Users },
  { id: 'prueba', icono: Camera },
  { id: 'contratado', icono: CheckCheck },
  { id: 'descartado', icono: X },
]

const ORDENES: Array<{ id: NonNullable<FiltrosCandidatos['orden']>; label: string }> = [
  { id: 'reciente', label: 'Más recientes' },
  { id: 'material', label: 'Más trabajos' },
  { id: 'puntaje', label: 'Mejor puntuados' },
  { id: 'antiguo', label: 'Más antiguos' },
]

export function RrhhClient({
  candidatosIniciales, totalInicial, sinEtiqueta, errorInicial,
  metricas, etiquetas, plantillas, difusiones, canManage,
}: {
  candidatosIniciales: Candidato[]
  totalInicial: number
  sinEtiqueta: boolean
  errorInicial: string | null
  metricas: MetricasRrhh | null
  etiquetas: EtiquetaRrhh[]
  plantillas: PlantillaRrhh[]
  difusiones: DifusionRrhh[]
  canManage: boolean
}) {
  const router = useRouter()
  const [candidatos, setCandidatos] = useState(candidatosIniciales)
  const [total, setTotal] = useState(totalInicial)
  const [error, setError] = useState(errorInicial)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)

  const [busqueda, setBusqueda] = useState('')
  const [estados, setEstados] = useState<EstadoCandidato[]>([])
  const [canal, setCanal] = useState<'whatsapp' | 'instagram' | null>(null)
  const [soloMaterial, setSoloMaterial] = useState(false)
  const [soloAlcanzables, setSoloAlcanzables] = useState(false)
  const [orden, setOrden] = useState<NonNullable<FiltrosCandidatos['orden']>>('reciente')

  const [abierta, setAbierta] = useState<Candidato | null>(null)
  const [difusionAbierta, setDifusionAbierta] = useState(false)
  const [config, setConfig] = useState(false)
  const [historial, setHistorial] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [modoSeleccion, setModoSeleccion] = useState(false)
  const [visor, setVisor] = useState<{ medios: Muestra[]; i: number } | null>(null)
  const [, empezar] = useTransition()

  const seq = useRef(0)

  const filtros = useMemo<FiltrosCandidatos>(() => ({
    estados: estados.length > 0 ? estados : undefined,
    canal: canal ?? undefined,
    busqueda: busqueda.trim() || undefined,
    soloConMaterial: soloMaterial || undefined,
    soloAlcanzables: soloAlcanzables || undefined,
    orden,
  }), [estados, canal, busqueda, soloMaterial, soloAlcanzables, orden])

  const recargar = useCallback(async (pag: number, acumular: boolean) => {
    const mio = ++seq.current
    setCargando(true)
    const r = await listarCandidatos({ ...filtros, limit: PAGINA_RRHH, offset: pag * PAGINA_RRHH })
    // Guard de secuencia: una respuesta vieja no pisa a una nueva.
    if (mio !== seq.current) return
    setError(r.error)
    setTotal(r.total)
    setCandidatos(prev => (acumular ? [...prev, ...r.data] : r.data))
    // La ficha abierta apunta a un objeto del array anterior: sin re-derivarla,
    // cambiar el estado o el puntaje no movía nada en pantalla (el chip seguía
    // en el valor viejo hasta cerrar y reabrir).
    setAbierta(prev => (prev ? r.data.find(c => c.conversation_id === prev.conversation_id) ?? prev : null))
    setCargando(false)
  }, [filtros])

  // Debounce sólo para la búsqueda; los chips aplican al toque.
  const primeraVez = useRef(true)
  useEffect(() => {
    if (primeraVez.current) { primeraVez.current = false; return }
    const t = setTimeout(() => { setPagina(0); recargar(0, false) }, busqueda ? 300 : 0)
    return () => clearTimeout(t)
  }, [recargar, busqueda])

  function refrescarTodo() {
    empezar(() => router.refresh())
    // Vuelve a la primera página a propósito: recargar `pagina` con acumular=false
    // reemplazaba la lista por esa página sola, y con 3 páginas cargadas la grilla
    // pasaba de 156 tarjetas a 48 que arrancaban en la fila 97.
    setPagina(0)
    recargar(0, false)
  }

  function toggleEstado(e: EstadoCandidato) {
    setEstados(prev => (prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]))
  }

  function toggleSeleccion(id: string) {
    setSeleccion(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function seleccionarVisibles() {
    setSeleccion(new Set(candidatos.map(c => c.conversation_id)))
  }

  async function marcarEtiqueta(tagId: string, valor: boolean) {
    const r = await setEtiquetaEsCandidato(tagId, valor)
    if (r?.error) { toast.error(r.error); return }
    toast.success(valor ? 'Etiqueta agregada a Recursos humanos' : 'Etiqueta quitada')
    refrescarTodo()
  }

  const hayFiltros = estados.length > 0 || canal !== null || soloMaterial || soloAlcanzables || busqueda.trim() !== ''
  const puedeMas = total > 0 && candidatos.length < total

  // ── Sin etiqueta configurada ──────────────────────────────────────────────
  if (sinEtiqueta) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 py-10">
        <header className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <IdCard className="size-5" />
          </div>
          <h1 className="bg-gradient-to-b from-zinc-50 to-zinc-300 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
            Recursos humanos
          </h1>
        </header>
        <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta pantalla junta a los barberos que te escriben buscando trabajo. Los identifica por una etiqueta
            del CRM: elegí cuál de tus etiquetas marca a un candidato.
          </p>
          <ListaEtiquetas etiquetas={etiquetas} canManage={canManage} onToggle={marcarEtiqueta} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden lg:h-[calc(100dvh-5rem)]">
      {/* ── Header sticky ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[100rem] space-y-3 px-4 pb-3 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <IdCard className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="bg-gradient-to-b from-zinc-50 to-zinc-300 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
                  Recursos humanos
                </h1>
                <p className="hidden text-sm text-muted-foreground sm:block">
                  {metricas
                    ? `${metricas.total} barberos te escribieron buscando trabajo · ${metricas.nuevos_30d} en los últimos 30 días`
                    : 'Barberos que te escribieron buscando trabajo'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {difusiones.length > 0 && (
                <Button variant="ghost" size="icon-sm" title="Difusiones anteriores" onClick={() => setHistorial(true)}>
                  <History className="size-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" title="Qué etiquetas cuentan" onClick={() => setConfig(true)}>
                <Settings2 className="size-4" />
              </Button>
              {canManage && (
                <Button size="sm" onClick={() => setDifusionAbierta(true)}>
                  <Megaphone className="size-4" />
                  <span className="hidden sm:inline">Mandar difusión</span>
                  <span className="sm:hidden">Difusión</span>
                </Button>
              )}
            </div>
          </div>

          {/* Tiles que además filtran */}
          {metricas && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TILES.map(t => {
                const n = metricas[t.id]
                const activo = estados.includes(t.id)
                const Icono = t.icono
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleEstado(t.id)}
                    aria-pressed={activo}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition-colors',
                      activo ? TONO_ESTADO[t.id] : 'border-white/[0.06] bg-zinc-900/40 hover:border-white/[0.14]',
                      n === 0 && !activo && 'opacity-50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] font-medium uppercase tracking-wider opacity-80">
                        {LABEL_ESTADO[t.id]}
                      </span>
                      <Icono className="size-3.5 shrink-0 opacity-70" />
                    </div>
                    <p className="mt-0.5 text-lg font-black tabular-nums leading-tight">{n}</p>
                  </button>
                )
              })}
            </div>
          )}

          {/* Buscador + filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, @usuario, teléfono o lo que escribió…"
                className="h-9 pl-8 text-sm"
              />
              {cargando && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
              {([null, 'whatsapp', 'instagram'] as const).map(v => (
                <button
                  key={v ?? 'todos'}
                  type="button"
                  onClick={() => setCanal(v)}
                  aria-pressed={canal === v}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    canal === v ? 'bg-white/[0.1]' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'whatsapp' && <IconoWhatsApp className="size-3" />}
                  {v === 'instagram' && <Instagram className="size-3" />}
                  {v === null ? 'Todos' : v === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                </button>
              ))}
            </div>

            <ChipFiltro activo={soloMaterial} onClick={() => setSoloMaterial(v => !v)}>
              <Camera className="size-3" /> Con trabajos
            </ChipFiltro>
            <ChipFiltro activo={soloAlcanzables} onClick={() => setSoloAlcanzables(v => !v)}>
              <IconoWhatsApp className="size-3" /> Contactables
            </ChipFiltro>

            <select
              value={orden}
              onChange={e => setOrden(e.target.value as NonNullable<FiltrosCandidatos['orden']>)}
              className="h-9 rounded-lg border border-white/[0.08] bg-transparent px-2 text-xs text-muted-foreground outline-none focus:border-white/20"
              aria-label="Ordenar"
            >
              {ORDENES.map(o => <option key={o.id} value={o.id} className="bg-zinc-900">{o.label}</option>)}
            </select>

            {hayFiltros && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setEstados([]); setCanal(null); setSoloMaterial(false); setSoloAlcanzables(false); setBusqueda('') }}
              >
                <X className="size-3.5" /> Limpiar
              </Button>
            )}
          </div>

          {/* Barra de selección múltiple */}
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={modoSeleccion}
                  onCheckedChange={(v) => { setModoSeleccion(v); if (!v) setSeleccion(new Set()) }}
                />
                Elegir a mano
              </label>
              {modoSeleccion && (
                <>
                  <span className="text-xs tabular-nums">{seleccion.size} elegidos</span>
                  <Button variant="ghost" size="xs" onClick={seleccionarVisibles}>Todos los visibles</Button>
                  {seleccion.size > 0 && (
                    <>
                      <Button variant="ghost" size="xs" onClick={() => setSeleccion(new Set())}>Ninguno</Button>
                      <Button size="xs" onClick={() => setDifusionAbierta(true)}>
                        <Megaphone className="size-3" /> Difundir a {seleccion.size}
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Cuerpo ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-4">
          {error && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4">
              <AlertTriangle className="size-5 shrink-0 text-red-400" />
              <div className="text-sm">
                <p className="font-semibold text-red-200">{error}</p>
                <p className="text-red-200/70">Esto no significa que no tengas candidatos: no pudimos leer la base.</p>
              </div>
            </div>
          )}

          {metricas && metricas.media_vencida > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-3.5">
              <ImageOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {metricas.media_vencida} fotos y videos viejos de Instagram ya no se pueden ver
                </p>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Instagram los servía desde un link propio que caduca a los pocos días, y su API no permite volver a
                  pedirlos. Ya quedó arreglado de acá en adelante: lo que manden ahora se guarda igual que lo de WhatsApp
                  y no se pierde más. Lo de WhatsApp nunca se vio afectado.
                </p>
              </div>
            </div>
          )}

          {metricas && metricas.del_equipo > 0 && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-400" />
              {metricas.del_equipo} {metricas.del_equipo === 1 ? 'ficha corresponde' : 'fichas corresponden'} a alguien de tu equipo:
              la IA {metricas.del_equipo === 1 ? 'la etiquetó' : 'las etiquetó'} por error y {metricas.del_equipo === 1 ? 'queda excluida' : 'quedan excluidas'} de las difusiones.
            </p>
          )}

          {/* Grilla */}
          {!error && candidatos.length === 0 && !cargando ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-16 text-center">
              <Users className="size-8 text-muted-foreground opacity-40" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {hayFiltros
                  ? 'Ningún candidato coincide con estos filtros.'
                  : 'Todavía no hay candidatos. Aparecen solos acá cuando alguien te escribe buscando trabajo y la IA lo etiqueta.'}
              </p>
              {hayFiltros && (
                <Button variant="outline" size="sm" onClick={() => { setEstados([]); setCanal(null); setSoloMaterial(false); setSoloAlcanzables(false); setBusqueda('') }}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          ) : error && candidatos.length === 0 ? null : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {candidatos.map(c => (
                  <TarjetaCandidato
                    key={c.conversation_id}
                    c={c}
                    seleccionado={seleccion.has(c.conversation_id)}
                    modoSeleccion={modoSeleccion}
                    onAbrir={setAbierta}
                    onToggleSeleccion={toggleSeleccion}
                    onVerMedios={(cand, m) => setVisor({
                      medios: (cand.muestras ?? []) as Muestra[],
                      // Se busca por URL y no por índice: el mosaico esconde las
                      // miniaturas que no cargan, así que su índice visible no es
                      // el del array original y se abría la foto equivocada.
                      i: Math.max(((cand.muestras ?? []) as Muestra[]).findIndex(x => x.url === m.url), 0),
                    })}
                  />
                ))}
                {cargando && candidatos.length === 0 && Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
                    <Skeleton className="aspect-[16/10] rounded-none" />
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-4 w-32 rounded" />
                      <Skeleton className="h-3 w-full rounded" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3 pb-4 pt-2">
                {puedeMas ? (
                  <Button
                    variant="outline"
                    disabled={cargando}
                    onClick={() => { const p = pagina + 1; setPagina(p); recargar(p, true) }}
                  >
                    {cargando ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownWideNarrow className="size-4" />}
                    Ver más ({candidatos.length} de {total})
                  </Button>
                ) : (
                  total > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {total} {total === 1 ? 'candidato' : 'candidatos'}
                    </p>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Capas ─────────────────────────────────────────────────────────── */}
      <FichaCandidato
        candidato={abierta}
        plantillas={plantillas}
        canManage={canManage}
        onCerrar={() => setAbierta(null)}
        onCambio={refrescarTodo}
      />

      <DifusionSheet
        abierto={difusionAbierta}
        onCerrar={() => { setDifusionAbierta(false); refrescarTodo() }}
        plantillas={plantillas}
        metricas={metricas}
        seleccion={[...seleccion]}
        onListo={refrescarTodo}
      />

      {visor && (
        <VisorMedios
          medios={visor.medios}
          indice={visor.i}
          onCerrar={() => setVisor(null)}
          onMover={(i) => setVisor(v => (v ? { ...v, i } : null))}
        />
      )}

      <Dialog open={config} onOpenChange={setConfig}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Tag className="size-4 text-muted-foreground" /> Qué etiquetas traen candidatos
            </DialogTitle>
            <DialogDescription className="text-xs">
              Las conversaciones con estas etiquetas aparecen en esta pantalla. La IA las asigna sola si la etiqueta
              tiene el auto-etiquetado prendido.
            </DialogDescription>
          </DialogHeader>
          <ListaEtiquetas etiquetas={etiquetas} canManage={canManage} onToggle={marcarEtiqueta} />
        </DialogContent>
      </Dialog>

      <HistorialDifusiones
        abierto={historial}
        onCerrar={() => setHistorial(false)}
        difusiones={difusiones}
        canManage={canManage}
        onCambio={refrescarTodo}
      />
    </div>
  )
}

function ChipFiltro({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
        activo
          ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
          : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function ListaEtiquetas({
  etiquetas, canManage, onToggle,
}: {
  etiquetas: EtiquetaRrhh[]
  canManage: boolean
  onToggle: (id: string, v: boolean) => void
}) {
  if (etiquetas.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-muted-foreground">
        Todavía no creaste etiquetas en Mensajería.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {etiquetas.map(t => (
        <div key={t.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t.conversaciones} conversaciones{t.ai_auto_assign ? ' · la etiqueta la IA' : ''}
            </p>
          </div>
          <Switch
            checked={t.es_candidato}
            disabled={!canManage}
            onCheckedChange={(v) => onToggle(t.id, v)}
            aria-label={`Usar ${t.name} en Recursos humanos`}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Historial de difusiones. No es sólo lectura: una difusión que quedó a medias
 * (el navegador se cerró, la red se cayó) tiene que poder terminarse o
 * cancelarse desde acá, o queda trabada para siempre — que era el caso.
 */
function HistorialDifusiones({
  abierto, onCerrar, difusiones, canManage, onCambio,
}: {
  abierto: boolean
  onCerrar: () => void
  difusiones: DifusionRrhh[]
  canManage: boolean
  onCambio: () => void
}) {
  const [abierta, setAbierta] = useState<string | null>(null)
  const [destinatarios, setDestinatarios] = useState<DestinatarioDifusion[]>([])
  const [cargando, setCargando] = useState(false)
  const [ocupada, setOcupada] = useState<string | null>(null)

  async function verDetalle(id: string) {
    if (abierta === id) { setAbierta(null); return }
    setAbierta(id)
    setCargando(true)
    const r = await getDestinatariosDifusion(id)
    if (r.error) toast.error(r.error)
    setDestinatarios(r.data)
    setCargando(false)
  }

  async function seguirEnviando(id: string) {
    setOcupada(id)
    try {
      let previo = -1
      for (let i = 0; i < 400; i++) {
        const r = await enviarLoteDifusion(id, 8)
        if (r.error) { toast.error(r.error); break }
        if (r.terminado) { toast.success('Difusión terminada'); break }
        const procesados = r.enviados + r.fallidos
        if (procesados === previo) {
          toast.info('Quedan mensajes tomados por otro envío. Probá de nuevo en unos minutos.')
          break
        }
        previo = procesados
      }
      onCambio()
    } finally {
      setOcupada(null)
    }
  }

  async function accion(id: string, fn: () => Promise<{ error?: string } | undefined>, ok: string) {
    setOcupada(id)
    try {
      const r = await fn()
      if (r?.error) { toast.error(r.error); return }
      toast.success(ok)
      onCambio()
      if (abierta === id) { const d = await getDestinatariosDifusion(id); setDestinatarios(d.data) }
    } finally {
      setOcupada(null)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) { setAbierta(null); onCerrar() } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" /> Difusiones anteriores
          </DialogTitle>
          <DialogDescription className="text-xs">
            Tocá una para ver a quién le llegó y a quién no.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {difusiones.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">Todavía no mandaste ninguna.</p>
          )}
          {difusiones.map(d => {
            const aMandar = Math.max(d.total - d.omitidos, 0)
            const pendientes = Math.max(aMandar - d.enviados - d.fallidos, 0)
            return (
              <div key={d.id} className="rounded-xl border border-white/[0.06] bg-zinc-900/40">
                <button
                  type="button"
                  onClick={() => verDetalle(d.id)}
                  className="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <ChevronRight className={cn('mt-0.5 size-4 shrink-0 transition-transform', abierta === d.id && 'rotate-90')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{d.nombre}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{haceCuanto(d.created_at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {d.template_name} · {fechaHora(d.created_at)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-emerald-400">Enviados <b className="tabular-nums">{d.enviados}</b></span>
                      {d.fallidos > 0 && <span className="text-red-400">Fallidos <b className="tabular-nums">{d.fallidos}</b></span>}
                      {pendientes > 0 && <span className="text-amber-400">Sin mandar <b className="tabular-nums">{pendientes}</b></span>}
                      {d.omitidos > 0 && <span className="text-muted-foreground">Omitidos <b className="tabular-nums">{d.omitidos}</b></span>}
                    </div>
                  </div>
                </button>

                {canManage && (pendientes > 0 || d.fallidos > 0) && d.estado !== 'cancelada' && (
                  <div className="flex flex-wrap gap-2 border-t border-white/[0.05] px-3 py-2">
                    {pendientes > 0 && (
                      <Button size="xs" disabled={ocupada === d.id} onClick={() => seguirEnviando(d.id)}>
                        {ocupada === d.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        Terminar de enviar
                      </Button>
                    )}
                    {d.fallidos > 0 && (
                      <Button size="xs" variant="outline" disabled={ocupada === d.id}
                        onClick={() => accion(d.id, () => reintentarFallidos(d.id), 'Listos para reintentar')}>
                        <RefreshCw className="size-3" /> Reintentar {d.fallidos}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled={ocupada === d.id}
                      onClick={() => accion(d.id, () => cancelarDifusionRrhh(d.id), 'Difusión cancelada')}>
                      <X className="size-3" /> Cancelar el resto
                    </Button>
                  </div>
                )}

                {abierta === d.id && (
                  <div className="border-t border-white/[0.05] px-3 py-2">
                    {cargando ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        <Loader2 className="mr-1 inline size-3 animate-spin" /> Cargando…
                      </p>
                    ) : (
                      <ul className="max-h-56 divide-y divide-white/[0.04] overflow-y-auto">
                        {destinatarios.map(x => (
                          <li key={x.id} className="flex items-baseline justify-between gap-2 py-1.5 text-[11.5px]">
                            <span className="truncate">{x.nombre ?? 'Sin nombre'}</span>
                            <span className={cn('shrink-0',
                              x.estado === 'enviado' ? 'text-emerald-400'
                              : x.estado === 'fallido' ? 'text-red-400'
                              : 'text-muted-foreground')}>
                              {x.estado === 'enviado' ? 'Enviado' : x.motivo ?? x.estado}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
