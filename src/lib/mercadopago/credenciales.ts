// =============================================================================
// src/lib/mercadopago/credenciales.ts
// El único lugar del sistema que descifra un access_token de Mercado Pago.
//
// UNA CUENTA POR SUCURSAL
// -----------------------
// Cada sucursal cobra en la suya (`branch_payment_providers`, UNIQUE por
// branch + provider + environment). No hay token global ni variable de entorno
// con credenciales de cobro: todo el resto del sistema pide el token acá,
// pasando una sucursal, y así es imposible cobrar un turno de Rondeau en la
// cuenta de Caseros.
//
// LOS TOKENS VIVEN CIFRADOS (AES-256-GCM, clave maestra en Vault — la misma que
// ARCA, ver `src/lib/crypto/secretos.ts`). Nunca se loguean, ni enteros ni
// truncados: son la llave con la que se mueve la plata de una persona.
//
// RENOVACIÓN PEREZOSA, NO POR CRON
// --------------------------------
// El access_token de OAuth dura 180 días. En vez de confiar en un cron que
// nadie mira —en este repo ya hubo cinco crons muertos cuatro meses sin que se
// notara—, la renovación ocurre acá: si al resolver el proveedor faltan menos
// de 30 días, se renueva ANTES de devolverlo y se persiste en la misma
// operación. Cualquier cobro mantiene viva la conexión. Un cron de respaldo
// sigue teniendo sentido para la sucursal que pasa medio año sin cobrar online,
// pero el camino normal no depende de él.
//
// El refresh_token es ROTATIVO: al renovar, MP devuelve uno nuevo y quema el
// anterior. Por eso se guardan los dos campos JUNTOS, en un solo UPDATE.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { cifrarSecreto, descifrarSecreto } from '@/lib/crypto/secretos'
import type { AmbienteMp, ModoConexionMp, EstadoProveedor } from '@/lib/senas/contrato'
import { renovarToken, type TokensMp } from './oauth'
import { pedirAMercadoPago, esErrorMercadoPago } from './http'

/** Cuánto antes del vencimiento se renueva. 180 días de vida, 30 de colchón. */
const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────
// Configuración de la aplicación de Mercado Pago (nuestra, no de la sucursal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La URL pública de PRODUCCIÓN.
 *
 * No sale del header del request a propósito: `buildAppUrl()` la deriva del
 * host, y con eso un deploy de preview hornearía su propio dominio efímero en
 * el `redirect_uri` de Mercado Pago (que además tiene que coincidir EXACTAMENTE
 * con el del panel). Ya pasó con un alias viejo de Vercel: dejó cinco crons y
 * los webhooks de Meta muertos.
 */
export function urlAppProduccion(): string {
    const env = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '')
    return env || 'https://monacobarber.vercel.app'
}

/** El redirect del OAuth es ESTÁTICO: la sucursal viaja en `state`. */
export function redirectUriOauth(): string {
    const explicito = (process.env.MERCADOPAGO_OAUTH_REDIRECT_URI ?? '').trim()
    return explicito || `${urlAppProduccion()}/api/mercadopago/oauth/callback`
}

export interface AppMercadoPago {
    clientId: string
    clientSecret: string
    redirectUri: string
}

/**
 * Las credenciales de NUESTRA aplicación de Mercado Pago (las que permiten
 * pedirle a una sucursal que nos autorice). Devuelve null si no están
 * configuradas: el modo OAuth simplemente no se ofrece y queda el manual.
 */
