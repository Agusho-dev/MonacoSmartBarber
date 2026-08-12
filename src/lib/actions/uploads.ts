'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { getBarberSession } from './auth'
import { currentUserCan } from './permissions-gate'
import { isValidUUID } from '@/lib/validation'

/**
 * Subidas de imágenes que ANTES se hacían desde el browser.
 *
 * Las dos que vivían en el cliente estaban rotas y las dos fallaban en
 * silencio, que es por qué nadie las reportó hasta que alguien intentó usarlas:
 *
 *   · La foto del barbero (`/dashboard/barberos`) subía con la anon key contra
 *     una policy que exige `auth.role() = 'authenticated'`, y el helper
 *     devolvía `null` ante cualquier error. El diálogo se cerraba como si
 *     hubiera guardado. Último avatar subido: 22/abr/2026.
 *   · La sesión de fotos por QR del panel del barbero resolvía la organización
 *     con `supabase.auth.getUser()`. El panel se autentica por PIN + cookie, NO
 *     por Supabase Auth: `getUser()` devuelve null SIEMPRE y la función cortaba
 *     en su primer `if` sin decir nada. Último upload por QR: 18/abr/2026.
 *
 * Acá las dos corren en el servidor con la service role, se autentican por el
 * camino que de verdad usa cada pantalla (sesión de dashboard o cookie de
 * barbero) y **devuelven el error**. Es la regla del Known Risk #13: si una
 * función de la que depende un dato se puede caer en silencio, se cae en
 * silencio para siempre.
 */

const AVATARS = 'staff-avatars'

/** Lo que el bucket acepta; el resto se rechaza acá y no en un 400 opaco. */
const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

// ─── Foto del barbero ────────────────────────────────────────────────

type AvatarOk = { url: string }
type AvatarError = { error: string }

/**
 * Sube la foto de perfil de un miembro del equipo y la deja guardada.
 *
 * Recibe `FormData` porque un `File` no es serializable como argumento de
 * server action.
 */
export async function uploadStaffAvatar(
  staffId: string,
  formData: FormData
): Promise<AvatarOk | AvatarError> {
  if (!isValidUUID(staffId)) return { error: 'Miembro inválido' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No pudimos identificar tu organización' }

  if (!(await currentUserCan('staff.edit'))) {
    return { error: 'No tenés permiso para editar miembros del equipo' }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'No llegó ninguna imagen' }
  }
  if (file.size > MAX_BYTES) {
    return { error: 'La imagen pesa más de 5 MB. Probá con una más liviana.' }
  }

  // El `type` lo pone el browser desde la extensión del archivo. Un HEIC de
  // iPhone llega como `image/heic` y el bucket lo rechaza con un 400 sin
  // explicación: mejor decirlo con todas las letras.
  const tipo = (file.type || '').toLowerCase()
  if (!MIMES_IMAGEN.includes(tipo)) {
    return {
      error: tipo.includes('heic') || tipo.includes('heif')
        ? 'Ese formato (HEIC de iPhone) no se puede subir. Sacá la foto en JPG o exportala desde Fotos como JPG.'
        : 'El archivo tiene que ser una imagen JPG, PNG, WEBP o GIF.',
    }
  }

  const supabase = createAdminClient()

  // El miembro tiene que ser de la org de quien está subiendo: sin esto, el id
  // viaja desde el browser y cualquiera podría pisarle la foto a otra org.
  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!staff) return { error: 'Ese miembro no pertenece a tu organización' }

  const extension = tipo.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const path = `${staffId}/avatar.${extension}`

  const { error: upErr } = await supabase.storage
    .from(AVATARS)
    .upload(path, await file.arrayBuffer(), {
      contentType: tipo,
      cacheControl: '31536000',
      upsert: true,
    })

  if (upErr) {
    console.error('[uploadStaffAvatar] storage:', upErr.message)
    return { error: 'No pudimos subir la imagen: ' + upErr.message }
  }

  const { data: publica } = supabase.storage.from(AVATARS).getPublicUrl(path)
  // El sufijo rompe el caché del browser: el path es siempre el mismo
  // (`<id>/avatar.jpg`), así que sin esto la foto vieja quedaba pegada.
  const url = `${publica.publicUrl}?v=${Date.now()}`

  const { error: dbErr } = await supabase
    .from('staff')
    .update({ avatar_url: url })
    .eq('id', staffId)
    .eq('organization_id', orgId)

  if (dbErr) {
    console.error('[uploadStaffAvatar] update staff:', dbErr.message)
    return { error: 'La imagen se subió pero no pudimos guardarla en el perfil' }
  }

  revalidatePath('/dashboard/barberos')
  revalidatePath('/dashboard/fila')
  return { url }
}

// ─── Sesión de fotos por QR (panel del barbero) ──────────────────────

type SesionOk = { id: string; token: string }
type SesionError = { error: string }

/**
 * Abre una sesión para que el barbero mande fotos desde su celular.
 *
 * La organización sale de la **cookie de la sesión de barbero**, que es cómo se
 * autentica ese panel. Antes salía de `supabase.auth.getUser()`, que en el
 * panel del barbero es null por diseño.
 */
export async function createQrPhotoSession(): Promise<SesionOk | SesionError> {
  const session = await getBarberSession()
  if (!session) return { error: 'Tu sesión venció. Volvé a entrar con tu PIN.' }

  const supabase = createAdminClient()
  const token = crypto.randomUUID()

  const { data, error } = await supabase
    .from('qr_photo_sessions')
    .insert({ token, organization_id: session.organization_id })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[createQrPhotoSession]', error?.message)
    return { error: 'No pudimos generar el código QR. Probá de nuevo.' }
  }

  return { id: data.id, token }
}

/** Cierra la sesión: el link del QR deja de aceptar fotos. */
export async function deactivateQrPhotoSession(sessionId: string): Promise<void> {
  if (!isValidUUID(sessionId)) return

  const session = await getBarberSession()
  if (!session) return

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('qr_photo_sessions')
    .update({ is_active: false })
    .eq('id', sessionId)
    .eq('organization_id', session.organization_id)

  if (error) console.error('[deactivateQrPhotoSession]', error.message)
}

/**
 * Fotos ya subidas en una sesión.
 *
 * El panel las escucha por Realtime, pero el Realtime del panel del barbero
 * corre con la anon key y `qr_photo_uploads` sólo le da SELECT a `anon` — o
 * sea que puede llegar a perderse un evento. Esto le da una forma de
 * reconciliar sin depender del canal.
 */
export async function getQrPhotoUploads(sessionId: string): Promise<string[]> {
  if (!isValidUUID(sessionId)) return []

  const session = await getBarberSession()
  if (!session) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qr_photo_uploads')
    .select('storage_path, qr_photo_sessions!inner(organization_id)')
    .eq('session_id', sessionId)
    .eq('qr_photo_sessions.organization_id', session.organization_id)
    .order('created_at')

  if (error) {
    console.error('[getQrPhotoUploads]', error.message)
    return []
  }

  return (data ?? []).map(r => r.storage_path as string)
}
