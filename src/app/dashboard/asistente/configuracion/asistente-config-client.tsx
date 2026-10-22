'use client'

// =============================================================================
// Configurar Tex. Lo ve sólo quien puede configurarlo (dueño/admin o
// settings.manage: el gate está en la página y en cada action).
//
// Cómo se guarda cada cosa:
//   - Interruptores y opciones (profundidad, acceso a datos, Modo Pro): al
//     tocarlos, con el cambio optimista y vuelta atrás si el servidor dice que no.
//   - Textos (personalidad, instrucciones): con su botón "Guardar".
//   - Claves: con su botón; la de Anthropic se valida contra la API antes de
//     guardarse (cifrada). Nunca vuelven al navegador.
//   - Animaciones: por navegador (localStorage), al instante.
// Sin selector de modelo ni de temperatura: Tex corre en Claude Haiku 5.5 y
// desde el 21/10/2026 mandar temperature es un 400.
// =============================================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarClaveOpenAITex,
  guardarClaveTex,
  guardarConfigTex,
  obtenerConfigTex,
  quitarClaveTex,
} from '@/lib/actions/tex'
import { getKnowledgeStats, reindexKnowledge } from '@/lib/actions/asistente'
import type { RagStats } from '@/lib/asistente/rag'
import {
  TEX_DOMINIOS,
  TEX_ESFUERZOS,
  TEX_MAX_INSTRUCCIONES,
  TEX_MAX_PERSONA,
  TEX_MODELO_ETIQUETA,
  type TexConfigVista,
  type TexEsfuerzo,
  type TexOrigenClave,
} from '@/lib/tex/contrato'
import { esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
import { TexPose } from '@/components/tex/tex-pose'
import { guardarTexAnimacion, useTexAnimacion, useTexAnimacionPreferida } from '@/components/tex/use-tex-animacion'
import { TEX_TZ } from '@/components/tex/chat/logica'
import { useEnCliente } from '@/components/tex/chat/hooks'
import { PERSONA_PRESETS } from './components/personas'
import { CampoClave, ChipEstado, Seccion, type TonoEstado } from './components/piezas'
import {
  cambioDeDominio,
  cambioDeEsfuerzo,
  cambioDeModoPro,
  conLoGuardado,
  crearSincronizadorConfig,
  type CambioConfig,
} from './cambios'

type ResultadoConfig = Awaited<ReturnType<typeof obtenerConfigTex>>

/**
 * El estado de la base de conocimiento: null o con `error` = no se pudo leer
 * (no es lo mismo que "vacía": decir "vacía" ante un error empujaba a
 * reindexar una base que tenía miles de fragmentos).
 */
export type EstadoConocimiento = RagStats | null

interface Props {
  resultado: ResultadoConfig
  conocimientoInicial: EstadoConocimiento
}

const NUMERO = new Intl.NumberFormat('es-AR')
const DOLARES = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TEX_TZ,
})
const SENSIBLES = new Set(['salarios', 'conciliacion'])

function errorDe(e: unknown, porDefecto: string): string {
  if (esErrorDeVersion(e)) return TEXTO_RECARGA_MANUAL
  return porDefecto
}

function costoLegible(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'US$ 0,00'
  if (usd < 0.01) return 'menos de US$ 0,01'
  return `≈ US$ ${DOLARES.format(usd)}`
}

const ESTADO_CLAVE: Record<TexOrigenClave | 'ninguna', { texto: string; tono: TonoEstado }> = {
  org: { texto: 'Conectada desde la configuración', tono: 'ok' },
  entorno: { texto: 'Conectada desde el servidor', tono: 'ok' },
  legado: { texto: 'Guardada con el formato anterior', tono: 'revisar' },
  ninguna: { texto: 'Sin clave', tono: 'revisar' },
}

