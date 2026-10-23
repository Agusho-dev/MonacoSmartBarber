'use server'

import { getCachedAuthUser } from '@/lib/auth-cache'
import { createAdminClient } from '@/lib/supabase/server'
import { alcanceDeMensajeria, leerProgramados, type ProgramadoFila } from '@/lib/mensajeria/programados'

/**
 * Vuelve a leer los mensajes programados de Mensajería (después de programar
 * uno, o al abrir Programados): los mismos que trae la página, con el mismo
 * alcance (la organización de la sesión, sus sucursales permitidas y sus
 * canales; src/lib/mensajeria/programados.ts).
 *
 * Y el mismo control de acceso: la página la abre un usuario del dashboard (el
 * layout exige la sesión de Supabase). La cookie del panel del barbero, que
 * también resuelve una organización, acá no alcanza.
 */
export async function obtenerProgramados(): Promise<{ data: ProgramadoFila[]; error: string | null }> {
  const usuario = await getCachedAuthUser()
  if (!usuario) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const alcance = await alcanceDeMensajeria(supabase)
  if (!alcance.orgId) return { data: [], error: 'No autorizado' }

  return leerProgramados(supabase, alcance.channelIds)
}
