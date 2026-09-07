'use client'

// =============================================================================
// /dashboard/turnos/senas — dónde vive la plata que los clientes pagaron por
// adelantado.
//
// Cuatro decisiones que explican cómo está armada:
//
//  1. Arriba de todo, en rojo, van las señas PAGADAS SIN TURNO. Es plata que
//     está en la cuenta de la sucursal por un turno que nunca llegó a existir:
//     el cliente cree que reservó y no reservó. No es un estado más de la
//     tabla, es una alarma, y por eso no se filtra por período ni se pagina.
//
//  2. Los totales distinguen "cobrado" de "devuelto" de "perdido". Sumarlos en
//     un solo número diría "entraron $X" cuando parte de esos X ya salieron.
//     Y cuando una lectura falla, la pantalla lo DICE en vez de imprimir cero
//     (Known Risk #15).
//
//  3. La devolución pide motivo obligatorio y avisa si la seña está dentro de
//     los días de arrepentimiento. Ese plazo es un derecho irrenunciable del
//     cliente (art. 1110 CCyC): tiene que estar a la vista ANTES de decidir,
//     no en la letra chica de una política.
//
//  4. La búsqueda va al SERVIDOR (`buscarSenas`) y mira toda la base. Filtrar
//     el array de la página cargada —lo que hacía antes— es un buscador que
//     miente por omisión: el cliente que señó en junio no aparecía y no había
//     ninguna otra forma de llegar a esa fila desde la UI.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
    AlertTriangle,
    CalendarClock,
    Filter,
    Loader2,
    RotateCcw,
    Search,
    Wallet,
    X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { PastillaEstado } from '@/components/senas/estado-sena'
import { DevolverSenaDialog } from '@/components/senas/devolver-sena-dialog'
import {
    listarSenas,
    marcarSenaPerdida,
    type ResultadoListado,
    type SenaListada,
} from '@/lib/actions/senas'
import type { EstadoSena } from '@/lib/senas/contrato'
import {
    buscarSenas,
    resumenSenas,
    type ResultadoBusquedaSenas,
    type ResumenSenas,
    type SenaSinTurno,
} from './actions'

const POR_PAGINA = 50

/** Los estados que sirven como filtro rápido, en el orden en que se miran. */
const FILTROS_ESTADO: Array<{ id: string; etiqueta: string; estados: EstadoSena[] }> = [
    { id: 'todas', etiqueta: 'Todas', estados: [] },
    { id: 'con_plata', etiqueta: 'Con plata', estados: ['pagada', 'consumida', 'perdida'] },
    { id: 'pagada', etiqueta: 'Pagadas', estados: ['pagada'] },
    { id: 'consumida', etiqueta: 'Usadas en el corte', estados: ['consumida'] },
    { id: 'devuelta', etiqueta: 'Devueltas', estados: ['devuelta', 'sin_cupo'] },
    { id: 'perdida', etiqueta: 'Para el local', estados: ['perdida'] },
    { id: 'iniciada', etiqueta: 'Esperando pago', estados: ['iniciada'] },
    { id: 'sin_pago', etiqueta: 'Sin pago', estados: ['rechazada', 'expirada', 'cancelada'] },
]

/** Mínimo de caracteres para salir a buscar. Es el mismo que exige la RPC. */
const MIN_BUSQUEDA = 2

/** Filtros de la consulta. La búsqueda de texto viaja aparte (ver `buscarSenas`). */
interface Filtros {
    sucursalId: string
    estado: string
    desde: string
    hasta: string
}

interface Props {
    sucursales: Array<{ id: string; nombre: string }>
    listadoInicial: ResultadoListado
    resumenInicial: ResumenSenas
    sinTurnoInicial: { senas: SenaSinTurno[]; error: string | null }
    hayCuentaConectada: boolean
    puedeDevolver: boolean
    arrepentimientoPorSucursal: Record<string, number>
}

