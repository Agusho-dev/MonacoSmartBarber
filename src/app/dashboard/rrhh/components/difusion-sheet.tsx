'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Loader2, Send, RefreshCw, Plus, Check, Instagram, AlertTriangle,
  Megaphone, ChevronRight, ChevronLeft,
} from 'lucide-react'
import {
  crearDifusionRrhh, enviarLoteDifusion, getPlantillasRrhh,
  crearPlantillaRrhh, reintentarFallidos, previsualizarDifusion,
  type PreviaDifusion,
} from '@/lib/actions/rrhh'
import type { MetricasRrhh, PlantillaRrhh } from '@/lib/types/rrhh'
import { IconoWhatsApp } from './piezas'

const PRESETS = [
  {
    id: 'reabrir',
    titulo: 'Volver a abrir la búsqueda',
    cuerpo:
      'Hola! Te escribimos de Monaco Barber Studio. Nos habías dejado tu mensaje para sumarte al equipo y estamos abriendo una búsqueda de barberos.\n\nSi seguís interesado, respondé este mensaje y coordinamos una prueba.\n\nSi no querés recibir más mensajes, respondé BAJA.',
  },
  {
    id: 'prueba',
    titulo: 'Invitar a una prueba',
    cuerpo:
      'Hola! Somos Monaco Barber Studio. Vimos tus trabajos y nos gustaría conocerte.\n\nEstamos haciendo pruebas en el local esta semana. Si te interesa, respondé este mensaje y te pasamos día y horario.\n\nSi no querés recibir más mensajes, respondé BAJA.',
  },
  {
    id: 'archivo',
    titulo: 'Agradecer y quedar en contacto',
    cuerpo:
      'Hola! Gracias por escribirnos para trabajar en Monaco Barber Studio.\n\nPor ahora no tenemos un puesto abierto, pero guardamos tu contacto y te avisamos apenas se libere uno.\n\nSi no querés recibir más mensajes, respondé BAJA.',
  },
]

type Paso = 'plantilla' | 'audiencia' | 'enviando'

