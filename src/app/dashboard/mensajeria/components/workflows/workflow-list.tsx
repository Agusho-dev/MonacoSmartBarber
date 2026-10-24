'use client'

// Automatizaciones, como una pantalla de WhatsApp para iOS (23/oct/2026,
// tercera ronda; se llamaban «Workflows» en un lado y «Automatizaciones» en
// otro). Una celda por automatización: el ícono de cómo se activa, el nombre,
// qué hace, si está activa y el interruptor de iOS para prenderla o apagarla;
// el «…» tiene editar, duplicar y eliminar, y tocar la celda abre el editor.
// La nueva automatización es una hoja (en el celular, la de iOS de pantalla
// entera; en la compu, el diálogo de la Mac). El editor (pantalla completa) no
// cambió.

import { useEffect, useState, useTransition } from 'react'
import {
  CalendarDays, Clock, Copy, Ellipsis, GitBranch, Inbox, MessageSquare, Pencil, Plus, RefreshCw, Trash2, Zap,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getWorkflows, createWorkflow, deleteWorkflow, toggleWorkflow,
  duplicateWorkflow,
} from '@/lib/actions/workflows'
import type { AutomationWorkflow } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { useMensajeria } from '../shared/mensajeria-context'
import { nombreLegibleDePlantilla } from '../shared/helpers'
import { HojaWhatsApp } from '../dialogs/hoja-whatsapp'
import { useEntradaDeHoja } from '../inbox/entrada-de-hoja'
import { WorkflowBuilder } from './workflow-builder'
import { AccionDeBarraIos, BotonMasIos, BotonPrincipal, EncabezadoSeccion } from '../navegacion/barra-ios'
import {
  BotonPildoraIos, CargandoIos, CeldaAccionIos, CeldaIos, CeldaMarcaIos, CeldaSelectorIos, CLASE_BOTON_CELDA,
  CLASE_CAMPO_CELDA, CLASE_CELDA, CLASE_CUERPO_BOTON, CLASE_ITEM_MENU_IOS, CLASE_MENU_IOS, ConfirmacionIos, ContenidoSeccion,
  GrupoIos, IconoCeldaIos, InterruptorIos, SegmentadoIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, VacioIos,
  avisarFalla, type ColorIcono,
} from '../navegacion/lista-ios'
import { messageReceivedTriggerSummary } from './message-received-trigger-config'

const TRIGGER_TYPES: { value: string; label: string; icon: LucideIcon; color: ColorIcono; description: string }[] = [
  { value: 'message_received', label: 'Cualquier mensaje', icon: Inbox, color: 'celeste', description: 'Incluye el modo bienvenida y el silencio después de otras automatizaciones.' },
  { value: 'keyword', label: 'Palabra clave', icon: MessageSquare, color: 'verde', description: 'Cuando un mensaje tiene alguna de las palabras clave.' },
  { value: 'template_reply', label: 'Respuesta a una plantilla', icon: GitBranch, color: 'violeta', description: 'Cuando un cliente responde a una plantilla (por ejemplo, los botones de reseña).' },
  { value: 'post_service', label: 'Después del servicio', icon: Clock, color: 'naranja', description: 'Manda un mensaje después de cobrar el servicio.' },
  { value: 'days_after_visit', label: 'Seguimiento', icon: CalendarDays, color: 'azul', description: 'Manda un mensaje unos días después de la última visita.' },
]

const CHANNEL_OPTIONS = [
  { valor: 'all', texto: 'Todos los canales' },
  { valor: 'whatsapp', texto: 'WhatsApp' },
  { valor: 'instagram', texto: 'Instagram' },
]

const COINCIDENCIA = [
  { valor: 'contains', texto: 'Contiene la palabra' },
  { valor: 'exact', texto: 'Exacta' },
]

type WorkflowWithBranch = AutomationWorkflow & { branch?: { id: string; name: string } | null }

function tipoDe(type: string) {
  return TRIGGER_TYPES.find(t => t.value === type) ?? { value: type, label: type, icon: Zap, color: 'gris' as const, description: '' }
}

