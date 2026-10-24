'use client'

// La nueva difusión, como las hojas de WhatsApp (23/oct/2026, tercera ronda):
// en el celular, la hoja de iOS de pantalla entera con «Cancelar · Nueva
// difusión · Siguiente» y el paso debajo del título; en la compu, el diálogo
// de la Mac (hoja-whatsapp.tsx). Antes era un panel con su propio encabezado
// («× Nueva difusión ●○○») metido DEBAJO de la barra de iOS de Difusiones: dos
// barras, letra de 10 y 11 px y chips de 30 px.
//
// La lógica es la de siempre (filtros, CSV, plantilla y variables, fecha con
// zona, crear); cambió cómo se ve. Los filtros son celdas de iOS (los de una
// sola opción abren el menú del sistema) y la audiencia estimada va fija abajo
// mientras se eligen. «Crear» la deja como borrador, como siempre: sale con
// «Enviar» (o «Programar») desde la lista.
//
// Pasos: Audiencia → Plantilla → (Variables, si la plantilla tiene) → Confirmar.
// Cada apertura arranca de cero: quien la abre le cambia la `key`.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import {
  AlertCircle, FileSpreadsheet, FileText, Loader2, Plus, RefreshCw, SlidersHorizontal, Upload, UserPlus, Users, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { createBroadcast, previewCsvAudience, type TemplateVariable } from '@/lib/actions/broadcasts'
import { previewAudience, type AudienceFilters } from '@/lib/actions/client-segments'
import { parseContactsCsv, CSV_MAX_CONTACTS, type CsvParseResult } from '@/lib/csv/contacts'
import { cn } from '@/lib/utils'
import { useMensajeria } from '../shared/mensajeria-context'
import { extractTemplateVariables, formatearTelefonoAr } from '../shared/helpers'
import type { WaTemplate } from '../shared/types'
import { trozosDePlantilla } from '../inbox/plantilla'
import { HojaWhatsApp } from '../dialogs/hoja-whatsapp'
import { useEntradaDeHoja } from '../inbox/entrada-de-hoja'
import { CampoFechaHora } from '../dialogs/campo-fecha-hora'
import {
  BotonIconoIos, BotonTextoCeldaIos, CargandoIos, CeldaAccionIos, CeldaIos, CeldaMarcaIos, CeldaSelectorIos,
  CLASE_BOTON_CELDA, CLASE_CAMPO_CELDA, CLASE_CELDA, CLASE_CUERPO_BOTON, GrupoIos, IconoCeldaIos, InterruptorIos, SegmentadoIos,
  TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, avisarFalla, nombreDePlantilla,
} from '../navegacion/lista-ios'

/** Una difusión como la devuelven getBroadcasts y createBroadcast. */
export interface Difusion {
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
  { label: 'Cualquier fecha', maxDays: undefined, minDays: undefined },
  { label: 'Esta semana', maxDays: 7, minDays: undefined },
  { label: 'Este mes', maxDays: 30, minDays: undefined },
  { label: 'Hace 1 a 3 meses', maxDays: 90, minDays: 30 },
  { label: 'Hace más de 3 meses', maxDays: undefined, minDays: 90 },
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
  { label: 'Cualquier fecha' },
  { label: 'Vino esta semana', lastVisitMinDays: 7 },
  { label: 'Vino este mes', lastVisitMinDays: 30 },
  { label: 'No viene hace 1 a 2 meses', lastVisitMaxDays: 30, lastVisitMinDays: 60 },
  { label: 'No viene hace más de 2 meses', lastVisitMaxDays: 60 },
  { label: 'Nunca vino', minVisits: 0, maxVisits: 0 },
]

const OPCIONES_CONTACTO = CONTACT_RANGES.map((r, i) => ({ valor: String(i), texto: r.label }))
const OPCIONES_VISITA = VISIT_RANGES.map((r, i) => ({ valor: String(i), texto: r.label }))

// Placeholders de personalización disponibles
const PERSONALIZATION_VARS = [
  { key: '{{nombre}}', label: 'Nombre completo', example: 'Juan Pérez' },
  { key: '{{primer_nombre}}', label: 'Primer nombre', example: 'Juan' },
  { key: '{{telefono}}', label: 'Teléfono', example: '3515551234' },
]

type Paso = 'audience' | 'template' | 'variables' | 'confirm'
const NOMBRE_DEL_PASO: Record<Paso, string> = {
  audience: 'Audiencia',
  template: 'Plantilla',
  variables: 'Variables',
  confirm: 'Confirmar',
}

const CATEGORIA: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' }

/** "es_AR · Marketing · 2 variables": lo que hay que saber de una plantilla antes de elegirla. */
function datosDePlantilla(tpl: WaTemplate): string {
  const vars = extractTemplateVariables(tpl.components ?? [])
  const n = vars.header.length + vars.body.length
  return [tpl.language, CATEGORIA[tpl.category?.toUpperCase()] ?? tpl.category, n > 0 ? `${n} variable${n === 1 ? '' : 's'}` : null]
    .filter(Boolean)
    .join(' · ')
}

