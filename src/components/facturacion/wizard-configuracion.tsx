'use client'

// =============================================================================
// src/components/facturacion/wizard-configuracion.tsx
// Configuración guiada del facturador ARCA.
//
// NO es un wizard modal lineal, y es a propósito: los trámites de verdad pasan
// en el portal de ARCA, fuera de esta app. El dueño arranca acá, se va a ARCA,
// vuelve mañana con un archivo, cierra la pestaña, la abre en el celular. Por
// eso esto es un CHECKLIST PERSISTENTE: cada paso se puede hacer en cualquier
// orden, el estado real lo manda el server (`estado.checklist`) y la pantalla
// nunca "pierde el lugar" — se abre sola en el primer paso que falta.
//
// Reglas de copy que se siguen en todo el archivo:
//  · Cada mensaje dice QUÉ pasó y QUÉ hacer. El lector es el dueño de la
//    barbería, no un contador ni un programador.
//  · Ningún código crudo de ARCA se muestra sin traducir. Los códigos van
//    adentro del <details> de soporte y nada más.
//  · La ruta de navegación de ARCA se escribe como se navega, porque los
//    deep-links a servicios puntuales no son estables (ni están documentados).
// =============================================================================

import { useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
    AlertTriangle,
    Building2,
    CalendarClock,
    Check,
    CheckCircle2,
    ChevronDown,
    ClipboardCheck,
    Copy,
    Download,
    ExternalLink,
    FileText,
    Info,
    KeyRound,
    Loader2,
    Lock,
    MessageSquare,
    PlugZap,
    RefreshCw,
    Server,
    ShieldCheck,
    Store,
    Upload,
    XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

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
import { cn } from '@/lib/utils'

import {
    asignarPuntoVenta,
    cargarCertificado,
    generarPedidoCertificado,
    guardarDatosFiscales,
    verificarConexionArca,
} from '@/lib/actions/arca'
import type {
    ChecklistItem,
    ContribuyenteVista,
    EstadoFacturador,
    PuntoVentaVista,
    ResultadoVerificacion,
} from '@/lib/actions/arca'
import type { ErrorTraducido } from '@/lib/arca/errores'
import { PORTAL_ARCA, type AmbienteArca, type CondicionIvaEmisor } from '@/lib/arca/config'

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

interface WizardConfiguracionProps {
    estado: EstadoFacturador
    puedeConfigurar: boolean
    onRefrescar: () => void
}

// -----------------------------------------------------------------------------
// Constantes de dominio para la pantalla
// -----------------------------------------------------------------------------

/** Select de shadcn no acepta value="" — este es el centinela de "sin sucursal". */
const CLAVE_TODAS = '__todas__'

type IdPaso = 'datos' | 'certificado' | 'conexion' | 'puntos'
type EstadoPaso = ChecklistItem['estado']

const CONDICIONES: {
    valor: CondicionIvaEmisor
    etiqueta: string
    emite: string
    detalle: string
}[] = [
    {
        valor: 'monotributo',
        etiqueta: 'Monotributo',
        emite: 'Vas a emitir Factura C',
        detalle:
            'En la Factura C no se discrimina IVA: el total del comprobante es exactamente lo que le cobrás al cliente.',
    },
    {
        valor: 'responsable_inscripto',
        etiqueta: 'Responsable Inscripto',
        emite: 'Vas a emitir Factura B (con IVA 21% informado a ARCA)',
        detalle:
            'El cliente ve un solo total, igual que siempre. Por detrás le informamos a ARCA cuánto de ese total es neto y cuánto es IVA.',
    },
    {
        valor: 'exento',
        etiqueta: 'Exento',
        emite: 'Vas a emitir Factura C',
        detalle:
            'Como estás exento no se discrimina IVA: el total del comprobante es exactamente lo que le cobrás al cliente.',
    },
]

const AMBIENTES: { valor: AmbienteArca; titulo: string; detalle: string }[] = [
    {
        valor: 'homologacion',
        titulo: 'Pruebas (homologación)',
        detalle:
            'Los comprobantes NO tienen validez fiscal. Sirve para probar todo el circuito sin ningún riesgo.',
    },
    {
        valor: 'produccion',
        titulo: 'Producción',
        detalle:
            'Comprobantes fiscales reales, con CAE. Lo que emitas acá cuenta ante ARCA y no se borra.',
    },
]

const ESTILO_ESTADO: Record<
    EstadoPaso,
    { texto: string; fondo: string; borde: string; etiqueta: string }
> = {
    listo: {
        texto: 'text-emerald-600 dark:text-emerald-400',
        fondo: 'bg-emerald-500/10',
        borde: 'border-emerald-500/30',
        etiqueta: 'Listo',
    },
    pendiente: {
        texto: 'text-muted-foreground',
        fondo: 'bg-muted',
        borde: 'border-border',
        etiqueta: 'Falta hacer',
    },
    error: {
        texto: 'text-red-600 dark:text-red-400',
        fondo: 'bg-red-500/10',
        borde: 'border-red-500/30',
        etiqueta: 'Hay que revisarlo',
    },
    informativo: {
        texto: 'text-sky-600 dark:text-sky-400',
        fondo: 'bg-sky-500/10',
        borde: 'border-sky-500/30',
        etiqueta: 'Para tener en cuenta',
    },
}

const TONO_CULPA: Record<
    ErrorTraducido['culpa'],
    { borde: string; fondo: string; texto: string; encabezado: string }
> = {
    usuario: {
        borde: 'border-amber-500/40',
        fondo: 'bg-amber-500/10',
        texto: 'text-amber-600 dark:text-amber-400',
        encabezado: 'Queda algo por hacer en ARCA',
    },
    arca: {
        borde: 'border-sky-500/40',
        fondo: 'bg-sky-500/10',
        texto: 'text-sky-600 dark:text-sky-400',
        encabezado: 'Es un problema de ARCA, no tuyo',
    },
    sistema: {
        borde: 'border-red-500/40',
        fondo: 'bg-red-500/10',
        texto: 'text-red-600 dark:text-red-400',
        encabezado: 'Es un problema nuestro',
    },
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/**
 * Mismo cálculo que `cuitEsValido` del server, replicado acá para dar feedback
 * mientras el usuario tipea. El server igual revalida: esto es comodidad, no
 * seguridad.
 */
function cuitValido(digitos: string): boolean {
    if (!/^\d{11}$/.test(digitos)) return false
    const d = digitos.split('').map(Number)
    const resto = PESOS_CUIT.reduce((acc, p, i) => acc + p * d[i], 0) % 11
    const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
    return verificador === d[10]
}

function soloDigitos(valor: string): string {
    return valor.replace(/\D/g, '').slice(0, 11)
}

function formatearCuit(digitos: string): string {
    if (digitos.length <= 2) return digitos
    if (digitos.length <= 10) return `${digitos.slice(0, 2)}-${digitos.slice(2)}`
    return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
}

/**
 * El alias lo arma el server como `barberos-<últimos 4 del CUIT>`. Lo replicamos
 * para poder mostrarlo (y mandárselo al contador) después de recargar la página,
 * cuando ya no tenemos el resultado de `generarPedidoCertificado` en memoria.
 */
function aliasProbable(cuit: string): string {
    return `barberos-${cuit.slice(-4)}`
}

function fechaLarga(iso: string): string {
    return new Date(iso).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    })
}

function fechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function nombreCondicion(c: CondicionIvaEmisor): string {
    return CONDICIONES.find((x) => x.valor === c)?.etiqueta ?? 'Monotributo'
}

/**
 * Firma de los datos fiscales que vinieron del server. Se usa como `key` del
 * formulario del paso 1: si el server trae otra cosa, el formulario se remonta y
 * se resiembra; si trae lo mismo, no se toca lo que el usuario está tipeando.
 */
function firmaFiscal(c: ContribuyenteVista | null): string {
    if (!c) return 'sin-contribuyente'
    return [
        c.id,
        c.cuit,
        c.razonSocial ?? '',
        c.condicionIva,
        c.ambiente,
        c.domicilioComercial ?? '',
        c.ingresosBrutos ?? '',
        c.inicioActividades ?? '',
    ].join('|')
}

async function copiar(texto: string, mensaje: string) {
    try {
        await navigator.clipboard.writeText(texto)
        toast.success(mensaje)
    } catch {
        toast.error('No pudimos copiar. Seleccioná el texto y copialo a mano.')
    }
}

// -----------------------------------------------------------------------------
// Piezas visuales chicas
// -----------------------------------------------------------------------------

function PillEstado({ estado }: { estado: EstadoPaso }) {
    const m = ESTILO_ESTADO[estado]
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                m.fondo,
                m.borde,
                m.texto,
            )}
        >
            {estado === 'listo' && <Check className="size-3" />}
            {estado === 'error' && <AlertTriangle className="size-3" />}
            {m.etiqueta}
        </span>
    )
}

function Instruccion({ n, children }: { n: number; children: ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-black text-primary">
                {n}
            </span>
            <span className="min-w-0 flex-1 text-sm leading-relaxed">{children}</span>
        </li>
    )
}

/** Camino dentro del portal de ARCA. Se resalta para que se pueda seguir clic a clic. */
function Ruta({ children }: { children: ReactNode }) {
    return (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold text-foreground">
            {children}
        </span>
    )
}

function EnlaceArca({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
        >
            {children}
            <ExternalLink className="size-3.5" />
        </a>
    )
}

function BloqueCopiable({
    etiqueta,
    valor,
    mensaje,
    mono = true,
}: {
    etiqueta: string
    valor: string
    mensaje: string
    mono?: boolean
}) {
    return (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {etiqueta}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
                <code
                    className={cn(
                        'min-w-0 flex-1 truncate text-sm font-semibold text-foreground',
                        mono && 'font-mono',
                    )}
                >
                    {valor}
                </code>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copiar(valor, mensaje)}
                >
                    <Copy className="size-3.5" /> Copiar
                </Button>
            </div>
        </div>
    )
}

function TarjetaDiagnostico({ d }: { d: ErrorTraducido }) {
    const t = TONO_CULPA[d.culpa]
    return (
        <div className={cn('rounded-xl border p-4', t.borde, t.fondo)}>
            <p className={cn('text-[11px] font-bold uppercase tracking-wider', t.texto)}>
                {t.encabezado}
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">{d.titulo}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.detalle}</p>
            {d.accion && (
                <p className="mt-2.5 border-l-2 border-current/30 pl-3 text-sm leading-relaxed text-foreground">
                    {d.accion}
                </p>
            )}
            <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                    Detalle técnico (para soporte)
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`código: ${d.codigo}
origen: ${d.culpa}
reintentable: ${d.reintentable ? 'sí' : 'no'}`}
                </pre>
            </details>
        </div>
    )
}

function TarjetaPaso({
    numero,
    titulo,
    resumen,
    icono: Icono,
    estado,
    abierto,
    onToggle,
    children,
}: {
    numero: number
    titulo: string
    resumen: string
    icono: ComponentType<{ className?: string }>
    estado: EstadoPaso
    abierto: boolean
    onToggle: () => void
    children: ReactNode
}) {
    const m = ESTILO_ESTADO[estado]
    return (
        <div
            className={cn(
                'overflow-hidden rounded-xl border bg-card transition-colors',
                abierto ? 'border-primary/40 shadow-sm' : 'border-border',
            )}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={abierto}
                className="flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-muted/40 sm:p-5"
            >
                <span
                    className={cn(
                        'grid size-11 shrink-0 place-items-center rounded-lg border',
                        m.fondo,
                        m.borde,
                        m.texto,
                    )}
                >
                    {estado === 'listo' ? (
                        <CheckCircle2 className="size-5" />
                    ) : (
                        <Icono className="size-5" />
                    )}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Paso {numero}
                        </span>
                        <PillEstado estado={estado} />
                    </span>
                    <span className="mt-1 block text-base font-bold leading-tight text-foreground">
                        {titulo}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                        {resumen}
                    </span>
                </span>
                <ChevronDown
                    className={cn(
                        'mt-1 size-5 shrink-0 text-muted-foreground transition-transform',
                        abierto && 'rotate-180',
                    )}
                />
            </button>
            {abierto && (
                <div className="border-t border-border px-4 pb-6 pt-5 sm:px-5">{children}</div>
            )}
        </div>
    )
}

// =============================================================================
// PASO 1 — Datos fiscales
// =============================================================================