/** Qué la dispara, en una línea: «Palabra clave: horarios, precios». */
function resumenDelDisparador(wf: WorkflowWithBranch): string {
  const tc = (wf.trigger_config ?? {}) as Record<string, unknown>
  switch (wf.trigger_type) {
    case 'keyword': {
      const palabras = Array.isArray(tc.keywords) ? (tc.keywords as string[]).slice(0, 4) : []
      return palabras.length ? `Palabra clave: ${palabras.join(', ')}` : 'Palabra clave'
    }
    case 'template_reply':
      return typeof tc.template_name === 'string' && tc.template_name
        ? `Respuesta a «${nombreLegibleDePlantilla(tc.template_name)}»`
        : 'Respuesta a una plantilla'
    case 'post_service':
      return typeof tc.delay_minutes === 'number' ? `${tc.delay_minutes} min después del servicio` : 'Después del servicio'
    case 'days_after_visit':
      return typeof tc.delay_days === 'number'
        ? `${tc.delay_days} día${tc.delay_days === 1 ? '' : 's'} después de la última visita`
        : 'Seguimiento después de la visita'
    case 'message_received':
      return ['Cualquier mensaje', ...messageReceivedTriggerSummary(tc)].join(' · ')
    default:
      return tipoDe(wf.trigger_type).label
  }
}

/** «WhatsApp», «WhatsApp e Instagram»; null con todos los canales (lo de siempre no se dice). */
function canalesDe(channels: string[]): string | null {
  if (!channels?.length || channels.includes('all')) return null
  return channels.map(c => c === 'whatsapp' ? 'WhatsApp' : c === 'instagram' ? 'Instagram' : c).join(' e ')
}

