'use client'

// =============================================================================
// src/components/facturacion/editor-cupo.tsx
//
// El editor del CUPO: cuánto de lo que se vende se factura.
//
// Dos decisiones de diseño que sostienen todo lo demás:
//
// 1. La configuración se lee como una ORACIÓN, no como un formulario.
//    "Facturar [50] comprobantes [por mes], eligiendo [los de menor importe],
//    de cobros en [efectivo, transferencia]". Un formulario con nueve campos
//    obliga a reconstruir mentalmente qué va a pasar; la oración se entiende
//    de una lectura, que es exactamente lo que hay que entender antes de
//    apretar un botón que emite comprobantes fiscales.
//
// 2. Hay VISTA PREVIA EN VIVO, y muestra los cortes con nombre y apellido.
//    Mover "50" a "80" y ver aparecer los 30 cortes que se agregarían es la
//    diferencia entre configurar a ciegas y decidir. La previa corre contra la
//    MISMA función que ejecuta el cron (`planificarFacturacion`), así que lo
//    que se ve es literalmente lo que va a salir.
// =============================================================================

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
    AlertTriangle,
    CalendarRange,
    Check,
    ChevronDown,
    Hash,
    Loader2,
    Play,
    Save,
    Sparkles,
    Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
import { guardarPolitica } from '@/lib/actions/arca-emision'
import { simularConfiguracion, emitirLote } from '@/lib/actions/arca-emision'
import type { VistaPreviaCupo } from '@/lib/arca/motor'
import type { PoliticaVista } from '@/lib/actions/arca'
import {
    ETIQUETA_ESTRATEGIA,
    porcentajeCupo,
    ritmoDelPeriodo,
    type EstrategiaSeleccion,
    type ModoCupo,
    type PeriodoCupo,
} from '@/lib/arca/cupo'

const money = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

const METODOS: { valor: string; etiqueta: string }[] = [
    { valor: 'cash', etiqueta: 'Efectivo' },
    { valor: 'card', etiqueta: 'Tarjeta' },
    { valor: 'transfer', etiqueta: 'Transferencia' },
]

const PERIODOS: { valor: PeriodoCupo; etiqueta: string }[] = [
    { valor: 'dia', etiqueta: 'por día' },
    { valor: 'semana', etiqueta: 'por semana' },
    { valor: 'mes', etiqueta: 'por mes' },
]

interface EstadoFormulario {
    branchId: string | null
    habilitada: boolean
    modo: ModoCupo
    periodo: PeriodoCupo
    objetivoCantidad: number | null
    objetivoMonto: number | null
    estrategia: EstrategiaSeleccion
    metodosPago: string[]
    ticketMinimo: number | null
    ticketMaximo: number | null
    incluyePropinas: boolean
    permitirExceso: boolean
    diasHaciaAtras: number
    emisionAutomatica: boolean
    horaEmision: number
}

function desdePolitica(p: PoliticaVista | null, branchId: string | null): EstadoFormulario {
    return {
        branchId: p?.branchId ?? branchId,
        habilitada: p?.habilitada ?? false,
        modo: p?.modo ?? 'manual',
        periodo: p?.periodo ?? 'mes',
        objetivoCantidad: p?.objetivoCantidad ?? null,
        objetivoMonto: p?.objetivoMonto ?? null,
        estrategia: p?.estrategia ?? 'distribuido',
        metodosPago: p?.metodosPago?.length ? p.metodosPago : ['cash', 'card', 'transfer'],
        ticketMinimo: p?.ticketMinimo ?? null,
        ticketMaximo: p?.ticketMaximo ?? null,
        incluyePropinas: p?.incluyePropinas ?? false,
        permitirExceso: p?.permitirExceso ?? false,
        diasHaciaAtras: p?.diasHaciaAtras ?? 7,
        emisionAutomatica: p?.emisionAutomatica ?? false,
        horaEmision: p?.horaEmision ?? 22,
    }
}

