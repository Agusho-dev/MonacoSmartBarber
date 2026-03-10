'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getExpenseTickets(branchId: string, startDate?: string, endDate?: string) {
    const supabase = await createClient()

    let query = supabase
        .from('expense_tickets')
        .select('*, created_by_staff:created_by(full_name)')
        .eq('branch_id', branchId)
        .order('expense_date', { ascending: false })

    if (startDate) {
        query = query.gte('expense_date', startDate)
    }
    if (endDate) {
        query = query.lte('expense_date', endDate)
    }

    const { data, error } = await query
    if (error) return { error: error.message }
    return { expenses: data }
}

export async function createExpenseTicket(data: {
    branch_id: string
    amount: number
    category: string
    description?: string
    receipt_url?: string
    created_by?: string
    expense_date?: string
}) {
    const supabase = await createClient()

    const { error } = await supabase.from('expense_tickets').insert([
        {
            branch_id: data.branch_id,
            amount: data.amount,
            category: data.category,
            description: data.description || null,
            receipt_url: data.receipt_url || null,
            created_by: data.created_by || null,
            expense_date: data.expense_date || new Date().toISOString().split('T')[0],
        },
    ])

    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}

export async function deleteExpenseTicket(id: string) {
    const supabase = await createClient()

    const { error } = await supabase
        .from('expense_tickets')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/dashboard/finanzas')
    return { success: true }
}
