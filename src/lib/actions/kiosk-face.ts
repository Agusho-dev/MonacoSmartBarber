'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'

/**
 * ¿El cliente ya tiene al menos un rostro enrolado?
 *
 * Vive en el SERVIDOR a propósito. `client_face_descriptors` no tiene grants
 * para `anon` (verificado en prod: `relacl = {postgres, service_role}` y su
 * única policy es de `service_role`), así que la misma consulta hecha desde la
 * tablet con la anon key responde 42501 "permission denied". El kiosko la hacía
 * desde el browser y trataba el error como "ya tiene cara": el ofrecimiento de
 * registrar el rostro —justo lo que hace que la próxima visita sea instantánea—
 * no se mostraba NUNCA. Si alguien vuelve a mover esta lectura al cliente, el
 * bug se re-introduce en silencio.
 *
 * Ante cualquier fallo devuelve `false`, o sea "no tiene" → se OFRECE el
 * enrolamiento. Preguntar de más molesta un toque; no preguntar nunca deja la
 * funcionalidad muerta. Enrolar dos veces al mismo cliente es inocuo: los
 * descriptores se acumulan y mejoran el match.
 *
 * @param branchId Sucursal del kiosko. Si viene, acota la respuesta a la
 *   organización de esa sucursal (el kiosko es público: no queremos que sirva
 *   para sondear clientes de otras orgs).
 */
export async function clientHasFaceEnrolled(
  clientId: string,
  branchId?: string
): Promise<boolean> {
  if (!isValidUUID(clientId)) return false

  const supabase = createAdminClient()

  let orgId: string | null = null
  if (branchId && isValidUUID(branchId)) {
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('organization_id')
      .eq('id', branchId)
      .maybeSingle()

    if (branchError) {
      console.error('[clientHasFaceEnrolled] branch:', branchError.message)
      return false
    }
    orgId = branch?.organization_id ?? null
    if (!orgId) return false
  }

  let query = supabase
    .from('client_face_descriptors')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)

  if (orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query

  if (error) {
    console.error('[clientHasFaceEnrolled]', error.message)
    return false
  }

  return !!data?.length
}
