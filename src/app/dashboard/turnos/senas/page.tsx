import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { createAdminClient } from '@/lib/supabase/server'
import { estadoProveedores, listarSenas } from '@/lib/actions/senas'
import { diasDeArrepentimientoPorSucursal, resumenSenas, senasSinTurno } from './actions'
import { SenasClient } from './senas-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Señas | Monaco Smart Barber',
}

export default async function SenasPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  // El guard va acá y no sólo en el nav: entrar por URL directa a una pantalla
  // que muestra plata de clientes no puede depender de que el ítem del menú
  // esté escondido.
  if (!(await currentUserCan('senas.view'))) redirect('/dashboard')

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()

  const [{ data: branchRows }, listado, resumen, sinTurno, proveedores, puedeDevolver, arrepentimiento] = await Promise.all([
    branchIds.length
      ? supabase
          .from('branches')
          .select('id, name')
          .eq('organization_id', orgId)
          .in('id', branchIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    listarSenas({ porPagina: 50 }),
    resumenSenas({}),
    senasSinTurno(),
    estadoProveedores(),
    currentUserCan('senas.refund'),
    diasDeArrepentimientoPorSucursal(),
  ])

  return (
    <SenasClient
      sucursales={((branchRows ?? []) as Array<{ id: string; name: string }>).map(b => ({
        id: b.id,
        nombre: b.name,
      }))}
      listadoInicial={listado}
      resumenInicial={resumen}
      sinTurnoInicial={sinTurno}
      hayCuentaConectada={proveedores.proveedores.some(p => p.status === 'conectado')}
      puedeDevolver={puedeDevolver}
      arrepentimientoPorSucursal={arrepentimiento}
    />
  )
}
