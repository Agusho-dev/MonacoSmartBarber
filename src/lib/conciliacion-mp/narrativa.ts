// =============================================================================
// src/lib/conciliacion-mp/narrativa.ts
// Lo que dice Tex en la tarjeta de la conciliación: 1 a 3 frases, lo más
// urgente primero, armadas por PLANTILLA (sin IA). Las cifras salen del motor;
// acá sólo se cuentan.
//
// Hechos, no culpas: "no están en Mercado Pago", nunca "Fulano no cobró".
// Del pagador, sólo el nombre de pila.
//
// PURO: sin `server-only` ni alias, para probarlo con `node`.
// =============================================================================

import type { CasoConciliacion, Veredicto } from './contrato'
import { esEmparejamientoDudoso } from './contrato'
import type { CuentaMpMotor, NotaCobertura } from './motor'
import { diaAR, diaMes, fechaLarga, hhmmAR, plata, type DescripcionPeriodo } from './fechas'

export interface EntradaNarrativa {
  veredicto: Veredicto
  casos: CasoConciliacion[]
  cobertura: Record<string, NotaCobertura>
  cuentasMp: CuentaMpMotor[]
  periodo: DescripcionPeriodo
}

const MAX_FRASES = 3

function primerNombre(s: string | null | undefined): string | null {
  const t = (s ?? '').trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null
}

function cuantos(n: number, uno: string, varios: string): string {
  return n === 1 ? `1 ${uno}` : `${n} ${varios}`
}

