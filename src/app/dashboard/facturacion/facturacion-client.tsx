'use client'

// =============================================================================
// src/app/dashboard/facturacion/facturacion-client.tsx
// Orquestador de la pantalla de facturación.
//
// Decide qué mostrar según en qué punto está la organización:
//   · sin configurar → el wizard ocupa la pantalla, no hay a dónde más ir
//   · configurado    → arranca en el cupo, que es lo que se mira todos los días
// =============================================================================

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
    AlertTriangle,
    CheckCircle2,
    FileCheck2,
    FlaskConical,
    Loader2,
    RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { WizardConfiguracion } from '@/components/facturacion/wizard-configuracion'
import { EditorCupo } from '@/components/facturacion/editor-cupo'
import { TablaComprobantes } from '@/components/facturacion/tabla-comprobantes'
import { getEstadoFacturador, type EstadoFacturador } from '@/lib/actions/arca'
import {
    getCandidatosManuales,
    emitirLote,
    getComprobantes,
    type ListadoComprobantes,
} from '@/lib/actions/arca-emision'
import type { CandidatoVenta } from '@/lib/arca/cupo'

/** Tope de un lote manual. Coincide con el que aplica `emitirLote` en el server:
 *  si la UI dejara elegir más, el botón prometería un número y el server haría otro. */
const LIMITE_MANUAL = 100

const money = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

type Pestania = 'configuracion' | 'cupo' | 'sin_facturar' | 'comprobantes'

interface Props {
    estadoInicial: EstadoFacturador
    comprobantesIniciales: ListadoComprobantes
    puedeConfigurar: boolean
    puedeEmitir: boolean
}

export function FacturacionClient({
    estadoInicial,
    comprobantesIniciales,
    puedeConfigurar,
    puedeEmitir,
}: Props) {
    const router = useRouter()
    const [estado, setEstado] = useState(estadoInicial)
    const [comprobantes, setComprobantes] = useState(comprobantesIniciales)
    const [pestania, setPestania] = useState<Pestania>(
        estadoInicial.configurado ? 'cupo' : 'configuracion',
    )
    const [refrescando, setRefrescando] = useState(false)

    const refrescar = useCallback(async () => {
        setRefrescando(true)
        try {
            const [e, c] = await Promise.all([getEstadoFacturador(), getComprobantes({ limite: 100 })])
            setEstado(e)
            setComprobantes(c)
        } catch {
            // Una server action RECHAZA ante corte de red o timeout. Sin este
            // catch el `setRefrescando(false)` nunca corre y el botón queda
            // girando para siempre, sin ningún error visible.
            toast.error('No pudimos actualizar. Revisá la conexión.')
        } finally {
            setRefrescando(false)
        }
        router.refresh()
    }, [router])

    const PESTANIAS: { id: Pestania; etiqueta: string }[] = [
        { id: 'configuracion', etiqueta: 'Configuración' },
        { id: 'cupo', etiqueta: 'Cupo' },
        { id: 'sin_facturar', etiqueta: 'Sin facturar' },
        { id: 'comprobantes', etiqueta: 'Comprobantes' },
    ]

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
            {/* ---------------------------------------------------------------- cabecera */}
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                        <FileCheck2 className="size-6 text-muted-foreground" />
                        Facturación ARCA
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Emití comprobantes electrónicos y controlá cuánto de lo que vendés se factura.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {estado.contribuyente?.ambiente === 'homologacion' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <FlaskConical className="size-3.5" />
                            Modo pruebas
                        </span>
                    )}
                    {estado.configurado && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="size-3.5" />
                            Conectado con ARCA
                        </span>
                    )}
                    <Button variant="outline" size="sm" onClick={refrescar} disabled={refrescando}>
                        {refrescando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Actualizar
                    </Button>
                </div>
            </header>

            {estado.error && (
                <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{estado.error}</span>
                </div>
            )}

            {/* --------------------------------------------------------- pestañas */}
            {/* Botones pill y no el primitivo tabs: es el patrón que ya usa el resto
                del dashboard, y así la pestaña activa sobrevive a un refresh de datos. */}
            <nav className="flex flex-wrap gap-1 border-b border-border">
                {PESTANIAS.map((p) => {
                    const activa = pestania === p.id
                    const bloqueada = !estado.configurado && p.id !== 'configuracion'
                    return (
                        <button
                            key={p.id}
                            type="button"
                            disabled={bloqueada}
                            onClick={() => setPestania(p.id)}
                            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                                activa
                                    ? 'border-primary text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                        >
                            {p.etiqueta}
                            {p.id === 'comprobantes' && comprobantes.total > 0 && (
                                <span className="ml-1.5 text-xs text-muted-foreground">{comprobantes.total}</span>
                            )}
                        </button>
                    )
                })}
            </nav>

            {/* --------------------------------------------------------- contenido */}
            {pestania === 'configuracion' && (
                <WizardConfiguracion estado={estado} puedeConfigurar={puedeConfigurar} onRefrescar={refrescar} />
            )}

            {pestania === 'cupo' && (
                <EditorCupo
                    politicas={estado.politicas}
                    sucursales={estado.sucursales}
                    puedeConfigurar={puedeConfigurar}
                    puedeEmitir={puedeEmitir}
                    onGuardado={refrescar}
                />
            )}

            {pestania === 'sin_facturar' && (
                <PanelSinFacturar
                    sucursales={estado.sucursales}
                    puedeEmitir={puedeEmitir}
                    onEmitido={refrescar}
                />
            )}

            {pestania === 'comprobantes' && (
                <TablaComprobantes
                    datos={comprobantes}
                    sucursales={estado.sucursales}
                    puedeEmitir={puedeEmitir}
                    onRefrescar={refrescar}
                />
            )}
        </div>
    )
}

