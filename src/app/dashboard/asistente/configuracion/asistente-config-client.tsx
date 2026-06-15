'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  Brain,
  KeyRound,
  Database,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Lock,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

import {
  saveAssistantConfig,
  getKnowledgeStats,
  reindexKnowledge,
  type AssistantConfigView,
  type SaveAssistantConfigInput,
} from '@/lib/actions/asistente'
import { ModelPicker } from '@/app/dashboard/mensajeria/components/shared/model-picker'
import { DEFAULT_CHAT_MODEL } from '@/lib/asistente/models'

import { PERSONA_PRESETS } from './components/personas'
import { ProCelebration } from './components/pro-celebration'

// ── Dominios de acceso a datos ──────────────────────────────────────────────
interface DataDomain {
  key: string
  label: string
  helper: string
  sensitive?: boolean
}

const DATA_DOMAINS: DataDomain[] = [
  { key: 'finanzas', label: 'Finanzas (ingresos, márgenes)', helper: 'Caja, facturación y rentabilidad del negocio.', sensitive: true },
  { key: 'salarios', label: 'Sueldos y comisiones (sensible)', helper: 'Pagos al equipo, comisiones y liquidaciones.', sensitive: true },
  { key: 'estadisticas', label: 'Estadísticas y operación', helper: 'Volumen de atención, ocupación y productividad.' },
  { key: 'clientes', label: 'Clientes y fidelización', helper: 'Base de clientes, recurrencia y segmentos.' },
  { key: 'resenas', label: 'Reseñas y reputación', helper: 'Calificaciones, comentarios y casos de atención.' },
  { key: 'turnos', label: 'Turnos y agenda', helper: 'Reservas, no-shows y disponibilidad.' },
  { key: 'fidelizacion', label: 'Programa de puntos', helper: 'Puntos, canjes y recompensas.' },
]

const KNOWLEDGE_DEFAULT = {
  documents: 0,
  chunks: 0,
  embedded: 0,
  pending: 0,
  lastIndexedAt: null as string | null,
}

type KnowledgeStats = typeof KNOWLEDGE_DEFAULT

interface Props {
  initial: AssistantConfigView
}

