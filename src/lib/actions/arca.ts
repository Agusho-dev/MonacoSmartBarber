'use server'

// =============================================================================
// src/lib/actions/arca.ts
// Server actions del facturador ARCA.
//
// Ojo con Next 16: en un archivo `'use server'` TODOS los exports tienen que ser
// funciones async. Las constantes y las etiquetas viven en `@/lib/arca/*`, que
// además es lo que importan los componentes de cliente.
//
// Reglas que sigue este módulo, tomadas de los golpes que ya se comieron otros
// módulos de este repo:
//  · El error que ve el usuario es castellano; el crudo va a console.error con
//    el nombre de la función entre corchetes.
//  · Un fallo técnico NUNCA se degrada a "no hay datos". Esto es plata y fisco:
//    si no pudimos leer, se dice que no pudimos leer (Known Risk #15).
//  · Toda escritura pasa por createAdminClient() + autorización en app.
// =============================================================================

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, validateBranchAccess } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { currentUserCan } from '@/lib/actions/permissions-gate'

import {
    cifrarSecreto,
    descifrarSecreto,
    generarClaveYCsr,
    leerCertificado,
    certificadoCoincideConClave,
    hayClaveDeCifrado,
} from '@/lib/arca/crypto'
import {
    NOMBRE_CBTE,
    tipoFacturaPara,
    type AmbienteArca,
    type CondicionIvaEmisor,
} from '@/lib/arca/config'
import { feDummy, feParamGetPtosVenta, ErrorWsfe } from '@/lib/arca/wsfe'
import { traducirErrorArca, diagnosticoPuntosVenta, type ErrorTraducido } from '@/lib/arca/errores'
import type { EstadoCupo, PoliticaCupo } from '@/lib/arca/cupo'
import {
    cargarContribuyente,
    contextoWsfe,
    cuitEsValido,
    limpiarCuit,
    type FilaContribuyente,
} from '@/lib/arca/contexto'

// -----------------------------------------------------------------------------
// Tipos de vista
// -----------------------------------------------------------------------------

export interface ContribuyenteVista {
    id: string
    ambiente: AmbienteArca
    modoAuth: 'certificado_propio' | 'delegacion'
    cuit: string
    razonSocial: string | null
    condicionIva: CondicionIvaEmisor
    domicilioComercial: string | null
    inicioActividades: string | null
    ingresosBrutos: string | null
    estado: string
    tieneClave: boolean
    tieneCsr: boolean
    tieneCertificado: boolean
    certVence: string | null
    certDiasParaVencer: number | null
    ultimaVerificacion: string | null
    ultimaVerificacionOk: boolean | null
    ultimoError: string | null
    tipoFactura: number
    nombreTipoFactura: string
}

export interface PuntoVentaVista {
    id: string
    numero: number
    descripcion: string | null
    branchId: string | null
    branchName: string | null
    activo: boolean
}

export interface PoliticaVista {
    id: string
    branchId: string | null
    branchName: string | null
    habilitada: boolean
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    objetivoCantidad: number | null
    objetivoMonto: number | null
    estrategia: PoliticaCupo['estrategia']
    metodosPago: string[]
    ticketMinimo: number | null
    ticketMaximo: number | null
    incluyePropinas: boolean
    permitirExceso: boolean
    diasHaciaAtras: number
    emisionAutomatica: boolean
    horaEmision: number
    cupo: EstadoCupo | null
}

export interface ComprobanteVista {
    id: string
    numero: string
    tipo: number
    nombreTipo: string
    letra: string
    fecha: string
    total: number
    estado: string
    cae: string | null
    caeVto: string | null
    branchName: string | null
    clienteNombre: string | null
    visitId: string | null
    error: string | null
    qrUrl: string | null
    emitidoVia: string
    creado: string
}

export interface ChecklistItem {
    clave: string
    titulo: string
    detalle: string
    estado: 'listo' | 'pendiente' | 'error' | 'informativo'
    accion?: string
}

