'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useTransition } from 'react'
import {
  ArrowLeft, Save, Plus, ZoomIn, ZoomOut, Maximize2,
  MessageSquare, Image, LayoutGrid, List, Tag,
  GitBranch, Bell, Clock, Send, Trash2, Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { getWorkflow, saveWorkflowGraph, updateWorkflow } from '@/lib/actions/workflows'
import type { WorkflowNode, WorkflowEdge, WorkflowWithGraph, WorkflowNodeType } from '@/lib/types/database'
import { WorkflowNodeEditor } from './workflow-node-editor'

// ─── Constantes ──────────────────────────────────────────────────

const NODE_TYPES = [
  { type: 'send_message', label: 'Enviar mensaje', icon: MessageSquare, color: '#22c55e', category: 'Mensajes' },
  { type: 'send_media', label: 'Enviar multimedia', icon: Image, color: '#3b82f6', category: 'Mensajes' },
  { type: 'send_buttons', label: 'Enviar botones', icon: LayoutGrid, color: '#8b5cf6', category: 'Mensajes' },
  { type: 'send_list', label: 'Enviar lista', icon: List, color: '#6366f1', category: 'Mensajes' },
  { type: 'send_template', label: 'Enviar template', icon: Send, color: '#06b6d4', category: 'Mensajes' },
  { type: 'condition', label: 'Condición', icon: GitBranch, color: '#f59e0b', category: 'Lógica' },
  { type: 'wait_reply', label: 'Esperar respuesta', icon: Clock, color: '#ec4899', category: 'Lógica' },
  { type: 'delay', label: 'Esperar tiempo', icon: Clock, color: '#78716c', category: 'Lógica' },
  { type: 'add_tag', label: 'Agregar etiqueta', icon: Tag, color: '#14b8a6', category: 'Acciones' },
  { type: 'remove_tag', label: 'Quitar etiqueta', icon: Tag, color: '#f43f5e', category: 'Acciones' },
  { type: 'crm_alert', label: 'Alerta CRM', icon: Bell, color: '#ef4444', category: 'Acciones' },
] as const

function getNodeMeta(type: string) {
  return NODE_TYPES.find(n => n.type === type) ?? { type, label: type, icon: MessageSquare, color: '#6b7280', category: 'Otro' }
}

const GRID_SIZE = 20

function snapToGrid(val: number) {
  return Math.round(val / GRID_SIZE) * GRID_SIZE
}

// ─── Componente principal ────────────────────────────────────────

interface Props {
  workflowId: string
  onBack: () => void
}

export function WorkflowBuilder({ workflowId, onBack }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowWithGraph | null>(null)
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [isSaving, startSaving] = useTransition()

  // Canvas state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)

  // Node interaction
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)

  // Edge drawing
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; handle: string } | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // Toolbar
  const [showToolbar, setShowToolbar] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Refs que reflejan el estado para handlers nativos (wheel) y capture flows
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  type Interaction =
    | { mode: 'none' }
    | { mode: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
    | { mode: 'drag'; nodeId: string; offsetX: number; offsetY: number }
  const interactionRef = useRef<Interaction>({ mode: 'none' })

  // Load workflow
  useEffect(() => {
    getWorkflow(workflowId).then(result => {
      if (result.data) {
        setWorkflow(result.data)
        setNodes(result.data.nodes)
        setEdges(result.data.edges)
      } else {
        toast.error(result.error ?? 'Error cargando workflow')
      }
      setLoading(false)
    })
  }, [workflowId])

  // ─── Canvas coordinate helpers ───────────────────────────────

  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: screenX, y: screenY }
    return {
      x: (screenX - rect.left - panRef.current.x) / zoomRef.current,
      y: (screenY - rect.top - panRef.current.y) / zoomRef.current,
    }
  }, [])

  // ─── Pointer handlers (pan + drag con pointer capture) ─────

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // Solo consideramos “fondo” al canvas mismo o al wrapper de transform,
    // NO a sus descendientes (botones, nodos, toolbar, etc.). Usar closest
    // aquí era un bug: capturaba el puntero y rompía clicks en hijos.
    const isBackground = target === canvasRef.current || target.dataset.canvasBg === 'true'
    if (!isBackground && e.button !== 1) return
    if (e.button !== 0 && e.button !== 1) return

    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    interactionRef.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
    }
    setIsPanning(true)
    setSelectedNodeId(null)
    setConnectingFrom(null)
  }

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const i = interactionRef.current
    if (i.mode === 'pan') {
      setPan({
        x: i.startPanX + (e.clientX - i.startClientX),
        y: i.startPanY + (e.clientY - i.startClientY),
      })
    } else if (i.mode === 'drag') {
      const pos = screenToCanvas(e.clientX, e.clientY)
      const nx = snapToGrid(pos.x - i.offsetX)
      const ny = snapToGrid(pos.y - i.offsetY)
      setNodes(prev => prev.map(n =>
        n.id === i.nodeId ? { ...n, position_x: nx, position_y: ny } : n
      ))
    }
    if (connectingFrom) {
      setMousePos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId)
    }
    interactionRef.current = { mode: 'none' }
    setIsPanning(false)
    setDraggingNodeId(null)
  }

  // Zoom con scroll — zoom hacia el cursor. Listener nativo no-passive porque
  // React adjunta onWheel como passive y preventDefault sería ignorado.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const oldZoom = zoomRef.current
      // Escala exponencial proporcional al deltaY → zoom continuo y suave.
      // Factor 0.0012 da ~1% por tick típico de trackpad y es visualmente ameno.
      // Normalizamos deltaMode (píxeles vs líneas vs páginas) para trackpads y ruedas.
      const pixelDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY
      const clamped = Math.max(-50, Math.min(50, pixelDelta))
      const newZoom = Math.max(0.25, Math.min(2, oldZoom * Math.exp(-clamped * 0.0018)))
      if (newZoom === oldZoom) return
      const ratio = newZoom / oldZoom
      const p = panRef.current
      setZoom(newZoom)
      setPan({
        x: mx - (mx - p.x) * ratio,
        y: my - (my - p.y) * ratio,
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ─── Node drag ───────────────────────────────────────────────

  const handleNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, nodeId: string) => {
    if (e.button !== 0) return
    // Si el pointerdown fue en un puerto (o botón de borrar), no arrancamos drag.
    const target = e.target as HTMLElement
    if (target.closest('[data-port]') || target.closest('button')) return
    e.stopPropagation()
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    const pos = screenToCanvas(e.clientX, e.clientY)
    interactionRef.current = {
      mode: 'drag',
      nodeId,
      offsetX: pos.x - node.position_x,
      offsetY: pos.y - node.position_y,
    }
    // Captura el puntero en el canvas para que los move/up lleguen ahí
    canvasRef.current?.setPointerCapture(e.pointerId)
    setDraggingNodeId(nodeId)
    setSelectedNodeId(nodeId)
  }

  // ─── Edge connection ─────────────────────────────────────────
  // Usamos onPointerDown (no onClick) porque los onPointerDown del nodo llaman
  // setPointerCapture y eso impide que el click llegue al puerto. stopPropagation
  // evita que el pointerdown burbujee al nodo y arranque un drag.

  const handleOutputPortDown = (e: React.PointerEvent, nodeId: string, handle = 'default') => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setSelectedNodeId(nodeId)
    setConnectingFrom(prev =>
      prev && prev.nodeId === nodeId && prev.handle === handle ? null : { nodeId, handle }
    )
    setMousePos({ x: e.clientX, y: e.clientY })
  }

  const handleInputPortDown = (e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    if (connectingFrom && connectingFrom.nodeId !== nodeId) {
      const newEdge: WorkflowEdge = {
        id: crypto.randomUUID(),
        workflow_id: workflowId,
        source_node_id: connectingFrom.nodeId,
        target_node_id: nodeId,
        source_handle: connectingFrom.handle,
        label: null,
        condition_value: connectingFrom.handle !== 'default' ? connectingFrom.handle : null,
        sort_order: edges.length,
      }
      const exists = edges.some(ed =>
        ed.source_node_id === newEdge.source_node_id &&
        ed.target_node_id === newEdge.target_node_id &&
        ed.source_handle === newEdge.source_handle
      )
      if (!exists) setEdges(prev => [...prev, newEdge])
    }
    setConnectingFrom(null)
  }

  // ─── Add node ────────────────────────────────────────────────

  const addNode = (type: string) => {
    const meta = getNodeMeta(type)
    // Posicionar debajo del último nodo
    const maxY = nodes.reduce((max, n) => Math.max(max, n.position_y), 0)
    const centerX = nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.position_x, 0) / nodes.length
      : 400

    const newNode: WorkflowNode = {
      id: crypto.randomUUID(),
      workflow_id: workflowId,
      node_type: type as WorkflowNodeType,
      label: meta.label,
      config: getDefaultConfig(type),
      position_x: snapToGrid(centerX),
      position_y: snapToGrid(maxY + 140),
      width: 220,
      height: 80,
      is_entry_point: false,
      created_at: new Date().toISOString(),
    }
    setNodes(prev => [...prev, newNode])
    setSelectedNodeId(newNode.id)
    setShowToolbar(false)
  }

  const deleteNode = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node?.is_entry_point) { toast.error('No se puede eliminar el nodo trigger'); return }
    setNodes(prev => prev.filter(n => n.id !== nodeId))
    setEdges(prev => prev.filter(e => e.source_node_id !== nodeId && e.target_node_id !== nodeId))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }

  const deleteEdge = (edgeId: string) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId))
  }

  // ─── Update node config ──────────────────────────────────────

  const updateNodeConfig = (nodeId: string, config: Record<string, unknown>) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n))
  }

  const updateNodeLabel = (nodeId: string, label: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n))
  }

  // ─── Save ────────────────────────────────────────────────────

  const handleSave = () => {
    startSaving(async () => {
      const result = await saveWorkflowGraph(workflowId, nodes, edges)
      if (result.error) { toast.error(result.error); return }
      toast.success('Workflow guardado')
    })
  }

  // ─── Edge rendering helpers ──────────────────────────────────
  // Medimos la posición real de cada puerto desde el DOM tras el layout, así
  // las aristas nacen exactamente donde se ven los puertos, sin depender de
  // estimaciones de alto/espaciado que se desincronizan con el CSS real.

  const [portPositions, setPortPositions] = useState<Record<string, { x: number; y: number }>>({})

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const measure = () => {
      const canvasRect = canvas.getBoundingClientRect()
      const next: Record<string, { x: number; y: number }> = {}
      canvas.querySelectorAll<HTMLElement>('[data-port-key]').forEach(el => {
        const key = el.dataset.portKey!
        const r = el.getBoundingClientRect()
        // Centro del puerto en coordenadas de canvas (invertimos pan y zoom)
        const cx = (r.left + r.width / 2 - canvasRect.left - panRef.current.x) / zoomRef.current
        const cy = (r.top + r.height / 2 - canvasRect.top - panRef.current.y) / zoomRef.current
        next[key] = { x: cx, y: cy }
      })
      setPortPositions(prev => {
        const keys = Object.keys(next)
        if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] && prev[k].x === next[k].x && prev[k].y === next[k].y)) {
          return prev
        }
        return next
      })
    }
    measure()
    // Re-medir cuando cambia el tamaño del canvas (sidebar abre/cierra, resize ventana)
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [nodes])

  const getNodeCenter = (nodeId: string, position: 'bottom' | 'top', handle?: string) => {
    const key = position === 'bottom'
      ? `out:${nodeId}:${handle ?? 'default'}`
      : `in:${nodeId}`
    const measured = portPositions[key]
    if (measured) return measured
    // Fallback mientras el layout effect aún no corrió (primer render)
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    const w = node.width ?? 220
    const h = node.height ?? 80
    if (position === 'bottom') return { x: node.position_x + w / 2, y: node.position_y + h }
    return { x: node.position_x + w / 2, y: node.position_y }
  }

  const renderEdgePath = (source: { x: number; y: number }, target: { x: number; y: number }) => {
    const midY = (source.y + target.y) / 2
    const controlOffset = Math.max(40, Math.abs(target.y - source.y) * 0.4)
    return `M ${source.x} ${source.y} C ${source.x} ${source.y + controlOffset}, ${target.x} ${target.y - controlOffset}, ${target.x} ${target.y}`
  }

  // ─── Zoom controls ──────────────────────────────────────────

  const fitView = () => {
    if (nodes.length === 0) return
    const minX = Math.min(...nodes.map(n => n.position_x)) - 100
    const minY = Math.min(...nodes.map(n => n.position_y)) - 100
    const maxX = Math.max(...nodes.map(n => n.position_x + (n.width ?? 220))) + 100
    const maxY = Math.max(...nodes.map(n => n.position_y + (n.height ?? 80))) + 100
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const scaleX = rect.width / (maxX - minX)
    const scaleY = rect.height / (maxY - minY)
    const newZoom = Math.min(scaleX, scaleY, 1.5)
    setZoom(newZoom)
    setPan({
      x: (rect.width - (maxX - minX) * newZoom) / 2 - minX * newZoom,
      y: (rect.height - (maxY - minY) * newZoom) / 2 - minY * newZoom,
    })
  }

  // Fit view on first load — esperamos al siguiente frame para que el canvas
  // tenga medidas reales antes de calcular el zoom.
  useEffect(() => {
    if (loading || nodes.length === 0) return
    const raf = requestAnimationFrame(fitView)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-green-400" />
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        Workflow no encontrado
      </div>
    )
  }

  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  return (
    <div className="flex flex-1 min-w-0 min-h-0 h-full overflow-hidden">
      {/* ═══ Canvas area ═══ */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-card border-b border shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">
              <ArrowLeft className="size-4" />
            </Button>
            <EditableName
              value={workflow.name}
              onSave={async (newName) => {
                const res = await updateWorkflow(workflow.id, { name: newName })
                if (res.error) { toast.error(res.error); return }
                setWorkflow(prev => prev ? { ...prev, name: newName } : prev)
              }}
            />
            {workflow.description && (
              <p className="text-[10px] text-muted-foreground truncate">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-muted rounded-lg px-1">
              <button onClick={() => setZoom(z => Math.max(0.25, z - 0.15))} className="p-1 hover:text-foreground text-muted-foreground">
                <ZoomOut className="size-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} className="p-1 hover:text-foreground text-muted-foreground">
                <ZoomIn className="size-3.5" />
              </button>
              <button onClick={fitView} className="p-1 hover:text-foreground text-muted-foreground">
                <Maximize2 className="size-3.5" />
              </button>
            </div>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-7 text-xs bg-green-600 hover:bg-green-500 text-white">
              <Save className="size-3 mr-1" />
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className={`flex-1 min-h-0 overflow-hidden relative ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            backgroundColor: '#0a0a12',
            backgroundImage: 'radial-gradient(circle, rgba(148, 163, 184, 0.22) 1px, transparent 1px)',
            backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            touchAction: 'none',
            overscrollBehavior: 'contain',
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
        >
          {/* Transform wrapper — el “fondo” real donde se detecta pan */}
          <div
            data-canvas-bg="true"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          >
            {/* SVG layer for edges */}
            <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" opacity="0.75" />
                </marker>
              </defs>
              {edges.map(edge => {
                const source = getNodeCenter(edge.source_node_id, 'bottom', edge.source_handle)
                const target = getNodeCenter(edge.target_node_id, 'top')
                return (
                  <g key={edge.id} className="pointer-events-auto cursor-pointer group" onClick={() => deleteEdge(edge.id)}>
                    <path
                      d={renderEdgePath(source, target)}
                      stroke="#94a3b8"
                      strokeWidth="2"
                      fill="none"
                      opacity="0.6"
                      markerEnd="url(#arrowhead)"
                      className="group-hover:opacity-100 group-hover:stroke-red-400 transition-all"
                    />
                    {/* Invisible wider path for easier clicking */}
                    <path d={renderEdgePath(source, target)} stroke="transparent" strokeWidth="14" fill="none" />
                    {edge.label && (
                      <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 8} textAnchor="middle" className="text-[10px] fill-slate-300">{edge.label}</text>
                    )}
                  </g>
                )
              })}
              {/* Connecting line preview */}
              {connectingFrom && (() => {
                const source = getNodeCenter(connectingFrom.nodeId, 'bottom', connectingFrom.handle)
                const target = screenToCanvas(mousePos.x, mousePos.y)
                return (
                  <path d={renderEdgePath(source, target)} stroke="#22c55e" strokeWidth="2" strokeDasharray="6 3" fill="none" opacity="0.7" />
                )
              })()}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const meta = getNodeMeta(node.node_type)
              const Icon = meta.icon
              const isSelected = node.id === selectedNodeId
              const isDragging = node.id === draggingNodeId
              const isCondition = node.node_type === 'condition'
              const conditions = isCondition ? (node.config.conditions as Array<{ id: string; label: string }>) ?? [] : []

              return (
                <div
                  key={node.id}
                  className={`absolute select-none ${isDragging ? 'z-50 cursor-grabbing' : 'z-10 cursor-grab'}`}
                  style={{
                    left: node.position_x,
                    top: node.position_y,
                    width: node.width ?? 220,
                    willChange: isDragging ? 'transform' : undefined,
                  }}
                  onPointerDown={e => handleNodePointerDown(e, node.id)}
                >
                  {/* Input port (top) */}
                  {!node.is_entry_point && (
                    <div
                      data-port="input"
                      data-port-key={`in:${node.id}`}
                      className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 p-1.5 cursor-crosshair"
                      onPointerDown={e => handleInputPortDown(e, node.id)}
                    >
                      <div className={`size-4 rounded-full border-2 border-background transition-all ${connectingFrom ? 'bg-green-400 scale-125 ring-2 ring-green-400/30' : 'bg-muted-foreground/50 hover:bg-green-400 hover:scale-110'}`} />
                    </div>
                  )}

                  {/* Node body */}
                  <div className={`rounded-xl border-2 transition-all overflow-hidden ${
                    isSelected
                      ? 'border-green-400 shadow-lg shadow-green-400/20'
                      : 'border-border hover:border-foreground/30 shadow-md'
                  }`}>
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: meta.color + '15' }}>
                      <div className="size-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '30' }}>
                        <Icon className="size-3.5" style={{ color: meta.color }} />
                      </div>
                      <span className="text-xs font-medium text-foreground truncate">{node.label}</span>
                      {!node.is_entry_point && (
                        <button
                          className="ml-auto shrink-0 text-muted-foreground hover:text-red-400 transition-colors"
                          onClick={e => { e.stopPropagation(); deleteNode(node.id) }}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </div>
                    {/* Body preview */}
                    <div className="px-3 py-2 bg-card text-[11px] text-muted-foreground min-h-[32px]">
                      {node.node_type === 'trigger' && (
                        <span>Cuando se activa el workflow</span>
                      )}
                      {node.node_type === 'send_message' && (
                        <span className="line-clamp-2">{(node.config.text as string) || 'Sin mensaje configurado'}</span>
                      )}
                      {node.node_type === 'send_buttons' && (
                        <span>{((node.config.buttons as unknown[]) ?? []).length} botones</span>
                      )}
                      {node.node_type === 'send_media' && (
                        <span>{(node.config.media_type as string) || 'multimedia'}</span>
                      )}
                      {node.node_type === 'condition' && (
                        <span>{conditions.length} ruta{conditions.length !== 1 ? 's' : ''}</span>
                      )}
                      {node.node_type === 'add_tag' && (
                        <span>Agregar etiqueta</span>
                      )}
                      {node.node_type === 'remove_tag' && (
                        <span>Quitar etiqueta</span>
                      )}
                      {node.node_type === 'crm_alert' && (
                        <span>{(node.config.alert_type as string) || 'info'}: {(node.config.title as string) || 'Sin título'}</span>
                      )}
                      {node.node_type === 'wait_reply' && (
                        <span>Esperando respuesta del usuario</span>
                      )}
                      {node.node_type === 'delay' && (
                        <span>{(node.config.seconds as number) || 0}s de espera</span>
                      )}
                      {node.node_type === 'send_template' && (
                        <span>Template: {(node.config.template_name as string) || 'no configurado'}</span>
                      )}
                      {node.node_type === 'send_list' && (
                        <span>Lista de opciones</span>
                      )}
                    </div>
                  </div>

                  {/* Output port(s) (bottom) */}
                  {isCondition && conditions.length > 0 ? (
                    <div className="flex justify-around mt-1">
                      {conditions.map((cond) => {
                        const active = connectingFrom?.nodeId === node.id && connectingFrom.handle === cond.id
                        return (
                          <div key={cond.id} className="flex flex-col items-center">
                            <div
                              data-port="output"
                              data-port-key={`out:${node.id}:${cond.id}`}
                              className="p-1.5 cursor-crosshair"
                              onPointerDown={e => handleOutputPortDown(e, node.id, cond.id)}
                            >
                              <div className={`size-4 rounded-full border-2 border-background transition-all ${active ? 'bg-amber-400 scale-125 ring-2 ring-amber-400/30' : 'bg-muted-foreground/50 hover:bg-amber-400 hover:scale-110'}`} />
                            </div>
                            <span className="text-[9px] text-muted-foreground">{cond.label || cond.id}</span>
                          </div>
                        )
                      })}
                      <div className="flex flex-col items-center">
                        <div
                          data-port="output"
                          data-port-key={`out:${node.id}:default`}
                          className="p-1.5 cursor-crosshair"
                          onPointerDown={e => handleOutputPortDown(e, node.id, 'default')}
                        >
                          <div className={`size-4 rounded-full border-2 border-background transition-all ${connectingFrom?.nodeId === node.id && connectingFrom.handle === 'default' ? 'bg-gray-300 scale-125 ring-2 ring-gray-300/30' : 'bg-muted-foreground/50 hover:bg-gray-300 hover:scale-110'}`} />
                        </div>
                        <span className="text-[9px] text-muted-foreground">Otro</span>
                      </div>
                    </div>
                  ) : (
                    // Puerto de salida único
                    <div
                      data-port="output"
                      data-port-key={`out:${node.id}:default`}
                      className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 p-1.5 cursor-crosshair"
                      onPointerDown={e => handleOutputPortDown(e, node.id, 'default')}
                    >
                      <div className={`size-4 rounded-full border-2 border-background transition-all ${connectingFrom?.nodeId === node.id ? 'bg-green-400 scale-125 ring-2 ring-green-400/30' : 'bg-muted-foreground/50 hover:bg-green-400 hover:scale-110'}`} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add node button (floating) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <div className="relative">
              <Button
                onClick={() => setShowToolbar(!showToolbar)}
                className="h-10 px-4 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/30"
              >
                <Plus className="size-4 mr-1.5" />
                Agregar paso
              </Button>

              {/* Toolbar dropdown — abre hacia arriba del botón */}
              {showToolbar && (
                <div
                  className="absolute left-1/2 bottom-full mb-3 -translate-x-1/2 w-64 max-h-[min(60vh,420px)] overflow-y-auto bg-card border rounded-xl shadow-2xl p-2 space-y-1"
                  onPointerDown={e => e.stopPropagation()}
                >
                  {['Mensajes', 'Lógica', 'Acciones'].map(category => (
                    <div key={category}>
                      <p className="text-[10px] text-muted-foreground font-medium px-2 py-1 sticky top-0 bg-card">{category}</p>
                      {NODE_TYPES.filter(n => n.category === category).map(nt => {
                        const Icon = nt.icon
                        return (
                          <button
                            key={nt.type}
                            onClick={() => addNode(nt.type)}
                            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-left"
                          >
                            <div className="size-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: nt.color + '20' }}>
                              <Icon className="size-3.5" style={{ color: nt.color }} />
                            </div>
                            <span className="text-xs text-foreground">{nt.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Node editor sidebar ═══ */}
      {selectedNode && (
        <WorkflowNodeEditor
          node={selectedNode}
          onUpdateConfig={(config) => updateNodeConfig(selectedNode.id, config)}
          onUpdateLabel={(label) => updateNodeLabel(selectedNode.id, label)}
          onClose={() => setSelectedNodeId(null)}
          onDelete={() => deleteNode(selectedNode.id)}
        />
      )}
    </div>
  )
}

// ─── Default configs ─────────────────────────────────────────────

function getDefaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'send_message':
      return { text: '' }
    case 'send_media':
      return { media_url: '', media_type: 'image', caption: '' }
    case 'send_buttons':
      return { body: '', buttons: [{ id: 'btn_1', title: 'Opción 1' }] }
    case 'send_list':
      return { body: '', button_text: 'Ver opciones', sections: [{ title: 'Opciones', rows: [{ id: 'opt_1', title: 'Opción 1', description: '' }] }] }
    case 'send_template':
      return { template_name: '', language_code: 'es_AR' }
    case 'condition':
      return { type: 'button_response', conditions: [] }
    case 'wait_reply':
      return {}
    case 'delay':
      return { seconds: 5 }
    case 'add_tag':
      return { tag_id: '' }
    case 'remove_tag':
      return { tag_id: '' }
    case 'crm_alert':
      return { alert_type: 'info', title: '', message: '' }
    default:
      return {}
  }
}

function EditableName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group flex items-center gap-1.5 min-w-0">
        <h2 className="text-sm font-semibold text-foreground truncate">{value}</h2>
        <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      className="text-sm font-semibold text-foreground bg-muted border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-ring w-48"
    />
  )
}
