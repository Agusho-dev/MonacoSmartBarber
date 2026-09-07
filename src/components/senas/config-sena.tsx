'use client'

// =============================================================================
// "Pedir seña para reservar" — la configuración de la seña de UNA sucursal.
//
// La pantalla tiene una sola idea arriba (el interruptor y el porcentaje) y
// todo lo demás plegado, porque los otros diez campos son decisiones que se
// toman una vez y no se vuelven a mirar. Lo que sí está siempre a la vista es
// la VISTA PREVIA: el texto exacto que el cliente va a leer pegado al botón de
// pagar, calculado con el precio real de un servicio de esta sucursal.
//
// La previa no es un adorno. El monto sale de `calcularSena` y los párrafos de
// `construirPolitica` — las mismas funciones que corren en el servidor cuando
// se cobra de verdad. Escribir acá un "50% del precio" a mano sería crear una
// segunda implementación que tarde o temprano promete un número distinto del
// que Mercado Pago le va a cobrar.
//
// El guardado es un MERGE: se manda SÓLO lo que cambió. `guardarConfigSena`
// interpreta `undefined` como "no lo toques", y esa es la única forma de que
// tocar el porcentaje no apague el interruptor de paso (el bug de
// `guardarCupoBarbero` en ARCA y el del Instagram en `updateClientNotes`).
// =============================================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
    BadgeDollarSign,
    ChevronDown,
    Info,
    Loader2,
    PlugZap,
    Save,
    Undo2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { calcularSena, type BranchDepositSettings, type CanalSena } from '@/lib/senas/contrato'
import { construirPolitica } from '@/lib/senas/politica'
import { guardarConfigSena, type ParcheConfigSena } from '@/lib/actions/senas'

export interface ServicioConPrecio {
    id: string
    nombre: string
    precio: number
}

interface Props {
    sucursal: { id: string; nombre: string }
    /** null = la sucursal todavía no tiene fila (se crea al guardar). */
    config: BranchDepositSettings | null
    /** ¿Hay una cuenta de Mercado Pago conectada? Sin eso no se puede prender. */
    mpConectado: boolean
    /** Servicios reservables de la sucursal, con precio, para la vista previa. */
    servicios: ServicioConPrecio[]
    /** `appointment_settings.cancellation_min_hours`: la ventana que se promete. */
    horasParaCancelar: number
}

/**
 * Los defaults de la base, para la sucursal que todavía no tiene fila.
 *
 * `refund_on_early_cancel` dice **`devolucion`** y no `credito`: la mig 208
 * cambió el default de la columna y actualizó las cuatro sucursales, porque el
 * crédito a favor promete un saldo que NINGÚN camino de reserva sabe imputar
 * (la seña queda `pagada` sin turno y hay que resolverla a mano). Este objeto
 * es lo que ve preseleccionado el dueño la primera vez que abre la pantalla de
 * una sucursal nueva: dejarlo en `credito` era ofrecerle de fábrica justo la
 * opción que la migración sacó.
 */
const POR_DEFECTO = {
    is_enabled: false,
    percentage: 50,
    min_amount: 0,
    round_to: 100,
    hold_minutes: 0,
    expires_minutes: 30,
    wallet_only: false,
    channels: ['app', 'web'] as CanalSena[],
    refund_on_early_cancel: 'devolucion' as BranchDepositSettings['refund_on_early_cancel'],
    forfeit_on_late_cancel: true,
    arrepentimiento_days: 10,
    policy_text: null as string | null,
}

type Estado = typeof POR_DEFECTO

function estadoDe(config: BranchDepositSettings | null): Estado {
    if (!config) return { ...POR_DEFECTO }
    return {
        is_enabled: config.is_enabled,
        percentage: config.percentage,
        min_amount: config.min_amount,
        round_to: config.round_to,
        hold_minutes: config.hold_minutes,
        expires_minutes: config.expires_minutes,
        wallet_only: config.wallet_only,
        channels: [...config.channels],
        refund_on_early_cancel: config.refund_on_early_cancel,
        forfeit_on_late_cancel: config.forfeit_on_late_cancel,
        arrepentimiento_days: config.arrepentimiento_days,
        policy_text: config.policy_text,
    }
}