export function WorkflowList() {
  const { branches } = useMensajeria()
  const [workflows, setWorkflows] = useState<WorkflowWithBranch[]>([])
  const [lectura, setLectura] = useState<{ pedido: number; cargando: boolean; error: string | null }>({ pedido: 0, cargando: true, error: null })
  const [nueva, setNueva] = useState({ abierta: false, vez: 0 })
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [aEliminar, setAEliminar] = useState<{ wf: WorkflowWithBranch; abierta: boolean } | null>(null)

  const [isCreating, startCreating] = useTransition()
  const [isToggling, startToggling] = useTransition()

  useEffect(() => {
    let vigente = true
    getWorkflows()
      .then(wfResult => {
        if (!vigente) return
        if (wfResult.data) setWorkflows(wfResult.data)
        setLectura(l => ({ ...l, cargando: false, error: wfResult.error }))
      })
      .catch(() => {
        if (vigente) setLectura(l => ({ ...l, cargando: false, error: 'No pudimos leer las automatizaciones. Revisá la conexión.' }))
      })
    return () => { vigente = false }
  }, [lectura.pedido])

  const abrirNueva = () => setNueva(n => ({ abierta: true, vez: n.vez + 1 }))

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteWorkflow(id)
      if (result.error) { toast.error(result.error); return }
      setWorkflows(prev => prev.filter(w => w.id !== id))
      toast.success('Automatización eliminada')
    } catch (e) {
      avisarFalla(e, 'No se pudo eliminar. Revisá la conexión y probá de nuevo.')
    }
  }

  const handleDuplicate = (id: string) => {
    startCreating(async () => {
      try {
        const result = await duplicateWorkflow(id)
        if (result.error) { toast.error(result.error); return }
        if (result.data) {
          setWorkflows(prev => [result.data!, ...prev])
          toast.success('Automatización duplicada')
          setEditingWorkflowId(result.data.id)
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo duplicar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleToggle = (id: string, isActive: boolean) => {
    startToggling(async () => {
      try {
        const result = await toggleWorkflow(id, isActive)
        if (result.error) { toast.error(result.error); return }
        setWorkflows(prev => prev.map(w => w.id === id ? { ...w, is_active: isActive } : w))
      } catch (e) {
        avisarFalla(e, 'No se pudo cambiar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const filteredWorkflows = branchFilter
    ? workflows.filter(wf => !wf.branch_id || wf.branch_id === branchFilter)
    : workflows

  // Del editor se vuelve a la lista, que se relee (el editor pudo cambiar el nombre o el estado).
  const salirDelEditor = () => {
    setEditingWorkflowId(null)
    getWorkflows()
      .then(r => { if (r.data) setWorkflows(r.data) })
      .catch(() => { /* queda la lista que había */ })
  }
  // En el celular, el editor es una entrada del historial encima de la sección
  // (#/seccion/editor): el «atrás» del sistema sale del editor, como su botón
  // de volver, y no cierra la sección entera (entrada-de-hoja.ts).
  useEntradaDeHoja(!!editingWorkflowId, salirDelEditor, 'editor')

  // Editor a pantalla completa: el lienzo toma prioridad (encima de la columna
  // de secciones y de la barra de iOS de Mensajería). Abajo deja el área
  // segura, para que la rayita de inicio del iPhone no tape sus botones.
  // data-sin-volver: en el celular el editor vive adentro de la capa de la
  // sección, y deslizar desde el borde la cerraba entera (con los cambios sin
  // guardar). Del editor se sale con su botón de volver. Conserva la letra del
  // dashboard (font-sans): el editor no es una pantalla de WhatsApp.
  if (editingWorkflowId) {
    return (
      <div data-sin-volver="" className="fixed inset-0 z-[100] flex flex-col bg-background pb-[env(safe-area-inset-bottom,0px)] font-sans text-foreground">
        <WorkflowBuilder workflowId={editingWorkflowId} onBack={salirDelEditor} />
      </div>
    )
  }

  const activas = workflows.filter(w => w.is_active).length
  const opcionesSucursal = [
    { valor: '', texto: 'Todas' },
    ...branches.map(b => ({ valor: b.id, texto: b.name })),
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AccionDeBarraIos>
        <BotonMasIos etiqueta="Nueva automatización" onClick={abrirNueva} />
      </AccionDeBarraIos>
      <EncabezadoSeccion
        titulo="Automatizaciones"
        subtitulo={workflows.length > 0 ? `${activas} activa${activas === 1 ? '' : 's'} de ${workflows.length}` : undefined}
      >
        <BotonPrincipal onClick={abrirNueva}>
          <Plus aria-hidden className="size-3.5" strokeWidth={2.5} /> Nueva automatización
        </BotonPrincipal>
      </EncabezadoSeccion>

      <ContenidoSeccion>
        {branches.length > 1 && workflows.length > 0 && (
          <GrupoIos pie="Las generales se ven con cualquier sucursal.">
            <CeldaSelectorIos
              etiqueta="Sucursal"
              valor={branchFilter ?? ''}
              opciones={opcionesSucursal}
              onCambio={(v) => setBranchFilter(v || null)}
            />
          </GrupoIos>
        )}

        {lectura.cargando && workflows.length === 0 ? (
          <CargandoIos texto="Cargando automatizaciones…" />
        ) : lectura.error && workflows.length === 0 ? (
          <VacioIos icono={Zap} titulo="No pudimos leer las automatizaciones" texto={lectura.error}>
            <BotonPildoraIos icono={RefreshCw} onClick={() => setLectura(l => ({ pedido: l.pedido + 1, cargando: true, error: null }))}>
              Reintentar
            </BotonPildoraIos>
          </VacioIos>
        ) : filteredWorkflows.length === 0 ? (
          <VacioIos
            icono={Zap}
            titulo="Sin automatizaciones"
            texto={branchFilter ? 'Esta sucursal no tiene automatizaciones propias ni generales.' : 'Respondé solo, pedí reseñas y hacé el seguimiento de los clientes sin estar encima.'}
          >
            {!branchFilter && <BotonPildoraIos icono={Plus} onClick={abrirNueva}>Nueva automatización</BotonPildoraIos>}
          </VacioIos>
        ) : (
          <GrupoIos>
            {filteredWorkflows.map(wf => {
              const tipo = tipoDe(wf.trigger_type)
              return (
                <li key={wf.id} className={cn(CLASE_CELDA, 'items-start')}>
                  <IconoCeldaIos icono={tipo.icon} color={wf.is_active ? tipo.color : 'gris'} className="mt-3 lg:mt-2.5" />
                  <div className={cn(CLASE_CUERPO_BOTON, 'gap-1')}>
                    <button type="button" onClick={() => setEditingWorkflowId(wf.id)} className={cn(CLASE_BOTON_CELDA, 'py-3 lg:py-2.5')}>
                      <span className={cn(TEXTO_PRINCIPAL, 'line-clamp-2 block font-semibold')}>{wf.name}</span>
                      <span className={cn(TEXTO_SECUNDARIO, 'mt-0.5 line-clamp-2 block')}>
                        {wf.description || resumenDelDisparador(wf)}
                      </span>
                      {/* El estado y lo que no es lo de siempre: el disparador (si arriba
                          va la descripción), el canal y la sucursal, si no son todos. */}
                      <span className={cn(TEXTO_TERCIARIO, 'mt-0.5 block')}>
                        <span className={wf.is_active ? 'text-[var(--wa-accent)]' : undefined}>{wf.is_active ? 'Activa' : 'Pausada'}</span>
                        {[wf.description ? tipo.label : null, canalesDe(wf.channels), wf.branch?.name]
                          .filter(Boolean)
                          .map((dato) => ` · ${dato}`)
                          .join('')}
                      </span>
                    </button>
                    <div className="relative z-10 flex shrink-0 items-center gap-0.5 self-center">
                      <MenuDeAutomatizacion
                        nombre={wf.name}
                        ocupado={isCreating}
                        onEditar={() => setEditingWorkflowId(wf.id)}
                        onDuplicar={() => handleDuplicate(wf.id)}
                        onEliminar={() => setAEliminar({ wf, abierta: true })}
                      />
                      <InterruptorIos
                        activo={wf.is_active}
                        etiqueta={wf.is_active ? `Pausar «${wf.name}»` : `Activar «${wf.name}»`}
                        deshabilitado={isToggling}
                        onCambio={(activa) => handleToggle(wf.id, activa)}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </GrupoIos>
        )}
      </ContenidoSeccion>

      <HojaNuevaAutomatizacion
        key={nueva.vez}
        open={nueva.abierta}
        onOpenChange={(abierta) => setNueva(n => ({ ...n, abierta }))}
        onCreada={(wf) => {
          setWorkflows(prev => [wf, ...prev])
          setEditingWorkflowId(wf.id)
        }}
      />

      <ConfirmacionIos
        abierta={!!aEliminar?.abierta}
        onAbiertaCambio={(abierta) => setAEliminar(a => (a ? { ...a, abierta } : a))}
        titulo="¿Eliminar la automatización?"
        texto={aEliminar ? `«${aEliminar.wf.name}» y todos sus pasos se borran. No se puede deshacer.` : ''}
        accion="Eliminar"
        onConfirmar={() => { if (aEliminar) void handleDelete(aEliminar.wf.id) }}
      />
    </div>
  )
}

function MenuDeAutomatizacion({
  nombre,
  ocupado,
  onEditar,
  onDuplicar,
  onEliminar,
}: {
  nombre: string
  ocupado: boolean
  onEditar: () => void
  onDuplicar: () => void
  onEliminar: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Más opciones de «${nombre}»`}
          className="flex size-11 items-center justify-center rounded-full text-[var(--wa-text-2)] outline-none transition-colors [-webkit-tap-highlight-color:transparent] active:bg-white/10 data-[state=open]:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:size-8 lg:hover:bg-white/[0.07]"
        >
          <Ellipsis aria-hidden className="size-[22px] lg:size-[18px]" strokeWidth={2.2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} collisionPadding={12} className={CLASE_MENU_IOS}>
        <DropdownMenuItem onSelect={onEditar} className={CLASE_ITEM_MENU_IOS}>
          <Pencil aria-hidden strokeWidth={1.9} /> Editar
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicar} disabled={ocupado} className={CLASE_ITEM_MENU_IOS}>
          <Copy aria-hidden strokeWidth={1.9} /> Duplicar
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5 h-[0.5px] bg-white/[0.14] lg:-mx-1 lg:my-1" />
        <DropdownMenuItem onSelect={onEliminar} variant="destructive" className={CLASE_ITEM_MENU_IOS}>
          <Trash2 aria-hidden strokeWidth={1.9} /> Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** La hoja de una automatización nueva. Al crearla se abre el editor. */
function HojaNuevaAutomatizacion({
  open,
  onOpenChange,
  onCreada,
}: {
  open: boolean
  onOpenChange: (abierta: boolean) => void
  onCreada: (wf: WorkflowWithBranch) => void
}) {
  const { waTemplates, handleSyncTemplates, syncingTemplates, branches } = useMensajeria()
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [createEmpty, setCreateEmpty] = useState(true)
  const [formTriggerType, setFormTriggerType] = useState('message_received')
  const [formChannel, setFormChannel] = useState('all')
  const [formKeywords, setFormKeywords] = useState('')
  const [formMatchMode, setFormMatchMode] = useState('contains')
  const [formTemplateName, setFormTemplateName] = useState('')
  const [formDelayMinutes, setFormDelayMinutes] = useState(15)
  const [formDelayDays, setFormDelayDays] = useState(7)
  const [formBranchId, setFormBranchId] = useState<string>('')
  const [isCreating, startCreating] = useTransition()

  const buildTriggerConfig = () => {
    if (formTriggerType === 'keyword') {
      return {
        keywords: formKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
        match_mode: formMatchMode,
      }
    }
    if (formTriggerType === 'template_reply') {
      return { template_name: formTemplateName }
    }
    if (formTriggerType === 'post_service') {
      return { delay_minutes: formDelayMinutes }
    }
    if (formTriggerType === 'days_after_visit') {
      return { delay_days: formDelayDays }
    }
    return {}
  }

  const handleCreate = () => {
    if (!formName.trim()) { toast.error('El nombre es requerido'); return }

    if (!createEmpty) {
      if (formTriggerType === 'keyword') {
        const kws = formKeywords.split(',').filter(k => k.trim())
        if (kws.length === 0) { toast.error('Las palabras clave son requeridas'); return }
      }
      if (formTriggerType === 'template_reply' && !formTemplateName.trim()) {
        toast.error('Elegí la plantilla'); return
      }
    }

    startCreating(async () => {
      try {
        const result = await createWorkflow(createEmpty ? {
          name: formName,
          description: formDescription || undefined,
          branch_id: formBranchId || null,
        } : {
          name: formName,
          description: formDescription || undefined,
          channels: [formChannel],
          trigger_type: formTriggerType,
          trigger_config: buildTriggerConfig(),
          branch_id: formBranchId || null,
        })
        if (result.error) { toast.error(result.error); return }
        if (result.data) {
          onOpenChange(false)
          onCreada(result.data)
          toast.success(createEmpty ? 'Automatización creada. Configurá cómo se activa y los pasos.' : 'Automatización creada. Configurá los pasos.')
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo crear la automatización. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const aprobadas = waTemplates.filter(t => t.status === 'approved')

  return (
    <HojaWhatsApp
      open={open}
      onOpenChange={onOpenChange}
      titulo="Nueva automatización"
      descripcion="El nombre, la sucursal y cómo se activa. Los pasos se arman después en el editor."
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        document.getElementById('automatizacion-nombre')?.focus()
      }}
      accion={{ texto: 'Crear', textoCargando: 'Creando…', onClick: handleCreate, deshabilitada: !formName.trim(), cargando: isCreating }}
    >
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)] lg:px-5 lg:pb-6 lg:pt-4">
        <GrupoIos pie="Por ejemplo, «Encuesta de satisfacción». La descripción es para el equipo: los clientes no la ven.">
          <CeldaIos campo>
            <input
              id="automatizacion-nombre"
              aria-label="Nombre"
              placeholder="Nombre"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className={CLASE_CAMPO_CELDA}
            />
          </CeldaIos>
          <CeldaIos campo>
            <textarea
              aria-label="Descripción"
              rows={2}
              placeholder="Qué hace (opcional)"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              className={cn(CLASE_CAMPO_CELDA, 'h-auto min-h-[4.5rem] resize-none py-2.5 leading-[22px] lg:h-auto lg:min-h-14 lg:py-2 lg:leading-5')}
            />
          </CeldaIos>
        </GrupoIos>

        {branches.length > 1 && (
          <GrupoIos pie="Una general corre en todas las sucursales.">
            <CeldaSelectorIos
              etiqueta="Sucursal"
              valor={formBranchId}
              opciones={[{ valor: '', texto: 'Todas (general)' }, ...branches.map(b => ({ valor: b.id, texto: b.name }))]}
              onCambio={setFormBranchId}
            />
          </GrupoIos>
        )}

        <section className="mt-7">
          <h2 className="px-4 pb-1.5 text-[13px] font-semibold leading-[18px] text-[var(--wa-text-2)] lg:px-3 lg:text-[12px]">Cómo se activa</h2>
          <SegmentadoIos
            etiqueta="Cuándo se configura cómo se activa"
            valor={createEmpty ? 'despues' : 'ahora'}
            onCambio={(v) => setCreateEmpty(v === 'despues')}
            opciones={[
              { valor: 'despues', texto: 'En el editor' },
              { valor: 'ahora', texto: 'Ahora' },
            ]}
          />
          {createEmpty && (
            <p className="px-4 pt-2 text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:px-3 lg:text-[12px] lg:leading-4">
              Se crea con «Cualquier mensaje» y lo cambiás en el editor.
            </p>
          )}
        </section>

        {!createEmpty && (
          <>
            <GrupoIos>
              <CeldaSelectorIos etiqueta="Canal" valor={formChannel} opciones={CHANNEL_OPTIONS} onCambio={setFormChannel} />
            </GrupoIos>

            <GrupoIos titulo="Se activa con">
              {TRIGGER_TYPES.map(t => (
                <CeldaMarcaIos
                  key={t.value}
                  rol="radio"
                  marcada={formTriggerType === t.value}
                  icono={<IconoCeldaIos icono={t.icon} color={t.color} />}
                  onCambio={() => {
                    setFormTriggerType(t.value)
                    if ((t.value === 'template_reply') && waTemplates.length === 0) handleSyncTemplates()
                  }}
                >
                  <span className={cn(TEXTO_PRINCIPAL, 'block')}>{t.label}</span>
                  <span className={cn(TEXTO_TERCIARIO, 'block')}>{t.description}</span>
                </CeldaMarcaIos>
              ))}
            </GrupoIos>

            {formTriggerType === 'keyword' && (
              <GrupoIos titulo="Palabras clave" pie="Separadas por coma.">
                <CeldaIos campo>
                  <input
                    aria-label="Palabras clave"
                    placeholder="horarios, precios, abierto"
                    value={formKeywords}
                    onChange={e => setFormKeywords(e.target.value)}
                    autoCapitalize="off"
                    className={CLASE_CAMPO_CELDA}
                  />
                </CeldaIos>
                <CeldaSelectorIos etiqueta="Coincidencia" valor={formMatchMode} opciones={COINCIDENCIA} onCambio={setFormMatchMode} />
              </GrupoIos>
            )}

            {formTriggerType === 'template_reply' && (
              <GrupoIos
                titulo="Plantilla"
                accion={
                  <button
                    type="button"
                    onClick={handleSyncTemplates}
                    disabled={syncingTemplates}
                    className="-mr-2.5 flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-medium text-[var(--wa-accent)] outline-none transition-colors active:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px] lg:hover:bg-white/[0.07]"
                  >
                    <RefreshCw aria-hidden className={cn('size-4', syncingTemplates && 'animate-spin')} />
                    Sincronizar
                  </button>
                }
                pie="Se activa cuando un cliente responde a esta plantilla (por ejemplo, los botones de calificación)."
              >
                {syncingTemplates && aprobadas.length === 0 ? (
                  <li><CargandoIos texto="Trayendo las plantillas…" /></li>
                ) : aprobadas.length === 0 ? (
                  <CeldaAccionIos icono={RefreshCw} onClick={handleSyncTemplates}>Sincronizar las plantillas</CeldaAccionIos>
                ) : (
                  <CeldaSelectorIos
                    etiqueta="Plantilla"
                    valor={formTemplateName}
                    opciones={[
                      { valor: '', texto: 'Elegir…' },
                      ...aprobadas.map(tpl => ({ valor: tpl.name, texto: `${nombreLegibleDePlantilla(tpl.name)} (${tpl.language})` })),
                    ]}
                    onCambio={setFormTemplateName}
                  />
                )}
              </GrupoIos>
            )}

            {formTriggerType === 'post_service' && (
              <GrupoIos titulo="Demora" pie="Cuánto después de cobrar el servicio sale el mensaje.">
                <CeldaNumero etiqueta="Minutos" valor={formDelayMinutes} min={0} max={1440} onCambio={(n) => setFormDelayMinutes(n || 0)} />
              </GrupoIos>
            )}

            {formTriggerType === 'days_after_visit' && (
              <GrupoIos titulo="Demora" pie="Cuántos días después de la última visita sale el mensaje.">
                <CeldaNumero etiqueta="Días" valor={formDelayDays} min={1} max={365} onCambio={(n) => setFormDelayDays(n || 1)} />
              </GrupoIos>
            )}
          </>
        )}
      </div>
    </HojaWhatsApp>
  )
}

function CeldaNumero({
  etiqueta,
  valor,
  min,
  max,
  onCambio,
}: {
  etiqueta: string
  valor: number
  min: number
  max: number
  onCambio: (n: number) => void
}) {
  return (
    <CeldaIos campo>
      <label className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>{etiqueta}</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={valor}
          onChange={e => onCambio(parseInt(e.target.value))}
          className={cn(CLASE_CAMPO_CELDA, 'w-24 flex-none text-right tabular-nums')}
        />
      </label>
    </CeldaIos>
  )
}
