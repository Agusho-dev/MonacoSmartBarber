'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, getOrgBranchIds, validateBranchAccess } from './org'
import { getLocalDateStr } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import type { FixedExpense, FixedExpensePeriod } from '@/lib/types/database'

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

interface CopyablePair {
    label: string | null
    value: string | null
}

function normalizeCopyable(raw?: CopyablePair | null): { label: string | null; value: string | null } {
    if (!raw) return { label: null, value: null }
    const label = raw.label?.trim() || null
    const value = raw.value?.trim() || null
    if (!label || !value) return { label: null, value: null }
    return { label, value }
}

function validateUrl(url: string | null | undefined): string | null {
    if (!url) return null
    const trimmed = url.trim()
    if (!trimmed) return null
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
    try {
        new URL(trimmed)
        return trimmed
    } catch {
        return null
    }
}

async function resolveCurrentStaffId(): Promise<string | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data: staffRow } = await admin
        .from('staff')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return staffRow?.id ?? null
}

// ───────────────────────────────────────────────────────────────────────
// CATÁLOGO
// ───────────────────────────────────────────────────────────────────────

export async function getFixedExpensesCatalog(branchId?: string | null): Promise<FixedExpense[]> {
    const orgId = await getCurrentOrgId()
    if (!orgId) return []

    const admin = createAdminClient()
    let q = admin
        .from('fixed_expenses')
        .select('*, branch:branches(id, name)')
        .order('name')

    if (branchId) {
        q = q.eq('branch_id', branchId)
    } else {
        const branchIds = await getOrgBranchIds()
        // Incluye (a) gastos de cualquier branch de la org O (b) gastos org-wide (branch_id null, organization_id = org)
        q = q.or(
            `branch_id.in.(${branchIds.join(',') || 'null'}),and(branch_id.is.null,organization_id.eq.${orgId})`
        )
    }

    const { data, error } = await q
    if (error) {
        console.error('[fixed-expenses] getFixedExpensesCatalog:', error)
        return []
    }
    return (data ?? []) as FixedExpense[]
}

export interface FixedExpenseInput {
    id?: string
    name: string
    description?: string | null
    category?: string | null
    branch_id?: string | null       // null = gasto a nivel organización
    amount?: number                  // monto de referencia (opcional, default 0)
    due_day?: number | null
    payment_url?: string | null
    copyable_1?: CopyablePair | null
    copyable_2?: CopyablePair | null
    is_active?: boolean
}

export async function upsertFixedExpense(input: FixedExpenseInput) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    // Validación básica
    const name = input.name?.trim()
    if (!name) return { error: 'El nombre es obligatorio' }
    if (name.length > 120) return { error: 'El nombre es demasiado largo (máx. 120)' }

    if (input.due_day != null) {
        if (!Number.isInteger(input.due_day) || input.due_day < 1 || input.due_day > 31) {
            return { error: 'El día de vencimiento debe estar entre 1 y 31' }
        }
    }

    if (input.branch_id) {
        const validOrg = await validateBranchAccess(input.branch_id)
        if (!validOrg) return { error: 'No tienes acceso a esa sucursal' }
    }

    const copy1 = normalizeCopyable(input.copyable_1)
    const copy2 = normalizeCopyable(input.copyable_2)
    const paymentUrl = validateUrl(input.payment_url ?? null)

    const admin = createAdminClient()

    const row = {
        name,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        branch_id: input.branch_id ?? null,
        organization_id: orgId,
        amount: input.amount != null ? Number(input.amount) : 0,
        due_day: input.due_day ?? null,
        payment_url: paymentUrl,
        copyable_1_label: copy1.label,
        copyable_1_value: copy1.value,
        copyable_2_label: copy2.label,
        copyable_2_value: copy2.value,
        is_active: input.is_active ?? true,
    }

    if (input.id) {
        // Verificar que pertenece a la org
        const { data: existing } = await admin
            .from('fixed_expenses')
            .select('id, organization_id')
            .eq('id', input.id)
            .maybeSingle()
        if (!existing || existing.organization_id !== orgId) {
            return { error: 'Gasto fijo no encontrado' }
        }
        const { error } = await admin
            .from('fixed_expenses')
            .update(row)
            .eq('id', input.id)
        if (error) return { error: error.message }
    } else {
        const { error } = await admin.from('fixed_expenses').insert(row)
        if (error) return { error: error.message }
    }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

