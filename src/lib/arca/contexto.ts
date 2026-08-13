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
export async function cargarContribuyente(orgId: string): Promise<FilaContribuyente | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_taxpayers')
        .select('*')
        .eq('organization_id', orgId)
        .order('environment', { ascending: true })
    if (error) {
        console.error('[cargarContribuyente]', error.message)
        return null
    }
    const filas = (data ?? []) as FilaContribuyente[]
    return filas.find((f) => f.environment === 'produccion') ?? filas[0] ?? null
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

/**
 * Punto de venta que le toca a una sucursal: el suyo si tiene, y si no el
 * comodín de la organización.
 */
export async function puntoVentaDe(
    taxpayerId: string,
    branchId: string | null,
): Promise<{ id: string; numero: number } | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('arca_sales_points')
        .select('id, numero, branch_id')
        .eq('taxpayer_id', taxpayerId)
        .eq('is_active', true)
    if (error) {
        console.error('[puntoVentaDe]', error.message)
        return null
    }
    const filas = (data ?? []) as { id: string; numero: number; branch_id: string | null }[]
    const propio = branchId ? filas.find((f) => f.branch_id === branchId) : undefined
    const comodin = filas.find((f) => f.branch_id === null)
    const elegido = propio ?? comodin
    return elegido ? { id: elegido.id, numero: elegido.numero } : null
}
