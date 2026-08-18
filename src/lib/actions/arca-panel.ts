'use server'

// =============================================================================
// src/lib/actions/arca-panel.ts
// El panel único: un monotributo por barbero, administrado por los dueños.
//
// Cada barbero de Monaco tiene su propio monotributo y factura sus propios
// cortes; los dueños deciden CUÁNTO se le factura a cada uno. Este módulo
// arma, en una sola llamada, todo lo que el panel necesita para responder de un
// vistazo las tres preguntas que importan:
//
//   1. ¿Quién puede facturar y quién no? (estado de configuración)
//   2. ¿Cuánto lleva facturado este mes?  (el cupo, la palanca)
//   3. ¿Qué tan cerca está de su tope?    (12 meses móviles, el límite real)
//
// La 3 es la que gobierna: el cupo mensual es una decisión, el tope anual es
// una restricción de ARCA. Un panel que muestre sólo el cupo deja al dueño
// mirando la palanca sin ver la pared.
// =============================================================================

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { cuitEsValido, limpiarCuit } from '@/lib/arca/contexto'
import { correrPolitica } from '@/lib/arca/motor'
import { errorPuntoVentaContingencia } from '@/lib/arca/errores'
import type { ResultadoLote } from '@/lib/arca/motor'
import type { CondicionIvaEmisor } from '@/lib/arca/config'

// -----------------------------------------------------------------------------
// Tipos de vista
// -----------------------------------------------------------------------------

export type EstadoBarbero =
    | 'sin_monotributo'   // el barbero existe pero no tiene CUIT cargado
    | 'sin_certificado'   // tiene CUIT, falta el trámite del certificado
    | 'sin_punto_venta'   // certificado listo, falta dar de alta el PV en ARCA
    // Tiene punto de venta en ARCA, vivo y sin bloquear, pero es de CONTINGENCIA
    // (CAEA). Es un estado propio y no 'sin_punto_venta' porque la solución es
    // distinta: no hay que "dar de alta un punto de venta" —ya lo hizo— hay que
    // dar de alta OTRO, del tipo Web Services. Decirle que le falta uno cuando
    // en la pantalla de ARCA ve el suyo ahí es la peor forma de no ayudarlo.
    | 'pv_contingencia'
    | 'listo'
    | 'error'

export type OrigenVentas = 'propios' | 'sucursal' | 'organizacion'

export interface CupoMensual {
    policyId: string | null
    habilitada: boolean
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    /** De dónde salen los cortes que factura. Clave para quien no corta. */
    origen: OrigenVentas
    objetivoCantidad: number | null
    objetivoMonto: number | null
    emitidos: number
    montoEmitido: number
    restanteCantidad: number
    restanteMonto: number
    periodoDesde: string
    periodoHasta: string
}

export interface EstadoAnual {
    desde: string
    hasta: string
    facturado12m: number
    comprobantes12m: number
    topeAnual: number | null
    categoria: string | null
    restante: number
    /** 0–100+, o null si no hay categoría cargada. */
    porcentaje: number | null
    /**
     * Cierre estimado a 12 meses según el ritmo reciente, o `null` cuando todavía
     * no hay historia suficiente para proyectar (menos de 14 días facturando).
     *
     * `null` y no 0: anualizar cuatro días es multiplicar el ruido por 91, y esa
     * cifra alimenta el bloque de alerta del panel. "Todavía no sabemos" es una
     * respuesta mejor que un número inventado — y muy distinta de "cierra en $0".
     */
    proyectadoAnual: number | null
    /** Cuánto se pasaría del tope a ese ritmo. 0 si no se pasa. */
    excesoProyectado: number
}

export interface FilaPanel {
    staffId: string
    nombre: string
    sucursal: string
    avatarUrl: string | null

    taxpayerId: string | null
    cuit: string | null
    razonSocial: string | null
    categoria: string | null
    ambiente: 'homologacion' | 'produccion' | null