function cuerpoDePlantilla(tpl: WaTemplate): string | null {
  return tpl.components?.find((c) => c.type === 'BODY' && c.text)?.text ?? null
}

export function AsistenteDifusion({
  open,
  onOpenChange,
  onCreada,
}: {
  open: boolean
  onOpenChange: (abierto: boolean) => void
  /** La difusión recién creada (borrador), para sumarla a la lista. */
  onCreada: (difusion: Difusion) => void
}) {
  const { waTemplates, handleSyncTemplates, syncingTemplates, branches } = useMensajeria()
  const [wizardStep, setWizardStep] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nombreRef = useRef<HTMLInputElement>(null)

  // Wizard state
  const [name, setName] = useState('')
  const [selectedSegments, setSelectedSegments] = useState<string[]>([])
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([])
  const [contactRange, setContactRange] = useState(0)
  const [visitRange, setVisitRange] = useState(0)
  const [minVisits, setMinVisits] = useState('')
  const [maxVisits, setMaxVisits] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [programar, setProgramar] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')

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
  // El último campo de variable que se tocó: ahí van los datos del cliente que se agregan.
  const [ultimoCampo, setUltimoCampo] = useState<{ seccion: 'header' | 'body'; v: string } | null>(null)

  const [isCreating, startCreating] = useTransition()

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
  const aprobadas = useMemo(() => waTemplates.filter((t) => t.status === 'approved'), [waTemplates])

  // Sync templates on wizard open. Cada apertura monta este asistente de nuevo
  // (la key), así que alcanza con mirarlo al montar.
  useEffect(() => {
    if (open && waTemplates.length === 0) {
      handleSyncTemplates()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Las etiquetas no van: el filtro tagIds nunca filtró nada en el servidor
  // (client-segments.ts no lo aplica) y la audiencia salía igual con o sin
  // ellas. Elegir «Posible Barbero» y mandarle la promo a todos era la trampa.
  const filtros = useMemo((): AudienceFilters => {
    const vr = VISIT_RANGES[visitRange]
    return {
      segments: selectedSegments.length > 0 ? selectedSegments : undefined,
      branchIds: selectedBranchIds.length > 0 ? selectedBranchIds : undefined,
      lastContactDays: CONTACT_RANGES[contactRange].maxDays,
      lastContactMin: CONTACT_RANGES[contactRange].minDays,
      lastVisitMaxDays: vr?.lastVisitMaxDays,
      lastVisitMinDays: vr?.lastVisitMinDays,
      minVisits: minVisits ? parseInt(minVisits) : vr?.minVisits,
      maxVisits: maxVisits ? parseInt(maxVisits) : vr?.maxVisits,
      hasPhone: true,
    }
  }, [selectedSegments, selectedBranchIds, contactRange, visitRange, minVisits, maxVisits])
  const claveFiltros = JSON.stringify(filtros)

  // La audiencia estimada de los filtros (400 ms después del último cambio).
  // Lo que se ve es la respuesta a ESTOS filtros: mientras llega, "calculando".
  const [previa, setPrevia] = useState<{ clave: string; cantidad: number | null } | null>(null)
  useEffect(() => {
    if (!open || audienceMode !== 'filters') return
    let vigente = true
    const timer = setTimeout(() => {
      previewAudience(filtros)
        .then((result) => { if (vigente) setPrevia({ clave: claveFiltros, cantidad: result.count }) })
        .catch(() => { if (vigente) setPrevia({ clave: claveFiltros, cantidad: null }) })
    }, 400)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  // filtros cambia junto con claveFiltros.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audienceMode, claveFiltros])

  const previewLoading = audienceMode === 'filters' && previa?.clave !== claveFiltros
  const cantidadCsv = csvResult ? (csvResult.error ? 0 : csvResult.contacts.length) : null
  const audienceCount =
    audienceMode === 'csv' ? cantidadCsv : previa?.clave === claveFiltros ? previa.cantidad : null

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
        toast.error(parsed.error)
        return
      }
      if (parsed.contacts.length > CSV_MAX_CONTACTS) {
        setCsvResult({ ...parsed, error: `Máximo ${CSV_MAX_CONTACTS} contactos por difusión` })
        toast.error(`El CSV tiene ${parsed.contacts.length} contactos válidos y el máximo es ${CSV_MAX_CONTACTS}`)
        return
      }

      setCsvResult(parsed)
      toast.success(`${parsed.contacts.length} contacto(s) listos para enviar`)

      // Cuántos ya existen como clientes (solo lectura, no crea nada todavía)
      previewCsvAudience(parsed.contacts.map(c => ({ name: c.name, phone: c.phone })))
        .then(r => { if (!r.error) setCsvMatch({ existing: r.existing, nuevos: r.nuevos }) })
        .catch(() => { /* el cruce con la base es informativo */ })
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const clearCsv = () => {
    setCsvResult(null)
    setCsvFileName('')
    setCsvMatch(null)
    setShowCsvInvalid(false)
    if (csvInputRef.current) csvInputRef.current.value = ''
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
    if (programar && !scheduledFor) { toast.error('Elegí el día y la hora del envío'); return }
    const isCsv = audienceMode === 'csv'
    if (isCsv && !csvContacts.length) { toast.error('Subí un CSV con contactos'); return }

    startCreating(async () => {
      try {
        const tplComponents = hasVariables ? buildTemplateComponents() : undefined
        const result = await createBroadcast({
          name: name.trim(),
          templateName: selectedTemplate,
          templateLanguage: selectedTpl?.language || 'es_AR',
          templateComponents: tplComponents,
          // En modo CSV el servidor resuelve la audiencia a client_ids.
          audienceFilters: isCsv ? {} : filtros,
          csvContacts: isCsv ? csvContacts.map(c => ({ name: c.name, phone: c.phone })) : undefined,
          // El campo da la hora local sin zona ("2026-10-30T17:00"); la base es UTC
          // y la guardaba como las 17 UTC: la difusión salía 3 horas antes.
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        })
        if (result.error) { toast.error(result.error); return }
        toast.success(
          result.csvCreated
            ? `Difusión creada · ${result.csvCreated} contacto(s) nuevos agregados`
            : 'Difusión creada',
        )
        onCreada(result.data as Difusion)
        onOpenChange(false)
      } catch (e) {
        avisarFalla(e, 'No se pudo crear la difusión. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const toggleSegment = (seg: string) => {
    setSelectedSegments(prev => prev.includes(seg) ? prev.filter(s => s !== seg) : [...prev, seg])
  }

  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds(prev => prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId])
  }

  const canAdvanceFromStep1 = !!name.trim() && (audienceMode === 'filters' || csvContacts.length > 0)
  const canAdvanceFromStep2 = !!selectedTemplate
  const canAdvanceFromStep3 = !hasVariables || templateVars.body.every(v => templateVarValues.body?.[v]?.trim()) &&
    templateVars.header.every(v => templateVarValues.header?.[v]?.trim())

  // Determinar el paso correcto según si hay variables
  const getStepContent = (step: number): Paso => {
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
  const paso = getStepContent(wizardStep)

  const irAlPaso = (n: number) => {
    setWizardStep(n)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  // En el celular, cada paso después del primero es una entrada del historial,
  // como las pantallas de Configuración: el «atrás» del sistema vuelve un paso,
  // igual que «‹ Atrás». Con una sola entrada para toda la hoja, ese atrás (el
  // botón de Android, o el borde del iPhone, que se dispara sin querer)
  // cerraba la hoja desde cualquier paso y se perdía lo cargado.
  useEntradaDeHoja(open && wizardStep >= 2, () => irAlPaso(1), 'paso-2')
  useEntradaDeHoja(open && wizardStep >= 3, () => irAlPaso(2), 'paso-3')
  useEntradaDeHoja(open && wizardStep >= 4, () => irAlPaso(3), 'paso-4')

  const puedeSeguir =
    (paso === 'audience' && canAdvanceFromStep1) ||
    (paso === 'template' && canAdvanceFromStep2) ||
    (paso === 'variables' && canAdvanceFromStep3)

  const valorDeVariable = (seccion: 'header' | 'body', v: string) => templateVarValues[seccion]?.[v] ?? ''
  const cambiarVariable = (seccion: 'header' | 'body', v: string, valor: string) =>
    setTemplateVarValues(prev => ({ ...prev, [seccion]: { ...prev[seccion], [v]: valor } }))

  // Un dato del cliente ({{primer_nombre}}) al final del último campo tocado (o
  // del primero, si todavía no se tocó ninguno): tipearlo en el celular cuesta.
  const agregarDato = (clave: string) => {
    const destino =
      ultimoCampo ??
      (templateVars.header[0] ? { seccion: 'header' as const, v: templateVars.header[0] } : templateVars.body[0] ? { seccion: 'body' as const, v: templateVars.body[0] } : null)
    if (!destino) return
    const actual = valorDeVariable(destino.seccion, destino.v)
    cambiarVariable(destino.seccion, destino.v, actual ? `${actual.replace(/\s+$/, '')} ${clave}` : clave)
    setUltimoCampo(destino)
  }

  const nombresDeSucursales = selectedBranchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id.slice(0, 8))
  const nombresDeSegmentos = selectedSegments.map((s) => SEGMENTS.find((x) => x.key === s)?.label ?? s)
  const ultimoPaso = wizardStep >= totalSteps

  return (
    <HojaWhatsApp
      open={open}
      onOpenChange={onOpenChange}
      titulo="Nueva difusión"
      subtitulo={`Paso ${wizardStep} de ${totalSteps} · ${NOMBRE_DEL_PASO[paso]}`}
      descripcion="Elegí a quién le llega, la plantilla de WhatsApp y cuándo sale."
      ancha
      cerrarAfuera={false}
      // En la compu, el foco al nombre; con pantalla táctil va a la hoja (HojaWhatsApp).
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        nombreRef.current?.focus()
      }}
      izquierda={wizardStep > 1 ? { texto: 'Atrás', atras: true, onClick: () => irAlPaso(wizardStep - 1) } : undefined}
      accion={
        ultimoPaso
          ? {
              texto: 'Crear',
              textoCargando: 'Creando…',
              onClick: handleCreate,
              deshabilitada: audienceCount === 0 || (programar && !scheduledFor),
              cargando: isCreating,
            }
          : { texto: 'Siguiente', onClick: () => irAlPaso(wizardStep + 1), deshabilitada: !puedeSeguir }
      }
    >
      {/* data-sin-volver: lo que empieza acá nunca es el gesto de volver de la
          capa de Difusiones (la hoja va en un portal, pero por las dudas). */}
      <div
        ref={scrollRef}
        data-sin-volver=""
        className={cn(
          'wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 lg:px-5 lg:pt-4',
          // Abajo, el área segura: en el paso de la audiencia la deja su barra.
          paso === 'audience' ? 'pb-6' : 'pb-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)] lg:pb-6',
        )}
      >
        {/* Step: Audiencia */}
        {paso === 'audience' && (
          <>
            <GrupoIos pie="Para encontrarla en la lista: los clientes no lo ven.">
              <CeldaIos campo>
                <input
                  ref={nombreRef}
                  aria-label="Nombre de la difusión"
                  placeholder="Nombre de la difusión"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={CLASE_CAMPO_CELDA}
                />
              </CeldaIos>
            </GrupoIos>

            <SegmentadoIos
              etiqueta="A quién le llega"
              className="mt-6"
              valor={audienceMode}
              onCambio={setAudienceMode}
              opciones={[
                { valor: 'filters', texto: 'Filtrar clientes', icono: SlidersHorizontal },
                { valor: 'csv', texto: 'Importar CSV', icono: FileSpreadsheet },
              ]}
            />

            {/* ── Modo CSV ────────────────────────────────────────── */}
            {audienceMode === 'csv' && (
              <>
                <input
                  ref={csvInputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) loadCsvFile(f) }}
                />

                {!csvResult ? (
                  // En la compu también se puede soltar el archivo encima.
                  <div
                    onDragOver={e => { e.preventDefault(); setCsvDragging(true) }}
                    onDragLeave={() => setCsvDragging(false)}
                    onDrop={e => {
                      e.preventDefault(); setCsvDragging(false)
                      const f = e.dataTransfer.files?.[0]; if (f) loadCsvFile(f)
                    }}
                    className={cn('rounded-[24px] transition-shadow lg:rounded-[14px]', csvDragging && 'ring-2 ring-[var(--wa-accent)]')}
                  >
                    <GrupoIos
                      pie={<>Necesita una columna de teléfono (whatsapp, telefono…) y, si querés, una de nombre. Hasta {CSV_MAX_CONTACTS} contactos. <span className="max-lg:hidden">También podés soltar el archivo acá.</span></>}
                    >
                      <CeldaAccionIos icono={Upload} onClick={() => csvInputRef.current?.click()}>
                        Elegir un archivo CSV
                      </CeldaAccionIos>
                    </GrupoIos>
                  </div>
                ) : (
                  <>
                    <GrupoIos titulo="Archivo">
                      <CeldaIos
                        icono={<IconoCeldaIos icono={FileText} color="verde" />}
                        derecha={
                          <span className="relative z-10 -mr-2 flex items-center">
                            <BotonTextoCeldaIos onClick={() => csvInputRef.current?.click()}>Cambiar</BotonTextoCeldaIos>
                            <BotonIconoIos etiqueta="Quitar el archivo" icono={X} onClick={clearCsv} />
                          </span>
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <p className={cn(TEXTO_PRINCIPAL, 'truncate')}>{csvFileName}</p>
                          <p className={cn(TEXTO_TERCIARIO, 'truncate')}>
                            {csvResult.totalRows} fila{csvResult.totalRows === 1 ? '' : 's'}
                            {csvResult.detected.phone && <> · teléfono: {csvResult.detected.phone}</>}
                            {csvResult.detected.name && <> · nombre: {csvResult.detected.name}</>}
                          </p>
                        </div>
                      </CeldaIos>
                    </GrupoIos>

                    {csvResult.error && <Aviso>{csvResult.error}</Aviso>}

                    <GrupoIos titulo="Contactos">
                      <FilaValor etiqueta="Válidos" valor={csvResult.contacts.length} tono="acento" />
                      <FilaValor etiqueta="Repetidos" valor={csvResult.duplicates} />
                      {csvResult.invalid.length > 0 ? (
                        <li className={CLASE_CELDA}>
                          <div className={CLASE_CUERPO_BOTON}>
                            <button
                              type="button"
                              aria-expanded={showCsvInvalid}
                              onClick={() => setShowCsvInvalid(v => !v)}
                              className={cn(CLASE_BOTON_CELDA, 'flex-row items-center gap-2')}
                            >
                              <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>Inválidos</span>
                              <span className="text-[17px] tabular-nums text-[var(--wa-danger)] lg:text-[14px]">{csvResult.invalid.length}</span>
                              <span className={cn(TEXTO_SECUNDARIO, 'text-[var(--wa-accent)]')}>{showCsvInvalid ? 'Ocultar' : 'Ver'}</span>
                            </button>
                          </div>
                        </li>
                      ) : (
                        <FilaValor etiqueta="Inválidos" valor={0} />
                      )}
                      {csvMatch && (
                        <>
                          <FilaValor etiqueta="Ya son clientes" valor={csvMatch.existing} icono={<IconoCeldaIos icono={Users} color="azul" />} />
                          <FilaValor etiqueta="Se van a crear" valor={csvMatch.nuevos} tono="acento" icono={<IconoCeldaIos icono={UserPlus} color="verde" />} />
                        </>
                      )}
                    </GrupoIos>

                    {showCsvInvalid && csvResult.invalid.length > 0 && (
                      <GrupoIos titulo="Filas inválidas" pie={csvResult.invalid.length > 50 ? `Y ${csvResult.invalid.length - 50} más.` : undefined}>
                        {csvResult.invalid.slice(0, 50).map((r, i) => (
                          <CeldaIos key={i}>
                            <div className="min-w-0 flex-1">
                              <p className={cn(TEXTO_SECUNDARIO, 'truncate text-[var(--wa-text)]')}>
                                Fila {r.row}: {r.name || 'sin nombre'}{r.raw && ` (${r.raw})`}
                              </p>
                              <p className={cn(TEXTO_TERCIARIO, 'text-[var(--wa-danger)]')}>{r.reason}</p>
                            </div>
                          </CeldaIos>
                        ))}
                      </GrupoIos>
                    )}

                    {csvResult.contacts.length > 0 && (
                      <GrupoIos
                        titulo="Vista previa"
                        pie={csvResult.contacts.length > 25 ? `Y ${csvResult.contacts.length - 25} contacto(s) más.` : undefined}
                      >
                        {csvResult.contacts.slice(0, 25).map((c) => (
                          <CeldaIos key={c.phone}>
                            <span className={cn(TEXTO_PRINCIPAL, 'min-w-0 flex-1 truncate', !c.name && 'text-[var(--wa-text-2)]')}>
                              {c.name || 'Sin nombre'}
                            </span>
                            <span className={cn(TEXTO_SECUNDARIO, 'shrink-0 tabular-nums')}>
                              {formatearTelefonoAr(c.phone) ?? `+54 ${c.phone}`}
                            </span>
                          </CeldaIos>
                        ))}
                      </GrupoIos>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Modo filtros ────────────────────────────────────── */}
            {audienceMode === 'filters' && (
              <>
                {branches.length > 1 && (
                  <GrupoIos titulo="Sucursales" pie="Sin elegir ninguna: los clientes de todas las sucursales.">
                    {branches.map(branch => (
                      <CeldaMarcaIos
                        key={branch.id}
                        marcada={selectedBranchIds.includes(branch.id)}
                        onCambio={() => toggleBranch(branch.id)}
                      >
                        <span className={TEXTO_PRINCIPAL}>{branch.name}</span>
                      </CeldaMarcaIos>
                    ))}
                  </GrupoIos>
                )}

                <GrupoIos titulo="Segmentos" pie="Sin elegir ninguno: todos los segmentos.">
                  {SEGMENTS.map(({ key, label, color }) => (
                    <CeldaMarcaIos key={key} marcada={selectedSegments.includes(key)} onCambio={() => toggleSegment(key)}>
                      <span className={cn(TEXTO_PRINCIPAL, 'flex items-center gap-3')}>
                        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', color)} />
                        {label}
                      </span>
                    </CeldaMarcaIos>
                  ))}
                </GrupoIos>

                <GrupoIos titulo="Actividad">
                  <CeldaSelectorIos
                    etiqueta="Último mensaje"
                    valor={String(contactRange)}
                    opciones={OPCIONES_CONTACTO}
                    onCambio={(v) => setContactRange(Number(v))}
                  />
                  <CeldaSelectorIos
                    etiqueta="Última visita"
                    valor={String(visitRange)}
                    opciones={OPCIONES_VISITA}
                    onCambio={(v) => setVisitRange(Number(v))}
                  />
                </GrupoIos>

                <GrupoIos titulo="Cantidad de visitas" pie="Para quedarte con los clientes que vinieron entre esas veces.">
                  <CampoNumero etiqueta="Mínimo" sinValor="Sin mínimo" valor={minVisits} onCambio={setMinVisits} />
                  <CampoNumero etiqueta="Máximo" sinValor="Sin máximo" valor={maxVisits} onCambio={setMaxVisits} />
                </GrupoIos>
              </>
            )}
          </>
        )}

        {/* Step: Template */}
        {paso === 'template' && (
          <GrupoIos
            titulo="Plantillas aprobadas"
            accion={
              <button
                type="button"
                onClick={handleSyncTemplates}
                disabled={syncingTemplates}
                title="Traer las plantillas nuevas aprobadas en Meta"
                className="-mr-2.5 flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-medium text-[var(--wa-accent)] outline-none transition-colors active:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px] lg:hover:bg-white/[0.07]"
              >
                <RefreshCw aria-hidden className={cn('size-4', syncingTemplates && 'animate-spin')} />
                Actualizar
              </button>
            }
            pie="Sólo las aprobadas por Meta. Las que tienen variables ({{1}}, {{2}}) se completan en el paso siguiente."
          >
            {syncingTemplates && aprobadas.length === 0 ? (
              <li><CargandoIos texto="Trayendo las plantillas…" /></li>
            ) : aprobadas.length === 0 ? (
              <>
                <CeldaIos>
                  <p className={cn(TEXTO_SECUNDARIO, 'flex-1')}>No hay plantillas aprobadas.</p>
                </CeldaIos>
                <CeldaAccionIos icono={RefreshCw} onClick={handleSyncTemplates}>Sincronizar desde Meta</CeldaAccionIos>
              </>
            ) : (
              aprobadas.map(tpl => {
                const cuerpo = cuerpoDePlantilla(tpl)
                return (
                  <CeldaMarcaIos
                    key={tpl.id}
                    rol="radio"
                    marcada={selectedTemplate === tpl.name}
                    onCambio={() => {
                      setSelectedTemplate(tpl.name)
                      setTemplateVarValues({})
                      setUltimoCampo(null)
                    }}
                  >
                    <span className={cn(TEXTO_PRINCIPAL, 'block truncate')}>{nombreDePlantilla(tpl.name)}</span>
                    <span className={cn(TEXTO_TERCIARIO, 'block')}>{datosDePlantilla(tpl)}</span>
                    {cuerpo && <span className={cn(TEXTO_SECUNDARIO, 'mt-1 line-clamp-2 block')}>{cuerpo}</span>}
                  </CeldaMarcaIos>
                )
              })
            )}
          </GrupoIos>
        )}

        {/* Step: Variables de template */}
        {paso === 'variables' && selectedTpl && (
          <>
            <GrupoIos titulo="Cómo le llega" pie="Con datos de ejemplo: a cada cliente le llegan los suyos.">
              <li className="wa-wallpaper relative flex min-h-24 items-end justify-end px-4 py-4">
                <div className="wa-bubble wa-bubble-out mr-2 max-w-[85%] whitespace-pre-wrap">
                  {selectedTpl.components?.map((comp, i) => {
                    if (comp.type === 'HEADER' && comp.text) return <p key={i} className="mb-1 font-semibold"><VistaPrevia texto={comp.text} valores={templateVarValues.header} /></p>
                    if (comp.type === 'BODY' && comp.text) return <p key={i}><VistaPrevia texto={comp.text} valores={templateVarValues.body} /></p>
                    if (comp.type === 'FOOTER' && comp.text) return <p key={i} className="mt-1 text-[13px] text-[var(--wa-meta-out)]">{comp.text}</p>
                    return null
                  })}
                </div>
              </li>
            </GrupoIos>

            {templateVars.header.length > 0 && (
              <GrupoIos titulo="Variables del encabezado">
                {templateVars.header.map(v => (
                  <CampoVariable
                    key={`header-${v}`}
                    nombre={v}
                    valor={valorDeVariable('header', v)}
                    onCambio={(valor) => cambiarVariable('header', v, valor)}
                    onFoco={() => setUltimoCampo({ seccion: 'header', v })}
                  />
                ))}
              </GrupoIos>
            )}

            {templateVars.body.length > 0 && (
              <GrupoIos titulo="Variables del texto">
                {templateVars.body.map(v => (
                  <CampoVariable
                    key={`body-${v}`}
                    nombre={v}
                    valor={valorDeVariable('body', v)}
                    onCambio={(valor) => cambiarVariable('body', v, valor)}
                    onFoco={() => setUltimoCampo({ seccion: 'body', v })}
                  />
                ))}
              </GrupoIos>
            )}

            <GrupoIos
              titulo="Datos de cada cliente"
              pie="Se reemplazan por los de cada cliente al enviar. Tocá uno para sumarlo al último campo que tocaste."
            >
              {PERSONALIZATION_VARS.map(v => (
                <li key={v.key} className={CLASE_CELDA}>
                  <div className={CLASE_CUERPO_BOTON}>
                    <button
                      type="button"
                      onClick={() => agregarDato(v.key)}
                      aria-label={`Agregar ${v.label.toLowerCase()} (${v.key})`}
                      className={cn(CLASE_BOTON_CELDA, 'flex-row items-center gap-3')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn(TEXTO_PRINCIPAL, 'block')}>{v.label}</span>
                        <span className={cn(TEXTO_TERCIARIO, 'block')}>{v.key} · por ejemplo, {v.example}</span>
                      </span>
                      <Plus aria-hidden className="size-5 shrink-0 text-[var(--wa-accent)] lg:size-4" strokeWidth={2.2} />
                    </button>
                  </div>
                </li>
              ))}
            </GrupoIos>
          </>
        )}

        {/* Step: Confirmar */}
        {paso === 'confirm' && (
          <>
            <GrupoIos titulo="Resumen">
              <FilaDato etiqueta="Nombre">{name || '—'}</FilaDato>
              <FilaDato etiqueta="Audiencia" tono="acento">
                {audienceCount ?? '—'} contacto{audienceCount === 1 ? '' : 's'}
              </FilaDato>
              {audienceMode === 'csv' && (
                <FilaDato etiqueta="Origen">
                  {csvFileName}
                  {!!csvMatch?.nuevos && <span className="text-[var(--wa-accent)]"> · {csvMatch.nuevos} nuevos</span>}
                </FilaDato>
              )}
              <FilaDato etiqueta="Plantilla">{selectedTemplate ? nombreDePlantilla(selectedTemplate) : '—'}</FilaDato>
              {audienceMode === 'filters' && nombresDeSucursales.length > 0 && (
                <FilaDato etiqueta="Sucursales">{nombresDeSucursales.join(', ')}</FilaDato>
              )}
              {audienceMode === 'filters' && nombresDeSegmentos.length > 0 && (
                <FilaDato etiqueta="Segmentos">{nombresDeSegmentos.join(', ')}</FilaDato>
              )}
            </GrupoIos>

            {hasVariables && (
              <GrupoIos titulo="Variables">
                {Object.entries(templateVarValues).map(([section, vars]) => (
                  Object.entries(vars).map(([key, val]) => (
                    <FilaDato key={`${section}-${key}`} etiqueta={`${section === 'header' ? 'Encabezado' : 'Texto'} {{${key}}}`}>
                      {val || '—'}
                    </FilaDato>
                  ))
                ))}
              </GrupoIos>
            )}

            <GrupoIos
              titulo="Envío"
              pie={
                programar
                  ? 'Queda como borrador hasta que toques «Programar» en la lista; ahí sale sola el día y a la hora que elegiste.'
                  : 'Queda como borrador: la mandás desde la lista, con «Enviar».'
              }
            >
              <CeldaIos derecha={
                <InterruptorIos
                  activo={programar}
                  etiqueta="Programar el envío"
                  onCambio={(si) => {
                    setProgramar(si)
                    if (!si) setScheduledFor('')
                  }}
                />
              }>
                <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>Programar el envío</span>
              </CeldaIos>
              {programar && (
                <CeldaIos>
                  {/* De 24 h: el datetime-local del navegador salía "05:00 p. m." (campo-fecha-hora.tsx). */}
                  <div className="min-w-0 flex-1 py-0.5">
                    <CampoFechaHora
                      valor={scheduledFor}
                      onCambio={setScheduledFor}
                      claseCampo="h-11 rounded-[10px] bg-[var(--wa-raised-2)] px-3 text-[17px] text-[var(--wa-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/50 lg:h-9 lg:rounded-md lg:pointer-fine:text-[14px]"
                    />
                  </div>
                </CeldaIos>
              )}
            </GrupoIos>

            {audienceCount === 0 && (
              <Aviso>
                {audienceMode === 'csv'
                  ? 'El CSV no tiene teléfonos válidos'
                  : 'No hay clientes que coincidan con los filtros seleccionados'}
              </Aviso>
            )}
          </>
        )}
      </div>

      {/* La audiencia, fija abajo mientras se eligen los filtros (o el CSV). */}
      {paso === 'audience' && (
        <div
          className="flex shrink-0 items-center gap-3 border-t-[0.5px] border-[var(--wa-divider)] bg-[var(--wa-bar)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-xl lg:bg-transparent lg:px-5 lg:pb-3 lg:backdrop-blur-none"
        >
          <IconoCeldaIos icono={Users} color="verde" />
          <p className="min-w-0 flex-1 text-[15px] text-[var(--wa-text)] lg:text-[13px]">
            {audienceMode === 'csv' ? 'Destinatarios del CSV' : 'Audiencia estimada'}
          </p>
          <p aria-live="polite" className="text-[22px] font-semibold tabular-nums leading-none text-[var(--wa-accent)] lg:text-[18px]">
            {previewLoading ? (
              <>
                <Loader2 aria-hidden className="size-5 animate-spin text-[var(--wa-text-2)]" />
                <span className="sr-only">Calculando</span>
              </>
            ) : (
              audienceCount ?? '—'
            )}
          </p>
        </div>
      )}
    </HojaWhatsApp>
  )
}

function FilaValor({
  etiqueta,
  valor,
  tono,
  icono,
}: {
  etiqueta: string
  valor: number
  tono?: 'acento'
  icono?: ReactNode
}) {
  return (
    <CeldaIos icono={icono}>
      <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>{etiqueta}</span>
      <span className={cn('text-[17px] tabular-nums lg:text-[14px]', tono === 'acento' ? 'text-[var(--wa-accent)]' : 'text-[var(--wa-text-2)]')}>
        {valor}
      </span>
    </CeldaIos>
  )
}

/** Un dato del resumen: la etiqueta a la izquierda y el valor a la derecha, que puede ocupar varias líneas. */
function FilaDato({ etiqueta, tono, children }: { etiqueta: string; tono?: 'acento'; children: ReactNode }) {
  return (
    <CeldaIos cuerpoClassName="items-start">
      <span className={cn(TEXTO_PRINCIPAL, 'shrink-0')}>{etiqueta}</span>
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-right text-[17px] leading-[22px] lg:text-[14px] lg:leading-5',
          tono === 'acento' ? 'font-semibold text-[var(--wa-accent)]' : 'text-[var(--wa-text-2)]',
        )}
      >
        {children}
      </span>
    </CeldaIos>
  )
}

function CampoNumero({
  etiqueta,
  sinValor,
  valor,
  onCambio,
}: {
  etiqueta: string
  /** Lo que se lee con el campo vacío ("Sin mínimo"). */
  sinValor: string
  valor: string
  onCambio: (valor: string) => void
}) {
  return (
    <CeldaIos campo>
      <label className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>{etiqueta}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          placeholder={sinValor}
          value={valor}
          onChange={e => onCambio(e.target.value)}
          className={cn(CLASE_CAMPO_CELDA, 'w-32 flex-none text-right tabular-nums')}
        />
      </label>
    </CeldaIos>
  )
}

function CampoVariable({
  nombre,
  valor,
  onCambio,
  onFoco,
}: {
  nombre: string
  valor: string
  onCambio: (valor: string) => void
  onFoco: () => void
}) {
  return (
    <CeldaIos campo>
      <label className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn(TEXTO_SECUNDARIO, 'w-12 shrink-0 tabular-nums')}>{`{{${nombre}}}`}</span>
        <input
          placeholder="{{primer_nombre}} o un texto"
          value={valor}
          onChange={e => onCambio(e.target.value)}
          onFocus={onFoco}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={CLASE_CAMPO_CELDA}
        />
      </label>
    </CeldaIos>
  )
}

const EJEMPLOS: Record<string, string> = Object.fromEntries(PERSONALIZATION_VARS.map(v => [v.key, v.example]))

/**
 * El texto de la plantilla con lo que va en cada variable: lo escrito, con los
 * datos del cliente del ejemplo ({{primer_nombre}} → «Juan»), marcado como en
 * un resaltado. Una variable todavía vacía queda como {{1}}, apagada.
 */
function VistaPrevia({ texto, valores }: { texto: string; valores?: Record<string, string> }) {
  return (
    <>
      {trozosDePlantilla(texto).map((t, i) => {
        if (t.tipo === 'texto') return <Fragment key={i}>{t.texto}</Fragment>
        const valor = valores?.[String(t.numero)]?.trim()
        return valor ? (
          <span key={i} className="rounded-[5px] bg-white/[0.12] px-[3px]">
            {valor.replace(/\{\{\s*[a-z_]+\s*\}\}/g, (m) => EJEMPLOS[m.replace(/\s/g, '')] ?? m)}
          </span>
        ) : (
          <span key={i} className="text-[var(--wa-meta-out)]">{`{{${t.numero}}}`}</span>
        )
      })}
    </>
  )
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-[16px] bg-[var(--wa-danger)]/12 px-4 py-3 text-[15px] leading-5 text-[var(--wa-danger)] lg:rounded-lg lg:text-[13px] lg:leading-[18px]">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
