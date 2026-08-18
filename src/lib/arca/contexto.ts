// =============================================================================
// src/lib/arca/contexto.ts
// Resolución del contribuyente, sus credenciales y el contexto de WSFEv1.
//
// Vive fuera de `src/lib/actions/` a propósito: es un módulo normal, así que
// puede exportar helpers sincrónicos y tipos. Un archivo `'use server'` sólo
// puede exportar funciones async (Next 16), y forzar eso acá haría que dos
// archivos de acciones terminen con copias distintas del mismo helper.
// =============================================================================

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { descifrarSecreto, hayClaveDeCifrado } from './crypto'
import { obtenerTicketAcceso, ErrorWsaa, type CredencialArca } from './wsaa'
import { traducirErrorArca, type ErrorTraducido } from './errores'
import type { ContextoWsfe } from './wsfe'
import type { AmbienteArca, CondicionIvaEmisor } from './config'

export interface FilaContribuyente {
    id: string
    organization_id: string
    /** Barbero titular del monotributo. Es lo que ata cada venta a su CUIT. */
    staff_id: string | null
    monotributo_categoria: string | null
    tope_anual_override: string | number | null
    is_active: boolean
    environment: AmbienteArca
    auth_mode: 'certificado_propio' | 'delegacion'
    cuit: string
    razon_social: string | null
    condicion_iva: CondicionIvaEmisor
    domicilio_comercial: string | null
    inicio_actividades: string | null
    ingresos_brutos: string | null
    private_key_enc: string | null
    csr_pem: string | null
    certificate_pem: string | null
    cert_not_after: string | null
    status: string
    last_check_at: string | null
    last_check_ok: boolean | null
    last_check_error: string | null
}

export function limpiarCuit(v: string): string {
    return (v || '').replace(/\D/g, '')
}

/**
 * Dígito verificador del CUIT.
 * Detecta un CUIT mal tipeado ACÁ y no después de que el usuario hizo todo el
 * trámite en el portal de ARCA.
 */
export function cuitEsValido(cuit: string): boolean {
    if (!/^[0-9]{11}$/.test(cuit)) return false
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    const d = cuit.split('').map(Number)
    const resto = pesos.reduce((acc, p, i) => acc + p * d[i], 0) % 11
    const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
    return verificador === d[10]
}

/** El contribuyente activo de la org: producción si existe, si no homologación. */
/**
 * "El" contribuyente de una organización.
 *
 * OJO: en el modelo por barbero esto es un concepto BORROSO — hay un monotributo
 * por persona y elegir "alguno" nunca es lo correcto para emitir. Para eso están
 * `contribuyenteDeBarbero` (por quién hizo el corte) y `cargarContribuyentePorId`
 * (por el que dice la política o el comprobante). Usar esta función para emitir
 * fue el origen de tres bugs fiscales: notas de crédito con el CUIT de otro
 * barbero, lotes enteros facturados a nombre de quien no cortó, y consultas de
 * reconciliación contra el CUIT equivocado.
 *
 * Queda para los usos donde cualquier contribuyente sirve (saber el ambiente de
 * la organización, saber si hay algo configurado). Ahora al menos filtra por
 * activo y ordena determinísticamente: antes podía devolver un monotributo dado
 * de baja, y con varias filas de producción el `.order('environment')` no
 * desempataba nada.
 */
export async function cargarContribuyente(orgId: string): Promise<FilaContribuyente | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_taxpayers')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
    if (error) {
        console.error('[cargarContribuyente]', error.message)
        return null
    }
    const filas = (data ?? []) as FilaContribuyente[]
    return filas.find((f) => f.environment === 'produccion') ?? filas[0] ?? null
}

/**
 * El contribuyente de un BARBERO.
 *
 * Es la pieza central del modelo por barbero: cada corte lo factura el CUIT de
 * quien lo hizo, y eso sale de `visits.barber_id` → `arca_taxpayers.staff_id`.
 * Devuelve null si ese barbero todavía no tiene monotributo cargado — que no es
 * un error, es el estado normal mientras se dan de alta.
 */
export async function contribuyenteDeBarbero(
    orgId: string,
    staffId: string | null,
): Promise<FilaContribuyente | null> {
    if (!staffId) return null
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_taxpayers')
        .select('*')
        .eq('organization_id', orgId)
        .eq('staff_id', staffId)
        .eq('is_active', true)
        .order('environment', { ascending: false }) // 'produccion' antes que 'homologacion'
    if (error) {
        console.error('[contribuyenteDeBarbero]', error.message)
        return null
    }
    const filas = (data ?? []) as FilaContribuyente[]
    return filas.find((f) => f.environment === 'produccion') ?? filas[0] ?? null
}

