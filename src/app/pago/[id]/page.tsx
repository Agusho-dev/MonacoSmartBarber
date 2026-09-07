/**
 * /pago/[id] — el puente de vuelta de Mercado Pago.
 *
 * POR QUÉ EXISTE ESTA PÁGINA
 * --------------------------
 * Mercado Pago exige que las `back_urls` sean https y descarta cualquier otra
 * cosa **en silencio**: no se le puede poner `monaco://`. Así que el checkout
 * vuelve acá, a una URL de verdad, y desde acá se rebota al deep link de la app.
 *
 * EL PARÁMETRO DEL DEEP LINK NO SE PUEDE LLAMAR `code`. `supabase_flutter`
 * intercepta cualquier deep link que traiga `code` y lo procesa como callback
 * de OAuth (`getSessionFromUrl`), lo que en el mejor caso lo consume sin llegar
 * a la app y en el peor rompe la sesión del cliente. Va como `?deposit=<id>`.
 *
 * LOS QUERY PARAMS DE MERCADO PAGO NO SON FUENTE DE VERDAD
 * --------------------------------------------------------
 * Al volver, MP agrega `?collection_status=approved&payment_id=…&status=…`.
 * Eso viaja por el browser del cliente, o sea que lo puede editar cualquiera
 * antes de apretar Enter: creerle sería regalar un turno confirmado por cambiar
 * una palabra en la barra de direcciones. El estado que se muestra acá sale
 * SIEMPRE de `booking_deposits`, que sólo escribe el webhook después de
 * preguntarle a la API de Mercado Pago con el token de la sucursal.
 *
 * Y el estado puede ser todavía `iniciada` legítimamente: el retorno del
 * checkout tarda hasta 40 segundos menos que la notificación. Por eso "todavía
 * estamos confirmando" es un desenlace normal de esta pantalla y no un error.
 */
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, Clock, Info, MapPin, XCircle } from 'lucide-react'

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { leerSena } from '@/lib/senas/repo'
import { motivoRechazo, type BookingDeposit } from '@/lib/senas/contrato'
import { buildTurneroTheme, themeVars } from '@/app/turnos/[slug]/theme'
import { fechaLargaDeStr } from '@/app/turnos/[slug]/fechas'

export const dynamic = 'force-dynamic'

export const metadata = {
    title: 'Tu seña · Monaco',
    // La página lleva datos de una reserva: no tiene por qué estar en Google.
    robots: { index: false, follow: false },
}

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const MONEDA = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
})

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se muestra en cada estado
// ─────────────────────────────────────────────────────────────────────────────

type Tono = 'exito' | 'espera' | 'aviso' | 'falla'

interface Desenlace {
    tono: Tono
    titulo: string
    detalle: string
    /** true mientras tenga sentido que el cliente refresque. */
    enCurso: boolean
}

/**
 * `pagada` NO significa "turno confirmado". Hay dos caminos que dejan la seña
 * pagada y `appointment_id` en NULL, y los dos son estados normales del motor:
 *
 *  · `createAppointment` falló por algo que no es falta de cupo (rate-limit,
 *    error de red): la seña queda `pagada` con `failure_reason` escrito y el
 *    caso se resuelve a mano desde el dashboard.
 *  · El cliente canceló a tiempo y la sucursal está configurada para dejar la
 *    seña como CRÉDITO (`refund_on_early_cancel = 'credito'`): se le suelta el
 *    turno y la plata le queda a favor. Es una opción, no el default: desde la
 *    mig 208 el default de la columna es `devolucion` y las cuatro sucursales
 *    están así, o sea que hoy este caso sólo aparece si alguien lo elige.
 *
 * Con el `case 'pagada'` colapsado, las dos situaciones imprimían "Turno
 * confirmado · tu turno quedó reservado" sobre un turno que no existe: la
 * primera manda al cliente a la barbería a un horario que nadie le guardó, y
 * la segunda le dice que sigue teniendo el turno que él mismo canceló.
 */
