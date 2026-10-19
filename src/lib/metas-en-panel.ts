import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * ¿El panel del barbero muestra la sección Metas en esta sucursal?
 * (`branches.metas_en_panel`, mig 226: el dueño la apagó en Rondeau y Paraná.)
 *
 * Lo leen el layout de /barbero (la barra de abajo) y /barbero/metas. Falla
 * CERRADO: si no se pudo leer, no se muestra. Es una sección que el dueño
 * puede querer oculta y que falte un rato no traba nada; mostrarla por un
 * error, en cambio, es justo lo que pidió que no pase.
 */
export async function metasVisiblesEnSucursal(branchId: string | null | undefined): Promise<boolean> {
  if (!branchId) return false
  try {
    const { data, error } = await createAdminClient()
      .from('branches')
      .select('metas_en_panel')
      .eq('id', branchId)
      .maybeSingle()
    if (error) {
      console.error('[metasVisiblesEnSucursal]', error.message)
      return false
    }
    return data?.metas_en_panel === true
  } catch (e) {
    console.error('[metasVisiblesEnSucursal]', e)
    return false
  }
}
