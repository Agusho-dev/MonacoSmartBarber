'use client'

// =============================================================================
// "Seña y cobros online" — la tarjeta que conecta Mercado Pago, una por sucursal.
//
// Es lo primero que el dueño toca de toda la feature, y por eso la pantalla
// está escrita alrededor de una sola pregunta: ¿esta sucursal puede cobrar hoy?
// La respuesta se ve sin abrir nada.
//
// Dos caminos deliberadamente asimétricos: "Conectar Mercado Pago" (OAuth) es
// el principal y es un botón grande; "pegar credenciales a mano" está plegado,
// porque es el camino que exige entender qué es un access token y en el que se
// equivocan pegando la public key. El manual no se esconde: hace falta para el
// ambiente de prueba y para una cuenta que no quiera dar autorización.
//
// El nombre de la cuenta se muestra SIEMPRE que esté conectada. Con cuatro
// sucursales y cuatro cuentas distintas, "conectada" a secas no alcanza: el
// error caro es autorizar dos sucursales con la misma cuenta y descubrirlo
// cuando la plata de Paraná aparece en el Mercado Pago de Caseros.
// =============================================================================

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    Copy,
    ExternalLink,
    Link2Off,
    Loader2,
    Plug,
    PlugZap,
    RefreshCw,
    ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { ProveedorListado } from '@/lib/actions/senas'
import {
    desconectarMercadoPago,
    guardarCredencialesManuales,
    iniciarConexionMercadoPago,
    probarConexionMercadoPago,
} from '@/app/dashboard/turnos/configuracion/actions'

interface Props {
    /** Una fila por sucursal accesible, conectada o no (`estadoProveedores`). */
    proveedores: ProveedorListado[]
    /** ¿La plataforma tiene cargada su aplicación de Mercado Pago? */
    oauthDisponible: boolean
    /** Base pública fija: la misma con la que se arman las URLs que ve MP. */
    urlBase: string
    /** Se muestra sólo esta sucursal (la que está en pantalla). Null = todas. */
    soloSucursalId?: string | null
    /**
     * `senas.manage`. Sin él la tarjeta es de sólo lectura: conectar o
     * desconectar una cuenta de cobro es otra decisión que mirarla, y ofrecer
     * botones que el servidor va a rechazar es peor que no ofrecerlos.
     */
    puedeConfigurar: boolean
}

/**
 * Lo que el callback del OAuth puede reportar. Vuelve como un código corto en
 * la URL a propósito: el motivo largo se guarda en `last_error` de la fila, que
 * es donde se puede leer después. Un mensaje crudo de Mercado Pago en un query
 * param termina compartido en una captura de pantalla.
 */
const MOTIVOS: Record<string, string> = {
    sin_codigo: 'Mercado Pago volvió sin autorización. Si cancelaste la pantalla, probá de nuevo.',
    state_invalido:
        'El pedido de conexión venció o ya se había usado. Volvé a apretar "Conectar Mercado Pago".',
    no_autorizado: 'Tu sesión no tiene permiso para conectar cuentas de cobro en esta organización.',
    sin_app: 'Falta configurar la aplicación de Mercado Pago de la plataforma.',
    canje_fallido:
        'Mercado Pago rechazó la autorización. El motivo quedó guardado en la tarjeta de la sucursal.',
    guardado_fallido: 'La autorización salió bien pero no pudimos guardarla. Reintentá.',
}

