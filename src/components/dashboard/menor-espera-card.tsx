'use client'

/**
 * Card de /dashboard/configuracion: «Menor espera por WhatsApp» (migs 218 y 222).
 *
 * Encendido POR SUCURSAL (piloto en una, después el resto), minutos de espera,
 * estado y categoría de la plantilla en Meta, verificación de las respuestas
 * (firma de Meta), latido del chequeo automático, métricas de 30 días, últimas
 * ofertas, bajas y una prueba al teléfono del dueño.
 *
 * Lo que decide a quién se le escribe vive en SQL (`menor_espera_ofertas_tick`);
 * esta pantalla no recalcula nada: muestra lo que la base dice y explica por qué.
 */

import { useEffect, useReducer, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleSlash,
  Clock3,
  ExternalLink,
  FilePlus2,
  Hourglass,
  Info,
  Loader2,
  Megaphone,
  MonitorSmartphone,
  PauseCircle,
  RefreshCw,
  Reply,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Store,
  UserCheck,
  UserX,
  XCircle,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  aceptarMarketingMenorEspera,
  crearPlantillaMenorEspera,
  darDeBajaMenorEspera,
  enviarPruebaMenorEspera,
  guardarMenorEspera,
  habilitarMenorEspera,
  obtenerMenorEspera,
  verificarPlantillaMenorEspera,
} from '@/lib/actions/menor-espera'
import { MINUTOS_OPCIONES, PLANTILLA_POR_DEFECTO, renderizarCuerpo } from '@/lib/menor-espera/plantilla'
import {
  esMarketing,
  estadoFirma,
  estadoPlantilla,
  LIMITE_INTENTOS_DIA,
  LIMITE_PRUEBAS_DIA,
  motivoNoListo,
  motivoNoListoPrueba,
  type TonoEstado,
} from '@/lib/menor-espera/estado'
import type { BajaPanel, OfertaPanel, PanelMenorEspera, SucursalPanel } from '@/lib/menor-espera/tipos'

// ── Estado: el panel y el reloj viajan juntos ────────────────────────────────
// Las fechas relativas («hace 20 s») se miden contra la hora del SERVIDOR que
// vino con el panel más los segundos que pasaron desde que llegó: el reloj del
// browser de una tablet vieja puede estar corrido varios minutos.

interface Estado {
  panel: PanelMenorEspera | null
  error: string | null
  segundos: number
}

type Accion =
  | { tipo: 'panel'; panel: PanelMenorEspera }
  | { tipo: 'error'; error: string | null }
  | { tipo: 'tic'; segundos: number }

function reducer(estado: Estado, accion: Accion): Estado {
  switch (accion.tipo) {
    case 'panel':
      return { panel: accion.panel, error: null, segundos: 0 }
    case 'error':
      return { ...estado, error: accion.error }
    case 'tic':
      return { ...estado, segundos: estado.segundos + accion.segundos }
  }
}

const TIC_SEGUNDOS = 15
/** Pasado esto sin latido, el chequeo automático no está corriendo. */
const LATIDO_VENCIDO_MS = 3 * 60_000
/** Donde se apela o se edita la plantilla (la cuenta la elige el dueño al entrar). */
const URL_PLANTILLAS_META = 'https://business.facebook.com/wa/manage/message-templates/'

function hace(desdeIso: string | null | undefined, ahoraMs: number): string {
  if (!desdeIso) return '—'
  const diff = Math.max(0, ahoraMs - Date.parse(desdeIso))
  const s = Math.round(diff / 1000)
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

function hora(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

const TONO: Record<TonoEstado, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  espera: 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-400',
  error: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400',
  neutro: 'border-border bg-muted/40 text-muted-foreground',
}

const CONEXION_CORTADA = 'Se cortó la conexión. Revisá tu internet y probá de nuevo.'

// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  inicial: PanelMenorEspera | null
  errorInicial: string | null
}