    estado: EstadoBarbero
    detalleEstado: string

    cupo: CupoMensual | null
    anual: EstadoAnual | null

    /** Ventas suyas todavía sin comprobante, en la ventana de la política. */
    sinFacturar: { cantidad: number; monto: number }

    /** true si conviene mirarlo ya: cerca del tope, o con error. */
    requiereAtencion: boolean
}

export interface PanelFacturacion {
    filas: FilaPanel[]
    resumen: {
        totalBarberos: number
        listos: number
        enRiesgo: number
        facturadoMes: number
        comprobantesMes: number
        pendientesDeFacturar: number
    }
    /** Categorías de monotributo vigentes, para los selectores. */
    categorias: { categoria: string; topeAnual: number; cuotaServicios: number | null }[]
    /** Barberos que todavía no tienen monotributo, para el alta. */
    barberosSinMonotributo: { id: string; nombre: string; sucursal: string }[]
    error: string | null
}

const VACIO: PanelFacturacion = {
    filas: [],
    resumen: {
        totalBarberos: 0, listos: 0, enRiesgo: 0,
        facturadoMes: 0, comprobantesMes: 0, pendientesDeFacturar: 0,
    },
    categorias: [],
    barberosSinMonotributo: [],
    error: null,
}

/** A partir de este porcentaje del tope anual, el barbero entra en zona de riesgo. */
const UMBRAL_RIESGO = 85

// -----------------------------------------------------------------------------
// Lectura del panel
// -----------------------------------------------------------------------------