export interface EstadoFacturador {
    configurado: boolean
    faltaClaveDeCifrado: boolean
    contribuyente: ContribuyenteVista | null
    puntosVenta: PuntoVentaVista[]
    politicas: PoliticaVista[]
    checklist: ChecklistItem[]
    sucursales: { id: string; name: string }[]
    /** Distingue "no hay nada configurado" de "no pudimos leer". */
    error: string | null
}

// -----------------------------------------------------------------------------
// Lectura del estado general
// -----------------------------------------------------------------------------

function vistaContribuyente(t: FilaContribuyente): ContribuyenteVista {
    const vence = t.cert_not_after ? new Date(t.cert_not_after) : null
    const tipo = tipoFacturaPara(t.condicion_iva)
    return {
        id: t.id,
        ambiente: t.environment,
        modoAuth: t.auth_mode,
        cuit: t.cuit,
        razonSocial: t.razon_social,
        condicionIva: t.condicion_iva,
        domicilioComercial: t.domicilio_comercial,
        inicioActividades: t.inicio_actividades,
        ingresosBrutos: t.ingresos_brutos,
        estado: t.status,
        tieneClave: !!t.private_key_enc,
        tieneCsr: !!t.csr_pem,
        tieneCertificado: !!t.certificate_pem,
        certVence: t.cert_not_after,
        certDiasParaVencer: vence ? Math.floor((vence.getTime() - Date.now()) / 86_400_000) : null,
        ultimaVerificacion: t.last_check_at,
        ultimaVerificacionOk: t.last_check_ok,
        ultimoError: t.last_check_error,
        tipoFactura: tipo,
        nombreTipoFactura: NOMBRE_CBTE[tipo] ?? 'Factura',
    }
}

/**
 * Fechas del checklist con la zona horaria de la ORGANIZACIÓN.
 *
 * `toLocaleString('es-AR')` sin `timeZone` sólo fija el FORMATO: la zona la
 * toma del proceso, que en Vercel es UTC. Sin esto, el mismo evento se veía con
 * dos horas distintas en la misma pantalla — la del cliente (correcta) y la del
 * servidor (corrida), y un certificado que vence 00:30 UTC se anunciaba con un
 * día de más.
 */
function fechaLocal(iso: string | null | undefined, tz: string, conHora = false): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-AR', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
    })
}

