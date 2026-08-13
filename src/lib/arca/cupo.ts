// =============================================================================
// src/lib/arca/cupo.ts
//
// EL MOTOR DE CUPO: de todo lo que se vendió, ¿qué se factura?
//
// Es lógica pura — entra la lista de ventas elegibles y el estado del cupo,
// sale el plan. Sin base de datos y sin red, así que se puede simular en la
// pantalla exactamente lo mismo que va a ejecutar el cron. Que la vista previa
// y la ejecución compartan esta función no es un detalle de implementación: es
// lo que hace que el número que ve el dueño sea el número que va a salir.
//
// El corte por CANTIDAD y el corte por MONTO no son el mismo problema:
//   · cantidad → se sabe de entrada cuántas entran.
//   · monto    → hay que ir sumando, y el ticket que cruza el tope obliga a
//                decidir si entra (y te pasás) o no entra (y te quedás corto).
//                Esa decisión es `allow_overflow` y es del dueño, no nuestra.
// =============================================================================

export type ModoCupo = 'manual' | 'cantidad' | 'monto'
export type PeriodoCupo = 'dia' | 'semana' | 'mes'
export type EstrategiaSeleccion =
    | 'cronologico'
    | 'mas_baratos'
    | 'mas_caros'
    | 'distribuido'
    | 'aleatorio'

export interface CandidatoVenta {
    visitId: string
    branchId: string
    branchName: string
    completedAt: string
    /** Importe que se facturaría (con o sin propina, según la política). */
    baseAmount: number
    amount: number
    tipAmount: number
    paymentMethod: string
    clientId: string | null
    clientName: string | null
    clientPhone: string | null
    barberName: string | null
    serviceName: string | null
}

export interface EstadoCupo {
    periodoDesde: string
    periodoHasta: string
    emitidos: number
    montoEmitido: number
    objetivoCantidad: number | null
    objetivoMonto: number | null
    restanteCantidad: number
    restanteMonto: number
}

export interface PoliticaCupo {
    id: string
    modo: ModoCupo
    periodo: PeriodoCupo
    estrategia: EstrategiaSeleccion
    permitirExceso: boolean
    objetivoCantidad: number | null
    objetivoMonto: number | null
}

export type MotivoCorte =
    | 'cupo_completo'      // se llenó el objetivo
    | 'sin_candidatos'     // no quedan ventas elegibles
    | 'proximo_excede'     // el siguiente ticket se pasaba del tope de monto
    | 'sin_objetivo'       // política en manual: no se elige nada solo
    | 'cupo_agotado'       // ya no queda nada del período

export interface PlanFacturacion {
    seleccionados: CandidatoVenta[]
    /** Los que quedaron afuera, para poder mostrarlos en gris. */
    descartados: CandidatoVenta[]
    totalSeleccionado: number
    motivoCorte: MotivoCorte
    /** Cómo queda el cupo si se ejecuta este plan. */
    proyeccion: {
        cantidadFinal: number
        montoFinal: number
        restanteCantidad: number
        restanteMonto: number
    }
}

/**
 * Decide qué ventas se facturan.
 *
 * Los candidatos YA vienen ordenados por la estrategia desde SQL
 * (`arca_billing_candidates`): ordenar acá otra vez sería duplicar la regla en
 * dos lugares, que es como terminan divergiendo la vista previa y el cron.
 * Esta función sólo CORTA.
 */
