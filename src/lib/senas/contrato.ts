// =============================================================================
// src/lib/senas/contrato.ts
//
// El contrato de la seña: tipos y formas que comparten el motor, las rutas HTTP,
// el dashboard, el turnero web y la app Flutter. Un solo lugar donde mirar
// "¿cómo se llama este campo?" y "¿qué puede devolver esto?".
//
// Regla del módulo: acá NO se importa nada del servidor (ni Supabase, ni
// 'server-only'). Es un archivo de tipos + funciones puras para que lo pueda
// importar tanto un componente del browser como un route handler.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Estados
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El ciclo de vida de una seña.
 *
 *   iniciada  → hay un link de pago abierto; el horario NO está reservado
 *   pagada    → se acreditó y el turno existe
 *   consumida → el servicio se cobró y la seña se imputó al precio
 *   perdida   → cancelación tardía o ausencia: queda para el negocio
 *   devuelta  → se devolvió por Mercado Pago
 *   sin_cupo  → pagó pero alguien tomó el horario primero (devolución automática)
 *   rechazada → Mercado Pago rechazó el pago
 *   expirada  → venció el link sin pagar
 *   cancelada → el cliente abandonó antes de pagar
 */
export type EstadoSena =
    | 'iniciada'
    | 'pagada'
    | 'consumida'
    | 'perdida'
    | 'devuelta'
    | 'sin_cupo'
    | 'rechazada'
    | 'expirada'
    | 'cancelada'

/** Estados en los que hubo plata de verdad. */
export const ESTADOS_CON_PLATA: EstadoSena[] = ['pagada', 'consumida', 'perdida', 'devuelta', 'sin_cupo']

/** Estados terminales: no van a cambiar más solos. */
export const ESTADOS_TERMINALES: EstadoSena[] = [
    'consumida', 'perdida', 'devuelta', 'rechazada', 'expirada', 'cancelada', 'sin_cupo',
]

export type CanalSena = 'app' | 'web' | 'staff'
export type AmbienteMp = 'produccion' | 'prueba'
export type ModoConexionMp = 'oauth' | 'manual'
export type EstadoProveedor = 'desconectado' | 'conectado' | 'error' | 'revocado'

// ─────────────────────────────────────────────────────────────────────────────
// Filas
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingDeposit {
    id: string
    organization_id: string
    branch_id: string
    client_id: string
    barber_id: string | null
    service_ids: string[]
    service_names: string | null
    appointment_date: string          // YYYY-MM-DD, hora de pared de la sucursal
    start_time: string                // HH:MM:SS
    duration_minutes: number
    service_total: number
    amount: number
    currency: string
    percentage: number
    channel: CanalSena
    status: EstadoSena
    provider: string
    environment: AmbienteMp
    mp_preference_id: string | null
    mp_payment_id: string | null
    mp_status: string | null
    mp_status_detail: string | null
    mp_payment_method_id: string | null
    mp_payment_type_id: string | null
    mp_collector_id: string | null
    mp_fee: number | null
    mp_net_amount: number | null
    mp_money_release_date: string | null
    init_point: string | null
    expires_at: string
    hold_until: string | null
    paid_at: string | null
    appointment_id: string | null
    consumed_at: string | null
    refunded_at: string | null
    refunded_amount: number | null
    refund_reason: string | null
    refunded_by: string | null
    mp_refund_id: string | null
    failure_reason: string | null
    created_at: string
    updated_at: string
}

export interface BranchDepositSettings {
    id: string
    organization_id: string
    branch_id: string
    is_enabled: boolean
    percentage: number
    min_amount: number
    round_to: number
    /** 0 = el horario NO se reserva mientras el cliente paga (default del dueño). */
    hold_minutes: number
    expires_minutes: number
    wallet_only: boolean
    channels: CanalSena[]
    refund_on_early_cancel: 'credito' | 'devolucion' | 'ninguno'
    forfeit_on_late_cancel: boolean
    arrepentimiento_days: number
    policy_text: string | null
}

