'use client'

// =============================================================================
// src/components/facturacion/panel-barberos.tsx
//
// EL PANEL DE LOS MONOTRIBUTOS. Una fila por barbero.
//
// En Monaco cada barbero tiene su propio monotributo y factura sus propios
// cortes; los dueños administran los ~13 desde acá y deciden cuánto factura
// cada uno. De ahí que la pantalla tenga que sostener DOS controles que se
// parecen y no son lo mismo:
//
//   · CUPO del período — la palanca. "A Lucas le facturamos 40 cortes por mes."
//     Lo mueve el dueño, se cumple o no se cumple, y no tiene consecuencias
//     fuera de la app.
//
//   · TOPE ANUAL — el límite real. Se mide sobre 12 meses MÓVILES (como mide
//     ARCA para recategorizar) contra el tope de la categoría. Pasarse no es
//     "quedó pendiente": es recategorización, o directamente exclusión.
//
// Por eso las dos barras se ven distinto a propósito. La del cupo es neutra: es
// una meta. La del tope tiene semáforo: es un límite. Si las dos fueran iguales
// habría que leer la etiqueta para saber cuál duele, y el dato más importante
// del panel no puede depender de que alguien lea la etiqueta.
//
// La otra decisión de fondo: un barbero a medio configurar NO es un error. El
// panel va a arrancar con 12 de 13 sin monotributo cargado, y si eso se pinta
// de rojo la pantalla nace gritando y nadie la mira más. Los incompletos van en
// gris, con el botón de lo que falta hacer. El rojo queda reservado para lo que
// de verdad es rojo: el tope.
// =============================================================================

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
    AlertTriangle,
    CalendarRange,
    CheckCircle2,
    ChevronRight,
    FileText,
    Hash,
    Loader2,
    Receipt,
    Save,
    Settings2,
    ShieldAlert,
    TrendingUp,
    UserPlus,
    Wallet,
    XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
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

import { cn } from '@/lib/utils'
import {
    ETIQUETA_PERIODO,
    porcentajeCupo,
    type ModoCupo,
    type PeriodoCupo,
} from '@/lib/arca/cupo'
import {
    vincularBarbero,
    actualizarCategoria,
    guardarCupoBarbero,
    facturarPendientesDe,
    type PanelFacturacion,
    type FilaPanel,
    type OrigenVentas,
} from '@/lib/actions/arca-panel'

// -----------------------------------------------------------------------------
// Formato
// -----------------------------------------------------------------------------

const money = (n: number) =>
    new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0,
    }).format(Number.isFinite(n) ? n : 0)

const numero = (n: number) => new Intl.NumberFormat('es-AR').format(Number.isFinite(n) ? n : 0)