export function appMercadoPago(): AppMercadoPago | null {
    const clientId = (process.env.MERCADOPAGO_OAUTH_CLIENT_ID ?? '').trim()
    const clientSecret = (process.env.MERCADOPAGO_OAUTH_CLIENT_SECRET ?? '').trim()
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret, redirectUri: redirectUriOauth() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver el proveedor de una sucursal
// ─────────────────────────────────────────────────────────────────────────────

export interface ProveedorResuelto {
    id: string
    organizationId: string
    branchId: string
    /** EN CLARO. No loguearlo, no devolverlo al browser, no meterlo en un error. */
    accessToken: string
    publicKey: string | null
    mpUserId: string | null
    connectionMode: ModoConexionMp
    environment: AmbienteMp
    liveMode: boolean | null
    status: EstadoProveedor
}

interface FilaProveedor {
    id: string
    organization_id: string
    branch_id: string
    environment: string
    connection_mode: string
    mp_user_id: string | null
    public_key: string | null
    access_token_cifrado: string | null
    refresh_token_cifrado: string | null
    webhook_secret_cifrado: string | null
    token_expires_at: string | null
    live_mode: boolean | null
    status: string
}

const COLUMNAS =
    'id, organization_id, branch_id, environment, connection_mode, mp_user_id, public_key, ' +
    'access_token_cifrado, refresh_token_cifrado, webhook_secret_cifrado, token_expires_at, live_mode, status'

/**
 * El token de cobro de una sucursal, listo para usar.
 *
 * Devuelve `null` cuando la sucursal no puede cobrar (no está conectada, o la
 * conexión se revocó). Quien llama traduce eso a `MP_NO_CONECTADO`; el motivo
 * exacto queda en `last_error` de la fila, que es lo que muestra el dashboard.
 */
export async function resolverProveedor(
    branchId: string,
    ambiente: AmbienteMp = 'produccion',
): Promise<ProveedorResuelto | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_payment_providers')
        .select(COLUMNAS)
        .eq('branch_id', branchId)
        .eq('provider', 'mercadopago')
        .eq('environment', ambiente)
        .maybeSingle<FilaProveedor>()

    if (error) {
        throw new Error(`No pudimos leer las credenciales de Mercado Pago de la sucursal: ${error.message}`)
    }
    if (!data) return null
    return prepararProveedor(data)
}

/**
 * ¿Esta sucursal PUEDE cobrar hoy?
 *
 * Es la misma pregunta que responde `resolverProveedor`, pero sin descifrar
 * nada: se usa en el camino de RESERVA (el guard que impide que un turno con
 * seña se cree gratis por el endpoint de siempre), que corre en cada intento y
 * no necesita el token, sólo saber si existe. Descifrar ahí sería pagar Vault +
 * AES por cada reserva de una sucursal que ni siquiera pide seña.
 *
 * TIRA si no puede leer: quien la llama tiene que poder distinguir "esta
 * sucursal no cobra" de "no pudimos averiguarlo", que es la diferencia entre
 * reservar gratis a propósito y regalar un turno por un error de base.
 */
export async function hayCuentaCobrable(
    branchId: string,
    ambiente: AmbienteMp = 'produccion',
): Promise<boolean> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_payment_providers')
        .select('id')
        .eq('branch_id', branchId)
        .eq('provider', 'mercadopago')
        .eq('environment', ambiente)
        .neq('status', 'revocado')
        .not('access_token_cifrado', 'is', null)
        .maybeSingle()

    if (error) {
        throw new Error(`No pudimos verificar la cuenta de cobro de la sucursal: ${error.message}`)
    }
    return !!data
}

/**
 * El proveedor a partir del `collector_id` de la cuenta.
 *
 * Es lo que usa el webhook: la notificación de Mercado Pago trae `user_id` y
 * nada más, así que sin este mapeo no hay forma de saber con QUÉ token
 * consultar el pago — y consultarlo con el token equivocado devuelve 404, que
 * se parece peligrosamente a "ese pago no existe".
 */
export async function resolverProveedorPorCollector(
    mpUserId: string,
): Promise<ProveedorResuelto | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_payment_providers')
        .select(COLUMNAS)
        .eq('provider', 'mercadopago')
        .eq('mp_user_id', String(mpUserId))
        .order('environment', { ascending: true })   // 'produccion' antes que 'prueba'
        .limit(1)
        // `.returns` explícito: las columnas van en una constante y supabase-js
        // no puede inferir la forma de un select que no es literal.
        .returns<FilaProveedor[]>()

    if (error) {
        throw new Error(`No pudimos resolver la cuenta de Mercado Pago ${mpUserId}: ${error.message}`)
    }
    const fila = data?.[0]
    if (!fila) return null
    return prepararProveedor(fila)
}