function armarChecklist(
    c: ContribuyenteVista | null,
    puntos: PuntoVentaVista[],
    politicas: PoliticaVista[],
    faltaClave: boolean,
    tz: string,
): ChecklistItem[] {
    const items: ChecklistItem[] = []

    if (faltaClave) {
        items.push({
            clave: 'clave_cifrado',
            titulo: 'Falta la clave de cifrado del facturador',
            detalle:
                'Sin ella no podemos guardar el certificado de forma segura. Vive en Supabase Vault, ' +
                'con el nombre `arca_encryption_key`, y la crea la migración 179.',
            estado: 'error',
            accion: 'Verificá que la migración 179 se haya aplicado y recargá esta página.',
        })
    }

    items.push({
        clave: 'datos_fiscales',
        titulo: 'Datos fiscales',
        detalle: c
            ? `CUIT ${c.cuit} · ${c.condicionIva === 'monotributo' ? 'Monotributo' : c.condicionIva === 'exento' ? 'Exento' : 'Responsable Inscripto'} · emite ${c.nombreTipoFactura}`
            : 'Todavía no cargaste el CUIT ni la condición fiscal.',
        estado: c ? 'listo' : 'pendiente',
    })

    if (c?.modoAuth === 'delegacion') {
        items.push({
            clave: 'delegacion',
            titulo: 'Autorización en ARCA',
            detalle:
                c.ultimaVerificacionOk
                    ? 'ARCA reconoce la autorización.'
                    : 'Falta autorizar a la plataforma en el Administrador de Relaciones de ARCA.',
            estado: c.ultimaVerificacionOk ? 'listo' : 'pendiente',
        })
    } else {
        items.push({
            clave: 'certificado',
            titulo: 'Certificado digital',
            detalle: !c
                ? 'Primero cargá los datos fiscales.'
                : c.tieneCertificado
                    ? `Vence el ${fechaLocal(c.certVence, tz)}` +
                      (c.certDiasParaVencer !== null && c.certDiasParaVencer < 30
                          ? ` · quedan ${c.certDiasParaVencer} días`
                          : '')
                    : c.tieneCsr
                        ? 'Ya generamos el pedido. Falta subir el certificado que devuelve ARCA.'
                        : 'Todavía no generamos el pedido de certificado.',
            estado: !c
                ? 'pendiente'
                : c.tieneCertificado
                    ? (c.certDiasParaVencer !== null && c.certDiasParaVencer < 0 ? 'error' : 'listo')
                    : 'pendiente',
        })
    }

    const utilizables = puntos.filter((p) => p.activo)
    items.push({
        clave: 'punto_venta',
        titulo: 'Punto de venta',
        detalle: utilizables.length
            ? utilizables.map((p) => `N° ${String(p.numero).padStart(5, '0')}${p.branchName ? ` → ${p.branchName}` : ''}`).join(' · ')
            : 'Falta dar de alta un punto de venta para Web Services en ARCA.',
        estado: utilizables.length ? 'listo' : 'pendiente',
    })

    items.push({
        clave: 'conexion',
        titulo: 'Conexión con ARCA',
        detalle: c?.ultimaVerificacion
            ? `${c.ultimaVerificacionOk ? 'Verificada' : 'Falló'} el ${fechaLocal(c.ultimaVerificacion, tz, true)}` +
              (c.ultimaVerificacionOk ? '' : ` · ${c.ultimoError ?? ''}`)
            : 'Todavía no probamos la conexión.',
        estado: !c?.ultimaVerificacion ? 'pendiente' : c.ultimaVerificacionOk ? 'listo' : 'error',
    })

    const conCupo = politicas.filter((p) => p.habilitada)
    items.push({
        clave: 'politica',
        titulo: 'Qué se factura',
        detalle: conCupo.length
            ? conCupo
                  .map((p) =>
                      p.modo === 'cantidad'
                          ? `${p.branchName ?? 'Toda la organización'}: ${p.objetivoCantidad} comprobantes ${p.periodo === 'mes' ? 'por mes' : p.periodo === 'semana' ? 'por semana' : 'por día'}`
                          : p.modo === 'monto'
                              ? `${p.branchName ?? 'Toda la organización'}: hasta $${Number(p.objetivoMonto ?? 0).toLocaleString('es-AR')} ${p.periodo === 'mes' ? 'por mes' : p.periodo === 'semana' ? 'por semana' : 'por día'}`
                              : `${p.branchName ?? 'Toda la organización'}: a mano`,
                  )
                  .join(' · ')
            : 'Sin cupo definido: no se factura nada automáticamente.',
        estado: conCupo.length ? 'listo' : 'informativo',
    })

    if (c?.ambiente === 'homologacion') {
        items.push({
            clave: 'ambiente',
            titulo: 'Estás en el ambiente de pruebas',
            detalle:
                'Los comprobantes que emitas acá NO tienen validez fiscal. Sirven para verificar que todo funcione ' +
                'antes de salir a producción.',
            estado: 'informativo',
        })
    }

    return items
}