export async function deleteFixedExpense(id: string) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    const admin = createAdminClient()
    const { data: existing } = await admin
        .from('fixed_expenses')
        .select('id, organization_id')
        .eq('id', id)
        .maybeSingle()
    if (!existing || existing.organization_id !== orgId) {
        return { error: 'Gasto fijo no encontrado' }
    }

    const { error } = await admin.from('fixed_expenses').delete().eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

export async function toggleFixedExpenseActive(id: string, isActive: boolean) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    const admin = createAdminClient()
    const { data: existing } = await admin
        .from('fixed_expenses')
        .select('id, organization_id')
        .eq('id', id)
        .maybeSingle()
    if (!existing || existing.organization_id !== orgId) {
        return { error: 'Gasto fijo no encontrado' }
    }

    const { error } = await admin
        .from('fixed_expenses')
        .update({ is_active: isActive })
        .eq('id', id)
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

// ───────────────────────────────────────────────────────────────────────
// PERÍODOS (pagos del mes)
// ───────────────────────────────────────────────────────────────────────

export interface PeriodFilter {
    year: number
    month: number
    branchId?: string | null
    status?: 'pending' | 'paid' | 'cancelled' | 'all'
    category?: string | null
}

export async function getFixedExpensePeriods(params: PeriodFilter): Promise<FixedExpensePeriod[]> {
    const orgId = await getCurrentOrgId()
    if (!orgId) return []

    const admin = createAdminClient()
    let q = admin
        .from('fixed_expense_periods')
        .select('*, branch:branches(id, name), paid_by_staff:paid_by(id, full_name), payment_account:payment_accounts(id, name)')
        .eq('organization_id', orgId)
        .eq('period_year', params.year)
        .eq('period_month', params.month)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('snapshot_name', { ascending: true })

    if (params.branchId) {
        q = q.eq('branch_id', params.branchId)
    }
    if (params.status && params.status !== 'all') {
        q = q.eq('status', params.status)
    }
    if (params.category) {
        q = q.eq('snapshot_category', params.category)
    }

    const { data, error } = await q
    if (error) {
        console.error('[fixed-expenses] getFixedExpensePeriods:', error)
        return []
    }
    return (data ?? []) as FixedExpensePeriod[]
}

export interface PeriodSummary {
    totalPending: number           // monto estimado pendiente (usa amount del catálogo si existe)
    totalPaid: number              // suma real pagado
    totalOverdue: number           // monto estimado de pendientes vencidos
    countPending: number
    countPaid: number
    countOverdue: number
    countCancelled: number
    countTotal: number
}

export async function getFixedExpensePeriodsSummary(
    year: number,
    month: number,
    branchId?: string | null
): Promise<PeriodSummary> {
    const orgId = await getCurrentOrgId()
    const empty: PeriodSummary = {
        totalPending: 0,
        totalPaid: 0,
        totalOverdue: 0,
        countPending: 0,
        countPaid: 0,
        countOverdue: 0,
        countCancelled: 0,
        countTotal: 0,
    }
    if (!orgId) return empty

    const admin = createAdminClient()

    let q = admin
        .from('fixed_expense_periods')
        .select('id, status, paid_amount, due_date, fixed_expense_id')
        .eq('organization_id', orgId)
        .eq('period_year', year)
        .eq('period_month', month)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data: periods } = await q

    if (!periods) return empty

    // Para pendientes: monto estimado = amount del catálogo actual (si existe > 0)
    const fixedExpenseIds = [...new Set(periods.map(p => p.fixed_expense_id))]
    const budgetByExpense = new Map<string, number>()
    if (fixedExpenseIds.length > 0) {
        const { data: catalog } = await admin
            .from('fixed_expenses')
            .select('id, amount')
            .in('id', fixedExpenseIds)
        for (const c of catalog ?? []) {
            budgetByExpense.set(c.id, Number(c.amount) || 0)
        }
    }

    const todayStr = getLocalDateStr(await getActiveTimezone())

    const summary = { ...empty }
    summary.countTotal = periods.length

    for (const p of periods) {
        const budget = budgetByExpense.get(p.fixed_expense_id) ?? 0
        const paid = Number(p.paid_amount ?? 0)
        if (p.status === 'paid') {
            summary.countPaid += 1
            summary.totalPaid += paid
        } else if (p.status === 'cancelled') {
            summary.countCancelled += 1
        } else {
            // pending
            summary.countPending += 1
            summary.totalPending += budget
            if (p.due_date && p.due_date < todayStr) {
                summary.countOverdue += 1
                summary.totalOverdue += budget
            }
        }
    }

    return summary
}