export function CobrosOnline({
    proveedores,
    oauthDisponible,
    urlBase,
    soloSucursalId,
    puedeConfigurar,
}: Props) {
    const lista = soloSucursalId
        ? proveedores.filter(p => p.branch_id === soloSucursalId)
        : proveedores

    // El resultado del OAuth vuelve por la URL. Se avisa una sola vez y se
    // limpian los params: con `mp=ok` pegado en la barra, recargar la pantalla
    // volvería a cantar "cuenta conectada" para siempre.
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const avisado = useRef(false)
    const resultado = params.get('mp')
    const motivo = params.get('motivo')

    useEffect(() => {
        if (!resultado || avisado.current) return
        avisado.current = true
        if (resultado === 'ok') toast.success('Cuenta de Mercado Pago conectada')
        else toast.error(MOTIVOS[motivo ?? ''] ?? 'No pudimos conectar la cuenta de Mercado Pago.')

        const limpia = new URLSearchParams(params.toString())
        limpia.delete('mp')
        limpia.delete('motivo')
        const query = limpia.toString()
        router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
    }, [resultado, motivo, params, pathname, router])

    return (
        <Card id="seccion-cobros-online" className="scroll-mt-24">
            <CardHeader>
                <CardTitle className="text-base">Cobros online</CardTitle>
                <CardDescription>
                    La seña se cobra con Mercado Pago y entra a la cuenta de cada sucursal. Hay que conectar
                    una cuenta por local: la plata nunca pasa por nosotros.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {!oauthDisponible && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        <div className="text-xs leading-relaxed">
                            <p className="text-sm font-medium">La conexión con un clic todavía no está disponible</p>
                            <p className="mt-0.5 text-muted-foreground">
                                Falta cargar la aplicación de Mercado Pago de la plataforma (las variables{' '}
                                <code className="rounded bg-muted px-1 py-0.5">MERCADOPAGO_OAUTH_CLIENT_ID</code> y{' '}
                                <code className="rounded bg-muted px-1 py-0.5">MERCADOPAGO_OAUTH_CLIENT_SECRET</code>).
                                Mientras tanto se puede conectar cada cuenta pegando sus credenciales, que es igual de
                                válido y hace exactamente lo mismo.
                            </p>
                        </div>
                    </div>
                )}

                {lista.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No hay sucursales para configurar.
                    </p>
                ) : (
                    lista.map(p => (
                        <TarjetaSucursal
                            key={p.branch_id}
                            proveedor={p}
                            oauthDisponible={oauthDisponible && puedeConfigurar}
                            urlBase={urlBase}
                            puedeConfigurar={puedeConfigurar}
                        />
                    ))
                )}
            </CardContent>
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────

