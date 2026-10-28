import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { leerBarberSession } from '@/lib/barber-cookie'
import { isValidUUID } from '@/lib/validation'
import type { EstadoSesionPanel } from '@/lib/vigia-sesion-panel'

/**
 * GET /api/barbero/sesion?staff=<uuid> → `{ estado }`: ¿la sesión con la que se
 * dibujó el panel del barbero sigue viva? Lo pregunta el vigía del panel
 * (src/lib/vigia-sesion-panel.ts) para no dejar una tablet que muestra la fila
 * pero no puede tomar ni cobrar a nadie.
 *
 * Mira lo mismo que `getCurrentOrgId()` en las server actions —cookie firmada y
 * barbero activo—, y nada más: el fichaje no, porque las actions tampoco lo
 * piden (el que ficha la salida para almorzar vuelve y sigue con su panel).
 * `vencida` es exactamente el caso en que esas actions dicen que no.
 *
 * Route handler y no server action, por lo mismo que /api/version: con Skew
 * Protection las actions de un bundle viejo terminan fallando, y el vigía tiene
 * que seguir andando en una tablet que lleva días sin recargar.
 *
 * Sólo devuelve un estado. Sin cookie válida no consulta la base; con ella, una
 * lectura por id. `no-store`: la respuesta es de esta cookie y de este momento.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const esperado = req.nextUrl.searchParams.get('staff')
  return NextResponse.json(
    { estado: await estadoDeLaSesion(isValidUUID(esperado) ? esperado : null) },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}

async function estadoDeLaSesion(esperado: string | null): Promise<EstadoSesionPanel> {
  const valor = (await cookies()).get('barber_session')?.value
  const sesion = valor ? leerBarberSession(valor) : null
  if (!sesion || !isValidUUID(sesion.staff_id)) return 'vencida'
  if (esperado && sesion.staff_id.toLowerCase() !== esperado.toLowerCase()) return 'otra'

  try {
    const { data, error } = await createAdminClient()
      .from('staff')
      .select('id')
      .eq('id', sesion.staff_id)
      .eq('is_active', true)
      .maybeSingle()
    // Base caída no es sesión vencida (Known Risk #11): el panel no hace nada.
    if (error) {
      console.error('[api/barbero/sesion] leer staff:', error.message)
      return 'desconocido'
    }
    return data ? 'vigente' : 'vencida'
  } catch (err) {
    console.error('[api/barbero/sesion] leer staff:', err instanceof Error ? err.message : String(err))
    return 'desconocido'
  }
}
