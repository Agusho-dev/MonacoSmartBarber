'use server'

import { getCachedAuthUser } from '@/lib/auth-cache'
import { createAdminClient } from '@/lib/supabase/server'
import { alcanceDeMensajeria, leerProgramados, type ProgramadoFila } from '@/lib/mensajeria/programados'
import { currentUserCan } from './permissions-gate'

/**
 * Vuelve a leer los mensajes programados de Mensajería (después de programar
 * uno, o al abrir Programados): los mismos que trae la página, con el mismo
 * alcance (la organización de la sesión, sus sucursales permitidas y sus
 * canales; src/lib/mensajeria/programados.ts).
 *
 * Y el mismo control de acceso: la página la abre un usuario del dashboard (el
 * layout exige la sesión de Supabase). La cookie del panel del barbero, que
 * también resuelve una organización, acá no alcanza. Además pide el permiso de
 * Mensajería (clients.view, el de su pestaña en src/lib/navegacion/grupos.ts):
 * es un endpoint, y sin el permiso un rol que no ve Mensajería leía nombre,
 * teléfono, texto y error de los programados de la org. La forma de la
 * respuesta no cambió (Known Risk #38): sin permiso, la lista vacía y el error.
 */
export async function obtenerProgramados(): Promise<{ data: ProgramadoFila[]; error: string | null }> {
  const usuario = await getCachedAuthUser()
  if (!usuario) return { data: [], error: 'No autorizado' }
  if (!(await currentUserCan('clients.view'))) {
    return { data: [], error: 'No tenés permiso para ver los mensajes programados' }
  }

  const supabase = createAdminClient()
  const alcance = await alcanceDeMensajeria(supabase)
  if (!alcance.orgId) return { data: [], error: 'No autorizado' }

  return leerProgramados(supabase, alcance.channelIds)
}
