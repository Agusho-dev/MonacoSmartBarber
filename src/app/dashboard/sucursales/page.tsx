import { createClient } from '@/lib/supabase/server'
import { SucursalesClient } from './sucursales-client'

export default async function SucursalesPage() {
  const supabase = await createClient()

  const { data: branches } = await supabase.from('branches').select('*').order('name')

  return (
    <SucursalesClient branches={branches ?? []} />
  )
}