export function planificarFacturacion(
    candidatos: CandidatoVenta[],
    estado: EstadoCupo,
    politica: PoliticaCupo,
): PlanFacturacion {
    const vacio = (motivo: MotivoCorte): PlanFacturacion => ({
        seleccionados: [],
        descartados: candidatos,
        totalSeleccionado: 0,
        motivoCorte: motivo,
        proyeccion: {
            cantidadFinal: estado.emitidos,
            montoFinal: estado.montoEmitido,
            restanteCantidad: estado.restanteCantidad,
            restanteMonto: estado.restanteMonto,
        },
    })

    if (politica.modo === 'manual') return vacio('sin_objetivo')
    if (candidatos.length === 0) return vacio('sin_candidatos')

    const seleccionados: CandidatoVenta[] = []
    let total = 0
    let motivo: MotivoCorte = 'sin_candidatos'

    // La acumulación del modo 'monto' va en CENTAVOS ENTEROS. Con floats,
    // 1,15 + 3,20 da 4,3500000000000005, que no es <= 4,35: el ticket que
    // cerraba justo el cupo se descartaba y la pantalla informaba "quedan $0
    // sin usar" mientras dejaba de emitir un comprobante que entraba exacto.
    // Es la misma razón por la que comprobante.ts trabaja en centavos.
    const cent = (n: number) => Math.round(n * 100)

    if (politica.modo === 'cantidad') {
        const faltan = estado.restanteCantidad
        if (faltan <= 0) return vacio('cupo_agotado')

        for (const c of candidatos) {
            if (seleccionados.length >= faltan) {
                motivo = 'cupo_completo'
                break
            }
            seleccionados.push(c)
            total += c.baseAmount
        }
        if (seleccionados.length >= faltan) motivo = 'cupo_completo'
    } else {
        // modo === 'monto'
        const restanteCent = cent(estado.restanteMonto)
        if (restanteCent <= 0) return vacio('cupo_agotado')
        let totalCent = 0

        for (const c of candidatos) {
            const proyectado = totalCent + cent(c.baseAmount)

            if (proyectado <= restanteCent) {
                seleccionados.push(c)
                totalCent = proyectado
                // Cerró justo: no tiene sentido seguir mirando.
                if (totalCent === restanteCent) {
                    motivo = 'cupo_completo'
                    break
                }
                continue
            }

            // Este ticket cruza el tope.
            if (politica.permitirExceso) {
                seleccionados.push(c)
                totalCent = proyectado
                motivo = 'cupo_completo'
                break
            }

            // Sin permitir exceso se sigue buscando: puede venir uno más chico
            // que sí entre. Cortar acá dejaría cupo sin usar de gusto.
            motivo = 'proximo_excede'
        }
        total = totalCent / 100
        if (totalCent >= restanteCent && motivo !== 'proximo_excede') motivo = 'cupo_completo'
    }

    const elegidos = new Set(seleccionados.map((s) => s.visitId))
    const cantidadFinal = estado.emitidos + seleccionados.length
    const montoFinal = estado.montoEmitido + total

    return {
        seleccionados,
        descartados: candidatos.filter((c) => !elegidos.has(c.visitId)),
        totalSeleccionado: total,
        motivoCorte: seleccionados.length === 0 ? (motivo === 'sin_candidatos' ? 'sin_candidatos' : motivo) : motivo,
        proyeccion: {
            cantidadFinal,
            montoFinal,
            restanteCantidad: Math.max((politica.objetivoCantidad ?? 0) - cantidadFinal, 0),
            restanteMonto: Math.max((politica.objetivoMonto ?? 0) - montoFinal, 0),
        },
    }
}

/** Porcentaje del cupo consumido, acotado a 0–100 para las barras de progreso. */
export function porcentajeCupo(estado: EstadoCupo, modo: ModoCupo): number {
    if (modo === 'cantidad' && estado.objetivoCantidad) {
        return Math.min(100, Math.round((estado.emitidos / estado.objetivoCantidad) * 100))
    }
    if (modo === 'monto' && estado.objetivoMonto) {
        return Math.min(100, Math.round((estado.montoEmitido / estado.objetivoMonto) * 100))
    }
    return 0
}

/**
 * Ritmo del período: cuánto se lleva facturado contra cuánto DEBERÍA llevarse a
 * esta altura si el cupo se repartiera parejo.
 *
 * Sirve para la única alerta que de verdad importa en un cupo mensual: llegar
 * al día 28 con la mitad sin facturar y no poder recuperarlo, porque la ventana
 * de ARCA para fechar hacia atrás es de 10 días.
 */
export function ritmoDelPeriodo(
    estado: EstadoCupo,
    modo: ModoCupo,
    hoy: Date = new Date(),
): { esperadoPct: number; realPct: number; atrasado: boolean; diasRestantes: number } {
    const desde = new Date(estado.periodoDesde + 'T00:00:00Z').getTime()
    const hasta = new Date(estado.periodoHasta + 'T00:00:00Z').getTime()
    const ahora = Math.min(Math.max(hoy.getTime(), desde), hasta)

    const largo = Math.max(hasta - desde, 1)
    const esperadoPct = Math.round(((ahora - desde) / largo) * 100)
    const realPct = porcentajeCupo(estado, modo)
    const diasRestantes = Math.max(Math.ceil((hasta - ahora) / 86_400_000), 0)

    return {
        esperadoPct,
        realPct,
        // 10 puntos de tolerancia: sin eso, cualquier lunes a la mañana aparece
        // como "atrasado" y la alerta se vuelve ruido que nadie mira.
        atrasado: modo !== 'manual' && realPct + 10 < esperadoPct,
        diasRestantes,
    }
}

export const ETIQUETA_PERIODO: Record<PeriodoCupo, string> = {
    dia: 'por día',
    semana: 'por semana',
    mes: 'por mes',
}

export const ETIQUETA_ESTRATEGIA: Record<EstrategiaSeleccion, { nombre: string; explicacion: string }> = {
    cronologico: {
        nombre: 'Los primeros del período',
        explicacion: 'Factura en orden de llegada, empezando por los cortes más viejos que quedaron sin facturar.',
    },
    distribuido: {
        nombre: 'Repartido en el período',
        explicacion: 'Toma un corte de cada día antes de repetir día, para que las facturas queden parejas y no todas juntas.',
    },
    mas_baratos: {
        nombre: 'Los de menor importe',
        explicacion: 'Prioriza los tickets más chicos: entran más comprobantes en el mismo monto.',
    },
    mas_caros: {
        nombre: 'Los de mayor importe',
        explicacion: 'Prioriza los tickets más grandes: se llega al monto con menos comprobantes.',
    },
    aleatorio: {
        nombre: 'Al azar',
        explicacion: 'Elige sin patrón. El orden es estable: no cambia cada vez que abrís la pantalla.',
    },
}
