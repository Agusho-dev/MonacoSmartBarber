'use client'

// =============================================================================
// src/components/facturacion/tabla-comprobantes.tsx
// Listado de comprobantes fiscales emitidos + el detalle imprimible.
//
// Tres decisiones que no son cosméticas:
//
//   1. "No pudimos leer" y "no hay comprobantes" son PANTALLAS DISTINTAS. Una
//      tabla vacía después de un error de lectura le dice al dueño que no
//      facturó nada, que es exactamente lo contrario de lo que pasó.
//   2. El QR va sobre blanco SIEMPRE, aunque el resto respete el modo oscuro:
//      un QR claro sobre fondo oscuro no lo lee ningún teléfono, y ese QR es
//      lo que ARCA exige que esté impreso.
//   3. "Anular" pide confirmación porque en Argentina una factura electrónica
//      no se borra: se compensa con una nota de crédito, que consume su propio
//      número correlativo y queda en los libros para siempre.
// =============================================================================

import { useCallback, useState, useTransition } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
    AlertTriangle,
    ChevronRight,
    FileText,
    Loader2,
    Printer,
    RefreshCw,
    ShieldQuestion,
    Ban,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
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
    emitirNotaCredito,
    getComprobanteImprimible,
    getComprobantes,
    reconciliarEnDuda,
    type ListadoComprobantes,
} from '@/lib/actions/arca-emision'

// -----------------------------------------------------------------------------
// Tipos derivados de las actions: si cambia el server, esto no compila.
// -----------------------------------------------------------------------------

type FilaComprobante = ListadoComprobantes['filas'][number]
type Imprimible = Extract<
    Awaited<ReturnType<typeof getComprobanteImprimible>>,
    { ok: true }
>['data']

interface TablaComprobantesProps {
    datos: ListadoComprobantes
    sucursales: { id: string; name: string }[]
    puedeEmitir: boolean
    onRefrescar: () => void
}

interface Filtros {
    sucursal: string
    estado: string
    desde: string
    hasta: string
}

const FILTROS_VACIOS: Filtros = { sucursal: 'todas', estado: 'todos', desde: '', hasta: '' }
const LIMITE = 300

// -----------------------------------------------------------------------------
// Formatos
// -----------------------------------------------------------------------------

const PESOS = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
})

const plata = (n: number) => PESOS.format(n)

/**
 * `yyyy-mm-dd` → `dd/mm/aaaa`, partiendo el string.
 * NO se usa `new Date(...)`: una fecha sola se parsea en UTC y al mostrarla en
 * hora argentina retrocede un día. La fecha de un comprobante es un dato de
 * pared, no un instante.
 */
function fechaCorta(iso: string | null | undefined): string {
    if (!iso) return '—'
    const [a, m, d] = iso.slice(0, 10).split('-')
    if (!a || !m || !d) return iso
    return `${d}/${m}/${a}`
}

// -----------------------------------------------------------------------------
// Estados
// -----------------------------------------------------------------------------

const ESTADOS: Record<string, { etiqueta: string; clase: string; tachado?: boolean }> = {
    emitida: {
        etiqueta: 'Emitida',
        clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    },
    rechazada: {
        etiqueta: 'Rechazada',
        clase: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
    },
    en_duda: {
        etiqueta: 'En duda',
        clase: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
    anulada: {
        etiqueta: 'Anulada',
        clase: 'border-border bg-muted text-muted-foreground line-through',
        tachado: true,
    },
    reservado: {
        etiqueta: 'Reservado',
        clase: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    },
    pendiente: {
        etiqueta: 'Pendiente',
        clase: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    },
}

function metaEstado(estado: string) {
    return (
        ESTADOS[estado] ?? {
            etiqueta: estado,
            clase: 'border-border bg-muted text-muted-foreground',
        }
    )
}

const VIAS: Record<string, string> = {
    manual: 'Emitido a mano',
    automatico: 'Emitido automáticamente',
    prueba: 'Emisión de prueba',
    nota_credito: 'Emitido como nota de crédito',
}

const DOCS: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 87: 'CDI', 96: 'DNI' }

