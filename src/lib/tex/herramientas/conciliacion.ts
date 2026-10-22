import 'server-only'

// =============================================================================
// src/lib/tex/herramientas/conciliacion.ts
// Las herramientas de Tex para la conciliación con Mercado Pago:
//   conciliacion_mp    ¿cuadró la plata? (veredicto + totales + cobertura)
//   conciliacion_casos el detalle de los casos (por defecto, los para revisar)
//   cuentas_mp         el estado de cada cuenta
//   sincronizar_mp     traer ahora los movimientos (sólo LEE Mercado Pago)
//
// Los números los calcula el motor (src/lib/conciliacion-mp/motor.ts); Tex los
// cuenta. Lo que no se pudo leer viaja como error o como "sin verificar",
// NUNCA como cero (Known Risk #15). Del cliente y del pagador, sólo el nombre
// de pila. Las fechas son de Argentina.
// =============================================================================

import { z, type ZodTypeAny } from 'zod'

import type { TexBloque, TexKpi, TexSalidaUI, TexTabla, TexVeredictoConciliacion } from '../contrato'
import { definirHerramienta, denegada, fallida, permitir, type TexContexto, type TexHerramienta, type TexResultado } from './tipos'
import { esErrorSucursal, resolverSucursal } from '../sucursales'
import { ESTADOS_PARA_REVISAR, ETIQUETA_ESTADO, ETIQUETA_PARA_CONFIRMAR, esEmparejamientoDudoso, etiquetaDeCaso } from '@/lib/conciliacion-mp/contrato'
import type { CasoConciliacion, CuentaConciliacion, EstadoCaso, ResultadoConciliacion } from '@/lib/conciliacion-mp/contrato'
import { MAX_DIAS_PERIODO, conciliarPeriodo, cuentasSincronizables, tarjetasDeCuentas } from '@/lib/conciliacion-mp/servicio'
import { sincronizarCuenta } from '@/lib/conciliacion-mp/sync'
import { diaAR, diaMes, diasEntre, esDia, fechaCorta, haceCuanto, hhmmAR, periodoDeDias, plata, sumarDias } from '@/lib/conciliacion-mp/fechas'
import { normalizarAlias } from '@/lib/conciliacion-mp/filas'

const PERMISO = 'conciliacion.view'
const DOMINIO = 'conciliacion'

const disponible = (ctx: TexContexto) => permitir(ctx, PERMISO, DOMINIO) === null

// ─────────────────────────────────────────────────────────────────────────────
// Período y sucursal
// ─────────────────────────────────────────────────────────────────────────────

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/

const camposPeriodo = {
  periodo: z
    .enum(['ayer', 'hoy', 'semana', 'mes'])
    .optional()
    .describe('ayer (por defecto), hoy, semana (los últimos 7 días, hoy incluido) o mes (del 1 a hoy). Se ignora si mandás desde.'),
  desde: z.string().regex(DIA_RE).optional().describe('Primer día, YYYY-MM-DD (hora argentina).'),
  hasta: z.string().regex(DIA_RE).optional().describe('Último día INCLUSIVE, YYYY-MM-DD. Sin hasta: sólo el día de desde.'),
}

interface PeriodoResuelto {
  desdeDia: string
  hastaDia: string
  desde: Date
  hasta: Date
  etiqueta: string
}