/** Todo lo que necesita la pantalla del facturador, en una sola llamada. */
export async function getEstadoFacturador(): Promise<EstadoFacturador> {
    const vacio: EstadoFacturador = {
        configurado: false,
        faltaClaveDeCifrado: false,
        contribuyente: null,
        puntosVenta: [],
        politicas: [],
        checklist: [],
        sucursales: [],
        error: null,
    }

    if (!(await currentUserCan('arca.view'))) {
        return { ...vacio, error: 'No tenés permiso para ver el facturador.' }
    }

    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...vacio, error: 'No autorizado.' }

    const faltaClave = !(await hayClaveDeCifrado())
    const supabase = createAdminClient()
    const branchIds = await getScopedBranchIds()

    const t = await cargarContribuyente(orgId)

    const [pvRes, polRes, sucRes] = await Promise.all([
        t
            ? supabase
                  .from('arca_sales_points')
                  .select('id, numero, descripcion, branch_id, is_active')
                  .eq('taxpayer_id', t.id)
                  .order('numero')
            : Promise.resolve({ data: [], error: null }),
        supabase
            .from('arca_billing_policies')
            .select('*')
            .eq('organization_id', orgId),
        branchIds.length
            ? supabase.from('branches').select('id, name').in('id', branchIds).eq('is_active', true).order('name')
            : Promise.resolve({ data: [], error: null }),
    ])

    if (pvRes.error || polRes.error || sucRes.error) {
        console.error('[getEstadoFacturador]', pvRes.error?.message, polRes.error?.message, sucRes.error?.message)
        return { ...vacio, faltaClaveDeCifrado: faltaClave, error: 'No pudimos leer la configuración del facturador.' }
    }

    const sucursales = (sucRes.data ?? []) as { id: string; name: string }[]
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.name]))

    const puntosVenta: PuntoVentaVista[] = ((pvRes.data ?? []) as any[]).map((p) => ({
        id: p.id,
        numero: p.numero,
        descripcion: p.descripcion,
        branchId: p.branch_id,
        branchName: p.branch_id ? nombreSucursal.get(p.branch_id) ?? null : null,
        activo: p.is_active,
    }))

    // El cupo de cada política se deriva en la base — nunca de un contador.
    const politicas: PoliticaVista[] = []
    for (const p of (polRes.data ?? []) as any[]) {
        const { data: cupoData, error: cupoErr } = await supabase.rpc('arca_quota_state', { p_policy_id: p.id })
        if (cupoErr) console.error('[getEstadoFacturador/cupo]', cupoErr.message)
        const fila = Array.isArray(cupoData) ? cupoData[0] : cupoData
        politicas.push({
            id: p.id,
            branchId: p.branch_id,
            branchName: p.branch_id ? nombreSucursal.get(p.branch_id) ?? null : null,
            habilitada: p.is_enabled,
            modo: p.mode,
            periodo: p.period,
            objetivoCantidad: p.target_count,
            objetivoMonto: p.target_amount !== null ? Number(p.target_amount) : null,
            estrategia: p.selection,
            metodosPago: p.payment_methods ?? [],
            ticketMinimo: p.min_ticket !== null ? Number(p.min_ticket) : null,
            ticketMaximo: p.max_ticket !== null ? Number(p.max_ticket) : null,
            incluyePropinas: p.include_tips,
            permitirExceso: p.allow_overflow,
            diasHaciaAtras: p.lookback_days,
            emisionAutomatica: p.auto_emit,
            horaEmision: p.auto_emit_hour,
            cupo: fila
                ? {
                      periodoDesde: fila.period_start,
                      periodoHasta: fila.period_end,
                      emitidos: Number(fila.emitted_count ?? 0),
                      montoEmitido: Number(fila.emitted_amount ?? 0),
                      objetivoCantidad: fila.target_count,
                      objetivoMonto: fila.target_amount !== null ? Number(fila.target_amount) : null,
                      restanteCantidad: Number(fila.remaining_count ?? 0),
                      restanteMonto: Number(fila.remaining_amount ?? 0),
                  }
                : null,
        })
    }

    const contribuyente = t ? vistaContribuyente(t) : null

    const { data: org } = await supabase
        .from('organizations')
        .select('timezone')
        .eq('id', orgId)
        .maybeSingle()
    const tzOrg = org?.timezone ?? 'America/Argentina/Buenos_Aires'

    return {
        configurado: !!contribuyente?.ultimaVerificacionOk && puntosVenta.some((p) => p.activo),
        faltaClaveDeCifrado: faltaClave,
        contribuyente,
        puntosVenta,
        politicas,
        checklist: armarChecklist(contribuyente, puntosVenta, politicas, faltaClave, tzOrg),
        sucursales,
        error: null,
    }
}