export interface MarkAsPaidInput {
    paid_amount: number
    paid_at?: string                      // YYYY-MM-DD; default hoy local
    payment_account_id?: string | null
    payment_notes?: string | null
    create_expense_ticket?: boolean       // default true
}

export async function markPeriodAsPaid(periodId: string, input: MarkAsPaidInput) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    if (!Number.isFinite(input.paid_amount) || input.paid_amount <= 0) {
        return { error: 'El monto pagado debe ser mayor a 0' }
    }

    const admin = createAdminClient()

    // Traer el período
    const { data: period } = await admin
        .from('fixed_expense_periods')
        .select('id, organization_id, branch_id, snapshot_name, snapshot_category, status, expense_ticket_id, fixed_expense_id')
        .eq('id', periodId)
        .maybeSingle()
    if (!period || period.organization_id !== orgId) {
        return { error: 'Período no encontrado' }
    }

    const tz = await getActiveTimezone()
    const paidAt = input.paid_at || getLocalDateStr(tz)
    const staffId = await resolveCurrentStaffId()

    let expenseTicketId: string | null = period.expense_ticket_id
    const shouldCreateTicket = input.create_expense_ticket !== false

    // Crear (o actualizar) el expense_ticket si corresponde
    if (shouldCreateTicket) {
        // Para el ticket necesitamos una branch. Si el gasto es org-wide,
        // tomamos la primera branch activa de la org (fallback). El ticket
        // se muestra en Egresos con source='fixed_expense_period' para no
        // duplicar en variableExpenses.
        let ticketBranchId: string | null = period.branch_id
        if (!ticketBranchId) {
            const { data: firstBranch } = await admin
                .from('branches')
                .select('id')
                .eq('organization_id', orgId)
                .eq('is_active', true)
                .order('name')
                .limit(1)
                .maybeSingle()
            ticketBranchId = firstBranch?.id ?? null
        }

        if (!ticketBranchId) {
            return { error: 'No hay ninguna sucursal activa para registrar el egreso' }
        }

        if (expenseTicketId) {
            // update
            await admin
                .from('expense_tickets')
                .update({
                    amount: input.paid_amount,
                    category: period.snapshot_category || 'Gasto fijo',
                    description: `Pago: ${period.snapshot_name}`,
                    expense_date: paidAt,
                    payment_account_id: input.payment_account_id ?? null,
                    created_by: staffId,
                })
                .eq('id', expenseTicketId)
        } else {
            const { data: inserted, error: ticketErr } = await admin
                .from('expense_tickets')
                .insert({
                    branch_id: ticketBranchId,
                    amount: input.paid_amount,
                    category: period.snapshot_category || 'Gasto fijo',
                    description: `Pago: ${period.snapshot_name}`,
                    expense_date: paidAt,
                    payment_account_id: input.payment_account_id ?? null,
                    created_by: staffId,
                    source: 'fixed_expense_period',
                })
                .select('id')
                .single()
            if (ticketErr) return { error: ticketErr.message }
            expenseTicketId = inserted?.id ?? null
        }
    }

    const { error } = await admin
        .from('fixed_expense_periods')
        .update({
            status: 'paid',
            paid_amount: input.paid_amount,
            paid_at: paidAt,
            paid_by: staffId,
            payment_account_id: input.payment_account_id ?? null,
            payment_notes: input.payment_notes?.trim() || null,
            expense_ticket_id: expenseTicketId,
        })
        .eq('id', periodId)
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

