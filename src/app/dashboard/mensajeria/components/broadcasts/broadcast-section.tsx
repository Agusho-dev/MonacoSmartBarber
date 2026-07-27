'use client'

import { useState, useEffect, useTransition, useMemo, useRef, useCallback } from 'react'
import {
  Megaphone, Plus, Send, Users, Clock, X, ChevronRight, ChevronLeft,
  Check, AlertCircle, Tag, MapPin, Calendar, Hash, Variable,
  SlidersHorizontal, FileSpreadsheet, Upload, RefreshCw, UserPlus, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  getBroadcasts, createBroadcast, sendBroadcast, cancelBroadcast, previewCsvAudience,
} from '@/lib/actions/broadcasts'
import type { TemplateVariable } from '@/lib/actions/broadcasts'
import { previewAudience } from '@/lib/actions/client-segments'
import { useMensajeria } from '../shared/mensajeria-context'
import { extractTemplateVariables } from '../shared/helpers'
import type { AudienceFilters } from '@/lib/actions/client-segments'
import { parseContactsCsv, CSV_MAX_CONTACTS } from '@/lib/csv/contacts'
import type { CsvParseResult } from '@/lib/csv/contacts'

interface Broadcast {
  id: string
  name: string
  status: string
  template_name: string | null
  audience_count: number
  sent_count: number
  delivered_count: number
  failed_count: number
  scheduled_for: string | null
  created_at: string
}

const SEGMENTS = [
  { key: 'nuevo', label: 'Nuevo', color: 'bg-blue-500' },
  { key: 'regular', label: 'Regular', color: 'bg-green-500' },
  { key: 'vip', label: 'VIP', color: 'bg-amber-500' },
  { key: 'en_riesgo', label: 'En riesgo', color: 'bg-orange-500' },
  { key: 'perdido', label: 'Perdido', color: 'bg-red-500' },
]

const CONTACT_RANGES = [
  { label: 'Sin filtro', maxDays: undefined, minDays: undefined },
  { label: 'Esta semana', maxDays: 7, minDays: undefined },
  { label: 'Este mes', maxDays: 30, minDays: undefined },
  { label: '1-3 meses', maxDays: 90, minDays: 30 },
  { label: '+3 meses', maxDays: undefined, minDays: 90 },
]

// lastVisitMaxDays = "no viene hace al menos X días" (filtro de abandono)
// lastVisitMinDays = "vino dentro de los últimos X días" (filtro de recencia)
const VISIT_RANGES: Array<{
  label: string
  lastVisitMaxDays?: number  // cliente no viene hace >= X días
  lastVisitMinDays?: number  // cliente vino hace <= X días
  minVisits?: number
  maxVisits?: number
}> = [
  { label: 'Sin filtro' },
  { label: 'Vino esta semana', lastVisitMinDays: 7 },
  { label: 'Vino este mes', lastVisitMinDays: 30 },
  { label: 'No viene hace 1-2 meses', lastVisitMaxDays: 30, lastVisitMinDays: 60 },
  { label: 'No viene hace +2 meses', lastVisitMaxDays: 60 },
  { label: 'Nunca vino', minVisits: 0, maxVisits: 0 },
]

// Placeholders de personalización disponibles
const PERSONALIZATION_VARS = [
  { key: '{{nombre}}', label: 'Nombre completo', example: 'Juan Pérez' },
  { key: '{{primer_nombre}}', label: 'Primer nombre', example: 'Juan' },
  { key: '{{telefono}}', label: 'Teléfono', example: '3515551234' },
]