export function AsistenteConfigClient({ resultado, conocimientoInicial }: Props) {
  const [estado, setEstado] = useState(resultado)
  const [reintentando, iniciarReintento] = useTransition()

  function reintentar() {
    iniciarReintento(async () => {
      try {
        setEstado(await obtenerConfigTex())
      } catch (e) {
        toast.error(errorDe(e, 'No pude leer la configuración. Probá de nuevo.'))
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8 lg:space-y-6">
      <header className="space-y-4">
        <Link
          href="/dashboard/asistente"
          className="inline-flex h-9 items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver a Tex
        </Link>
        <div className="flex items-center gap-4">
          <TexPose pose="analiza" alto={72} halo prioridad />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Configurar Tex</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Cómo piensa, qué datos puede leer y cuánto se usa.</p>
          </div>
        </div>
      </header>

      {estado.ok ? (
        <Formulario inicial={estado.config} puedeEditar={estado.puedeEditar} conocimientoInicial={conocimientoInicial} />
      ) : (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4 sm:p-5">
          <TexPose pose="ayuda" alto={56} />
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-sm text-foreground">No pude leer la configuración de Tex. {estado.error}</p>
            <Button variant="outline" size="sm" className="mt-3 h-9 gap-1.5" onClick={reintentar} disabled={reintentando}>
              {reintentando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              Reintentar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Formulario({
  inicial,
  puedeEditar,
  conocimientoInicial,
}: {
  inicial: TexConfigVista
  puedeEditar: boolean
  conocimientoInicial: EstadoConocimiento
}) {
  const [config, setConfig] = useState(inicial)

  // ── Guardado inmediato (interruptores y opciones) ─────────────────────────
  // Cada pedido manda sólo lo que cambió y, si falla, deshace sólo eso (ver
  // cambios.ts). Cuando terminan los pedidos en curso y alguno falló, se
  // vuelve a leer lo guardado: lo que se ve es lo que hay. Una lectura que se
  // cruzó con otro cambio no se muestra (no lo tiene): se lee de nuevo después.
  const [, iniciarCampo] = useTransition()
  const [sincronizador] = useState(crearSincronizadorConfig)

  async function resincronizar() {
    try {
      const r = await obtenerConfigTex()
      if (r.ok) {
        if (sincronizador.puedeAplicar()) setConfig((c) => conLoGuardado(c, r.config))
        return
      }
    } catch {
      // Abajo: se avisa que no se pudo confirmar.
    }
    toast.error('No pude confirmar cómo quedó la configuración. Recargá la página para verla.')
  }

  function guardarCampo(cambio: CambioConfig, exito: string) {
    setConfig(cambio.optimista)
    sincronizador.empezar()
    iniciarCampo(async () => {
      let error: string | null = null
      try {
        const r = await guardarConfigTex(cambio.pedido)
        if (!r.ok) error = r.error || 'No pude guardar el cambio.'
      } catch (e) {
        error = errorDe(e, 'No pude guardar el cambio. Probá de nuevo.')
      }
      if (error) {
        setConfig(cambio.revertir)
        toast.error(error)
      } else {
        toast.success(exito)
      }
      if (sincronizador.terminar(error !== null)) await resincronizar()
    })
  }

  function cambiarEsfuerzo(esfuerzo: TexEsfuerzo) {
    if (esfuerzo === config.esfuerzo) return
    const etiqueta = TEX_ESFUERZOS.find((e) => e.id === esfuerzo)?.etiqueta ?? esfuerzo
    guardarCampo(cambioDeEsfuerzo(config.esfuerzo, esfuerzo), `Profundidad: ${etiqueta}.`)
  }

  function cambiarDominio(id: string, encendido: boolean) {
    const etiqueta = TEX_DOMINIOS.find((d) => d.id === id)?.etiqueta ?? id
    guardarCampo(cambioDeDominio(id, encendido), encendido ? `Tex ya puede leer ${etiqueta}.` : `Tex deja de leer ${etiqueta}.`)
  }

  function cambiarModoPro(modoPro: boolean) {
    guardarCampo(cambioDeModoPro(modoPro), modoPro ? 'Modo Pro prendido.' : 'Modo Pro apagado.')
  }

  // ── Uso del mes ───────────────────────────────────────────────────────────
  const [releyendoUso, iniciarRelecturaUso] = useTransition()
  function releerUso() {
    iniciarRelecturaUso(async () => {
      try {
        const r = await obtenerConfigTex()
        if (!r.ok) {
          toast.error(r.error || 'No pude leer el uso del mes.')
          return
        }
        setConfig((c) => ({ ...c, usoMes: r.config.usoMes, usoMesError: r.config.usoMesError }))
      } catch (e) {
        toast.error(errorDe(e, 'No pude leer el uso del mes. Probá de nuevo.'))
      }
    })
  }

  // ── Textos ────────────────────────────────────────────────────────────────
  const [persona, setPersona] = useState(inicial.persona ?? '')
  const [instrucciones, setInstrucciones] = useState(inicial.instrucciones ?? '')
  const [guardandoPersona, iniciarPersona] = useTransition()
  const [guardandoInstrucciones, iniciarInstrucciones] = useTransition()
  const personaCambio = persona.trim() !== (config.persona ?? '').trim()
  const instruccionesCambio = instrucciones.trim() !== (config.instrucciones ?? '').trim()

  function guardarTexto(campo: 'persona' | 'instrucciones') {
    const valor = (campo === 'persona' ? persona : instrucciones).trim() || null
    const iniciar = campo === 'persona' ? iniciarPersona : iniciarInstrucciones
    iniciar(async () => {
      try {
        const r = await guardarConfigTex(campo === 'persona' ? { persona: valor } : { instrucciones: valor })
        if (!r.ok) {
          toast.error(r.error || 'No pude guardar el texto.')
          return
        }
        setConfig((c) => (campo === 'persona' ? { ...c, persona: valor } : { ...c, instrucciones: valor }))
        toast.success(campo === 'persona' ? 'Personalidad guardada.' : 'Instrucciones guardadas.')
      } catch (e) {
        toast.error(errorDe(e, 'No pude guardar el texto. Probá de nuevo.'))
      }
    })
  }

  return (
    <>
      {!puedeEditar && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200">
          <Lock className="size-4 shrink-0" aria-hidden />
          Podés ver la configuración, pero no cambiarla.
        </p>
      )}

      <ClaveAnthropic config={config} setConfig={setConfig} puedeEditar={puedeEditar} />

      <Seccion
        id="profundidad"
        icono={Gauge}
        titulo="Profundidad"
        descripcion="Cuánto piensa Tex antes de responder. Más profundo tarda un poco más y cuesta un poco más."
      >
        <div role="radiogroup" aria-label="Profundidad de Tex" className="grid gap-2 sm:grid-cols-3">
          {TEX_ESFUERZOS.map((e) => {
            const activo = config.esfuerzo === e.id
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={activo}
                disabled={!puedeEditar}
                onClick={() => cambiarEsfuerzo(e.id)}
                className={cn(
                  'flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 disabled:pointer-events-none disabled:opacity-60',
                  activo ? 'border-[color:var(--tex)]/60 bg-[color:var(--tex)]/10' : 'border-border hover:border-white/20 hover:bg-white/[0.03]',
                )}
              >
                <span className={cn('text-sm font-semibold', activo && 'text-[color:var(--tex-texto)]')}>{e.etiqueta}</span>
                <span className="text-xs leading-snug text-muted-foreground">{e.detalle}</span>
              </button>
            )
          })}
        </div>
      </Seccion>

      <Seccion
        id="personalidad"
        icono={MessageSquareText}
        titulo="Personalidad"
        descripcion="Cómo te habla Tex. Elegí un punto de partida y ajustalo con tus palabras."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PERSONA_PRESETS.map((p) => {
            const Icono = p.icono
            const activo = persona.trim() === p.prompt
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={activo}
                disabled={!puedeEditar}
                onClick={() => setPersona(p.prompt)}
                className={cn(
                  'flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60 disabled:pointer-events-none disabled:opacity-60',
                  activo ? 'border-[color:var(--tex)]/60 bg-[color:var(--tex)]/10' : 'border-border hover:border-white/20 hover:bg-white/[0.03]',
                )}
              >
                <Icono className={cn('size-4', activo ? 'text-[color:var(--tex-texto)]' : 'text-muted-foreground')} aria-hidden />
                <span className="text-sm font-semibold">{p.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{p.description}</span>
              </button>
            )
          })}
        </div>
        <label htmlFor="tex-persona" className="mt-4 block text-sm font-medium">
          Tono y estilo
        </label>
        <Textarea
          id="tex-persona"
          rows={4}
          maxLength={TEX_MAX_PERSONA}
          value={persona}
          disabled={!puedeEditar}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="Por ejemplo: directo, con los números primero y sin vueltas."
          className="mt-1.5 text-base sm:text-sm"
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <ContadorTexto largo={persona.length} tope={TEX_MAX_PERSONA} />
          <Button onClick={() => guardarTexto('persona')} disabled={!puedeEditar || !personaCambio || guardandoPersona} className="h-10 gap-2">
            {guardandoPersona && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Guardar personalidad
          </Button>
        </div>
      </Seccion>

      <Seccion
        id="instrucciones"
        icono={Store}
        titulo="Instrucciones del negocio"
        descripcion="Lo que Tex tiene que saber siempre de tu barbería: cómo trabajan, qué les importa, cómo llaman a las cosas."
      >
        <Textarea
          id="tex-instrucciones"
          aria-label="Instrucciones del negocio"
          rows={4}
          maxLength={TEX_MAX_INSTRUCCIONES}
          value={instrucciones}
          disabled={!puedeEditar}
          onChange={(e) => setInstrucciones(e.target.value)}
          placeholder="Por ejemplo: la meta es 120 cortes por día entre las tres sucursales. Paraná abre los domingos."
          className="text-base sm:text-sm"
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <ContadorTexto largo={instrucciones.length} tope={TEX_MAX_INSTRUCCIONES} />
          <Button
            onClick={() => guardarTexto('instrucciones')}
            disabled={!puedeEditar || !instruccionesCambio || guardandoInstrucciones}
            className="h-10 gap-2"
          >
            {guardandoInstrucciones && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Guardar instrucciones
          </Button>
        </div>
      </Seccion>

      <Seccion
        id="acceso"
        icono={ShieldCheck}
        titulo="Acceso a datos"
        descripcion="Qué información del negocio puede leer Tex. Además, cada persona ve sólo lo que su rol le permite."
      >
        <ul className="divide-y divide-border/70">
          {TEX_DOMINIOS.map((d) => {
            // Ausente = encendido: igual que el servidor (un dominio nuevo arranca prendido).
            const encendido = config.accesoDatos[d.id] !== false
            return (
              <li key={d.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`tex-dominio-${d.id}`} className="cursor-pointer text-sm font-medium">
                      {d.etiqueta}
                    </label>
                    {SENSIBLES.has(d.id) && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-semibold text-amber-300">
                        Sensible
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{d.detalle}</p>
                </div>
                <Switch
                  id={`tex-dominio-${d.id}`}
                  checked={encendido}
                  disabled={!puedeEditar}
                  onCheckedChange={(v) => cambiarDominio(d.id, v)}
                  className="shrink-0"
                />
              </li>
            )
          })}
        </ul>
      </Seccion>

      <Seccion
        id="modo-pro"
        icono={Terminal}
        titulo="Modo Pro"
        descripcion="Tex puede hacer consultas de solo lectura a la base para preguntas que no cubren sus informes."
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{config.modoPro ? 'Prendido' : 'Apagado'}</p>
            <p className="text-xs text-muted-foreground">Sólo lee: no puede cambiar ni borrar nada. Sirve para preguntas fuera de lo común.</p>
            {!config.puedeModoPro && (
              <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-amber-300">
                <Lock className="size-3" aria-hidden />
                Sólo el dueño o un administrador puede prenderlo.
              </p>
            )}
          </div>
          <Switch
            checked={config.modoPro}
            disabled={!puedeEditar || !config.puedeModoPro}
            onCheckedChange={cambiarModoPro}
            aria-label="Modo Pro"
            className="mt-0.5 shrink-0"
          />
        </div>
      </Seccion>

      <BusquedaSemantica config={config} setConfig={setConfig} puedeEditar={puedeEditar} conocimientoInicial={conocimientoInicial} />

      <Seccion
        id="uso"
        icono={Activity}
        titulo="Uso del mes"
        descripcion={`Respuestas de Tex desde el 1 del mes. Funciona con ${TEX_MODELO_ETIQUETA}.`}
      >
        <UsoDelMes uso={config.usoMes} error={config.usoMesError ?? null} releyendo={releyendoUso} onReintentar={releerUso} />
      </Seccion>

      <Animaciones />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Clave de Anthropic
// ─────────────────────────────────────────────────────────────────────────────

function ClaveAnthropic({
  config,
  setConfig,
  puedeEditar,
}: {
  config: TexConfigVista
  setConfig: (fn: (c: TexConfigVista) => TexConfigVista) => void
  puedeEditar: boolean
}) {
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, iniciarGuardado] = useTransition()
  const [quitando, iniciarQuitado] = useTransition()
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)

  const estado = ESTADO_CLAVE[config.origenClave ?? 'ninguna']

  function guardar() {
    const valor = clave.trim()
    if (!valor) return
    setError(null)
    iniciarGuardado(async () => {
      try {
        const r = await guardarClaveTex(valor)
        if (!r.ok) {
          setError(r.error)
          return
        }
        setClave('')
        setConfig((c) => ({ ...c, tieneClave: true, origenClave: 'org' }))
        toast.success('Clave guardada. Tex ya puede responder.')
      } catch (e) {
        setError(errorDe(e, 'No pude guardar la clave. Probá de nuevo.'))
      }
    })
  }

  function quitar() {
    setConfirmarQuitar(false)
    iniciarQuitado(async () => {
      try {
        const r = await quitarClaveTex()
        if (!r.ok) {
          toast.error(r.error || 'No pude quitar la clave.')
          return
        }
        // Puede quedar la del servidor (o la vieja): se vuelve a leer en vez de suponer.
        const nueva = await obtenerConfigTex().catch(() => null)
        if (nueva?.ok) {
          setConfig((c) => ({ ...c, tieneClave: nueva.config.tieneClave, origenClave: nueva.config.origenClave }))
        } else {
          setConfig((c) => ({ ...c, tieneClave: false, origenClave: null }))
        }
        toast.success('Quitaste la clave.')
      } catch (e) {
        toast.error(errorDe(e, 'No pude quitar la clave. Probá de nuevo.'))
      }
    })
  }

  return (
    <Seccion
      id="clave"
      icono={KeyRound}
      titulo="Clave de Anthropic"
      extra={<ChipEstado tono={estado.tono}>{estado.texto}</ChipEstado>}
      descripcion={`Tex funciona con ${TEX_MODELO_ETIQUETA}. La clave se valida con Anthropic al guardarla, se guarda cifrada y no se vuelve a mostrar.`}
    >
      {config.origenClave === 'entorno' && (
        <p className="mb-3 text-xs text-muted-foreground">
          Hoy usa la clave del servidor. Si cargás una acá, Tex pasa a usar esta.
        </p>
      )}
      {config.origenClave === 'legado' && (
        <p className="mb-3 text-xs text-amber-300">Está guardada sin cifrar, como la dejaba el asistente anterior. Cargala de nuevo para que quede cifrada.</p>
      )}
      {config.origenClave === null && (
        <p className="mb-3 text-xs text-muted-foreground">
          Sin clave Tex no responde. La creás en console.anthropic.com, en API Keys, y la pegás acá.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <CampoClave
            id="tex-clave-anthropic"
            etiqueta="Clave de Anthropic"
            valor={clave}
            onCambio={(v) => {
              setClave(v)
              if (error) setError(null)
            }}
            placeholder={config.tieneClave ? 'Pegá una clave nueva para reemplazarla' : 'sk-ant-…'}
            deshabilitado={!puedeEditar || guardando}
            invalido={Boolean(error)}
          />
        </div>
        <Button onClick={guardar} disabled={!puedeEditar || !clave.trim() || guardando} className="h-11 gap-2">
          {guardando && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {guardando ? 'Validando…' : 'Validar y guardar'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {config.origenClave === 'org' && puedeEditar && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground hover:text-red-400"
            onClick={() => setConfirmarQuitar(true)}
            disabled={quitando}
          >
            {quitando && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Quitar la clave
          </Button>
        </div>
      )}

      <AlertDialog open={confirmarQuitar} onOpenChange={setConfirmarQuitar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la clave de Anthropic?</AlertDialogTitle>
            <AlertDialogDescription>
              Si no hay otra clave en el servidor, Tex deja de responder hasta que cargues una nueva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={quitar}>
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Seccion>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda semántica (clave de OpenAI + base de conocimiento)
// ─────────────────────────────────────────────────────────────────────────────

function BusquedaSemantica({
  config,
  setConfig,
  puedeEditar,
  conocimientoInicial,
}: {
  config: TexConfigVista
  setConfig: (fn: (c: TexConfigVista) => TexConfigVista) => void
  puedeEditar: boolean
  conocimientoInicial: EstadoConocimiento
}) {
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, iniciarGuardado] = useTransition()
  const [conocimiento, setConocimiento] = useState<EstadoConocimiento>(conocimientoInicial)
  const [reindexando, iniciarReindexado] = useTransition()
  const [releyendo, iniciarRelectura] = useTransition()
  const errorConocimiento = conocimiento === null ? 'No pude leer el estado de la base.' : conocimiento.error?.trim() || null

  /** Vuelve a leer el estado de la base. Una falla queda como "no pude leer", nunca como "vacía". */
  async function leerConocimiento() {
    try {
      setConocimiento(await getKnowledgeStats())
    } catch {
      setConocimiento(null)
    }
  }

  function releerConocimiento() {
    iniciarRelectura(leerConocimiento)
  }

  function guardar() {
    const valor = clave.trim()
    if (!valor) return
    setError(null)
    iniciarGuardado(async () => {
      try {
        const r = await guardarClaveOpenAITex(valor)
        if (!r.ok) {
          setError(r.error)
          return
        }
        setClave('')
        setConfig((c) => ({ ...c, tieneClaveOpenAI: true }))
        toast.success('Clave de OpenAI guardada.')
      } catch (e) {
        setError(errorDe(e, 'No pude guardar la clave. Probá de nuevo.'))
      }
    })
  }

  function reindexar() {
    iniciarReindexado(async () => {
      try {
        const r = await reindexKnowledge()
        if (r.error) {
          toast.error(r.error)
          return
        }
        toast.success(
          `Listo: ${NUMERO.format(r.documents)} documento${r.documents === 1 ? '' : 's'}.` +
            (r.embedded !== undefined ? ` ${NUMERO.format(r.embedded)} ya se pueden buscar; el resto se procesa solo en unos minutos.` : ''),
        )
      } catch (e) {
        toast.error(errorDe(e, 'No pude reindexar. Probá de nuevo.'))
        return
      }
      // Aparte: que no se pueda leer el estado no quiere decir que la reindexación falló.
      await leerConocimiento()
    })
  }

  return (
    <Seccion
      id="busqueda"
      icono={BookOpen}
      titulo="Búsqueda semántica"
      extra={
        <ChipEstado tono={config.tieneClaveOpenAI ? 'ok' : 'revisar'}>
          {config.tieneClaveOpenAI ? 'Clave de OpenAI conectada' : 'Sin clave de OpenAI'}
        </ChipEstado>
      }
      descripcion="Tex busca en lo que escriben los clientes por WhatsApp e Instagram. Para eso usa una clave de OpenAI: sólo para buscar, no para responder."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <CampoClave
            id="tex-clave-openai"
            etiqueta="Clave de OpenAI"
            valor={clave}
            onCambio={(v) => {
              setClave(v)
              if (error) setError(null)
            }}
            placeholder={config.tieneClaveOpenAI ? 'Pegá una clave nueva para reemplazarla' : 'sk-…'}
            deshabilitado={!puedeEditar || guardando}
            invalido={Boolean(error)}
          />
        </div>
        <Button variant="outline" onClick={guardar} disabled={!puedeEditar || !clave.trim() || guardando} className="h-11 gap-2">
          {guardando && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Guardar clave
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mt-5 rounded-xl border bg-white/[0.02] p-3.5">
        <p className="text-sm font-medium">Base de conocimiento</p>
        {conocimiento === null || errorConocimiento ? (
          // Un error de lectura nunca se muestra como "Está vacía".
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" role="alert">
            <p className="flex items-start gap-1.5 text-sm text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {errorConocimiento}
            </p>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" onClick={releerConocimiento} disabled={releyendo}>
              {releyendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              Volver a leer
            </Button>
          </div>
        ) : conocimiento.documents === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Está vacía: Tex no puede buscar en lo que dicen los clientes hasta que la reindexes.
          </p>
        ) : (
          <div className="mt-1 space-y-0.5 text-sm">
            <p className="tabular-nums text-foreground/90">
              {NUMERO.format(conocimiento.documents)} documentos · {NUMERO.format(conocimiento.chunks)} fragmentos ·{' '}
              {NUMERO.format(conocimiento.embedded)} listos para buscar
              {conocimiento.pending > 0 && ` · ${NUMERO.format(conocimiento.pending)} pendientes`}
            </p>
            {conocimiento.lastIndexedAt && (
              <p className="text-xs text-muted-foreground">Última indexación: {FECHA.format(new Date(conocimiento.lastIndexedAt))}</p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={reindexar}
            disabled={!puedeEditar || !config.puedeModoPro || reindexando}
          >
            {reindexando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            {reindexando ? 'Reindexando…' : 'Reindexar'}
          </Button>
          {!config.puedeModoPro && <span className="text-xs text-muted-foreground">Sólo el dueño o un administrador puede reindexar.</span>}
          {config.puedeModoPro && !config.tieneClaveOpenAI && (
            <span className="text-xs text-amber-300">Sin clave de OpenAI no se puede buscar.</span>
          )}
        </div>
      </div>
    </Seccion>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Uso del mes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Con `error` (no se pudo leer el uso) no se dibuja ni un cero: el servidor
 * manda el uso en ceros y el aviso aparte (Known Risk #15). "US$ 0,00" ahí
 * hacía creer que Tex no había gastado nada en el mes.
 */
function UsoDelMes({
  uso,
  error,
  releyendo,
  onReintentar,
}: {
  uso: TexConfigVista['usoMes']
  error: string | null
  releyendo: boolean
  onReintentar: () => void
}) {
  const tokens = uso.entrada + uso.salida + uso.cacheLeido + uso.cacheEscrito
  const cache = uso.cacheLeido + uso.cacheEscrito
  const cifra = (texto: string) => (error ? '—' : texto)
  return (
    <div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border bg-white/[0.02] p-3">
          <dt className="text-xs text-muted-foreground">Respuestas</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{cifra(NUMERO.format(uso.respuestas))}</dd>
        </div>
        <div className="rounded-xl border bg-white/[0.02] p-3">
          <dt className="text-xs text-muted-foreground">Tokens</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{cifra(NUMERO.format(tokens))}</dd>
        </div>
        <div className="rounded-xl border bg-white/[0.02] p-3">
          <dt className="text-xs text-muted-foreground">Costo estimado</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{cifra(costoLegible(uso.costoUsd))}</dd>
        </div>
      </dl>
      {error ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5"
        >
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
            <span>{error} Las cifras quedan en blanco hasta poder leerlas.</span>
          </p>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onReintentar} disabled={releyendo}>
            {releyendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            Reintentar
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Entrada {NUMERO.format(uso.entrada)} · salida {NUMERO.format(uso.salida)} · caché {NUMERO.format(cache)}. Es una estimación con el
          precio de lista: el total exacto está en tu cuenta de Anthropic.
        </p>
      )}
    </div>
  )
}

/** "1.850/2.000": aparece desde el 90 % del tope, como el del composer. */
function ContadorTexto({ largo, tope }: { largo: number; tope: number }) {
  if (largo < tope * 0.9) return null
  return (
    <span className={cn('text-xs tabular-nums', largo >= tope ? 'text-red-400' : 'text-amber-300')} aria-live="polite">
      {NUMERO.format(largo)}/{NUMERO.format(tope)}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Animaciones de Tex (por navegador)
// ─────────────────────────────────────────────────────────────────────────────

function Animaciones() {
  const preferida = useTexAnimacionPreferida()
  const efectiva = useTexAnimacion()
  // En el servidor los dos hooks dan valores distintos ('completa' / 'quieta'):
  // sin esto la nota de abajo saldría en el HTML y se borraría al hidratar.
  const enCliente = useEnCliente()
  return (
    <Seccion
      id="animaciones"
      icono={Sparkles}
      titulo="Animaciones de Tex"
      descripcion="Si la cara de Tex parpadea y habla, o queda quieta. Se guarda en este navegador."
    >
      <div role="radiogroup" aria-label="Animaciones de Tex" className="inline-flex gap-1 rounded-lg border bg-muted/50 p-1">
        {(['completa', 'quieta'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={preferida === v}
            onClick={() => guardarTexAnimacion(v)}
            className={cn(
              'h-9 rounded-md px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tex)]/60',
              preferida === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'completa' ? 'Completas' : 'Quietas'}
          </button>
        ))}
      </div>
      {enCliente && preferida === 'completa' && efectiva === 'quieta' && (
        <p className="mt-2 text-xs text-muted-foreground">Tu sistema pide reducir el movimiento: Tex queda quieto igual.</p>
      )}
    </Seccion>
  )
}