export async function revertPeriodPayment(periodId: string) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    const admin = createAdminClient()
    const { data: period } = await admin
        .from('fixed_expense_periods')
        .select('id, organization_id, expense_ticket_id')
        .eq('id', periodId)
        .maybeSingle()
    if (!period || period.organization_id !== orgId) {
        return { error: 'Período no encontrado' }
    }

    if (period.expense_ticket_id) {
        await admin.from('expense_tickets').delete().eq('id', period.expense_ticket_id)
    }

    const { error } = await admin
        .from('fixed_expense_periods')
        .update({
            status: 'pending',
            paid_amount: null,
            paid_at: null,
            paid_by: null,
            payment_account_id: null,
            payment_notes: null,
            expense_ticket_id: null,
        })
        .eq('id', periodId)
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

export async function cancelPeriod(periodId: string, reason?: string | null) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    const admin = createAdminClient()
    const { data: period } = await admin
        .from('fixed_expense_periods')
        .select('id, organization_id, expense_ticket_id')
        .eq('id', periodId)
        .maybeSingle()
    if (!period || period.organization_id !== orgId) {
        return { error: 'Período no encontrado' }
    }

    if (period.expense_ticket_id) {
        await admin.from('expense_tickets').delete().eq('id', period.expense_ticket_id)
    }

    const { error } = await admin
        .from('fixed_expense_periods')
        .update({
            status: 'cancelled',
            paid_amount: null,
            paid_at: null,
            paid_by: null,
            payment_account_id: null,
            payment_notes: reason?.trim() || null,
            expense_ticket_id: null,
        })
        .eq('id', periodId)
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

// ───────────────────────────────────────────────────────────────────────
// GENERACIÓN manual (fallback para cron / mes en curso)
// ───────────────────────────────────────────────────────────────────────

export async function generatePeriodsForCurrentOrg(year: number, month: number) {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado' }

    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        return { error: 'Año inválido' }
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return { error: 'Mes inválido' }
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('generate_fixed_expense_periods', {
        p_org_id: orgId,
        p_year: year,
        p_month: month,
    })
    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return {
        success: true,
        created: (data as { created?: number } | null)?.created ?? 0,
    }
}

// ───────────────────────────────────────────────────────────────────────
// Reporte financiero: real pagado por mes (para Finanzas → Resumen)
// ───────────────────────────────────────────────────────────────────────

export interface FixedPaidByMonth {
    month: string      // "YYYY-MM"
    paid: number
    count: number
}

export async function getFixedExpensesPaidByMonth(
    monthsBack: number,
    branchId?: string | null
): Promise<FixedPaidByMonth[]> {
    const orgId = await getCurrentOrgId()
    if (!orgId) return []

    const admin = createAdminClient()

    // Calcula el rango de meses (inclusive últimos N)
    const now = new Date()
    const startY = now.getUTCFullYear()
    const startM = now.getUTCMonth()
    const targets: string[] = []
    for (let i = monthsBack - 1; i >= 0; i--) {
        let y = startY
        let m = startM - i
        while (m < 0) { m += 12; y -= 1 }
        targets.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    }

    let q = admin
        .from('fixed_expense_periods')
        .select('period_year, period_month, paid_amount, status, branch_id')
        .eq('organization_id', orgId)
        .eq('status', 'paid')
    if (branchId) q = q.eq('branch_id', branchId)
    const { data } = await q

    const byMonth = new Map<string, { paid: number; count: number }>()
    for (const t of targets) byMonth.set(t, { paid: 0, count: 0 })

    for (const p of data ?? []) {
        const key = `${p.period_year}-${String(p.period_month).padStart(2, '0')}`
        const cur = byMonth.get(key)
        if (!cur) continue
        cur.paid += Number(p.paid_amount ?? 0)
        cur.count += 1
    }

    return [...byMonth.entries()].map(([month, v]) => ({ month, paid: v.paid, count: v.count }))
}