export async function getPanelFacturacion(): Promise<PanelFacturacion> {
    if (!(await currentUserCan('arca.view'))) return { ...VACIO, error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...VACIO, error: 'No autorizado.' }

    const supabase = createAdminClient()
    const branchIds = await getScopedBranchIds()
    if (branchIds.length === 0) return VACIO

    // UNA sola consulta para todo el panel (mig 184). La versión anterior hacía
    // tres RPC por barbero: con 20 barberos eran 60 idas y vueltas y entre 6 y
    // 10 segundos de pantalla en blanco.
    const [panelRes, catsRes] = await Promise.all([
        supabase.rpc('arca_panel_barberos', {
            p_organization_id: orgId,
            p_branch_ids: branchIds,
        }),
        supabase.from('arca_monotributo_categorias').select('*').order('tope_anual'),
    ])

    if (panelRes.error || catsRes.error) {
        console.error('[getPanelFacturacion]', panelRes.error?.message, catsRes.error?.message)
        // Nunca degradar a panel vacío: sería decirle al dueño que no hay nada
        // configurado cuando en realidad no pudimos leer.
        return { ...VACIO, error: 'No pudimos leer el panel de facturación.' }
    }

    let facturadoMes = 0
    let comprobantesMes = 0
    let pendientes = 0

    const filas: FilaPanel[] = ((panelRes.data ?? []) as any[]).map((r) => {
        // --- estado de configuración ---
        let estado: EstadoBarbero = 'sin_monotributo'
        let detalle = 'Todavía no tiene monotributo cargado.'
        if (r.taxpayer_id) {
            if (!r.tiene_certificado) {
                estado = 'sin_certificado'
                detalle = r.tiene_csr
                    ? 'Falta subir el certificado que devuelve ARCA.'
                    : 'Falta generar el pedido de certificado.'
            } else if ((r.puntos_venta ?? 0) === 0 && (r.puntos_venta_contingencia ?? 0) > 0) {
                const traducido = errorPuntoVentaContingencia([], r.emision_tipo_contingencia)
                estado = 'pv_contingencia'
                detalle = `${traducido.detalle} ${traducido.accion ?? ''}`.trim()
            } else if ((r.puntos_venta ?? 0) === 0) {
                estado = 'sin_punto_venta'
                detalle = 'Falta dar de alta un punto de venta para Web Services en ARCA.'
            } else if (r.last_check_ok === false) {
                estado = 'error'
                detalle = r.last_check_error ?? 'La última prueba de conexión falló.'
            } else {
                estado = 'listo'
                detalle = r.last_check_at ? 'Listo para facturar.' : 'Falta probar la conexión con ARCA.'
            }
        }

        const cupo: CupoMensual | null = r.policy_id
            ? {
                  policyId: r.policy_id,
                  habilitada: r.policy_enabled,
                  modo: r.modo,
                  periodo: r.periodo,
                  origen: (r.origen ?? 'propios') as OrigenVentas,
                  objetivoCantidad: r.target_count,
                  objetivoMonto: r.target_amount !== null ? Number(r.target_amount) : null,
                  emitidos: Number(r.emitidos_periodo ?? 0),
                  montoEmitido: Number(r.monto_periodo ?? 0),
                  restanteCantidad: Math.max((r.target_count ?? 0) - Number(r.emitidos_periodo ?? 0), 0),
                  restanteMonto: Math.max(Number(r.target_amount ?? 0) - Number(r.monto_periodo ?? 0), 0),
                  periodoDesde: r.periodo_desde,
                  periodoHasta: r.periodo_hasta,
              }
            : null

        const tope = r.tope_anual !== null ? Number(r.tope_anual) : null
        const proyectado =
            r.proyectado_anual !== null && r.proyectado_anual !== undefined
                ? Number(r.proyectado_anual)
                : null
        const anual: EstadoAnual | null = r.taxpayer_id
            ? {
                  desde: '',
                  hasta: '',
                  facturado12m: Number(r.facturado_12m ?? 0),
                  comprobantes12m: Number(r.comprobantes_12m ?? 0),
                  topeAnual: tope,
                  categoria: r.categoria,
                  restante: tope ? Math.max(tope - Number(r.facturado_12m ?? 0), 0) : 0,
                  porcentaje: r.porcentaje_anual !== null ? Number(r.porcentaje_anual) : null,
                  proyectadoAnual: proyectado,
                  excesoProyectado: tope && proyectado !== null ? Math.max(proyectado - tope, 0) : 0,
              }
            : null

        // El MES, no el período del cupo. Antes se sumaba `monto_periodo`, que con
        // `period = 'semana'` es la semana: la tarjeta decía "Facturado este mes:
        // $0" un lunes con $694.000 emitidos en agosto. Y se sumaba sólo si el
        // barbero tenía cupo cargado, así que los comprobantes de uno sin cupo no
        // aparecían en ningún total.
        // Los `??` a la forma vieja no son decorativos: si la migración 188 no
        // está aplicada, la RPC sigue siendo la de la 185 y estas columnas no
        // vienen. Sin el fallback, la tarjeta pasaría a mostrar $0 (Known Risk #23).
        facturadoMes += Number(r.facturado_mes ?? r.monto_periodo ?? 0)
        comprobantesMes += Number(r.comprobantes_mes ?? r.emitidos_periodo ?? 0)

        const sinFacturar = {
            cantidad: Number(r.sin_facturar_cant ?? 0),
            monto: Number(r.sin_facturar_monto ?? 0),
        }
        // NO se acumula cuando la RPC trae el total: con tres cupos de origen
        // 'organizacion' cada fila trae el MISMO pozo del negocio y sumarlas lo
        // triplica (6.139 sobre 2.639 ventas reales).
        if (r.sin_facturar_org_cant !== undefined && r.sin_facturar_org_cant !== null) {
            pendientes = Number(r.sin_facturar_org_cant)
        } else {
            pendientes += sinFacturar.cantidad
        }

        const enRiesgo = (anual?.porcentaje ?? 0) >= UMBRAL_RIESGO || (anual?.excesoProyectado ?? 0) > 0

        return {
            staffId: r.staff_id,
            nombre: (r.nombre ?? '').trim(),
            sucursal: r.sucursal ?? '—',
            avatarUrl: r.avatar_url ?? null,
            taxpayerId: r.taxpayer_id,
            cuit: r.cuit,
            razonSocial: r.razon_social,
            categoria: r.categoria,
            ambiente: r.environment,
            estado,
            detalleEstado: detalle,
            cupo,
            anual,
            sinFacturar,
            requiereAtencion: enRiesgo || estado === 'error',
        }
    })

    // Primero lo que necesita atención; después lo que falta configurar; al
    // final lo que ya está andando. Ordenado por nombre, el problema hay que
    // buscarlo; ordenado por urgencia, aparece solo.
    // `pv_contingencia` va casi arriba: es un barbero que el dueño cree
    // configurado y que no puede emitir un solo comprobante.
    const peso: Record<EstadoBarbero, number> = {
        error: 0, pv_contingencia: 1, sin_punto_venta: 2, sin_certificado: 3, sin_monotributo: 4, listo: 5,
    }
    filas.sort((a, b) => {
        if (a.requiereAtencion !== b.requiereAtencion) return a.requiereAtencion ? -1 : 1
        if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado]
        return (b.anual?.porcentaje ?? 0) - (a.anual?.porcentaje ?? 0)
    })

    return {
        filas,
        resumen: {
            totalBarberos: filas.length,
            listos: filas.filter((f) => f.estado === 'listo').length,
            enRiesgo: filas.filter((f) => f.requiereAtencion).length,
            facturadoMes,
            comprobantesMes,
            pendientesDeFacturar: pendientes,
        },
        categorias: ((catsRes.data ?? []) as any[]).map((c) => ({
            categoria: c.categoria,
            topeAnual: Number(c.tope_anual),
            cuotaServicios: c.cuota_servicios !== null ? Number(c.cuota_servicios) : null,
        })),
        barberosSinMonotributo: filas
            .filter((f) => !f.taxpayerId)
            .map((f) => ({ id: f.staffId, nombre: f.nombre, sucursal: f.sucursal })),
        error: null,
    }
}

