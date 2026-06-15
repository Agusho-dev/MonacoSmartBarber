import 'server-only'

import { tool } from 'ai'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchFinancialData } from '@/lib/actions/finances'
import { fetchStats } from '@/lib/actions/stats'
import { getDashboardOverview } from '@/lib/actions/overview'
import { getCommissionSummary } from '@/lib/actions/salary'
import { getCrmCases, getOpenCrmCaseCount } from '@/lib/actions/crm-cases'
import { searchClients } from '@/lib/actions/clients'
import { searchKnowledge } from './rag'
import { assistantReportSchema } from './report-schema'
import { auditAssistant, type AssistantContext, type DataDomain } from './context'

const DOMAIN_LABEL: Record<DataDomain, string> = {
  finanzas: 'Finanzas',
  salarios: 'Sueldos y comisiones',
  estadisticas: 'Estadísticas',
  clientes: 'Clientes',
  resenas: 'Reseñas',
  turnos: 'Turnos',
  fidelizacion: 'Fidelización',
}

type Denial = { error: 'sin_acceso'; message: string }

export function buildTools(ctx: AssistantContext) {
  // Gate de permiso + dominio. Devuelve mensaje de denegación o null.
  function gate(perm: string | null, domain: DataDomain | null): string | null {
    if (domain && ctx.dataAccess[domain] === false) {
      return `El acceso a "${DOMAIN_LABEL[domain]}" está desactivado en la configuración del asistente.`
    }
    if (perm && ctx.permissions[perm] !== true) {
      return `No tenés permiso para ver esta información.`
    }
    return null
  }

  function deny(toolName: string, message: string): Denial {
    void auditAssistant(ctx, { kind: 'denied', toolName, allowed: false, detail: { message } })
    return { error: 'sin_acceso', message }
  }

  function ok(toolName: string, detail?: Record<string, unknown>) {
    void auditAssistant(ctx, { kind: 'tool', toolName, allowed: true, detail })
  }

  const branchHint = ctx.scopedBranchIds.length === 1 ? ' (tenés acceso a una sola sucursal)' : ''

  // ── Resolución tolerante de sucursal ──────────────────────────────
  // Acepta nombre ("Rondeau"), slug ("rondeau") o UUID y lo mapea a un id EN ALCANCE.
  // Antes las tools pedían `branchId: uuid`: el modelo no conocía los UUID, metía el
  // nombre, Zod lo rechazaba y devolvía "necesito el identificador en formato UUID".
  // Ahora el modelo pasa el nombre y el servidor resuelve (con el directorio ya scopeado).
  const BRANCH_PARAM = z
    .string()
    .optional()
    .describe('Nombre, slug o ID de la sucursal a filtrar (ej: "Rondeau"). Omitir para incluir TODAS las sucursales.')

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const allBranchNames = () => ctx.branches.map((b) => b.name)

  type BranchError = { error: 'sucursal_no_resuelta'; message: string; sucursales_disponibles: string[] }
  type BranchPick = null | { id: string; name: string } | BranchError

  function branchErr(message: string, opciones: string[] = allBranchNames()): BranchError {
    return { error: 'sucursal_no_resuelta', message, sucursales_disponibles: opciones }
  }
  function isBranchErr(p: BranchPick): p is BranchError {
    return p !== null && 'error' in p
  }

  /** null = todas; {id,name} = resuelta; BranchError = no se pudo (el modelo puede repreguntar). */
  function resolveBranch(input?: string | null): BranchPick {
    if (input == null || input.trim() === '') return null
    const raw = input.trim()
    const branches = ctx.branches
    if (branches.length === 0) return branchErr('No hay sucursales accesibles en tu cuenta.', [])

    if (UUID_RE.test(raw)) {
      const hit = branches.find((b) => b.id === raw)
      return hit ? { id: hit.id, name: hit.name } : branchErr(`No tenés acceso a una sucursal con ese identificador. Sucursales disponibles: ${allBranchNames().join(', ')}.`)
    }

    const q = norm(raw)
    // 1) coincidencia exacta por slug o nombre
    let hit = branches.find((b) => (b.slug ? norm(b.slug) === q : false) || norm(b.name) === q)
    // 2) prefijo
    if (!hit) {
      const starts = branches.filter((b) => norm(b.name).startsWith(q) || (b.slug ? norm(b.slug).startsWith(q) : false))
      if (starts.length === 1) hit = starts[0]
      else if (starts.length > 1) return branchErr(`"${raw}" coincide con varias sucursales: ${starts.map((b) => b.name).join(', ')}. ¿Cuál querés?`, starts.map((b) => b.name))
    }
    // 3) substring: solo si el NOMBRE (o slug) contiene el query, nunca al revés.
    //    Unidireccional + largo mínimo evita que un input largo que contenga un nombre
    //    corto ("Test") resuelva silenciosamente a la sucursal equivocada (→ datos errados).
    if (!hit && q.length >= 3) {
      const incl = branches.filter((b) => norm(b.name).includes(q) || (b.slug ? norm(b.slug).includes(q) : false))
      if (incl.length === 1) hit = incl[0]
      else if (incl.length > 1) return branchErr(`"${raw}" coincide con varias sucursales: ${incl.map((b) => b.name).join(', ')}. ¿Cuál querés?`, incl.map((b) => b.name))
    }
    return hit ? { id: hit.id, name: hit.name } : branchErr(`No encontré una sucursal que coincida con "${raw}". Sucursales disponibles: ${allBranchNames().join(', ')}.`)
  }

  return {
    resumen_negocio: tool({
      description: `Resumen del día de hoy: ingresos, atenciones completadas, clientes nuevos del mes y últimas visitas. Usalo para "¿cómo va el día?" o un panorama rápido.${branchHint}`,
      inputSchema: z.object({}),
      execute: async () => {
        const d = gate('dashboard.home', null)
        if (d) return deny('resumen_negocio', d)
        const data = await getDashboardOverview()
        ok('resumen_negocio')
        if (!data) return { error: 'sin_datos', message: 'No pude resolver el resumen.' }
        return {
          ingresos_hoy: data.todayRevenue,
          atenciones_hoy: data.todayVisits?.length ?? 0,
          clientes_nuevos_mes: data.newClientsThisMonth,
          sucursales: data.branches?.map((b) => b.name),
          ultimas_visitas: (data.recentVisits ?? []).slice(0, 8).map((v) => ({
            cliente: v.client?.name ?? 'Sin nombre',
            barbero: v.barber?.full_name ?? null,
            servicio: v.service?.name ?? null,
            monto: v.amount,
            completada: v.completed_at,
          })),
        }
      },
    }),

    listar_sucursales: tool({
      description:
        'Lista las sucursales a las que tenés acceso, con su nombre, dirección y modo de operación. Usalo para "¿qué sucursales tengo?" o si necesitás saber qué sucursales existen antes de filtrar por una.',
      inputSchema: z.object({}),
      execute: async () => {
        ok('listar_sucursales')
        return {
          total: ctx.branches.length,
          sucursales: ctx.branches.map((b) => ({
            nombre: b.name,
            direccion: b.address ?? null,
            modo_operacion: b.operation_mode ?? null,
          })),
        }
      },
    }),

    finanzas_pyl: tool({
      description:
        'Análisis financiero: P&L mensual (ingresos, gastos, ganancia neta), ranking de barberos por rentabilidad, ingresos por servicio, break-even y variación mes a mes. Parámetro mesesAtras: cuántos meses hacia atrás incluir (0 = todo el historial). Siempre se incluye al menos el mes anterior para poder comparar la variación; para "este mes" usá mesesAtras=1.',
      inputSchema: z.object({
        mesesAtras: z.number().int().min(0).max(24).default(6),
        mesFinal: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('Mes final YYYY-MM, opcional'),
        sucursal: BRANCH_PARAM,
      }),
      execute: async ({ mesesAtras, mesFinal, sucursal }) => {
        const d = gate('finances.view_summary', 'finanzas')
        if (d) return deny('finanzas_pyl', d)
        const picked = resolveBranch(sucursal)
        if (isBranchErr(picked)) return picked
        const branch = picked?.id ?? null
        // Garantizar baseline para la variación mes a mes: con 1 mes no hay con qué comparar.
        // mesesAtras=0 (todo el historial) se respeta; cualquier ventana acotada incluye >=2 meses.
        const mesesEfectivos = mesesAtras === 0 ? 0 : Math.max(mesesAtras, 2)
        const f = await fetchFinancialData(mesesEfectivos, branch, mesFinal ?? null)
        ok('finanzas_pyl', { mesesAtras, sucursal: picked?.name ?? 'todas' })
        return {
          sucursal: picked?.name ?? 'todas las sucursales',
          totales: f.totals,
          break_even: f.breakEven,
          variacion_mensual: f.momChange,
          meses: f.months.map((m) => ({
            mes: m.month, label: m.label, ingresos: m.revenue, gastos_totales: m.totalExpenses,
            ganancia_neta: m.netProfit, cortes: m.cuts,
          })),
          top_barberos: f.barberPerformance.slice(0, 8),
          top_servicios: f.serviceRevenue.slice(0, 10),
        }
      },
    }),

    estadisticas: tool({
      description:
        'Estadísticas operativas en un rango de fechas: ranking de barberos, tendencia diaria de ingresos/cortes, ingresos por método de pago, segmentación de clientes (nuevos/recurrentes/en riesgo/perdidos), TASA DE RETORNO del período (qué % de la gente volvió, en `retorno_clientes`) y horarios pico. Pasá fechas ISO (ej: 2026-05-01T00:00:00). Para "¿qué % volvió?" sin período explícito, usá los últimos 90 días.',
      inputSchema: z.object({
        desde: z.string().optional().describe('Fecha/hora ISO de inicio. Omitir = últimos 90 días.'),
        hasta: z.string().optional().describe('Fecha/hora ISO de fin. Omitir = hoy.'),
        sucursal: BRANCH_PARAM,
      }),
      execute: async ({ desde, hasta, sucursal }) => {
        const d = gate('stats.view', 'estadisticas')
        if (d) return deny('estadisticas', d)
        const picked = resolveBranch(sucursal)
        if (isBranchErr(picked)) return picked
        const branch = picked?.id ?? null
        // Default server-side: últimos 90 días (no le pedimos al modelo que calcule fechas).
        const nowISO = new Date().toISOString()
        const hastaISO = hasta || nowISO
        const desdeISO = desde || new Date(Date.now() - 90 * 86400000).toISOString()
        const s = await fetchStats(desdeISO, hastaISO, branch)
        ok('estadisticas', { sucursal: picked?.name ?? 'todas' })
        const peakHours = [...s.heatmap]
          .sort((a, b) => b.count - a.count)
          .slice(0, 6)
          .map((c) => ({ dia: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][c.day], hora: c.hour, atenciones: c.count }))
        return {
          sucursal: picked?.name ?? 'todas las sucursales',
          periodo: { desde: desdeISO, hasta: hastaISO },
          totales: s.totals,
          // Tasa de retorno del período: clientes con 2+ visitas ÷ clientes únicos atendidos
          // entre `desde` y `hasta` (misma ventana). Es la respuesta a "¿qué % de gente volvió?".
          retorno_clientes: {
            clientes_que_volvieron: s.retention.returning_in_period,
            clientes_unicos: s.retention.unique_in_period,
            tasa_pct: Math.round(s.retention.rate * 1000) / 10,
          },
          ranking_barberos: s.ranking,
          ingresos_por_metodo: s.revenueByMethod,
          segmentacion_clientes: s.segmentation,
          horarios_pico: peakHours,
          tendencia_diaria: s.trends.length > 62 ? s.trends.slice(-62) : s.trends,
        }
      },
    }),

    sueldos_comisiones: tool({
      description:
        'Resumen de comisiones y sueldos: total pendiente y pagado, y desglose de comisiones pendientes por barbero. Información sensible (requiere permiso de sueldos).',
      inputSchema: z.object({ sucursal: BRANCH_PARAM }),
      execute: async ({ sucursal }) => {
        const d = gate('salary.view', 'salarios')
        if (d) return deny('sueldos_comisiones', d)
        const picked = resolveBranch(sucursal)
        if (isBranchErr(picked)) return picked
        const branch = picked?.id ?? null
        const sum = await getCommissionSummary(branch)
        ok('sueldos_comisiones', { sucursal: picked?.name ?? 'todas' })
        // Resolver nombres de barberos
        const ids = sum.pendingByBarber.map((p) => p.staffId)
        const names = new Map<string, string>()
        if (ids.length) {
          const supabase = createAdminClient()
          const { data: staff } = await supabase.from('staff').select('id, full_name').in('id', ids)
          for (const s of staff ?? []) names.set(s.id, s.full_name)
        }
        return {
          total_pendiente: sum.totalPending,
          total_pagado: sum.totalPaid,
          cantidad_pendiente: sum.pendingCount,
          comisiones_pendientes_por_barbero: sum.pendingByBarber.map((p) => ({
            barbero: names.get(p.staffId) ?? 'Barbero', monto: p.amount,
          })),
        }
      },
    }),

    buscar_cliente: tool({
      description:
        'Busca clientes por nombre o teléfono y devuelve su historial resumido (visitas totales, última visita). Mínimo 2 caracteres.',
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => {
        const d = gate('clients.view', 'clientes')
        if (d) return deny('buscar_cliente', d)
        const res = await searchClients(query)
        ok('buscar_cliente')
        const matches = 'data' in res ? res.data ?? [] : []
        if (matches.length === 0) return { resultados: [] }
        const supabase = createAdminClient()
        const ids = matches.map((m) => m.id)
        const { data: loyalty } = await supabase
          .from('client_loyalty_state')
          .select('client_id, total_visits, last_visit_at, current_streak')
          .eq('organization_id', ctx.orgId)
          .in('client_id', ids)
        const lmap = new Map((loyalty ?? []).map((l) => [l.client_id, l]))
        return {
          resultados: matches.slice(0, 8).map((m) => ({
            nombre: m.name, telefono: m.phone,
            visitas_totales: lmap.get(m.id)?.total_visits ?? 0,
            ultima_visita: lmap.get(m.id)?.last_visit_at ?? null,
            racha: lmap.get(m.id)?.current_streak ?? 0,
          })),
        }
      },
    }),

    fidelizacion: tool({
      description:
        'Estado del programa de puntos/fidelización: puntos activos totales, total canjeado y clientes top por saldo de puntos.',
      inputSchema: z.object({ topN: z.number().int().min(1).max(25).default(10) }),
      execute: async ({ topN }) => {
        const d = gate('rewards.view', 'fidelizacion')
        if (d) return deny('fidelizacion', d)
        const supabase = createAdminClient()
        const { data: agg } = await supabase
          .from('client_points')
          .select('points_balance, total_earned, total_redeemed')
          .eq('organization_id', ctx.orgId)
        const totals = (agg ?? []).reduce(
          (acc, r) => ({
            activos: acc.activos + (r.points_balance ?? 0),
            ganados: acc.ganados + (r.total_earned ?? 0),
            canjeados: acc.canjeados + (r.total_redeemed ?? 0),
          }),
          { activos: 0, ganados: 0, canjeados: 0 },
        )
        const { data: top } = await supabase
          .from('client_points')
          .select('points_balance, clients(name, phone)')
          .eq('organization_id', ctx.orgId)
          .order('points_balance', { ascending: false })
          .limit(topN)
        ok('fidelizacion')
        return {
          puntos_activos: totals.activos,
          puntos_ganados_historico: totals.ganados,
          puntos_canjeados_historico: totals.canjeados,
          top_clientes: (top ?? []).map((t) => {
            const c = t.clients as unknown as { name?: string; phone?: string } | null
            return { nombre: c?.name ?? 'Sin nombre', telefono: c?.phone ?? null, puntos: t.points_balance }
          }),
        }
      },
    }),

    turnos_resumen: tool({
      description:
        'Resumen de turnos agendados en un rango: conteo por estado (confirmados, completados, cancelados, no-show) y total. Pasá fechas YYYY-MM-DD.',
      inputSchema: z.object({
        desde: z.string().describe('YYYY-MM-DD'),
        hasta: z.string().describe('YYYY-MM-DD'),
        sucursal: BRANCH_PARAM,
      }),
      execute: async ({ desde, hasta, sucursal }) => {
        const d = gate('appointments.view', 'turnos')
        if (d) return deny('turnos_resumen', d)
        const picked = resolveBranch(sucursal)
        if (isBranchErr(picked)) return picked
        const supabase = createAdminClient()
        let q = supabase
          .from('appointments')
          .select('status, appointment_date')
          .eq('organization_id', ctx.orgId)
          .gte('appointment_date', desde)
          .lte('appointment_date', hasta)
        if (picked) q = q.eq('branch_id', picked.id)
        const { data } = await q
        const counts: Record<string, number> = {}
        for (const a of data ?? []) counts[a.status] = (counts[a.status] ?? 0) + 1
        ok('turnos_resumen', { sucursal: picked?.name ?? 'todas' })
        return { sucursal: picked?.name ?? 'todas las sucursales', total: data?.length ?? 0, por_estado: counts }
      },
    }),

    reviews_crm: tool({
      description:
        'Reseñas y casos de atención al cliente: cantidad de casos abiertos y los casos/reseñas recientes con su comentario y calificación. Útil para "¿de qué se quejan?" o reputación.',
      inputSchema: z.object({}),
      execute: async () => {
        const d = gate('clients.view', 'resenas')
        if (d) return deny('reviews_crm', d)
        const [cases, open] = await Promise.all([getCrmCases(), getOpenCrmCaseCount()])
        ok('reviews_crm')
        return {
          casos_abiertos: open.count,
          casos_recientes: (cases.data ?? []).slice(0, 12).map((c) => ({
            estado: c.status,
            cliente: c.client?.name ?? null,
            calificacion: c.review?.rating ?? null,
            comentario: c.review?.comment ?? null,
            categorias: c.review?.improvement_categories ?? null,
            nota_interna: c.internal_notes,
            fecha: c.created_at,
          })),
        }
      },
    }),

    buscar_conocimiento: tool({
      description:
        'Búsqueda semántica (RAG) sobre la base de conocimiento, los mensajes de clientes y las notas. Usalo para preguntas cualitativas: "¿qué dicen los clientes?", "¿hay quejas sobre X?", "¿cómo funciona Y?". Devuelve fragmentos relevantes.',
      inputSchema: z.object({
        consulta: z.string().min(2),
        fuentes: z.array(z.enum(['kb', 'message', 'review', 'crm', 'note'])).optional(),
      }),
      execute: async ({ consulta, fuentes }) => {
        const nonKb = (fuentes ?? ['kb', 'message']).some((f) => f !== 'kb')
        if (nonKb) {
          const d = gate('clients.view', null)
          if (d) return deny('buscar_conocimiento', d)
        }
        const { hits, embedded } = await searchKnowledge(ctx.orgId, consulta, {
          sources: fuentes,
          matchCount: 8,
        })
        ok('buscar_conocimiento', { embedded, hits: hits.length })
        if (!embedded) {
          return {
            aviso:
              'La búsqueda semántica aún no está disponible: falta configurar la API key de OpenAI (embeddings) o indexar contenido. Igual puedo responder con las herramientas de datos.',
            fragmentos: [],
          }
        }
        return {
          fragmentos: hits.map((h) => ({ titulo: h.title, fuente: h.source_type, texto: h.content, relevancia: Math.round(h.similarity * 100) / 100 })),
        }
      },
    }),

    generar_reporte: tool({
      description:
        'Genera un informe estructurado (KPIs, tablas, gráficos y síntesis) que el usuario puede ver y DESCARGAR EN PDF. Llamalo SOLO después de haber traído los datos con las otras herramientas. Pasá los datos ya calculados; no inventes cifras.',
      inputSchema: assistantReportSchema,
      execute: async (report) => {
        ok('generar_reporte', { title: report.title })
        // El objeto se devuelve tal cual; la UI lo renderiza y ofrece descarga PDF.
        return { ok: true, report }
      },
    }),

    ...(ctx.proMode
      ? {
          consulta_sql: tool({
            description:
              'MODO PRO: ejecuta una consulta SQL de SOLO LECTURA (un único SELECT) sobre vistas analíticas ya filtradas por tu organización, para preguntas fuera de las herramientas curadas. Sin punto y coma, sin comentarios, sin DML. Devuelve hasta 500 filas.',
            inputSchema: z.object({ sql: z.string().min(8) }),
            execute: async ({ sql }) => {
              if (!ctx.isOwnerOrAdmin) return deny('consulta_sql', 'El Modo Pro es solo para dueño/admin.')
              const supabase = createAdminClient()
              const { data, error } = await supabase.rpc('run_assistant_sql', { p_org_id: ctx.orgId, p_sql: sql })
              void auditAssistant(ctx, { kind: 'sql', toolName: 'consulta_sql', allowed: true, detail: { sql } })
              if (error) return { error: 'sql_error', message: error.message }
              return { resultado: data }
            },
          }),
        }
      : {}),
  }
}
