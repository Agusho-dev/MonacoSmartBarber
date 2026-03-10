import { createClient } from '@/lib/supabase/server'
import { CuentasClient } from './cuentas-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cuentas de cobro | Monaco Smart Barber',
}

export default async function CuentasPage() {
  const supabase = await createClient()
  const [{ data: accounts }, { data: branches }] = await Promise.all([
    supabase.from('payment_accounts').select('*, branch:branches(name)').order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
  ])
  return <CuentasClient accounts={accounts ?? []} branches={branches ?? []} />
}
