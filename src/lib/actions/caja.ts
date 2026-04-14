'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from './org'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CajaTicketService {
  name: string
  price: number
}

export interface CajaTicketProduct {
  name: string
  quantity: number
  unitPrice: number
}

export interface CajaTicket {
  visitId: string
  completedAt: string
  clientId: string
  clientName: string
  clientPhone: string
  barberName: string
  barberId: string
  paymentMethod: 'cash' | 'card' | 'transfer'
  paymentAccountId: string | null
  paymentAccountName: string | null
  amount: number
  services: CajaTicketService[]
  products: CajaTicketProduct[]
}

export interface CajaAccountTotal {
  accountId: string
  accountName: string
  total: number
}

export interface CajaDailySummary {
  totalCash: number
  totalCard: number
  totalTransfer: number
  accounts: CajaAccountTotal[]
  totalRevenue: number
  ticketCount: number
  cashExpenses: number
}

export interface CajaCSVRow {
  fecha: string
  hora: string
  cliente: string
  telefono: string
  barbero: string
  barberoId: string
  monto: number
  metodoPago: string
  cuenta: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayBounds(dateStr: string): { start: string; end: string } {
  return {
    start: `${dateStr}T00:00:00-03:00`,
    end: `${dateStr}T23:59:59.999-03:00`,
  }
}

function paymentLabel(method: string): string {
  switch (method) {
    case 'cash': return 'Efectivo'
    case 'card': return 'Tarjeta'
    case 'transfer': return 'Transferencia'
    default: return method
  }
}

// ─── fetchCajaTickets ─────────────────────────────────────────────────────────

export async function fetchCajaTickets(params: {
  branchId: string | null
  date: string // YYYY-MM-DD
  barberId?: string | null
  paymentMethod?: string | null
  paymentAccountId?: string | null
}): Promise<{ data: CajaTicket[]; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const branchIds = params.branchId ? [params.branchId] : await getOrgBranchIds()
  if (branchIds.length === 0) return { data: [], error: null }

  const supabase = createAdminClient()
  const { start, end } = dayBounds(params.date)

  // Query visits del día
  let query = supabase
    .from('visits')
    .select(`
      id, completed_at, amount, payment_method, payment_account_id,
      barber_id, client_id, service_id, extra_services,
      client:clients!inner(id, name, phone),
      barber:staff!inner(full_name),
      service:services(name, price),
      payment_account:payment_accounts(name)
    `)
    .in('branch_id', branchIds)
    .gte('completed_at', start)
    .lte('completed_at', end)
    .order('completed_at', { ascending: false })

  if (params.barberId) query = query.eq('barber_id', params.barberId)
  if (params.paymentMethod) query = query.eq('payment_method', params.paymentMethod)
  if (params.paymentAccountId) {
    if (params.paymentAccountId === 'cash') {
      query = query.eq('payment_method', 'cash')
    } else {
      query = query.eq('payment_account_id', params.paymentAccountId)
    }
  }

  const { data: visits, error } = await query
  if (error) return { data: [], error: error.message }
  if (!visits || visits.length === 0) return { data: [], error: null }

  // Recopilar extra_services IDs para resolver nombres
  const allExtraIds = new Set<string>()
  for (const v of visits) {
    if (v.extra_services) {
      for (const sid of v.extra_services as string[]) allExtraIds.add(sid)
    }
  }

  let extraServicesMap = new Map<string, { name: string; price: number }>()
  if (allExtraIds.size > 0) {
    const { data: extraServices } = await supabase
      .from('services')
      .select('id, name, price')
      .in('id', Array.from(allExtraIds))
    if (extraServices) {
      extraServicesMap = new Map(extraServices.map(s => [s.id, { name: s.name, price: s.price }]))
    }
  }

  // Obtener product_sales de todas las visitas
  const visitIds = visits.map(v => v.id)
  const { data: productSales } = await supabase
    .from('product_sales')
    .select('visit_id, quantity, unit_price, product:products(name)')
    .in('visit_id', visitIds)

  const productsByVisit = new Map<string, CajaTicketProduct[]>()
  if (productSales) {
    for (const ps of productSales) {
      if (!ps.visit_id) continue
      const list = productsByVisit.get(ps.visit_id) ?? []
      list.push({
        name: (ps.product as unknown as { name: string } | null)?.name ?? 'Producto',
        quantity: ps.quantity,
        unitPrice: ps.unit_price,
      })
      productsByVisit.set(ps.visit_id, list)
    }
  }

  // Construir tickets
  const tickets: CajaTicket[] = visits.map(v => {
    const services: CajaTicketService[] = []

    // Servicio principal
    if (v.service) {
      const svc = v.service as unknown as { name: string; price: number }
      services.push({ name: svc.name, price: svc.price })
    }

    // Servicios extra
    if (v.extra_services) {
      for (const sid of v.extra_services as string[]) {
        const extra = extraServicesMap.get(sid)
        if (extra) services.push({ name: extra.name, price: extra.price })
      }
    }

    const client = v.client as unknown as { id: string; name: string; phone: string }
    const barber = v.barber as unknown as { full_name: string }
    const account = v.payment_account as unknown as { name: string } | null

    return {
      visitId: v.id,
      completedAt: v.completed_at,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      barberName: barber.full_name,
      barberId: v.barber_id,
      paymentMethod: v.payment_method as 'cash' | 'card' | 'transfer',
      paymentAccountId: v.payment_account_id ?? null,
      paymentAccountName: account?.name ?? null,
      amount: v.amount,
      services,
      products: productsByVisit.get(v.id) ?? [],
    }
  })

  return { data: tickets, error: null }
}

// ─── fetchCajaSummary ─────────────────────────────────────────────────────────

export async function fetchCajaSummary(params: {
  branchId: string | null
  date: string // YYYY-MM-DD
}): Promise<{ data: CajaDailySummary; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: emptySummary(), error: 'No autorizado' }