function resolverPeriodo(
  ctx: TexContexto,
  input: { periodo?: 'ayer' | 'hoy' | 'semana' | 'mes'; desde?: string; hasta?: string },
): PeriodoResuelto | { error: string } {
  const hoy = esDia(ctx.hoy) ? ctx.hoy : diaAR(new Date())
  const armar = (desdeDia: string, hastaDia: string, etiqueta: string): PeriodoResuelto => ({
    desdeDia,
    hastaDia,
    ...periodoDeDias(desdeDia, hastaDia),
    etiqueta,
  })
  if (input.desde || input.hasta) {
    if (!input.desde) return { error: 'Falta el día "desde".' }
    const hastaDia = input.hasta ?? input.desde
    if (!esDia(input.desde) || !esDia(hastaDia)) return { error: 'Las fechas van como YYYY-MM-DD.' }
    if (hastaDia < input.desde) return { error: '"hasta" no puede ser anterior a "desde".' }
    if (input.desde > hoy) return { error: 'Ese período todavía no empezó.' }
    if (diasEntre(input.desde, hastaDia) + 1 > MAX_DIAS_PERIODO) return { error: `El período puede tener hasta ${MAX_DIAS_PERIODO} días.` }
    const etiqueta =
      input.desde === hastaDia ? fechaCorta(input.desde) : `Del ${diaMes(input.desde)} al ${diaMes(hastaDia)}`
    return armar(input.desde, hastaDia, etiqueta)
  }
  switch (input.periodo ?? 'ayer') {
    case 'hoy':
      return armar(hoy, hoy, 'Hoy')
    case 'semana':
      return armar(sumarDias(hoy, -6), hoy, 'Últimos 7 días')
    case 'mes':
      return armar(`${hoy.slice(0, 8)}01`, hoy, 'Este mes')
    default: {
      const ayer = sumarDias(hoy, -1)
      return armar(ayer, ayer, 'Ayer')
    }
  }
}

function aviso(texto: string, paraModelo: unknown, tono: 'info' | 'error' | 'ok' = 'info'): TexResultado {
  return { paraModelo, paraUI: { bloques: [{ tipo: 'aviso', tono, texto }] } }
}

/**
 * Cómo se nombra el alcance en la fuente y para el modelo. "Todas las
 * sucursales" SÓLO si el rol ve toda la org: a un encargado de Paraná no se le
 * puede decir que cuadró "en todas las sucursales".
 */
function textoDelAlcance(ctx: TexContexto, suc: { id: string; nombre: string } | null): string {
  if (suc) return suc.nombre
  const n = ctx.sucursalesIds.length
  if (n === 1) {
    const unica = ctx.sucursales.find((s) => s.id === ctx.sucursalesIds[0])
    if (unica) return unica.nombre
  }
  if (ctx.todasLasSucursales === true) return 'Todas las sucursales'
  return n === 1 ? 'Tu sucursal' : `Tus ${n} sucursales`
}

/** Período + sucursal resueltos, o el resultado a devolver si no se pudo. */
function contexto(
  ctx: TexContexto,
  input: { periodo?: 'ayer' | 'hoy' | 'semana' | 'mes'; desde?: string; hasta?: string; sucursal?: string },
): { per: PeriodoResuelto; sucursalesIds: string[]; alcance: string; sucursalId: string | null } | { salida: TexResultado } {
  const per = resolverPeriodo(ctx, input)
  if ('error' in per) return { salida: aviso(per.error, { error: 'periodo_invalido', mensaje: per.error }) }
  const suc = resolverSucursal(ctx, input.sucursal)
  if (esErrorSucursal(suc)) return { salida: aviso(suc.mensaje, suc) }
  const sucursalesIds = suc ? [suc.id] : ctx.sucursalesIds
  if (!sucursalesIds.length) return { salida: aviso('No tenés sucursales asignadas.', { error: 'sin_sucursales' }) }
  return { per, sucursalesIds, alcance: textoDelAlcance(ctx, suc), sucursalId: suc ? suc.id : null }
}

