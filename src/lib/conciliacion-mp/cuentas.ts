// =============================================================================
// src/lib/conciliacion-mp/cuentas.ts
// Las tarjetas de cuentas de la conciliación (§7 del diseño). PURO: recibe lo
// leído y los casos del período; no consulta nada.
//
// UNA TARJETA POR CUENTA DE MERCADO PAGO, no por cuenta de cobro:
// barberia.monaco está cargada en Caseros y en Paraná (dos payment_accounts) y
// es UNA cuenta de MP, así que es UNA tarjeta ("Caseros y Paraná"). Las que
// todavía no están conectadas se agrupan por alias normalizado por el mismo
// motivo. Una cuenta desactivada con cobros recientes se muestra igual: los
// clientes guardan el alias viejo y siguen transfiriendo ahí.
// =============================================================================

import type { CasoConciliacion, CuentaConciliacion, EstadoCuenta } from './contrato'
import { ESTADOS_PARA_REVISAR } from './contrato'
import type { CuentaCobroFila, CuentaMpFila, LinkVigente, SucursalFila } from './filas'
import { normalizarAlias } from './filas'
import { haceCuanto, hhmmAR } from './fechas'

export interface EntradaTarjetas {
  sucursales: SucursalFila[]
  cuentasCobro: CuentaCobroFila[]
  cuentasMp: CuentaMpFila[]
  links: LinkVigente[]
  /** Monto transferido (monto + propina) de los últimos 30 días por cuenta de cobro. */
  monto30d: Map<string, number>
  /** Casos del período, ya filtrados por alcance. */
  casos: CasoConciliacion[]
  /** Sucursales visibles; null = todas. */
  alcance: Set<string> | null
  ahora: Date
}

const ATRASO_MS = 30 * 60_000
const PARA_REVISAR = new Set(ESTADOS_PARA_REVISAR)

/** Orden de la grilla: lo roto primero, después lo que hay que confirmar, conectar, y lo que anda. */
const RANGO: Record<EstadoCuenta, number> = {
  error: 0,
  revocada: 0,
  sin_conectar: 2,
  sin_alias: 2,
  atrasada: 3,
  al_dia: 4,
  banco: 5,
}

function estadoDe(
  mp: CuentaMpFila | undefined,
  cuentas: CuentaCobroFila[],
  alias: string | null,
  ahora: Date,
): { estado: EstadoCuenta; detalle: string } {
  if (cuentas.length && cuentas.every((p) => p.banco)) return { estado: 'banco', detalle: 'Banco: no se conecta' }
  if (!mp) {
    return alias ? { estado: 'sin_conectar', detalle: 'Sin conectar' } : { estado: 'sin_alias', detalle: 'Sin alias: no se puede conectar' }
  }
  const leida = mp.sincronizadaHasta
  switch (mp.status) {
    case 'revocada':
      return { estado: 'revocada', detalle: mp.modo === 'manual' ? 'El token dejó de servir' : 'El titular quitó el permiso' }
    case 'desconectada':
      return { estado: 'sin_conectar', detalle: 'Desconectada' }
    case 'error':
      return {
        estado: 'error',
        detalle: `${mp.lastError ?? 'Mercado Pago no responde'}${leida ? ` desde las ${hhmmAR(leida)}` : ''}`,
      }
    default: {
      if (!leida) {
        // Recién conectada (o nunca terminó una lectura).
        return mp.lastError ? { estado: 'error', detalle: mp.lastError } : { estado: 'atrasada', detalle: 'Todavía no se leyó' }
      }
      const atrasada = ahora.getTime() - new Date(leida).getTime() > ATRASO_MS
      const fallaReciente =
        !!mp.lastError && !!mp.lastCheckAt && (!mp.lastSyncAt || new Date(mp.lastCheckAt).getTime() > new Date(mp.lastSyncAt).getTime())
      if (atrasada && fallaReciente) return { estado: 'error', detalle: `${mp.lastError} desde las ${hhmmAR(leida)}` }
      // Un aviso que dejó una lectura que salió bien (p. ej. "hay que volver a
      // autorizar la cuenta antes del 24/11"): se lee, pero hay que hacer algo.
      const aviso = mp.lastError && !fallaReciente ? ` · ${mp.lastError}` : ''
      return { estado: atrasada ? 'atrasada' : 'al_dia', detalle: `Leída ${haceCuanto(leida, ahora)}${aviso}` }
    }
  }
}