export function BroadcastSection() {
  const { waTemplates, handleSyncTemplates, syncingTemplates, tags, branches } = useMensajeria()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)

  // Wizard state
  const [name, setName] = useState('')
  const [selectedSegments, setSelectedSegments] = useState<string[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([])
  const [contactRange, setContactRange] = useState(0)
  const [visitRange, setVisitRange] = useState(0)
  const [minVisits, setMinVisits] = useState('')
  const [maxVisits, setMaxVisits] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Audiencia por CSV
  const [audienceMode, setAudienceMode] = useState<'filters' | 'csv'>('filters')
  const [csvFileName, setCsvFileName] = useState('')
  const [csvResult, setCsvResult] = useState<CsvParseResult | null>(null)
  const [csvMatch, setCsvMatch] = useState<{ existing: number; nuevos: number } | null>(null)
  const [csvDragging, setCsvDragging] = useState(false)
  const [showCsvInvalid, setShowCsvInvalid] = useState(false)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const csvContacts = csvResult?.contacts ?? []

  // Template variables
  const [templateVarValues, setTemplateVarValues] = useState<Record<string, Record<string, string>>>({})

  const [isCreating, startCreating] = useTransition()
  const [isSending, startSending] = useTransition()

  // Obtener template seleccionado
  const selectedTpl = useMemo(
    () => waTemplates.find(t => t.name === selectedTemplate),
    [waTemplates, selectedTemplate]
  )

  // Extraer variables del template seleccionado
  const templateVars = useMemo(() => {
    if (!selectedTpl?.components) return { header: [], body: [] }
    return extractTemplateVariables(selectedTpl.components)
  }, [selectedTpl])

  const hasVariables = templateVars.header.length > 0 || templateVars.body.length > 0
  const totalSteps = hasVariables ? 4 : 3

  // Load broadcasts
  useEffect(() => {
    getBroadcasts().then(result => {
      if (result.data) setBroadcasts(result.data as Broadcast[])
      setLoading(false)
    })
  }, [])

  // Sync templates on wizard open
  useEffect(() => {
    if (showWizard && waTemplates.length === 0) {
      handleSyncTemplates()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWizard])

  const buildFilters = (): AudienceFilters => {
    const vr = VISIT_RANGES[visitRange]
    return {
      segments: selectedSegments.length > 0 ? selectedSegments : undefined,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      branchIds: selectedBranchIds.length > 0 ? selectedBranchIds : undefined,
      lastContactDays: CONTACT_RANGES[contactRange].maxDays,
      lastContactMin: CONTACT_RANGES[contactRange].minDays,
      lastVisitMaxDays: vr?.lastVisitMaxDays,
      lastVisitMinDays: vr?.lastVisitMinDays,
      minVisits: minVisits ? parseInt(minVisits) : vr?.minVisits,
      maxVisits: maxVisits ? parseInt(maxVisits) : vr?.maxVisits,
      hasPhone: true,
    }
  }

  // Preview audience (debounced) — solo en modo filtros; el CSV se cuenta local
  useEffect(() => {
    if (!showWizard || wizardStep !== 1 || audienceMode !== 'filters') return
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      previewAudience(buildFilters()).then(result => {
        setAudienceCount(result.count)
        setPreviewLoading(false)
      })
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWizard, wizardStep, audienceMode, selectedSegments, selectedTagIds, selectedBranchIds, contactRange, visitRange, minVisits, maxVisits])

  // ── CSV ───────────────────────────────────────────────────────────────────
  const loadCsvFile = useCallback((file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo supera los 5 MB')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => toast.error('No se pudo leer el archivo')
    reader.onload = () => {
      const parsed = parseContactsCsv(String(reader.result ?? ''))
      setCsvFileName(file.name)
      setShowCsvInvalid(false)
      setCsvMatch(null)

      if (parsed.error) {
        setCsvResult(parsed)
        setAudienceCount(0)
        toast.error(parsed.error)
        return
      }
      if (parsed.contacts.length > CSV_MAX_CONTACTS) {
        setCsvResult({ ...parsed, error: `Máximo ${CSV_MAX_CONTACTS} contactos por difusión` })
        setAudienceCount(0)
        toast.error(`El CSV tiene ${parsed.contacts.length} contactos válidos y el máximo es ${CSV_MAX_CONTACTS}`)
        return
      }

      setCsvResult(parsed)
      setAudienceCount(parsed.contacts.length)
      toast.success(`${parsed.contacts.length} contacto(s) listos para enviar`)

      // Cuántos ya existen como clientes (solo lectura, no crea nada todavía)
      previewCsvAudience(parsed.contacts.map(c => ({ name: c.name, phone: c.phone })))
        .then(r => { if (!r.error) setCsvMatch({ existing: r.existing, nuevos: r.nuevos }) })
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const clearCsv = () => {
    setCsvResult(null)
    setCsvFileName('')
    setCsvMatch(null)
    setShowCsvInvalid(false)
    setAudienceCount(null)
    if (csvInputRef.current) csvInputRef.current.value = ''
  }

  const switchAudienceMode = (mode: 'filters' | 'csv') => {
    setAudienceMode(mode)
    setAudienceCount(mode === 'csv' ? (csvResult?.contacts.length ?? null) : null)
  }

  // Construir template_components para Meta API
  const buildTemplateComponents = (): TemplateVariable[] => {
    const components: TemplateVariable[] = []
    const vals = templateVarValues

    if (templateVars.header.length > 0) {
      components.push({
        type: 'header',
        parameters: templateVars.header.map(v => ({
          type: 'text' as const,
          text: vals.header?.[v] || `{{${v}}}`,
        })),
      })
    }

    if (templateVars.body.length > 0) {
      components.push({
        type: 'body',
        parameters: templateVars.body.map(v => ({
          type: 'text' as const,
          text: vals.body?.[v] || `{{${v}}}`,
        })),
      })
    }

    return components
  }

  const handleCreate = () => {
    if (!name.trim()) { toast.error('Nombre requerido'); return }
    if (!selectedTemplate) { toast.error('Seleccioná un template'); return }
    const isCsv = audienceMode === 'csv'
    if (isCsv && !csvContacts.length) { toast.error('Subí un CSV con contactos'); return }

    startCreating(async () => {
      const tplComponents = hasVariables ? buildTemplateComponents() : undefined
      const result = await createBroadcast({
        name: name.trim(),
        templateName: selectedTemplate,
        templateLanguage: selectedTpl?.language || 'es_AR',
        templateComponents: tplComponents,
        // En modo CSV el servidor resuelve la audiencia a client_ids.
        audienceFilters: isCsv ? {} : buildFilters(),
        csvContacts: isCsv ? csvContacts.map(c => ({ name: c.name, phone: c.phone })) : undefined,
        scheduledFor: scheduledFor || undefined,
      })
      if (result.error) { toast.error(result.error); return }
      toast.success(
        result.csvCreated
          ? `Difusión creada · ${result.csvCreated} contacto(s) nuevos agregados`
          : 'Difusión creada'
      )
      setBroadcasts(prev => [result.data as Broadcast, ...prev])
      resetWizard()
    })
  }

  const handleSend = (id: string) => {
    startSending(async () => {
      const result = await sendBroadcast(id)
      if (result.error) { toast.error(result.error); return }
      toast.success(`Enviando a ${result.recipientCount} destinatarios`)
      setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, status: 'sending', audience_count: result.recipientCount ?? b.audience_count } : b))
    })
  }

  const handleCancel = async (id: string) => {
    const result = await cancelBroadcast(id)
    if (result.error) { toast.error(result.error); return }
    toast.success('Difusión cancelada')
    setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b))
  }

  const resetWizard = () => {
    setShowWizard(false)
    setWizardStep(1)
    setName('')
    setSelectedSegments([])
    setSelectedTagIds([])
    setSelectedBranchIds([])
    setContactRange(0)
    setVisitRange(0)
    setMinVisits('')
    setMaxVisits('')
    setSelectedTemplate('')
    setScheduledFor('')
    setAudienceCount(null)
    setTemplateVarValues({})
    setAudienceMode('filters')
    clearCsv()
  }

  const toggleSegment = (seg: string) => {
    setSelectedSegments(prev => prev.includes(seg) ? prev.filter(s => s !== seg) : [...prev, seg])
  }

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds(prev => prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId])
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'draft': return { text: 'Borrador', cls: 'bg-white/10 text-muted-foreground' }
      case 'scheduled': return { text: 'Programada', cls: 'bg-blue-500/10 text-blue-400' }
      case 'sending': return { text: 'Enviando', cls: 'bg-yellow-500/10 text-yellow-400' }
      case 'sent': return { text: 'Enviada', cls: 'bg-green-500/10 text-green-400' }
      case 'cancelled': return { text: 'Cancelada', cls: 'bg-red-500/10 text-red-400' }
      default: return { text: status, cls: 'bg-white/10 text-muted-foreground' }
    }
  }

  const canAdvanceFromStep1 = !!name.trim() && (audienceMode === 'filters' || csvContacts.length > 0)
  const canAdvanceFromStep2 = !!selectedTemplate
  const canAdvanceFromStep3 = !hasVariables || templateVars.body.every(v => templateVarValues.body?.[v]?.trim()) &&
    templateVars.header.every(v => templateVarValues.header?.[v]?.trim())

  // Determinar el paso correcto según si hay variables
  const getStepContent = (step: number) => {
    if (!hasVariables) {
      // 3 pasos: Audiencia → Template → Confirmar
      if (step === 1) return 'audience'
      if (step === 2) return 'template'
      return 'confirm'
    }
    // 4 pasos: Audiencia → Template → Variables → Confirmar
    if (step === 1) return 'audience'
    if (step === 2) return 'template'
    if (step === 3) return 'variables'
    return 'confirm'
  }

  return (
    <div className="flex flex-1 min-w-0">
      {/* Lista */}
      <div className={`flex flex-col border-r border bg-background w-full ${showWizard ? 'hidden lg:flex lg:w-[340px]' : ''} lg:max-w-sm shrink-0`}>
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-green-400" />
            <span className="font-semibold text-white text-sm">Difusiones</span>
          </div>
          <Button size="sm" onClick={() => setShowWizard(true)} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
            <Plus className="size-3 mr-1" /> Nueva
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border border-t-green-400" />
            </div>
          ) : broadcasts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Megaphone className="mb-3 size-10 opacity-20" />
              <p className="text-sm">Sin difusiones</p>
              <p className="text-xs mt-1 opacity-60">Creá tu primera campaña masiva</p>
            </div>
          ) : (
            <div>
              {broadcasts.map(b => {
                const { text, cls } = statusLabel(b.status)
                return (
                  <div key={b.id} className="px-4 py-3 border-b border space-y-2 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white truncate">{b.name}</span>
                      <Badge variant="outline" className={`shrink-0 text-[10px] border-0 ${cls}`}>{text}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {b.template_name && <span className="flex items-center gap-1"><FileText className="size-3" /> {b.template_name}</span>}
                      {b.audience_count > 0 && <span className="flex items-center gap-1"><Users className="size-3" /> {b.audience_count}</span>}
                    </div>
                    {(b.status === 'sent' || b.status === 'sending') && (
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-green-400">Enviados: {b.sent_count}</span>
                        <span className="text-blue-400">Entregados: {b.delivered_count}</span>
                        {b.failed_count > 0 && <span className="text-red-400">Fallidos: {b.failed_count}</span>}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="flex gap-1.5">
                        {b.status === 'draft' && (
                          <button onClick={() => handleSend(b.id)} disabled={isSending}
                            className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5">
                            <Send className="size-2.5" /> Enviar
                          </button>
                        )}
                        {['draft', 'scheduled', 'sending'].includes(b.status) && (
                          <button onClick={() => handleCancel(b.id)}
                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5">
                            <X className="size-2.5" /> Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Wizard / Detalle */}
      <div className={`flex-1 min-w-0 bg-background ${!showWizard ? 'hidden lg:flex' : 'flex'} flex-col`}>
        {!showWizard ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-20 items-center justify-center rounded-full bg-white/5 border border">
              <Megaphone className="size-10 text-green-500/50" />
            </div>
            <p className="text-sm text-muted-foreground">Seleccioná una difusión o creá una nueva</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Wizard header */}
            <div className="flex items-center justify-between px-6 py-3 bg-card border-b border">
              <div className="flex items-center gap-3">
                <button onClick={resetWizard} className="text-muted-foreground hover:text-white">
                  <X className="size-4" />
                </button>
                <span className="font-semibold text-white text-sm">Nueva difusión</span>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
                  <div key={s} className={`size-2 rounded-full transition-colors ${wizardStep >= s ? 'bg-green-400' : 'bg-white/10'}`} />
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Step: Audiencia */}
              {getStepContent(wizardStep) === 'audience' && (
                <div className="space-y-6 max-w-lg">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Nombre de la difusión</Label>
                    <Input
                      className="bg-card border text-white"
                      placeholder="Ej: Promo invierno VIP"
                      value={name} onChange={e => setName(e.target.value)}
                    />
                  </div>

                  {/* Origen de la audiencia */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-card border border p-1">
                    {([
                      { key: 'filters' as const, label: 'Filtrar clientes', icon: SlidersHorizontal },
                      { key: 'csv' as const, label: 'Importar CSV', icon: FileSpreadsheet },
                    ]).map(({ key, label, icon: Icon }) => (
                      <button key={key} onClick={() => switchAudienceMode(key)}
                        className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                          audienceMode === key
                            ? 'bg-green-600 text-white'
                            : 'text-muted-foreground hover:text-white hover:bg-white/5'
                        }`}>
                        <Icon className="size-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* ── Modo CSV ────────────────────────────────────────── */}
                  {audienceMode === 'csv' && (
                    <div className="space-y-4">
                      <input
                        ref={csvInputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) loadCsvFile(f) }}
                      />

                      {!csvResult ? (
                        <div
                          onClick={() => csvInputRef.current?.click()}
                          onDragOver={e => { e.preventDefault(); setCsvDragging(true) }}
                          onDragLeave={() => setCsvDragging(false)}
                          onDrop={e => {
                            e.preventDefault(); setCsvDragging(false)
                            const f = e.dataTransfer.files?.[0]; if (f) loadCsvFile(f)
                          }}
                          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
                            csvDragging ? 'border-green-500 bg-green-500/5' : 'border-white/15 hover:border-white/30 hover:bg-white/[0.02]'
                          }`}>
                          <Upload className="size-7 text-green-400/70" />
                          <p className="text-sm text-white font-medium">Arrastrá tu CSV o hacé clic</p>
                          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                            Necesita una columna de teléfono (<span className="font-mono">whatsapp</span>, <span className="font-mono">telefono</span>…)
                            y opcionalmente una de <span className="font-mono">nombre</span>.
                            <br />Hasta {CSV_MAX_CONTACTS} contactos.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Archivo */}
                          <div className="flex items-center gap-3 rounded-lg bg-card border border p-3">
                            <FileText className="size-4 shrink-0 text-green-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-white font-medium">{csvFileName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {csvResult.totalRows} fila(s)
                                {csvResult.detected.phone && <> · teléfono: <span className="font-mono">{csvResult.detected.phone}</span></>}
                                {csvResult.detected.name && <> · nombre: <span className="font-mono">{csvResult.detected.name}</span></>}
                              </p>
                            </div>
                            <button onClick={() => csvInputRef.current?.click()}
                              className="shrink-0 text-[10px] text-muted-foreground hover:text-white">Cambiar</button>
                            <button onClick={clearCsv} className="shrink-0 text-muted-foreground hover:text-red-400">
                              <X className="size-3.5" />
                            </button>
                          </div>

                          {csvResult.error && (
                            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                              <AlertCircle className="size-4 shrink-0 text-red-400" />
                              <p className="text-xs text-red-400">{csvResult.error}</p>
                            </div>
                          )}

                          {/* Resumen */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 text-center">
                              <p className="text-lg font-bold text-green-400">{csvResult.contacts.length}</p>
                              <p className="text-[10px] text-muted-foreground">Válidos</p>
                            </div>
                            <div className="rounded-lg bg-card border border p-3 text-center">
                              <p className="text-lg font-bold text-white">{csvResult.duplicates}</p>
                              <p className="text-[10px] text-muted-foreground">Repetidos</p>
                            </div>
                            <button
                              onClick={() => csvResult.invalid.length > 0 && setShowCsvInvalid(v => !v)}
                              className={`rounded-lg border p-3 text-center transition-colors ${
                                csvResult.invalid.length > 0
                                  ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
                                  : 'bg-card border cursor-default'
                              }`}>
                              <p className={`text-lg font-bold ${csvResult.invalid.length > 0 ? 'text-red-400' : 'text-white'}`}>
                                {csvResult.invalid.length}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                Inválidos{csvResult.invalid.length > 0 && (showCsvInvalid ? ' ▴' : ' ▾')}
                              </p>
                            </button>
                          </div>

                          {showCsvInvalid && csvResult.invalid.length > 0 && (
                            <div className="max-h-32 overflow-y-auto rounded-lg bg-red-500/5 border border-red-500/20 p-2 space-y-1">
                              {csvResult.invalid.slice(0, 50).map((r, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
                                  <span className="truncate text-white/70">Fila {r.row}: {r.name || '—'} {r.raw && <span className="font-mono">({r.raw})</span>}</span>
                                  <span className="shrink-0 text-red-400">{r.reason}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Match contra la base */}
                          {csvMatch && (
                            <div className="flex items-center gap-4 rounded-lg bg-card border border px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <Users className="size-3.5 text-blue-400" />
                                <span className="text-[11px] text-muted-foreground">Ya son clientes</span>
                                <span className="text-xs font-bold text-blue-400">{csvMatch.existing}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <UserPlus className="size-3.5 text-green-400" />
                                <span className="text-[11px] text-muted-foreground">Se van a crear</span>
                                <span className="text-xs font-bold text-green-400">{csvMatch.nuevos}</span>
                              </div>
                            </div>
                          )}

                          {/* Preview */}
                          {csvResult.contacts.length > 0 && (
                            <div className="rounded-lg bg-card border border overflow-hidden">
                              <div className="max-h-48 overflow-y-auto divide-y divide-white/5">
                                {csvResult.contacts.slice(0, 100).map((c, i) => (
                                  <div key={c.phone} className="flex items-center gap-3 px-3 py-2">
                                    <span className="w-6 shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">{i + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-xs text-white">{c.name || <span className="text-muted-foreground italic">Sin nombre</span>}</span>
                                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">+54 {c.phone}</span>
                                  </div>
                                ))}
                              </div>
                              {csvResult.contacts.length > 100 && (
                                <p className="border-t border px-3 py-1.5 text-[10px] text-muted-foreground">
                                  + {csvResult.contacts.length - 100} contacto(s) más
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Modo filtros ────────────────────────────────────── */}
                  {audienceMode === 'filters' && (
                  <>
                  {/* Sucursales */}
                  {branches.length > 1 && (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="size-3" /> Sucursales
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {branches.map(branch => (
                          <button key={branch.id} onClick={() => toggleBranch(branch.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                              selectedBranchIds.includes(branch.id)
                                ? 'text-white border-transparent bg-purple-600'
                                : 'text-muted-foreground border hover:border-foreground/20'
                            }`}>
                            <MapPin className="size-2.5" />
                            {branch.name}
                          </button>
                        ))}
                      </div>
                      {selectedBranchIds.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">Sin filtro = clientes de todas las sucursales</p>
                      )}
                    </div>
                  )}

                  {/* Segmentos */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Segmentos de clientes</Label>
                    <div className="flex flex-wrap gap-2">
                      {SEGMENTS.map(({ key, label, color }) => (
                        <button key={key} onClick={() => toggleSegment(key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            selectedSegments.includes(key)
                              ? 'text-white border-transparent bg-green-600'
                              : 'text-muted-foreground border hover:border-foreground/20'
                          }`}>
                          <span className={`size-2 rounded-full ${color}`} />
                          {label}
                        </button>
                      ))}
                    </div>
                    {selectedSegments.length === 0 && (
                      <p className="text-[10px] text-muted-foreground">Sin filtro = todos los segmentos</p>
                    )}
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Tag className="size-3" /> Etiquetas
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {tags.map(tag => (
                          <button key={tag.id}
                            onClick={() => setSelectedTagIds(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                              selectedTagIds.includes(tag.id)
                                ? 'text-white border-transparent'
                                : 'text-muted-foreground border hover:border-foreground/20'
                            }`}
                            style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.color } : {}}>
                            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Último contacto */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="size-3" /> Último contacto (mensaje)
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_RANGES.map((range, i) => (
                        <button key={i} onClick={() => setContactRange(i)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            contactRange === i
                              ? 'text-white border-transparent bg-green-600'
                              : 'text-muted-foreground border hover:border-foreground/20'
                          }`}>
                          {range.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Última visita */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="size-3" /> Última visita (corte)
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {VISIT_RANGES.map((range, i) => (
                        <button key={i} onClick={() => setVisitRange(i)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            visitRange === i
                              ? 'text-white border-transparent bg-cyan-600'
                              : 'text-muted-foreground border hover:border-foreground/20'
                          }`}>
                          {range.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rango de visitas manuales */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Hash className="size-3" /> Cantidad de visitas (opcional)
                    </Label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number" min={0} placeholder="Mín"
                        className="bg-card border text-white w-24"
                        value={minVisits} onChange={e => setMinVisits(e.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">a</span>
                      <Input
                        type="number" min={0} placeholder="Máx"
                        className="bg-card border text-white w-24"
                        value={maxVisits} onChange={e => setMaxVisits(e.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">visitas</span>
                    </div>
                  </div>
                  </>
                  )}

                  {/* Audience count */}
                  <div className="rounded-lg bg-card border border p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="size-5 text-green-400" />
                      <span className="text-sm text-white">
                        {audienceMode === 'csv' ? 'Destinatarios del CSV' : 'Audiencia estimada'}
                      </span>
                    </div>
                    {previewLoading && audienceMode === 'filters' ? (
                      <div className="size-4 animate-spin rounded-full border-2 border border-t-green-400" />
                    ) : (
                      <span className="text-lg font-bold text-green-400">{audienceCount ?? '—'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Step: Template */}
              {getStepContent(wizardStep) === 'template' && (
                <div className="space-y-6 max-w-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-white mb-1">Seleccioná un template aprobado</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Solo se muestran templates aprobados por Meta. Los templates con variables ({"{{1}}"}, {"{{2}}"}) se personalizan en el siguiente paso.
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={handleSyncTemplates} disabled={syncingTemplates}
                      title="Traer los templates nuevos aprobados en Meta"
                      className="h-7 shrink-0 text-xs">
                      <RefreshCw className={`size-3 mr-1 ${syncingTemplates ? 'animate-spin' : ''}`} />
                      Actualizar
                    </Button>
                  </div>
                  {syncingTemplates ? (
                    <div className="flex justify-center py-8">
                      <div className="size-5 animate-spin rounded-full border-2 border border-t-green-400" />
                    </div>
                  ) : waTemplates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-xs">No se encontraron templates</p>
                      <button onClick={handleSyncTemplates} className="mt-2 text-xs text-green-400 hover:underline">
                        Sincronizar desde Meta
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {waTemplates.filter(t => t.status === 'approved').map(tpl => {
                        const vars = extractTemplateVariables(tpl.components ?? [])
                        const varCount = vars.header.length + vars.body.length
                        return (
                          <button key={tpl.id} onClick={() => {
                            setSelectedTemplate(tpl.name)
                            setTemplateVarValues({})
                          }}
                            className={`w-full text-left rounded-lg border p-3 transition-colors ${
                              selectedTemplate === tpl.name
                                ? 'border-green-500 bg-green-500/5'
                                : 'border bg-white/5 hover:bg-white/10'
                            }`}>
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-white">{tpl.name}</p>
                              <div className="flex items-center gap-2">
                                {varCount > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 flex items-center gap-0.5">
                                    <Variable className="size-2.5" /> {varCount} var{varCount > 1 ? 's' : ''}
                                  </span>
                                )}
                                {selectedTemplate === tpl.name && <Check className="size-4 text-green-400" />}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">{tpl.language}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{tpl.category}</span>
                            </div>
                            {tpl.components?.map((comp: { type?: string; text?: string }, i: number) => (
                              comp.type === 'BODY' && comp.text ? (
                                <p key={i} className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{comp.text}</p>
                              ) : null
                            ))}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Step: Variables de template */}
              {getStepContent(wizardStep) === 'variables' && selectedTpl && (
                <div className="space-y-6 max-w-lg">
                  <div>
                    <p className="text-xs font-semibold text-white mb-1 flex items-center gap-1.5">
                      <Variable className="size-3.5" /> Variables del template
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Completá el valor de cada variable. Podés usar placeholders dinámicos que se reemplazan por cada cliente.
                    </p>
                  </div>

                  {/* Placeholders disponibles */}
                  <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3 space-y-2">
                    <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">Personalización automática</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PERSONALIZATION_VARS.map(v => (
                        <span key={v.key} className="text-[10px] px-2 py-1 rounded bg-purple-500/10 text-purple-300 font-mono cursor-help"
                          title={`Ejemplo: ${v.example}`}>
                          {v.key} <span className="text-purple-500">= {v.label}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Preview del template */}
                  <div className="rounded-lg bg-card border p-4 space-y-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Vista previa del template</p>
                    {selectedTpl.components?.map((comp: { type?: string; text?: string }, i: number) => {
                      if (comp.type === 'HEADER' && comp.text) {
                        return <p key={i} className="text-sm font-bold text-white">{comp.text}</p>
                      }
                      if (comp.type === 'BODY' && comp.text) {
                        return <p key={i} className="text-xs text-muted-foreground whitespace-pre-wrap">{comp.text}</p>
                      }
                      if (comp.type === 'FOOTER' && comp.text) {
                        return <p key={i} className="text-[10px] text-muted-foreground/60 italic">{comp.text}</p>
                      }
                      return null
                    })}
                  </div>

                  {/* Inputs para header variables */}
                  {templateVars.header.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider">Variables del encabezado</Label>
                      {templateVars.header.map(v => (
                        <div key={`header-${v}`} className="space-y-1">
                          <label className="text-[11px] text-white font-medium">{'{{' + v + '}}'}</label>
                          <Input
                            className="bg-card border text-white font-mono text-xs"
                            placeholder={`Ej: {{primer_nombre}} o texto fijo`}
                            value={templateVarValues.header?.[v] ?? ''}
                            onChange={e => setTemplateVarValues(prev => ({
                              ...prev,
                              header: { ...prev.header, [v]: e.target.value },
                            }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inputs para body variables */}
                  {templateVars.body.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider">Variables del cuerpo</Label>
                      {templateVars.body.map(v => (
                        <div key={`body-${v}`} className="space-y-1">
                          <label className="text-[11px] text-white font-medium">{'{{' + v + '}}'}</label>
                          <Input
                            className="bg-card border text-white font-mono text-xs"
                            placeholder={`Ej: {{primer_nombre}}, texto fijo, etc.`}
                            value={templateVarValues.body?.[v] ?? ''}
                            onChange={e => setTemplateVarValues(prev => ({
                              ...prev,
                              body: { ...prev.body, [v]: e.target.value },
                            }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step: Confirmar */}
              {getStepContent(wizardStep) === 'confirm' && (
                <div className="space-y-6 max-w-lg">
                  <p className="text-xs font-semibold text-white">Resumen de la difusión</p>
                  <div className="space-y-3 rounded-lg bg-card border border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Nombre</span>
                      <span className="text-sm text-white font-medium">{name || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Audiencia</span>
                      <span className="text-sm text-green-400 font-bold">{audienceCount ?? '—'} contactos</span>
                    </div>
                    {audienceMode === 'csv' && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Origen</span>
                        <span className="flex items-center gap-1.5 text-xs text-white">
                          <FileSpreadsheet className="size-3 text-green-400" />
                          <span className="max-w-[180px] truncate">{csvFileName}</span>
                          {!!csvMatch?.nuevos && (
                            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                              +{csvMatch.nuevos} nuevos
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Template</span>
                      <span className="text-sm text-white">{selectedTemplate || '—'}</span>
                    </div>
                    {audienceMode === 'filters' && selectedBranchIds.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Sucursales</span>
                        <div className="flex gap-1 flex-wrap justify-end">
                          {selectedBranchIds.map(id => {
                            const br = branches.find(b => b.id === id)
                            return <span key={id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400">{br?.name ?? id.slice(0, 8)}</span>
                          })}
                        </div>
                      </div>
                    )}
                    {audienceMode === 'filters' && selectedSegments.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Segmentos</span>
                        <div className="flex gap-1">
                          {selectedSegments.map(s => (
                            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasVariables && (
                      <div className="border-t border pt-3 space-y-2">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Variables</span>
                        {Object.entries(templateVarValues).map(([section, vars]) => (
                          Object.entries(vars).map(([key, val]) => (
                            <div key={`${section}-${key}`} className="flex items-center justify-between">
                              <span className="text-[11px] text-muted-foreground font-mono">{section}.{'{{' + key + '}}'}</span>
                              <span className="text-[11px] text-white font-mono">{val || '—'}</span>
                            </div>
                          ))
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Programar (opcional)</Label>
                    <Input
                      type="datetime-local"
                      className="bg-card border text-white"
                      value={scheduledFor}
                      onChange={e => setScheduledFor(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Dejá vacío para enviar ahora</p>
                  </div>

                  {audienceCount === 0 && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                      <p className="text-xs text-red-400">
                        {audienceMode === 'csv'
                          ? 'El CSV no tiene teléfonos válidos'
                          : 'No hay clientes que coincidan con los filtros seleccionados'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Wizard footer */}
            <div className="flex items-center justify-between px-6 py-3 bg-card border-t border">
              <Button variant="ghost" onClick={() => wizardStep > 1 ? setWizardStep(s => s - 1) : resetWizard()}
                className="text-muted-foreground hover:text-white">
                <ChevronLeft className="size-4 mr-1" />
                {wizardStep > 1 ? 'Anterior' : 'Cancelar'}
              </Button>
              {wizardStep < totalSteps ? (
                <Button onClick={() => setWizardStep(s => s + 1)}
                  disabled={
                    (getStepContent(wizardStep) === 'audience' && !canAdvanceFromStep1) ||
                    (getStepContent(wizardStep) === 'template' && !canAdvanceFromStep2) ||
                    (getStepContent(wizardStep) === 'variables' && !canAdvanceFromStep3)
                  }
                  className="bg-green-600 hover:bg-green-500 text-white">
                  Siguiente <ChevronRight className="size-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={isCreating || audienceCount === 0}
                  className="bg-green-600 hover:bg-green-500 text-white">
                  {isCreating ? 'Creando...' : scheduledFor ? 'Programar' : 'Crear y enviar'}
                  <Send className="size-3.5 ml-1.5" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