function desenlaceDe(sena: BookingDeposit): Desenlace {
    switch (sena.status) {
        case 'pagada':
            if (!sena.appointment_id) {
                return sena.refund_reason
                    ? {
                        tono: 'aviso',
                        titulo: 'La seña te quedó a favor',
                        detalle:
                            'Este turno está cancelado. Los ' + MONEDA.format(Number(sena.amount)) +
                            ' que pagaste te quedan a favor para tu próxima reserva: ' +
                            'avisanos cuando quieras usarlos.',
                        enCurso: false,
                    }
                    : {
                        tono: 'aviso',
                        titulo: 'Recibimos tu pago',
                        detalle:
                            'Nos falta terminar de armar el turno. Te confirmamos por WhatsApp ' +
                            'apenas esté; tu pago ya quedó registrado, no lo repitas. Si en un ' +
                            'rato no tenés novedades, escribinos y lo resolvemos.',
                        enCurso: false,
                    }
            }
            return {
                tono: 'exito',
                titulo: 'Turno confirmado',
                detalle: 'Recibimos la seña y tu turno quedó reservado. Te esperamos.',
                enCurso: false,
            }
        case 'consumida':
            return {
                tono: 'exito',
                titulo: 'Turno confirmado',
                detalle: 'Recibimos la seña y tu turno quedó reservado. Te esperamos.',
                enCurso: false,
            }
        case 'iniciada':
            return {
                tono: 'espera',
                titulo: 'Estamos confirmando el pago',
                detalle:
                    'Mercado Pago nos avisa en unos segundos. No hace falta que pagues de nuevo: ' +
                    'apenas se acredite, tu turno queda reservado.',
                enCurso: true,
            }
        case 'sin_cupo':
            return {
                tono: 'falla',
                titulo: 'Ese horario se ocupó',
                detalle:
                    'Alguien lo tomó justo antes que vos. Te devolvimos la seña a Mercado Pago ' +
                    '—puede tardar unos días en verse— y podés elegir otro horario.',
                enCurso: false,
            }
        case 'rechazada':
            return {
                tono: 'falla',
                titulo: 'El pago no se aprobó',
                detalle: motivoRechazo(sena.mp_status_detail),
                enCurso: false,
            }
        case 'expirada':
            return {
                tono: 'falla',
                titulo: 'El link de pago venció',
                detalle: 'No se cobró nada. Podés volver a reservar cuando quieras.',
                enCurso: false,
            }
        case 'cancelada':
            return {
                tono: 'falla',
                titulo: 'El pago quedó cancelado',
                detalle: 'No se cobró nada. Podés volver a reservar cuando quieras.',
                enCurso: false,
            }
        case 'devuelta':
            return {
                tono: 'falla',
                titulo: 'Seña devuelta',
                detalle:
                    'Te devolvimos la seña a Mercado Pago. Puede tardar unos días en verse ' +
                    'según el medio de pago que hayas usado.',
                enCurso: false,
            }
        case 'perdida':
            return {
                tono: 'falla',
                titulo: 'Seña no reintegrable',
                detalle: 'La seña quedó a favor del local por la cancelación fuera de término.',
                enCurso: false,
            }
        default:
            return {
                tono: 'espera',
                titulo: 'Estamos confirmando el pago',
                detalle: 'En unos segundos vas a ver el resultado.',
                enCurso: true,
            }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Datos
// ─────────────────────────────────────────────────────────────────────────────

interface Contexto {
    sucursal: string
    slug: string
    direccion: string | null
    barbero: string | null
    logo: string | null
    /** Colores de marca del turnero, para que esta pantalla no parezca de otra app. */
    marca: { bg?: string | null; primary?: string | null; text?: string | null }
}

/**
 * Lo lindo de la pantalla: nombre de la sucursal, del barbero, logo y colores.
 *
 * Es lo ÚNICO que se degrada en silencio si una lectura falla, y a propósito:
 * lo que el cliente necesita —fecha, hora, servicio, cuánto pagó y cuánto le
 * queda— viene entero en la fila de `booking_deposits`, que ya está leída. Un
 * glitch buscando el logo no puede dejarlo sin saber si tiene turno.
 */
async function leerContexto(sena: BookingDeposit): Promise<Contexto> {
    const supabase = createAdminClient()

    const [sucursal, barbero, org, settings] = await Promise.all([
        supabase.from('branches').select('name, slug, address').eq('id', sena.branch_id).maybeSingle(),
        sena.barber_id
            ? supabase.from('staff').select('full_name').eq('id', sena.barber_id).maybeSingle()
            : Promise.resolve({ data: null }),
        supabase.from('organizations').select('logo_url').eq('id', sena.organization_id).maybeSingle(),
        supabase
            .from('appointment_settings')
            .select('brand_bg_color, brand_primary_color, brand_text_color')
            .eq('branch_id', sena.branch_id)
            .maybeSingle(),
    ])

    const fila = (sucursal.data ?? null) as { name: string; slug: string; address: string | null } | null
    const b = (barbero.data ?? null) as { full_name: string | null } | null
    const o = (org.data ?? null) as { logo_url: string | null } | null
    const s = (settings.data ?? null) as {
        brand_bg_color: string | null
        brand_primary_color: string | null
        brand_text_color: string | null
    } | null

    return {
        sucursal: fila?.name ?? '',
        slug: fila?.slug ?? '',
        direccion: fila?.address ?? null,
        barbero: b?.full_name ?? null,
        logo: o?.logo_url ?? null,
        marca: {
            bg: s?.brand_bg_color,
            primary: s?.brand_primary_color,
            text: s?.brand_text_color,
        },
    }
}

/**
 * El único desenlace que NO sale de `booking_deposits`: no pudimos leerla.
 *
 * Va sin colores de marca (para leerlos habría que volver a consultar la base,
 * que es justo lo que acaba de fallar) y sin `notFound()`: decirle "no existe"
 * a alguien que acaba de pagar sería mentirle.
 */
function NoPudimosLeer() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-4 text-neutral-100">
            <main className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-7 text-center">
                <Info className="mx-auto mb-3 h-11 w-11 text-neutral-400" strokeWidth={1.5} />
                <h1 className="text-xl font-semibold tracking-tight">No pudimos leer el estado</h1>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                    Tu pago está registrado en Mercado Pago: no lo hagas de nuevo. Actualizá esta
                    página en un momento, o abrí la app para ver tu turno.
                </p>
            </main>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────

export default async function PaginaPago({
    params,
    searchParams,
}: {
    params: Params
    searchParams: SearchParams
}) {
    const { id } = await params
    if (!isValidUUID(id)) notFound()

    // Esta es la primera pantalla que ve alguien que acaba de pagar: una página
    // de error de Next acá se lee como "perdí la plata". Un fallo de lectura se
    // muestra como lo que es —"no pudimos leer", distinto de "no existe"— y con
    // la garantía de que el pago ya está registrado del lado de Mercado Pago.
    let sena: BookingDeposit | null
    try {
        sena = await leerSena(id)
    } catch (e) {
        console.error('[pago/[id]] no pudimos leer la seña:', e)
        return <NoPudimosLeer />
    }
    if (!sena) notFound()

    const sp = await searchParams
    // De dónde viene el cliente. El motor arma la `back_url` con
    // `?volver=app|web` (`crearIntencionDeSena`), y se acepta además `?w=1`
    // porque es la forma que se documentó primero y puede quedar viva en un
    // link viejo. Leer SÓLO una de las dos es un fallo silencioso y caro: con
    // `volver=web` sin reconocer, `desdeWeb` quedaba en false y **todo el que
    // pagaba desde el turnero web** era rebotado a `monaco://pago?deposit=…`
    // —una pantalla en blanco en cualquier browser sin la app instalada—
    // justo después de que le saliera la plata.
    const leer = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
    const desdeWeb = leer(sp.w) === '1' || leer(sp.volver) === 'web'

    const ctx = await leerContexto(sena)
    const desenlace = desenlaceDe(sena)
    const theme = buildTurneroTheme({
        bg: ctx.marca.bg ?? undefined,
        primary: ctx.marca.primary ?? undefined,
        text: ctx.marca.text ?? undefined,
    })

    const total = Number(sena.service_total)
    const monto = Number(sena.amount)
    const resto = Math.max(0, total - monto)
    const hora = sena.start_time.slice(0, 5)
    const deepLink = `monaco://pago?deposit=${encodeURIComponent(sena.id)}`

    const Icono =
        desenlace.tono === 'exito'
            ? CheckCircle2
            : desenlace.tono === 'espera'
                ? Clock
                : desenlace.tono === 'aviso'
                    ? Info
                    : XCircle
    const colorIcono =
        desenlace.tono === 'exito'
            ? 'var(--t-success-text)'
            : desenlace.tono === 'falla'
                ? 'var(--t-danger-text)'
                : 'var(--t-text-muted)'

    return (
        <div
            className="flex min-h-screen flex-col items-center justify-center bg-[var(--t-bg)] p-4 text-[var(--t-text)]"
            style={themeVars(theme)}
        >
            {/*
              El rebote a la app: primero el intento por JS (el que de verdad
              funciona en iOS y Android cuando la app está instalada) y además el
              meta refresh como red por si el script no corre. Los dos son
              inertes cuando el cliente vino del turnero web.

              El `<script>` va inline y sin componente cliente: son cuatro
              líneas y no justifican mandar un bundle de React al browser de
              alguien que acaba de pagar y sólo quiere volver a la app.
            */}
            {!desdeWeb && (
                <>
                    <meta httpEquiv="refresh" content={`0;url=${deepLink}`} />
                    <script
                        dangerouslySetInnerHTML={{
                            __html: `try{window.location.replace(${JSON.stringify(deepLink)})}catch(e){}`,
                        }}
                    />
                </>
            )}

            {/*
              En la web la pantalla se refresca sola mientras el pago está en
              curso. La app poletea el estado cada 3 segundos; sin esto, la web
              le pedía al cliente que recargara A MANO justo en el momento de
              más ansiedad de todo el flujo —acaba de salirle la plata y no sabe
              si tiene turno—, que es exactamente cuando alguien vuelve a pagar.
              El ciclo se corta solo: `enCurso` es true únicamente con la seña
              en `iniciada`, y el cron `expire-booking-deposits` la cierra.
            */}
            {desdeWeb && desenlace.enCurso && <meta httpEquiv="refresh" content="6" />}

            <main
                className="w-full max-w-md rounded-3xl border p-7"
                style={{ backgroundColor: 'var(--t-surface)', borderColor: 'var(--t-border)' }}
            >
                <div className="flex flex-col items-center text-center">
                    {ctx.logo ? (
                        <Image
                            src={ctx.logo}
                            alt={ctx.sucursal}
                            width={56}
                            height={56}
                            unoptimized
                            className="mb-5 h-14 w-14 rounded-full object-cover"
                        />
                    ) : null}

                    <Icono className="mb-3 h-11 w-11" strokeWidth={1.5} style={{ color: colorIcono }} />
                    <h1 className="text-xl font-semibold tracking-tight">{desenlace.titulo}</h1>
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--t-text-muted)' }}>
                        {desenlace.detalle}
                    </p>
                </div>

                {/* El detalle de la reserva. Se muestra siempre: incluso cuando algo
                    salió mal, saber DE QUÉ turno estamos hablando es lo primero
                    que el cliente necesita para decidir qué hacer. */}
                <dl
                    className="mt-6 space-y-3 rounded-2xl border p-4 text-sm"
                    style={{ backgroundColor: 'var(--t-surface-alt)', borderColor: 'var(--t-border)' }}
                >
                    <div className="flex items-start gap-3">
                        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--t-text-faint)' }} />
                        <div>
                            <dt className="sr-only">Turno</dt>
                            <dd className="font-medium">
                                {fechaLargaDeStr(sena.appointment_date)} · {hora}
                            </dd>
                            {sena.service_names ? (
                                <dd style={{ color: 'var(--t-text-muted)' }}>{sena.service_names}</dd>
                            ) : null}
                            {ctx.barbero ? (
                                <dd style={{ color: 'var(--t-text-muted)' }}>Te atiende {ctx.barbero}</dd>
                            ) : null}
                        </div>
                    </div>

                    {ctx.sucursal ? (
                        <div className="flex items-start gap-3">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--t-text-faint)' }} />
                            <div>
                                <dt className="sr-only">Sucursal</dt>
                                <dd className="font-medium">{ctx.sucursal}</dd>
                                {ctx.direccion ? (
                                    <dd style={{ color: 'var(--t-text-muted)' }}>{ctx.direccion}</dd>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    <div
                        className="flex items-center justify-between border-t pt-3"
                        style={{ borderColor: 'var(--t-border)' }}
                    >
                        <dt style={{ color: 'var(--t-text-muted)' }}>Seña</dt>
                        <dd className="font-semibold">{MONEDA.format(monto)}</dd>
                    </div>
                    {resto > 0 ? (
                        <div className="flex items-center justify-between">
                            <dt style={{ color: 'var(--t-text-muted)' }}>A pagar en el local</dt>
                            <dd className="font-medium">{MONEDA.format(resto)}</dd>
                        </div>
                    ) : null}
                </dl>

                {desenlace.enCurso ? (
                    <p
                        className="mt-4 flex items-start gap-2 text-xs leading-relaxed"
                        style={{ color: 'var(--t-text-faint)' }}
                    >
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {desdeWeb
                            ? 'Si ya pagaste, no lo repitas: esta pantalla se actualiza sola en unos segundos.'
                            : 'Si ya pagaste, no lo repitas: actualizá esta página en unos segundos.'}
                    </p>
                ) : null}

                {/* El botón manual. El rebote automático a un esquema propio falla
                    seguido —Safari lo bloquea si no lo disparó un gesto del
                    usuario— y quedarse sin salida después de pagar es la peor
                    pantalla posible. En la web el botón lleva a los turnos. */}
                <div className="mt-6">
                    {desdeWeb ? (
                        // El turnero web no tiene una pantalla de "mis turnos" —
                        // el turno se gestiona con el link que llega por WhatsApp—,
                        // así que la única salida honesta es volver a la sucursal:
                        // a mirar, o a elegir otro horario si esto salió mal.
                        <Link
                            href={ctx.slug ? `/turnos/${ctx.slug}` : '/'}
                            className="flex h-12 w-full items-center justify-center rounded-2xl border text-sm font-semibold transition-opacity hover:opacity-90"
                            style={{
                                backgroundColor: 'var(--t-cta)',
                                color: 'var(--t-on-cta)',
                                borderColor: 'var(--t-cta-border)',
                            }}
                        >
                            {desenlace.tono === 'falla' ? 'Elegir otro horario' : `Volver a ${ctx.sucursal || 'Monaco'}`}
                        </Link>
                    ) : (
                        <a
                            href={deepLink}
                            className="flex h-12 w-full items-center justify-center rounded-2xl border text-sm font-semibold transition-opacity hover:opacity-90"
                            style={{
                                backgroundColor: 'var(--t-cta)',
                                color: 'var(--t-on-cta)',
                                borderColor: 'var(--t-cta-border)',
                            }}
                        >
                            Volver a la app
                        </a>
                    )}
                </div>
            </main>
        </div>
    )
}