  const branchIds = params.branchId ? [params.branchId] : await getOrgBranchIds()
  if (branchIds.length === 0) return { data: emptySummary(), error: null }

  const supabase = createAdminClient()
  const { start, end } = dayBounds(params.date)

  const [
    { data: visits },
    { data: transferLogs },
    { data: cashExpenses },
    { data: accounts },
  ] = await Promise.all([
    supabase
      .from('visits')
      .select('amount, payment_method')
      .in('branch_id', branchIds)
      .gte('completed_at', start)
      .lte('completed_at', end),
    supabase
      .from('transfer_logs')
      .select('amount, payment_account_id, payment_account:payment_accounts(name)')
      .in('branch_id', branchIds)
      .gte('transferred_at', start)
      .lte('transferred_at', end),
    supabase
      .from('expense_tickets')
      .select('amount')
      .in('branch_id', branchIds)
      .is('payment_account_id', null)
      .gte('expense_date', params.date)
      .lte('expense_date', params.date),
    supabase
      .from('payment_accounts')
      .select('id, name')
      .in('branch_id', branchIds)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  let totalCash = 0
  let totalCard = 0
  let totalTransfer = 0
  let ticketCount = 0

  for (const v of visits ?? []) {
    ticketCount++
    const amt = Number(v.amount)
    switch (v.payment_method) {
      case 'cash': totalCash += amt; break
      case 'card': totalCard += amt; break
      case 'transfer': totalTransfer += amt; break
    }
  }

  const cashExp = (cashExpenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  // Agrupar transferencias por cuenta
  const accountTotals = new Map<string, { name: string; total: number }>()
  for (const acc of accounts ?? []) {
    accountTotals.set(acc.id, { name: acc.name, total: 0 })
  }
  for (const t of transferLogs ?? []) {
    const existing = accountTotals.get(t.payment_account_id)
    if (existing) {
      existing.total += Number(t.amount)
    } else {
      const accName = (t.payment_account as unknown as { name: string } | null)?.name ?? 'Cuenta eliminada'
      accountTotals.set(t.payment_account_id, { name: accName, total: Number(t.amount) })
    }
  }

  return {
    data: {
      totalCash,
      totalCard,
      totalTransfer,
      accounts: Array.from(accountTotals.entries()).map(([id, v]) => ({
        accountId: id,
        accountName: v.name,
        total: v.total,
      })),
      totalRevenue: totalCash + totalCard + totalTransfer,
      ticketCount,
      cashExpenses: cashExp,
    },
    error: null,
  }
}

function emptySummary(): CajaDailySummary {
  return {
    totalCash: 0,
    totalCard: 0,
    totalTransfer: 0,
    accounts: [],
    totalRevenue: 0,
    ticketCount: 0,
    cashExpenses: 0,
  }
}

// ─── fetchCajaCSVData ─────────────────────────────────────────────────────────

export async function fetchCajaCSVData(params: {
  branchId: string | null
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
  barberIds: string[]
  paymentMethod?: 'cash' | 'card' | 'transfer' | null
  paymentAccountId?: string | null
}): Promise<{ data: CajaCSVRow[]; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const branchIds = params.branchId ? [params.branchId] : await getOrgBranchIds()
  if (branchIds.length === 0) return { data: [], error: null }

  const supabase = createAdminClient()
  const { start } = dayBounds(params.startDate)
  const { end } = dayBounds(params.endDate)

  let query = supabase
    .from('visits')
    .select(`
      id, completed_at, amount, payment_method, payment_account_id,
      barber_id,
      client:clients!inner(name, phone),
      barber:staff!inner(full_name),
      payment_account:payment_accounts(name)
    `)
    .in('branch_id', branchIds)
    .gte('completed_at', start)
    .lte('completed_at', end)
    .order('completed_at', { ascending: true })

  if (params.barberIds.length > 0) {
    query = query.in('barber_id', params.barberIds)
  }
  if (params.paymentMethod) {
    query = query.eq('payment_method', params.paymentMethod)
  }
  if (params.paymentAccountId) {
    query = query.eq('payment_account_id', params.paymentAccountId)
  }

  const { data: visits, error } = await query
  if (error) return { data: [], error: error.message }

  const rows: CajaCSVRow[] = (visits ?? []).map(v => {
    const dt = new Date(v.completed_at)
    const client = v.client as unknown as { name: string; phone: string }
    const barber = v.barber as unknown as { full_name: string }
    const account = v.payment_account as unknown as { name: string } | null

    return {
      fecha: dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      hora: dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      cliente: client.name,
      telefono: client.phone,
      barbero: barber.full_name,
      barberoId: v.barber_id,
      monto: v.amount,
      metodoPago: paymentLabel(v.payment_method),
      cuenta: account?.name ?? (v.payment_method === 'cash' ? 'Efectivo' : '-'),
    }
  })

  return { data: rows, error: null }
}