function enlaceDe(per: PeriodoResuelto, sucursalId: string | null): string {
  const q = new URLSearchParams({ desde: per.desdeDia, hasta: per.hastaDia })
  if (sucursalId) q.set('sucursal', sucursalId)
  return `/dashboard/conciliacion?${q.toString()}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Casos en forma compacta
// ─────────────────────────────────────────────────────────────────────────────

const PARA_REVISAR = new Set<EstadoCaso>(ESTADOS_PARA_REVISAR)

function nombreDePila(s: string | null | undefined): string | null {
  const t = (s ?? '').trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null
}

/** La plata en juego de un caso (para ordenar "los más grandes"). */
function peso(c: CasoConciliacion): number {
  return c.estado === 'monto_mayor' || c.estado === 'monto_menor' ? Math.abs(c.diferencia) : Math.max(c.montoSistema, c.montoMp)
}

function compacto(c: CasoConciliacion, conDia: boolean) {
  const e = c.esperados[0]
  return {
    estado: c.estado,
    // "Para confirmar" / "Esperando el cobro": la etiqueta del estado diría "Cuadra" o "Esperando a Mercado Pago".
    queEs: etiquetaDeCaso(c),
    ...(esEmparejamientoDudoso(c) ? { paraConfirmar: true } : {}),
    monto: c.esperados.length ? c.montoSistema : c.montoMp,
    ...(c.diferencia !== 0 ? { diferencia: c.diferencia } : {}),
    ...(conDia ? { dia: c.dia } : {}),
    hora: hhmmAR(c.fecha),
    alias: c.alias,
    ...(c.aliasMp ? { aliasMp: c.aliasMp } : {}),
    explicacion: c.explicacion,
    barbero: e?.barbero ?? null,
    cliente: nombreDePila(e?.cliente),
    // Un crédito que no parece un cobro nunca lleva pagador.
    pagador: c.estado === 'ajeno' ? null : nombreDePila(c.movimiento?.pagador),
    ...(c.esperados.length > 1 ? { cobros: c.esperados.length } : {}),
    // Lo que una persona descartó con "No es este": esos dos no se vuelven a juntar solos.
    ...(c.rechazados?.length
      ? {
          // Con la fecha si es de otro día que el caso (en un período de varios días, la hora sola confunde).
          descartadosAMano: c.rechazados.map((r) => {
            const dia = diaAR(r.fecha)
            const cuando = dia && dia !== c.dia ? `del ${diaMes(dia)} a las ${hhmmAR(r.fecha)}` : `de las ${hhmmAR(r.fecha)}`
            return `${r.lado === 'credito' ? 'crédito' : 'cobro'} de ${plata(r.monto)} ${cuando}${r.alias ? ` en ${r.alias}` : ''}`
          }),
        }
      : {}),
  }
}

function tablaCasos(titulo: string, casos: CasoConciliacion[], conDia: boolean): TexTabla {
  const columnas = [...(conDia ? ['Día'] : []), 'Hora', 'Cuenta', 'Qué pasó', 'Sistema', 'Mercado Pago']
  return {
    titulo,
    columnas,
    filas: casos.map((c) => [
      ...(conDia ? [diaMes(c.dia)] : []),
      hhmmAR(c.fecha),
      c.aliasMp && c.alias && c.aliasMp !== c.alias ? `${c.alias} → ${c.aliasMp}` : (c.alias ?? c.aliasMp ?? '—'),
      etiquetaDeCaso(c),
      c.esperados.length ? plata(c.montoSistema) : '—',
      c.movimiento ? plata(c.montoMp) : '—',
    ]),
    alinear: [...(conDia ? (['izq'] as const) : []), 'izq', 'izq', 'izq', 'der', 'der'],
  }
}

function lineaCobertura(r: ResultadoConciliacion): string {
  const conectables = r.cuentas.filter((t) => t.estado !== 'banco').length
  const partes = [`${r.cobertura.cuentasConectadas} de ${conectables} cuentas conectadas`, `${r.cobertura.pctPlata} % de la plata verificable`]
  if (r.cobertura.frescura) partes.push(r.cobertura.frescura)
  return partes.join(' · ')
}

// ─────────────────────────────────────────────────────────────────────────────
// conciliacion_mp
// ─────────────────────────────────────────────────────────────────────────────

const conciliacionMp = definirHerramienta({
  nombre: 'conciliacion_mp',
  descripcion:
    'Cruza lo cobrado por transferencia en el sistema con lo que entró DE VERDAD en las cuentas de Mercado Pago y dice si cuadró la plata. ' +
    'Usala para "¿cuadró la plata?", "¿llegaron todas las transferencias?", "¿falta plata?", "controlá Mercado Pago". ' +
    'Devuelve el veredicto (cuadra, faltan, sobran, no se sabe todavía, no se pudo leer), los totales, la cobertura (qué cuentas no están conectadas o no se pudieron leer) ' +
    'y los casos para revisar más grandes. "Cuadra" sólo vale con cobertura total: si hay cuentas sin conectar o sin leer, decilo primero. ' +
    'Lo que falta y lo que sobra nunca se netean. Por defecto mira ayer.',
  esquema: z.object({
    ...camposPeriodo,
    sucursal: z.string().max(80).optional().describe('Nombre de la sucursal (ej. "Paraná"). Sin sucursal: todas las del alcance.'),
  }),
  disponible,
  ejecutar: async (input, { ctx }) => {
    const neg = permitir(ctx, PERMISO, DOMINIO)
    if (neg) return denegada(neg)
    const c = contexto(ctx, input)
    if ('salida' in c) return c.salida

    const r = await conciliarPeriodo(ctx.orgId, {
      desde: c.per.desde,
      hasta: c.per.hasta,
      sucursalesIds: c.sucursalesIds,
      etiqueta: c.per.etiqueta,
    })
    if (!r.ok) return fallida(r.error)

    const conDia = c.per.desdeDia !== c.per.hastaDia
    const enlace = enlaceDe(c.per, c.sucursalId)
    const veredicto: TexVeredictoConciliacion = {
      tipo: r.veredicto.tipo,
      titular: r.veredicto.titular,
      detalle: r.veredicto.detalle,
      periodo: r.periodo.etiqueta,
      faltante: r.veredicto.faltante,
      sobrante: r.veredicto.sobrante,
      paraRevisar: r.veredicto.paraRevisar,
      cobertura: lineaCobertura(r),
      enlace,
    }
    const kpis: TexKpi[] = [
      { etiqueta: 'Cobros', valor: String(r.totales.cobros) },
      { etiqueta: 'En el sistema', valor: plata(r.totales.montoSistema) },
      { etiqueta: 'En Mercado Pago', valor: plata(r.totales.montoMp) },
      { etiqueta: 'Para revisar', valor: String(r.totales.paraRevisar) },
    ]
    const paraRevisar = r.casos.filter((x) => PARA_REVISAR.has(x.estado)).sort((a, b) => peso(b) - peso(a))
    const paraConfirmar = r.casos.filter((x) => esEmparejamientoDudoso(x)).sort((a, b) => peso(b) - peso(a))
    const bloques: TexBloque[] = [
      { tipo: 'conciliacion', veredicto },
      { tipo: 'kpis', items: kpis },
    ]
    if (paraRevisar.length) {
      bloques.push({ tipo: 'tabla', tabla: tablaCasos('Las diferencias más grandes', paraRevisar.slice(0, 8), conDia) })
    }
    if (paraConfirmar.length) {
      bloques.push({ tipo: 'tabla', tabla: tablaCasos('Emparejamientos para confirmar', paraConfirmar.slice(0, 5), conDia) })
    }

    const sinConectar = r.cuentas
      .filter((t) => (t.estado === 'sin_conectar' || t.estado === 'sin_alias') && (t.periodo.cobros > 0 || t.pctPlata30d > 0))
      .map((t) => t.alias ?? 'sin alias')
    const conError = r.cuentas
      .filter((t) => t.estado === 'error' || t.estado === 'revocada')
      .map((t) => ({ alias: t.alias, detalle: t.detalleEstado }))

    const paraUI: TexSalidaUI = {
      bloques,
      fuente: `Conciliación Mercado Pago · ${r.periodo.etiqueta} · ${c.alcance}`,
      enlace: { href: enlace, texto: 'Ver la conciliación' },
    }
    return {
      paraModelo: {
        periodo: { desde: c.per.desdeDia, hasta: c.per.hastaDia, etiqueta: r.periodo.etiqueta },
        alcance: c.alcance,
        veredicto: r.veredicto,
        totales: r.totales,
        cobertura: {
          ...r.cobertura,
          cuentasSinConectar: sinConectar,
          cuentasConError: conError,
        },
        narrativa: r.narrativa,
        casosParaRevisar: paraRevisar.slice(0, 15).map((x) => compacto(x, conDia)),
        casosParaRevisarTotal: paraRevisar.length,
        casosParaConfirmar: paraConfirmar.slice(0, 10).map((x) => compacto(x, conDia)),
        casosParaConfirmarTotal: paraConfirmar.length,
        nota:
          'Si el veredicto es no_se_sabe o error, hay plata que no se pudo verificar: no digas que cuadra. ' +
          'Los emparejamientos "para confirmar" (mismo monto con mucha diferencia de hora, o un crédito que suma varios cobros sin marcar) ' +
          'no prueban que la plata entró: no cuentan como verificados hasta que una persona los confirme en la pantalla de conciliación. ' +
          'Si ese crédito no es de ese cobro, también se puede descartar con "No es este" en la misma pantalla: no se vuelven a juntar ' +
          'y cada uno queda a la vista (el cobro como que falta, el crédito como que sobra, o con otro emparejamiento). ' +
          'Un caso con descartadosAMano tiene emparejamientos que una persona ya descartó: no los vuelvas a sugerir. ' +
          'Los casos "pendiente" con un cobro esperan la próxima lectura de Mercado Pago; los "pendiente" sin cobro son transferencias ' +
          'que acaban de entrar y esperan que se registre su cobro. Ninguno de los dos es un faltante ni un sobrante.',
      },
      paraUI,
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// conciliacion_casos
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS: [EstadoCaso, ...EstadoCaso[]] = [
  'conciliado',
  'otra_cuenta',
  'monto_mayor',
  'monto_menor',
  'solo_sistema',
  'solo_mp',
  'pendiente',
  'sin_verificar',
  'ajeno',
  'revisado',
]

const conciliacionCasos = definirHerramienta({
  nombre: 'conciliacion_casos',
  descripcion:
    'Lista los casos de la conciliación con Mercado Pago. Por defecto, los que hay que revisar (no están en Mercado Pago, entraron sin cobro registrado, ' +
    'montos distintos, entraron en otra cuenta), los de más plata primero. Filtrá por estado o por cuenta (alias). ' +
    'Usala después de conciliacion_mp para dar el detalle, o cuando pidan ver las diferencias de un día o de una cuenta.',
  esquema: z.object({
    estado: z
      .enum([...ESTADOS, 'para_revisar', 'para_confirmar'])
      .optional()
      .describe(
        'para_revisar (por defecto), para_confirmar (emparejados con poca certeza: falta que alguien los confirme o los descarte con "No es este" en la pantalla), conciliado, otra_cuenta, monto_mayor, monto_menor, solo_sistema (no está en MP), solo_mp (no está en el sistema), pendiente, sin_verificar, ajeno, revisado.',
      ),
    ...camposPeriodo,
    cuenta: z.string().max(80).optional().describe('Alias de la cuenta (ej. "monacoparana4").'),
    sucursal: z.string().max(80).optional().describe('Nombre de la sucursal. Sin sucursal: todas las del alcance.'),
    limite: z.number().int().min(1).max(30).optional().describe('Cuántos casos (máximo 30, por defecto 15).'),
  }),
  disponible,
  ejecutar: async (input, { ctx }) => {
    const neg = permitir(ctx, PERMISO, DOMINIO)
    if (neg) return denegada(neg)
    const c = contexto(ctx, input)
    if ('salida' in c) return c.salida

    const r = await conciliarPeriodo(ctx.orgId, {
      desde: c.per.desde,
      hasta: c.per.hasta,
      sucursalesIds: c.sucursalesIds,
      etiqueta: c.per.etiqueta,
    })
    if (!r.ok) return fallida(r.error)

    const estado = input.estado ?? 'para_revisar'
    const cuenta = input.cuenta ? normalizarAlias(input.cuenta) : null
    const limite = input.limite ?? 15
    let casos = r.casos.filter((x) =>
      estado === 'para_revisar' ? PARA_REVISAR.has(x.estado) : estado === 'para_confirmar' ? esEmparejamientoDudoso(x) : x.estado === estado,
    )
    if (cuenta) casos = casos.filter((x) => normalizarAlias(x.alias).includes(cuenta) || normalizarAlias(x.aliasMp).includes(cuenta))
    const porPlata = estado === 'para_revisar' || estado === 'para_confirmar' || PARA_REVISAR.has(estado as EstadoCaso)
    casos.sort((a, b) => (porPlata ? peso(b) - peso(a) : 0) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))

    const conDia = c.per.desdeDia !== c.per.hastaDia
    const etiquetaEstado =
      estado === 'para_revisar' ? 'Para revisar' : estado === 'para_confirmar' ? ETIQUETA_PARA_CONFIRMAR : ETIQUETA_ESTADO[estado]
    const enlace = enlaceDe(c.per, c.sucursalId)
    if (!casos.length) {
      const texto = `No hay casos "${etiquetaEstado}" ${cuenta ? `en ${input.cuenta} ` : ''}en ${r.periodo.etiqueta.toLowerCase()}.`
      return {
        paraModelo: { total: 0, estado, cuenta: input.cuenta ?? null, veredicto: r.veredicto.tipo, mensaje: texto },
        paraUI: { bloques: [{ tipo: 'aviso', tono: 'info', texto }], enlace: { href: enlace, texto: 'Ver la conciliación' } },
      }
    }
    const mostrados = casos.slice(0, limite)
    return {
      paraModelo: {
        periodo: { desde: c.per.desdeDia, hasta: c.per.hastaDia, etiqueta: r.periodo.etiqueta },
        estado,
        cuenta: input.cuenta ?? null,
        total: casos.length,
        mostrados: mostrados.length,
        casos: mostrados.map((x) => compacto(x, conDia)),
      },
      paraUI: {
        bloques: [{ tipo: 'tabla', tabla: tablaCasos(`${etiquetaEstado} · ${casos.length} ${casos.length === 1 ? 'caso' : 'casos'}`, mostrados, conDia) }],
        fuente: `Conciliación Mercado Pago · ${r.periodo.etiqueta} · ${c.alcance}`,
        enlace: { href: enlace, texto: 'Ver los casos' },
      },
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// cuentas_mp
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_CUENTA: Record<CuentaConciliacion['estado'], string> = {
  al_dia: 'Al día',
  atrasada: 'Atrasada',
  sin_conectar: 'Sin conectar',
  error: 'Con error',
  revocada: 'Sin permiso',
  banco: 'Banco',
  sin_alias: 'Sin alias',
}

const cuentasMp = definirHerramienta({
  nombre: 'cuentas_mp',
  descripcion:
    'Estado de cada cuenta de Mercado Pago donde se cobra por transferencia: conectada y leída hace cuánto, sin conectar, con error, ' +
    'sin permiso, de banco. Usala para "¿qué cuentas faltan conectar?", "¿están todas las cuentas al día?" o cuando la conciliación diga que no se puede saber.',
  esquema: z.object({}),
  disponible,
  ejecutar: async (_input, { ctx }) => {
    const neg = permitir(ctx, PERMISO, DOMINIO)
    if (neg) return denegada(neg)
    if (!ctx.sucursalesIds.length) return aviso('No tenés sucursales asignadas.', { error: 'sin_sucursales' })
    const r = await tarjetasDeCuentas(ctx.orgId, ctx.sucursalesIds)
    if (!r.ok) return fallida(r.error)
    if (!r.cuentas.length) return aviso('No hay cuentas de cobro cargadas.', { cuentas: [] })

    const ahora = new Date()
    const leida = (t: CuentaConciliacion) => (t.sincronizadaHasta ? haceCuanto(t.sincronizadaHasta, ahora) : '—')
    const conectadas = r.cuentas.filter((t) => t.estado === 'al_dia' || t.estado === 'atrasada' || t.estado === 'error')
    const sinConectar = r.cuentas.filter((t) => t.estado === 'sin_conectar' || t.estado === 'sin_alias')
    return {
      paraModelo: {
        resumen: {
          cuentas: r.cuentas.length,
          conectadas: conectadas.length,
          sinConectar: sinConectar.length,
          conError: r.cuentas.filter((t) => t.estado === 'error' || t.estado === 'revocada').length,
          sinConfirmar: r.cuentas.filter((t) => t.cuentaMpId && !t.confirmada).length,
          linkDeConexionDisponible: r.oauthDisponible,
        },
        cuentas: r.cuentas.map((t) => ({
          alias: t.alias,
          sucursales: t.sucursales.map((s) => s.nombre),
          estado: t.estado,
          detalle: t.detalleEstado,
          leida: t.sincronizadaHasta ? leida(t) : null,
          confirmada: t.confirmada,
          activa: t.activa,
          pctDeLoTransferido30Dias: t.pctPlata30d,
        })),
      },
      paraUI: {
        bloques: [
          {
            tipo: 'kpis',
            items: [
              { etiqueta: 'Conectadas', valor: `${conectadas.length} de ${r.cuentas.filter((t) => t.estado !== 'banco').length}` },
              { etiqueta: 'Sin conectar', valor: String(sinConectar.length) },
            ],
          },
          {
            tipo: 'tabla',
            tabla: {
              titulo: 'Cuentas de Mercado Pago',
              columnas: ['Cuenta', 'Sucursales', 'Estado', 'Leída', '% de lo transferido (30 días)'],
              filas: r.cuentas.map((t) => [
                t.alias ?? 'Sin alias',
                t.sucursales.map((s) => s.nombre).join(' y '),
                t.cuentaMpId && !t.confirmada ? 'Falta confirmar' : ETIQUETA_CUENTA[t.estado],
                leida(t),
                `${t.pctPlata30d.toLocaleString('es-AR')} %`,
              ]),
              alinear: ['izq', 'izq', 'izq', 'izq', 'der'],
            },
          },
        ],
        fuente: 'Conciliación Mercado Pago · Cuentas',
        enlace: { href: '/dashboard/conciliacion', texto: 'Ver las cuentas' },
      },
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// sincronizar_mp
// ─────────────────────────────────────────────────────────────────────────────

const PRESUPUESTO_TOTAL_MS = 40_000
const MINIMO_POR_CUENTA_MS = 8_000

const sincronizarMp = definirHerramienta({
  nombre: 'sincronizar_mp',
  descripcion:
    'Trae ahora los movimientos de Mercado Pago de las cuentas conectadas que se leyeron hace más de 10 minutos. Sólo LEE Mercado Pago. ' +
    'Usala sólo si los datos están viejos (la conciliación dice "pendiente" o "leído hace mucho") o si te lo piden; después volvé a correr conciliacion_mp.',
  esquema: z.object({}),
  disponible,
  ejecutar: async (_input, { ctx, signal }) => {
    const neg = permitir(ctx, PERMISO, DOMINIO)
    if (neg) return denegada(neg)
    if (!ctx.sucursalesIds.length) return aviso('No tenés sucursales asignadas.', { error: 'sin_sucursales' })

    let cuentas
    try {
      cuentas = await cuentasSincronizables(ctx.orgId, ctx.sucursalesIds)
    } catch (e) {
      return fallida('No pude leer las cuentas de Mercado Pago.', e instanceof Error ? e.message : undefined)
    }
    if (!cuentas.length) {
      return aviso('No hay cuentas de Mercado Pago conectadas para leer.', { sincronizadas: 0, motivo: 'sin_cuentas_conectadas' })
    }
    const atrasadas = cuentas.filter((x) => x.necesita)
    if (!atrasadas.length) {
      return aviso('Todas las cuentas se leyeron hace menos de 10 minutos.', { sincronizadas: 0, motivo: 'al_dia' }, 'ok')
    }

    const limite = Date.now() + PRESUPUESTO_TOTAL_MS
    const filas: (string | number | null)[][] = []
    const resultados: { alias: string | null; ok: boolean; nuevos: number; leidos: number; leidaHasta: string | null; omitida?: string; error?: string }[] = []
    let sinTiempo = 0
    for (const x of atrasadas) {
      const restante = limite - Date.now()
      if (signal.aborted || restante < MINIMO_POR_CUENTA_MS) {
        sinTiempo++
        continue
      }
      const r = await sincronizarCuenta(x.cuentaMpId, { origen: 'tex', presupuestoMs: Math.min(30_000, restante), signal })
      const estado = r.omitida === 'candado' ? 'Ya se estaba leyendo' : r.omitida === 'reciente' ? 'Leída hace poco' : r.ok ? 'Leída' : `No se pudo: ${r.error ?? 'error'}`
      filas.push([r.alias ?? x.alias ?? 'Sin alias', estado, r.nuevos, r.sincronizadaHasta ? hhmmAR(r.sincronizadaHasta) : '—'])
      resultados.push({
        alias: r.alias ?? x.alias,
        ok: r.ok,
        nuevos: r.nuevos,
        leidos: r.leidos,
        leidaHasta: r.sincronizadaHasta,
        ...(r.omitida ? { omitida: r.omitida } : {}),
        ...(r.error ? { error: r.error } : {}),
      })
    }

    const bloques: TexBloque[] = []
    if (filas.length) {
      bloques.push({
        tipo: 'tabla',
        tabla: {
          titulo: 'Lectura de Mercado Pago',
          columnas: ['Cuenta', 'Resultado', 'Movimientos nuevos', 'Completa hasta'],
          filas,
          alinear: ['izq', 'izq', 'der', 'der'],
        },
      })
    }
    if (sinTiempo) {
      bloques.push({
        tipo: 'aviso',
        tono: 'info',
        texto: signal.aborted
          ? 'Se detuvo antes de terminar: las demás cuentas se leen solas en la próxima corrida.'
          : `${sinTiempo} ${sinTiempo === 1 ? 'cuenta quedó' : 'cuentas quedaron'} para la próxima lectura automática (cada 15 minutos).`,
      })
    }
    return {
      paraModelo: { cuentas: resultados, sinTiempo, interrumpido: signal.aborted },
      paraUI: { bloques, fuente: 'Mercado Pago · lectura de movimientos', enlace: { href: '/dashboard/conciliacion', texto: 'Ver la conciliación' } },
    }
  },
})

/**
 * `TexHerramienta<S>` es invariante en su esquema (S está en `esquema` y en el
 * input de `ejecutar`), así que una herramienta concreta no entra sola en un
 * `TexHerramienta[]`. La conversión es segura: el registro valida SIEMPRE el
 * input con `h.esquema.safeParse` antes de llamar a `ejecutar`.
 */
function comun<S extends ZodTypeAny>(h: TexHerramienta<S>): TexHerramienta {
  return h as unknown as TexHerramienta
}

export const herramientasConciliacion: TexHerramienta[] = [
  comun(conciliacionMp),
  comun(conciliacionCasos),
  comun(cuentasMp),
  comun(sincronizarMp),
]