/** "a", "a y b", "a, b y 3 más" */
function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} y ${items[1]}`
  return `${items[0]}, ${items[1]} y ${items.length - 2} más`
}

function sumar(l: CasoConciliacion[], f: (c: CasoConciliacion) => number): number {
  return l.reduce((s, c) => s + f(c), 0)
}

function agrupar<K>(l: CasoConciliacion[], clave: (c: CasoConciliacion) => K): Map<K, CasoConciliacion[]> {
  const m = new Map<K, CasoConciliacion[]>()
  for (const c of l) {
    const k = clave(c)
    const g = m.get(k)
    if (g) g.push(c)
    else m.set(k, [c])
  }
  return m
}

/** "las 18:00" si es del último día del período; si no, "el 19/10 a las 18:00". */
function laHora(x: string | number, periodo: DescripcionPeriodo): string {
  return diaAR(x) === periodo.ultimoDia ? `las ${hhmmAR(x)}` : `el ${diaMes(diaAR(x))} a las ${hhmmAR(x)}`
}

export function narrar(e: EntradaNarrativa): string[] {
  const { veredicto, casos, cobertura, periodo } = e
  const cuentaMp = new Map(e.cuentasMp.map((c) => [c.id, c]))
  const de = (estado: CasoConciliacion['estado']) => casos.filter((c) => c.estado === estado)

  if (veredicto.tipo === 'sin_movimientos') return [`No hubo transferencias ${periodo.frase}.`]

  if (veredicto.tipo === 'cuadra') {
    const conPlata = casos.filter((c) => c.esperados.length > 0 && c.movimiento && (c.estado === 'conciliado' || c.estado === 'revisado'))
    const n = conPlata.length
    if (n === 0) {
      // Todo lo del período quedó revisado a mano sin transferencia (pagó en efectivo, error de carga…).
      const k = sumar(
        de('revisado').filter((c) => c.esperados.length > 0 && !c.movimiento),
        (c) => c.esperados.length,
      )
      return [`No quedó nada para revisar: ${cuantos(k, 'cobro revisado', 'cobros revisados')} a mano.`]
    }
    return [`Cuadró todo: ${cuantos(n, 'transferencia', 'transferencias')}, ${plata(sumar(conPlata, (c) => c.montoMp))}.`]
  }

  const frases: string[] = []

  // 1. No se pudo leer una cuenta conectada.
  const errores = de('sin_verificar').filter((c) => c.esperados.length > 0 && cobertura[c.id]?.motivo === 'error_lectura')
  if (errores.length) {
    const ids = [...new Set(errores.map((c) => c.cuentaMpId ?? cobertura[c.id]?.cuentaMpId).filter((x): x is string => !!x))]
    if (ids.length === 1) {
      const M = cuentaMp.get(ids[0])
      const alias = M?.alias ?? errores[0].alias ?? 'Una cuenta'
      const desde = M?.sincronizadaHasta ? ` desde ${laHora(M.sincronizadaHasta, periodo)}` : ''
      frases.push(`No pude leer ${alias}${desde}. ${M?.lastError ?? 'Mercado Pago no responde'}.`)
    } else {
      const aliases = ids.map((id) => cuentaMp.get(id)?.alias ?? 'sin alias')
      frases.push(`No pude leer ${ids.length} cuentas (${enumerar(aliases)}): lo cobrado ahí queda sin verificar.`)
    }
  }

  // 2. Lo que falta, agrupado por cuenta: la de más plata primero.
  const faltan = de('solo_sistema')
  if (faltan.length) {
    const grupos = [...agrupar(faltan, (c) => c.alias ?? '').entries()]
      .map(([alias, l]) => ({ alias, n: sumar(l, (c) => c.esperados.length), monto: sumar(l, (c) => c.montoSistema) }))
      .sort((a, b) => b.monto - a.monto || a.alias.localeCompare(b.alias))
    const g = grupos[0]
    const donde = g.alias ? `de ${g.alias}` : 'registrados sin cuenta'
    let frase =
      g.n === 1
        ? `Lo más urgente: 1 cobro ${donde} por ${plata(g.monto)} que no está en Mercado Pago.`
        : `Lo más urgente: ${g.n} cobros ${donde} por ${plata(g.monto)} que no están en Mercado Pago.`
    if (grupos.length > 1) {
      const resto = grupos.slice(1)
      frase += ` Y ${cuantos(sumar(faltan, (c) => c.esperados.length) - g.n, 'más', 'más')} en otras cuentas (${plata(resto.reduce((s, x) => s + x.monto, 0))}).`
    }
    frases.push(frase)
  }
  const menos = de('monto_menor')
  if (menos.length) {
    const dif = sumar(menos, (c) => Math.abs(c.diferencia))
    frases.push(
      menos.length === 1
        ? `Una transferencia entró con ${plata(dif)} menos que el cobro.`
        : `${menos.length} transferencias entraron con menos plata que el cobro: faltan ${plata(dif)}.`,
    )
  }

  // 3. Lo que sobra (entró y no hay cobro).
  const sobran = de('solo_mp')
  if (sobran.length === 1) {
    const c = sobran[0]
    const quien = primerNombre(c.movimiento?.pagador)
    const cuando = periodo.unDia ? `A las ${hhmmAR(c.fecha)}` : `El ${fechaLarga(c.dia)} a las ${hhmmAR(c.fecha)}`
    frases.push(
      `${cuando} entraron ${plata(c.montoMp)}${quien ? ` de ${quien}` : ''} en ${c.alias ?? 'Mercado Pago'} sin cobro registrado: ¿se cobró en efectivo o con tarjeta?`,
    )
  } else if (sobran.length > 1) {
    frases.push(`${sobran.length} transferencias entraron sin cobro registrado (${plata(sumar(sobran, (c) => c.montoMp))}).`)
  }

  // 4. La plata está, pero en otra cuenta.
  const otra = de('otra_cuenta')
  if (otra.length) {
    const n = sumar(otra, (c) => c.esperados.length)
    const masFrecuente = [...agrupar(otra, (c) => c.alias ?? '').entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
    const tope = masFrecuente ? `el tope de ${masFrecuente}` : 'el tope de cada cuenta'
    frases.push(
      n === 1
        ? `1 cobro entró en otra cuenta: la plata está, pero ${tope} queda mal.`
        : `${n} cobros entraron en otra cuenta: la plata está, pero ${tope} queda mal.`,
    )
  }

  // 5. Entró de más (casi siempre la propina sin cargar).
  const mas = de('monto_mayor')
  if (mas.length) {
    const dif = sumar(mas, (c) => c.diferencia)
    frases.push(
      mas.length === 1
        ? `Una transferencia trajo ${plata(dif)} de más: parece una propina sin cargar.`
        : `${mas.length} transferencias trajeron ${plata(dif)} de más: parecen propinas sin cargar.`,
    )
  }

  // 6. Emparejamientos con poca certeza: nadie confirmó que sean esa plata.
  const dudosos = de('conciliado').filter((c) => esEmparejamientoDudoso(c))
  if (dudosos.length === 1) {
    const c = dudosos[0]
    if (c.senales.includes('grupo')) {
      frases.push(
        `Una transferencia de ${plata(c.montoMp)} cubre ${c.esperados.length} cobros que no se marcaron como cobro conjunto: hay que confirmarlo o descartarlo.`,
      )
    } else {
      const r = c.retrasoSeg ?? 0
      const min = Math.max(1, Math.round(Math.abs(r) / 60))
      // retraso = sistema − MP: negativo es "MP después del cobro".
      frases.push(
        `Un cobro de ${plata(c.montoSistema)} se emparejó con una transferencia del mismo monto que entró ${min} min ${r >= 0 ? 'antes' : 'después'}: hay que confirmarlo o descartarlo.`,
      )
    }
  } else if (dudosos.length > 1) {
    frases.push(
      `${dudosos.length} emparejamientos se encontraron con poca certeza (${plata(sumar(dudosos, (c) => c.montoSistema))}): hay que confirmarlos o descartarlos.`,
    )
  }

  // 7. Lo que todavía no se puede saber.
  const sinVerificar = de('sin_verificar').filter((c) => c.esperados.length > 0 && cobertura[c.id]?.motivo !== 'error_lectura')
  const sinConectar = sinVerificar.filter((c) => {
    const m = cobertura[c.id]?.motivo
    return m === 'sin_conectar' || m === 'desconectada'
  })
  if (sinConectar.length) {
    const aliases = [...new Set(sinConectar.map((c) => c.alias ?? 'una cuenta sin alias'))]
    const monto = plata(sumar(sinConectar, (c) => c.montoSistema))
    frases.push(
      aliases.length === 1
        ? `Falta conectar ${aliases[0]}: sin ella no puedo verificar ${monto}.`
        : `Faltan conectar ${enumerar(aliases)}: sin ellas no puedo verificar ${monto}.`,
    )
  }
  const banco = sinVerificar.filter((c) => cobertura[c.id]?.motivo === 'banco')
  if (banco.length) {
    const n = sumar(banco, (c) => c.esperados.length)
    frases.push(
      n === 1
        ? '1 cobro fue a una cuenta de banco: lo controlo sólo con el comprobante.'
        : `${n} cobros fueron a cuentas de banco: los controlo sólo con el comprobante.`,
    )
  }
  const sinLeer = sinVerificar.filter((c) => {
    const m = cobertura[c.id]?.motivo
    return m === 'fuera_de_lectura' || m === 'sin_lectura'
  })
  if (sinLeer.length) {
    const n = sumar(sinLeer, (c) => c.esperados.length)
    frases.push(
      `Todavía no leí Mercado Pago para esas fechas: ${cuantos(n, 'cobro espera', 'cobros esperan')} (${plata(sumar(sinLeer, (c) => c.montoSistema))}).`,
    )
  }

  // Pendientes: los cobros que esperan la próxima lectura de Mercado Pago, y
  // los créditos que todavía no tienen su cobro (no es lo mismo).
  const pendientes = de('pendiente')
  const pendientesCobro = pendientes.filter((c) => c.esperados.length > 0)
  const creditos = pendientes.filter((c) => c.esperados.length === 0)
  const esperandoCobro = creditos.filter((c) => cobertura[c.id]?.motivo === 'esperando_cobro')
  const esperandoLectura = creditos.filter((c) => cobertura[c.id]?.motivo !== 'esperando_cobro')
  if (pendientesCobro.length || esperandoLectura.length) {
    let min: number | null = null
    for (const c of [...pendientesCobro, ...esperandoLectura]) {
      const h = c.cuentaMpId ? cuentaMp.get(c.cuentaMpId)?.sincronizadaHasta : null
      if (h) min = min === null ? new Date(h).getTime() : Math.min(min, new Date(h).getTime())
    }
    const n = sumar(pendientesCobro, (c) => c.esperados.length)
    const espera = n
      ? cuantos(n, 'cobro queda esperando', 'cobros quedan esperando')
      : cuantos(esperandoLectura.length, 'transferencia queda esperando', 'transferencias quedan esperando')
    frases.push(
      min !== null
        ? `Mercado Pago todavía no se leyó hasta ${laHora(min, periodo)}: ${espera}.`
        : `Mercado Pago todavía no se leyó hasta la hora de los últimos cobros: ${espera}.`,
    )
  }
  if (esperandoCobro.length) {
    const monto = plata(sumar(esperandoCobro, (c) => c.montoMp))
    frases.push(
      esperandoCobro.length === 1
        ? `1 transferencia reciente está esperando que se registre su cobro (${monto}).`
        : `${esperandoCobro.length} transferencias recientes están esperando que se registre su cobro (${monto}).`,
    )
  }

  if (frases.length) return frases.slice(0, MAX_FRASES)
  // Sin casos que contar (p. ej. una cuenta del alcance sin leer): el veredicto ya lo explica.
  return [veredicto.detalle ? `${veredicto.titular} ${veredicto.detalle}` : veredicto.titular]
}