export function DifusionSheet({
  abierto, onCerrar, plantillas: plantillasIniciales, metricas, seleccion, onListo,
}: {
  abierto: boolean
  onCerrar: () => void
  plantillas: PlantillaRrhh[]
  metricas: MetricasRrhh | null
  /** Conversaciones elegidas a mano. Vacío = todos los candidatos alcanzables. */
  seleccion: string[]
  onListo: () => void
}) {
  const [paso, setPaso] = useState<Paso>('plantilla')
  const [plantillas, setPlantillas] = useState(plantillasIniciales)
  const [elegida, setElegida] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [textoIg, setTextoIg] = useState('')
  const [mandarIg, setMandarIg] = useState(true)
  const [omitirContactados, setOmitirContactados] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)

  // Creación de plantilla en Meta
  const [creando, setCreando] = useState(false)
  const [modoCrear, setModoCrear] = useState(false)
  const [nombrePlantilla, setNombrePlantilla] = useState('monaco_busqueda_barberos')
  const [cuerpoPlantilla, setCuerpoPlantilla] = useState(PRESETS[0].cuerpo)

  // Envío
  const [difusionId, setDifusionId] = useState<string | null>(null)
  const [progreso, setProgreso] = useState({ enviados: 0, fallidos: 0, pendientes: 0, omitidos: 0, total: 0 })
  const [errores, setErrores] = useState<Array<{ nombre: string; motivo: string }>>([])
  const [enviando, setEnviando] = useState(false)
  const [terminado, setTerminado] = useState(false)
  const abortar = useRef(false)

  useEffect(() => { setPlantillas(plantillasIniciales) }, [plantillasIniciales])

  useEffect(() => {
    if (!abierto) return
    setPaso('plantilla')
    setDifusionId(null)
    setTerminado(false)
    setErrores([])
    setProgreso({ enviados: 0, fallidos: 0, pendientes: 0, omitidos: 0, total: 0 })
    setCreando(false)
    setModoCrear(false)
    setEnviando(false)
    abortar.current = false
    if (!nombre) {
      const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' })
      setNombre(`Búsqueda de barberos · ${hoy}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const aprobadas = plantillas.filter(p => p.status === 'approved')
  const usables = aprobadas.filter(p => p.variables === 0)
  const enRevision = plantillas.filter(p => p.status === 'pending' || p.status === 'in_appeal')

  // La audiencia se muestra ANTES de mandar, con el motivo de cada exclusión.
  // La calcula el SERVIDOR sobre todos los candidatos y con la misma función que
  // arma la lista real: contarla acá sobre la página cargada mostraría 48 y
  // mandaría 206.
  const [previa, setPrevia] = useState<PreviaDifusion>({ whatsapp: 0, instagram: 0, omitidos: {}, total: 0 })
  const [calculandoPrevia, setCalculandoPrevia] = useState(false)
  const previaSeq = useRef(0)

  useEffect(() => {
    if (!abierto || paso !== 'audiencia') return
    const mio = ++previaSeq.current
    setCalculandoPrevia(true)
    const t = setTimeout(async () => {
      const r = await previsualizarDifusion({
        conversationIds: seleccion.length > 0 ? seleccion : undefined,
        mandaInstagram: mandarIg && !!textoIg.trim(),
        omitirYaContactados: omitirContactados,
      })
      if (mio !== previaSeq.current) return
      setPrevia(r)
      setCalculandoPrevia(false)
      if (r.error) toast.error(r.error)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, paso, mandarIg, textoIg, omitirContactados, seleccion.length])

  const alcanzables = previa.whatsapp + previa.instagram

  async function sincronizar() {
    setSincronizando(true)
    const r = await getPlantillasRrhh(true)
    setSincronizando(false)
    if (r.error) { toast.error(r.error); return }
    setPlantillas(r.data)
    const aprob = r.data.filter(p => p.status === 'approved' && p.variables === 0)
    toast.success(aprob.length > 0 ? `${aprob.length} plantilla(s) lista(s) para usar` : 'Todavía ninguna aprobada')
  }

  async function crearPlantilla() {
    setCreando(true)
    try {
      const r = await crearPlantillaRrhh({ nombre: nombrePlantilla, cuerpo: cuerpoPlantilla, footer: 'Monaco Barber Studio' })
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success('Plantilla enviada a Meta. Suele aprobarse en minutos.')
      setModoCrear(false)
      await sincronizar()
    } catch (e) {
      toast.error('No pudimos contactar a Meta: ' + (e as Error).message)
    } finally {
      setCreando(false)
    }
  }

  async function crearYEmpezar() {
    if (!elegida) return
    setEnviando(true)
    let id: string | null = null
    try {
      const r = await crearDifusionRrhh({
        nombre: nombre.trim(),
        templateName: elegida,
        textoInstagram: mandarIg ? textoIg.trim() || undefined : undefined,
        conversationIds: seleccion.length > 0 ? seleccion : undefined,
        omitirYaContactados: omitirContactados,
      })
      if (r.error || !r.id) { toast.error(r.error ?? 'No se pudo crear la difusión'); return }
      id = r.id
      setDifusionId(r.id)
      setPaso('enviando')
    } catch (e) {
      toast.error('No pudimos crear la difusión: ' + (e as Error).message)
    } finally {
      // Sin este finally, un rechazo dejaba `enviando` en true PARA SIEMPRE — y
      // como el sheet sólo se cierra si `!enviando`, la X, el Escape y el click
      // afuera quedaban muertos: había que recargar la página.
      setEnviando(false)
    }
    if (id) await correr(id)
  }

  async function correr(id: string) {
    setEnviando(true)
    abortar.current = false
    try {
      // Bucle de lotes: cada request es corta, así el progreso es real y ninguna
      // llamada se acerca al límite de tiempo de un server action.
      let previoProcesados = -1
      for (let i = 0; i < 400; i++) {
        if (abortar.current) break
        const r = await enviarLoteDifusion(id, 8)
        if (r.error) { toast.error(r.error); break }
        setProgreso({ enviados: r.enviados, fallidos: r.fallidos, pendientes: r.pendientes, omitidos: r.omitidos, total: r.total })
        if (r.errores.length > 0) setErrores(prev => [...prev, ...r.errores].slice(0, 40))
        if (r.terminado) { setTerminado(true); break }

        // Si un lote no movió la aguja es que no queda nada reclamable ahora
        // mismo (quedaron filas tomadas por otra pestaña, que el claim rescata
        // recién a los 5 minutos). Cortar: seguir es girar contra la pared.
        const procesados = r.enviados + r.fallidos
        if (procesados === previoProcesados) {
          toast.info('Quedan mensajes tomados por otro envío. Volvé a abrir la difusión en unos minutos para terminarla.')
          break
        }
        previoProcesados = procesados
      }
    } finally {
      setEnviando(false)
      onListo()
    }
  }

  async function reintentar() {
    if (!difusionId) return
    const r = await reintentarFallidos(difusionId)
    if (r?.error) { toast.error(r.error); return }
    setErrores([])
    setTerminado(false)
    await correr(difusionId)
  }

  // El denominador son los que SE MANDAN, no todos los destinatarios: `total`
  // incluye a los omitidos (equipo, descartados, sin alcance) y con ellos adentro
  // una difusión completa mostraba la barra en 59 %.
  const aMandar = Math.max(progreso.total - progreso.omitidos, 0)
  const pct = aMandar > 0
    ? Math.round(((progreso.enviados + progreso.fallidos) / aMandar) * 100)
    : (terminado ? 100 : 0)

  return (
    <Sheet open={abierto} onOpenChange={(o) => { if (!o && !enviando) onCerrar() }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:!max-w-xl">
        <SheetHeader className="border-b border-white/[0.06] px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4 text-muted-foreground" />
            Mandar difusión
          </SheetTitle>
          <SheetDescription className="text-xs">
            {seleccion.length > 0
              ? `${seleccion.length} candidato${seleccion.length === 1 ? '' : 's'} elegido${seleccion.length === 1 ? '' : 's'} a mano.`
              : 'A todos los candidatos que se puedan contactar.'}
          </SheetDescription>
        </SheetHeader>

        {/* ── Paso 1: plantilla ──────────────────────────────────────────────── */}
        {paso === 'plantilla' && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-xs leading-relaxed text-muted-foreground">
              <IconoWhatsApp className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <p>
                Nadie escribió en las últimas 24 h, así que WhatsApp sólo deja mandar una{' '}
                <span className="font-medium text-foreground">plantilla aprobada por Meta</span>. Elegí una o creá la tuya acá abajo.
              </p>
            </div>

            {!modoCrear && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plantillas aprobadas</p>
                  <Button variant="ghost" size="sm" onClick={sincronizar} disabled={sincronizando}>
                    {sincronizando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Actualizar
                  </Button>
                </div>

                {usables.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
                    <Megaphone className="size-7 text-muted-foreground" />
                    <p className="max-w-xs text-sm text-muted-foreground">
                      No tenés ninguna plantilla aprobada para hablarle a candidatos. Las que hay son de turnos y reseñas.
                    </p>
                    <Button onClick={() => setModoCrear(true)}>
                      <Plus className="size-4" /> Crear la plantilla
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {usables.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setElegida(p.name)}
                        className={cn(
                          'w-full rounded-xl border p-3 text-left transition-colors',
                          elegida === p.name
                            ? 'border-white/40 bg-white/[0.06]'
                            : 'border-white/[0.08] hover:border-white/20',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold">{p.name}</span>
                          <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {p.language}
                          </span>
                          {elegida === p.name && <Check className="ml-auto size-4 shrink-0" />}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                          {p.cuerpo}
                        </p>
                      </button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => setModoCrear(true)} className="w-full">
                      <Plus className="size-4" /> Crear otra plantilla
                    </Button>
                  </div>
                )}

                {enRevision.length > 0 && (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/80">
                    {enRevision.length === 1 ? 'Hay 1 plantilla' : `Hay ${enRevision.length} plantillas`} esperando la aprobación de Meta
                    ({enRevision.map(p => p.name).join(', ')}). Tocá <span className="font-medium">Actualizar</span> en unos minutos.
                  </p>
                )}
              </>
            )}

            {modoCrear && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nombre interno</Label>
                  <Input
                    value={nombrePlantilla}
                    onChange={e => setNombrePlantilla(e.target.value)}
                    className="text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">Sólo minúsculas y guiones bajos. No lo ve el candidato.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Mensaje</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setCuerpoPlantilla(p.cuerpo)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                          cuerpoPlantilla === p.cuerpo
                            ? 'border-white/40 bg-white/[0.08]'
                            : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground',
                        )}
                      >
                        {p.titulo}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={cuerpoPlantilla}
                    onChange={e => setCuerpoPlantilla(e.target.value)}
                    rows={9}
                    className="text-sm"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Sin variables: una de más o de menos hace que Meta rechace el mensaje entero.
                    Meta pide que un mensaje de marketing diga cómo darse de baja — por eso los textos sugeridos terminan con “respondé BAJA”.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button onClick={crearPlantilla} disabled={creando}>
                    {creando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Mandar a aprobar
                  </Button>
                  <Button variant="ghost" onClick={() => setModoCrear(false)} disabled={creando}>Cancelar</Button>
                </div>
              </div>
            )}

            {!modoCrear && (
              <div className="flex justify-end border-t border-white/[0.06] pt-4">
                <Button disabled={!elegida} onClick={() => setPaso('audiencia')}>
                  Siguiente <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Paso 2: audiencia ──────────────────────────────────────────────── */}
        {paso === 'audiencia' && (
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre de la difusión</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} className="text-sm" />
            </div>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">A quién le llega</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                    <IconoWhatsApp className="size-3" /> WhatsApp
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{previa.whatsapp}</p>
                  <p className="text-[11px] text-muted-foreground">con la plantilla</p>
                </div>
                <div className={cn('rounded-xl border p-3', previa.instagram > 0 ? 'border-pink-500/25 bg-pink-500/[0.07]' : 'border-white/[0.06] bg-zinc-900/40')}>
                  <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-pink-300">
                    <Instagram className="size-3" /> Instagram
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{previa.instagram}</p>
                  <p className="text-[11px] text-muted-foreground">con ventana abierta</p>
                </div>
              </div>

              {Object.keys(previa.omitidos).length > 0 && (
                <div className="space-y-1 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
                  <p className="text-[11px] font-medium text-muted-foreground">No les llega</p>
                  <ul className="space-y-0.5">
                    {Object.entries(previa.omitidos).sort((a, b) => b[1] - a[1]).map(([motivo, n]) => (
                      <li key={motivo} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                        <span className="text-muted-foreground">{motivo}</span>
                        <span className="tabular-nums">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Instagram className="size-3.5 text-pink-400" /> Mandar también por Instagram
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    Meta no tiene plantillas en Instagram: sólo llega a quien escribió en las últimas 24 h
                    {metricas ? ` (hoy ${metricas.alcanzables_ig} de ${metricas.instagram})` : ''}.
                  </p>
                </div>
                <Switch checked={mandarIg} onCheckedChange={setMandarIg} />
              </div>
              {mandarIg && (
                <Textarea
                  value={textoIg}
                  onChange={e => setTextoIg(e.target.value)}
                  rows={4}
                  placeholder="Hola! Te escribimos de Monaco. Estamos buscando barberos…"
                  className="text-sm"
                />
              )}
            </section>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Saltear a los que ya contacté</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  No les vuelve a llegar a quienes ya recibieron una difusión o un mensaje desde acá.
                </p>
              </div>
              <Switch checked={omitirContactados} onCheckedChange={setOmitirContactados} />
            </div>

            {alcanzables === 0 && !calculandoPrevia && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                <p className="text-xs leading-relaxed text-red-200">
                  Con estos filtros no le llega a nadie. Revisá la selección o desactivá “saltear a los que ya contacté”.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
              <Button variant="ghost" onClick={() => setPaso('plantilla')}>
                <ChevronLeft className="size-4" /> Atrás
              </Button>
              <Button disabled={alcanzables === 0 || enviando || calculandoPrevia || !nombre.trim()} onClick={crearYEmpezar}>
                {enviando || calculandoPrevia ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Enviar a {alcanzables}
              </Button>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              Se manda ahora mismo, uno por uno. Podés cerrar esta pantalla cuando termine.
            </p>
          </div>
        )}

        {/* ── Paso 3: envío ──────────────────────────────────────────────────── */}
        {paso === 'enviando' && (
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">
                  {terminado ? 'Difusión terminada' : enviando ? 'Enviando…' : 'Envío pausado'}
                </p>
                <span className="text-sm font-bold tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundImage: 'linear-gradient(90deg,#10b981,#34d399)',
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-emerald-400">Enviados: <b className="tabular-nums">{progreso.enviados}</b></span>
                {progreso.fallidos > 0 && <span className="text-red-400">Fallidos: <b className="tabular-nums">{progreso.fallidos}</b></span>}
                <span className="text-muted-foreground">Pendientes: <b className="tabular-nums">{progreso.pendientes}</b></span>
              </div>
            </div>

            {errores.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-red-500/25 bg-red-500/[0.05] p-3">
                <p className="text-xs font-semibold text-red-200">No se pudo enviar a {errores.length}</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {errores.map((e, i) => (
                    <li key={i} className="text-[11px] leading-relaxed">
                      <span className="font-medium">{e.nombre}</span>
                      <span className="text-red-200/70"> — {e.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {enviando && (
                <Button variant="outline" onClick={() => { abortar.current = true }}>
                  Pausar
                </Button>
              )}
              {!enviando && !terminado && difusionId && (
                <Button onClick={() => correr(difusionId)}>
                  <Send className="size-4" /> Seguir enviando
                </Button>
              )}
              {!enviando && progreso.fallidos > 0 && (
                <Button variant="outline" onClick={reintentar}>
                  <RefreshCw className="size-4" /> Reintentar los {progreso.fallidos} fallidos
                </Button>
              )}
              {!enviando && (
                <Button variant="ghost" className="ml-auto" onClick={onCerrar}>Cerrar</Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