// -----------------------------------------------------------------------------
// Alta del monotributo de un barbero
// -----------------------------------------------------------------------------

const AltaSchema = z.object({
    staffId: z.string().uuid(),
    cuit: z.string(),
    razonSocial: z.string().trim().min(2, 'La razón social es muy corta').max(200),
    condicionIva: z.enum(['monotributo', 'responsable_inscripto', 'exento']),
    categoria: z.string().trim().max(2).nullable(),
    ambiente: z.enum(['homologacion', 'produccion']),
})

export async function vincularBarbero(input: {
    staffId: string
    cuit: string
    razonSocial: string
    condicionIva: CondicionIvaEmisor
    categoria: string | null
    ambiente: 'homologacion' | 'produccion'
}): Promise<{ ok: true; taxpayerId: string } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const parsed = AltaSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }

    const cuit = limpiarCuit(parsed.data.cuit)
    if (!cuitEsValido(cuit)) {
        return { error: 'El CUIT no es válido. Revisá que tenga 11 dígitos y esté bien tipeado.' }
    }

    const supabase = createAdminClient()

    // El barbero tiene que ser de esta organización: el staffId viene del cliente.
    const { data: staff } = await supabase
        .from('staff')
        .select('id, full_name')
        .eq('id', parsed.data.staffId)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .maybeSingle()
    if (!staff) return { error: 'Ese barbero no es de tu organización.' }

    const { data, error } = await supabase
        .from('arca_taxpayers')
        .insert({
            organization_id: orgId,
            staff_id: parsed.data.staffId,
            environment: parsed.data.ambiente,
            cuit,
            razon_social: parsed.data.razonSocial,
            condicion_iva: parsed.data.condicionIva,
            monotributo_categoria: parsed.data.categoria,
            status: 'borrador',
        })
        .select('id')
        .single()

    if (error) {
        console.error('[vincularBarbero]', error.message)
        if (error.code === '23505') {
            return { error: 'Ese barbero ya tiene un monotributo cargado en este ambiente.' }
        }
        return { error: 'No se pudo dar de alta el monotributo.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, taxpayerId: data.id }
}

/** Cambia la categoría de monotributo (o el tope a mano). */
export async function actualizarCategoria(
    taxpayerId: string,
    categoria: string | null,
    topeOverride?: number | null,
): Promise<{ ok: true } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { error } = await supabase
        .from('arca_taxpayers')
        .update({ monotributo_categoria: categoria, tope_anual_override: topeOverride ?? null })
        .eq('id', taxpayerId)
        .eq('organization_id', orgId)

    if (error) {
        console.error('[actualizarCategoria]', error.message)
        return { error: 'No se pudo guardar la categoría.' }
    }
    revalidatePath('/dashboard/facturacion')
    return { ok: true }
}