/**
 * El contribuyente que se está CONFIGURANDO.
 *
 * Con un monotributo por barbero, "el contribuyente de la org" ya no existe:
 * hay que decir cuál. Si no se pasa ninguno, cae en el de producción — que es
 * lo correcto como default, pero no alcanza para dar de alta a los demás.
 */
export async function cargarContribuyentePorId(
    orgId: string,
    taxpayerId: string | null | undefined,
): Promise<FilaContribuyente | null> {
    if (!taxpayerId) return cargarContribuyente(orgId)
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_taxpayers')
        .select('*')
        .eq('id', taxpayerId)
        // El id viene del cliente: se filtra por organización sí o sí.
        .eq('organization_id', orgId)
        .maybeSingle()
    if (error) {
        console.error('[cargarContribuyentePorId]', error.message)
        return null
    }
    return (data as FilaContribuyente | null) ?? null
}

/** Todos los monotributos de la organización, con su barbero. */
export async function listarContribuyentes(orgId: string): Promise<FilaContribuyente[]> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_taxpayers')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
    if (error) {
        console.error('[listarContribuyentes]', error.message)
        return []
    }
    return (data ?? []) as FilaContribuyente[]
}

/**
 * Resuelve el certificado con el que se firma.
 *
 * En modo delegación NO es el del contribuyente: es el de la plataforma. El
 * CUIT del contribuyente viaja aparte, en `Auth.Cuit` de cada llamada. Por eso
 * un solo Ticket de Acceso sirve para todos los clientes delegados — y por eso
 * el cache de tokens se indexa por credencial y no por contribuyente.
 */
export async function cargarCredencial(
    t: FilaContribuyente,
): Promise<CredencialArca | { error: string }> {
    if (!(await hayClaveDeCifrado())) {
        return { error: 'Falta la clave de cifrado del facturador en Supabase Vault (`arca_encryption_key`).' }
    }

    if (t.auth_mode === 'delegacion') {
        const supabase = createAdminClient()
        const { data, error } = await supabase
            .from('arca_platform_credentials')
            .select('cuit, private_key_enc, certificate_pem, is_enabled')
            .eq('environment', t.environment)
            .maybeSingle()
        if (error) {
            console.error('[cargarCredencial/plataforma]', error.message)
            return { error: 'No pudimos leer las credenciales de la plataforma.' }
        }
        if (!data?.is_enabled || !data.certificate_pem || !data.private_key_enc) {
            return { error: 'El modo delegación todavía no está disponible: falta el certificado de la plataforma.' }
        }
        try {
            return {
                credentialKey: `platform:${t.environment}`,
                ambiente: t.environment,
                certificatePem: data.certificate_pem,
                privateKeyPem: await descifrarSecreto(data.private_key_enc),
                taxpayerId: t.id,
            }
        } catch (e) {
            console.error('[cargarCredencial/plataforma] descifrado', e)
            return { error: 'No pudimos descifrar el certificado de la plataforma.' }
        }
    }

    if (!t.certificate_pem || !t.private_key_enc) {
        return { error: 'Todavía no cargaste el certificado de ARCA.' }
    }
    try {
        return {
            credentialKey: `taxpayer:${t.id}`,
            ambiente: t.environment,
            certificatePem: t.certificate_pem,
            privateKeyPem: await descifrarSecreto(t.private_key_enc),
            taxpayerId: t.id,
        }
    } catch (e) {
        console.error('[cargarCredencial] descifrado', e)
        return {
            error:
                'No pudimos descifrar la clave privada. Si se cambió la clave de cifrado del servidor, ' +
                'hay que volver a generar el certificado.',
        }
    }
}

export async function contextoWsfe(
    t: FilaContribuyente,
): Promise<ContextoWsfe | { error: string; traducido?: ErrorTraducido }> {
    const cred = await cargarCredencial(t)
    if ('error' in cred) return { error: cred.error }
    try {
        const ta = await obtenerTicketAcceso(cred)
        return { ambiente: t.environment, cuit: t.cuit, ta }
    } catch (e) {
        const err = e instanceof ErrorWsaa ? e : null
        const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))
        console.error('[contextoWsfe]', err?.codigo, err?.message ?? e)
        return { error: traducido.titulo, traducido }
    }
}

/**
 * Ambiente en el que está operando la organización.
 *
 * Hace falta para buscar candidatas: una venta que ya tiene comprobante de
 * PRUEBA sigue estando pendiente de su comprobante REAL, y al revés. Sin esto
 * la pantalla ofrecería ventas que la emisión después rechaza por el índice
 * único de (visita, ambiente).
 */
export async function ambienteDeOrg(orgId: string): Promise<'homologacion' | 'produccion'> {
    const t = await cargarContribuyente(orgId)
    return t?.environment ?? 'produccion'
}