/** Los tipos 3, 8 y 13 ya SON notas de crédito: no se anulan con otra. */
const TIPOS_NOTA_CREDITO = [3, 8, 13]

// -----------------------------------------------------------------------------
// Piezas chicas
// -----------------------------------------------------------------------------

/** La letra es cómo se identifica una factura argentina. Va en recuadro. */
function Letra({ letra, grande = false }: { letra: string; grande?: boolean }) {
    return (
        <span
            className={
                grande
                    ? 'flex size-14 shrink-0 items-center justify-center rounded-md border-2 border-foreground/60 text-2xl font-bold leading-none'
                    : 'flex size-7 shrink-0 items-center justify-center rounded border border-foreground/40 text-[13px] font-bold leading-none'
            }
        >
            {letra || '—'}
        </span>
    )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
    return (
        <div className="flex justify-between gap-4 py-1 text-sm">
            <span className="shrink-0 text-muted-foreground">{etiqueta}</span>
            <span className="text-right font-medium break-words">{valor || '—'}</span>
        </div>
    )
}

function BloqueError({
    titulo,
    detalle,
    onReintentar,
    reintentando,
}: {
    titulo: string
    detalle: string
    onReintentar?: () => void
    reintentando?: boolean
}) {
    return (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-destructive">{titulo}</p>
                    <p className="mt-1 text-sm text-foreground/80">{detalle}</p>
                    {onReintentar && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={onReintentar}
                            disabled={reintentando}
                        >
                            {reintentando ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <RefreshCw className="size-4" />
                            )}
                            Reintentar
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

// -----------------------------------------------------------------------------
// Componente
// -----------------------------------------------------------------------------

export function TablaComprobantes({
    datos,
    sucursales,
    puedeEmitir,
    onRefrescar,
}: TablaComprobantesProps) {
    // El listado que se muestra arranca en el prop y después lo maneja el
    // cliente al refiltrar. Cuando el padre trae datos nuevos (onRefrescar),
    // se vuelve a sincronizar.
    const [listado, setListado] = useState<ListadoComprobantes>(datos)
    const [datosPrevios, setDatosPrevios] = useState(datos)
    if (datos !== datosPrevios) {
        setDatosPrevios(datos)
        setListado(datos)
    }

    const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
    const [cargando, iniciarCarga] = useTransition()
    const [verificando, iniciarVerificacion] = useTransition()
    const [anulando, iniciarAnulacion] = useTransition()

    const [abierto, setAbierto] = useState(false)
    const [filaActiva, setFilaActiva] = useState<FilaComprobante | null>(null)
    const [detalle, setDetalle] = useState<Imprimible | null>(null)
    const [errorDetalle, setErrorDetalle] = useState<string | null>(null)
    const [cargandoDetalle, setCargandoDetalle] = useState(false)
    const [confirmarNC, setConfirmarNC] = useState(false)

    const hayFiltros =
        filtros.sucursal !== 'todas' ||
        filtros.estado !== 'todos' ||
        filtros.desde !== '' ||
        filtros.hasta !== ''

    const recargar = useCallback((f: Filtros) => {
        iniciarCarga(async () => {
            const res = await getComprobantes({
                branchId: f.sucursal === 'todas' ? null : f.sucursal,
                estado: f.estado === 'todos' ? null : f.estado,
                desde: f.desde || null,
                hasta: f.hasta || null,
                limite: LIMITE,
            })
            setListado(res)
        })
    }, [])

    const cambiar = useCallback(
        (parcial: Partial<Filtros>) => {
            const siguiente = { ...filtros, ...parcial }
            setFiltros(siguiente)
            recargar(siguiente)
        },
        [filtros, recargar],
    )

    const limpiar = useCallback(() => {
        setFiltros(FILTROS_VACIOS)
        recargar(FILTROS_VACIOS)
    }, [recargar])

    // --- Detalle -------------------------------------------------------------

    const abrirDetalle = useCallback(async (fila: FilaComprobante) => {
        setFilaActiva(fila)
        setDetalle(null)
        setErrorDetalle(null)
        setAbierto(true)
        setCargandoDetalle(true)
        const res = await getComprobanteImprimible(fila.id)
        if ('ok' in res) setDetalle(res.data)
        else setErrorDetalle(res.error)
        setCargandoDetalle(false)
    }, [])

    // --- Verificar los que quedaron en duda ----------------------------------

    const enDuda = listado.filas.filter((f) => f.estado === 'en_duda')

    const verificar = useCallback(() => {
        iniciarVerificacion(async () => {
            const res = await reconciliarEnDuda()
            if ('error' in res) {
                toast.error(res.error)
                return
            }
            // `sinVerificar` son los que NO se pudieron consultar (el monotributo
            // con el que se emitieron ya no está, o ARCA no contestó). Se dicen
            // aparte porque siguen trabados: callarlos daría la impresión de que
            // la pantalla quedó limpia.
            const trabados =
                res.sinVerificar > 0
                    ? ` Quedaron ${res.sinVerificar} sin poder verificar: los dejamos como estaban, ` +
                      'porque liberarlos sin saber qué contestó ARCA puede duplicar un comprobante.'
                    : ''
            if (res.revisados === 0 && res.sinVerificar === 0) {
                toast.success('No quedó ningún comprobante en duda.')
            } else if (res.revisados === 0) {
                toast.warning(`No pudimos verificar ${res.sinVerificar} comprobante${res.sinVerificar === 1 ? '' : 's'}`, {
                    description: trabados.trim(),
                })
            } else {
                toast.success(`Revisamos ${res.revisados} comprobante${res.revisados === 1 ? '' : 's'}`, {
                    description:
                        `${res.confirmados} estaba${res.confirmados === 1 ? '' : 'n'} emitido${res.confirmados === 1 ? '' : 's'} en ARCA y ya tiene${res.confirmados === 1 ? '' : 'n'} su CAE. ` +
                        `${res.liberados} no llegó a emitirse: ese número queda libre para el próximo comprobante.` +
                        trabados,
                })
            }
            onRefrescar()
        })
    }, [onRefrescar])

    // --- Nota de crédito -----------------------------------------------------

    const anular = useCallback(() => {
        if (!filaActiva) return
        const id = filaActiva.id
        iniciarAnulacion(async () => {
            const res = await emitirNotaCredito(id)
            setConfirmarNC(false)
            if ('ok' in res) {
                toast.success(`Nota de crédito ${res.data.numero} emitida`, {
                    description: `CAE ${res.data.cae}. El comprobante original quedó anulado.`,
                })
                setAbierto(false)
                onRefrescar()
                return
            }
            toast.error(res.error, {
                description: res.traducido
                    ? [res.traducido.detalle, res.traducido.accion].filter(Boolean).join(' ')
                    : undefined,
            })
        })
    }, [filaActiva, onRefrescar])

    const puedeAnular =
        puedeEmitir &&
        filaActiva?.estado === 'emitida' &&
        !TIPOS_NOTA_CREDITO.includes(filaActiva.tipo)

    // -------------------------------------------------------------------------

    return (
        <div className="space-y-4">
            {/* Reglas de impresión: se imprime SÓLO el detalle, en blanco y negro.
                Sin esto se imprimiría la pantalla entera — filtros, tabla y menú. */}
            <style>{`
                @media print {
                    body * { visibility: hidden !important; }
                    [data-slot="sheet-overlay"] { display: none !important; }
                    [data-slot="sheet-content"] {
                        position: static !important;
                        transform: none !important;
                        width: auto !important;
                        max-width: none !important;
                        height: auto !important;
                        max-height: none !important;
                        overflow: visible !important;
                        border: 0 !important;
                        box-shadow: none !important;
                    }
                    [data-comprobante-imprimible],
                    [data-comprobante-imprimible] * { visibility: visible !important; }
                    [data-comprobante-imprimible] {
                        position: absolute !important;
                        left: 0; top: 0; width: 100%;
                        padding: 14mm 12mm !important;
                        background: #fff !important;
                        color: #000 !important;
                    }
                    [data-comprobante-imprimible] * {
                        color: #000 !important;
                        background-color: transparent !important;
                        border-color: #9ca3af !important;
                    }
                    [data-fondo-blanco] { background-color: #fff !important; }
                    [data-print-oculto] { display: none !important; }
                }
            `}</style>

            {/* -------------------------------------------------- Filtros */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-[9rem] flex-1 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sucursal</Label>
                    <Select
                        value={filtros.sucursal}
                        onValueChange={(v) => cambiar({ sucursal: v })}
                        disabled={cargando}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todas">Todas las sucursales</SelectItem>
                            {sucursales.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="min-w-[9rem] flex-1 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Estado</Label>
                    <Select
                        value={filtros.estado}
                        onValueChange={(v) => cambiar({ estado: v })}
                        disabled={cargando}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Todos los estados</SelectItem>
                            <SelectItem value="emitida">Emitida</SelectItem>
                            <SelectItem value="rechazada">Rechazada</SelectItem>
                            <SelectItem value="en_duda">En duda</SelectItem>
                            <SelectItem value="anulada">Anulada</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="min-w-[8.5rem] space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Desde</Label>
                    <Input
                        type="date"
                        value={filtros.desde}
                        onChange={(e) => cambiar({ desde: e.target.value })}
                        disabled={cargando}
                    />
                </div>

                <div className="min-w-[8.5rem] space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Hasta</Label>
                    <Input
                        type="date"
                        value={filtros.hasta}
                        onChange={(e) => cambiar({ hasta: e.target.value })}
                        disabled={cargando}
                    />
                </div>

                <div className="ml-auto flex items-center gap-3 pb-0.5">
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {cargando ? (
                            <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="size-3.5 animate-spin" /> Buscando…
                            </span>
                        ) : (
                            `${listado.total} comprobante${listado.total === 1 ? '' : 's'}`
                        )}
                    </span>
                    {hayFiltros && (
                        <Button variant="ghost" size="sm" onClick={limpiar} disabled={cargando}>
                            Limpiar filtros
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => recargar(filtros)}
                        disabled={cargando}
                        aria-label="Actualizar listado"
                    >
                        <RefreshCw className={cargando ? 'size-4 animate-spin' : 'size-4'} />
                    </Button>
                </div>
            </div>

            {/* -------------------------------------------------- Error de lectura */}
            {listado.error ? (
                <BloqueError
                    titulo="No pudimos leer los comprobantes"
                    detalle={`${listado.error} Esto NO quiere decir que no hayas facturado: quiere decir que no pudimos consultar el listado. Probá de nuevo en un momento.`}
                    onReintentar={() => recargar(filtros)}
                    reintentando={cargando}
                />
            ) : (
                <>
                    {/* ---------------------------------------- Aviso: en duda */}
                    {enDuda.length > 0 && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                            <div className="flex flex-wrap items-start gap-3">
                                <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-amber-700 dark:text-amber-400">
                                        {enDuda.length === 1
                                            ? 'Hay 1 comprobante en duda'
                                            : `Hay ${enDuda.length} comprobantes en duda`}
                                    </p>
                                    <p className="mt-1 max-w-3xl text-sm text-foreground/80">
                                        Mientras se pedía el número, se cortó la comunicación con ARCA y no
                                        sabemos si el comprobante llegó a emitirse. Puede estar emitido allá y
                                        no acá. No lo emitas de nuevo: si lo hacés, corrés el riesgo de
                                        facturar dos veces la misma venta. Tocá el botón y le preguntamos a
                                        ARCA uno por uno.
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-3"
                                        onClick={verificar}
                                        disabled={verificando}
                                    >
                                        {verificando ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <ShieldQuestion className="size-4" />
                                        )}
                                        {verificando ? 'Verificando…' : 'Verificar contra ARCA'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---------------------------------------- Tabla */}
                    {listado.filas.length === 0 ? (
                        <div className="rounded-2xl border">
                            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                                <FileText className="size-8 text-muted-foreground" />
                                {hayFiltros ? (
                                    <>
                                        <p className="font-medium">
                                            Ningún comprobante coincide con lo que buscaste
                                        </p>
                                        <p className="max-w-md text-sm text-muted-foreground">
                                            Probá con otra sucursal, otro estado o un rango de fechas más
                                            amplio.
                                        </p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            onClick={limpiar}
                                            disabled={cargando}
                                        >
                                            Limpiar filtros
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <p className="font-medium">Todavía no emitiste comprobantes</p>
                                        <p className="max-w-md text-sm text-muted-foreground">
                                            Acá van a aparecer las facturas y notas de crédito con su número,
                                            su CAE y el QR de ARCA, a medida que se vayan emitiendo.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-2xl border">
                            <div className="max-h-[65vh] overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                                        <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                                            <th className="px-3 py-2.5 font-semibold">Comprobante</th>
                                            <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                                                Fecha
                                            </th>
                                            <th className="hidden px-3 py-2.5 font-semibold md:table-cell">
                                                Sucursal
                                            </th>
                                            <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">
                                                Receptor
                                            </th>
                                            <th className="px-3 py-2.5 text-right font-semibold">Importe</th>
                                            <th className="px-3 py-2.5 font-semibold">Estado</th>
                                            <th className="px-2 py-2.5" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listado.filas.map((fila) => {
                                            const meta = metaEstado(fila.estado)
                                            const conProblema =
                                                fila.estado === 'rechazada' || fila.estado === 'en_duda'
                                            return (
                                                <tr
                                                    key={fila.id}
                                                    onClick={() => abrirDetalle(fila)}
                                                    className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                                                >
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center gap-2.5">
                                                            <Letra letra={fila.letra} />
                                                            <div className="min-w-0">
                                                                <p
                                                                    className={
                                                                        meta.tachado
                                                                            ? 'font-semibold tabular-nums line-through text-muted-foreground'
                                                                            : 'font-semibold tabular-nums'
                                                                    }
                                                                >
                                                                    {fila.numero}
                                                                </p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {fila.nombreTipo}
                                                                </p>
                                                                {/* El título traducido, no el grito de ARCA en
                                                                    mayúsculas. El detalle y el trámite van en la
                                                                    hoja de detalle, que es donde hay lugar. */}
                                                                {conProblema && (fila.errorTraducido || fila.error) && (
                                                                    <p className="mt-0.5 max-w-[22rem] text-xs text-amber-600 dark:text-amber-400">
                                                                        {fila.errorTraducido?.titulo ?? fila.error}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                                                        {fechaCorta(fila.fecha)}
                                                    </td>
                                                    <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">
                                                        {fila.branchName ?? '—'}
                                                    </td>
                                                    <td className="hidden px-3 py-2.5 lg:table-cell">
                                                        {fila.receptor ?? (
                                                            <span className="text-muted-foreground">
                                                                Consumidor Final
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td
                                                        className={
                                                            meta.tachado
                                                                ? 'px-3 py-2.5 text-right font-bold whitespace-nowrap tabular-nums line-through text-muted-foreground'
                                                                : 'px-3 py-2.5 text-right font-bold whitespace-nowrap tabular-nums'
                                                        }
                                                    >
                                                        {plata(fila.total)}
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <Badge variant="outline" className={meta.clase}>
                                                            {meta.etiqueta}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right">
                                                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                                                            Ver
                                                            <ChevronRight className="size-4" />
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {listado.filas.length < listado.total && (
                                <p className="border-t bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
                                    Mostrando los {listado.filas.length} más recientes de {listado.total}.
                                    Acotá el rango de fechas o filtrá por sucursal para ver el resto.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* -------------------------------------------------- Detalle */}
            <Sheet open={abierto} onOpenChange={setAbierto}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                    <SheetHeader data-print-oculto>
                        <SheetTitle>
                            {filaActiva ? `${filaActiva.nombreTipo} ${filaActiva.numero}` : 'Comprobante'}
                        </SheetTitle>
                        <SheetDescription>
                            {filaActiva ? VIAS[filaActiva.emitidoVia] ?? 'Comprobante fiscal' : ''}
                        </SheetDescription>
                    </SheetHeader>

                    <div className="px-4 pb-6">
                        {cargandoDetalle && (
                            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                                <Loader2 className="size-4 animate-spin" />
                                Buscando el comprobante…
                            </div>
                        )}

                        {!cargandoDetalle && errorDetalle && (
                            <BloqueError
                                titulo="No pudimos abrir el comprobante"
                                detalle={errorDetalle}
                                onReintentar={filaActiva ? () => abrirDetalle(filaActiva) : undefined}
                            />
                        )}

                        {/* POR QUÉ FALLÓ, con el trámite que haya que hacer.
                            Esta hoja es a donde manda el toast de la emisión
                            ("revisá el detalle en Comprobantes") y hasta ahora lo
                            único que había era el texto crudo de ARCA en la fila
                            de la tabla. */}
                        {!cargandoDetalle && filaActiva?.errorTraducido && (
                            <div
                                className={cn(
                                    'mb-4 rounded-lg border p-3 text-sm',
                                    filaActiva.errorTraducido.culpa === 'usuario'
                                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                        : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
                                )}
                                data-print-oculto
                            >
                                <p className="font-semibold">{filaActiva.errorTraducido.titulo}</p>
                                <p className="mt-1 text-xs leading-relaxed">{filaActiva.errorTraducido.detalle}</p>
                                {filaActiva.errorTraducido.accion && (
                                    <p className="mt-1.5 text-xs font-medium leading-relaxed">
                                        {filaActiva.errorTraducido.accion}
                                    </p>
                                )}
                                {filaActiva.error && (
                                    <details className="mt-2">
                                        <summary className="cursor-pointer text-xs opacity-70">
                                            Lo que contestó ARCA
                                        </summary>
                                        <p className="mt-1 font-mono text-[11px] leading-relaxed break-words opacity-80">
                                            {filaActiva.error}
                                        </p>
                                    </details>
                                )}
                            </div>
                        )}

                        {!cargandoDetalle && detalle && (
                            <>
                                {/* --- Lo que se imprime --- */}
                                <div
                                    data-comprobante-imprimible
                                    className="space-y-4 print:block print:space-y-3"
                                >
                                    {detalle.ambiente === 'homologacion' && (
                                        <div className="rounded-lg border-2 border-amber-500 bg-amber-500/15 px-3 py-2 text-center">
                                            <p className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                                Comprobante de PRUEBA — sin validez fiscal
                                            </p>
                                        </div>
                                    )}

                                    {/* Encabezado */}
                                    <div className="flex items-start gap-4 border-b pb-4">
                                        <Letra letra={detalle.letra} grande />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-base font-semibold">{detalle.nombreTipo}</p>
                                            <p className="text-lg font-bold tabular-nums">{detalle.numero}</p>
                                            <p className="text-sm text-muted-foreground tabular-nums">
                                                Fecha de emisión: {fechaCorta(detalle.fecha)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Cód. {detalle.codigoTipo}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Emisor */}
                                    <div>
                                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Emisor
                                        </p>
                                        <p className="text-sm font-semibold">
                                            {detalle.emisor.razonSocial || '—'}
                                        </p>
                                        <div className="mt-1 divide-y divide-border/60">
                                            <Dato etiqueta="CUIT" valor={detalle.emisor.cuit} />
                                            <Dato etiqueta="Domicilio" valor={detalle.emisor.domicilio} />
                                            <Dato
                                                etiqueta="Condición frente al IVA"
                                                valor={detalle.emisor.condicionIva}
                                            />
                                            <Dato
                                                etiqueta="Ingresos Brutos"
                                                valor={detalle.emisor.ingresosBrutos}
                                            />
                                            <Dato
                                                etiqueta="Inicio de actividades"
                                                valor={fechaCorta(detalle.emisor.inicioActividades)}
                                            />
                                        </div>
                                    </div>

                                    {/* Receptor */}
                                    <div>
                                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Receptor
                                        </p>
                                        <div className="divide-y divide-border/60">
                                            <Dato
                                                etiqueta="Nombre"
                                                valor={detalle.receptor.nombre || 'Consumidor Final'}
                                            />
                                            <Dato
                                                etiqueta="Documento"
                                                valor={
                                                    detalle.receptor.docTipo === 99 ||
                                                    detalle.receptor.docNro === 0
                                                        ? 'Sin identificar'
                                                        : `${DOCS[detalle.receptor.docTipo] ?? 'Doc.'} ${detalle.receptor.docNro}`
                                                }
                                            />
                                            <Dato
                                                etiqueta="Condición frente al IVA"
                                                valor={detalle.receptor.condicionIva}
                                            />
                                        </div>
                                    </div>

                                    {/* Período del servicio */}
                                    {(detalle.periodoServicio.desde || detalle.periodoServicio.hasta) && (
                                        <div>
                                            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                Período del servicio
                                            </p>
                                            <div className="divide-y divide-border/60">
                                                <Dato
                                                    etiqueta="Desde"
                                                    valor={fechaCorta(detalle.periodoServicio.desde)}
                                                />
                                                <Dato
                                                    etiqueta="Hasta"
                                                    valor={fechaCorta(detalle.periodoServicio.hasta)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Importes: el desglose sólo si hay IVA discriminado. */}
                                    <div className="rounded-lg border p-3">
                                        {detalle.iva > 0 && (
                                            <div className="mb-2 space-y-1 border-b pb-2">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">Neto gravado</span>
                                                    <span className="tabular-nums">{plata(detalle.neto)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">IVA</span>
                                                    <span className="tabular-nums">{plata(detalle.iva)}</span>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-sm font-semibold">Importe total</span>
                                            <span className="text-xl font-bold tabular-nums">
                                                {plata(detalle.total)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* CAE + QR */}
                                    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                CAE
                                            </p>
                                            <p className="text-base font-bold tabular-nums break-all">
                                                {detalle.cae ?? 'Sin CAE'}
                                            </p>
                                            <p className="text-sm text-muted-foreground tabular-nums">
                                                Fecha de Vto.: {fechaCorta(detalle.caeVto)}
                                            </p>
                                        </div>

                                        {detalle.qrUrl ? (
                                            <div
                                                data-fondo-blanco
                                                className="rounded bg-white p-3"
                                                title="QR de ARCA"
                                            >
                                                <QRCodeSVG
                                                    value={detalle.qrUrl}
                                                    size={140}
                                                    bgColor="#ffffff"
                                                    fgColor="#000000"
                                                />
                                            </div>
                                        ) : (
                                            <p className="max-w-[12rem] text-xs text-muted-foreground">
                                                Este comprobante todavía no tiene CAE, así que no tiene QR.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* --- Acciones (no se imprimen) --- */}
                                <div
                                    data-print-oculto
                                    className="mt-6 flex flex-wrap gap-2 border-t pt-4 print:hidden"
                                >
                                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                                        <Printer className="size-4" />
                                        Imprimir
                                    </Button>
                                    {puedeAnular && (
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => setConfirmarNC(true)}
                                            disabled={anulando}
                                        >
                                            {anulando ? (
                                                <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                                <Ban className="size-4" />
                                            )}
                                            Anular con nota de crédito
                                        </Button>
                                    )}
                                </div>

                                {filaActiva?.estado === 'anulada' && (
                                    <p
                                        data-print-oculto
                                        className="mt-3 text-xs text-muted-foreground print:hidden"
                                    >
                                        Este comprobante ya fue anulado con una nota de crédito. Queda en los
                                        libros igual: en Argentina una factura electrónica no se borra.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            {/* -------------------------------------------------- Confirmar nota de crédito */}
            <AlertDialog open={confirmarNC} onOpenChange={(o) => !o && setConfirmarNC(false)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Anular {filaActiva?.nombreTipo} {filaActiva?.numero}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            En Argentina una factura electrónica no se borra: se anula emitiendo una nota de
                            crédito por el mismo importe ({filaActiva ? plata(filaActiva.total) : ''}), que
                            queda registrada en ARCA con su propio número y su propio CAE. La factura original
                            va a figurar como anulada, pero sigue existiendo en los libros. Esto no se puede
                            deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={anulando}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault()
                                anular()
                            }}
                            disabled={anulando}
                        >
                            {anulando ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    Emitiendo…
                                </>
                            ) : (
                                'Emitir nota de crédito'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export default TablaComprobantes