// =============================================================================
// Panel "Sin facturar" — elegir a mano
//
// Es la contracara del cupo automático: la lista completa de ventas sin
// comprobante, para el que quiere decidir una por una. Comparte la misma fuente
// que el motor (`arca_billing_candidates`), así que nunca ofrece algo que ya
// esté facturado.
// =============================================================================

function PanelSinFacturar({
    sucursales,
    puedeEmitir,
    onEmitido,
}: {
    sucursales: { id: string; name: string }[]
    puedeEmitir: boolean
    onEmitido: () => void
}) {
    const [candidatos, setCandidatos] = useState<CandidatoVenta[]>([])
    const [error, setError] = useState<string | null>(null)
    const [elegidos, setElegidos] = useState<Set<string>>(new Set())
    const [cargando, setCargando] = useState(true)
    const [emitiendo, empezarEmision] = useTransition()
    const [sucursal, setSucursal] = useState<string | null>(null)

    // Contador de peticiones: cambiar de sucursal dispara una consulta nueva y
    // la anterior puede llegar DESPUÉS. Sin esto, la lista mostraba las ventas
    // de "Todas las sucursales" mientras el selector decía "Rondeau" — y
    // "Seleccionar todas" terminaba emitiendo comprobantes de sucursales que el
    // usuario creía haber excluido.
    const peticion = useRef(0)
    const cargar = useCallback(async () => {
        const mia = ++peticion.current
        setCargando(true)
        try {
            const r = await getCandidatosManuales({ branchId: sucursal, dias: 30, limite: LIMITE_MANUAL })
            if (mia !== peticion.current) return
            setCandidatos(r.candidatos)
            setError(r.error)
            setElegidos(new Set())
        } catch {
            if (mia !== peticion.current) return
            setError('No pudimos leer las ventas sin facturar. Revisá la conexión y volvé a intentar.')
        } finally {
            if (mia === peticion.current) setCargando(false)
        }
    }, [sucursal])

    useEffect(() => {
        void cargar()
    }, [cargar])

    const alternar = (id: string) =>
        setElegidos((s) => {
            const n = new Set(s)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })

    const totalElegido = candidatos
        .filter((c) => elegidos.has(c.visitId))
        .reduce((a, c) => a + c.baseAmount, 0)

    const emitir = () => {
        empezarEmision(async () => {
            let r: Awaited<ReturnType<typeof emitirLote>>
            try {
                r = await emitirLote(Array.from(elegidos))
            } catch {
                toast.error(
                    'Se cortó la comunicación. Antes de reintentar, mirá la pestaña Comprobantes: ' +
                    'puede que algunos se hayan emitido igual.',
                )
                return
            }
            if ('error' in r) {
                toast.error(r.error)
                return
            }
            if (r.fallidos.length === 0) {
                toast.success(`${r.emitidos.length} comprobante(s) emitidos por ${money(r.total)}`)
            } else {
                toast.warning(
                    `${r.emitidos.length} emitidos, ${r.fallidos.length} con problemas. ${r.fallidos[0]?.motivo ?? ''}`,
                )
            }
            await cargar()
            onEmitido()
        })
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Ventas sin facturar</h2>
                    <p className="text-sm text-muted-foreground">
                        Últimos 30 días. Elegí cuáles emitir (hasta {LIMITE_MANUAL} por vez).
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={sucursal ?? ''}
                        onChange={(e) => setSucursal(e.target.value || null)}
                        aria-label="Filtrar por sucursal"
                        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                    >
                        <option value="">Todas las sucursales</option>
                        {sucursales.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={cargar}
                        disabled={cargando}
                        aria-label="Actualizar ventas sin facturar"
                    >
                        {cargando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    </Button>
                </div>
            </div>

            {error ? (
                <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : cargando ? (
                <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                    Buscando ventas sin facturar…
                </div>
            ) : candidatos.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-10 text-center">
                    <CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No hay ventas sin facturar</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Todo lo cobrado en los últimos 30 días ya tiene comprobante.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="w-10 px-4 py-2.5">
                                    <Checkbox
                                        checked={elegidos.size > 0 && elegidos.size === candidatos.length}
                                        onCheckedChange={(v) =>
                                            setElegidos(v ? new Set(candidatos.map((c) => c.visitId)) : new Set())
                                        }
                                        aria-label="Seleccionar todas"
                                    />
                                </th>
                                <th className="px-3 py-2.5 text-left font-medium">Fecha</th>
                                <th className="px-3 py-2.5 text-left font-medium">Cliente</th>
                                <th className="px-3 py-2.5 text-left font-medium">Sucursal</th>
                                <th className="px-3 py-2.5 text-left font-medium">Cobro</th>
                                <th className="px-4 py-2.5 text-right font-medium">Importe</th>
                            </tr>
                        </thead>
                        <tbody>
                            {candidatos.map((c) => (
                                <tr
                                    key={c.visitId}
                                    onClick={() => alternar(c.visitId)}
                                    className={`cursor-pointer border-b border-border/60 transition last:border-0 hover:bg-muted/40 ${
                                        elegidos.has(c.visitId) ? 'bg-primary/5' : ''
                                    }`}
                                >
                                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                        <Checkbox
                                            checked={elegidos.has(c.visitId)}
                                            onCheckedChange={() => alternar(c.visitId)}
                                            aria-label={`Seleccionar venta de ${c.clientName ?? 'consumidor final'}`}
                                        />
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                                        {new Date(c.completedAt).toLocaleDateString('es-AR', {
                                            day: '2-digit',
                                            month: '2-digit',
                                        })}
                                    </td>
                                    <td className="max-w-[14rem] truncate px-3 py-2.5">
                                        {c.clientName ?? <span className="text-muted-foreground">Consumidor final</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground">{c.branchName}</td>
                                    <td className="px-3 py-2.5 text-muted-foreground">
                                        {c.paymentMethod === 'cash'
                                            ? 'Efectivo'
                                            : c.paymentMethod === 'card'
                                                ? 'Tarjeta'
                                                : 'Transferencia'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{money(c.baseAmount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {elegidos.size > 0 && (
                        <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
                            <span className="text-sm">
                                <span className="font-semibold tabular-nums">{elegidos.size}</span>{' '}
                                {elegidos.size === 1 ? 'venta elegida' : 'ventas elegidas'} ·{' '}
                                <span className="font-semibold tabular-nums">{money(totalElegido)}</span>
                            </span>
                            <Button onClick={emitir} disabled={!puedeEmitir || emitiendo}>
                                {emitiendo && <Loader2 className="size-4 animate-spin" />}
                                Facturar {elegidos.size}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {!puedeEmitir && candidatos.length > 0 && (
                <p className="text-sm text-muted-foreground">No tenés permiso para emitir comprobantes.</p>
            )}
        </div>
    )
}