/** Staff logueado, para dejar rastro de quién emitió cada comprobante. */
export async function staffIdActual(): Promise<string | null> {
    try {
        const auth = await createClient()
        const { data: { user } } = await auth.auth.getUser()
        if (!user) return null
        const supabase = createAdminClient()
        const { data } = await supabase
            .from('staff')
            .select('id')
            .eq('auth_user_id', user.id)
            .eq('is_active', true)
            .maybeSingle()
        return data?.id ?? null
    } catch {
        return null
    }
}

export interface PuntoVentaElegido {
    id: string
    numero: number
    emisionTipo: string | null
    sirveParaCae: boolean
}

export type ResolucionPuntoVenta =
    | { ok: true; pv: PuntoVentaElegido }
    /** No hay ninguno cargado para ese CUIT (o falló la lectura). */
    | { ok: false; motivo: 'ninguno' }
    /** Hay, pero todos son de contingencia (CAEA): ARCA los rechaza con 10005. */
    | { ok: false; motivo: 'contingencia'; puntos: PuntoVentaElegido[] }

/**
 * Punto de venta con el que se emite una venta de ese CUIT.
 *
 * EL PUNTO DE VENTA ES DEL CUIT, NO DE LA SUCURSAL. Eso importa porque los
 * cupos con `origen = 'sucursal' | 'organizacion'` facturan cortes de sucursales
 * donde el titular no trabaja: es literalmente para qué existen ("Tony factura
 * con su monotributo aunque no corte"). Con la resolución vieja —sucursal propia
 * o comodín, y si no, nada— la primera venta de otra sucursal devolvía
 * `sin_punto_venta`, que corta el lote entero. Un cupo org-wide emitía hasta
 * topar con un corte de otro local y ahí se plantaba, siempre.
 *
 * Prioridad: el de la sucursal que cobró → el comodín → el único que tenga →
 * el de número más bajo. Los dos últimos son la red: elegir uno determinístico
 * es mucho mejor que abortar, porque cualquier punto de venta del CUIT puede
 * facturar cualquier venta del CUIT. Lo único que cambia es en qué serie de
 * numeración cae, y para eso está la asignación por sucursal.
 *
 * `sirve_para_cae = false` NO se filtra en la query a propósito: hay que poder
 * distinguir "no tiene punto de venta" de "tiene uno pero es de contingencia",
 * que son dos problemas con dos soluciones distintas en ARCA.
 */
export async function puntoVentaDe(
    taxpayerId: string,
    branchId: string | null,
): Promise<ResolucionPuntoVenta> {
    const supabase = createAdminClient()
    const leer = (columnas: string) =>
        supabase
            .from('arca_sales_points')
            .select(columnas)
            .eq('taxpayer_id', taxpayerId)
            .eq('is_active', true)
            .order('numero', { ascending: true })

    let { data, error } = await leer('id, numero, branch_id, emision_tipo, sirve_para_cae')

    // Known Risk #23: una migración en el repo NO es una migración aplicada. Si
    // las columnas de la 188 todavía no existen (42703), se lee la forma vieja en
    // vez de dejar el facturador entero muerto con un mensaje equivocado ("no
    // tiene punto de venta"). Se pierde la detección de contingencia acá —el
    // rechazo 10005 de ARCA lo sigue explicando igual—, pero se emite.
    if (error?.code === '42703') {
        console.error('[puntoVentaDe] falta la migración 188: sin detección de punto de venta de contingencia')
        const reintento = await leer('id, numero, branch_id')
        data = reintento.data
        error = reintento.error
    }

    if (error) {
        console.error('[puntoVentaDe]', error.message)
        return { ok: false, motivo: 'ninguno' }
    }

    const filas = ((data ?? []) as any[]).map((f) => ({
        id: f.id as string,
        numero: Number(f.numero),
        branchId: (f.branch_id ?? null) as string | null,
        emisionTipo: (f.emision_tipo ?? null) as string | null,
        // `null` = fila vieja que nunca se revalidó contra ARCA. Se asume que
        // sirve (falla abierta, igual que `sirveParaCae` en wsfe.ts): apagar un
        // punto de venta que hoy factura bien sería el peor de los dos errores.
        sirveParaCae: f.sirve_para_cae !== false,
    }))

    if (filas.length === 0) return { ok: false, motivo: 'ninguno' }

    const utiles = filas.filter((f) => f.sirveParaCae)
    if (utiles.length === 0) {
        return { ok: false, motivo: 'contingencia', puntos: filas.map(sinSucursal) }
    }

    const elegido =
        (branchId ? utiles.find((f) => f.branchId === branchId) : undefined) ??
        utiles.find((f) => f.branchId === null) ??
        utiles[0]

    return { ok: true, pv: sinSucursal(elegido) }
}

function sinSucursal(f: {
    id: string
    numero: number
    emisionTipo: string | null
    sirveParaCae: boolean
}): PuntoVentaElegido {
    return { id: f.id, numero: f.numero, emisionTipo: f.emisionTipo, sirveParaCae: f.sirveParaCae }
}