// -----------------------------------------------------------------------------
// Wizard: datos fiscales
// -----------------------------------------------------------------------------

const DatosFiscalesSchema = z.object({
    cuit: z.string(),
    razonSocial: z.string().trim().min(2, 'La razón social es muy corta').max(200),
    condicionIva: z.enum(['monotributo', 'responsable_inscripto', 'exento']),
    ambiente: z.enum(['homologacion', 'produccion']),
    modoAuth: z.enum(['certificado_propio', 'delegacion']),
    domicilioComercial: z.string().trim().max(300).optional().or(z.literal('')),
    inicioActividades: z.string().trim().optional().or(z.literal('')),
    ingresosBrutos: z.string().trim().max(60).optional().or(z.literal('')),
})

export async function guardarDatosFiscales(input: {
    cuit: string
    razonSocial: string
    condicionIva: CondicionIvaEmisor
    ambiente: AmbienteArca
    modoAuth?: 'certificado_propio' | 'delegacion'
    domicilioComercial?: string
    inicioActividades?: string
    ingresosBrutos?: string
}): Promise<{ ok: true; taxpayerId: string } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const parsed = DatosFiscalesSchema.safeParse({ ...input, modoAuth: input.modoAuth ?? 'certificado_propio' })
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }

    const cuit = limpiarCuit(parsed.data.cuit)
    if (!cuitEsValido(cuit)) {
        return { error: 'El CUIT no es válido. Revisá que tenga 11 dígitos y esté bien tipeado.' }
    }

    const supabase = createAdminClient()

    // Una fila por (org, ambiente, cuit). Si ya existe, se actualizan los datos
    // y se deja el certificado como está: cambiar la razón social no puede
    // borrar un certificado que costó un trámite conseguir.
    const { data: existente } = await supabase
        .from('arca_taxpayers')
        .select('id')
        .eq('organization_id', orgId)
        .eq('environment', parsed.data.ambiente)
        .eq('cuit', cuit)
        .maybeSingle()

    const fila = {
        organization_id: orgId,
        environment: parsed.data.ambiente,
        auth_mode: parsed.data.modoAuth,
        cuit,
        razon_social: parsed.data.razonSocial,
        condicion_iva: parsed.data.condicionIva,
        domicilio_comercial: parsed.data.domicilioComercial || null,
        inicio_actividades: parsed.data.inicioActividades || null,
        ingresos_brutos: parsed.data.ingresosBrutos || null,
    }

    const res = existente
        ? await supabase.from('arca_taxpayers').update(fila).eq('id', existente.id).select('id').single()
        : await supabase.from('arca_taxpayers').insert(fila).select('id').single()

    if (res.error) {
        console.error('[guardarDatosFiscales]', res.error.message)
        return { error: 'No se pudieron guardar los datos fiscales.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, taxpayerId: res.data.id }
}

// -----------------------------------------------------------------------------
// Wizard: certificado
// -----------------------------------------------------------------------------

/**
 * Genera la clave privada y el pedido de certificado (CSR).
 *
 * La clave privada se guarda cifrada y NO se devuelve nunca. Lo único que baja
 * el usuario es el CSR, que es público: sin la clave privada no sirve para
 * nada. Es la diferencia entre este flujo y el de los ERP que te hacen correr
 * openssl y terminás con la clave dando vueltas en Descargas.
 */
export async function generarPedidoCertificado(): Promise<
    { ok: true; csrPem: string; alias: string; nombreArchivo: string } | { error: string }
> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    if (!(await hayClaveDeCifrado())) {
        return {
            error:
                'Falta la clave de cifrado del facturador (secreto `arca_encryption_key` en Supabase Vault). ' +
                'La crea la migración 179.',
        }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const t = await cargarContribuyente(orgId)
    if (!t) return { error: 'Primero cargá los datos fiscales.' }

    let generado: ReturnType<typeof generarClaveYCsr>
    try {
        generado = generarClaveYCsr({
            cuit: t.cuit,
            razonSocial: t.razon_social ?? `CUIT ${t.cuit}`,
            // El alias sale de la razón social, no de una palabra fija. Es sólo
            // una etiqueta dentro del portal de ARCA (no sale en la factura ni
            // tiene efecto fiscal), pero acá cada barbero es un monotributista
            // aparte: con "barberos-XXXX" para todos, el dueño abre el portal y
            // no sabe cuál es cuál.
            alias: `${t.razon_social ?? 'facturacion'}-${t.cuit.slice(-4)}`,
        })
    } catch (e) {
        console.error('[generarPedidoCertificado]', e)
        return { error: e instanceof Error ? e.message : 'No se pudo generar el pedido de certificado.' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase
        .from('arca_taxpayers')
        .update({
            private_key_enc: await cifrarSecreto(generado.privateKeyPem),
            csr_pem: generado.csrPem,
            cert_alias: generado.alias,
            cert_subject: generado.subject,
            // Se limpia el certificado anterior: quedó huérfano de su clave.
            certificate_pem: null,
            cert_not_before: null,
            cert_not_after: null,
            cert_serial: null,
            status: 'csr_generado',
        })
        .eq('id', t.id)

    if (error) {
        console.error('[generarPedidoCertificado] guardado', error.message)
        return { error: 'No se pudo guardar el pedido de certificado.' }
    }

    revalidatePath('/dashboard/facturacion')
    return {
        ok: true,
        csrPem: generado.csrPem,
        alias: generado.alias,
        nombreArchivo: `${generado.alias}.csr`,
    }
}

/**
 * Carga el .crt que devolvió ARCA.
 *
 * Antes de guardarlo se verifica que corresponda a NUESTRA clave privada. Ese
 * chequeo evita el error más común del onboarding: el usuario tiene tres
 * archivos en Descargas y sube el que no es. Sin esta validación se enteraría
 * recién al emitir, con un error críptico de WSAA.
 */
export async function cargarCertificado(certificadoPem: string): Promise<
    { ok: true; vence: string; diasParaVencer: number } | { error: string }
> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const pem = (certificadoPem || '').trim()
    if (!pem) return { error: 'No recibimos ningún archivo.' }

    if (pem.includes('CERTIFICATE REQUEST')) {
        return {
            error:
                'Ese es el pedido de certificado (.csr), no el certificado. Subí el archivo .crt que descargaste ' +
                'de ARCA después de cargar el pedido.',
        }
    }
    if (pem.includes('PRIVATE KEY')) {
        return { error: 'Ese archivo contiene una clave privada. Subí solamente el .crt que te dio ARCA.' }
    }
    if (!pem.includes('BEGIN CERTIFICATE')) {
        return { error: 'El archivo no parece un certificado. Tiene que empezar con "-----BEGIN CERTIFICATE-----".' }
    }

    const t = await cargarContribuyente(orgId)
    if (!t) return { error: 'Primero cargá los datos fiscales.' }
    if (!t.private_key_enc) return { error: 'Primero generá el pedido de certificado.' }

    let datos: ReturnType<typeof leerCertificado>
    try {
        datos = leerCertificado(pem)
    } catch (e) {
        return { error: e instanceof Error ? e.message : 'No pudimos leer el certificado.' }
    }

    let clave: string
    try {
        clave = await descifrarSecreto(t.private_key_enc)
    } catch {
        return { error: 'No pudimos leer la clave privada guardada. Generá el pedido de certificado de nuevo.' }
    }

    if (!certificadoCoincideConClave(pem, clave)) {
        return {
            error:
                'Ese certificado no corresponde al pedido que generamos. Puede ser de otro sistema o de un pedido ' +
                'anterior. Descargá el .crt del alias que creaste con NUESTRO pedido, o generá uno nuevo.',
        }
    }

    if (datos.cuit && datos.cuit !== t.cuit) {
        return {
            error: `El certificado es del CUIT ${datos.cuit} y acá está configurado el ${t.cuit}. Revisá cuál corresponde.`,
        }
    }
    if (datos.diasParaVencer < 0) {
        return { error: `Ese certificado venció el ${datos.notAfter.toLocaleDateString('es-AR')}.` }
    }

    const supabase = createAdminClient()
    const { error } = await supabase
        .from('arca_taxpayers')
        .update({
            certificate_pem: pem,
            cert_subject: datos.subject,
            cert_serial: datos.serial,
            cert_not_before: datos.notBefore.toISOString(),
            cert_not_after: datos.notAfter.toISOString(),
            status: 'certificado_cargado',
        })
        .eq('id', t.id)

    if (error) {
        console.error('[cargarCertificado]', error.message)
        return { error: 'No se pudo guardar el certificado.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, vence: datos.notAfter.toISOString(), diasParaVencer: datos.diasParaVencer }
}

// -----------------------------------------------------------------------------
// Wizard: verificación contra ARCA
// -----------------------------------------------------------------------------

export interface ResultadoVerificacion {
    servidores: { app: string; db: string; auth: string; todoOk: boolean } | null
    puntosVenta: { numero: number; utilizable: boolean; emisionTipo: string }[]
    diagnostico: ErrorTraducido | null
    ok: boolean
}

/**
 * Prueba la configuración de punta a punta y guarda el resultado.
 *
 * Hace dos llamadas, en este orden y por un motivo:
 *   1. FEDummy — no necesita credenciales. Si falla, ARCA está caída y no tiene
 *      sentido culpar a la configuración del usuario.
 *   2. FEParamGetPtosVenta — valida el certificado, la autorización del servicio
 *      y la existencia del punto de venta, todo de una. Y de paso trae los
 *      números, así el usuario los elige de una lista en vez de tipearlos.
 */
export async function verificarConexionArca(): Promise<
    { ok: true; data: ResultadoVerificacion } | { error: string; data?: ResultadoVerificacion }
> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const t = await cargarContribuyente(orgId)
    if (!t) return { error: 'Primero cargá los datos fiscales.' }

    const supabase = createAdminClient()
    // Se guarda el título legible Y el motivo crudo. Sin el crudo, un problema
    // de TLS ("dh key too small") se ve idéntico a un problema de red y se
    // diagnostica a mano; con él, la causa está en la propia fila.
    const guardarResultado = async (ok: boolean, mensaje: string | null, crudo?: string | null) => {
        const detalle = crudo && crudo !== mensaje ? `${mensaje} · ${crudo}`.slice(0, 500) : mensaje
        const { error } = await supabase
            .from('arca_taxpayers')
            .update({
                last_check_at: new Date().toISOString(),
                last_check_ok: ok,
                last_check_error: ok ? null : detalle,
                status: ok ? (t.environment === 'produccion' ? 'activo' : 'verificado') : 'error',
            })
            .eq('id', t.id)
        if (error) console.error('[verificarConexionArca] guardado', error.message)
    }

    // 1. ¿Está viva ARCA?
    let servidores: ResultadoVerificacion['servidores'] = null
    try {
        const d = await feDummy(t.environment)
        servidores = { app: d.appServer, db: d.dbServer, auth: d.authServer, todoOk: d.todoOk }
        if (!d.todoOk) {
            const msg = `ARCA reporta servicios caídos (app: ${d.appServer}, db: ${d.dbServer}, auth: ${d.authServer}).`
            await guardarResultado(false, msg)
            return {
                error: msg,
                data: {
                    servidores,
                    puntosVenta: [],
                    ok: false,
                    diagnostico: {
                        titulo: 'ARCA está con problemas',
                        detalle: msg,
                        accion: 'No es tu configuración. Probá de nuevo más tarde.',
                        culpa: 'arca',
                        reintentable: true,
                        codigo: 'dummy',
                    },
                },
            }
        }
    } catch (e) {
        const err = e instanceof ErrorWsfe ? e : null
        const traducido = traducirErrorArca(err?.codigo ?? 'red', err?.message ?? String(e))
        console.error('[verificarConexionArca/FEDummy]', err?.codigo, err?.crudo ?? e)
        await guardarResultado(false, traducido.titulo, err?.crudo ?? null)
        return { error: traducido.titulo, data: { servidores: null, puntosVenta: [], diagnostico: traducido, ok: false } }
    }

    // 2. ¿Nos deja operar en nombre de este CUIT?
    const ctx = await contextoWsfe(t)
    if ('error' in ctx) {
        await guardarResultado(false, ctx.error)
        return {
            error: ctx.error,
            data: { servidores, puntosVenta: [], diagnostico: ctx.traducido ?? null, ok: false },
        }
    }

    try {
        const pvs = await feParamGetPtosVenta(ctx)
        const utilizables = pvs.filter((p) => p.utilizable)

        // Se guardan los que ARCA reconoce, sin pisar la asignación a sucursal
        // que el usuario ya haya hecho.
        for (const pv of utilizables) {
            const { data: yaEsta } = await supabase
                .from('arca_sales_points')
                .select('id')
                .eq('taxpayer_id', t.id)
                .eq('numero', pv.numero)
                .maybeSingle()
            if (!yaEsta) {
                const { error } = await supabase.from('arca_sales_points').insert({
                    taxpayer_id: t.id,
                    organization_id: orgId,
                    numero: pv.numero,
                    descripcion: pv.emisionTipo || null,
                    branch_id: null,
                    is_active: true,
                })
                if (error) console.error('[verificarConexionArca] alta PV', error.message)
            }
        }

        const diagnostico = diagnosticoPuntosVenta(pvs.length, utilizables.length)
        const ok = utilizables.length > 0
        await guardarResultado(ok, ok ? null : diagnostico?.titulo ?? 'Sin puntos de venta')

        revalidatePath('/dashboard/facturacion')
        return {
            ok: true,
            data: {
                servidores,
                puntosVenta: pvs.map((p) => ({ numero: p.numero, utilizable: p.utilizable, emisionTipo: p.emisionTipo })),
                diagnostico,
                ok,
            },
        }
    } catch (e) {
        const err = e instanceof ErrorWsfe ? e : null
        const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))
        console.error('[verificarConexionArca]', err?.codigo, err?.crudo ?? err?.message ?? e)
        await guardarResultado(false, traducido.titulo, err?.crudo ?? null)
        return { error: traducido.titulo, data: { servidores, puntosVenta: [], diagnostico: traducido, ok: false } }
    }
}

/** Asigna un punto de venta a una sucursal (o lo deja como comodín de la org). */
export async function asignarPuntoVenta(
    salesPointId: string,
    branchId: string | null,
): Promise<{ ok: true } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    if (branchId) {
        const okBranch = await validateBranchAccess(branchId)
        if (!okBranch) return { error: 'Esa sucursal no es de tu organización.' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase
        .from('arca_sales_points')
        .update({ branch_id: branchId })
        .eq('id', salesPointId)
        .eq('organization_id', orgId)

    if (error) {
        console.error('[asignarPuntoVenta]', error.message)
        // El índice único impide dos puntos de venta activos para la misma
        // sucursal: sería una numeración partida en dos.
        if (error.code === '23505') {
            return { error: 'Esa sucursal ya tiene otro punto de venta asignado. Sacáselo primero.' }
        }
        return { error: 'No se pudo asignar el punto de venta.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true }
}