// -----------------------------------------------------------------------------
// Cupo de un barbero
// -----------------------------------------------------------------------------

// Todo lo que no es el cupo en sí va OPCIONAL: `undefined` significa
// "no lo mandé, no lo toques".
//
// El panel edita el cupo (modo, objetivo, período) y no muestra la estrategia
// ni los medios de cobro ni la emisión automática. Si el UPDATE escribiera la
// fila entera igual, guardar el cupo desde el panel pisaría todo eso con
// defaults — incluido APAGAR la emisión automática sin decir nada. Es la misma
// trampa que `updateClientNotes` borrando el Instagram (Known Risk #21): en una
// acción compartida por varias pantallas, "vaciar el campo" y "no lo mandé"
// tienen que ser cosas distintas.
const CupoSchema = z.object({
    taxpayerId: z.string().uuid(),
    habilitada: z.boolean(),
    modo: z.enum(['manual', 'cantidad', 'monto']),
    periodo: z.enum(['dia', 'semana', 'mes']),
    objetivoCantidad: z.number().int().min(0).max(100_000).nullable(),
    objetivoMonto: z.number().min(0).max(1_000_000_000).nullable(),
    estrategia: z.enum(['cronologico', 'mas_baratos', 'mas_caros', 'distribuido', 'aleatorio']).optional(),
    metodosPago: z.array(z.enum(['cash', 'card', 'transfer'])).min(1, 'Elegí al menos un medio de cobro').optional(),
    incluyePropinas: z.boolean().optional(),
    permitirExceso: z.boolean().optional(),
    diasHaciaAtras: z.number().int().min(1).max(60).optional(),
    emisionAutomatica: z.boolean().optional(),
    horaEmision: z.number().int().min(0).max(23).optional(),
    origen: z.enum(['propios', 'sucursal', 'organizacion']).optional(),
})

