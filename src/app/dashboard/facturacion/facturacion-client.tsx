'use client'

// =============================================================================
// src/app/dashboard/facturacion/facturacion-client.tsx
// Orquestador de la pantalla de facturación.
//
// Tres pestañas y una sola idea: el eje es la PERSONA. Cada barbero tiene su
// monotributo, su cupo y su tope, y los dueños los administran a todos desde
// la pestaña Barberos. El resto es soporte: el trámite de configuración y el
// historial de comprobantes emitidos.
// =============================================================================

import { useCallback, useState } from 'react'
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
import { WizardConfiguracion } from '@/components/facturacion/wizard-configuracion'
import { TablaComprobantes } from '@/components/facturacion/tabla-comprobantes'
import { PanelBarberos } from '@/components/facturacion/panel-barberos'
import { getEstadoFacturador, type EstadoFacturador } from '@/lib/actions/arca'
import { getComprobantes, type ListadoComprobantes } from '@/lib/actions/arca-emision'
import { getPanelFacturacion, type PanelFacturacion } from '@/lib/actions/arca-panel'

// "Barberos" es la pantalla principal: un monotributo por persona, con su cupo
// y su tope. Las viejas pestañas de Cupo y Sin facturar quedaron adentro de la
// hoja de cada barbero — tener el cupo en un lugar y la persona en otro obligaba
// a cruzar dos pantallas para responder una sola pregunta.
type Pestania = 'barberos' | 'configuracion' | 'comprobantes'

interface Props {
    estadoInicial: EstadoFacturador
    comprobantesIniciales: ListadoComprobantes
    panelInicial: PanelFacturacion
    puedeConfigurar: boolean
    puedeEmitir: boolean
}

export function FacturacionClient({
    estadoInicial,
    comprobantesIniciales,
    panelInicial,
    puedeConfigurar,
    puedeEmitir,
}: Props) {
    const router = useRouter()
    const [estado, setEstado] = useState(estadoInicial)
    const [comprobantes, setComprobantes] = useState(comprobantesIniciales)
    const [panel, setPanel] = useState(panelInicial)
    const [pestania, setPestania] = useState<Pestania>('barberos')
    const [refrescando, setRefrescando] = useState(false)

    const refrescar = useCallback(async () => {
        setRefrescando(true)
        try {
            const [e, c, pa] = await Promise.all([
                getEstadoFacturador(),
                getComprobantes({ limite: 100 }),
                getPanelFacturacion(),
            ])
            setEstado(e)
            setComprobantes(c)
            setPanel(pa)
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
        { id: 'barberos', etiqueta: 'Barberos' },
        { id: 'configuracion', etiqueta: 'Configuración' },
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
                    const bloqueada = false
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
                            {p.id === 'barberos' && panel.resumen.enRiesgo > 0 && (
                                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                                    {panel.resumen.enRiesgo}
                                </span>
                            )}
                        </button>
                    )
                })}
            </nav>

            {/* --------------------------------------------------------- contenido */}
            {pestania === 'barberos' && (
                <PanelBarberos
                    datos={panel}
                    puedeConfigurar={puedeConfigurar}
                    puedeEmitir={puedeEmitir}
                    onRefrescar={refrescar}
                />
            )}

            {pestania === 'configuracion' && (
                <WizardConfiguracion estado={estado} puedeConfigurar={puedeConfigurar} onRefrescar={refrescar} />
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