export function MenorEsperaCard({ inicial, errorInicial }: Props) {
  const [estado, dispatch] = useReducer(reducer, { panel: inicial, error: errorInicial, segundos: 0 })
  const { panel, error } = estado

  const [recargando, setRecargando] = useState(false)
  const [guardandoSucursal, setGuardandoSucursal] = useState<string | null>(null)
  const [optimista, setOptimista] = useState<Record<string, boolean>>({})
  const [confirmar, setConfirmar] = useState<SucursalPanel | null>(null)
  const [tabletsRecargadas, setTabletsRecargadas] = useState(false)
  const [guardandoMinutos, setGuardandoMinutos] = useState<number | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [estadoMeta, setEstadoMeta] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [confirmarMarketing, setConfirmarMarketing] = useState(false)
  const [guardandoMarketing, setGuardandoMarketing] = useState(false)
  const [telefono, setTelefono] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pruebaId, setPruebaId] = useState<string | null>(null)
  const [sondeos, setSondeos] = useState(0)
  const [telefonoBaja, setTelefonoBaja] = useState('')
  const [dandoDeBaja, setDandoDeBaja] = useState(false)
  const [confirmarHabilitar, setConfirmarHabilitar] = useState<BajaPanel | null>(null)
  const [habilitando, setHabilitando] = useState<string | null>(null)

  // Reloj de las fechas relativas.
  useEffect(() => {
    const id = setInterval(() => dispatch({ tipo: 'tic', segundos: TIC_SEGUNDOS }), TIC_SEGUNDOS * 1000)
    return () => clearInterval(id)
  }, [])

  // Después de una prueba: seguir su envío cada 5 s hasta que salga (máx. 2 min).
  useEffect(() => {
    if (sondeos <= 0) return
    const id = setTimeout(async () => {
      const r = await obtenerMenorEspera()
      if (r.data) dispatch({ tipo: 'panel', panel: r.data })
      const prueba = r.data?.ofertas.find(o => o.id === pruebaId)
      const termino = !!prueba && !!prueba.envio && !['pending', 'processing'].includes(prueba.envio)
      setSondeos(termino || r.error ? 0 : sondeos - 1)
    }, 5000)
    return () => clearTimeout(id)
  }, [sondeos, pruebaId])

  async function recargar() {
    setRecargando(true)
    try {
      const r = await obtenerMenorEspera()
      if (r.data) dispatch({ tipo: 'panel', panel: r.data })
      else dispatch({ tipo: 'error', error: r.error ?? 'No pudimos cargar el estado.' })
    } finally {
      setRecargando(false)
    }
  }

  // ── Estado de carga inicial fallido ──
  if (!panel) {
    return (
      <Card>
        <CardHeader>
          <TituloCard />
        </CardHeader>
        <CardContent>
          <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium">No pudimos cargar el aviso de Menor espera</p>
                <p className="text-xs text-muted-foreground">{error ?? 'Error desconocido.'}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={recargar} disabled={recargando} className="shrink-0">
              {recargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const ahoraMs = Date.parse(panel.ahora) + estado.segundos * 1000
  const sucursales = panel.sucursales.filter(s => s.is_active || s.menor_espera_aviso)
  const activa = (s: SucursalPanel) => optimista[s.id] ?? s.menor_espera_aviso
  const activas = sucursales.filter(activa)
  // Lo que acaba de decir Meta al verificar manda sobre lo guardado (mig 222).
  const noListo = motivoNoListo(panel, estadoMeta)
  const noListoPrueba = motivoNoListoPrueba(panel, estadoMeta)
  const puede = panel.puedeEditar

  async function aplicarSucursal(s: SucursalPanel, activo: boolean) {
    setGuardandoSucursal(s.id)
    setOptimista(prev => ({ ...prev, [s.id]: activo }))
    try {
      const r = await guardarMenorEspera({ sucursales: [{ id: s.id, activo }] })
      if (r.error || !r.data) {
        toast.error(r.error ?? 'No pudimos guardar el cambio.')
        return
      }
      dispatch({ tipo: 'panel', panel: r.data })
      toast.success(activo ? `Listo, quedó activado en ${s.name}` : `Avisos desactivados en ${s.name}`)
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setOptimista(prev => {
        const sin = { ...prev }
        delete sin[s.id]
        return sin
      })
      setGuardandoSucursal(null)
    }
  }

  function alternarSucursal(s: SucursalPanel, activo: boolean) {
    // Prender le escribe a clientes reales: se confirma. Apagar, no.
    if (activo) {
      setTabletsRecargadas(false)
      setConfirmar(s)
    } else {
      void aplicarSucursal(s, false)
    }
  }

  async function elegirMinutos(minutos: number) {
    if (minutos === panel?.config.minutos) return
    setGuardandoMinutos(minutos)
    try {
      const r = await guardarMenorEspera({ minutos })
      if (r.error || !r.data) {
        toast.error(r.error ?? 'No pudimos guardar los minutos.')
        return
      }
      dispatch({ tipo: 'panel', panel: r.data })
      toast.success(`Listo: se ofrece a partir de los ${minutos} min de espera`)
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setGuardandoMinutos(null)
    }
  }

  async function verificar() {
    setVerificando(true)
    try {
      const r = await verificarPlantillaMenorEspera()
      if (r.error || !r.data) {
        toast.error(r.error ?? 'No pudimos verificar la plantilla.')
        return
      }
      dispatch({ tipo: 'panel', panel: r.data })
      setEstadoMeta(r.estadoMeta ?? null)
      const lectura = estadoPlantilla(r.data.plantilla, r.estadoMeta, r.data.config.acepta_marketing)
      const aprobada = (r.estadoMeta ?? r.data.plantilla.estado ?? '').toLowerCase() === 'approved'
      if (lectura.tono === 'error') toast.error(lectura.texto)
      else if (aprobada && esMarketing(r.data) && !r.data.config.acepta_marketing) {
        // Aprobada, pero como MARKETING: no es un «listo» verde.
        toast.warning('Meta la aprobó, pero como MARKETING: leé qué implica antes de aceptarlo.')
      } else if (lectura.tono === 'ok') toast.success(lectura.texto)
      else toast.info(lectura.texto)
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setVerificando(false)
    }
  }

  async function crearPlantilla() {
    setCreando(true)
    try {
      const r = await crearPlantillaMenorEspera()
      if (r.error) {
        toast.error(r.error)
        return
      }
      if (r.data) dispatch({ tipo: 'panel', panel: r.data })
      else void recargar()
      setEstadoMeta(null)
      toast.success(r.aviso ?? 'Plantilla creada')
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setCreando(false)
    }
  }

  async function decidirMarketing(acepta: boolean) {
    setGuardandoMarketing(true)
    try {
      const r = await aceptarMarketingMenorEspera(acepta)
      if (r.error || !r.data) {
        toast.error(r.error ?? 'No pudimos guardar la decisión.')
        return
      }
      dispatch({ tipo: 'panel', panel: r.data })
      toast.success(
        acepta
          ? 'Listo: el aviso se va a mandar como mensaje de marketing.'
          : 'Listo: el aviso deja de mandarse hasta que lo vuelvas a aceptar.',
      )
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setGuardandoMarketing(false)
    }
  }

  async function enviarPrueba() {
    setEnviando(true)
    try {
      const r = await enviarPruebaMenorEspera(telefono)
      if (!r.ok) {
        toast.error(r.error ?? 'No pudimos mandar la prueba.')
        return
      }
      if (r.data) {
        dispatch({ tipo: 'panel', panel: r.data })
        setPruebaId(r.data.ofertas.find(o => o.es_prueba)?.id ?? null)
      }
      setSondeos(24)
      toast.success(`Prueba en camino para ${r.cliente ?? 'vos'}: te llega en menos de un minuto`)
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setEnviando(false)
    }
  }

  async function darDeBaja() {
    setDandoDeBaja(true)
    try {
      const r = await darDeBajaMenorEspera(telefonoBaja)
      if (r.error) {
        toast.error(r.error)
        return
      }
      if (r.data) dispatch({ tipo: 'panel', panel: r.data })
      else void recargar()
      setTelefonoBaja('')
      toast.success(r.aviso ?? 'Listo: no recibe más estos avisos.')
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setDandoDeBaja(false)
    }
  }

  async function habilitar(b: BajaPanel) {
    setHabilitando(b.client_id)
    try {
      const r = await habilitarMenorEspera(b.client_id)
      if (r.error) {
        toast.error(r.error)
        return
      }
      if (r.data) dispatch({ tipo: 'panel', panel: r.data })
      else void recargar()
      toast.success(r.aviso ?? 'Listo: vuelve a recibir los avisos.')
    } catch {
      toast.error(CONEXION_CORTADA)
    } finally {
      setHabilitando(null)
    }
  }

  const pruebaActual = pruebaId ? panel.ofertas.find(o => o.id === pruebaId) ?? null : null

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <TituloCard />
              <CardDescription className="max-w-2xl leading-relaxed">
                Si un cliente espera a un barbero puntual más de {panel.config.minutos} minutos y en ese momento otro
                barbero está libre, le escribimos para ofrecerle pasarse a Menor espera. Conserva su lugar en la fila.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 gap-1.5 px-2.5 py-1',
                activas.length > 0 ? TONO.ok : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  activas.length > 0 ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-muted-foreground/50',
                )}
              />
              {activas.length > 0
                ? `Activo en ${activas.length} ${activas.length === 1 ? 'sucursal' : 'sucursales'}`
                : 'Apagado'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                {error}
              </p>
              <Button variant="ghost" size="sm" onClick={recargar} disabled={recargando}>
                {recargando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Reintentar
              </Button>
            </div>
          )}

          <BannerLatido panel={panel} activas={activas.length} ahoraMs={ahoraMs} />

          {!puede && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5" />
              Sólo lectura: para cambiar esto necesitás el permiso «Modificar configuración general».
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            {/* ── Columna principal ── */}
            <div className="min-w-0 space-y-6">
              {/* Dónde */}
              <section className="space-y-2.5" aria-labelledby="me-sucursales">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="me-sucursales" className="text-sm font-medium">Dónde se ofrece</h3>
                  {activas.length === 0 && !noListo && sucursales.length > 1 && (
                    <span className="text-[11px] text-muted-foreground">Sugerencia: empezá por una sola sucursal</span>
                  )}
                </div>
                {sucursales.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No tenés sucursales a tu cargo.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {sucursales.map(s => {
                      const on = activa(s)
                      const guardando = guardandoSucursal === s.id
                      // Apagar siempre se puede; prender, sólo si el aviso puede salir.
                      const bloqueada = !puede || guardando || (!on && !!noListo)
                      return (
                        <li key={s.id}>
                          <label
                            htmlFor={`me-suc-${s.id}`}
                            className={cn(
                              'flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors',
                              bloqueada ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                            )}
                          >
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                              <Store className="size-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{s.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {on ? 'Ofreciendo Menor espera' : 'Apagado'}
                                {s.business_hours_open && s.business_hours_close
                                  ? ` · de ${hora(s.business_hours_open)} a ${hora(s.business_hours_close)}`
                                  : ''}
                              </p>
                            </div>
                            {guardando && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
                            <Switch
                              id={`me-suc-${s.id}`}
                              checked={on}
                              disabled={bloqueada}
                              onCheckedChange={v => alternarSucursal(s, v)}
                              aria-label={`Ofrecer Menor espera en ${s.name}`}
                            />
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {noListo && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {noListo}
                  </p>
                )}
              </section>

              {/* Cuándo */}
              <section className="space-y-2.5" aria-labelledby="me-minutos">
                <h3 id="me-minutos" className="text-sm font-medium">Ofrecer después de</h3>
                <div role="group" aria-labelledby="me-minutos" className="flex flex-wrap gap-2">
                  {MINUTOS_OPCIONES.map(min => {
                    const elegido = panel.config.minutos === min
                    const guardando = guardandoMinutos === min
                    return (
                      <button
                        key={min}
                        type="button"
                        aria-pressed={elegido}
                        disabled={!puede || guardandoMinutos !== null}
                        onClick={() => elegirMinutos(min)}
                        className={cn(
                          'inline-flex h-11 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                          'motion-safe:transition-[background-color,border-color,color,transform] motion-safe:duration-150',
                          'motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
                          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          elegido
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                      >
                        {guardando && <Loader2 className="size-3.5 animate-spin" />}
                        {min} min
                      </button>
                    )
                  })}
                  {!MINUTOS_OPCIONES.includes(panel.config.minutos as (typeof MINUTOS_OPCIONES)[number]) && (
                    <span className="inline-flex h-11 items-center rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground">
                      {panel.config.minutos} min
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Contados desde que se anotó en la tablet. Nunca después de {panel.config.minutos + 120} min: a esa altura
                  probablemente ya se fue.
                </p>
              </section>

              {/* Plantilla */}
              <SeccionPlantilla
                panel={panel}
                estadoMeta={estadoMeta}
                puede={puede}
                verificando={verificando}
                creando={creando}
                guardandoMarketing={guardandoMarketing}
                onVerificar={verificar}
                onCrear={crearPlantilla}
                onAceptarMarketing={() => setConfirmarMarketing(true)}
                onRevocarMarketing={() => void decidirMarketing(false)}
              />

              {/* Verificación de las respuestas */}
              <SeccionFirma panel={panel} ahoraMs={ahoraMs} />

              {/* Métricas */}
              <SeccionMetricas panel={panel} />

              {/* Últimas ofertas */}
              <SeccionOfertas ofertas={panel.ofertas} ahoraMs={ahoraMs} />
            </div>

            {/* ── Columna lateral: cómo le llega, prueba y bajas ── */}
            <div className="min-w-0 space-y-6">
              <VistaPrevia panel={panel} />
              <SeccionPrueba
                panel={panel}
                puede={puede}
                noListo={noListoPrueba}
                telefono={telefono}
                onTelefono={setTelefono}
                enviando={enviando}
                onEnviar={enviarPrueba}
                prueba={pruebaActual}
                siguiendo={sondeos > 0}
              />
              <SeccionBajas
                panel={panel}
                puede={puede}
                ahoraMs={ahoraMs}
                telefono={telefonoBaja}
                onTelefono={setTelefonoBaja}
                dando={dandoDeBaja}
                onDarDeBaja={darDeBaja}
                habilitando={habilitando}
                onHabilitar={setConfirmarHabilitar}
              />
            </div>
          </div>

          <ComoDecide minutos={panel.config.minutos} botones={panel.plantilla.botones} />
        </CardContent>
      </Card>

      {/* Prender una sucursal: le escribe a clientes reales y depende de que las
          pantallas tengan la versión nueva (si no, quien acepta desaparece de la
          «Mi fila» de su barbero). */}
      <AlertDialog
        open={!!confirmar}
        onOpenChange={open => {
          if (!open) {
            setConfirmar(null)
            setTabletsRecargadas(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Activar en {confirmar?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Desde ahora, si un cliente de {confirmar?.name} espera a un barbero puntual más de {panel.config.minutos}{' '}
              minutos y hay otro barbero libre, le escribimos por WhatsApp para ofrecerle pasarse a Menor espera. Lo podés
              apagar cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {esMarketing(panel) && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              <Megaphone className="mt-0.5 size-3.5 shrink-0" />
              Sale como mensaje de marketing (lo aceptaste): Meta lo cobra más caro y puede no entregárselo a algunos
              clientes.
            </p>
          )}
          <label
            htmlFor="me-tablets"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40"
          >
            <Checkbox
              id="me-tablets"
              checked={tabletsRecargadas}
              onCheckedChange={v => setTabletsRecargadas(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1 leading-relaxed">
              <span className="flex items-center gap-1.5 font-medium">
                <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
                Ya recargué las pantallas de {confirmar?.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                El panel de todas las tablets de los barberos, el kiosko, la TV y la pantalla de Fila de la recepción. Una
                pantalla con la versión anterior no muestra a quien acepta en la fila de su barbero: esperaría de más.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!tabletsRecargadas}
              onClick={() => {
                const s = confirmar
                setConfirmar(null)
                setTabletsRecargadas(false)
                if (s) void aplicarSucursal(s, true)
              }}
            >
              Activar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aceptar la categoría MARKETING es una decisión del dueño: se confirma. */}
      <AlertDialog open={confirmarMarketing} onOpenChange={setConfirmarMarketing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mandar el aviso como marketing?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Cada aviso se va a cobrar con la tarifa de marketing de Meta, algunos clientes no lo van a recibir y quien
              lo bloquee o lo reporte baja la calidad del número que también usan los turnos, las reseñas y los códigos
              de acceso de la app. Lo podés revertir cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmarMarketing(false)
                void decidirMarketing(true)
              }}
            >
              Acepto que se mande como marketing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Volver a escribirle a quien pidió la baja: sólo si él lo pidió. */}
      <AlertDialog open={!!confirmarHabilitar} onOpenChange={open => !open && setConfirmarHabilitar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver a mandarle avisos a {confirmarHabilitar?.cliente ?? 'este cliente'}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Pidió no recibir estos avisos. Habilitalo sólo si él te lo pidió: escribirle a quien se dio de baja baja la
              calidad del número de WhatsApp. También vuelven a recibirlos sus otras fichas con el mismo número.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const b = confirmarHabilitar
                setConfirmarHabilitar(null)
                if (b) void habilitar(b)
              }}
            >
              Volver a habilitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function TituloCard() {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Zap className="size-4" />
      </span>
      Menor espera por WhatsApp
    </CardTitle>
  )
}

/** Latido, último error, disyuntor y latido de entrada: nada de esto falla en silencio. */
function BannerLatido({ panel, activas, ahoraMs }: { panel: PanelMenorEspera; activas: number; ahoraMs: number }) {
  const l = panel.latido

  if (l?.disyuntor_desde) {
    return (
      <div role="status" className={cn('flex items-start gap-2.5 rounded-lg border p-3', TONO.error)}>
        <PauseCircle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">Pausamos los avisos: los últimos 3 envíos fallaron</p>
          <p className="text-xs text-muted-foreground">
            {l.disyuntor_error ? `Meta respondió: ${l.disyuntor_error}. ` : ''}
            Corregí el problema y mandate una prueba: si sale bien, los avisos vuelven solos (las pruebas que fallan no
            cuentan para el tope del día).
          </p>
        </div>
      </div>
    )
  }

  if (l?.sin_entrada_desde) {
    const ultima = panel.webhook?.ultima_valida_at
    return (
      <div role="status" className={cn('flex items-start gap-2.5 rounded-lg border p-3', TONO.error)}>
        <PauseCircle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">Pausamos los avisos: no nos llegan las respuestas de WhatsApp</p>
          <p className="text-xs text-muted-foreground">
            Salieron avisos y {ultima ? `desde ${hace(ultima, ahoraMs)} ` : ''}no entró ningún mensaje de Meta con la
            firma verificada: si un cliente toca «Sí», no nos enteramos. Revisá el webhook de WhatsApp en Meta y el App
            Secret en Mensajería → Configuración. Los avisos vuelven solos apenas entra un mensaje.
          </p>
        </div>
      </div>
    )
  }

  if (activas === 0) return null

  if (l?.ultimo_error) {
    return (
      <div role="status" className={cn('flex items-start gap-2.5 rounded-lg border p-3', 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400')}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">Encendido, pero no se está ofreciendo</p>
          <p className="text-xs text-muted-foreground">
            {l.ultimo_error} <span className="whitespace-nowrap">({hace(l.ultimo_error_at, ahoraMs)})</span>
          </p>
        </div>
      </div>
    )
  }

  if (!l?.ultimo_tick_at) {
    return (
      <div role="status" className={cn('flex items-center gap-2.5 rounded-lg border p-3 text-sm', TONO.espera)}>
        <Clock3 className="size-4 shrink-0" />
        Esperando el primer chequeo automático (corre cada minuto).
      </div>
    )
  }

  const vencido = ahoraMs - Date.parse(l.ultimo_tick_at) > LATIDO_VENCIDO_MS
  if (vencido) {
    return (
      <div role="status" className={cn('flex items-start gap-2.5 rounded-lg border p-3', TONO.error)}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">El chequeo automático no corre desde {hace(l.ultimo_tick_at, ahoraMs)}</p>
          <p className="text-xs text-muted-foreground">
            Mientras no corra, no sale ningún aviso. Avisale a soporte: es el job «menor-espera-ofertas» de la base.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div role="status" className={cn('flex items-center gap-2.5 rounded-lg border p-3 text-sm', TONO.ok)}>
      <Activity className="size-4 shrink-0" />
      <span>
        Funcionando <span className="text-muted-foreground">· último chequeo {hace(l.ultimo_tick_at, ahoraMs)}</span>
      </span>
    </div>
  )
}

function SeccionPlantilla({
  panel,
  estadoMeta,
  puede,
  verificando,
  creando,
  guardandoMarketing,
  onVerificar,
  onCrear,
  onAceptarMarketing,
  onRevocarMarketing,
}: {
  panel: PanelMenorEspera
  estadoMeta: string | null
  puede: boolean
  verificando: boolean
  creando: boolean
  guardandoMarketing: boolean
  onVerificar: () => void
  onCrear: () => void
  onAceptarMarketing: () => void
  onRevocarMarketing: () => void
}) {
  const acepta = panel.config.acepta_marketing
  const lectura = estadoPlantilla(panel.plantilla, estadoMeta, acepta)
  const Icono = lectura.tono === 'ok' ? CheckCircle2 : lectura.tono === 'error' ? XCircle : lectura.tono === 'espera' ? Hourglass : CircleDashed
  const marketing = panel.plantilla.existe && esMarketing(panel)
  const enRevision = ['pending', 'in_appeal'].includes((estadoMeta ?? panel.plantilla.estado ?? '').toLowerCase())

  return (
    <section className="space-y-2.5" aria-labelledby="me-plantilla">
      <h3 id="me-plantilla" className="text-sm font-medium">Plantilla de WhatsApp</h3>

      {panel.transporte.baileys ? (
        <div className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-sm', TONO.error)}>
          <CircleSlash className="mt-0.5 size-4 shrink-0" />
          Esta organización manda WhatsApp por el microservicio, que no admite botones. Pasá a la API oficial de Meta para
          usar esta función.
        </div>
      ) : !panel.transporte.whatsapp ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            WhatsApp no está conectado: sin eso no sale ningún aviso.
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/dashboard/mensajeria?settings=1">Conectar WhatsApp</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2.5 rounded-lg border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', TONO[lectura.tono])}>
                  <Icono className="size-3.5" />
                  {lectura.texto}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {panel.plantilla.nombre}
                  {panel.plantilla.idioma ? ` · ${panel.plantilla.idioma}` : ''}
                  {panel.plantilla.categoria ? ` · ${panel.plantilla.categoria}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!panel.plantilla.existe && (
                  <Button onClick={onCrear} disabled={!puede || creando}>
                    {creando ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
                    Crear plantilla
                  </Button>
                )}
                <Button variant="outline" onClick={onVerificar} disabled={verificando}>
                  {verificando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Verificar estado en Meta
                </Button>
              </div>
            </div>
            {enRevision && (
              <p className="text-xs text-muted-foreground">
                Mientras Meta la revisa no se puede prender. Volvé a verificar en un rato.
              </p>
            )}
          </div>

          {marketing && (
            <div
              className={cn(
                'flex items-start gap-2.5 rounded-lg border p-3',
                acepta ? 'border-border bg-muted/30' : 'border-amber-500/40 bg-amber-500/5',
              )}
            >
              <Megaphone
                className={cn('mt-0.5 size-4 shrink-0', acepta ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {acepta ? 'Se manda como mensaje de marketing' : 'Meta la aprobó como MARKETING, no como Utilidad'}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {acepta
                      ? 'Lo aceptaste. Si dejás de aceptarlo, los avisos dejan de salir hasta que lo vuelvas a aceptar o Meta la pase a Utilidad.'
                      : 'Pedimos que fuera de Utilidad (un aviso sobre un servicio en curso), pero Meta decidió otra cosa. Mientras no lo aceptes, no sale ningún aviso ni se puede prender. Antes de decidir:'}
                  </p>
                </div>
                {!acepta && (
                  <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground marker:text-amber-500/70">
                    <li>
                      <span className="font-medium text-foreground">Cuesta más.</span> Meta cobra cada aviso con la tarifa
                      de marketing, aunque el cliente te haya escrito ese día.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Puede no llegar.</span> Meta no le entrega marketing a
                      algunos clientes (sus pruebas de marketing, o ya recibieron muchos ese día) y no avisa: acá figuran
                      como «Sin respuesta».
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Se pueden dar de baja.</span> Desde WhatsApp, el
                      cliente puede dejar de recibir los mensajes de marketing de la barbería.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Pega en el número.</span> Si muchos lo bloquean o lo
                      reportan, baja la calidad del número que también usan los turnos, las reseñas y los códigos de
                      acceso de la app.
                    </li>
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  {acepta ? (
                    <Button variant="outline" size="sm" onClick={onRevocarMarketing} disabled={!puede || guardandoMarketing}>
                      {guardandoMarketing && <Loader2 className="animate-spin" />}
                      Dejar de aceptarlo
                    </Button>
                  ) : (
                    <Button size="sm" onClick={onAceptarMarketing} disabled={!puede || guardandoMarketing}>
                      {guardandoMarketing && <Loader2 className="animate-spin" />}
                      Acepto que se mande como marketing
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm">
                    <a href={URL_PLANTILLAS_META} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      Apelar o reescribir en Meta
                    </a>
                  </Button>
                </div>
                {!acepta && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Si creés que es de Utilidad, pedí una revisión de la categoría en el Administrador de WhatsApp. Si la
                    reescribís, el texto tiene que ser estrictamente informativo; editarla la vuelve a mandar a revisión y,
                    mientras tanto, no se puede usar.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Mig 222: la firma de Meta en las respuestas, medida con el tráfico real. */
function SeccionFirma({ panel, ahoraMs }: { panel: PanelMenorEspera; ahoraMs: number }) {
  const w = panel.webhook
  const lectura = estadoFirma(w, ahoraMs)
  const Icono = lectura.tono === 'ok' ? ShieldCheck : lectura.tono === 'error' ? ShieldAlert : ShieldQuestion

  return (
    <section className="space-y-2.5" aria-labelledby="me-firma">
      <h3 id="me-firma" className="text-sm font-medium">Respuestas por WhatsApp</h3>
      <div className="space-y-2.5 rounded-lg border p-3">
        <p className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', TONO[lectura.tono])}>
          <Icono className="size-3.5" />
          {lectura.texto}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Antes de mover a alguien de la fila por una respuesta, verificamos que el mensaje venga de Meta (la firma con el
          App Secret de la app). Sin firma verificada no movemos a nadie: le avisamos a la recepción.
        </p>
        {lectura.detalle && <p className="text-xs leading-relaxed">{lectura.detalle}</p>}
        {w && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Último verificado</dt>
              <dd className="font-medium tabular-nums">{hace(w.ultima_valida_at, ahoraMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Verificados · 7 días</dt>
              <dd className="font-medium tabular-nums">{w.semana.validas.toLocaleString('es-AR')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Firma que no coincide</dt>
              <dd className={cn('font-medium tabular-nums', w.semana.invalidas > 0 && 'text-red-600 dark:text-red-400')}>
                {w.semana.invalidas.toLocaleString('es-AR')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sin firma</dt>
              <dd className={cn('font-medium tabular-nums', w.semana.sin_firma > 0 && 'text-amber-600 dark:text-amber-400')}>
                {w.semana.sin_firma.toLocaleString('es-AR')}
              </dd>
            </div>
          </dl>
        )}
        {(lectura.tono === 'error' || !w?.tiene_app_secret) && w && (
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/mensajeria?settings=1">Revisar el App Secret</Link>
          </Button>
        )}
      </div>
    </section>
  )
}

function SeccionMetricas({ panel }: { panel: PanelMenorEspera }) {
  const m = panel.metricas
  const pct = m.enviadas > 0 ? Math.round((m.aceptaron / m.enviadas) * 100) : null
  const tiles: Array<{ etiqueta: string; valor: string; detalle?: string; tono?: 'alerta' }> = [
    // «Enviado» sería mentir: Meta aceptó el envío, no sabemos si le llegó.
    { etiqueta: 'Aceptados por Meta', valor: String(m.enviadas) },
    { etiqueta: 'Aceptaron', valor: String(m.aceptaron), detalle: pct != null ? `${pct}%` : undefined },
    { etiqueta: 'Prefirieron esperar', valor: String(m.prefirieron_esperar) },
    { etiqueta: 'Sin respuesta', valor: String(m.sin_respuesta) },
  ]
  if (m.no_salieron > 0) tiles.push({ etiqueta: 'No salieron', valor: String(m.no_salieron), tono: 'alerta' })

  return (
    <section className="space-y-2.5" aria-labelledby="me-metricas">
      <h3 id="me-metricas" className="text-sm font-medium">Últimos 30 días</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(t => (
          <div
            key={t.etiqueta}
            className={cn(
              'rounded-lg border p-3',
              t.tono === 'alerta' ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/20',
            )}
          >
            <p className="text-[11px] text-muted-foreground">{t.etiqueta}</p>
            <p className="mt-0.5 flex items-baseline gap-1.5 text-xl font-semibold tabular-nums">
              {t.valor}
              {t.detalle && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t.detalle}</span>}
            </p>
          </div>
        ))}
      </div>
      {pct != null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Aceptaron ${pct}% de los avisos que Meta aceptó`}
        >
          <div
            className="h-full rounded-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>
          «Aceptados por Meta» no quiere decir entregados: si Meta no se lo entrega a alguien, acá figura como «Sin
          respuesta».
        </li>
        {m.mediana_min_hasta_atencion != null && (
          <li>
            Después de aceptar, los atendieron en {m.mediana_min_hasta_atencion.toLocaleString('es-AR', { maximumFractionDigits: 1 })} min
            (mediana){m.atendidos_por_otro > 0 ? ` · ${m.atendidos_por_otro} los atendió otro barbero` : ''}.
          </li>
        )}
      </ul>
    </section>
  )
}

function chipOferta(o: OfertaPanel): { texto: string; clase: string; Icono: typeof CheckCircle2 } {
  const verde = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  const azul = 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
  const ambar = 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
  const gris = 'border-border bg-muted/60 text-muted-foreground'

  if (o.estado === 'fallida' || o.resultado === 'no_salio_a_tiempo') return { texto: 'No salió', clase: ambar, Icono: AlertTriangle }
  if (o.es_prueba) {
    if (o.estado === 'en_cola') return { texto: 'Prueba · enviando', clase: azul, Icono: Hourglass }
    return { texto: 'Prueba', clase: gris, Icono: Send }
  }
  if (o.estado === 'aceptada') return { texto: 'Aceptó', clase: verde, Icono: CheckCircle2 }
  if (o.resultado === 'pidio_baja') return { texto: 'Pidió la baja', clase: gris, Icono: UserX }
  if (o.respuesta === 'no') return { texto: 'Prefirió esperar', clase: gris, Icono: XCircle }
  if (o.estado === 'en_cola') return { texto: 'Enviando', clase: azul, Icono: Hourglass }
  if (o.estado === 'enviada') return { texto: 'Esperando respuesta', clase: azul, Icono: Hourglass }
  switch (o.resultado) {
    case 'atendido_sin_responder':
      return { texto: 'Lo atendieron antes', clase: gris, Icono: CircleDashed }
    case 'salio_de_la_fila':
      return { texto: 'Se fue de la fila', clase: gris, Icono: CircleDashed }
    case 'cambio_por_otra_via':
      return { texto: 'Lo movió la recepción', clase: gris, Icono: CircleDashed }
    case 'respondio_tarde':
      return { texto: 'Respondió tarde', clase: gris, Icono: CircleDashed }
    default:
      return { texto: 'Sin respuesta', clase: gris, Icono: CircleDashed }
  }
}

function SeccionOfertas({ ofertas, ahoraMs }: { ofertas: OfertaPanel[]; ahoraMs: number }) {
  return (
    <section className="space-y-2.5" aria-labelledby="me-ofertas">
      <h3 id="me-ofertas" className="text-sm font-medium">Últimas ofertas</h3>
      {ofertas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <Hourglass className="size-5 text-muted-foreground/70" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Todavía no hubo ofertas. Aparecen acá cuando alguien supera el tiempo de espera y hay un barbero libre.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {ofertas.map(o => {
            const chip = chipOferta(o)
            const titulo = o.es_prueba
              ? `Prueba para ${o.cliente ?? 'vos'}`
              : `${o.cliente ?? 'Cliente'}${o.barbero ? ` · esperaba a ${o.barbero}` : ''} · ${o.minutos_espera} min`
            const detalle = [
              o.sucursal,
              hace(o.creada_at, ahoraMs),
              !o.es_prueba && o.atendio ? `lo atendió ${o.atendio}` : null,
              o.error && (o.estado === 'fallida' || o.resultado === 'no_salio_a_tiempo') ? o.error : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={o.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{titulo}</p>
                  <p className="truncate text-xs text-muted-foreground" title={detalle}>{detalle}</p>
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', chip.clase)}>
                  <chip.Icono className="size-3" />
                  {chip.texto}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Cómo lo ve el cliente: el BODY real de la plantilla (o el que se va a crear) con valores de ejemplo. */
function VistaPrevia({ panel }: { panel: PanelMenorEspera }) {
  const componentes = Array.isArray(panel.plantilla.componentes)
    ? (panel.plantilla.componentes as Array<{ type?: string; text?: string }>)
    : null
  const cuerpo = componentes?.find(c => (c.type ?? '').toUpperCase() === 'BODY')?.text ?? PLANTILLA_POR_DEFECTO.cuerpo
  const pie = componentes
    ? componentes.find(c => (c.type ?? '').toUpperCase() === 'FOOTER')?.text ?? null
    : PLANTILLA_POR_DEFECTO.pie
  const botones = panel.plantilla.botones && panel.plantilla.botones.length > 0 ? panel.plantilla.botones : [...PLANTILLA_POR_DEFECTO.botones]
  const sucursal = panel.sucursales.find(s => s.menor_espera_aviso)?.name ?? panel.sucursales[0]?.name ?? 'Rondeau'
  const texto = renderizarCuerpo(cuerpo, ['Juan', String(panel.config.minutos), 'Nico', sucursal])
  // La hora del servidor, no la del browser: es sólo decorativa, pero que no mienta.
  const horaMensaje = new Date(panel.ahora).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  })

  return (
    <section className="space-y-2.5" aria-labelledby="me-vista">
      <h3 id="me-vista" className="text-sm font-medium">Así le llega al cliente</h3>
      <div className="rounded-xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">
        <div className="max-w-[300px]">
          <div className="relative rounded-lg rounded-tl-none bg-white px-2.5 pb-1.5 pt-2 text-[13.5px] leading-[1.38] text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
            <p className="whitespace-pre-wrap">{texto}</p>
            {pie && <p className="mt-1.5 text-[11.5px] text-[#667781] dark:text-[#8696a0]">{pie}</p>}
            <p className="mt-0.5 text-right text-[10.5px] text-[#667781] dark:text-[#8696a0]">{horaMensaje}</p>
          </div>
          <div className="mt-0.5 space-y-0.5">
            {botones.map(b => (
              <div
                key={b}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13.5px] font-medium text-[#027eb5] shadow-sm dark:bg-[#202c33] dark:text-[#53bdeb]"
              >
                <Reply className="size-3.5" />
                {b}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        El nombre, los minutos, el barbero y la sucursal salen de la fila en el momento del aviso.
      </p>
    </section>
  )
}

function SeccionPrueba({
  panel,
  puede,
  noListo,
  telefono,
  onTelefono,
  enviando,
  onEnviar,
  prueba,
  siguiendo,
}: {
  panel: PanelMenorEspera
  puede: boolean
  noListo: string | null
  telefono: string
  onTelefono: (v: string) => void
  enviando: boolean
  onEnviar: () => void
  prueba: OfertaPanel | null
  siguiendo: boolean
}) {
  const sinPruebas = panel.pruebas_hoy >= LIMITE_PRUEBAS_DIA
  const sinIntentos = panel.pruebas_intentos_hoy >= LIMITE_INTENTOS_DIA
  const digitos = telefono.replace(/\D/g, '')
  const deshabilitado = !puede || enviando || !!noListo || sinPruebas || sinIntentos || digitos.length < 10

  return (
    <section className="space-y-2.5 rounded-lg border p-3.5" aria-labelledby="me-prueba">
      <h3 id="me-prueba" className="flex items-center gap-2 text-sm font-medium">
        <Send className="size-4 text-muted-foreground" />
        Enviarme una prueba
      </h3>
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault()
          if (!deshabilitado) onEnviar()
        }}
      >
        <Label htmlFor="me-telefono" className="text-xs">Tu WhatsApp</Label>
        <div className="flex gap-2">
          <Input
            id="me-telefono"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="351 555 1234"
            value={telefono}
            onChange={e => onTelefono(e.target.value.slice(0, 30))}
            disabled={!puede || enviando}
            className="h-11"
          />
          <Button type="submit" disabled={deshabilitado} className="h-11 shrink-0">
            {enviando ? <Loader2 className="animate-spin" /> : <Send />}
            Enviar
          </Button>
        </div>
      </form>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {noListo
          ? noListo
          : sinPruebas
            ? `Ya salieron ${LIMITE_PRUEBAS_DIA} pruebas hoy. Mañana podés mandar más.`
            : sinIntentos
              ? `Ya se intentaron ${LIMITE_INTENTOS_DIA} pruebas hoy. Revisá por qué no salen antes de seguir probando.`
              : `Te llega en menos de un minuto, igual que a un cliente. Tiene que ser el número de una ficha de cliente (no creamos fichas nuevas). Hasta ${LIMITE_PRUEBAS_DIA} por día; las que no salen no cuentan (hoy: ${panel.pruebas_hoy}).`}
      </p>

      {prueba && (
        <div aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2 text-xs">
          {prueba.envio === 'sent' ? (
            <p className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              Meta la aceptó. Tocá un botón en tu WhatsApp: te tiene que llegar la respuesta de prueba. Si en un par de
              minutos no te llega el aviso, Meta no lo entregó.
            </p>
          ) : prueba.envio === 'failed' || prueba.envio === 'cancelled' || prueba.estado === 'fallida' ? (
            <p className="flex items-start gap-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              No salió{prueba.error ? `: ${prueba.error}` : '.'}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              {siguiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Hourglass className="size-3.5" />}
              {siguiendo ? 'En cola: sale en menos de un minuto…' : 'Todavía en cola. Si en unos minutos no llega, revisá «Últimas ofertas».'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Mig 222: quién no recibe estos avisos, y alta/baja a mano (settings.manage). */
function SeccionBajas({
  panel,
  puede,
  ahoraMs,
  telefono,
  onTelefono,
  dando,
  onDarDeBaja,
  habilitando,
  onHabilitar,
}: {
  panel: PanelMenorEspera
  puede: boolean
  ahoraMs: number
  telefono: string
  onTelefono: (v: string) => void
  dando: boolean
  onDarDeBaja: () => void
  habilitando: string | null
  onHabilitar: (b: BajaPanel) => void
}) {
  const lista = panel.bajas_lista
  const digitos = telefono.replace(/\D/g, '')

  return (
    <section className="space-y-2.5 rounded-lg border p-3.5" aria-labelledby="me-bajas">
      <h3 id="me-bajas" className="flex items-center gap-2 text-sm font-medium">
        <UserX className="size-4 text-muted-foreground" />
        No reciben estos avisos
        {panel.bajas > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">({panel.bajas})</span>}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Quien contesta «baja», «stop» o «no me escriban» queda acá solo, y vale para todas sus fichas con ese número. Si lo
        pide de otra forma, dalo de baja a mano.
      </p>

      {puede && (
        <form
          className="space-y-2"
          onSubmit={e => {
            e.preventDefault()
            if (!dando && digitos.length >= 10) onDarDeBaja()
          }}
        >
          <Label htmlFor="me-baja-telefono" className="text-xs">WhatsApp del cliente</Label>
          <div className="flex gap-2">
            <Input
              id="me-baja-telefono"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="351 555 1234"
              value={telefono}
              onChange={e => onTelefono(e.target.value.slice(0, 30))}
              disabled={dando}
              className="h-11"
            />
            <Button type="submit" variant="outline" disabled={dando || digitos.length < 10} className="h-11 shrink-0">
              {dando ? <Loader2 className="animate-spin" /> : <UserX />}
              Dar de baja
            </Button>
          </div>
        </form>
      )}

      {lista.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Nadie pidió la baja todavía.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {lista.map(b => (
            <li key={b.client_id} className="space-y-1.5 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {b.cliente ?? 'Cliente'}
                  {b.telefono_final && (
                    <span className="text-xs text-muted-foreground"> · termina en {b.telefono_final}</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={b.mensaje ?? undefined}>
                  {hace(b.creada_at, ahoraMs)}
                  {b.mensaje ? ` · «${b.mensaje}»` : ''}
                </p>
              </div>
              {puede && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onHabilitar(b)}
                  disabled={habilitando !== null}
                  className="-ml-2 h-8"
                >
                  {habilitando === b.client_id ? <Loader2 className="animate-spin" /> : <UserCheck />}
                  Volver a habilitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {panel.bajas > lista.length && (
        <p className="text-[11px] text-muted-foreground">
          Se muestran las {lista.length} más recientes de {panel.bajas}.
        </p>
      )}
    </section>
  )
}

function ComoDecide({ minutos, botones }: { minutos: number; botones?: string[] }) {
  const [si] = botones && botones.length >= 2 ? botones : PLANTILLA_POR_DEFECTO.botones
  return (
    <details className="group rounded-lg border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Info className="size-4 text-muted-foreground" />
          Cómo decide a quién escribirle
        </span>
        <ChevronDown className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200 group-open:rotate-180" />
      </summary>
      <ul className="space-y-1.5 border-t px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        <li>Espera a un barbero puntual hace más de {minutos} min. Nunca a turnos, descansos ni a quien ya está en Menor espera.</li>
        <li>
          En ese momento hay un barbero libre en su sucursal: fichado, sin cliente ni descanso, sin clientes propios
          esperando, que no está por terminar su turno ni tiene un turno cerca, y que atendió o fichó en la última hora.
        </li>
        <li>Hay lugar: se descuentan los que ya esperan en Menor espera y los avisos que todavía no contestaron.</li>
        <li>Una sola vez por visita y sólo en el horario de la sucursal.</li>
        <li>
          Nunca a clientes sin WhatsApp, a quien pidió la baja (en cualquiera de sus fichas con ese número), a quien dijo
          que no dos veces en 90 días ni a quien no contestó 3 avisos en 60 días.
        </li>
        <li>
          Nunca a quien tiene detrás un descanso de su barbero: si se pasara al pool, el barbero podría irse al descanso
          antes de atenderlo.
        </li>
        <li>
          Si toca «{si}», pasa a Menor espera sin perder su lugar: su barbero lo sigue viendo y además lo puede tomar el
          primero que se libere. Sólo lo movemos si el mensaje trae la firma de Meta verificada.
        </li>
        <li>Si contesta otra cosa, le avisamos a la recepción en Mensajería → Alertas (no le llega la Bienvenida).</li>
        <li>
          Si tres avisos seguidos no salen, o salen y después no entra ningún mensaje de Meta, se pausan solos y te
          dejamos una alerta.
        </li>
      </ul>
    </details>
  )
}
