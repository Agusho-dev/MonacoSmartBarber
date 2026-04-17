'use server'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'

type OrgScopedTable =
  | 'visits' | 'branches' | 'staff' | 'clients' | 'services' | 'products'
  | 'reward_catalog' | 'appointments' | 'queue_entries' | 'conversations'
  | 'social_channels' | 'scheduled_messages' | 'automation_workflows'
  | 'payment_accounts' | 'salary_reports' | 'salary_payment_batches'
  | 'expense_tickets' | 'transfer_logs' | 'incentive_rules'
  | 'disciplinary_rules' | 'break_configs' | 'staff_schedules'
  | 'broadcasts' | 'quick_replies' | 'roles' | 'conversation_tags'

/**
 * Verifica que una entidad pertenece a la org del caller.
 * Cacheado por request con React cache() para evitar queries duplicadas.
 */
export const requireOrgAccessToEntity = cache(async function (
  table: OrgScopedTable,
  entityId: string,
): Promise<{ ok: true; orgId: string } | { ok: false; reason: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, reason: 'no_session' }
  if (!entityId || typeof entityId !== 'string') return { ok: false, reason: 'invalid_id' }

  const supabase = createAdminClient()

  // Tablas con organization_id directo
  const directOrgTables = new Set([
    'branches', 'staff', 'clients', 'reward_catalog', 'appointments', 'queue_entries',
    'automation_workflows', 'broadcasts', 'quick_replies', 'roles', 'conversation_tags',
    'visits',
  ])

  if (directOrgTables.has(table)) {
    const { data } = await supabase
      .from(table)
      .select('organization_id')
      .eq('id', entityId)
      .maybeSingle()
    if (!data) return { ok: false, reason: 'not_found' }
    if ((data as { organization_id: string }).organization_id !== orgId) return { ok: false, reason: 'cross_org' }
    return { ok: true, orgId }
  }

  // Tablas via branch_id → branches.organization_id
  if (
    table === 'services' || table === 'products' || table === 'payment_accounts' ||
    table === 'salary_reports' || table === 'salary_payment_batches' ||
    table === 'expense_tickets' || table === 'transfer_logs' ||
    table === 'incentive_rules' || table === 'disciplinary_rules' ||
    table === 'break_configs' || table === 'social_channels'
  ) {
    const { data } = await supabase
      .from(table)
      .select('branch_id, branches!inner(organization_id)')
      .eq('id', entityId)
      .maybeSingle()
    if (!data) return { ok: false, reason: 'not_found' }
    const branchOrg = (data as unknown as { branches: { organization_id: string } }).branches?.organization_id
    if (branchOrg !== orgId) return { ok: false, reason: 'cross_org' }
    return { ok: true, orgId }
  }

  // staff_schedules via staff.organization_id
  if (table === 'staff_schedules') {
    const { data } = await supabase
      .from('staff_schedules')
      .select('staff_id, staff!inner(organization_id)')
      .eq('id', entityId)
      .maybeSingle()
    if (!data) return { ok: false, reason: 'not_found' }
    const staffOrg = (data as unknown as { staff: { organization_id: string } }).staff?.organization_id
    if (staffOrg !== orgId) return { ok: false, reason: 'cross_org' }
    return { ok: true, orgId }
  }

  // conversations / scheduled_messages via social_channels → branches → organization_id
  if (table === 'conversations' || table === 'scheduled_messages') {
    const { data } = await supabase
      .from(table)
      .select('channel_id, social_channels!inner(branch_id, branches!inner(organization_id))')
      .eq('id', entityId)
      .maybeSingle()
    if (!data) return { ok: false, reason: 'not_found' }
    const convOrg = (data as unknown as {
      social_channels: { branches: { organization_id: string } }
    }).social_channels?.branches?.organization_id
    if (convOrg !== orgId) return { ok: false, reason: 'cross_org' }
    return { ok: true, orgId }
  }

  return { ok: false, reason: 'unsupported_table' }
})

// NOTA: `isValidUUID` se movió a `@/lib/validation` porque Next.js 16
// exige que todos los exports de un archivo 'use server' sean async functions.