/** Descifra y, si hace falta y se puede, renueva. */
async function prepararProveedor(fila: FilaProveedor): Promise<ProveedorResuelto | null> {
    if (fila.status === 'revocado') return null
    if (!fila.access_token_cifrado) return null

    let accessToken: string
    try {
        accessToken = await descifrarSecreto(fila.access_token_cifrado)
    } catch (e) {
        // Un token que no se descifra suele significar clave maestra distinta
        // entre entornos. Se registra y se corta: usar basura como token
        // produciría un 401 de MP imposible de diagnosticar.
        await marcarError(fila.id, 'No pudimos descifrar el token guardado: ' + mensaje(e))
        return null
    }

    const base: ProveedorResuelto = {
        id: fila.id,
        organizationId: fila.organization_id,
        branchId: fila.branch_id,
        accessToken,
        publicKey: fila.public_key,
        mpUserId: fila.mp_user_id,
        connectionMode: (fila.connection_mode === 'manual' ? 'manual' : 'oauth') as ModoConexionMp,
        environment: (fila.environment === 'prueba' ? 'prueba' : 'produccion') as AmbienteMp,
        liveMode: fila.live_mode,
        status: fila.status as EstadoProveedor,
    }

    // Las credenciales manuales no vencen: no hay nada que renovar.
    if (base.connectionMode !== 'oauth') return base
    if (!fila.token_expires_at || !fila.refresh_token_cifrado) return base

    const venceEn = new Date(fila.token_expires_at).getTime()
    if (!Number.isFinite(venceEn)) return base
    if (venceEn - Date.now() > MARGEN_RENOVACION_MS) return base

    return await renovarYPersistir(fila, base, venceEn)
}

/**
 * Renueva el token y lo guarda. Si falla, NO deja a la sucursal sin cobrar
 * mientras el token viejo siga vivo: un hipo de red de Mercado Pago no puede
 * traducirse en "esta sucursal no acepta señas".
 */