function formatearCuit(digitos: string): string {
    const d = (digitos || '').replace(/\D/g, '')
    if (d.length <= 2) return d
    if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

function soloDigitos(valor: string): string {
    return valor.replace(/\D/g, '').slice(0, 11)
}

/**
 * Dígito verificador del CUIT, replicado del server (`cuitEsValido`) para poder
 * marcarlo MIENTRAS se tipea. El server revalida igual: esto es comodidad, no
 * seguridad. Detectar un CUIT mal tipeado acá evita descubrirlo recién cuando
 * ARCA rechaza el primer comprobante.
 */
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
function cuitValido(digitos: string): boolean {
    if (!/^\d{11}$/.test(digitos)) return false
    const d = digitos.split('').map(Number)
    const resto = PESOS_CUIT.reduce((acc, p, i) => acc + p * d[i], 0) % 11
    const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
    return verificador === d[10]
}

function iniciales(nombre: string): string {
    const partes = (nombre || '').trim().split(/\s+/).filter(Boolean)
    if (!partes.length) return '?'
    return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase()
}

function soloNumero(valor: string): number | null {
    const limpio = valor.replace(/\D/g, '')
    if (!limpio) return null
    return Number(limpio)
}

/** Etiqueta del período del cupo, en primera persona del calendario. */
function etiquetaPeriodoCorta(p: PeriodoCupo | null | undefined): string {
    if (p === 'dia') return 'Hoy'
    if (p === 'semana') return 'Esta semana'
    return 'Este mes'
}

// -----------------------------------------------------------------------------
// Semáforo del tope anual
//
// El único color con significado fuerte de la pantalla. Los cortes son de
// producto, no estéticos: <70 hay margen, 70–89 conviene mirarlo, ≥90 hay que
// decidir algo (frenar el cupo o recategorizar).
// -----------------------------------------------------------------------------

type NivelTope = 'ok' | 'atencion' | 'riesgo'

interface Semaforo {
    nivel: NivelTope
    barra: string
    texto: string
    borde: string
    fondo: string
}

const SEMAFOROS: Record<NivelTope, Semaforo> = {
    ok: {
        nivel: 'ok',
        barra: 'bg-emerald-500',
        texto: 'text-emerald-600 dark:text-emerald-400',
        borde: 'border-emerald-500/30',
        fondo: 'bg-emerald-500/10',
    },
    atencion: {
        nivel: 'atencion',
        barra: 'bg-amber-500',
        texto: 'text-amber-600 dark:text-amber-400',
        borde: 'border-amber-500/30',
        fondo: 'bg-amber-500/10',
    },
    riesgo: {
        nivel: 'riesgo',
        barra: 'bg-red-500',
        texto: 'text-red-600 dark:text-red-400',
        borde: 'border-red-500/30',
        fondo: 'bg-red-500/10',
    },
}

function nivelDeTope(porcentaje: number | null): NivelTope {
    if (porcentaje === null) return 'ok'
    if (porcentaje >= 90) return 'riesgo'
    if (porcentaje >= 70) return 'atencion'
    return 'ok'
}

// -----------------------------------------------------------------------------
// Lecturas derivadas de una fila
//
// Todo lo que la pantalla decide sobre un barbero sale de ACÁ, una sola vez.
// El encabezado, el orden de la lista y la barra de cada fila leen la misma
// función: si el resumen dijera "2 en riesgo" y la lista mostrara 3 en rojo,
// el panel dejaría de ser confiable justo en el dato que justifica su
// existencia.
// -----------------------------------------------------------------------------

interface Lectura {
    /** Porcentaje del tope anual consumido. `null` = no se puede medir. */
    pctAnual: number | null
    nivel: NivelTope
    semaforo: Semaforo
    /** Ya se pasó del tope. */
    excedido: boolean
    /** Cuánto se pasó (0 si no se pasó). */
    excedente: number
    /** A este ritmo cierra por encima del tope. */
    proyectaExceso: boolean
    /** Por cuánto se pasaría según la proyección. */
    excesoProyectado: number
    /** Entra en el bloque ámbar del encabezado. */
    enAlerta: boolean
    /** Está en condiciones de emitir. */
    operativo: boolean
    /** Falta terminar de configurarlo (no es un fallo). */
    incompleto: boolean
    pctCupo: number
    tieneCupo: boolean
}

function leer(f: FilaPanel): Lectura {
    const anual = f.anual
    const tope = anual?.topeAnual ?? null
    const facturado = anual?.facturado12m ?? 0
    const pctAnual = anual?.porcentaje ?? null

    const excedido = tope !== null && tope > 0 && facturado > tope
    const excedente = excedido && tope !== null ? facturado - tope : 0

    // El exceso proyectado ya viene calculado del server (`excesoProyectado`,
    // 0 si no se pasa). No se recalcula acá: dos cuentas del mismo número es
    // como terminan divergiendo la tarjeta y la fila.
    const excesoProyectado = anual?.excesoProyectado ?? 0
    const proyectaExceso = excesoProyectado > 0

    const nivel = nivelDeTope(pctAnual)
    const operativo = f.estado === 'listo'
    const incompleto =
        f.estado === 'sin_monotributo' ||
        f.estado === 'sin_certificado' ||
        f.estado === 'sin_punto_venta'

    const cupo = f.cupo
    const modo: ModoCupo = cupo?.modo ?? 'manual'
    const tieneCupo = !!cupo && modo !== 'manual'
    // `CupoMensual` tiene las mismas claves que `EstadoCupo`, así que el
    // porcentaje sale de la MISMA función que usa el editor de cupo y el cron.
    const pctCupo = cupo ? porcentajeCupo(cupo, modo) : 0

    return {
        pctAnual,
        nivel,
        semaforo: SEMAFOROS[nivel],
        excedido,
        excedente,
        proyectaExceso,
        excesoProyectado,
        // El bloque de arriba nombra a los que están al límite Y a los que van
        // camino a estarlo. Un barbero al 60% que proyecta cerrar 20% arriba del
        // tope todavía está a tiempo de que le bajen el cupo; enterarse en
        // noviembre no sirve para nada.
        enAlerta: (pctAnual !== null && pctAnual >= UMBRAL_RIESGO) || proyectaExceso,
        operativo,
        incompleto,
        pctCupo,
        tieneCupo,
    }
}

/** Ancho de barra: el dato puede pasarse de 100, el dibujo no. */
function ancho(pct: number | null): string {
    const v = Math.min(100, Math.max(0, pct ?? 0))
    return `${v}%`
}

// -----------------------------------------------------------------------------
// Estado de configuración
// -----------------------------------------------------------------------------

const ESTADOS: Record<
    FilaPanel['estado'],
    { etiqueta: string; clase: string; accion: string | null }
> = {
    listo: {
        etiqueta: 'Listo',
        clase: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        accion: null,
    },
    sin_monotributo: {
        etiqueta: 'Sin monotributo',
        clase: 'border-border bg-muted text-muted-foreground',
        accion: 'Dar de alta',
    },
    sin_certificado: {
        etiqueta: 'Falta certificado',
        clase: 'border-border bg-muted text-muted-foreground',
        accion: 'Seguir configurando',
    },
    sin_punto_venta: {
        etiqueta: 'Falta punto de venta',
        clase: 'border-border bg-muted text-muted-foreground',
        accion: 'Seguir configurando',
    },
    error: {
        etiqueta: 'Con problema',
        clase: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
        accion: 'Revisar',
    },
}

const CATEGORIAS_FALLBACK = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

/**
 * A partir de acá el barbero entra en el bloque ámbar.
 *
 * Es el mismo 85 que usa `UMBRAL_RIESGO` en `arca-panel.ts` para contar
 * `resumen.enRiesgo`, y tiene que seguir siéndolo: si el server contara con un
 * umbral y la pantalla listara con otro, la tarjeta diría "3 en riesgo" arriba
 * de una lista de 2 nombres y el panel dejaría de ser creíble justo en el dato
 * que justifica su existencia.
 */
const UMBRAL_RIESGO = 85

/**
 * Lo que `guardarCupoBarbero` pide y `CupoMensual` NO devuelve.
 *
 * OJO: la action hace un UPDATE de la fila entera de `arca_billing_policies`,
 * así que estos valores PISAN los que tenga guardados el barbero. Como la vista
 * del panel no los trae, no hay forma de conservarlos desde acá y cada guardado
 * de cupo los devuelve al default. Son los mismos defaults que usa
 * `editor-cupo.tsx`, para que al menos las dos pantallas coincidan.
 *
 * El arreglo de verdad es del lado del server (que `CupoMensual` los exponga, o
 * que la action haga merge en vez de UPDATE completo). Mientras tanto, la
 * pantalla lo dice en voz alta abajo del botón en lugar de resetear en silencio.
 */
/** Criterios de orden de la lista. */
type Orden = 'atencion' | 'facturado' | 'nombre'

/**
 * Peso de urgencia: cuanto MENOR, más arriba va en la lista.
 *
 * El orden por defecto no es alfabético a propósito. Con 19 barberos, un panel
 * ordenado por nombre obliga a recorrerlo entero para encontrar el problema;
 * ordenado por urgencia, el problema está siempre en la primera fila.
 */
function peso(fila: FilaPanel, l: Lectura): number {
    if (l.excedido) return 0                      // ya se pasó del tope
    if (fila.estado === 'error') return 1         // la conexión con ARCA falla
    if (l.nivel === 'riesgo') return 2            // está por pasarse
    if (fila.estado === 'sin_punto_venta') return 3
    if (fila.estado === 'sin_certificado') return 4
    if (fila.estado === 'sin_monotributo') return 5
    return 6                                      // andando
}

// =============================================================================
// Componente
// =============================================================================

interface PanelBarberosProps {
    datos: PanelFacturacion
    puedeConfigurar: boolean
    puedeEmitir: boolean
    onRefrescar: () => void
    /** Abre el trámite de ARCA (certificado, autorización, punto de venta) de ESE monotributo. */
    onConfigurar?: (taxpayerId: string) => void
}

export function PanelBarberos({
    datos,
    puedeConfigurar,
    puedeEmitir,
    onRefrescar,
    onConfigurar,
}: PanelBarberosProps) {
    const [orden, setOrden] = useState<Orden>('atencion')
    const [staffAbierto, setStaffAbierto] = useState<string | null>(null)
    const [altaAbierta, setAltaAbierta] = useState(false)
    const [altaStaffId, setAltaStaffId] = useState<string | null>(null)

    const filas = datos.filas

    const lecturas = useMemo(() => {
        const mapa = new Map<string, Lectura>()
        for (const f of filas) mapa.set(f.staffId, leer(f))
        return mapa
    }, [filas])

    const ordenadas = useMemo(() => {
        const copia = [...filas]
        copia.sort((a, b) => {
            const la = lecturas.get(a.staffId)!
            const lb = lecturas.get(b.staffId)!

            if (orden === 'nombre') return a.nombre.localeCompare(b.nombre, 'es')

            if (orden === 'facturado') {
                const ma = a.cupo?.montoEmitido ?? 0
                const mb = b.cupo?.montoEmitido ?? 0
                if (mb !== ma) return mb - ma
                return a.nombre.localeCompare(b.nombre, 'es')
            }

            const pa = peso(a, la)
            const pb = peso(b, lb)
            if (pa !== pb) return pa - pb
            const ta = la.pctAnual ?? -1
            const tb = lb.pctAnual ?? -1
            if (tb !== ta) return tb - ta
            return a.nombre.localeCompare(b.nombre, 'es')
        })
        return copia
    }, [filas, lecturas, orden])

    // -- El pulso del negocio ------------------------------------------------
    //
    // Los totales de "listos" y "facturado" salen de `datos.resumen`: los contó
    // el server sobre la consulta completa y no hay razón para recontarlos.
    //
    // Los que están en riesgo, en cambio, se arman ACÁ — con el mismo umbral —
    // porque el número de la tarjeta tiene que ser exactamente la cantidad de
    // nombres que se listan debajo. Un contador que dice 3 arriba de 2 nombres
    // se lee como pantalla rota.
    const enAlerta = useMemo(() => {
        const lista = filas.filter((f) => lecturas.get(f.staffId)!.enAlerta)
        lista.sort(
            (a, b) => (lecturas.get(b.staffId)!.pctAnual ?? 0) - (lecturas.get(a.staffId)!.pctAnual ?? 0),
        )
        return lista
    }, [filas, lecturas])

    const resumen = datos.resumen
    const filaAbierta = staffAbierto ? filas.find((f) => f.staffId === staffAbierto) ?? null : null
    const sinMonotributo = datos.barberosSinMonotributo

    // El ambiente del alta no se elige: se hereda del que ya usa la
    // organización. Dar de alta a un barbero en producción mientras el resto
    // está en pruebas (o al revés) parte la facturación en dos ambientes y no
    // hay ninguna pantalla que lo muestre.
    const ambientePorDefecto = filas.find((f) => f.ambiente)?.ambiente ?? 'produccion'

    const categorias = datos.categorias.length
        ? datos.categorias
        : CATEGORIAS_FALLBACK.map((c) => ({ categoria: c, topeAnual: 0, cuotaServicios: null }))

    function abrirAlta(staffId: string | null) {
        setAltaStaffId(staffId)
        setAltaAbierta(true)
    }

    // ------------------------------------------------------------------ error
    // Un fallo de lectura NO se dibuja como "no hay barberos". Son cosas
    // distintas y confundirlas, en una pantalla de plata y de fisco, hace que
    // alguien concluya que no hay nada que facturar.
    if (datos.error) {
        return (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
                    <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-red-700 dark:text-red-400">
                            No pudimos leer el panel de facturación
                        </h3>
                        <p className="mt-1 text-sm text-red-700/90 dark:text-red-300/90">{datos.error}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Esto no quiere decir que no haya nada facturado: quiere decir que no pudimos
                            leerlo. No tomes decisiones de cupo con esta pantalla hasta que cargue bien.
                        </p>
                        <Button variant="outline" size="sm" className="mt-4" onClick={onRefrescar}>
                            Reintentar
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-5">
            {/* ============================================== pulso del negocio */}
            <div className="grid gap-3 sm:grid-cols-3">
                <TarjetaPulso
                    icono={<CheckCircle2 className="size-4" />}
                    titulo="Listos para facturar"
                    valor={`${resumen.listos} de ${resumen.totalBarberos}`}
                    detalle={
                        resumen.listos === resumen.totalBarberos && resumen.totalBarberos > 0
                            ? 'Todos los monotributos configurados'
                            : `Faltan ${resumen.totalBarberos - resumen.listos} por terminar de configurar`
                    }
                />
                <TarjetaPulso
                    icono={<Wallet className="size-4" />}
                    titulo="Facturado este mes"
                    valor={money(resumen.facturadoMes)}
                    detalle={`${numero(resumen.comprobantesMes)} ${
                        resumen.comprobantesMes === 1 ? 'comprobante' : 'comprobantes'
                    } entre todos los monotributos`}
                />
                <TarjetaPulso
                    icono={<ShieldAlert className="size-4" />}
                    titulo="En riesgo de tope"
                    valor={String(enAlerta.length)}
                    detalle={
                        enAlerta.length === 0
                            ? 'Nadie cerca del tope de su categoría'
                            : 'Al límite o proyectando pasarse'
                    }
                    alerta={enAlerta.length > 0}
                />
            </div>

            {/* ==================================================== bloque ámbar */}
            {enAlerta.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                                {enAlerta.length === 1
                                    ? 'Hay un monotributo cerca de su tope anual'
                                    : `Hay ${enAlerta.length} monotributos cerca de su tope anual`}
                            </h3>
                            <ul className="mt-2 space-y-1">
                                {enAlerta.map((f) => {
                                    const l = lecturas.get(f.staffId)!
                                    return (
                                        <li key={f.staffId} className="text-sm text-amber-800/90 dark:text-amber-200/90">
                                            <button
                                                type="button"
                                                onClick={() => setStaffAbierto(f.staffId)}
                                                className="text-left font-medium underline-offset-2 hover:underline"
                                            >
                                                {f.nombre}
                                            </button>{' '}
                                            {l.excedido ? (
                                                <>
                                                    ya se pasó del tope de su categoría por{' '}
                                                    <strong>{money(l.excedente)}</strong>.
                                                </>
                                            ) : l.pctAnual !== null && l.pctAnual >= UMBRAL_RIESGO ? (
                                                <>
                                                    está al <strong>{l.pctAnual}%</strong> de su tope anual
                                                    {f.anual ? <> · le quedan {money(f.anual.restante)}</> : null}.
                                                </>
                                            ) : (
                                                <>
                                                    va camino a pasarse: a este ritmo cierra en{' '}
                                                    <strong>{money(f.anual?.proyectadoAnual ?? 0)}</strong>,{' '}
                                                    {money(l.excesoProyectado)} por encima del tope.
                                                </>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                            <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
                                Pasarse del tope obliga a recategorizar. Se arregla bajándole el cupo mensual
                                o subiéndolo de categoría — las dos cosas están en su ficha.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================= barra de la lista */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="size-4" />
                    <span>
                        {filas.length} {filas.length === 1 ? 'barbero' : 'barberos'} en el equipo
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
                        <SelectTrigger size="sm" className="w-[190px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="atencion">Primero los que urgen</SelectItem>
                            <SelectItem value="facturado">Facturado este mes</SelectItem>
                            <SelectItem value="nombre">Nombre</SelectItem>
                        </SelectContent>
                    </Select>

                    {puedeConfigurar && (
                        <Button size="sm" onClick={() => abrirAlta(sinMonotributo[0]?.id ?? null)}>
                            <UserPlus className="size-4" />
                            Dar de alta un monotributo
                        </Button>
                    )}
                </div>
            </div>

            {/* ========================================================== la lista */}
            {filas.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                    <p className="text-sm font-medium">Todavía no hay barberos para facturar</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Cargá el equipo en Barberos y después volvé acá para darle de alta el monotributo
                        a cada uno.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                    {ordenadas.map((f, i) => (
                        <FilaBarbero
                            key={f.staffId}
                            fila={f}
                            lectura={lecturas.get(f.staffId)!}
                            primera={i === 0}
                            puedeConfigurar={puedeConfigurar}
                            onAbrir={() => setStaffAbierto(f.staffId)}
                            onAlta={() => abrirAlta(f.staffId)}
                        />
                    ))}
                </div>
            )}

            {/* ============================================== ficha del barbero */}
            <Sheet
                open={!!filaAbierta}
                onOpenChange={(abierto) => {
                    if (!abierto) setStaffAbierto(null)
                }}
            >
                <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                    {filaAbierta && (
                        <FichaBarbero
                            // La `key` fuerza el remount al cambiar de barbero: sin
                            // ella, el formulario de cupo del anterior queda cargado
                            // sobre la ficha del siguiente y se guarda su número en
                            // el monotributo equivocado.
                            key={filaAbierta.taxpayerId ?? filaAbierta.staffId}
                            fila={filaAbierta}
                            lectura={lecturas.get(filaAbierta.staffId)!}
                            categorias={categorias}
                            puedeConfigurar={puedeConfigurar}
                            puedeEmitir={puedeEmitir}
                            onConfigurar={onConfigurar}
                            onRefrescar={onRefrescar}
                            onAlta={() => {
                                setStaffAbierto(null)
                                abrirAlta(filaAbierta.staffId)
                            }}
                        />
                    )}
                </SheetContent>
            </Sheet>

            {/* ================================================= alta de monotributo */}
            <DialogAlta
                abierto={altaAbierta}
                onAbierto={setAltaAbierta}
                candidatos={sinMonotributo}
                staffInicial={altaStaffId}
                categorias={categorias}
                ambiente={ambientePorDefecto}
                onRefrescar={onRefrescar}
            />
        </div>
    )
}

// -----------------------------------------------------------------------------
// Tarjeta del encabezado
// -----------------------------------------------------------------------------

function TarjetaPulso({
    icono,
    titulo,
    valor,
    detalle,
    alerta,
}: {
    icono: React.ReactNode
    titulo: string
    valor: string
    detalle: string
    alerta?: boolean
}) {
    return (
        <div
            className={cn(
                'rounded-xl border p-4',
                alerta ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card',
            )}
        >
            <div
                className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    alerta ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                )}
            >
                {icono}
                {titulo}
            </div>
            <p
                className={cn(
                    'mt-2 text-2xl font-semibold tracking-tight tabular-nums',
                    alerta && 'text-amber-700 dark:text-amber-400',
                )}
            >
                {valor}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{detalle}</p>
        </div>
    )
}

// -----------------------------------------------------------------------------
// Una fila de la lista
// -----------------------------------------------------------------------------

function FilaBarbero({
    fila,
    lectura,
    primera,
    puedeConfigurar,
    onAbrir,
    onAlta,
}: {
    fila: FilaPanel
    lectura: Lectura
    primera: boolean
    puedeConfigurar: boolean
    onAbrir: () => void
    onAlta: () => void
}) {
    const est = ESTADOS[fila.estado]
    const sinAlta = fila.estado === 'sin_monotributo' || !fila.taxpayerId

    const identidad = (
        <>
            <Avatar size="lg" className="shrink-0">
                {fila.avatarUrl ? <AvatarImage src={fila.avatarUrl} alt={fila.nombre} /> : null}
                <AvatarFallback>{iniciales(fila.nombre)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
                <p className="truncate font-medium">{fila.nombre}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {fila.sucursal || 'Sin sucursal'}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {fila.cuit ? formatearCuit(fila.cuit) : 'Sin CUIT'}
                    {fila.categoria ? ` · Cat. ${fila.categoria}` : ''}
                </p>
            </div>
        </>
    )

    return (
        <div
            className={cn(
                'flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center',
                !primera && 'border-t border-border',
                lectura.enAlerta ? 'bg-amber-500/[0.04]' : 'bg-card',
                'hover:bg-accent/40',
            )}
        >
            {/* -------------------------------------------------------- identidad */}
            {sinAlta ? (
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[260px]">{identidad}</div>
            ) : (
                <button
                    type="button"
                    onClick={onAbrir}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden sm:max-w-[260px]"
                >
                    {identidad}
                </button>
            )}

            {/* ----------------------------------------------------------- barras */}
            <div className="min-w-0 flex-1 space-y-3 sm:px-2">
                {sinAlta ? (
                    <p className="text-sm text-muted-foreground">
                        Todavía no tiene monotributo cargado. Sus cortes se cobran igual, pero no se
                        facturan.
                    </p>
                ) : (
                    <>
                        <BarraCupo fila={fila} lectura={lectura} />
                        <BarraTope fila={fila} lectura={lectura} />
                    </>
                )}
            </div>

            {/* --------------------------------------------------------- acciones */}
            <div className="flex shrink-0 items-center justify-between gap-3 sm:w-[196px] sm:justify-end">
                <div className="text-right">
                    <span
                        className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            est.clase,
                        )}
                    >
                        {est.etiqueta}
                    </span>
                    {fila.sinFacturar && fila.sinFacturar.cantidad > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            {fila.sinFacturar.cantidad} sin facturar · {money(fila.sinFacturar.monto)}
                        </p>
                    )}
                </div>

                {sinAlta ? (
                    puedeConfigurar ? (
                        <Button variant="outline" size="sm" onClick={onAlta}>
                            Dar de alta
                        </Button>
                    ) : null
                ) : (
                    <Button variant="ghost" size="icon" onClick={onAbrir} aria-label={`Abrir ${fila.nombre}`}>
                        <ChevronRight className="size-4" />
                    </Button>
                )}
            </div>
        </div>
    )
}

/** Barra del cupo: una META. Neutra a propósito — no tiene semáforo. */
function BarraCupo({ fila, lectura }: { fila: FilaPanel; lectura: Lectura }) {
    const m = fila.cupo
    const modo: ModoCupo = m?.modo ?? 'manual'

    const detalle = !m
        ? 'Sin cupo definido'
        : modo === 'cantidad'
            ? `${numero(m.emitidos)} de ${numero(m.objetivoCantidad ?? 0)} comprobantes`
            : modo === 'monto'
                ? `${money(m.montoEmitido)} de ${money(m.objetivoMonto ?? 0)}`
                : `${numero(m.emitidos)} emitidos · a mano`

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">
                    {etiquetaPeriodoCorta(m?.periodo)}
                </span>
                <span className="truncate tabular-nums text-muted-foreground">{detalle}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn(
                        'h-full rounded-full transition-all',
                        lectura.tieneCupo ? 'bg-primary' : 'bg-muted-foreground/25',
                    )}
                    style={{ width: ancho(lectura.tieneCupo ? lectura.pctCupo : 0) }}
                />
            </div>
        </div>
    )
}

/** Barra del tope: un LÍMITE. Semáforo, más gruesa, y con la proyección marcada. */
function BarraTope({ fila, lectura }: { fila: FilaPanel; lectura: Lectura }) {
    const a = fila.anual

    if (!a || a.topeAnual === null || a.topeAnual <= 0) {
        return (
            <div>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-muted-foreground">Tope anual</span>
                    <span className="text-muted-foreground">Sin categoría asignada</span>
                </div>
                <div className="mt-1 h-2.5 w-full rounded-full border border-dashed border-border" />
            </div>
        )
    }

    const proyPct =
        a.proyectadoAnual !== null && a.topeAnual > 0
            ? Math.round((a.proyectadoAnual / a.topeAnual) * 100)
            : null

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">
                    Tope anual{fila.categoria ? ` · Cat. ${fila.categoria}` : ''}
                </span>
                <span className={cn('tabular-nums font-medium', lectura.semaforo.texto)}>
                    {lectura.pctAnual !== null ? `${lectura.pctAnual}%` : '—'}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                        {lectura.excedido
                            ? `se pasó por ${money(lectura.excedente)}`
                            : `quedan ${money(a.restante)}`}
                    </span>
                </span>
            </div>

            <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn('h-full rounded-full transition-all', lectura.semaforo.barra)}
                    style={{ width: ancho(lectura.pctAnual) }}
                />
                {/* Marca de a dónde llega si sigue a este ritmo. */}
                {proyPct !== null && proyPct > 0 && proyPct < 100 && (
                    <span
                        aria-hidden
                        title={`A este ritmo cierra en ${money(a.proyectadoAnual ?? 0)}`}
                        className="absolute top-0 h-full w-0.5 bg-foreground/40"
                        style={{ left: `${proyPct}%` }}
                    />
                )}
            </div>

            {lectura.proyectaExceso && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    A este ritmo cierra en {money(a.proyectadoAnual ?? 0)}: se pasa por{' '}
                    {money(lectura.excesoProyectado)}.
                </p>
            )}
        </div>
    )
}