export async function guardarCupoBarbero(input: {
    taxpayerId: string
    habilitada: boolean
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    objetivoCantidad: number | null
    objetivoMonto: number | null
    /** Los siguientes son opcionales: si no vienen, se deja lo que ya estaba. */
    estrategia?: 'cronologico' | 'mas_baratos' | 'mas_caros' | 'distribuido' | 'aleatorio'
    metodosPago?: string[]
    incluyePropinas?: boolean
    permitirExceso?: boolean
    diasHaciaAtras?: number
    emisionAutomatica?: boolean
    horaEmision?: number
    origen?: OrigenVentas
}): Promise<{ ok: true; policyId: string } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const parsed = CupoSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
    const p = parsed.data

    if (p.modo === 'cantidad' && (p.objetivoCantidad === null || p.objetivoCantidad <= 0)) {
        return { error: 'Poné cuántos comprobantes se le facturan por período.' }
    }
    if (p.modo === 'monto' && (p.objetivoMonto === null || p.objetivoMonto <= 0)) {
        return { error: 'Poné hasta qué monto se le factura por período.' }
    }

    const supabase = createAdminClient()
    const { data: t } = await supabase
        .from('arca_taxpayers')
        .select('id, staff_id')
        .eq('id', p.taxpayerId)
        .eq('organization_id', orgId)
        .maybeSingle()
    if (!t) return { error: 'Ese monotributo no es de tu organización.' }

    // Sólo el cupo propiamente dicho se escribe siempre.
    const fila: Record<string, unknown> = {
        organization_id: orgId,
        taxpayer_id: p.taxpayerId,
        branch_id: null,
        is_enabled: p.habilitada,
        mode: p.modo,
        period: p.periodo,
        target_count: p.modo === 'cantidad' ? p.objetivoCantidad : null,
        target_amount: p.modo === 'monto' ? p.objetivoMonto : null,
    }
    // El resto, sólo si el llamador lo mandó.
    if (p.estrategia !== undefined)        fila.selection       = p.estrategia
    if (p.metodosPago !== undefined)       fila.payment_methods = p.metodosPago
    if (p.incluyePropinas !== undefined)   fila.include_tips    = p.incluyePropinas
    if (p.permitirExceso !== undefined)    fila.allow_overflow  = p.permitirExceso
    if (p.diasHaciaAtras !== undefined)    fila.lookback_days   = p.diasHaciaAtras
    // La emisión automática NO se puede prender desde acá (mig 186): la
    // facturación es manual por decisión de producto. Se ignora en vez de
    // rechazar para que un llamador viejo no rompa; el efecto es el mismo.
    if (p.emisionAutomatica === false)     fila.auto_emit       = false
    if (p.horaEmision !== undefined)       fila.auto_emit_hour  = p.horaEmision
    // La prioridad la ajusta un trigger según el origen: los del pool corren
    // después, así cada barbero se lleva lo suyo primero.
    if (p.origen !== undefined)            fila.origen          = p.origen

    const { data: existente } = await supabase
        .from('arca_billing_policies')
        .select('id')
        .eq('taxpayer_id', p.taxpayerId)
        .maybeSingle()

    const res = existente
        ? await supabase.from('arca_billing_policies').update(fila).eq('id', existente.id).select('id').single()
        : await supabase.from('arca_billing_policies').insert(fila).select('id').single()

    if (res.error) {
        console.error('[guardarCupoBarbero]', res.error.message)
        return { error: 'No se pudo guardar el cupo.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, policyId: res.data.id }
}

// -----------------------------------------------------------------------------
// Emisión
// -----------------------------------------------------------------------------

/** Factura lo que corresponda a un barbero según su cupo. */
export async function facturarPendientesDe(
    taxpayerId: string,
): Promise<ResultadoLote | { error: string }> {
    if (!(await currentUserCan('arca.emit'))) return { error: 'No tenés permiso para emitir comprobantes.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data: pol, error } = await supabase
        .from('arca_billing_policies')
        .select('id, is_enabled')
        .eq('taxpayer_id', taxpayerId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[facturarPendientesDe]', error.message)
        return { error: 'No pudimos leer el cupo de ese barbero.' }
    }
    if (!pol) return { error: 'Ese barbero todavía no tiene un cupo configurado.' }

    // El chequeo de "cupo apagado" también vive en `correrPolitica`, que es la
    // puerta que de verdad protege. Acá se repite sólo para poder decir QUÉ
    // hacer: el mensaje del motor ("La política está desactivada") es correcto y
    // completamente inútil para el dueño, que está mirando el interruptor.
    if (!pol.is_enabled) {
        return {
            error:
                'El cupo está apagado, así que no se le puede emitir nada. ' +
                'Prendé "Cupo activo" acá arriba y volvé a intentar.',
        }
    }

    const r = await correrPolitica(pol.id, {
        desdeCron: false,
        orgIdEsperado: orgId,
        branchIdsPermitidos: await getScopedBranchIds(),
        staffId: null,
    })

    revalidatePath('/dashboard/facturacion')
    return r
}