export function AsistenteConfigClient({ initial }: Props) {
  const [isPending, startTransition] = useTransition()

  // ── Estado controlado por campo ─────────────────────────────────────────
  const [persona, setPersona] = useState(initial.assistant_persona)
  const [systemPrompt, setSystemPrompt] = useState(initial.assistant_system_prompt)
  const [model, setModel] = useState(initial.assistant_model || DEFAULT_CHAT_MODEL)
  const [temperature, setTemperature] = useState(initial.assistant_temperature)
  const [dataAccess, setDataAccess] = useState<Record<string, boolean>>(initial.assistant_data_access ?? {})
  const [proMode, setProMode] = useState(initial.assistant_pro_mode)

  // Claves de API: nunca recibimos las reales; sólo el flag hasXKey.
  // El input vacío = "no cambiar". Si el usuario escribe algo, lo mandamos.
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [showAnthropic, setShowAnthropic] = useState(false)
  const [showOpenai, setShowOpenai] = useState(false)
  const [showOpenrouter, setShowOpenrouter] = useState(false)

  // Celebración del Modo Pro
  const [celebrate, setCelebrate] = useState(false)

  // ── Base de conocimiento (RAG) ──────────────────────────────────────────
  const [knowledge, setKnowledge] = useState<KnowledgeStats | null>(null)
  const [knowledgeLoading, setKnowledgeLoading] = useState(true)
  const [reindexing, startReindex] = useTransition()

  useEffect(() => {
    let active = true
    getKnowledgeStats()
      .then((stats) => {
        if (active) setKnowledge(stats ?? KNOWLEDGE_DEFAULT)
      })
      .finally(() => {
        if (active) setKnowledgeLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // ── Snapshot guardado + detección de cambios ────────────────────────────
  const [savedSnapshot, setSavedSnapshot] = useState({
    persona: initial.assistant_persona,
    systemPrompt: initial.assistant_system_prompt,
    model: initial.assistant_model || DEFAULT_CHAT_MODEL,
    temperature: initial.assistant_temperature,
    dataAccess: JSON.stringify(initial.assistant_data_access ?? {}),
    proMode: initial.assistant_pro_mode,
  })

  const keysTouched = anthropicKey !== '' || openaiKey !== '' || openrouterKey !== ''

  const isDirty =
    persona !== savedSnapshot.persona ||
    systemPrompt !== savedSnapshot.systemPrompt ||
    model !== savedSnapshot.model ||
    temperature !== savedSnapshot.temperature ||
    JSON.stringify(dataAccess) !== savedSnapshot.dataAccess ||
    proMode !== savedSnapshot.proMode ||
    keysTouched

  // ── Handlers ────────────────────────────────────────────────────────────
  function applyPreset(promptText: string) {
    setPersona(promptText)
  }

  function toggleDomain(key: string, value: boolean) {
    setDataAccess((prev) => ({ ...prev, [key]: value }))
  }

  function handleProModeChange(next: boolean) {
    if (!initial.isOwnerOrAdmin) return
    setProMode(next)
    if (next) setCelebrate((c) => !c) // alterna para re-disparar la animación
  }

  function handleSave() {
    startTransition(async () => {
      // Sólo enviamos los campos que cambiaron contra el snapshot.
      const input: SaveAssistantConfigInput = {}
      if (persona !== savedSnapshot.persona) input.assistant_persona = persona
      if (systemPrompt !== savedSnapshot.systemPrompt) input.assistant_system_prompt = systemPrompt
      if (model !== savedSnapshot.model) input.assistant_model = model
      if (temperature !== savedSnapshot.temperature) input.assistant_temperature = temperature
      if (JSON.stringify(dataAccess) !== savedSnapshot.dataAccess) input.assistant_data_access = dataAccess
      if (proMode !== savedSnapshot.proMode) input.assistant_pro_mode = proMode
      // Las claves sólo van si el usuario tipeó algo nuevo.
      if (anthropicKey !== '') input.anthropic_api_key = anthropicKey
      if (openaiKey !== '') input.openai_api_key = openaiKey
      if (openrouterKey !== '') input.openrouter_api_key = openrouterKey

      const result = await saveAssistantConfig(input)
      if ('error' in result) {
        toast.error(result.error)
        return
      }

      toast.success('Configuración guardada')
      // Re-snapshot para que isDirty vuelva a false.
      setSavedSnapshot({
        persona,
        systemPrompt,
        model,
        temperature,
        dataAccess: JSON.stringify(dataAccess),
        proMode,
      })
      // Limpiamos los inputs de clave (ya quedaron persistidas).
      setAnthropicKey('')
      setOpenaiKey('')
      setOpenrouterKey('')
    })
  }

  function handleReindex() {
    startReindex(async () => {
      const result = await reindexKnowledge()
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Reindexado: ${result.documents} documento${result.documents === 1 ? '' : 's'}` +
          (result.embedded !== undefined ? ` · ${result.embedded} vectorizados` : '')
      )
      const fresh = await getKnowledgeStats()
      setKnowledge(fresh ?? KNOWLEDGE_DEFAULT)
    })
  }

  const lastIndexedLabel =
    knowledge?.lastIndexedAt != null
      ? formatDistanceToNow(new Date(knowledge.lastIndexedAt), { addSuffix: true, locale: es })
      : null

  return (
    <div className="relative space-y-6 pb-24">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="space-y-3">
          <Link
            href="/dashboard/asistente"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Volver al chat
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Configurá tu copiloto</h1>
              <p className="text-sm text-muted-foreground">
                Personalidad, modelo, datos y conocimiento de tu asistente.
              </p>
            </div>
          </div>
        </header>

        {/* ── 2. Personalidad ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Personalidad
            </CardTitle>
            <CardDescription>
              Elegí un estilo base y ajustá el tono. Esto define cómo te responde el copiloto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PERSONA_PRESETS.map((preset) => {
                const active = persona === preset.prompt
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.prompt)}
                    aria-pressed={active}
                    className={cn(
                      'group flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60'
                    )}
                  >
                    <span className="text-lg leading-none">{preset.emoji}</span>
                    <span className="text-sm font-semibold">{preset.label}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {preset.description}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="persona">Tono y estilo del copiloto</Label>
              <Textarea
                id="persona"
                rows={4}
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="Describí cómo querés que hable tu asistente. Elegí un preset arriba para empezar."
              />
              <p className="text-xs text-muted-foreground">
                Definí la voz del asistente. Los presets cargan un texto que después podés editar.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="system-prompt">Instrucciones adicionales del negocio</Label>
              <Textarea
                id="system-prompt"
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Ej: Somos una barbería premium en Palermo. Cuidamos el lenguaje, usamos voseo y priorizamos la fidelización."
              />
              <p className="text-xs text-muted-foreground">
                Contexto fijo que el asistente tendrá siempre presente (rubro, valores, reglas).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── 3. Modelo & creatividad ────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-4 text-primary" />
              Modelo &amp; creatividad
            </CardTitle>
            <CardDescription>
              El motor que razona tus consultas y cuánta libertad creativa le das.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <ModelPicker value={model} onChange={(id) => setModel(id)} compact />
              <p className="text-xs text-muted-foreground">
                Claude Sonnet 4.6 es el equilibrio recomendado. Opus para máxima capacidad, Haiku para velocidad.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="temperature">Creatividad</Label>
                <Badge variant="secondary" className="font-mono tabular-nums">
                  {temperature.toFixed(1)}
                </Badge>
              </div>
              <input
                id="temperature"
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                aria-label="Nivel de creatividad del asistente"
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
                <span>Preciso</span>
                <span>Creativo</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 4. Claves de API ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              Claves de API
            </CardTitle>
            <CardDescription>
              Conectá tus proveedores. Las claves se guardan cifradas y nunca se muestran de vuelta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ApiKeyField
              id="anthropic-key"
              label="Anthropic (Claude)"
              note="Necesaria para los modelos Claude del copiloto."
              hasKey={initial.hasAnthropicKey}
              value={anthropicKey}
              onChange={setAnthropicKey}
              show={showAnthropic}
              onToggleShow={() => setShowAnthropic((s) => !s)}
            />
            <ApiKeyField
              id="openai-key"
              label="OpenAI"
              note="Necesaria para la búsqueda semántica / RAG (embeddings)."
              hasKey={initial.hasOpenAiKey}
              value={openaiKey}
              onChange={setOpenaiKey}
              show={showOpenai}
              onToggleShow={() => setShowOpenai((s) => !s)}
            />
            <ApiKeyField
              id="openrouter-key"
              label="OpenRouter"
              note="Opcional. Habilita modelos custom y alternativos."
              hasKey={initial.hasOpenRouterKey}
              value={openrouterKey}
              onChange={setOpenrouterKey}
              show={showOpenrouter}
              onToggleShow={() => setShowOpenrouter((s) => !s)}
            />
          </CardContent>
        </Card>

        {/* ── 5. Acceso a datos ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Acceso a datos
            </CardTitle>
            <CardDescription>
              Elegí qué información del negocio puede consultar el asistente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {DATA_DOMAINS.map((domain, i) => (
              <div
                key={domain.key}
                className={cn(
                  'flex items-start justify-between gap-4 py-3',
                  i !== 0 && 'border-t border-border/60'
                )}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`domain-${domain.key}`} className="cursor-pointer">
                      {domain.label}
                    </Label>
                    {domain.sensitive && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-semibold text-amber-500">
                        Sensible
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{domain.helper}</p>
                </div>
                <Switch
                  id={`domain-${domain.key}`}
                  checked={dataAccess[domain.key] ?? false}
                  onCheckedChange={(v) => toggleDomain(domain.key, v)}
                  className="mt-0.5 shrink-0"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── 6. Base de conocimiento (RAG) ──────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-primary" />
              Base de conocimiento
            </CardTitle>
            <CardDescription>
              El copiloto usa tus mensajes y un glosario del negocio para responder con contexto real.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {knowledgeLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando estado de la base…
              </div>
            ) : knowledge && knowledge.documents === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Tu copiloto aún no tiene base de conocimiento. Reindexá para sumar tus mensajes y un
                glosario del negocio.
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium tabular-nums">
                  {knowledge?.documents} documentos · {knowledge?.chunks} fragmentos ·{' '}
                  {knowledge?.embedded} vectorizados ({knowledge?.pending} pendientes)
                </p>
                {lastIndexedLabel && (
                  <p className="text-xs text-muted-foreground">
                    Última indexación {lastIndexedLabel}
                  </p>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleReindex}
              disabled={reindexing}
              className="w-full sm:w-auto"
            >
              {reindexing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {reindexing ? 'Reindexando…' : 'Reindexar'}
            </Button>
          </CardContent>
        </Card>

        {/* ── 7. Modo Pro ────────────────────────────────────────────────── */}
        <Card className={cn('relative overflow-hidden', proMode && 'assistant-pro-ring')}>
          <ProCelebration show={celebrate} />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles
                className={cn('size-4', proMode ? 'text-[oklch(0.78_0.12_85)]' : 'text-primary')}
              />
              Modo Pro
            </CardTitle>
            <CardDescription>
              Desbloquea consultas SQL de solo lectura para preguntas avanzadas sobre tus datos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {proMode ? 'Modo Pro activo' : 'Activar Modo Pro'}
                </p>
                <p className="text-xs text-muted-foreground">
                  El copiloto podrá ejecutar consultas SQL de solo lectura para responder preguntas
                  que no entran en los reportes estándar.
                </p>
                {!initial.isOwnerOrAdmin && (
                  <p className="inline-flex items-center gap-1.5 pt-1 text-xs font-medium text-amber-500">
                    <Lock className="size-3" />
                    Solo el dueño o un administrador puede activar el Modo Pro.
                  </p>
                )}
              </div>
              <Switch
                checked={proMode}
                onCheckedChange={handleProModeChange}
                disabled={!initial.isOwnerOrAdmin}
                aria-label="Activar Modo Pro"
                className="mt-0.5 shrink-0"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Barra sticky de guardado ─────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="size-4 text-amber-500" />
              Hay cambios sin guardar
            </div>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Guardar cambios
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Campo de clave de API enmascarado ───────────────────────────────────────
interface ApiKeyFieldProps {
  id: string
  label: string
  note: string
  hasKey: boolean
  value: string
  onChange: (value: string) => void
  show: boolean
  onToggleShow: () => void
}

function ApiKeyField({
  id,
  label,
  note,
  hasKey,
  value,
  onChange,
  show,
  onToggleShow,
}: ApiKeyFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            hasKey
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-amber-500/15 text-amber-500'
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              hasKey ? 'bg-emerald-400' : 'bg-amber-500'
            )}
          />
          {hasKey ? 'Conectado' : 'Sin configurar'}
        </span>
      </div>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hasKey ? '••••••••••••••••' : 'Pegá tu clave acá'}
          autoComplete="off"
          className="pr-10 font-mono"
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? 'Ocultar clave' : 'Mostrar clave'}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  )
}