interface EditorCupoProps {
    /**
     * TODAS las políticas de la organización, no una sola.
     *
     * El selector de sucursal de esta pantalla tiene que mostrar la política de
     * la sucursal elegida. Recibiendo una sola, elegir "Caseros" seguía
     * mostrando el cupo de la organización y Guardar le pisaba a Caseros su
     * configuración con una que nunca se le mostró al usuario.
     */
    politicas: PoliticaVista[]
    sucursales: { id: string; name: string }[]
    puedeConfigurar: boolean
    puedeEmitir: boolean
    onGuardado: () => void
}

function politicaDe(politicas: PoliticaVista[], branchId: string | null): PoliticaVista | null {
    return politicas.find((p) => p.branchId === branchId) ?? null
}

export function EditorCupo({
    politicas,
    sucursales,
    puedeConfigurar,
    puedeEmitir,
    onGuardado,
}: EditorCupoProps) {
    // La sucursal elegida vive acá: es lo que decide QUÉ política se edita.
    const [branchId, setBranchId] = useState<string | null>(
        () => (politicas.find((p) => p.branchId === null) ?? politicas[0])?.branchId ?? null,
    )
    const politica = politicaDe(politicas, branchId)
    const [form, setForm] = useState<EstadoFormulario>(() => desdePolitica(politica, branchId))
    const [previa, setPrevia] = useState<VistaPreviaCupo | null>(null)
    const [cargandoPrevia, setCargandoPrevia] = useState(false)
    const [avanzadoAbierto, setAvanzadoAbierto] = useState(false)
    const [confirmarEmision, setConfirmarEmision] = useState(false)
    const [guardando, empezarGuardado] = useTransition()
    const [emitiendo, setEmitiendo] = useState(false)

    // El formulario se rearma cuando cambia la sucursal elegida o cuando el
    // padre trae datos nuevos. La firma incluye el id de la política para que
    // pasar de "sin política" a "recién creada" también recargue.
    const firma = (branchId ?? 'org') + ':' + (politica?.id ?? 'nueva')
    const firmaPrevia = useRef(firma)
    useEffect(() => {
        if (firmaPrevia.current === firma) return
        firmaPrevia.current = firma
        setForm(desdePolitica(politicaDe(politicas, branchId), branchId))
    }, [firma, politicas, branchId])

    const set = <K extends keyof EstadoFormulario>(k: K, v: EstadoFormulario[K]) =>
        setForm((f) => ({ ...f, [k]: v }))

    // --- Vista previa en vivo, con freno ---
    // Sin debounce, tipear "1200" dispara cuatro consultas y la última en
    // llegar puede no ser la del último valor tipeado. El contador de peticiones
    // descarta las respuestas viejas.
    const peticion = useRef(0)
    const refrescarPrevia = useCallback(async (f: EstadoFormulario) => {
        const mia = ++peticion.current
        setCargandoPrevia(true)
        let r: VistaPreviaCupo
        try {
            r = await simularConfiguracion({
                branchId: f.branchId,
                modo: f.modo,
                periodo: f.periodo,
                objetivoCantidad: f.objetivoCantidad,
                objetivoMonto: f.objetivoMonto,
                estrategia: f.estrategia,
                metodosPago: f.metodosPago,
                ticketMinimo: f.ticketMinimo,
                ticketMaximo: f.ticketMaximo,
                incluyePropinas: f.incluyePropinas,
                permitirExceso: f.permitirExceso,
                diasHaciaAtras: f.diasHaciaAtras,
            })
        } catch {
            if (mia !== peticion.current) return
            setPrevia({
                plan: {
                    seleccionados: [], descartados: [], totalSeleccionado: 0,
                    motivoCorte: 'sin_candidatos',
                    proyeccion: { cantidadFinal: 0, montoFinal: 0, restanteCantidad: 0, restanteMonto: 0 },
                },
                cupo: null,
                politica: null,
                error: 'No pudimos calcular la vista previa. Revisá la conexión y volvé a intentar.',
            })
            setCargandoPrevia(false)
            return
        }
        if (mia !== peticion.current) return // llegó tarde: ya hay una más nueva
        setPrevia(r)
        setCargandoPrevia(false)
    }, [])

    useEffect(() => {
        const t = setTimeout(() => void refrescarPrevia(form), 350)
        return () => clearTimeout(t)
    }, [form, refrescarPrevia])

    const guardar = () => {
        empezarGuardado(async () => {
            try {
                const r = await guardarPolitica({
                    branchId: form.branchId,
                    habilitada: form.habilitada,
                    modo: form.modo,
                    periodo: form.periodo,
                    objetivoCantidad: form.objetivoCantidad,
                    objetivoMonto: form.objetivoMonto,
                    estrategia: form.estrategia,
                    metodosPago: form.metodosPago,
                    ticketMinimo: form.ticketMinimo,
                    ticketMaximo: form.ticketMaximo,
                    incluyePropinas: form.incluyePropinas,
                    permitirExceso: form.permitirExceso,
                    diasHaciaAtras: form.diasHaciaAtras,
                    emisionAutomatica: form.emisionAutomatica,
                    horaEmision: form.horaEmision,
                })
                if ('error' in r) {
                    toast.error(r.error)
                    return
                }
                toast.success('Configuración de facturación guardada')
                onGuardado()
            } catch {
                toast.error('No pudimos guardar. Revisá la conexión y volvé a intentar.')
            }
        })
    }

    /**
     * Emite EXACTAMENTE las ventas que están listadas arriba.
     *
     * Se mandan los ids de la vista previa en vez de disparar la política
     * guardada. La diferencia importa: la previa se calcula con la
     * configuración que el usuario tiene EN PANTALLA, y la política guardada
     * puede ser otra. Con `ejecutarPolitica` acá, alguien que cambiaba el
     * objetivo a 200 y apretaba "Facturar estos 200" recibía 50 comprobantes
     * de los cortes más baratos, porque el server volvía a planificar desde lo
     * guardado. El botón dice un número: tiene que emitir ese.
     */
    const facturarAhora = async () => {
        const ids = plan?.seleccionados.map((s) => s.visitId) ?? []
        if (ids.length === 0) return

        setConfirmarEmision(false)
        setEmitiendo(true)
        let r: Awaited<ReturnType<typeof emitirLote>>
        try {
            r = await emitirLote(ids)
        } catch {
            // Una server action RECHAZA (no devuelve {error}) ante corte de red
            // o timeout de la función. Sin este catch el spinner queda girando
            // para siempre y el usuario recarga y vuelve a apretar — que es
            // justo lo que este módulo trata de evitar.
            setEmitiendo(false)
            toast.error(
                'Se cortó la comunicación. Antes de reintentar, mirá la pestaña Comprobantes: ' +
                'puede que algunos se hayan emitido igual.',
            )
            return
        }
        setEmitiendo(false)
        if ('error' in r) {
            toast.error(r.error)
            return
        }
        if (r.emitidos.length === 0 && r.fallidos.length === 0) {
            toast.info('No había nada para facturar con esta configuración.')
        } else if (r.fallidos.length === 0) {
            toast.success(`${r.emitidos.length} comprobante(s) emitidos por ${money(r.total)}`)
        } else {
            toast.warning(
                `${r.emitidos.length} emitidos, ${r.fallidos.length} con problemas. ` +
                (r.fallidos[0]?.motivo ?? ''),
            )
        }
        onGuardado()
    }

    const cupo = previa?.cupo ?? politica?.cupo ?? null
    const plan = previa?.plan ?? null
    const pct = cupo ? porcentajeCupo(cupo, form.modo) : 0
    const ritmo = cupo ? ritmoDelPeriodo(cupo, form.modo) : null

    const objetivoIncompleto =
        (form.modo === 'cantidad' && !form.objetivoCantidad) ||
        (form.modo === 'monto' && !form.objetivoMonto)

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            {/* =============================== CONFIGURACIÓN =============================== */}
            <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-1 flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-base font-semibold">¿Qué se factura?</h3>
                            <p className="text-sm text-muted-foreground">
                                No todos los cortes se facturan. Acá definís cuántos, con qué criterio y de qué sucursal.
                            </p>
                        </div>
                        {sucursales.length > 1 && (
                            <Select
                                value={branchId ?? '__org__'}
                                onValueChange={(v) => setBranchId(v === '__org__' ? null : v)}
                                disabled={!puedeConfigurar}
                                aria-label="Sucursal del cupo"
                            >
                                <SelectTrigger className="w-52 shrink-0">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__org__">Todas las sucursales</SelectItem>
                                    {sucursales.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* --- Modo --- */}
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        {([
                            { modo: 'manual' as ModoCupo, icono: Sparkles, titulo: 'A mano', bajada: 'Elegís vos, uno por uno' },
                            { modo: 'cantidad' as ModoCupo, icono: Hash, titulo: 'Por cantidad', bajada: 'N comprobantes por período' },
                            { modo: 'monto' as ModoCupo, icono: Wallet, titulo: 'Por monto', bajada: 'Hasta $X por período' },
                        ]).map(({ modo, icono: Icono, titulo, bajada }) => {
                            const activo = form.modo === modo
                            return (
                                <button
                                    key={modo}
                                    type="button"
                                    disabled={!puedeConfigurar}
                                    onClick={() => set('modo', modo)}
                                    className={`rounded-lg border p-3 text-left transition ${
                                        activo
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-border hover:border-foreground/25 hover:bg-muted/40'
                                    } disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                    <Icono className={`mb-1.5 size-4 ${activo ? 'text-primary' : 'text-muted-foreground'}`} />
                                    <div className="text-sm font-medium">{titulo}</div>
                                    <div className="text-xs text-muted-foreground">{bajada}</div>
                                </button>
                            )
                        })}
                    </div>

                    {/* --- La oración --- */}
                    {form.modo !== 'manual' && (
                        <div className="mt-5 rounded-lg bg-muted/50 p-4">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-[15px] leading-loose">
                                <span className="text-muted-foreground">Facturar</span>

                                {form.modo === 'cantidad' ? (
                                    <>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={form.objetivoCantidad ?? ''}
                                            onChange={(e) =>
                                                set('objetivoCantidad', e.target.value ? Number(e.target.value) : null)
                                            }
                                            disabled={!puedeConfigurar}
                                            className="h-9 w-24 text-center font-semibold tabular-nums"
                                            placeholder="50"
                                        />
                                        <span className="font-medium">comprobantes</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="font-medium">hasta</span>
                                        <div className="relative">
                                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                                $
                                            </span>
                                            <Input
                                                type="number"
                                                min={1}
                                                step={1000}
                                                value={form.objetivoMonto ?? ''}
                                                onChange={(e) =>
                                                    set('objetivoMonto', e.target.value ? Number(e.target.value) : null)
                                                }
                                                disabled={!puedeConfigurar}
                                                className="h-9 w-36 pl-6 text-center font-semibold tabular-nums"
                                                placeholder="800000"
                                            />
                                        </div>
                                    </>
                                )}

                                <Select
                                    value={form.periodo}
                                    onValueChange={(v) => set('periodo', v as PeriodoCupo)}
                                    disabled={!puedeConfigurar}
                                >
                                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {PERIODOS.map((p) => (
                                            <SelectItem key={p.valor} value={p.valor}>{p.etiqueta}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <span className="text-muted-foreground">, eligiendo</span>

                                <Select
                                    value={form.estrategia}
                                    onValueChange={(v) => set('estrategia', v as EstrategiaSeleccion)}
                                    disabled={!puedeConfigurar}
                                >
                                    <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(ETIQUETA_ESTRATEGIA) as EstrategiaSeleccion[]).map((k) => (
                                            <SelectItem key={k} value={k}>{ETIQUETA_ESTRATEGIA[k].nombre}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <span className="text-muted-foreground">.</span>
                            </div>

                            <p className="mt-2 text-xs text-muted-foreground">
                                {ETIQUETA_ESTRATEGIA[form.estrategia].explicacion}
                            </p>
                        </div>
                    )}

                    {form.modo === 'manual' && (
                        <p className="mt-5 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                            En modo <span className="font-medium text-foreground">a mano</span> no se factura nada solo.
                            Vas a ver la lista de ventas sin facturar y elegís cuáles emitir.
                        </p>
                    )}

                    {/* --- Medios de cobro --- */}
                    <div className="mt-5">
                        <div className="mb-2 text-sm font-medium">Sólo cobros en</div>
                        <div className="flex flex-wrap gap-2">
                            {METODOS.map((m) => {
                                const activo = form.metodosPago.includes(m.valor)
                                return (
                                    <button
                                        key={m.valor}
                                        type="button"
                                        disabled={!puedeConfigurar}
                                        onClick={() =>
                                            set(
                                                'metodosPago',
                                                activo
                                                    ? form.metodosPago.filter((x) => x !== m.valor)
                                                    : [...form.metodosPago, m.valor],
                                            )
                                        }
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                                            activo
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:border-foreground/25'
                                        } disabled:cursor-not-allowed disabled:opacity-60`}
                                    >
                                        {activo && <Check className="size-3.5" />}
                                        {m.etiqueta}
                                    </button>
                                )
                            })}
                        </div>
                        {form.metodosPago.length === 0 && (
                            <p className="mt-2 text-xs text-destructive">Elegí al menos un medio de cobro.</p>
                        )}
                    </div>

                    {/* --- Avanzado --- */}
                    <button
                        type="button"
                        onClick={() => setAvanzadoAbierto((v) => !v)}
                        className="mt-5 flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40"
                    >
                        <span>Filtros y opciones avanzadas</span>
                        <ChevronDown className={`size-4 transition-transform ${avanzadoAbierto ? 'rotate-180' : ''}`} />
                    </button>

                    {avanzadoAbierto && (
                        <div className="mt-3 space-y-4 rounded-lg border border-border p-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <div className="mb-1.5 text-sm font-medium">Ticket mínimo</div>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.ticketMinimo ?? ''}
                                        onChange={(e) => set('ticketMinimo', e.target.value ? Number(e.target.value) : null)}
                                        disabled={!puedeConfigurar}
                                        placeholder="Sin mínimo"
                                        className="tabular-nums"
                                    />
                                </div>
                                <div>
                                    <div className="mb-1.5 text-sm font-medium">Ticket máximo</div>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.ticketMaximo ?? ''}
                                        onChange={(e) => set('ticketMaximo', e.target.value ? Number(e.target.value) : null)}
                                        disabled={!puedeConfigurar}
                                        placeholder="Sin máximo"
                                        className="tabular-nums"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="mb-1.5 text-sm font-medium">Hasta cuántos días atrás puede tomar ventas</div>
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={60}
                                        value={form.diasHaciaAtras}
                                        onChange={(e) => set('diasHaciaAtras', Number(e.target.value) || 7)}
                                        disabled={!puedeConfigurar}
                                        className="w-24 tabular-nums"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        El comprobante se emite con la fecha de hoy y el período del servicio dice cuándo
                                        se hizo el corte.
                                    </p>
                                </div>
                            </div>

                            <label className="flex cursor-pointer items-start justify-between gap-4">
                                <span>
                                    <span className="block text-sm font-medium">Incluir las propinas en el importe</span>
                                    <span className="block text-xs text-muted-foreground">
                                        Por defecto se factura sólo el servicio.
                                    </span>
                                </span>
                                <Switch
                                    checked={form.incluyePropinas}
                                    onCheckedChange={(v) => set('incluyePropinas', v)}
                                    disabled={!puedeConfigurar}
                                />
                            </label>

                            {form.modo === 'monto' && (
                                <label className="flex cursor-pointer items-start justify-between gap-4">
                                    <span>
                                        <span className="block text-sm font-medium">Permitir pasarse del monto</span>
                                        <span className="block text-xs text-muted-foreground">
                                            Si está apagado, un corte que cruza el tope no entra y se busca uno más chico
                                            que sí entre.
                                        </span>
                                    </span>
                                    <Switch
                                        checked={form.permitirExceso}
                                        onCheckedChange={(v) => set('permitirExceso', v)}
                                        disabled={!puedeConfigurar}
                                    />
                                </label>
                            )}
                        </div>
                    )}
                </div>

                {/* --- Automático --- */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <label className="flex cursor-pointer items-start justify-between gap-4">
                        <span>
                            <span className="block text-sm font-medium">Emitir automáticamente</span>
                            <span className="block text-sm text-muted-foreground">
                                Una vez por día el sistema factura solo lo que falte para llegar al cupo.
                            </span>
                        </span>
                        <Switch
                            checked={form.emisionAutomatica}
                            onCheckedChange={(v) => set('emisionAutomatica', v)}
                            disabled={!puedeConfigurar || form.modo === 'manual'}
                        />
                    </label>

                    {form.emisionAutomatica && form.modo !== 'manual' && (
                        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                            <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Todos los días a las</span>
                            <Select
                                value={String(form.horaEmision)}
                                onValueChange={(v) => set('horaEmision', Number(v))}
                                disabled={!puedeConfigurar}
                            >
                                <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <SelectItem key={h} value={String(h)}>
                                            {String(h).padStart(2, '0')}:00
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">hora de la sucursal</span>
                        </div>
                    )}
                </div>

                {/* --- Guardar --- */}
                <div className="flex flex-wrap items-center gap-3">
                    <label className="mr-auto flex cursor-pointer items-center gap-2.5">
                        <Switch
                            checked={form.habilitada}
                            onCheckedChange={(v) => set('habilitada', v)}
                            disabled={!puedeConfigurar}
                        />
                        <span className="text-sm font-medium">
                            {form.habilitada ? 'Cupo activo' : 'Cupo desactivado'}
                        </span>
                    </label>

                    <Button
                        onClick={guardar}
                        disabled={!puedeConfigurar || guardando || form.metodosPago.length === 0 || objetivoIncompleto}
                    >
                        {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Guardar configuración
                    </Button>
                </div>

                {!puedeConfigurar && (
                    <p className="text-sm text-muted-foreground">
                        No tenés permiso para cambiar la configuración de facturación.
                    </p>
                )}
            </div>

            {/* =============================== VISTA PREVIA =============================== */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Cupo del período</h3>
                        {cargandoPrevia && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                    </div>

                    {form.modo === 'manual' ? (
                        <p className="text-sm text-muted-foreground">
                            Sin cupo: en modo a mano no hay objetivo que medir.
                        </p>
                    ) : !cupo ? (
                        <p className="text-sm text-muted-foreground">Calculando…</p>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-semibold tabular-nums">
                                    {form.modo === 'cantidad' ? cupo.emitidos : money(cupo.montoEmitido)}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    de {form.modo === 'cantidad'
                                        ? `${form.objetivoCantidad ?? 0} comprobantes`
                                        : money(form.objetivoMonto ?? 0)}
                                </span>
                            </div>

                            {/* Barra construida a mano: el primitivo `progress` no existe en el repo. */}
                            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        pct >= 100 ? 'bg-amber-500' : 'bg-primary'
                                    }`}
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                            </div>

                            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                <span>
                                    {new Date(cupo.periodoDesde + 'T12:00:00').toLocaleDateString('es-AR', {
                                        day: 'numeric',
                                        month: 'short',
                                    })}
                                    {' – '}
                                    {new Date(new Date(cupo.periodoHasta + 'T12:00:00').getTime() - 86400000)
                                        .toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                                </span>
                                {ritmo && <span>{ritmo.diasRestantes} días restantes</span>}
                            </div>

                            {ritmo?.atrasado && (
                                <div className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                    <span>
                                        Vas {ritmo.esperadoPct - ritmo.realPct} puntos por debajo del ritmo del período.
                                        ARCA sólo deja fechar hasta 10 días para atrás, así que dejar todo para el final
                                        puede volverlo imposible de recuperar.
                                    </span>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* --- Qué se facturaría --- */}
                <div className="rounded-xl border border-border bg-card">
                    <div className="border-b border-border px-5 py-3">
                        <h3 className="text-sm font-semibold">Qué se facturaría ahora</h3>
                        <p className="text-xs text-muted-foreground">
                            Exactamente lo que va a emitir, con esta configuración.
                        </p>
                    </div>

                    {previa?.error ? (
                        <div className="p-5 text-sm text-destructive">{previa.error}</div>
                    ) : !plan || plan.seleccionados.length === 0 ? (
                        <div className="p-5 text-sm text-muted-foreground">
                            {plan?.motivoCorte === 'cupo_agotado'
                                ? 'El cupo del período ya está completo.'
                                : plan?.motivoCorte === 'sin_objetivo'
                                    ? 'En modo a mano no se selecciona nada automáticamente.'
                                    : plan?.motivoCorte === 'sin_candidatos'
                                        ? 'No hay ventas sin facturar que cumplan estos filtros.'
                                        : 'Nada para facturar con esta configuración.'}
                        </div>
                    ) : (
                        <>
                            <div className="max-h-80 overflow-y-auto">
                                {plan.seleccionados.map((c) => (
                                    <div
                                        key={c.visitId}
                                        className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-2.5 last:border-0"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-sm">
                                                {c.clientName ?? 'Consumidor final'}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                                {new Date(c.completedAt).toLocaleDateString('es-AR', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                })}
                                                {' · '}
                                                {c.branchName}
                                                {c.serviceName ? ` · ${c.serviceName.trim()}` : ''}
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-sm tabular-nums">{money(c.baseAmount)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-between border-t border-border px-5 py-3">
                                <span className="text-sm text-muted-foreground">
                                    {plan.seleccionados.length} comprobante{plan.seleccionados.length === 1 ? '' : 's'}
                                </span>
                                <span className="text-sm font-semibold tabular-nums">
                                    {money(plan.totalSeleccionado)}
                                </span>
                            </div>

                            {plan.motivoCorte === 'proximo_excede' && !form.permitirExceso && (
                                <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
                                    Se cortó antes de pasarse del monto. Quedan{' '}
                                    {money(plan.proyeccion.restanteMonto)} de cupo sin usar.
                                </p>
                            )}

                            {puedeEmitir && plan.seleccionados.length > 0 && (
                                <div className="border-t border-border p-3">
                                    <Button
                                        className="w-full"
                                        variant="default"
                                        disabled={emitiendo}
                                        onClick={() => setConfirmarEmision(true)}
                                    >
                                        {emitiendo ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                                        Facturar estos {plan.seleccionados.length} ahora
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {previa && plan && plan.descartados.length > 0 && (
                    <p className="px-1 text-xs text-muted-foreground">
                        Quedan {plan.descartados.length} ventas sin facturar en la ventana de{' '}
                        {form.diasHaciaAtras} días.
                    </p>
                )}
            </div>

            <AlertDialog open={confirmarEmision} onOpenChange={setConfirmarEmision}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Emitir {plan?.seleccionados.length ?? 0} comprobante
                            {(plan?.seleccionados.length ?? 0) === 1 ? '' : 's'} por {money(plan?.totalSeleccionado ?? 0)}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Se van a pedir los CAE a ARCA. Son comprobantes fiscales reales: una vez emitidos no se
                            borran, sólo se pueden anular con una nota de crédito.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={facturarAhora}>Emitir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
