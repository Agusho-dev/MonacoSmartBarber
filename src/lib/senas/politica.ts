// =============================================================================
// src/lib/senas/politica.ts
// Los textos que el cliente lee PEGADOS al botón de pagar.
//
// Por qué esto es código y no una constante en la UI: los mismos cuatro
// párrafos los tienen que mostrar la app Flutter, el turnero web y el resumen
// del dashboard, y todos dependen de la config de la sucursal (porcentaje,
// horas de cancelación, qué pasa si cancela, días de arrepentimiento). Escrito
// tres veces, tarde o temprano una superficie promete algo que otra no cumple
// — y lo que se promete acá es plata del cliente.
//
// No es cosmética legal: el art. 1111 CCyC exige que la información sobre la
// revocación vaya "en caracteres destacados inmediatamente antes de la
// aceptación". Esconderla detrás de un link hace que el plazo de
// arrepentimiento ni siquiera empiece a correr.
//
// Reglas de redacción, deliberadas:
//  · Castellano rioplatense, segunda persona ("pagás", "cancelás").
//  · Un párrafo por campo. Nada de letra chica ni de "el prestador se reserva".
//  · Cifras siempre con el monto formateado, nunca "el 50%" solo: el cliente
//    tiene que poder cotejar el número que va a ver en Mercado Pago.
// =============================================================================

import { formatCurrency } from '@/lib/format'
import type { BranchDepositSettings, CalculoSena, TextoPolitica } from '@/lib/senas/contrato'

export interface ContextoPolitica {
    /** "Corte + Barba". Lo que el cliente eligió, tal cual se lo va a leer. */
    servicios: string
    /** Nombre de la sucursal, para el párrafo de cancelación. */
    sucursal?: string | null
    /**
     * `appointment_settings.cancellation_min_hours` de ESA sucursal. Es la
     * misma ventana que después hace cumplir `cancelAppointment`: si acá
     * dijéramos otra cosa, el cliente leería una promesa que el sistema
     * incumple al día siguiente.
     */
    horasParaCancelar: number
}

export function construirPolitica(
    cfg: BranchDepositSettings,
    calculo: CalculoSena,
    contexto: ContextoPolitica,
): TextoPolitica {
    const monto = formatCurrency(calculo.sena)
    const total = formatCurrency(calculo.total)
    const resto = formatCurrency(calculo.resto)
    const servicios = (contexto.servicios || 'el servicio').trim()

    const titulo = `Seña ${monto} ARS`

    const detalle = calculo.resto > 0
        ? `Es el ${calculo.porcentaje}% de ${servicios}, que sale ${total}. Los ${resto} que faltan los pagás en el local el día del turno.`
        : `Con esto queda pagado ${servicios} completo (${total}): el día del turno no pagás nada más.`

    // El aviso que hace honesto todo el diseño: con `hold_minutes = 0` el
    // horario NO se reserva mientras el cliente paga. Decírselo antes es lo que
    // convierte una carrera perdida en un contratiempo entendible en vez de en
    // un reclamo.
    const reserva = cfg.hold_minutes > 0
        ? `Te guardamos el horario ${cfg.hold_minutes} minutos mientras pagás. Queda confirmado cuando Mercado Pago acredita el pago; si el tiempo se vence antes, el horario vuelve a quedar libre y te devolvemos la seña completa.`
        : 'El horario queda confirmado cuando Mercado Pago acredita el pago, no antes. Mientras tanto sigue disponible para otras personas: si alguien lo toma primero, te devolvemos la seña completa de forma automática y no te cobramos nada.'

    const cancelacion = cfg.policy_text?.trim()
        ? cfg.policy_text.trim()
        : textoCancelacion(cfg, calculo, contexto)

    const arrepentimiento = cfg.arrepentimiento_days > 0
        ? `Tenés ${cfg.arrepentimiento_days} días corridos desde el pago para arrepentirte y pedir la devolución total de los ${monto}, sin explicar por qué (art. 1110 del Código Civil y Comercial). Escribinos y te la hacemos.`
        : null

    return { titulo, detalle, cancelacion, reserva, arrepentimiento }
}

/**
 * El párrafo de cancelación. Tres decisiones de la sucursal se combinan acá:
 * la ventana (`cancellation_min_hours`), qué pasa si cancela a tiempo
 * (`refund_on_early_cancel`) y qué pasa si cancela tarde o no viene
 * (`forfeit_on_late_cancel`).
 *
 * La frase de "si cancelamos nosotros" va SIEMPRE, incluso cuando la seña no
 * se devuelve por ningún otro motivo: es la que evita que el cliente lea la
 * política como una trampa.
 */
function textoCancelacion(
    cfg: BranchDepositSettings,
    calculo: CalculoSena,
    contexto: ContextoPolitica,
): string {
    const monto = formatCurrency(calculo.sena)
    const horas = Math.max(0, Math.round(contexto.horasParaCancelar || 0))
    const partes: string[] = []

    const aTiempo = (() => {
        switch (cfg.refund_on_early_cancel) {
            case 'devolucion':
                return `te devolvemos los ${monto} por Mercado Pago`
            case 'ninguno':
                return 'la seña no se devuelve'
            case 'credito':
            default:
                return `los ${monto} te quedan a favor para tu próximo turno`
        }
    })()

    if (horas > 0) {
        const unidad = horas === 1 ? 'hora' : 'horas'
        partes.push(`Si cancelás con al menos ${horas} ${unidad} de anticipación, ${aTiempo}.`)
        partes.push(
            cfg.forfeit_on_late_cancel
                ? `Si cancelás con menos de ${horas} ${unidad} o no venís, la seña queda para el local: es el tiempo que el barbero te reservó y ya no puede vender.`
                : 'Si cancelás sobre la hora o no venís, igual te devolvemos la seña.',
        )
    } else {
        // Sin ventana configurada no hay "a tiempo" ni "tarde": una sola regla.
        partes.push(`Si cancelás, ${aTiempo}.`)
        if (cfg.forfeit_on_late_cancel) {
            partes.push('Si no venís al turno, la seña queda para el local.')
        }
    }

    const donde = contexto.sucursal?.trim() || 'el local'
    partes.push(`Si ${donde} cancela el turno, te devolvemos la seña completa siempre.`)

    return partes.join(' ')
}