function PasoDatosFiscales({
    c,
    deshabilitado,
    onGuardado,
}: {
    c: ContribuyenteVista | null
    deshabilitado: boolean
    onGuardado: () => void
}) {
    const [cuit, setCuit] = useState(() => c?.cuit ?? '')
    const [razonSocial, setRazonSocial] = useState(() => c?.razonSocial ?? '')
    const [condicion, setCondicion] = useState<CondicionIvaEmisor>(
        () => c?.condicionIva ?? 'monotributo',
    )
    const [ambiente, setAmbiente] = useState<AmbienteArca>(() => c?.ambiente ?? 'homologacion')
    const [domicilio, setDomicilio] = useState(() => c?.domicilioComercial ?? '')
    const [iibb, setIibb] = useState(() => c?.ingresosBrutos ?? '')
    const [inicio, setInicio] = useState(() => (c?.inicioActividades ?? '').slice(0, 10))
    const [verOpcionales, setVerOpcionales] = useState(false)
    const [guardando, setGuardando] = useState(false)

    // Ojo: el formulario NO se resincroniza solo con la prop. Cuando el server
    // trae otra fila, el padre remonta este componente con `key={firmaFiscal(c)}`
    // y los estados se vuelven a sembrar desde cero. Es la forma barata de no
    // pisarle lo que está tipeando a alguien cada vez que el padre refresca.
    const cuitOk = cuitValido(cuit)
    const infoCondicion = CONDICIONES.find((x) => x.valor === condicion)!
    const cambiaAmbiente = !!c && c.ambiente !== ambiente
    const puedeGuardar = cuitOk && razonSocial.trim().length >= 2 && !deshabilitado && !guardando

    const ayudaCuit = !cuit
        ? 'Escribí los 11 números. Los guiones los ponemos nosotros.'
        : cuit.length < 11
            ? `Faltan ${11 - cuit.length} ${11 - cuit.length === 1 ? 'dígito' : 'dígitos'}.`
            : cuitOk
                ? 'El CUIT verifica bien.'
                : 'Ese CUIT no cierra: el último dígito no corresponde. Revisá que esté bien tipeado.'

    async function guardar() {
        if (!cuitOk) {
            toast.error('Revisá el CUIT antes de guardar: el dígito verificador no cierra.')
            return
        }
        setGuardando(true)
        const r = await guardarDatosFiscales({
            cuit,
            razonSocial: razonSocial.trim(),
            condicionIva: condicion,
            ambiente,
            // Si ya venía en modo delegación no se lo pisamos: eso lo define
            // cómo se autentica la org, no este formulario.
            modoAuth: c?.modoAuth ?? 'certificado_propio',
            domicilioComercial: domicilio.trim() || undefined,
            inicioActividades: inicio || undefined,
            ingresosBrutos: iibb.trim() || undefined,
        })
        setGuardando(false)
        if ('error' in r) {
            toast.error(r.error)
            return
        }
        toast.success('Datos fiscales guardados.')
        onGuardado()
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
                <div>
                    <Label htmlFor="arca-cuit">CUIT</Label>
                    <div className="relative mt-1.5">
                        <Input
                            id="arca-cuit"
                            value={formatearCuit(cuit)}
                            onChange={(e) => setCuit(soloDigitos(e.target.value))}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="20-12345678-3"
                            disabled={deshabilitado}
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
                    <Label htmlFor="arca-razon">Razón social</Label>
                    <Input
                        id="arca-razon"
                        value={razonSocial}
                        onChange={(e) => setRazonSocial(e.target.value)}
                        placeholder="Como figura en ARCA"
                        autoComplete="off"
                        disabled={deshabilitado}
                        className="mt-1.5"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        Es el nombre que va a salir impreso en cada factura.
                    </p>
                </div>
            </div>

            <div>
                <Label htmlFor="arca-condicion">Condición frente al IVA</Label>
                <Select
                    value={condicion}
                    onValueChange={(v) => setCondicion(v as CondicionIvaEmisor)}
                    disabled={deshabilitado}
                >
                    <SelectTrigger id="arca-condicion" className="mt-1.5 w-full sm:max-w-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CONDICIONES.map((x) => (
                            <SelectItem key={x.valor} value={x.valor}>
                                {x.etiqueta}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="mt-3 flex gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">{infoCondicion.emite}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {infoCondicion.detalle}
                        </p>
                    </div>
                </div>
            </div>

            <div>
                <p className="text-sm font-semibold text-foreground">¿Dónde vas a facturar?</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {AMBIENTES.map((a) => {
                        const activo = ambiente === a.valor
                        return (
                            <button
                                key={a.valor}
                                type="button"
                                disabled={deshabilitado}
                                onClick={() => setAmbiente(a.valor)}
                                className={cn(
                                    'rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    activo
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                        : 'border-border bg-card hover:bg-muted/40',
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            'grid size-4 place-items-center rounded-full border',
                                            activo ? 'border-primary bg-primary' : 'border-muted-foreground/50',
                                        )}
                                    >
                                        {activo && <Check className="size-3 text-primary-foreground" />}
                                    </span>
                                    <span className="text-sm font-bold text-foreground">{a.titulo}</span>
                                </span>
                                <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                                    {a.detalle}
                                </span>
                            </button>
                        )
                    })}
                </div>
                {cambiaAmbiente && (
                    <div className="mt-3 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <p className="text-sm leading-relaxed text-foreground">
                            Cada ambiente lleva su propio certificado: el de pruebas no sirve en producción ni al
                            revés. Si cambiás, vas a tener que generar el pedido y hacer el trámite otra vez.
                        </p>
                    </div>
                )}
            </div>

            <div>
                <button
                    type="button"
                    onClick={() => setVerOpcionales((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                    <ChevronDown className={cn('size-4 transition-transform', verOpcionales && 'rotate-180')} />
                    Datos opcionales (domicilio, ingresos brutos, inicio de actividades)
                </button>
                {verOpcionales && (
                    <div className="mt-4 grid gap-5 sm:grid-cols-3">
                        <div>
                            <Label htmlFor="arca-domicilio">Domicilio comercial</Label>
                            <Input
                                id="arca-domicilio"
                                value={domicilio}
                                onChange={(e) => setDomicilio(e.target.value)}
                                placeholder="Av. Colón 1234"
                                disabled={deshabilitado}
                                className="mt-1.5"
                            />
                        </div>
                        <div>
                            <Label htmlFor="arca-iibb">Ingresos brutos</Label>
                            <Input
                                id="arca-iibb"
                                value={iibb}
                                onChange={(e) => setIibb(e.target.value)}
                                placeholder="Convenio multilateral / N° de inscripción"
                                disabled={deshabilitado}
                                className="mt-1.5"
                            />
                        </div>
                        <div>
                            <Label htmlFor="arca-inicio">Inicio de actividades</Label>
                            <Input
                                id="arca-inicio"
                                type="date"
                                value={inicio}
                                onChange={(e) => setInicio(e.target.value)}
                                disabled={deshabilitado}
                                className="mt-1.5"
                            />
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3">
                            Estos tres los pide ARCA sólo para algunos comprobantes. Si no los tenés a mano, seguí
                            sin ellos: los podés cargar después.
                        </p>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void guardar()} disabled={!puedeGuardar}>
                    {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {c ? 'Guardar cambios' : 'Guardar datos fiscales'}
                </Button>
                {c && (
                    <span className="text-xs text-muted-foreground">
                        Guardado como {nombreCondicion(c.condicionIva)} · emite {c.nombreTipoFactura}
                    </span>
                )}
            </div>
        </div>
    )
}

// =============================================================================
// PASO 2 — Certificado digital
// =============================================================================

function PasoCertificado({
    c,
    deshabilitado,
    faltaClave,
    onCargado,
}: {
    c: ContribuyenteVista | null
    deshabilitado: boolean
    faltaClave: boolean
    onCargado: () => void
}) {
    const [pedido, setPedido] = useState<{ csrPem: string; alias: string; nombreArchivo: string } | null>(null)
    const [generando, setGenerando] = useState(false)
    const [confirmandoNuevo, setConfirmandoNuevo] = useState(false)
    const [subiendo, setSubiendo] = useState(false)
    const [arrastrando, setArrastrando] = useState(false)
    const inputArchivo = useRef<HTMLInputElement>(null)

    if (!c) {
        return (
            <div className="flex gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-5">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                    <p className="text-sm font-bold text-foreground">Primero cargá los datos fiscales</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        El pedido de certificado se arma con tu CUIT y tu razón social, así que necesitamos el paso 1
                        completo para poder generarlo.
                    </p>
                </div>
            </div>
        )
    }

    // Rama corta: cuando la org opera por delegación no hay certificado propio,
    // hay una autorización que el dueño le da a la plataforma.
    if (c.modoAuth === 'delegacion') {
        return (
            <div className="space-y-4">
                <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
                    <UserIconoDelegacion />
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">
                            Tu organización factura con el certificado de la plataforma
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            No hace falta que generes ningún certificado. Lo único que tenés que hacer es autorizarnos
                            en ARCA para emitir a tu nombre.
                        </p>
                    </div>
                </div>
                <ol className="space-y-3">
                    <Instruccion n={1}>
                        Entrá a <EnlaceArca href={PORTAL_ARCA.login}>ARCA con tu clave fiscal</EnlaceArca>.
                    </Instruccion>
                    <Instruccion n={2}>
                        Abrí <Ruta>Administrador de Relaciones de Clave Fiscal</Ruta> →{' '}
                        <Ruta>Nueva Relación</Ruta> → <Ruta>Buscar</Ruta> → <Ruta>ARCA</Ruta> →{' '}
                        <Ruta>WebServices</Ruta> → <Ruta>Facturación Electrónica</Ruta>.
                    </Instruccion>
                    <Instruccion n={3}>
                        Como representante elegí el CUIT de la plataforma que te pasamos por soporte y confirmá.
                    </Instruccion>
                </ol>
                <p className="text-sm text-muted-foreground">
                    <EnlaceArca href={PORTAL_ARCA.docDelegacion}>Guía oficial de delegación de web services</EnlaceArca>
                    . Cuando termines, probá la conexión en el paso 3.
                </p>
            </div>
        )
    }

    const alias = pedido?.alias ?? aliasProbable(c.cuit)
    const diasCert = c.certDiasParaVencer
    const bloqueado = deshabilitado || faltaClave

    function descargarCsr() {
        if (!pedido) return
        // La descarga se arma acá con un Blob: el CSR ya lo tenemos en memoria y
        // no hay ningún endpoint que sirva archivos.
        const blob = new Blob([pedido.csrPem], { type: 'application/pkcs10' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = pedido.nombreArchivo
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2_000)
    }

    async function generar() {
        setGenerando(true)
        const r = await generarPedidoCertificado()
        setGenerando(false)
        setConfirmandoNuevo(false)
        if ('error' in r) {
            toast.error(r.error)
            return
        }
        setPedido({ csrPem: r.csrPem, alias: r.alias, nombreArchivo: r.nombreArchivo })
        toast.success('Pedido generado. Descargalo y subilo a ARCA.')
        onCargado()
    }

    async function procesarPem(texto: string) {
        const pem = texto.trim()
        if (pem.includes('CERTIFICATE REQUEST')) {
            toast.error(
                'Ese es el pedido (.csr) que te dimos nosotros, no el certificado. Subí el .crt que descargaste de ARCA.',
            )
            return
        }
        if (!pem.includes('BEGIN CERTIFICATE')) {
            toast.error(
                'Ese archivo no es un certificado. Tiene que empezar con "-----BEGIN CERTIFICATE-----".',
            )
            return
        }
        setSubiendo(true)
        const r = await cargarCertificado(pem)
        setSubiendo(false)
        if ('error' in r) {
            toast.error(r.error)
            return
        }
        toast.success(`Certificado cargado. Vence el ${fechaLarga(r.vence)}.`)
        onCargado()
    }

    function leerArchivo(archivo: File) {
        const lector = new FileReader()
        lector.onerror = () => toast.error('No pudimos leer el archivo. Probá de nuevo.')
        lector.onload = () => void procesarPem(String(lector.result ?? ''))
        lector.readAsText(archivo)
    }

    return (
        <div className="space-y-6">
            <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">
                        Nosotros generamos el pedido. Vos sólo lo subís a ARCA y nos traés el certificado que te
                        devuelve.
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        Tu clave privada nunca sale de nuestro servidor: no la vas a tener que manejar, ni guardar, ni
                        mandar por mail.
                    </p>
                </div>
            </div>

            {faltaClave && (
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                    No podemos generar el pedido hasta que se cargue la clave de cifrado del servidor (ver el aviso de
                    arriba).
                </p>
            )}

            {/* --- 1. Generar el pedido --------------------------------------- */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    {confirmandoNuevo ? (
                        <>
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={() => void generar()}
                                disabled={bloqueado || generando}
                            >
                                {generando ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                                Sí, generar uno nuevo
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setConfirmandoNuevo(false)}>
                                Cancelar
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            onClick={() => (c.tieneCertificado ? setConfirmandoNuevo(true) : void generar())}
                            disabled={bloqueado || generando}
                        >
                            {generando ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                            {c.tieneCsr || c.tieneCertificado
                                ? 'Generar un pedido nuevo'
                                : 'Generar pedido de certificado'}
                        </Button>
                    )}
                    {pedido && (
                        <Button type="button" variant="outline" onClick={descargarCsr}>
                            <Download className="size-4" /> Descargar {pedido.nombreArchivo}
                        </Button>
                    )}
                </div>
                {confirmandoNuevo && (
                    <p className="text-sm leading-relaxed text-amber-600 dark:text-amber-400">
                        Generar un pedido nuevo deja sin efecto el certificado que ya tenés cargado: vas a tener que
                        hacer el trámite en ARCA otra vez. Hacelo sólo si el actual venció o no funciona.
                    </p>
                )}
                {!pedido && c.tieneCsr && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Ya generamos un pedido para el alias{' '}
                        <span className="font-mono font-semibold text-foreground">{alias}</span>. Si perdiste el
                        archivo, generá uno nuevo: el anterior deja de servir.
                    </p>
                )}
            </div>

            {/* --- 2. Los dos trámites en ARCA -------------------------------- */}
            <div className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5">
                <BloqueCopiable
                    etiqueta="Alias del certificado (te lo va a pedir ARCA)"
                    valor={alias}
                    mensaje="Alias copiado."
                />

                <div>
                    <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                        Trámite 1 · Sacar el certificado
                    </p>
                    <ol className="mt-3 space-y-3">
                        <Instruccion n={1}>
                            Entrá a <EnlaceArca href={PORTAL_ARCA.login}>ARCA con tu clave fiscal</EnlaceArca>.
                        </Instruccion>
                        <Instruccion n={2}>
                            Abrí <Ruta>Administración de Certificados Digitales</Ruta>.
                        </Instruccion>
                        <Instruccion n={3}>
                            Tocá <Ruta>Agregar Alias</Ruta>, poné el alias{' '}
                            <span className="font-mono font-semibold text-foreground">{alias}</span> y subí el archivo
                            .csr que descargaste acá arriba.
                        </Instruccion>
                        <Instruccion n={4}>
                            Entrá a <Ruta>Ver detalle</Ruta> y descargá el archivo <Ruta>.crt</Ruta>. Ese es el que nos
                            traés.
                        </Instruccion>
                    </ol>
                    {c.ambiente === 'homologacion' && (
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                            Estás en pruebas: el trámite se hace desde el{' '}
                            <EnlaceArca href={PORTAL_ARCA.wsassHomologacion}>WSASS de homologación</EnlaceArca>, no
                            desde el portal común.
                        </p>
                    )}
                </div>

                <div className="border-t border-border pt-5">
                    <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                        Trámite 2 · Autorizar el servicio
                    </p>
                    <ol className="mt-3 space-y-3">
                        <Instruccion n={1}>
                            En el mismo portal, abrí <Ruta>Administrador de Relaciones de Clave Fiscal</Ruta>.
                        </Instruccion>
                        <Instruccion n={2}>
                            <Ruta>Nueva Relación</Ruta> → <Ruta>Buscar</Ruta> → <Ruta>ARCA</Ruta> →{' '}
                            <Ruta>WebServices</Ruta> → <Ruta>Facturación Electrónica</Ruta>.
                        </Instruccion>
                        <Instruccion n={3}>
                            Como representante elegí el alias{' '}
                            <span className="font-mono font-semibold text-foreground">{alias}</span> y tocá{' '}
                            <Ruta>Confirmar</Ruta>.
                        </Instruccion>
                    </ol>
                    <div className="mt-3 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <p className="text-sm leading-relaxed text-foreground">
                            El servicio se llama exactamente <strong>Facturación Electrónica</strong>. En la lista
                            aparecen varios parecidos: el de exportación no sirve y es el error más común de este
                            paso.
                        </p>
                    </div>
                </div>

                <p className="text-sm text-muted-foreground">
                    <EnlaceArca href={PORTAL_ARCA.docCertificados}>Guía oficial de certificados de ARCA</EnlaceArca>
                </p>
            </div>

            {/* --- 3. Subir el .crt ------------------------------------------- */}
            <div>
                <p className="text-sm font-semibold text-foreground">Traeme el certificado (.crt)</p>
                <div
                    onDragOver={(e) => {
                        e.preventDefault()
                        if (!bloqueado) setArrastrando(true)
                    }}
                    onDragLeave={() => setArrastrando(false)}
                    onDrop={(e) => {
                        e.preventDefault()
                        setArrastrando(false)
                        if (bloqueado) return
                        const archivo = e.dataTransfer.files?.[0]
                        if (archivo) leerArchivo(archivo)
                    }}
                    className={cn(
                        'mt-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                        arrastrando ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
                        bloqueado && 'opacity-60',
                    )}
                >
                    {subiendo ? (
                        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Verificando el certificado…
                        </div>
                    ) : (
                        <>
                            <Upload className="mx-auto size-6 text-muted-foreground" />
                            <p className="mt-2 text-sm font-semibold text-foreground">
                                Arrastrá acá el archivo que descargaste de ARCA
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Antes de guardarlo verificamos que sea el que corresponde a tu pedido.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-3"
                                disabled={bloqueado}
                                onClick={() => inputArchivo.current?.click()}
                            >
                                Elegir archivo
                            </Button>
                            <input
                                ref={inputArchivo}
                                type="file"
                                accept=".crt,.pem,.cer,.txt"
                                className="hidden"
                                onChange={(e) => {
                                    const archivo = e.target.files?.[0]
                                    e.target.value = ''
                                    if (archivo) leerArchivo(archivo)
                                }}
                            />
                        </>
                    )}
                </div>
            </div>

            {/* --- 4. Estado del certificado cargado -------------------------- */}
            {c.tieneCertificado && c.certVence && (
                <div
                    className={cn(
                        'flex gap-3 rounded-xl border p-4',
                        diasCert !== null && diasCert < 0
                            ? 'border-red-500/40 bg-red-500/10'
                            : diasCert !== null && diasCert < 30
                                ? 'border-amber-500/40 bg-amber-500/10'
                                : 'border-emerald-500/30 bg-emerald-500/10',
                    )}
                >
                    <CalendarClock
                        className={cn(
                            'mt-0.5 size-4 shrink-0',
                            diasCert !== null && diasCert < 0
                                ? 'text-red-600 dark:text-red-400'
                                : diasCert !== null && diasCert < 30
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400',
                        )}
                    />
                    <div>
                        <p className="text-sm font-bold text-foreground">
                            {diasCert !== null && diasCert < 0
                                ? `El certificado venció el ${fechaLarga(c.certVence)}`
                                : `Certificado cargado, vence el ${fechaLarga(c.certVence)}`}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {diasCert === null
                                ? 'Ya está guardado y listo para usar.'
                                : diasCert < 0
                                    ? 'Generá un pedido nuevo y volvé a hacer el trámite: hasta entonces no se puede facturar.'
                                    : diasCert < 30
                                        ? `Quedan ${diasCert} días. Conviene renovarlo antes de que se venza para no quedarte sin facturar.`
                                        : `Quedan ${diasCert} días. Te vamos a avisar antes de que se venza.`}
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

/** Ícono del bloque de delegación, aparte para no ensuciar el JSX de arriba. */
function UserIconoDelegacion() {
    return <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}

// =============================================================================
// PASO 3 — Probar la conexión
// =============================================================================

function PasoConexion({
    c,
    deshabilitado,
    onVerificado,
}: {
    c: ContribuyenteVista | null
    deshabilitado: boolean
    onVerificado: (ok: boolean) => void
}) {
    const [probando, setProbando] = useState(false)
    const [resultado, setResultado] = useState<ResultadoVerificacion | null>(null)

    async function probar() {
        setProbando(true)
        const r = await verificarConexionArca()
        setProbando(false)

        if ('error' in r) {
            setResultado(r.data ?? null)
            toast.error(r.error)
            onVerificado(false)
            return
        }

        setResultado(r.data)
        if (r.data.ok) {
            toast.success('Conexión verificada. ARCA nos deja facturar con este CUIT.')
        } else {
            toast.warning('Nos conectamos con ARCA, pero todavía falta algo. Mirá el detalle abajo.')
        }
        onVerificado(r.data.ok)
    }

    const servidores = resultado?.servidores
    const tiles = servidores
        ? ([
              ['Aplicación', servidores.app],
              ['Base de datos', servidores.db],
              ['Autenticación', servidores.auth],
          ] as const)
        : []

    return (
        <div className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
                Esta prueba no emite nada ni gasta numeración. Le preguntamos a ARCA si está funcionando y si nos deja
                facturar en tu nombre. Es el paso que te dice si el trámite quedó bien hecho.
            </p>

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="button"
                    size="lg"
                    onClick={() => void probar()}
                    disabled={deshabilitado || probando || !c}
                >
                    {probando ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                    Probar conexión con ARCA
                </Button>
                {!c && (
                    <span className="text-sm text-muted-foreground">
                        Primero cargá los datos fiscales.
                    </span>
                )}
                {c?.ultimaVerificacion && !resultado && (
                    <span className="text-xs text-muted-foreground">
                        Última prueba: {fechaHora(c.ultimaVerificacion)} ·{' '}
                        {c.ultimaVerificacionOk ? 'salió bien' : 'falló'}
                    </span>
                )}
            </div>

            {/* Estado de los servidores de ARCA. Está primero a propósito: si ARCA
                está caída, el usuario tiene que saber que no es culpa suya. */}
            {servidores && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Servidores de ARCA
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {tiles.map(([etiqueta, valor]) => {
                            const ok = String(valor).toUpperCase() === 'OK'
                            return (
                                <div
                                    key={etiqueta}
                                    className={cn(
                                        'flex items-center gap-2.5 rounded-lg border p-3',
                                        ok
                                            ? 'border-emerald-500/30 bg-emerald-500/10'
                                            : 'border-amber-500/40 bg-amber-500/10',
                                    )}
                                >
                                    <Server
                                        className={cn(
                                            'size-4 shrink-0',
                                            ok
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-amber-600 dark:text-amber-400',
                                        )}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-muted-foreground">{etiqueta}</p>
                                        <p className="truncate text-sm font-bold text-foreground">{valor}</p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {servidores.todoOk
                            ? 'ARCA estaba funcionando bien cuando probamos.'
                            : 'ARCA tenía servicios caídos cuando probamos. No es tu configuración: probá de nuevo más tarde.'}
                    </p>
                </div>
            )}

            {/* Puntos de venta que devolvió ARCA. */}
            {resultado && resultado.puntosVenta.length > 0 && (
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Puntos de venta que tenés en ARCA
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {resultado.puntosVenta.map((pv) => (
                            <span
                                key={pv.numero}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                                    pv.utilizable
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                        : 'border-border bg-muted text-muted-foreground',
                                )}
                            >
                                {pv.utilizable ? <Check className="size-3.5" /> : <XCircle className="size-3.5" />}
                                N° {String(pv.numero).padStart(5, '0')}
                                <span className="font-normal">
                                    {pv.utilizable ? 'listo para facturar' : 'no se puede usar'}
                                </span>
                            </span>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Los que sirven quedaron guardados. Asignalos a cada sucursal en el paso 4.
                    </p>
                </div>
            )}

            {resultado?.diagnostico && <TarjetaDiagnostico d={resultado.diagnostico} />}

            {resultado?.ok && (
                <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                        <p className="text-sm font-bold text-foreground">ARCA nos deja facturar a tu nombre</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            El certificado y la autorización están bien. Ya podés asignar los puntos de venta.
                        </p>
                    </div>
                </div>
            )}

            {/* Sin prueba fresca pero con un fallo guardado: se muestra igual, para
                que el usuario no crea que todo está bien sólo porque no probó hoy. */}
            {!resultado && c?.ultimaVerificacion && !c.ultimaVerificacionOk && (
                <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                        <p className="text-sm font-bold text-foreground">La última prueba no salió bien</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {c.ultimoError ?? 'ARCA rechazó la conexión.'} Volvé a probar cuando hayas terminado los
                            trámites del paso 2.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

// =============================================================================
// PASO 4 — Puntos de venta
// =============================================================================

function PasoPuntosVenta({
    puntos,
    sucursales,
    deshabilitado,
    onAsignado,
}: {
    puntos: PuntoVentaVista[]
    sucursales: { id: string; name: string }[]
    deshabilitado: boolean
    onAsignado: () => void
}) {
    const [guardandoId, setGuardandoId] = useState<string | null>(null)

    async function asignar(pv: PuntoVentaVista, valor: string) {
        const branchId = valor === CLAVE_TODAS ? null : valor
        setGuardandoId(pv.id)
        const r = await asignarPuntoVenta(pv.id, branchId)
        setGuardandoId(null)
        if ('error' in r) {
            toast.error(r.error)
            return
        }
        const numero = String(pv.numero).padStart(5, '0')
        toast.success(
            branchId
                ? `El punto de venta ${numero} factura para ${sucursales.find((s) => s.id === branchId)?.name ?? 'la sucursal'}.`
                : `El punto de venta ${numero} queda para todas las sucursales.`,
        )
        onAsignado()
    }

    if (!puntos.length) {
        return (
            <div className="space-y-4">
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
                    <Store className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-2 text-sm font-bold text-foreground">Todavía no hay puntos de venta</p>
                    <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
                        Los traemos solos de ARCA cuando probás la conexión en el paso 3. Si ahí no aparece ninguno,
                        primero hay que darlo de alta.
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                    <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                        Cómo dar de alta un punto de venta
                    </p>
                    <ol className="mt-3 space-y-3">
                        <Instruccion n={1}>
                            En <EnlaceArca href={PORTAL_ARCA.portal}>el portal de ARCA</EnlaceArca>, abrí{' '}
                            <Ruta>Administración de puntos de venta y domicilios</Ruta>.
                        </Instruccion>
                        <Instruccion n={2}>
                            Hacé clic en el nombre de tu empresa → <Ruta>A/B/M de puntos de venta</Ruta> →{' '}
                            <Ruta>Agregar</Ruta>.
                        </Instruccion>
                        <Instruccion n={3}>
                            Elegí el sistema de <strong>Web Services</strong> que corresponde a tu condición fiscal.
                            No sirve el de &quot;Comprobantes en línea&quot;.
                        </Instruccion>
                        <Instruccion n={4}>
                            Usá un punto de venta nuevo, sin ventas previas: así la numeración arranca de cero y no se
                            pisa con nada.
                        </Instruccion>
                    </ol>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
                Cada sucursal factura con su propio punto de venta y lleva su propia numeración, así los comprobantes
                nunca se pisan entre locales.
            </p>

            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <tr>
                            <th className="px-4 py-2.5 font-bold">Punto de venta</th>
                            <th className="px-4 py-2.5 font-bold">Factura para</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {puntos.map((pv) => (
                            <tr key={pv.id} className="align-middle">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2.5">
                                        <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                                            N° {String(pv.numero).padStart(5, '0')}
                                        </span>
                                        {!pv.activo && (
                                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                                inactivo
                                            </span>
                                        )}
                                    </div>
                                    {pv.descripcion && (
                                        <p className="mt-0.5 text-xs text-muted-foreground">{pv.descripcion}</p>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={pv.branchId ?? CLAVE_TODAS}
                                            onValueChange={(v) => void asignar(pv, v)}
                                            disabled={deshabilitado || guardandoId === pv.id}
                                        >
                                            <SelectTrigger className="w-full sm:w-64">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={CLAVE_TODAS}>Todas las sucursales</SelectItem>
                                                {sucursales.map((s) => (
                                                    <SelectItem key={s.id} value={s.id}>
                                                        {s.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {guardandoId === pv.id && (
                                            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
                Si dejás un punto de venta en &quot;Todas las sucursales&quot;, se usa como comodín cuando la sucursal
                que cobró no tiene uno propio.
            </p>
        </div>
    )
}

// =============================================================================
// Componente principal
// =============================================================================

export function WizardConfiguracion({ estado, puedeConfigurar, onRefrescar }: WizardConfiguracionProps) {
    const c = estado.contribuyente
    const delegacion = c?.modoAuth === 'delegacion'
    const deshabilitado = !puedeConfigurar

    const porClave = useMemo(
        () => new Map(estado.checklist.map((i) => [i.clave, i])),
        [estado.checklist],
    )

    // Los items 'informativo' no cuentan para el progreso: son avisos, no tareas.
    const contables = useMemo(
        () => estado.checklist.filter((i) => i.estado !== 'informativo'),
        [estado.checklist],
    )
    const listos = contables.filter((i) => i.estado === 'listo').length
    const total = Math.max(contables.length, 1)
    const completo = contables.length > 0 && listos === contables.length
    const pasoActual = Math.min(listos + 1, total)

    const claveCert = delegacion ? 'delegacion' : 'certificado'
    const estadoDe = (clave: string): EstadoPaso => porClave.get(clave)?.estado ?? 'pendiente'
    const resumenDe = (clave: string, porDefecto: string): string =>
        porClave.get(clave)?.detalle ?? porDefecto

    const [abierto, setAbierto] = useState<IdPaso | null>(() => {
        const est = (clave: string) =>
            estado.checklist.find((i) => i.clave === clave)?.estado ?? 'pendiente'
        const cert = estado.contribuyente?.modoAuth === 'delegacion' ? 'delegacion' : 'certificado'
        if (est('datos_fiscales') !== 'listo') return 'datos'
        if (est(cert) !== 'listo') return 'certificado'
        if (est('conexion') !== 'listo') return 'conexion'
        if (est('punto_venta') !== 'listo') return 'puntos'
        return null
    })

    const alias = c ? aliasProbable(c.cuit) : ''

    function toggle(id: IdPaso) {
        setAbierto((prev) => (prev === id ? null : id))
    }

    /** Texto listo para pegarle a un contador por WhatsApp. */
    function textoParaContador(): string {
        const cuitFmt = c ? formatearCuit(c.cuit) : '(falta cargar el CUIT)'
        return [
            'Hola, necesito habilitar la facturación electrónica por web service (WSFEv1) para este CUIT:',
            '',
            `CUIT: ${cuitFmt}`,
            `Razón social: ${c?.razonSocial ?? '(falta)'}`,
            `Condición frente al IVA: ${c ? nombreCondicion(c.condicionIva) : '(falta)'}`,
            `Ambiente: ${c?.ambiente === 'produccion' ? 'Producción' : 'Pruebas (homologación)'}`,
            `Alias del certificado: ${alias || '(se genera desde el sistema)'}`,
            '',
            'Son tres trámites en el portal de ARCA:',
            '',
            '1) Certificado digital',
            '   - Entrar a ARCA con clave fiscal → Administración de Certificados Digitales',
            `   - Agregar Alias → alias: ${alias} → subir el archivo .csr que te paso aparte`,
            '   - Ver detalle → Descargar el .crt y mandármelo',
            '',
            '2) Autorizar el servicio',
            '   - Administrador de Relaciones de Clave Fiscal → Nueva Relación → Buscar → ARCA → WebServices → Facturación Electrónica',
            `   - Elegir como representante el alias ${alias} → Confirmar`,
            '   - OJO: es "Facturación Electrónica". El de exportación no sirve.',
            '',
            '3) Punto de venta',
            '   - Administración de puntos de venta y domicilios → A/B/M de puntos de venta → Agregar',
            '   - Tiene que ser un punto de venta NUEVO, habilitado para Web Services (no "Comprobantes en línea").',
            '',
            `Guía oficial de certificados: ${PORTAL_ARCA.docCertificados}`,
            `Portal de ARCA: ${PORTAL_ARCA.portal}`,
        ].join('\n')
    }

    return (
        <div className="space-y-6">
            {/* --- Falta la clave de cifrado: bloqueante --------------------- */}
            {estado.faltaClaveDeCifrado && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 sm:p-5">
                    <div className="flex gap-3">
                        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-foreground">
                                Falta la clave de cifrado del facturador
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                Sin ella no podemos guardar tu certificado de forma segura, así que el facturador no
                                se puede terminar de configurar. Esto lo resuelve quien administra el sistema: la
                                clave vive en Supabase Vault con el nombre{' '}
                                <code className="font-mono">arca_encryption_key</code> y la crea la migración 179.
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                Si la migración ya se aplicó y este aviso sigue, revisá que el secreto exista en
                                Vault y que la app esté usando la service role key correcta.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* --- No pudimos leer la configuración -------------------------- */}
            {estado.error && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
                    <div className="flex gap-3">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                        <div>
                            <p className="text-sm font-bold text-foreground">{estado.error}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Lo que ves abajo puede estar incompleto. Probá de nuevo en un momento.
                            </p>
                        </div>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={onRefrescar}>
                        <RefreshCw className="size-3.5" /> Reintentar
                    </Button>
                </div>
            )}

            {/* --- Sin permiso ---------------------------------------------- */}
            {!puedeConfigurar && (
                <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Podés ver cómo está la configuración, pero no cambiarla. Pedile a un administrador de tu
                        organización que complete los pasos que falten.
                    </p>
                </div>
            )}

            {/* --- Encabezado con progreso ---------------------------------- */}
            <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
                            Configurá tu facturación
                        </h2>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            Son cuatro pasos. Dos de ellos se hacen en el portal de ARCA, así que podés cerrar esta
                            pantalla y volver cuando los termines: acá queda todo guardado.
                        </p>
                    </div>
                    <div className="shrink-0 text-right">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            {completo ? 'Estado' : 'Progreso'}
                        </p>
                        <p className="text-lg font-black tabular-nums text-foreground">
                            {completo ? 'Todo listo' : `Paso ${pasoActual} de ${total}`}
                        </p>
                    </div>
                </div>

                <div className="mt-3 flex gap-1.5">
                    {contables.map((i) => (
                        <div
                            key={i.clave}
                            title={`${i.titulo}: ${ESTILO_ESTADO[i.estado].etiqueta}`}
                            className={cn(
                                'h-2 flex-1 rounded-full transition-colors',
                                i.estado === 'listo'
                                    ? 'bg-emerald-500'
                                    : i.estado === 'error'
                                        ? 'bg-red-500'
                                        : 'bg-muted',
                            )}
                        />
                    ))}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-xs text-muted-foreground">
                        {listos} de {contables.length} listos
                        {!completo && ' · lo que falta está marcado abajo'}
                    </p>
                    {c?.ambiente === 'homologacion' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                            <Info className="size-3" /> Ambiente de pruebas: los comprobantes no tienen validez fiscal
                        </span>
                    )}
                </div>
            </div>

            {/* --- Pasos ---------------------------------------------------- */}
            <div className="space-y-3">
                <TarjetaPaso
                    numero={1}
                    titulo="Datos fiscales"
                    resumen={resumenDe('datos_fiscales', 'Cargá tu CUIT y tu condición frente al IVA.')}
                    icono={Building2}
                    estado={estadoDe('datos_fiscales')}
                    abierto={abierto === 'datos'}
                    onToggle={() => toggle('datos')}
                >
                    <PasoDatosFiscales
                        key={firmaFiscal(c)}
                        c={c}
                        deshabilitado={deshabilitado}
                        onGuardado={() => {
                            onRefrescar()
                            setAbierto('certificado')
                        }}
                    />
                </TarjetaPaso>

                <TarjetaPaso
                    numero={2}
                    titulo={delegacion ? 'Autorización en ARCA' : 'Certificado digital'}
                    resumen={resumenDe(
                        claveCert,
                        delegacion
                            ? 'Autorizá a la plataforma para facturar a tu nombre.'
                            : 'Generamos el pedido, vos hacés el trámite y nos traés el certificado.',
                    )}
                    icono={ShieldCheck}
                    estado={estadoDe(claveCert)}
                    abierto={abierto === 'certificado'}
                    onToggle={() => toggle('certificado')}
                >
                    <PasoCertificado
                        c={c}
                        deshabilitado={deshabilitado}
                        faltaClave={estado.faltaClaveDeCifrado}
                        onCargado={onRefrescar}
                    />
                </TarjetaPaso>

                <TarjetaPaso
                    numero={3}
                    titulo="Probar la conexión"
                    resumen={resumenDe('conexion', 'Verificá que ARCA te reconozca antes de emitir la primera factura.')}
                    icono={PlugZap}
                    estado={estadoDe('conexion')}
                    abierto={abierto === 'conexion'}
                    onToggle={() => toggle('conexion')}
                >
                    <PasoConexion
                        c={c}
                        deshabilitado={deshabilitado}
                        onVerificado={(ok) => {
                            onRefrescar()
                            if (ok) setAbierto('puntos')
                        }}
                    />
                </TarjetaPaso>

                <TarjetaPaso
                    numero={4}
                    titulo="Puntos de venta"
                    resumen={resumenDe('punto_venta', 'Asigná qué punto de venta factura para cada sucursal.')}
                    icono={Store}
                    estado={estadoDe('punto_venta')}
                    abierto={abierto === 'puntos'}
                    onToggle={() => toggle('puntos')}
                >
                    <PasoPuntosVenta
                        puntos={estado.puntosVenta}
                        sucursales={estado.sucursales}
                        deshabilitado={deshabilitado}
                        onAsignado={onRefrescar}
                    />
                </TarjetaPaso>
            </div>

            {/* --- Todo listo ----------------------------------------------- */}
            {completo && (
                <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:p-5">
                    <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                        <p className="text-sm font-black text-foreground">La configuración está completa</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {c?.ambiente === 'homologacion'
                                ? 'Estás en pruebas: emitÍ un par de comprobantes para ver el circuito completo y, cuando estés conforme, pasá el ambiente a producción.'
                                : 'Ya podés emitir comprobantes fiscales. Definí qué se factura desde la pestaña de cupo.'}
                        </p>
                    </div>
                </div>
            )}

            {/* --- Ayuda: mandárselo al contador ---------------------------- */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                        <MessageSquare className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">¿Esto lo hace tu contador?</p>
                            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                                Copiá las instrucciones completas con tu CUIT y el alias del certificado, y mandáselas
                                por donde te quede más cómodo. El único archivo que le tenés que pasar aparte es el
                                .csr que descargás en el paso 2.
                            </p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            void copiar(
                                textoParaContador(),
                                'Instrucciones copiadas. Pegáselas a tu contador.',
                            )
                        }
                    >
                        <Copy className="size-4" /> Copiar instrucciones
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default WizardConfiguracion