export function SenasClient({
    sucursales,
    listadoInicial,
    resumenInicial,
    sinTurnoInicial,
    hayCuentaConectada,
    puedeDevolver,
    arrepentimientoPorSucursal,
}: Props) {
    const [cargando, iniciar] = useTransition()
    const [listado, setListado] = useState(listadoInicial)
    const [resumen, setResumen] = useState(resumenInicial)
    const [sinTurno, setSinTurno] = useState(sinTurnoInicial.senas)

    const [filtros, setFiltros] = useState<Filtros>({
        sucursalId: 'todas',
        estado: 'todas',
        desde: '',
        hasta: '',
    })
    const [pagina, setPagina] = useState(1)
    const [busqueda, setBusqueda] = useState('')

    const [aDevolver, setADevolver] = useState<SenaListada | null>(null)
    const [aPerder, setAPerder] = useState<SenaListada | null>(null)
    const [motivoPerdida, setMotivoPerdida] = useState('')

    const recargar = useCallback((f: Filtros, paginaPedida: number) => {
        const branchId = f.sucursalId === 'todas' ? null : f.sucursalId
        const estados = FILTROS_ESTADO.find(x => x.id === f.estado)?.estados ?? []
        iniciar(async () => {
            const [nuevo, totales] = await Promise.all([
                listarSenas({
                    branchId,
                    estados: estados.length ? estados : undefined,
                    desde: f.desde || null,
                    hasta: f.hasta || null,
                    pagina: paginaPedida,
                    porPagina: POR_PAGINA,
                }),
                resumenSenas({ branchId, desde: f.desde || null, hasta: f.hasta || null }),
            ])
            setListado(nuevo)
            setResumen(totales)
        })
    }, [])

    /**
     * Los filtros se aplican en el mismo handler que los cambia, no en un
     * efecto que mire el estado: un efecto se dispararía también en el primer
     * render y volvería a pedir al servidor lo que la página ya trajo.
     *
     * Y todo cambio de filtro vuelve a la página 1: quedarse en la 3 de un
     * resultado que ahora tiene una sola página muestra una tabla vacía que se
     * lee como "no hay señas".
     */
    function cambiarFiltro(cambio: Partial<Filtros>) {
        const nuevos = { ...filtros, ...cambio }
        setFiltros(nuevos)
        setPagina(1)
        recargar(nuevos, 1)
    }

    function irAPagina(p: number) {
        setPagina(p)
        recargar(filtros, p)
    }

    /**
     * La búsqueda va al SERVIDOR y mira toda la base, no la página cargada.
     *
     * Antes filtraba el array de 50 filas que estaba en pantalla: buscar a un
     * cliente que señó en junio no devolvía nada y no había ninguna otra forma
     * de llegar a esa seña desde la UI. Un buscador que sólo ve la página miente
     * por omisión, y acá lo que no aparece es plata de un cliente.
     *
     * El filtro local se conserva mientras la respuesta viaja, para que escribir
     * se sienta instantáneo (mismo patrón que el inbox tras la mig 195).
     */
    const texto = busqueda.trim()
    const hayBusqueda = texto.length >= MIN_BUSQUEDA
    const [resultadoBusqueda, setResultadoBusqueda] = useState<ResultadoBusquedaSenas | null>(null)
    const [buscando, setBuscando] = useState(false)
    // Cada pedido lleva su número: una respuesta vieja que llega tarde no puede
    // pisar los resultados de lo que el usuario está escribiendo ahora.
    const pedidoRef = useRef(0)

    /**
     * Limpiar el resultado va acá y NO en el efecto: setState sincrónico en el
     * cuerpo de un efecto dispara renders en cascada (lo rechaza el compilador
     * de React, que está prendido en este repo).
     */
    function cambiarBusqueda(v: string) {
        setBusqueda(v)
        if (v.trim().length < MIN_BUSQUEDA) {
            // Invalida cualquier respuesta en vuelo: la que llegue no puede
            // repoblar una tabla que el usuario acaba de vaciar.
            pedidoRef.current += 1
            setResultadoBusqueda(null)
            setBuscando(false)
        }
    }

    useEffect(() => {
        if (!hayBusqueda) return
        const id = ++pedidoRef.current
        const t = setTimeout(() => {
            setBuscando(true)
            const branchId = filtros.sucursalId === 'todas' ? null : filtros.sucursalId
            const estados = FILTROS_ESTADO.find(x => x.id === filtros.estado)?.estados ?? []
            buscarSenas(texto, {
                branchId,
                estados: estados.length ? estados : undefined,
                desde: filtros.desde || null,
                hasta: filtros.hasta || null,
            })
                .then(r => {
                    if (pedidoRef.current === id) setResultadoBusqueda(r)
                })
                .catch(e => {
                    // Un fallo de red no puede degradarse a "no hay resultados":
                    // sería la misma pantalla que "este cliente nunca señó".
                    if (pedidoRef.current !== id) return
                    console.error('[buscarSenas]', e)
                    setResultadoBusqueda({
                        senas: [],
                        error: 'No pudimos buscar. Reintentá en un momento.',
                        truncadoPorClientes: false,
                        truncadoPorFilas: false,
                    })
                })
                .finally(() => {
                    if (pedidoRef.current === id) setBuscando(false)
                })
        }, 300)
        return () => clearTimeout(t)
    }, [texto, hayBusqueda, filtros])

    const busquedaServida = hayBusqueda && !!resultadoBusqueda && !resultadoBusqueda.error

    const visibles = useMemo(() => {
        if (busquedaServida) return resultadoBusqueda!.senas
        const t = texto.toLowerCase()
        if (!t) return listado.senas
        return listado.senas.filter(s =>
            [s.clientName, s.clientPhone, s.serviceNames, s.branchName]
                .filter(Boolean)
                .some(v => (v as string).toLowerCase().includes(t)),
        )
    }, [busquedaServida, resultadoBusqueda, texto, listado.senas])

    const totalPaginas = listado.total > 0 ? Math.max(1, Math.ceil(listado.total / POR_PAGINA)) : 1

    /**
     * Dar una seña por perdida no mueve plata —ya está en la cuenta de la
     * sucursal— pero la cierra: deja de figurar como pendiente y no se puede
     * imputar a ningún cobro futuro. Por eso pide motivo, igual que la
     * devolución: dentro de tres meses, "perdida" sin explicación es un
     * reclamo que nadie puede contestar.
     */
    function darPorPerdida() {
        const sena = aPerder
        if (!sena) return
        const texto = motivoPerdida.trim()
        if (texto.length < 3) {
            toast.error('Escribí por qué la seña queda para el local.')
            return
        }
        iniciar(async () => {
            const r = await marcarSenaPerdida(sena.id, texto)
            if (!r.ok) {
                toast.error(r.error ?? 'No pudimos marcar la seña.')
                return
            }
            toast.success('La seña quedó para el local')
            setAPerder(null)
            setMotivoPerdida('')
            setSinTurno(prev => prev.filter(x => x.id !== sena.id))
            recargar(filtros, pagina)
        })
    }

    const sinNada =
        !listado.error &&
        listado.senas.length === 0 &&
        resumen.cobradoCantidad === 0 &&
        resumen.pendienteCantidad === 0 &&
        filtros.estado === 'todas' &&
        !filtros.desde &&
        !filtros.hasta &&
        filtros.sucursalId === 'todas'

    return (
        <div className="space-y-5">
            {/* Plata cobrada sin turno: lo primero que hay que ver. */}
            {sinTurno.length > 0 && (
                <SinTurno
                    senas={sinTurno}
                    onResuelta={id => setSinTurno(prev => prev.filter(s => s.id !== id))}
                />
            )}

            {sinTurnoInicial.error && (
                <Aviso texto={sinTurnoInicial.error} />
            )}

            {sinNada ? (
                <EstadoVacio hayCuentaConectada={hayCuentaConectada} />
            ) : (
                <>
                    <Totales resumen={resumen} />

                    <Card>
                        <CardHeader className="gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <CardTitle className="text-base">Señas cobradas</CardTitle>
                                    <CardDescription>
                                        Cada fila es un intento de reserva con pago por adelantado, haya terminado bien o
                                        mal.
                                    </CardDescription>
                                </div>
                                {(cargando || buscando) && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                            </div>

                            <PanelFiltros
                                sucursales={sucursales}
                                sucursalId={filtros.sucursalId}
                                onSucursal={v => cambiarFiltro({ sucursalId: v })}
                                filtroEstado={filtros.estado}
                                onEstado={v => cambiarFiltro({ estado: v })}
                                desde={filtros.desde}
                                hasta={filtros.hasta}
                                onDesde={v => cambiarFiltro({ desde: v })}
                                onHasta={v => cambiarFiltro({ hasta: v })}
                                busqueda={busqueda}
                                onBusqueda={cambiarBusqueda}
                                buscando={buscando}
                            />
                        </CardHeader>

                        <CardContent className="space-y-3">
                            {hayBusqueda && resultadoBusqueda?.error ? (
                                <Aviso texto={resultadoBusqueda.error} />
                            ) : listado.error && !busquedaServida ? (
                                <Aviso texto={listado.error} />
                            ) : visibles.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                                    {busquedaServida
                                        ? 'Ninguna seña coincide con lo que buscaste, en toda la base y con estos filtros.'
                                        : texto
                                          ? buscando
                                            ? 'Buscando en toda la base…'
                                            : `Escribí al menos ${MIN_BUSQUEDA} letras para buscar en toda la base.`
                                          : 'No hay señas con esos filtros.'}
                                </p>
                            ) : (
                                <Tabla
                                    senas={visibles}
                                    puedeDevolver={puedeDevolver}
                                    arrepentimientoPorSucursal={arrepentimientoPorSucursal}
                                    onDevolver={setADevolver}
                                    onPerdida={s => {
                                        setMotivoPerdida('')
                                        setAPerder(s)
                                    }}
                                    ocupado={cargando}
                                />
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
                                <span>
                                    {busquedaServida ? (
                                        <>
                                            {visibles.length} {visibles.length === 1 ? 'seña' : 'señas'} de “{texto}” en
                                            toda la base, con estos filtros
                                            {/* Los dos topes se dicen. Un resultado corto que no
                                                avisa es la misma mentira que filtrar la página. */}
                                            {resultadoBusqueda!.truncadoPorFilas &&
                                                ' · hay más: achicá el rango de fechas'}
                                            {resultadoBusqueda!.truncadoPorClientes &&
                                                ' · muchos clientes coinciden: escribí el nombre más completo'}
                                        </>
                                    ) : (
                                        <>
                                            {listado.total < 0
                                                ? `${listado.senas.length} señas en esta página · no pudimos contar el total`
                                                : `${listado.total} ${listado.total === 1 ? 'seña' : 'señas'} con estos filtros`}
                                            {texto && ` · ${visibles.length} coinciden en esta página`}
                                        </>
                                    )}
                                </span>
                                {/* La paginación es del listado, no de la búsqueda: mientras se
                                    busca no se muestra, porque "página 2 de 7" ahí significaría
                                    otra cosa que lo que está en la tabla. */}
                                {!busquedaServida && totalPaginas > 1 && (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pagina <= 1 || cargando}
                                            onClick={() => irAPagina(pagina - 1)}
                                        >
                                            Anterior
                                        </Button>
                                        <span className="tabular-nums">
                                            {pagina} de {totalPaginas}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pagina >= totalPaginas || cargando}
                                            onClick={() => irAPagina(pagina + 1)}
                                        >
                                            Siguiente
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}

            {/* El diálogo se monta con `key` por seña y sólo cuando hay una:
                así el formulario nace vacío en cada apertura sin necesidad de un
                efecto que lo resetee. Arrastrar el motivo de la devolución
                anterior es la forma más fácil de dejar registrado un motivo que
                no corresponde. */}
            <AlertDialog
                open={!!aPerder}
                onOpenChange={abierto => {
                    if (!abierto && !cargando) {
                        setAPerder(null)
                        setMotivoPerdida('')
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Dar la seña por perdida</AlertDialogTitle>
                        <AlertDialogDescription>
                            {aPerder && (
                                <>
                                    {formatCurrency(aPerder.amount)} de {aPerder.clientName ?? 'el cliente'} quedan para
                                    el local. La plata ya está en la cuenta de Mercado Pago de la sucursal: esto no la
                                    mueve, cierra la seña para que deje de figurar como pendiente y no se pueda imputar a
                                    un cobro futuro.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div>
                        <Label htmlFor="motivo-perdida" className="text-sm">
                            Motivo
                        </Label>
                        <Textarea
                            id="motivo-perdida"
                            value={motivoPerdida}
                            onChange={e => setMotivoPerdida(e.target.value)}
                            rows={2}
                            maxLength={300}
                            className="mt-1.5"
                            placeholder="No vino al turno y no avisó."
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cargando}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={cargando}
                            onClick={e => {
                                // El AlertDialogAction cierra solo al hacer clic:
                                // sin esto, un motivo corto rechazado cerraría el
                                // diálogo igual y el dueño creería que se aplicó.
                                e.preventDefault()
                                darPorPerdida()
                            }}
                        >
                            Dar por perdida
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {aDevolver && (
                <DevolverSenaDialog
                    key={aDevolver.id}
                    sena={aDevolver}
                    diasDeArrepentimiento={arrepentimientoPorSucursal[aDevolver.branchId] ?? 0}
                    onCerrar={() => setADevolver(null)}
                    onDevuelta={() => {
                        const id = aDevolver.id
                        setADevolver(null)
                        setSinTurno(prev => prev.filter(s => s.id !== id))
                        recargar(filtros, pagina)
                    }}
                />
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────

function Totales({ resumen }: { resumen: ResumenSenas }) {
    if (resumen.error) return <Aviso texto={resumen.error} />

    const tarjetas = [
        {
            titulo: 'Cobrado',
            monto: resumen.cobrado,
            detalle:
                resumen.cobradoCantidad === 0
                    ? 'Todavía no entró ninguna seña'
                    : `${resumen.cobradoCantidad} ${resumen.cobradoCantidad === 1 ? 'seña' : 'señas'}` +
                      (resumen.comision > 0 ? ` · ${formatCurrency(resumen.comision)} de comisión de Mercado Pago` : ''),
            clases: 'text-emerald-600 dark:text-emerald-400',
        },
        {
            titulo: 'Devuelto',
            monto: resumen.devuelto,
            detalle: `${resumen.devueltoCantidad} ${resumen.devueltoCantidad === 1 ? 'devolución' : 'devoluciones'}`,
            clases: 'text-sky-600 dark:text-sky-400',
        },
        {
            titulo: 'Quedó para el local',
            monto: resumen.perdido,
            detalle: `${resumen.perdidoCantidad} ${resumen.perdidoCantidad === 1 ? 'cancelación tardía o ausencia' : 'cancelaciones tardías o ausencias'}`,
            clases: 'text-violet-600 dark:text-violet-400',
        },
        {
            titulo: 'Esperando pago',
            monto: resumen.pendiente,
            detalle:
                resumen.pendienteCantidad === 0
                    ? 'Sin links de pago abiertos'
                    : `${resumen.pendienteCantidad} ${resumen.pendienteCantidad === 1 ? 'link abierto' : 'links abiertos'} · el horario no está reservado`,
            clases: 'text-amber-600 dark:text-amber-400',
        },
    ]

    return (
        <div className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {tarjetas.map(t => (
                    <div key={t.titulo} className="rounded-xl border border-border bg-card p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.titulo}</p>
                        <p className={cn('mt-1 text-2xl font-bold tabular-nums tracking-tight', t.clases)}>
                            {formatCurrency(t.monto)}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.detalle}</p>
                    </div>
                ))}
            </div>
            {resumen.truncado && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    El período tiene más señas de las que podemos sumar de una vez: estos totales están cortos. Achicá el
                    rango de fechas.
                </p>
            )}
        </div>
    )
}

function PanelFiltros({
    sucursales,
    sucursalId,
    onSucursal,
    filtroEstado,
    onEstado,
    desde,
    hasta,
    onDesde,
    onHasta,
    busqueda,
    onBusqueda,
    buscando,
}: {
    sucursales: Array<{ id: string; nombre: string }>
    sucursalId: string
    onSucursal: (v: string) => void
    filtroEstado: string
    onEstado: (v: string) => void
    desde: string
    hasta: string
    onDesde: (v: string) => void
    onHasta: (v: string) => void
    busqueda: string
    onBusqueda: (v: string) => void
    buscando: boolean
}) {
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
                {FILTROS_ESTADO.map(f => (
                    <button
                        key={f.id}
                        type="button"
                        onClick={() => onEstado(f.id)}
                        className={cn(
                            'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                            f.id === filtroEstado
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                    >
                        {f.etiqueta}
                    </button>
                ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {sucursales.length > 1 && (
                    <div>
                        <Label htmlFor="f-sucursal" className="text-xs">
                            Sucursal
                        </Label>
                        <Select value={sucursalId} onValueChange={onSucursal}>
                            <SelectTrigger id="f-sucursal" className="mt-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todas">Todas las sucursales</SelectItem>
                                {sucursales.map(s => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.nombre}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                <div>
                    <Label htmlFor="f-desde" className="text-xs">
                        Desde
                    </Label>
                    <Input id="f-desde" type="date" value={desde} onChange={e => onDesde(e.target.value)} className="mt-1" />
                </div>
                <div>
                    <Label htmlFor="f-hasta" className="text-xs">
                        Hasta
                    </Label>
                    <Input id="f-hasta" type="date" value={hasta} onChange={e => onHasta(e.target.value)} className="mt-1" />
                </div>

                <div>
                    <Label htmlFor="f-busqueda" className="text-xs">
                        Buscar
                    </Label>
                    <div className="relative mt-1">
                        {buscando ? (
                            <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                        ) : (
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        )}
                        <Input
                            id="f-busqueda"
                            value={busqueda}
                            onChange={e => onBusqueda(e.target.value)}
                            placeholder="Nombre o teléfono del cliente"
                            className="pl-8 pr-8"
                        />
                        {busqueda && (
                            <button
                                type="button"
                                onClick={() => onBusqueda('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                aria-label="Limpiar búsqueda"
                            >
                                <X className="size-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {(desde || hasta) && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Filter className="size-3" />
                    El rango de fechas filtra por cuándo se generó la seña, no por el día del turno.
                </p>
            )}
        </div>
    )
}

function Tabla({
    senas,
    puedeDevolver,
    arrepentimientoPorSucursal,
    onDevolver,
    onPerdida,
    ocupado,
}: {
    senas: SenaListada[]
    puedeDevolver: boolean
    arrepentimientoPorSucursal: Record<string, number>
    onDevolver: (s: SenaListada) => void
    onPerdida: (s: SenaListada) => void
    ocupado: boolean
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                        <th className="px-3 py-2 font-semibold">Cliente</th>
                        <th className="px-3 py-2 font-semibold">Turno</th>
                        <th className="px-3 py-2 font-semibold">Servicio</th>
                        <th className="px-3 py-2 text-right font-semibold">Seña</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                        <th className="px-3 py-2 font-semibold">Pago</th>
                        <th className="px-3 py-2" />
                    </tr>
                </thead>
                <tbody>
                    {senas.map(s => {
                        const dentroDeArrepentimiento = enVentanaDeArrepentimiento(
                            s.paidAt,
                            arrepentimientoPorSucursal[s.branchId] ?? 0,
                        )
                        // Una seña `pagada` sin turno puede ser una de dos cosas
                        // OPUESTAS, y sólo `refundReason` las separa: o la
                        // creación del turno falló y hay que resolverla (rojo),
                        // o el cliente canceló a tiempo y la plata le quedó a
                        // favor, que es el default de las cuatro sucursales
                        // (`refund_on_early_cancel = 'credito'`) y es
                        // completamente normal. Pintando las dos de rojo, cada
                        // cancelación común entraba como incidente y el
                        // incidente de verdad se perdía en el ruido.
                        const esCredito =
                            s.status === 'pagada' && !s.appointmentId && !!s.refundReason
                        const sinTurno = s.status === 'pagada' && !s.appointmentId && !esCredito
                        return (
                            <tr
                                key={s.id}
                                className={cn(
                                    'border-b border-border/60 last:border-0',
                                    sinTurno && 'bg-red-500/5',
                                )}
                            >
                                <td className="px-3 py-2.5">
                                    <p className="font-medium">{s.clientName ?? 'Sin nombre'}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {s.clientPhone ?? 'sin teléfono'}
                                        {s.branchName ? ` · ${s.branchName}` : ''}
                                    </p>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                    <p className="tabular-nums">
                                        {fechaTurno(s.appointmentDate)} · {s.startTime.slice(0, 5)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {s.barberName ?? 'sin barbero asignado'}
                                    </p>
                                </td>
                                <td className="max-w-[200px] px-3 py-2.5">
                                    <p className="truncate">{s.serviceNames ?? '—'}</p>
                                    <p className="text-xs text-muted-foreground">
                                        de {formatCurrency(s.serviceTotal)}
                                    </p>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <p className="font-semibold tabular-nums">{formatCurrency(s.amount)}</p>
                                    {s.mpFee != null && s.mpFee > 0 && (
                                        <p className="text-xs text-muted-foreground tabular-nums">
                                            −{formatCurrency(s.mpFee)} comisión
                                        </p>
                                    )}
                                    {s.refundedAmount != null && s.refundedAmount > 0 && (
                                        <p className="text-xs text-sky-600 tabular-nums dark:text-sky-400">
                                            devuelto {formatCurrency(s.refundedAmount)}
                                        </p>
                                    )}
                                    {/* Pagó de más: el turno se confirmó igual, así que no es
                                        una falla y no va en rojo — pero es plata del cliente
                                        que alguien tiene que decidir si devuelve. Si no se
                                        muestra acá no aparece en ninguna pantalla. */}
                                    {s.excedente != null && s.excedente > 0 && (
                                        <p className="text-xs text-amber-600 tabular-nums dark:text-amber-400">
                                            pagó {formatCurrency(s.excedente)} de más
                                        </p>
                                    )}
                                </td>
                                <td className="px-3 py-2.5">
                                    <PastillaEstado estado={s.status} />
                                    {sinTurno && (
                                        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                                            Cobrada sin turno
                                        </p>
                                    )}
                                    {esCredito && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Saldo a favor · canceló el turno a tiempo
                                        </p>
                                    )}
                                    {dentroDeArrepentimiento && (
                                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                            Dentro del plazo de arrepentimiento
                                        </p>
                                    )}
                                    {s.failureReason && (
                                        <p className="mt-1 max-w-[220px] text-xs leading-snug text-muted-foreground">
                                            {s.failureReason}
                                        </p>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                                    <p>{s.channel === 'app' ? 'App' : s.channel === 'web' ? 'Turnero web' : 'Cargada por el equipo'}</p>
                                    <p className="tabular-nums">{s.paidAt ? fechaHora(s.paidAt) : fechaHora(s.createdAt)}</p>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <Acciones
                                        sena={s}
                                        puedeDevolver={puedeDevolver}
                                        onDevolver={onDevolver}
                                        onPerdida={onPerdida}
                                        ocupado={ocupado}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

function Acciones({
    sena,
    puedeDevolver,
    onDevolver,
    onPerdida,
    ocupado,
}: {
    sena: SenaListada
    puedeDevolver: boolean
    onDevolver: (s: SenaListada) => void
    onPerdida: (s: SenaListada) => void
    ocupado: boolean
}) {
    const devolvible = sena.status === 'pagada' || sena.status === 'consumida' || sena.status === 'perdida'
    const perdible = sena.status === 'pagada'
    const hayAlgo = devolvible || perdible || !!sena.appointmentId
    if (!hayAlgo) return null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={ocupado}>
                    Acciones
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {sena.appointmentId && (
                    <DropdownMenuItem asChild>
                        <Link
                            href={`/dashboard/turnos/agenda?fecha=${sena.appointmentDate}&sucursal=${sena.branchId}&turno=${sena.appointmentId}`}
                        >
                            <CalendarClock className="mr-2 size-3.5" />
                            Ver el turno
                        </Link>
                    </DropdownMenuItem>
                )}
                {devolvible && puedeDevolver && (
                    <DropdownMenuItem onSelect={() => onDevolver(sena)}>
                        <RotateCcw className="mr-2 size-3.5" />
                        Devolver la seña
                    </DropdownMenuItem>
                )}
                {perdible && (
                    <DropdownMenuItem onSelect={() => onPerdida(sena)}>
                        <Wallet className="mr-2 size-3.5" />
                        Dar por perdida
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function SinTurno({
    senas,
    onResuelta,
}: {
    senas: SenaSinTurno[]
    onResuelta: (id: string) => void
}) {
    const total = senas.reduce((n, s) => n + s.amount, 0)
    return (
        <Card className="border-red-500/40 bg-red-500/5">
            <CardHeader>
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
                    <div>
                        <CardTitle className="text-base text-red-700 dark:text-red-400">
                            {senas.length === 1
                                ? 'Hay una seña cobrada sin turno'
                                : `Hay ${senas.length} señas cobradas sin turno`}{' '}
                            · {formatCurrency(total)}
                        </CardTitle>
                        <CardDescription className="text-red-700/90 dark:text-red-300/90">
                            El cliente pagó y el turno no llegó a crearse. La plata está en la cuenta de la sucursal y él
                            cree que reservó. Hay que cargarle el turno a mano desde la agenda, o devolverle la seña.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {senas.map(s => (
                    <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-background p-3"
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-medium">
                                {s.clientName ?? 'Sin nombre'}
                                <span className="ml-2 font-normal text-muted-foreground">{s.clientPhone ?? ''}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {fechaTurno(s.appointmentDate)} · {s.startTime.slice(0, 5)}
                                {s.branchName ? ` · ${s.branchName}` : ''}
                                {s.serviceNames ? ` · ${s.serviceNames}` : ''}
                            </p>
                            {s.failureReason && (
                                <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{s.failureReason}</p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <span className="font-semibold tabular-nums">{formatCurrency(s.amount)}</span>
                            <Button size="sm" variant="outline" asChild>
                                <Link
                                    href={`/dashboard/turnos/agenda?fecha=${s.appointmentDate}`}
                                    onClick={() => onResuelta(s.id)}
                                >
                                    Cargar el turno
                                </Link>
                            </Button>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}

function EstadoVacio({ hayCuentaConectada }: { hayCuentaConectada: boolean }) {
    return (
        <Card>
            <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <Wallet className="size-9 text-muted-foreground/40" />
                <div className="max-w-lg space-y-1">
                    <p className="font-medium">Todavía no se cobró ninguna seña</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Acá va a aparecer cada reserva que un cliente pague por adelantado: cuánto pagó, si el turno se
                        confirmó, y qué pasó con esa plata después (se usó en el corte, se devolvió, o quedó para el
                        local porque el cliente no vino).
                    </p>
                </div>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/turnos/configuracion#seccion-cobros-online">
                        {hayCuentaConectada ? 'Configurar la seña' : 'Conectar Mercado Pago'}
                    </Link>
                </Button>
            </CardContent>
        </Card>
    )
}

function Aviso({ texto }: { texto: string }) {
    return (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
            <p className="text-sm">{texto}</p>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿La seña está dentro del plazo de arrepentimiento?
 *
 * Se mide desde el pago, en días corridos. Cuando no sabemos cuándo se pagó,
 * la respuesta es NO: inventar que está dentro del plazo haría que la pantalla
 * prometiera una devolución que después nadie hace.
 */
function enVentanaDeArrepentimiento(paidAt: string | null, dias: number): boolean {
    if (!paidAt || dias <= 0) return false
    const vence = new Date(paidAt).getTime() + dias * 24 * 60 * 60 * 1000
    return Date.now() <= vence
}

/** `appointment_date` es hora de pared: se formatea del string, sin `new Date`. */
function fechaTurno(fecha: string): string {
    const [a, m, d] = fecha.split('-')
    return `${d}/${m}/${a.slice(2)}`
}

function fechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
    })
}