async function renovarYPersistir(
    fila: FilaProveedor,
    base: ProveedorResuelto,
    venceEn: number,
): Promise<ProveedorResuelto | null> {
    const app = appMercadoPago()
    if (!app) {
        // Sin las credenciales de la aplicación no se puede renovar. Si el token
        // todavía sirve, se usa; si venció, la sucursal quedó desconectada.
        await marcarError(fila.id, 'Falta configurar MERCADOPAGO_OAUTH_CLIENT_ID/SECRET para renovar el token.')
        return venceEn > Date.now() ? base : null
    }

    let refreshToken: string
    try {
        refreshToken = await descifrarSecreto(fila.refresh_token_cifrado!)
    } catch (e) {
        await marcarError(fila.id, 'No pudimos descifrar el refresh_token: ' + mensaje(e))
        return venceEn > Date.now() ? base : null
    }

    let tokens: TokensMp
    try {
        tokens = await renovarToken({
            clientId: app.clientId,
            clientSecret: app.clientSecret,
            refreshToken,
        })
    } catch (e) {
        const detalle = esErrorMercadoPago(e)
            ? `${e.status || 'red'} ${e.detalles.mpError ?? e.causa ?? e.message}`
            : mensaje(e)
        await marcarError(fila.id, 'No pudimos renovar el token de Mercado Pago: ' + detalle)
        return venceEn > Date.now() ? base : null
    }

    const supabase = createAdminClient()
    // Los DOS tokens en el MISMO update: el refresh es rotativo y guardar sólo
    // el access dejaría a la sucursal sin poder renovar la próxima vez.
    const { error } = await supabase
        .from('branch_payment_providers')
        .update({
            access_token_cifrado: await cifrarSecreto(tokens.accessToken),
            refresh_token_cifrado: tokens.refreshToken ? await cifrarSecreto(tokens.refreshToken) : null,
            public_key: tokens.publicKey ?? fila.public_key,
            mp_user_id: tokens.userId || fila.mp_user_id,
            live_mode: tokens.liveMode,
            token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
            status: 'conectado',
            last_error: null,
            last_check_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', fila.id)

    if (error) {
        // El token nuevo ya existe en Mercado Pago y el viejo quedó quemado: si
        // no se pudo guardar, hay que gritarlo. Seguir en silencio con el viejo
        // es cómo se llega a una sucursal que deja de cobrar sin aviso.
        throw new Error(
            'Renovamos el token de Mercado Pago pero no pudimos guardarlo: ' + error.message +
            '. Hay que volver a conectar la cuenta de esta sucursal.',
        )
    }

    return {
        ...base,
        accessToken: tokens.accessToken,
        publicKey: tokens.publicKey ?? base.publicKey,
        mpUserId: tokens.userId || base.mpUserId,
        liveMode: tokens.liveMode,
        status: 'conectado',
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secreto del webhook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El secreto con el que se firma el webhook de ESA cuenta, descifrado.
 *
 * Devuelve null si no hay: quien llama tiene que rechazar la notificación
 * (`verificarFirmaWebhook` falla cerrada). Es deliberado — lo que llega por ahí
 * confirma pagos.
 */
export async function secretoWebhook(proveedorId: string): Promise<string | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_payment_providers')
        .select('webhook_secret_cifrado')
        .eq('id', proveedorId)
        .maybeSingle<{ webhook_secret_cifrado: string | null }>()

    if (error) {
        throw new Error(`No pudimos leer el secreto del webhook: ${error.message}`)
    }
    if (!data?.webhook_secret_cifrado) return null

    try {
        return await descifrarSecreto(data.webhook_secret_cifrado)
    } catch (e) {
        await marcarError(proveedorId, 'No pudimos descifrar el secreto del webhook: ' + mensaje(e))
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardar / desconectar
// ─────────────────────────────────────────────────────────────────────────────

export type EntradaCredenciales =
    | {
        modo: 'oauth'
        organizationId: string
        branchId: string
        ambiente: AmbienteMp
        tokens: TokensMp
        /** Uno por aplicación en OAuth: lo comparten las sucursales conectadas. */
        webhookSecret?: string | null
        connectedBy?: string | null
    }
    | {
        modo: 'manual'
        organizationId: string
        branchId: string
        ambiente: AmbienteMp
        accessToken: string
        publicKey?: string | null
        /** Uno por cuenta cuando las credenciales se pegan a mano. */
        webhookSecret?: string | null
        connectedBy?: string | null
    }

export interface ResultadoGuardado {
    ok: boolean
    error?: string
    mpUserId?: string | null
    liveMode?: boolean | null
}

/**
 * Guarda (o reemplaza) las credenciales de una sucursal.
 *
 * En modo manual valida el token contra `/users/me` ANTES de guardarlo, por dos
 * motivos: confirma que el token sirve —pegar el "public key" en el campo del
 * access token es el error clásico— y resuelve el `collector_id`, sin el cual
 * el webhook no puede mapear la notificación a esta sucursal.
 */
export async function guardarCredenciales(e: EntradaCredenciales): Promise<ResultadoGuardado> {
    let accessToken: string
    let refreshToken: string | null = null
    let publicKey: string | null = null
    let mpUserId: string | null = null
    let liveMode: boolean | null = null
    let expiraEn: string | null = null

    if (e.modo === 'oauth') {
        accessToken = e.tokens.accessToken
        refreshToken = e.tokens.refreshToken
        publicKey = e.tokens.publicKey
        mpUserId = e.tokens.userId
        liveMode = e.tokens.liveMode
        expiraEn = new Date(Date.now() + e.tokens.expiresIn * 1000).toISOString()
    } else {
        accessToken = e.accessToken.trim()
        publicKey = (e.publicKey ?? '').trim() || null
        if (!accessToken) return { ok: false, error: 'Falta el access token de Mercado Pago.' }

        try {
            const cuenta = await identificarCuenta(accessToken)
            mpUserId = cuenta.id
            // Los tokens de prueba de MP empiezan con TEST-; los de producción,
            // con APP_USR-. Es la única señal de ambiente que trae el token.
            liveMode = !accessToken.startsWith('TEST-')
        } catch (err) {
            return {
                ok: false,
                error: esErrorMercadoPago(err) && err.status === 401
                    ? 'Mercado Pago rechazó ese access token. Copialo de nuevo desde "Tus integraciones" → tu aplicación → Credenciales.'
                    : 'No pudimos validar el access token con Mercado Pago: ' + mensaje(err),
            }
        }
    }

    const supabase = createAdminClient()
    const fila = {
        organization_id: e.organizationId,
        branch_id: e.branchId,
        provider: 'mercadopago',
        environment: e.ambiente,
        connection_mode: e.modo,
        mp_user_id: mpUserId,
        public_key: publicKey,
        access_token_cifrado: await cifrarSecreto(accessToken),
        refresh_token_cifrado: refreshToken ? await cifrarSecreto(refreshToken) : null,
        ...(e.webhookSecret
            ? { webhook_secret_cifrado: await cifrarSecreto(e.webhookSecret.trim()) }
            : {}),
        token_expires_at: expiraEn,
        live_mode: liveMode,
        status: 'conectado' as EstadoProveedor,
        last_error: null,
        last_check_at: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        connected_by: e.connectedBy ?? null,
        updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
        .from('branch_payment_providers')
        .upsert(fila, { onConflict: 'branch_id,provider,environment' })

    if (error) {
        return { ok: false, error: 'No pudimos guardar las credenciales: ' + error.message }
    }
    return { ok: true, mpUserId, liveMode }
}

/**
 * Desconecta la sucursal.
 *
 * Borra los tokens en vez de sólo cambiar el status: un token de cobro que ya
 * no se usa es superficie de ataque sin contrapartida. La fila queda —con su
 * `mp_user_id`— para que una notificación atrasada de esa cuenta se pueda
 * atribuir y registrar en vez de caer como "cuenta desconocida".
 */
export async function desconectar(
    branchId: string,
    ambiente: AmbienteMp = 'produccion',
): Promise<{ ok: boolean; error?: string }> {
    const supabase = createAdminClient()
    const { error } = await supabase
        .from('branch_payment_providers')
        .update({
            access_token_cifrado: null,
            refresh_token_cifrado: null,
            webhook_secret_cifrado: null,
            token_expires_at: null,
            status: 'desconectado',
            last_error: null,
            updated_at: new Date().toISOString(),
        })
        .eq('branch_id', branchId)
        .eq('provider', 'mercadopago')
        .eq('environment', ambiente)

    if (error) return { ok: false, error: 'No pudimos desconectar la cuenta: ' + error.message }
    return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliares
// ─────────────────────────────────────────────────────────────────────────────

/** `GET /users/me`: confirma que el token sirve y devuelve el collector_id. */
export async function identificarCuenta(token: string): Promise<{ id: string; nickname: string | null }> {
    const r = await pedirAMercadoPago<{ id?: number | string; nickname?: string }>({
        metodo: 'GET',
        ruta: '/users/me',
        token,
    })
    if (r.id === undefined || r.id === null) {
        throw new Error('Mercado Pago no devolvió el id de la cuenta.')
    }
    return { id: String(r.id), nickname: r.nickname ?? null }
}

/**
 * Deja constancia del problema en la fila. No tira: quien la llama ya está
 * manejando un error y lo último que necesita es otro encima. Pero tampoco es
 * silencio — `last_error` es lo que el dashboard muestra.
 */
async function marcarError(proveedorId: string, detalle: string): Promise<void> {
    try {
        const supabase = createAdminClient()
        const { error } = await supabase
            .from('branch_payment_providers')
            .update({
                status: 'error',
                last_error: detalle.slice(0, 500),
                last_check_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', proveedorId)
        if (error) console.error('[mp-credenciales] no se pudo registrar el error:', error.message)
    } catch (e) {
        console.error('[mp-credenciales] no se pudo registrar el error:', mensaje(e))
    }
}

function mensaje(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}