export interface BranchPaymentProvider {
    id: string
    organization_id: string
    branch_id: string
    provider: 'mercadopago'
    environment: AmbienteMp
    connection_mode: ModoConexionMp
    mp_user_id: string | null
    public_key: string | null
    token_expires_at: string | null
    live_mode: boolean | null
    status: EstadoProveedor
    last_check_at: string | null
    last_error: string | null
    connected_at: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo del monto — UNA sola implementación
// ─────────────────────────────────────────────────────────────────────────────

export interface CalculoSena {
    /** Precio completo de los servicios elegidos. */
    total: number
    /** Lo que se cobra ahora. 0 = no corresponde seña. */
    sena: number
    /** Lo que queda a pagar en el local. */
    resto: number
    /** true si esta reserva exige seña. */
    aplica: boolean
    porcentaje: number
}

/**
 * El monto de la seña. Es puro y lo comparten el servidor (que cobra) y la UI
 * (que lo muestra): si divergieran, el cliente vería un número y pagaría otro.
 *
 * Redondea SIEMPRE hacia arriba al múltiplo de `round_to`: con precios impares
 * el 50% da $7.987,50, y "$8.000" es lo que la gente espera leer. Nunca se
 * redondea por encima del total.
 */
export function calcularSena(
    total: number,
    cfg: Pick<BranchDepositSettings, 'is_enabled' | 'percentage' | 'min_amount' | 'round_to'> | null,
    canal: CanalSena,
    canalesHabilitados: CanalSena[] = ['app', 'web'],
): CalculoSena {
    const vacio: CalculoSena = { total, sena: 0, resto: total, aplica: false, porcentaje: 0 }

    if (!cfg || !cfg.is_enabled) return vacio
    if (!canalesHabilitados.includes(canal)) return vacio
    if (!Number.isFinite(total) || total <= 0) return vacio

    const pct = Math.min(100, Math.max(1, Math.round(cfg.percentage || 50)))
    const bruto = (total * pct) / 100

    const paso = cfg.round_to > 0 ? cfg.round_to : 1
    let sena = Math.ceil(bruto / paso) * paso
    // El redondeo hacia arriba nunca puede cobrar más que el servicio.
    sena = Math.min(sena, total)

    // Debajo del mínimo la seña no vale la fricción (ni la comisión de MP).
    if (sena < (cfg.min_amount ?? 0)) return vacio

    return {
        total,
        sena,
        resto: Math.max(0, total - sena),
        aplica: sena > 0,
        porcentaje: pct,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de la API
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/mobile/turnos/[slug]/deposit — y su gemelo del turnero web. */
export interface CrearSenaInput {
    branchId: string
    clientId: string
    barberId: string | null
    serviceIds: string[]
    appointmentDate: string        // YYYY-MM-DD
    startTime: string              // HH:MM
    durationMinutes: number
    canal: CanalSena
    /** Para prellenar el checkout de MP y bajar un paso. */
    payerEmail?: string | null
    payerName?: string | null
    payerPhone?: string | null
    /** A dónde vuelve el cliente cuando Mercado Pago termina. */
    returnTo?: 'app' | 'web'
}

export type CodigoErrorSena =
    | 'SENA_NO_APLICA'          // la sucursal no pide seña para este canal
    | 'MP_NO_CONECTADO'         // falta conectar la cuenta de Mercado Pago
    | 'SLOT_TAKEN'              // el horario ya no está disponible
    | 'ALREADY_BOOKED_TODAY'    // el cliente ya tiene un turno ese día
    | 'PRECIO_INVALIDO'         // el servicio no tiene precio cargado
    | 'RATE_LIMITED'
    | 'MP_ERROR'                // Mercado Pago rechazó la creación del checkout
    | 'NOT_BOOKABLE'
    | 'INTERNAL'

export interface CrearSenaOk {
    ok: true
    deposit_id: string
    /** La URL del checkout de Mercado Pago. Se abre en Custom Tabs / Safari VC. */
    init_point: string
    amount: number
    service_total: number
    resto: number
    expires_at: string
    /** Copia exacta que hay que mostrar pegada al botón antes de cobrar. */
    politica: TextoPolitica
}

export interface CrearSenaError {
    ok: false
    code: CodigoErrorSena
    message: string
}

export type CrearSenaResult = CrearSenaOk | CrearSenaError

/** GET /api/mobile/senas/[id] — lo que consulta la pantalla "confirmando tu pago". */
export interface EstadoSenaResponse {
    ok: true
    deposit_id: string
    status: EstadoSena
    amount: number
    resto: number
    /** Presente sólo cuando `status === 'pagada'`. */
    appointment: {
        id: string
        appointment_date: string
        start_time: string
        barber_name: string | null
        branch_name: string
        service_names: string | null
    } | null
    /** Por qué falló, en castellano y apto para mostrar tal cual. */
    mensaje: string | null
    /** true mientras tenga sentido seguir preguntando. */
    seguir_esperando: boolean
}

/**
 * Los textos legales/comerciales que hay que mostrar ANTES de cobrar, en la
 * misma pantalla y pegados al botón — no detrás de un link.
 *
 * No es cosmética: el art. 1111 CCyC exige que la información sobre revocación
 * vaya "en caracteres destacados inmediatamente antes de la aceptación", y
 * esconderla hace que el plazo de arrepentimiento no empiece a correr.
 */
export interface TextoPolitica {
    /** "Seña $8.000 ARS" */
    titulo: string
    /** "Es el 50% de Corte + Barba. Los $8.000 restantes los pagás en el local." */
    detalle: string
    /** Qué pasa si cancela. Sale de la config de la sucursal. */
    cancelacion: string
    /** El aviso de que el horario se confirma con el pago acreditado. */
    reserva: string
    /** Derecho de arrepentimiento, si está activo. */
    arrepentimiento: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado de acreditar (lo usa el webhook y la conciliación)
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoAcreditacion =
    | { resultado: 'confirmado'; depositId: string; appointmentId: string }
    | { resultado: 'sin_cupo'; depositId: string; motivo: string; devuelta: boolean }
    | { resultado: 'rechazado'; depositId: string; motivo: string }
    | { resultado: 'ya_procesado'; depositId: string }
    | { resultado: 'ignorado'; motivo: string }

// ─────────────────────────────────────────────────────────────────────────────
// Textos de estado del pago de Mercado Pago
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traduce el `status_detail` de Mercado Pago a algo accionable. Colapsar todo
 * en "el pago falló" es lo que hace que el cliente reintente cinco veces con la
 * misma tarjeta sin fondos.
 */
export function motivoRechazo(statusDetail: string | null | undefined): string {
    switch (statusDetail) {
        case 'cc_rejected_insufficient_amount':
            return 'La tarjeta no tenía fondos suficientes. Probá con otra o con dinero en cuenta.'
        case 'cc_rejected_bad_filled_card_number':
        case 'cc_rejected_bad_filled_date':
        case 'cc_rejected_bad_filled_security_code':
        case 'cc_rejected_bad_filled_other':
            return 'Algún dato de la tarjeta quedó mal cargado. Revisalo y probá de nuevo.'
        case 'cc_rejected_call_for_authorize':
            return 'Tu banco necesita autorizar el pago. Llamalos y volvé a intentar.'
        case 'cc_rejected_card_disabled':
            return 'La tarjeta está inhabilitada. Activala con tu banco o usá otra.'
        case 'cc_rejected_duplicated_payment':
            return 'Ese pago ya se había hecho. Si te lo cobraron dos veces, avisanos.'
        case 'cc_rejected_high_risk':
            return 'Mercado Pago no aprobó el pago. Probá con otro medio.'
        case 'cc_rejected_max_attempts':
            return 'Se llegó al máximo de intentos. Probá con otra tarjeta.'
        case 'cc_rejected_other_reason':
            return 'El pago fue rechazado. Probá con otro medio de pago.'
        default:
            return 'No pudimos confirmar el pago. Probá de nuevo o usá otro medio.'
    }
}