const CANALES: Array<{ id: CanalSena; etiqueta: string; ayuda: string }> = [
    { id: 'app', etiqueta: 'App de clientes', ayuda: 'Reservas desde la app de Monaco' },
    { id: 'web', etiqueta: 'Turnero web', ayuda: 'Reservas desde el link público' },
    { id: 'staff', etiqueta: 'Turnos cargados por el equipo', ayuda: 'Turnos que se anotan desde el dashboard' },
]

export function ConfigSena({ sucursal, config, mpConectado, servicios, horasParaCancelar }: Props) {
    const router = useRouter()
    const [guardando, iniciar] = useTransition()
    const inicial = useMemo(() => estadoDe(config), [config])
    const [estado, setEstado] = useState<Estado>(inicial)
    const [avanzadoAbierto, setAvanzadoAbierto] = useState(false)

    // Servicio de la previa: el más caro por defecto. Es donde la seña se nota,
    // y donde un redondeo mal puesto se ve más rápido.
    const serviciosOrdenados = useMemo(
        () => [...servicios].filter(s => s.precio > 0).sort((a, b) => b.precio - a.precio),
        [servicios],
    )
    const [servicioId, setServicioId] = useState<string>(serviciosOrdenados[0]?.id ?? '')
    const servicio = serviciosOrdenados.find(s => s.id === servicioId) ?? serviciosOrdenados[0] ?? null

    function set<K extends keyof Estado>(clave: K, valor: Estado[K]) {
        setEstado(prev => ({ ...prev, [clave]: valor }))
    }

    // Sólo lo que cambió: es lo que hace que el MERGE del servidor sirva de algo.
    const parche = useMemo<ParcheConfigSena>(() => {
        const p: ParcheConfigSena = {}
        for (const clave of Object.keys(inicial) as Array<keyof Estado>) {
            const antes = inicial[clave]
            const ahora = estado[clave]
            const distinto = Array.isArray(antes)
                ? JSON.stringify([...antes].sort()) !== JSON.stringify([...(ahora as CanalSena[])].sort())
                : antes !== ahora
            if (distinto) {
                // El cast es inevitable: el parche es un subconjunto tipado del
                // estado y TypeScript no relaciona las dos claves genéricas.
                ;(p as Record<string, unknown>)[clave] = ahora
            }
        }
        return p
    }, [inicial, estado])

    const hayCambios = Object.keys(parche).length > 0

    // La previa se calcula SIEMPRE como si la seña estuviera prendida: es lo que
    // el dueño está por decidir, y mostrarle "no aplica" mientras evalúa
    // prenderla no le dice nada.
    const previa = useMemo(() => {
        if (!servicio) return null
        const cfgPrevia: BranchDepositSettings = {
            id: config?.id ?? '',
            organization_id: config?.organization_id ?? '',
            branch_id: sucursal.id,
            ...estado,
            is_enabled: true,
        }
        const calculo = calcularSena(servicio.precio, cfgPrevia, 'web', ['app', 'web', 'staff'])
        if (!calculo.aplica) return { calculo, politica: null }
        return {
            calculo,
            politica: construirPolitica(cfgPrevia, calculo, {
                servicios: servicio.nombre,
                sucursal: sucursal.nombre,
                horasParaCancelar,
            }),
        }
    }, [config, estado, horasParaCancelar, servicio, sucursal.id, sucursal.nombre])

    function guardar() {
        iniciar(async () => {
            const r = await guardarConfigSena(sucursal.id, parche)
            if (!r.ok) {
                toast.error(r.error ?? 'No pudimos guardar la configuración de la seña.')
                return
            }
            toast.success('Configuración de la seña guardada')
            router.refresh()
        })
    }

    return (
        <Card id="seccion-sena" className="scroll-mt-24">
            <CardHeader>
                <CardTitle className="text-base">Seña para reservar</CardTitle>
                <CardDescription>
                    Con la seña prendida, un turno de {sucursal.nombre} se confirma recién cuando Mercado Pago acredita
                    el pago. El resto se cobra en el local, como siempre.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
                {/* Interruptor maestro */}
                <div
                    className={cn(
                        'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between',
                        estado.is_enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40',
                    )}
                >
                    <div className="flex items-start gap-3">
                        <BadgeDollarSign className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <div>
                            <p className="font-medium">Pedir seña para reservar</p>
                            <p className="text-xs text-muted-foreground">
                                {mpConectado
                                    ? 'Se aplica a las reservas online. Los turnos que carga el equipo no cambian salvo que lo actives abajo.'
                                    : 'Primero hay que conectar la cuenta de Mercado Pago de esta sucursal.'}
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={estado.is_enabled}
                        disabled={!mpConectado}
                        onCheckedChange={v => set('is_enabled', v)}
                        aria-label="Pedir seña para reservar"
                    />
                </div>

                {!mpConectado && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <PlugZap className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        <p className="text-xs leading-relaxed">
                            <span className="font-medium">No se puede prender la seña sin cuenta de cobro.</span>{' '}
                            Sin una cuenta de Mercado Pago conectada no hay a dónde mandar la plata: el cliente elegiría
                            día y hora y el pago fallaría al final, que es el peor lugar para fallar. Conectala en
                            &ldquo;Cobros online&rdquo;, acá arriba.
                        </p>
                    </div>
                )}

                {/* Porcentaje */}
                <div className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                        <Label htmlFor="pct-sena" className="text-sm">
                            Cuánto se cobra por adelantado
                        </Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="pct-sena"
                                type="number"
                                min={1}
                                max={100}
                                value={estado.percentage}
                                onChange={e => set('percentage', Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                                className="w-20 text-right tabular-nums"
                            />
                            <span className="text-sm text-muted-foreground">% del precio</span>
                        </div>
                    </div>
                    <Slider
                        value={[estado.percentage]}
                        min={5}
                        max={100}
                        step={5}
                        onValueChange={([v]) => set('percentage', v)}
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>5%</span>
                        <button
                            type="button"
                            onClick={() => set('percentage', 50)}
                            className={cn(
                                'rounded-md border px-2 py-0.5 font-medium transition-colors',
                                estado.percentage === 50
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border hover:border-foreground/30 hover:text-foreground',
                            )}
                        >
                            50% recomendado
                        </button>
                        <span>100%</span>
                    </div>
                </div>

                {/* Vista previa */}
                <VistaPrevia
                    servicios={serviciosOrdenados}
                    servicioId={servicio?.id ?? ''}
                    onCambiarServicio={setServicioId}
                    calculo={previa?.calculo ?? null}
                    politica={previa?.politica ?? null}
                />

                {/* Ajustes avanzados */}
                <div className="border-t border-border/60 pt-3">
                    <button
                        type="button"
                        onClick={() => setAvanzadoAbierto(v => !v)}
                        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <ChevronDown className={cn('size-4 transition-transform', avanzadoAbierto && 'rotate-180')} />
                        Ajustes avanzados
                    </button>

                    {avanzadoAbierto && (
                        <div className="mt-4 space-y-5">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Campo
                                    id="min-sena"
                                    etiqueta="Monto mínimo"
                                    ayuda="Debajo de este monto no se pide seña: la comisión de Mercado Pago y la fricción no se justifican. 0 = siempre se pide."
                                >
                                    <Input
                                        id="min-sena"
                                        type="number"
                                        min={0}
                                        step={100}
                                        value={estado.min_amount}
                                        onChange={e => set('min_amount', Math.max(0, Number(e.target.value) || 0))}
                                        className="tabular-nums"
                                    />
                                </Campo>

                                <Campo
                                    id="redondeo-sena"
                                    etiqueta="Redondear a múltiplos de"
                                    ayuda="El 50% de un precio impar da $7.987,50. Redondeando a 100 el cliente lee $8.000, que es lo que espera ver."
                                >
                                    <Input
                                        id="redondeo-sena"
                                        type="number"
                                        min={1}
                                        step={100}
                                        value={estado.round_to}
                                        onChange={e => set('round_to', Math.max(1, Number(e.target.value) || 1))}
                                        className="tabular-nums"
                                    />
                                </Campo>

                                <Campo
                                    id="vigencia-sena"
                                    etiqueta="Vigencia del link de pago (minutos)"
                                    ayuda="Pasado ese tiempo el link se vence solo y el turno se libera. Entre 5 y 720."
                                >
                                    <Input
                                        id="vigencia-sena"
                                        type="number"
                                        min={5}
                                        max={720}
                                        value={estado.expires_minutes}
                                        onChange={e => set('expires_minutes', Math.min(720, Math.max(5, Number(e.target.value) || 5)))}
                                        className="tabular-nums"
                                    />
                                </Campo>

                                <Campo
                                    id="hold-sena"
                                    etiqueta="Reservar el horario mientras paga (minutos)"
                                    ayuda="Con 0 el horario NO se guarda: si alguien lo toma mientras el cliente paga, se le devuelve la seña automáticamente y se le avisa antes de pagar. Es la configuración actual del negocio."
                                >
                                    <Input
                                        id="hold-sena"
                                        type="number"
                                        min={0}
                                        max={120}
                                        value={estado.hold_minutes}
                                        onChange={e => set('hold_minutes', Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
                                        className="tabular-nums"
                                    />
                                </Campo>
                            </div>

                            <div>
                                <p className="text-sm font-medium">Dónde se pide la seña</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    Tiene que quedar al menos uno prendido.
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {CANALES.map(c => {
                                        const activo = estado.channels.includes(c.id)
                                        return (
                                            <button
                                                key={c.id}
                                                type="button"
                                                title={c.ayuda}
                                                onClick={() =>
                                                    set(
                                                        'channels',
                                                        activo
                                                            ? estado.channels.filter(x => x !== c.id)
                                                            : [...estado.channels, c.id],
                                                    )
                                                }
                                                className={cn(
                                                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                                                    activo
                                                        ? 'border-primary bg-primary text-primary-foreground'
                                                        : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                                                )}
                                            >
                                                {c.etiqueta}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Campo
                                    id="cancel-sena"
                                    etiqueta="Si cancela a tiempo"
                                    ayuda="Qué pasa con la seña cuando el cliente cancela dentro de la ventana de anticipación que definiste en las reglas del turnero."
                                >
                                    <Select
                                        value={estado.refund_on_early_cancel}
                                        onValueChange={v =>
                                            set('refund_on_early_cancel', v as Estado['refund_on_early_cancel'])
                                        }
                                    >
                                        <SelectTrigger id="cancel-sena">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="credito">Le queda a favor para el próximo turno</SelectItem>
                                            <SelectItem value="devolucion">Se le devuelve por Mercado Pago</SelectItem>
                                            <SelectItem value="ninguno">No se devuelve</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Campo>

                                <Campo
                                    id="arrep-sena"
                                    etiqueta="Días de arrepentimiento"
                                    ayuda="El art. 1110 del Código Civil y Comercial le da al cliente 10 días corridos para arrepentirse de una compra a distancia y pedir la devolución total. Es irrenunciable: bajarlo de 10 no lo hace desaparecer, sólo hace que la política diga algo que no se puede cumplir."
                                >
                                    <Input
                                        id="arrep-sena"
                                        type="number"
                                        min={0}
                                        max={60}
                                        value={estado.arrepentimiento_days}
                                        onChange={e => set('arrepentimiento_days', Math.max(0, Number(e.target.value) || 0))}
                                        className="tabular-nums"
                                    />
                                </Campo>
                            </div>

                            <Interruptor
                                titulo="Si cancela tarde o no viene, la seña queda para el local"
                                ayuda="Es el tiempo que el barbero reservó y ya no puede vender. Apagalo si preferís devolver siempre."
                                valor={estado.forfeit_on_late_cancel}
                                onCambiar={v => set('forfeit_on_late_cancel', v)}
                            />

                            <Interruptor
                                titulo="Sólo con cuenta de Mercado Pago"
                                ayuda="Restringe el pago a usuarios con sesión iniciada en Mercado Pago: menos pasos para el que ya la tiene, pero deja afuera al que quiere pagar como invitado con tarjeta."
                                valor={estado.wallet_only}
                                onCambiar={v => set('wallet_only', v)}
                            />

                            <div>
                                <Label htmlFor="texto-sena" className="text-sm">
                                    Texto propio de la política de cancelación
                                </Label>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    Si lo completás, reemplaza al párrafo que el sistema arma solo. Dejalo vacío salvo que
                                    necesites decir algo distinto: el automático ya refleja lo que configuraste arriba.
                                </p>
                                <Textarea
                                    id="texto-sena"
                                    value={estado.policy_text ?? ''}
                                    onChange={e => set('policy_text', e.target.value)}
                                    rows={3}
                                    maxLength={2000}
                                    className="mt-2"
                                    placeholder="Dejalo vacío para usar el texto automático"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>

            {hayCambios && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setEstado(inicial)} disabled={guardando}>
                        <Undo2 className="mr-1.5 size-3.5" />
                        Descartar
                    </Button>
                    <Button size="sm" onClick={guardar} disabled={guardando}>
                        {guardando ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Save className="mr-1.5 size-3.5" />}
                        Guardar la seña
                    </Button>
                </div>
            )}
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────

function VistaPrevia({
    servicios,
    servicioId,
    onCambiarServicio,
    calculo,
    politica,
}: {
    servicios: ServicioConPrecio[]
    servicioId: string
    onCambiarServicio: (id: string) => void
    calculo: ReturnType<typeof calcularSena> | null
    politica: ReturnType<typeof construirPolitica> | null
}) {
    if (!servicios.length) {
        return (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No hay servicios con precio cargado en esta sucursal, así que no podemos mostrarte cuánto quedaría la
                seña. Cargá el precio de los servicios y volvé.
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Lo que va a leer el cliente
                </p>
                <Select value={servicioId} onValueChange={onCambiarServicio}>
                    <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {servicios.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                                {s.nombre} · {formatCurrency(s.precio)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {!calculo || !calculo.aplica || !politica ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    Con estos valores no se pediría seña para este servicio (el monto queda debajo del mínimo).
                </p>
            ) : (
                <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-black tabular-nums tracking-tight">
                            {formatCurrency(calculo.sena)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                            de seña · restan{' '}
                            <span className="font-semibold text-foreground">{formatCurrency(calculo.resto)}</span> en el
                            local
                        </span>
                    </div>
                    <div className="space-y-2 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
                        <p className="text-sm font-medium text-foreground">{politica.titulo}</p>
                        <p>{politica.detalle}</p>
                        <p>{politica.reserva}</p>
                        <p>{politica.cancelacion}</p>
                        {politica.arrepentimiento && <p>{politica.arrepentimiento}</p>}
                    </div>
                </div>
            )}
        </div>
    )
}

function Campo({
    id,
    etiqueta,
    ayuda,
    children,
}: {
    id: string
    etiqueta: string
    ayuda: string
    children: React.ReactNode
}) {
    return (
        <div>
            {/* `Label` de shadcn trae `flex items-center gap-2`: metiéndole texto
                largo adentro, cada corrida de texto se vuelve un flex item y el
                párrafo se dibuja en columnas. La ayuda va aparte, en un <p>. */}
            <Label htmlFor={id} className="text-sm">
                {etiqueta}
            </Label>
            <div className="mt-1.5">{children}</div>
            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                <span>{ayuda}</span>
            </p>
        </div>
    )
}

function Interruptor({
    titulo,
    ayuda,
    valor,
    onCambiar,
}: {
    titulo: string
    ayuda: string
    valor: boolean
    onCambiar: (v: boolean) => void
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
            <div className="min-w-0">
                <p className="text-sm font-medium">{titulo}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{ayuda}</p>
            </div>
            <Switch checked={valor} onCheckedChange={onCambiar} aria-label={titulo} className="mt-0.5 shrink-0" />
        </div>
    )
}