export function armarTarjetas(e: EntradaTarjetas): CuentaConciliacion[] {
  const sucursal = new Map(e.sucursales.map((s) => [s.id, s.nombre]))
  const mpPorId = new Map(e.cuentasMp.map((c) => [c.id, c]))
  const enAlcance = (sucursalId: string) => !e.alcance || e.alcance.has(sucursalId)

  // Cuentas de cobro con cobros en el período (para incluir las inactivas que se siguen usando).
  const conCobrosEnPeriodo = new Set<string>()
  for (const c of e.casos) for (const x of c.esperados) if (x.paymentAccountId) conCobrosEnPeriodo.add(x.paymentAccountId)

  const visibles = e.cuentasCobro.filter(
    (p) => enAlcance(p.sucursalId) && (p.activa || conCobrosEnPeriodo.has(p.id) || (e.monto30d.get(p.id) ?? 0) > 0),
  )

  const grupos = new Map<string, CuentaCobroFila[]>()
  for (const p of visibles) {
    const mpValida = p.cuentaMpId && mpPorId.has(p.cuentaMpId) ? p.cuentaMpId : null
    const clave = mpValida ? `mp:${mpValida}` : p.alias ? `al:${normalizarAlias(p.alias)}` : `pa:${p.id}`
    const g = grupos.get(clave)
    if (g) g.push(p)
    else grupos.set(clave, [p])
  }

  const total30d = visibles.reduce((s, p) => s + (e.monto30d.get(p.id) ?? 0), 0)

  const tarjetas: CuentaConciliacion[] = []
  for (const [clave, l] of grupos) {
    const cuentas = [...l].sort(
      (a, b) => Number(b.activa) - Number(a.activa) || (a.orden ?? 1e9) - (b.orden ?? 1e9) || a.id.localeCompare(b.id),
    )
    const principal = cuentas[0]
    const cuentaMpId = clave.startsWith('mp:') ? clave.slice(3) : null
    const mp = cuentaMpId ? mpPorId.get(cuentaMpId) : undefined
    const ids = new Set(cuentas.map((p) => p.id))
    const aliases = [...new Set(cuentas.map((p) => p.alias).filter((x): x is string => !!x))]
    const alias = principal.alias ?? aliases[0] ?? null
    const { estado, detalle } = estadoDe(mp, cuentas, alias, e.ahora)

    // Lo del período: cobros de estas cuentas de cobro y créditos de esta cuenta de MP.
    let cobros = 0
    let montoSistema = 0
    let montoMp = 0
    let paraRevisar = 0
    for (const c of e.casos) {
      const deEstaCuenta = c.esperados.filter((x) => x.paymentAccountId && ids.has(x.paymentAccountId))
      cobros += deEstaCuenta.length
      montoSistema += deEstaCuenta.reduce((s, x) => s + x.monto, 0)
      const movAca = !!cuentaMpId && c.movimiento?.cuentaMpId === cuentaMpId
      if (movAca && c.estado !== 'ajeno' && !(c.estado === 'revisado' && c.esperados.length === 0)) montoMp += c.montoMp
      if (PARA_REVISAR.has(c.estado) && (deEstaCuenta.length > 0 || movAca)) paraRevisar++
    }

    const link = e.links
      .filter((x) => ids.has(x.paymentAccountId))
      .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1))[0]

    const plata30d = cuentas.reduce((s, p) => s + (e.monto30d.get(p.id) ?? 0), 0)
    const sucursalesIds = [...new Set(cuentas.map((p) => p.sucursalId))]

    tarjetas.push({
      id: cuentaMpId ?? `pa:${principal.id}`,
      cuentaMpId,
      alias,
      aliases,
      titular: principal.nombre || null,
      titularMp: mp ? (mp.titular ?? mp.nickname) : null,
      emailMp: mp?.emailEnmascarado ?? null,
      sucursales: sucursalesIds.map((id) => ({ id, nombre: sucursal.get(id) ?? 'Sucursal' })),
      paymentAccountIds: cuentas.map((p) => p.id),
      activa: cuentas.some((p) => p.activa),
      estado,
      detalleEstado: detalle,
      sincronizadaHasta: mp?.sincronizadaHasta ?? null,
      ultimaSync: mp?.lastSyncAt ?? null,
      // Sin cuenta de MP conectada no hay nada que confirmar.
      confirmada: mp ? !!mp.confirmadaAt : true,
      modo: mp?.modo ?? null,
      periodo: { cobros, montoSistema, montoMp, paraRevisar },
      pctPlata30d: total30d > 0 ? Math.round((plata30d * 1000) / total30d) / 10 : 0,
      linkPendiente: link ? { id: link.id, venceEn: link.venceEn, abierto: link.abierto } : null,
    })
  }

  const rango = (t: CuentaConciliacion) => {
    const conectada = t.estado === 'al_dia' || t.estado === 'atrasada'
    return conectada && !t.confirmada ? 1 : RANGO[t.estado]
  }
  return tarjetas.sort(
    (a, b) => rango(a) - rango(b) || b.pctPlata30d - a.pctPlata30d || (a.alias ?? '').localeCompare(b.alias ?? ''),
  )
}
