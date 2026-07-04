import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getBarberSession } from '@/lib/actions/auth'
import { getCurrentOrgId } from '@/lib/actions/org'

export interface ReceiptContext {
  organizationId: string
  staffId: string | null
}

/**
 * Resuelve org + staff del que está cobrando, sirviendo para las DOS superficies:
 *   1) panel barbero (cookie `barber_session`)
 *   2) dashboard admin (Supabase Auth → getCurrentOrgId)
 * Así la lógica de comprobantes funciona tanto cobrando desde /barbero como desde
 * /dashboard/fila.
 */
export async function resolveReceiptContext(): Promise<ReceiptContext | null> {
  // 1) Panel barbero (PIN)
  const bs = await getBarberSession()
  if (bs) return { organizationId: bs.organization_id, staffId: bs.staff_id }

  // 2) Dashboard (Supabase Auth)
  const orgId = await getCurrentOrgId()
  if (!orgId) return null
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let staffId: string | null = null
  if (user) {
    const { data: s } = await authClient.from('staff').select('id').eq('auth_user_id', user.id).single()
    staffId = s?.id ?? null
  }
  return { organizationId: orgId, staffId }
}