// -----------------------------------------------------------------------------
// Ficha del barbero (hoja lateral)
// -----------------------------------------------------------------------------

interface CategoriaVista {
    categoria: string
    topeAnual: number
    cuotaServicios: number | null
}

function FichaBarbero({
    fila,
    lectura,
    categorias,
    puedeConfigurar,
    puedeEmitir,
    onRefrescar,
    onAlta,
    onConfigurar,
}: {
    fila: FilaPanel
    lectura: Lectura
    categorias: CategoriaVista[]
    puedeConfigurar: boolean
    puedeEmitir: boolean
    onRefrescar: () => void
    onAlta: () => void
    onConfigurar?: (taxpayerId: string) => void
}) {
    const [pendiente, iniciar] = useTransition()
    const [confirmando, setConfirmando] = useState(false)

    // -- cupo ---------------------------------------------------------------
    const m = fila.cupo
    // Un cupo NUEVO nace prendido. Arrancando apagado, el dueño configuraba
    // todo, guardaba, y quedaba inerte sin que nada se lo dijera — pasó con 3
    // de los primeros 4 que se cargaron. Prenderlo no emite nada por sí solo:
    // la emisión sigue necesitando el botón o la corrida automática.
    const [habilitada, setHabilitada] = useState<boolean>(m?.habilitada ?? true)
    const [modo, setModo] = useState<ModoCupo>(m?.modo ?? 'cantidad')
    const [origen, setOrigen] = useState<OrigenVentas>(m?.origen ?? 'propios')
    const [periodo, setPeriodo] = useState<PeriodoCupo>(m?.periodo ?? 'mes')
    const [objCantidad, setObjCantidad] = useState<number | null>(m?.objetivoCantidad ?? null)
    const [objMonto, setObjMonto] = useState<number | null>(m?.objetivoMonto ?? null)

    // -- categoría ----------------------------------------------------------
    const [categoria, setCategoria] = useState<string>(fila.categoria ?? '')

    const est = ESTADOS[fila.estado]
    const taxpayerId = fila.taxpayerId
    const topeElegido = categorias.find((c) => c.categoria === categoria)?.topeAnual ?? null

    async function guardarCupo() {
        if (!taxpayerId) return
        if (modo === 'cantidad' && (!objCantidad || objCantidad <= 0)) {
            toast.error('Poné cuántos comprobantes le facturamos por período.')
            return
        }
        if (modo === 'monto' && (!objMonto || objMonto <= 0)) {
            toast.error('Poné hasta qué monto le facturamos por período.')
            return
        }
        iniciar(async () => {
            try {
                const r = await guardarCupoBarbero({
                    taxpayerId,
                    habilitada,
                    modo,
                    periodo,
                    objetivoCantidad: modo === 'cantidad' ? objCantidad : null,
                    objetivoMonto: modo === 'monto' ? objMonto : null,
                    origen,
                    // Nada más: la action hace MERGE. Lo que no se manda queda
                    // como estaba — mandar defaults acá era lo que apagaba la
                    // emisión automática sin que nadie lo pidiera.
                })
                if ('error' in r) {
                    toast.error(r.error)
                    return
                }
                toast.success(`Cupo de ${fila.nombre} guardado.`)
                onRefrescar()
            } catch {
                // Una server action RECHAZA ante corte de red. Sin este catch el
                // botón queda en "Guardando…" para siempre y el dueño no sabe si
                // el cambio entró o no.
                toast.error('No pudimos guardar el cupo. Revisá la conexión y probá de nuevo.')
            }
        })
    }

    async function guardarCategoria() {
        if (!taxpayerId) return
        iniciar(async () => {
            try {
                // Va por `actualizarCategoria` y NO por `vincularBarbero`:
                // vincular hace un INSERT y contra un barbero que ya tiene
                // monotributo choca con el índice único (23505).
                const r = await actualizarCategoria(taxpayerId, categoria || null)
                if ('error' in r) {
                    toast.error(r.error)
                    return
                }
                toast.success(`${fila.nombre} quedó en categoría ${categoria}.`)
                onRefrescar()
            } catch {
                toast.error('No pudimos guardar la categoría. Revisá la conexión.')
            }
        })
    }

    async function facturar() {
        if (!taxpayerId) return
        setConfirmando(false)
        iniciar(async () => {
            try {
                const r = await facturarPendientesDe(taxpayerId)
                if ('error' in r) {
                    toast.error(r.error)
                    return
                }

                const emitidos = r.emitidos.length
                const fallidos = r.fallidos.length

                if (emitidos === 0 && fallidos === 0) {
                    toast.info('No entró ningún comprobante: el cupo del período ya está completo.')
                } else if (fallidos > 0) {
                    // Un lote a medias NO es un éxito. Si se dice "listo" y tres
                    // cortes quedaron sin facturar, nadie los vuelve a mirar.
                    toast.warning(
                        `${emitidos} ${emitidos === 1 ? 'comprobante emitido' : 'comprobantes emitidos'}, ` +
                            `${fallidos} ${fallidos === 1 ? 'falló' : 'fallaron'}. Revisá el detalle en Comprobantes.`,
                    )
                } else if (r.restantes && r.restantes > 0) {
                    // Una tanda se corta en 35 para no chocar contra el límite de
                    // tiempo de la función. Decirlo es obligatorio: si no, el
                    // dueño ve "emitidos" y cree que el cupo quedó completo.
                    toast.success(
                        `${emitidos} ${emitidos === 1 ? 'comprobante emitido' : 'comprobantes emitidos'} a nombre de ${fila.nombre}. ` +
                            `Quedan ${r.restantes} para llegar al cupo: volvé a tocar "Facturar" o esperá la corrida automática.`,
                        { duration: 8000 },
                    )
                } else {
                    toast.success(
                        `${emitidos} ${emitidos === 1 ? 'comprobante emitido' : 'comprobantes emitidos'} a nombre de ${fila.nombre}.`,
                    )
                }
                onRefrescar()
            } catch {
                toast.error(
                    'Se cortó la conexión mientras emitíamos. Actualizá antes de reintentar: ' +
                        'puede que algunos comprobantes hayan salido.',
                )
            }
        })
    }

    const sinFacturar = fila.sinFacturar

    /**
     * Qué va a pasar si se aprieta "Facturar según su cupo".
     *
     * Se calcula sobre la política GUARDADA (`m`), no sobre el formulario: el
     * botón ejecuta lo guardado, y proyectar lo que se está editando sería
     * prometer un número distinto del que va a salir. Si difieren, se avisa.
     *
     * En modo monto la cantidad es una ESTIMACIÓN (monto restante dividido el
     * ticket promedio de lo disponible): la selección real depende de qué
     * cortes entren, y por eso se muestra como "aprox.".
     */
    const proyeccion = (() => {
        const disp = sinFacturar.cantidad
        const dispMonto = sinFacturar.monto
        if (!m || m.modo === 'manual' || disp === 0) {
            return { modo: m?.modo ?? 'manual', cantidad: 0, monto: 0, exacto: true }
        }
        if (m.modo === 'cantidad') {
            const faltan = Math.max((m.objetivoCantidad ?? 0) - m.emitidos, 0)
            const cantidad = Math.min(faltan, disp)
            const promedio = disp > 0 ? dispMonto / disp : 0
            return { modo: 'cantidad' as const, cantidad, monto: Math.round(cantidad * promedio), exacto: false }
        }
        const restante = Math.max((m.objetivoMonto ?? 0) - m.montoEmitido, 0)
        const monto = Math.min(restante, dispMonto)
        const promedio = disp > 0 ? dispMonto / disp : 0
        return {
            modo: 'monto' as const,
            cantidad: promedio > 0 ? Math.floor(monto / promedio) : 0,
            monto,
            exacto: false,
        }
    })()

    /**
     * ¿El objetivo que se está tipeando tiene sentido contra su tope anual?
     *
     * El riesgo real no es el sistema desbocado —el cupo es un límite duro— sino
     * un cero de más al escribir. $50.000.000 por mes en alguien cuya categoría
     * permite $45.151.659 AL AÑO es un error de tipeo, y conviene marcarlo antes
     * de guardar y no descubrirlo con los comprobantes emitidos.
     */
    const alerta = (() => {
        const tope = fila.anual?.topeAnual ?? null
        if (!tope || modo === 'manual') return null
        const vecesPorAnio = periodo === 'mes' ? 12 : periodo === 'semana' ? 52 : 365

        let anualizado = 0
        if (modo === 'monto') {
            if (!objMonto) return null
            anualizado = objMonto * vecesPorAnio
        } else {
            if (!objCantidad) return null
            const prom = sinFacturar.cantidad > 0 ? sinFacturar.monto / sinFacturar.cantidad : 0
            if (prom <= 0) return null
            anualizado = objCantidad * prom * vecesPorAnio
        }
        if (anualizado <= tope) return null
        return { anualizado, tope, exceso: anualizado - tope }
    })()

    /** El formulario difiere de lo guardado: la proyección de abajo no es lo que se ve arriba. */
    const hayCambiosSinGuardar = m
        ? habilitada !== m.habilitada ||
          modo !== m.modo ||
          periodo !== m.periodo ||
          origen !== m.origen ||
          (modo === 'cantidad'
              ? objCantidad !== m.objetivoCantidad
              : modo === 'monto'
                  ? objMonto !== m.objetivoMonto
                  : false)
        : false
    const a = fila.anual

    return (
        <>
            <SheetHeader className="border-b border-border">
                <div className="flex items-center gap-3">
                    <Avatar size="lg">
                        {fila.avatarUrl ? <AvatarImage src={fila.avatarUrl} alt={fila.nombre} /> : null}
                        <AvatarFallback>{iniciales(fila.nombre)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <SheetTitle className="truncate">{fila.nombre}</SheetTitle>
                        <SheetDescription className="truncate">
                            {fila.sucursal || 'Sin sucursal'}
                            {fila.cuit ? ` · ${formatearCuit(fila.cuit)}` : ''}
                        </SheetDescription>
                    </div>
                </div>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
                {/* ------------------------------------------------------- estado */}
                <div
                    className={cn(
                        'rounded-lg border p-3 text-sm',
                        fila.estado === 'listo'
                            ? 'border-emerald-500/30 bg-emerald-500/10'
                            : fila.estado === 'error'
                                ? 'border-red-500/30 bg-red-500/10'
                                : 'border-border bg-muted/50',
                    )}
                >
                    <div className="flex items-start gap-2">
                        {fila.estado === 'listo' ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : fila.estado === 'error' ? (
                            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                        ) : (
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="font-medium">{est.etiqueta}</p>
                            <p className="mt-0.5 text-muted-foreground">{fila.detalleEstado}</p>
                            {fila.estado === 'sin_monotributo' && puedeConfigurar && (
                                <Button variant="outline" size="sm" className="mt-3" onClick={onAlta}>
                                    Dar de alta
                                </Button>
                            )}
                            {/* El trámite del certificado es por persona: desde acá
                                se abre el suyo, ya seleccionado, sin tener que
                                buscarlo en otra pantalla. */}
                            {fila.taxpayerId && fila.estado !== 'listo' && puedeConfigurar && onConfigurar && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => onConfigurar(fila.taxpayerId!)}
                                >
                                    <Settings2 className="size-3.5" />
                                    Seguir configurando en ARCA
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* -------------------------------------------------- tope anual */}
                <section>
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <TrendingUp className="size-4 text-muted-foreground" />
                        Tope anual del monotributo
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Se mide sobre los últimos 12 meses móviles, que es como mide ARCA para
                        recategorizar.
                        {a?.desde && a?.hasta ? ` Ventana: ${a.desde} a ${a.hasta}.` : ''}
                    </p>

                    {a && a.topeAnual !== null && a.topeAnual > 0 ? (
                        <div className={cn('mt-3 rounded-lg border p-3', lectura.semaforo.borde, lectura.semaforo.fondo)}>
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <p className={cn('text-2xl font-semibold tabular-nums', lectura.semaforo.texto)}>
                                        {lectura.pctAnual !== null ? `${lectura.pctAnual}%` : '—'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">del tope de su categoría</p>
                                </div>
                                <div className="text-right text-xs">
                                    <p className="tabular-nums font-medium">{money(a.facturado12m)}</p>
                                    <p className="text-muted-foreground">de {money(a.topeAnual)}</p>
                                </div>
                            </div>

                            <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-background/60">
                                <div
                                    className={cn('h-full rounded-full', lectura.semaforo.barra)}
                                    style={{ width: ancho(lectura.pctAnual) }}
                                />
                            </div>

                            <p className="mt-2 text-xs">
                                {lectura.excedido ? (
                                    <span className="font-medium text-red-600 dark:text-red-400">
                                        Ya se pasó por {money(lectura.excedente)}. Hay que recategorizarlo.
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">
                                        Le quedan <strong className="text-foreground">{money(a.restante)}</strong>{' '}
                                        antes de tener que recategorizar.
                                    </span>
                                )}
                            </p>

                            <p
                                className={cn(
                                    'mt-1 text-xs',
                                    lectura.proyectaExceso
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-muted-foreground',
                                )}
                            >
                                A este ritmo cierra el año en {money(a.proyectadoAnual)}
                                {lectura.proyectaExceso
                                    ? `: se pasa por ${money(lectura.excesoProyectado)}.`
                                    : ', dentro del tope.'}
                            </p>

                            <p className="mt-1 text-xs text-muted-foreground">
                                {numero(a.comprobantes12m)}{' '}
                                {a.comprobantes12m === 1 ? 'comprobante' : 'comprobantes'} en la ventana.
                            </p>
                        </div>
                    ) : (
                        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                            Sin categoría asignada no podemos medir el tope. Elegila abajo.
                        </p>
                    )}
                </section>

                <Separator />

                {/* --------------------------------------------------- categoría */}
                <section>
                    <h3 className="text-sm font-semibold">Categoría de monotributo</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Define el tope contra el que se mide todo lo de arriba.
                    </p>

                    <div className="mt-3 flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <Label htmlFor="cat-barbero">Categoría</Label>
                            <Select
                                value={categoria}
                                onValueChange={setCategoria}
                                disabled={!puedeConfigurar || pendiente || !taxpayerId}
                            >
                                <SelectTrigger id="cat-barbero" className="mt-1.5 w-full">
                                    <SelectValue placeholder="Elegí una categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categorias.map((c) => (
                                        <SelectItem key={c.categoria} value={c.categoria}>
                                            {c.categoria}
                                            {c.topeAnual > 0 ? ` — hasta ${money(c.topeAnual)}` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            variant="outline"
                            onClick={guardarCategoria}
                            disabled={
                                !puedeConfigurar ||
                                pendiente ||
                                !taxpayerId ||
                                !categoria ||
                                categoria === (fila.categoria ?? '')
                            }
                        >
                            {pendiente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            Guardar
                        </Button>
                    </div>

                    {topeElegido !== null && topeElegido > 0 && categoria !== (fila.categoria ?? '') && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            Con la categoría {categoria} el tope pasa a ser {money(topeElegido)}
                            {a ? ` · lleva facturado ${money(a.facturado12m)}` : ''}.
                        </p>
                    )}
                </section>

                <Separator />

                {/* -------------------------------------------------------- cupo */}
                <section>
                    <h3 className="text-sm font-semibold">Cuánto le facturamos</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        De todo lo que trabaja, esto es lo que se emite a su nombre. Es la palanca: el tope
                        de arriba es la consecuencia.
                    </p>

                    {/* De dónde salen los cortes. Va ANTES del cupo porque
                        cambia el universo sobre el que el cupo corta: sin esto,
                        quien no atiende no puede facturar nada. */}
                    <div className="mt-3 rounded-lg border border-border p-3">
                        <p className="text-sm font-medium">¿De dónde salen los cortes?</p>
                        <div className="mt-2 grid gap-2">
                            {([
                                { v: 'propios' as const, t: 'Los que atiende él', d: 'Sólo sus propios cortes.' },
                                { v: 'sucursal' as const, t: 'Los de su sucursal', d: 'Cualquier corte del local donde trabaja.' },
                                { v: 'organizacion' as const, t: 'Los de todo el negocio', d: 'Cualquier corte, de cualquier sucursal.' },
                            ]).map((o) => (
                                <button
                                    key={o.v}
                                    type="button"
                                    disabled={!puedeConfigurar || pendiente || !taxpayerId}
                                    onClick={() => setOrigen(o.v)}
                                    className={cn(
                                        'rounded-lg border p-2.5 text-left transition',
                                        origen === o.v
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-border hover:bg-muted/40',
                                        'disabled:cursor-not-allowed disabled:opacity-60',
                                    )}
                                >
                                    <span className="block text-sm font-medium">{o.t}</span>
                                    <span className="block text-xs text-muted-foreground">{o.d}</span>
                                </button>
                            ))}
                        </div>
                        {origen !== 'propios' && (
                            <p className="mt-2 text-xs text-muted-foreground">
                                Toma de lo que queda sin facturar después de que cada barbero cubrió su
                                propio cupo. Es lo que le permite facturar a quien no atiende.
                            </p>
                        )}
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="min-w-0 pr-3">
                            <p className="text-sm font-medium">Cupo activo</p>
                            <p className="text-xs text-muted-foreground">
                                Apagado, sus cortes quedan sin facturar hasta que lo prendas.
                            </p>
                        </div>
                        <Switch
                            checked={habilitada}
                            onCheckedChange={setHabilitada}
                            disabled={!puedeConfigurar || pendiente || !taxpayerId}
                        />
                    </div>

                    {/* Una frase, no dos selects sueltos. "Cómo se mide" +
                        "Cada cuánto" obligaba a armar la regla en la cabeza. */}
                    <div className="mt-3 rounded-lg border border-border p-3">
                        <p className="text-sm font-medium">Facturarle…</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            {([
                                { v: 'monto' as const, t: 'Un monto', d: 'Ponés $ y el sistema elige los cortes.' },
                                { v: 'cantidad' as const, t: 'Una cantidad', d: 'Ponés cuántos cortes.' },
                                { v: 'manual' as const, t: 'Nada automático', d: 'No se emite solo.' },
                            ]).map((o) => (
                                <button
                                    key={o.v}
                                    type="button"
                                    disabled={!puedeConfigurar || pendiente || !taxpayerId}
                                    onClick={() => setModo(o.v)}
                                    className={cn(
                                        'rounded-lg border p-2.5 text-left transition',
                                        modo === o.v
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-border hover:bg-muted/40',
                                        'disabled:cursor-not-allowed disabled:opacity-60',
                                    )}
                                >
                                    <span className="block text-sm font-medium">{o.t}</span>
                                    <span className="block text-xs text-muted-foreground">{o.d}</span>
                                </button>
                            ))}
                        </div>

                        {modo !== 'manual' && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-sm text-muted-foreground">cada</span>
                                {([
                                    { v: 'mes' as const, t: 'mes' },
                                    { v: 'semana' as const, t: 'semana' },
                                    { v: 'dia' as const, t: 'día' },
                                ]).map((o) => (
                                    <button
                                        key={o.v}
                                        type="button"
                                        disabled={!puedeConfigurar || pendiente || !taxpayerId}
                                        onClick={() => setPeriodo(o.v)}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-sm transition',
                                            periodo === o.v
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:border-foreground/25',
                                            'disabled:cursor-not-allowed disabled:opacity-60',
                                        )}
                                    >
                                        {o.t}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {modo === 'cantidad' && (
                        <div className="mt-3">
                            <Label htmlFor="obj-cantidad">Cortes a facturar {ETIQUETA_PERIODO[periodo]}</Label>
                            <div className="relative mt-1.5">
                                <Hash className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id="obj-cantidad"
                                    value={objCantidad ?? ''}
                                    onChange={(e) => setObjCantidad(soloNumero(e.target.value))}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder="40"
                                    disabled={!puedeConfigurar || pendiente || !taxpayerId}
                                    className="pl-9 tabular-nums"
                                />
                            </div>
                        </div>
                    )}

                    {modo === 'monto' && (
                        <div className="mt-3">
                            <Label htmlFor="obj-monto">Monto a facturar {ETIQUETA_PERIODO[periodo]}</Label>
                            <div className="relative mt-1.5">
                                <Wallet className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id="obj-monto"
                                    value={objMonto === null ? '' : numero(objMonto)}
                                    onChange={(e) => setObjMonto(soloNumero(e.target.value))}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder="1.500.000"
                                    disabled={!puedeConfigurar || pendiente || !taxpayerId}
                                    className="pl-9 tabular-nums"
                                />
                            </div>
                        </div>
                    )}

                    {modo === 'manual' && (
                        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                            En modo manual no se emite nada solo: cada comprobante se elige y se emite desde
                            esta pantalla.
                        </p>
                    )}

                    {m && (
                        <div className="mt-3 rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <CalendarRange className="size-3.5" />
                                    {etiquetaPeriodoCorta(m.periodo)}
                                </span>
                                <span className="tabular-nums">
                                    {numero(m.emitidos)} emitidos · {money(m.montoEmitido)}
                                </span>
                            </div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: ancho(lectura.tieneCupo ? lectura.pctCupo : 0) }}
                                />
                            </div>
                        </div>
                    )}

                    {puedeConfigurar && (
                        <>
                            <Button className="mt-3 w-full" onClick={guardarCupo} disabled={pendiente || !taxpayerId}>
                                {pendiente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                                Guardar cupo
                            </Button>
                            {alerta && (
                                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                                    <p className="font-semibold">Revisá el número antes de guardar</p>
                                    <p className="mt-1">
                                        A este ritmo son{' '}
                                        <span className="tabular-nums">{money(alerta.anualizado)}</span> al año, y su
                                        categoría {fila.categoria ? `(${fila.categoria}) ` : ''}permite hasta{' '}
                                        <span className="tabular-nums">{money(alerta.tope)}</span>. Se pasaría por{' '}
                                        <span className="tabular-nums">{money(alerta.exceso)}</span>.
                                    </p>
                                </div>
                            )}
                            {hayCambiosSinGuardar && (
                                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                                    Tenés cambios sin guardar. Lo de abajo muestra lo que pasaría con la
                                    configuración guardada, no con la que estás editando.
                                </p>
                            )}
                        </>
                    )}
                </section>

                <Separator />

                {/* ------------------------------------------------ sin facturar */}
                <section>
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Receipt className="size-4 text-muted-foreground" />
                        Qué se le va a facturar
                    </h3>

                    {sinFacturar.cantidad === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                            No quedan cortes pendientes de facturar.
                        </p>
                    ) : proyeccion.modo === 'manual' ? (
                        <div className="mt-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
                            El cupo está en modo a mano: no se factura nada solo. Elegí por cantidad o por
                            monto para que el sistema seleccione.
                        </div>
                    ) : (
                        <div className="mt-2 rounded-lg border border-border p-3">
                            {/* El número grande es lo que VA A PASAR, no el pozo
                                disponible. Antes el titular era "938 ventas" con
                                un cupo de 28: se leía como que iba a emitir 938. */}
                            <p className="text-2xl font-semibold tabular-nums">
                                {numero(proyeccion.cantidad)}{' '}
                                <span className="text-base font-normal text-muted-foreground">
                                    {proyeccion.cantidad === 1 ? 'comprobante' : 'comprobantes'}
                                </span>
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                {proyeccion.exacto ? '' : 'aprox. '}
                                <span className="tabular-nums text-foreground">{money(proyeccion.monto)}</span>
                                {' · '}sale de {numero(sinFacturar.cantidad)} ventas disponibles por{' '}
                                <span className="tabular-nums">{money(sinFacturar.monto)}</span>
                            </p>

                            {/* Barra: qué porción del pozo se lleva este cupo. */}
                            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-primary"
                                    style={{
                                        width: `${Math.min(
                                            100,
                                            sinFacturar.cantidad > 0
                                                ? (proyeccion.cantidad / sinFacturar.cantidad) * 100
                                                : 0,
                                        )}%`,
                                    }}
                                />
                            </div>

                            <p className="mt-2 text-xs text-muted-foreground">
                                {proyeccion.cantidad === 0
                                    ? 'El cupo del período ya está cubierto: no entra ninguno más.'
                                    : `Quedan ${numero(sinFacturar.cantidad - proyeccion.cantidad)} sin facturar en este período.`}
                            </p>
                        </div>
                    )}

                    {puedeEmitir && (
                        <Button
                            className="mt-3 w-full"
                            variant="outline"
                            onClick={() => setConfirmando(true)}
                            // Se deshabilita por la PROYECCIÓN, no por el pozo: con
                            // el cupo ya cubierto hay ventas disponibles pero no
                            // entra ninguna, y un botón que se aprieta y no hace
                            // nada se lee como que el sistema está roto.
                            disabled={pendiente || !taxpayerId || proyeccion.cantidad === 0 || !lectura.operativo}
                        >
                            {pendiente ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
                            {proyeccion.cantidad > 0
                                ? `Facturar ${numero(proyeccion.cantidad)} ${proyeccion.cantidad === 1 ? 'corte' : 'cortes'} ahora`
                                : 'Facturar según su cupo'}
                        </Button>
                    )}

                    {puedeEmitir && !lectura.operativo && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            Para emitir hay que terminar de configurarlo: {fila.detalleEstado}
                        </p>
                    )}
                </section>
            </div>

            {/* ------------------------------------------------- confirmación */}
            <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            ¿Emitimos los comprobantes de {fila.nombre}?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>
                                    Se van a emitir comprobantes fiscales <strong>reales</strong> a nombre de{' '}
                                    {fila.razonSocial ?? fila.nombre}
                                    {fila.cuit ? ` (CUIT ${formatearCuit(fila.cuit)})` : ''}, tomando de las{' '}
                                    {numero(sinFacturar.cantidad)} ventas pendientes las que entren en su cupo
                                    del período.
                                </p>
                                <p>
                                    Una vez emitidos <strong>no se borran</strong>: sólo se anulan con una nota
                                    de crédito, que también es un comprobante fiscal.
                                </p>
                                {lectura.enAlerta && (
                                    <p className="text-amber-700 dark:text-amber-400">
                                        Ojo: ya está{' '}
                                        {lectura.pctAnual !== null ? `al ${lectura.pctAnual}% ` : 'cerca '}
                                        de su tope anual. Lo que emitas ahora suma a los 12 meses móviles.
                                    </p>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={facturar}>Emitir comprobantes</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

// -----------------------------------------------------------------------------
// Alta de un monotributo
// -----------------------------------------------------------------------------

interface CandidatoAlta {
    id: string
    nombre: string
    sucursal: string
}

function DialogAlta({
    abierto,
    onAbierto,
    candidatos,
    staffInicial,
    categorias,
    ambiente,
    onRefrescar,
}: {
    abierto: boolean
    onAbierto: (v: boolean) => void
    candidatos: CandidatoAlta[]
    staffInicial: string | null
    categorias: CategoriaVista[]
    ambiente: 'homologacion' | 'produccion'
    onRefrescar: () => void
}) {
    return (
        <Dialog open={abierto} onOpenChange={onAbierto}>
            <DialogContent className="sm:max-w-md">
                {/* Remount por apertura: sin la `key`, el CUIT a medio tipear de la
                    vez anterior reaparece sobre el barbero nuevo. */}
                <FormularioAlta
                    key={abierto ? `${staffInicial ?? 'nadie'}-abierto` : 'cerrado'}
                    candidatos={candidatos}
                    staffInicial={staffInicial}
                    categorias={categorias}
                    ambiente={ambiente}
                    onListo={() => {
                        onAbierto(false)
                        onRefrescar()
                    }}
                    onCancelar={() => onAbierto(false)}
                />
            </DialogContent>
        </Dialog>
    )
}

function FormularioAlta({
    candidatos,
    staffInicial,
    categorias,
    ambiente,
    onListo,
    onCancelar,
}: {
    candidatos: CandidatoAlta[]
    staffInicial: string | null
    categorias: CategoriaVista[]
    ambiente: 'homologacion' | 'produccion'
    onListo: () => void
    onCancelar: () => void
}) {
    const [pendiente, iniciar] = useTransition()
    const [staffId, setStaffId] = useState<string>(
        staffInicial && candidatos.some((c) => c.id === staffInicial)
            ? staffInicial
            : candidatos[0]?.id ?? '',
    )
    const [cuit, setCuit] = useState('')
    const [razonSocial, setRazonSocial] = useState('')
    const [categoria, setCategoria] = useState('')

    const elegido = candidatos.find((c) => c.id === staffId) ?? null
    const cuitOk = cuitValido(cuit)

    const ayudaCuit = !cuit
        ? 'Once dígitos, sin guiones. Lo verificamos mientras lo tipeás.'
        : cuit.length < 11
            ? `Faltan ${11 - cuit.length} ${11 - cuit.length === 1 ? 'dígito' : 'dígitos'}.`
            : cuitOk
                ? 'El CUIT verifica bien.'
                : 'Ese CUIT no cierra: el último dígito no corresponde. Revisá que esté bien tipeado.'

    const puedeGuardar =
        !!staffId && cuitOk && razonSocial.trim().length >= 2 && !!categoria && !pendiente

    async function guardar() {
        if (!puedeGuardar) return
        iniciar(async () => {
            try {
                const r = await vincularBarbero({
                    staffId,
                    cuit,
                    razonSocial: razonSocial.trim(),
                    // Este panel es el de los MONOTRIBUTOS: la condición no se
                    // pregunta porque no hay otra opción posible acá.
                    condicionIva: 'monotributo',
                    categoria,
                    ambiente,
                })
                if ('error' in r) {
                    toast.error(r.error)
                    return
                }
                toast.success(
                    `${elegido?.nombre ?? 'El barbero'} quedó dado de alta. Falta el certificado para poder emitir.`,
                )
                onListo()
            } catch {
                toast.error('No pudimos dar de alta el monotributo. Revisá la conexión y probá de nuevo.')
            }
        })
    }

    if (candidatos.length === 0) {
        return (
            <>
                <DialogHeader>
                    <DialogTitle>Todos tienen monotributo</DialogTitle>
                    <DialogDescription>
                        No queda ningún barbero del equipo sin monotributo cargado. Para cambiar los datos de
                        alguno, abrí su ficha desde la lista.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancelar}>
                        Cerrar
                    </Button>
                </DialogFooter>
            </>
        )
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>Dar de alta un monotributo</DialogTitle>
                <DialogDescription>
                    Con esto el barbero queda vinculado a su CUIT. Para poder emitir todavía va a faltar el
                    certificado y el punto de venta.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
                <div>
                    <Label htmlFor="alta-barbero">Barbero</Label>
                    <Select value={staffId} onValueChange={setStaffId} disabled={pendiente}>
                        <SelectTrigger id="alta-barbero" className="mt-1.5 w-full">
                            <SelectValue placeholder="Elegí un barbero" />
                        </SelectTrigger>
                        <SelectContent>
                            {candidatos.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                    {c.nombre}
                                    {c.sucursal ? ` — ${c.sucursal}` : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div>
                    <Label htmlFor="alta-cuit">CUIT</Label>
                    <div className="relative mt-1.5">
                        <Input
                            id="alta-cuit"
                            value={formatearCuit(cuit)}
                            onChange={(e) => setCuit(soloDigitos(e.target.value))}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="20-12345678-3"
                            disabled={pendiente}
                            className={cn(
                                'pr-10 font-mono tracking-wide',
                                cuit.length === 11 && !cuitOk && 'border-red-500/60',
                                cuitOk && 'border-emerald-500/60',
                            )}
                        />
                        {cuit.length > 0 && (
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                                {cuitOk ? (
                                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                    <XCircle className="size-4 text-red-600 dark:text-red-400" />
                                )}
                            </span>
                        )}
                    </div>
                    <p
                        className={cn(
                            'mt-1.5 text-xs',
                            cuit.length === 11 && !cuitOk
                                ? 'text-red-600 dark:text-red-400'
                                : cuitOk
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-muted-foreground',
                        )}
                    >
                        {ayudaCuit}
                    </p>
                </div>

                <div>
                    <Label htmlFor="alta-razon">Razón social</Label>
                    <Input
                        id="alta-razon"
                        value={razonSocial}
                        onChange={(e) => setRazonSocial(e.target.value)}
                        autoComplete="off"
                        placeholder={elegido?.nombre ?? 'Apellido Nombre'}
                        disabled={pendiente}
                        className="mt-1.5"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        Tal cual figura en ARCA. Suele ser apellido y nombre.
                    </p>
                </div>

                <div>
                    <Label htmlFor="alta-categoria">Categoría</Label>
                    <Select value={categoria} onValueChange={setCategoria} disabled={pendiente}>
                        <SelectTrigger id="alta-categoria" className="mt-1.5 w-full">
                            <SelectValue placeholder="Elegí una categoría" />
                        </SelectTrigger>
                        <SelectContent>
                            {categorias.map((c) => (
                                <SelectItem key={c.categoria} value={c.categoria}>
                                    {c.categoria}
                                    {c.topeAnual > 0 ? ` — hasta ${money(c.topeAnual)} al año` : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        Es la que define el tope contra el que vamos a medirle la facturación.
                    </p>
                </div>

                {/* El ambiente no se elige, pero tampoco se esconde: un alta que
                    cae en el ambiente equivocado factura contra la nada. */}
                <p className="rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground">
                    {ambiente === 'produccion'
                        ? 'Se da de alta en producción, igual que el resto del equipo: sus comprobantes van a tener validez fiscal.'
                        : 'Se da de alta en el ambiente de pruebas, igual que el resto del equipo: sus comprobantes no van a tener validez fiscal.'}
                </p>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onCancelar} disabled={pendiente}>
                    Cancelar
                </Button>
                <Button onClick={guardar} disabled={!puedeGuardar}>
                    {pendiente ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    Dar de alta
                </Button>
            </DialogFooter>
        </>
    )
}

// Los chips de estado van con clases propias y no con el primitivo `Badge`: el
// semáforo necesita cinco tonos y `Badge` tiene cuatro variantes fijas, ninguna
// ámbar. Forzarlo con `className` sobre `variant="outline"` terminaba peleando
// con los estilos del primitivo en dark mode.
export type { PanelBarberosProps }