function TarjetaSucursal({
    proveedor,
    oauthDisponible,
    urlBase,
    puedeConfigurar,
}: {
    proveedor: ProveedorListado
    oauthDisponible: boolean
    urlBase: string
    puedeConfigurar: boolean
}) {
    const router = useRouter()
    const [pendiente, iniciar] = useTransition()
    const [accion, setAccion] = useState<'conectar' | 'probar' | 'manual' | null>(null)
    const [manualAbierto, setManualAbierto] = useState(false)
    const [confirmarDesconexion, setConfirmarDesconexion] = useState(false)

    const [accessToken, setAccessToken] = useState('')
    const [publicKey, setPublicKey] = useState('')
    const [webhookSecret, setWebhookSecret] = useState('')

    const conectado = proveedor.status === 'conectado'
    const conError = proveedor.status === 'error' || proveedor.status === 'revocado'
    const esPrueba = proveedor.environment === 'prueba' || proveedor.live_mode === false

    // La URL que hay que registrar en el panel de Mercado Pago para que la
    // cuenta emita el secreto de firma. Es la misma que la preferencia manda en
    // `notification_url` (que la pisa), pero MP no genera secreto hasta que hay
    // un webhook configurado.
    const urlWebhook = `${urlBase}/api/webhooks/mercadopago/senas?b=${proveedor.branch_id}`

    function conectar() {
        setAccion('conectar')
        iniciar(async () => {
            const r = await iniciarConexionMercadoPago(proveedor.branch_id, proveedor.environment)
            setAccion(null)
            if ('error' in r) {
                toast.error(r.error)
                return
            }
            // Navegación completa: nos vamos del dominio a Mercado Pago.
            window.location.href = r.url
        })
    }

    function probar() {
        setAccion('probar')
        iniciar(async () => {
            const r = await probarConexionMercadoPago(proveedor.branch_id, proveedor.environment)
            setAccion(null)
            if (r.ok) toast.success(`Conexión correcta${r.cuenta ? ` · cuenta ${r.cuenta}` : ''}`)
            else toast.error(r.error ?? 'No pudimos conectarnos con Mercado Pago.')
            router.refresh()
        })
    }

    function guardarManual() {
        if (!accessToken.trim()) {
            toast.error('Pegá el access token de Mercado Pago.')
            return
        }
        setAccion('manual')
        iniciar(async () => {
            const r = await guardarCredencialesManuales({
                branchId: proveedor.branch_id,
                ambiente: proveedor.environment,
                accessToken,
                publicKey,
                webhookSecret,
            })
            setAccion(null)
            if (!r.ok) {
                toast.error(r.error ?? 'No pudimos guardar las credenciales.')
                return
            }
            setAccessToken('')
            setPublicKey('')
            setWebhookSecret('')
            setManualAbierto(false)
            toast.success(`Cuenta conectada${r.cuenta ? ` · ${r.cuenta}` : ''}`)
            router.refresh()
        })
    }

    function desconectar() {
        iniciar(async () => {
            const r = await desconectarMercadoPago(proveedor.branch_id, proveedor.environment)
            if (!r.ok) {
                toast.error(r.error ?? 'No pudimos desconectar la cuenta.')
                return
            }
            if (r.error) toast.warning(r.error)
            else toast.success('Cuenta desconectada. La seña de esta sucursal quedó apagada.')
            router.refresh()
        })
    }

    return (
        <div
            className={cn(
                'rounded-xl border p-4',
                conectado && 'border-emerald-500/30 bg-emerald-500/5',
                conError && 'border-red-500/30 bg-red-500/5',
                !conectado && !conError && 'border-border bg-card/40',
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{proveedor.branch_name ?? 'Sucursal'}</p>
                        <EstadoConexion status={proveedor.status} />
                        {esPrueba && conectado && (
                            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                Ambiente de prueba
                            </span>
                        )}
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                        {conectado ? (
                            <>
                                Cobra en la cuenta <span className="font-mono text-foreground">{proveedor.mp_user_id ?? 'sin id'}</span>
                                {proveedor.connection_mode === 'oauth' ? ' (autorizada por Mercado Pago)' : ' (credenciales pegadas a mano)'}
                                {proveedor.connected_at ? ` · desde el ${fechaCorta(proveedor.connected_at)}` : ''}
                            </>
                        ) : (
                            'Todavía no puede cobrar señas. Conectá la cuenta de Mercado Pago de esta sucursal.'
                        )}
                    </p>

                    {conectado && proveedor.last_check_at && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Última verificación: {fechaCorta(proveedor.last_check_at)}
                        </p>
                    )}

                    {esPrueba && conectado && (
                        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                            Son credenciales de prueba: los pagos no son reales y la plata no entra a ninguna cuenta.
                        </p>
                    )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {oauthDisponible && (
                        <Button size="sm" onClick={conectar} disabled={pendiente}>
                            {pendiente && accion === 'conectar' ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                                <PlugZap className="mr-1.5 size-3.5" />
                            )}
                            {conectado ? 'Reconectar' : 'Conectar Mercado Pago'}
                        </Button>
                    )}
                    {conectado && (
                        <>
                            {/* "Probar conexión" alcanza con `senas.view`: no
                                cambia nada, sólo pregunta. */}
                            <Button size="sm" variant="outline" onClick={probar} disabled={pendiente}>
                                {pendiente && accion === 'probar' ? (
                                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="mr-1.5 size-3.5" />
                                )}
                                Probar conexión
                            </Button>
                            {puedeConfigurar && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmarDesconexion(true)}
                                    disabled={pendiente}
                                    className="text-muted-foreground"
                                >
                                    <Link2Off className="mr-1.5 size-3.5" />
                                    Desconectar
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {oauthDisponible && !conectado && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    Al apretar &ldquo;Conectar&rdquo; Mercado Pago va a pedir que inicies sesión:{' '}
                    <span className="font-medium text-foreground">
                        entrá con la cuenta de {proveedor.branch_name ?? 'esta sucursal'}
                    </span>
                    , no con la tuya personal ni con la de otro local.
                </p>
            )}

            {conError && proveedor.last_error && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {proveedor.status === 'revocado'
                            ? 'Mercado Pago dejó de aceptar estas credenciales'
                            : 'La última vez que hablamos con Mercado Pago falló'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-red-700/90 dark:text-red-300/90">
                        {proveedor.last_error}
                    </p>
                </div>
            )}

            {/* Camino secundario: pegar credenciales. Plegado a propósito. */}
            {puedeConfigurar && (
            <div className="mt-3 border-t border-border/60 pt-3">
                <button
                    type="button"
                    onClick={() => setManualAbierto(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ChevronDown className={cn('size-3.5 transition-transform', manualAbierto && 'rotate-180')} />
                    <Plug className="size-3.5" />
                    Pegar credenciales a mano
                </button>

                {manualAbierto && (
                    <div className="mt-3 space-y-3">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Entrá a Mercado Pago con la cuenta de {proveedor.branch_name ?? 'esta sucursal'} →{' '}
                            <span className="font-medium text-foreground">Tus integraciones</span> → tu aplicación →{' '}
                            <span className="font-medium text-foreground">Credenciales de producción</span>, y pegá acá el
                            access token. Guardamos el token cifrado; nunca vuelve a salir del servidor.
                        </p>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <Label htmlFor={`at-${proveedor.branch_id}`} className="text-xs">
                                    Access token
                                </Label>
                                <Input
                                    id={`at-${proveedor.branch_id}`}
                                    value={accessToken}
                                    onChange={e => setAccessToken(e.target.value)}
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="APP_USR-..."
                                    className="mt-1 font-mono text-xs"
                                />
                            </div>
                            <div>
                                <Label htmlFor={`pk-${proveedor.branch_id}`} className="text-xs">
                                    Public key <span className="font-normal text-muted-foreground">(opcional)</span>
                                </Label>
                                <Input
                                    id={`pk-${proveedor.branch_id}`}
                                    value={publicKey}
                                    onChange={e => setPublicKey(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="APP_USR-..."
                                    className="mt-1 font-mono text-xs"
                                />
                            </div>
                            <div>
                                <Label htmlFor={`ws-${proveedor.branch_id}`} className="text-xs">
                                    Secreto del webhook
                                </Label>
                                <Input
                                    id={`ws-${proveedor.branch_id}`}
                                    value={webhookSecret}
                                    onChange={e => setWebhookSecret(e.target.value)}
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="mt-1 font-mono text-xs"
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/40 p-3">
                            <p className="text-xs font-medium">
                                Sin el secreto del webhook, los pagos no se acreditan
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                Es lo que nos permite comprobar que el aviso de pago viene de Mercado Pago y no de
                                cualquiera. Se genera en <span className="font-medium text-foreground">Tus integraciones</span> →
                                tu aplicación → <span className="font-medium text-foreground">Webhooks</span>, registrando esta
                                URL de notificación:
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-[11px]">
                                    {urlWebhook}
                                </code>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="shrink-0"
                                    onClick={() => {
                                        navigator.clipboard
                                            ?.writeText(urlWebhook)
                                            .then(() => toast.success('URL copiada'))
                                            .catch(() => toast.error('No pudimos copiar la URL. Seleccionala a mano.'))
                                    }}
                                >
                                    <Copy className="size-3.5" />
                                    <span className="sr-only">Copiar URL del webhook</span>
                                </Button>
                            </div>
                            <a
                                href="https://www.mercadopago.com.ar/developers/panel/app"
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                                Abrir el panel de Mercado Pago
                                <ExternalLink className="size-3" />
                            </a>
                        </div>

                        <div className="flex justify-end">
                            <Button size="sm" onClick={guardarManual} disabled={pendiente}>
                                {pendiente && accion === 'manual' && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                                Guardar credenciales
                            </Button>
                        </div>
                    </div>
                )}
            </div>
            )}

            <AlertDialog open={confirmarDesconexion} onOpenChange={setConfirmarDesconexion}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            ¿Desconectar Mercado Pago de {proveedor.branch_name ?? 'esta sucursal'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Se borran las credenciales y la seña de esta sucursal queda apagada: los clientes van a poder
                            reservar sin pagar nada. Las señas ya cobradas no se tocan, pero tampoco vas a poder devolverlas
                            desde acá hasta reconectar la cuenta.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction onClick={desconectar}>Desconectar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

function EstadoConexion({ status }: { status: ProveedorListado['status'] }) {
    const mapa = {
        conectado: {
            texto: 'Conectada',
            clases: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            Icono: CheckCircle2,
        },
        desconectado: {
            texto: 'Sin conectar',
            clases: 'border-border bg-muted text-muted-foreground',
            Icono: Plug,
        },
        error: {
            texto: 'Con error',
            clases: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
            Icono: AlertTriangle,
        },
        revocado: {
            texto: 'Autorización revocada',
            clases: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
            Icono: ShieldAlert,
        },
    }[status]

    const Icono = mapa.Icono
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                mapa.clases,
            )}
        >
            <Icono className="size-3" />
            {mapa.texto}
        </span>
    )
}

function fechaCorta(iso: string): string {
    // `toLocaleString` fija el formato, no la zona: sin `timeZone` explícita el
    // servidor (UTC en Vercel) y el browser del dueño imprimen horas distintas
    // para el mismo evento.
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
    })
}
