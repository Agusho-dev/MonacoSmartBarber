import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { RecargaPorVersion } from '@/components/recarga-por-version'
import { resolveCheckinBackground } from '@/lib/checkin-bg'
import { isValidUUID } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * Título NEUTRO, sin marca, a propósito.
 *
 * El kiosko es una tablet que vive en el local del cliente y corre a pantalla
 * completa, así que el título casi nunca se ve. Pero "casi nunca" no es nunca:
 * se ve antes de entrar en fullscreen, en el selector de pestañas cuando el
 * dueño configura el equipo, y sobre todo en el nombre del acceso directo si la
 * tablet se instala como PWA o se agrega a la pantalla de inicio.
 *
 * Heredaba "Monaco Barber Studio". En el local de Monaco es correcto y en el de
 * cualquier otro cliente es la marca de un competidor sobre su propia tablet.
 * Ponerle "BarberOS" tampoco: al kiosko lo mira el cliente final, que no le
 * compró nada a BarberOS y no tiene por qué leer el nombre del proveedor.
 *
 * Queda "Check-in", que describe la pantalla, sirve igual en cualquier
 * organización y distingue esta pestaña de la del TV cuando las dos están
 * abiertas en el mismo equipo.
 */
export const metadata: Metadata = {
  title: 'Check-in',
}


const FONDO_POR_DEFECTO = '#3f3f46'

/**
 * Color de fondo del kiosko de la organización de ESTA tablet.
 *
 * Antes se leía `app_settings` sin filtrar por organización y con
 * `.maybeSingle()`: la policy `settings_anon_read` (USING true) deja ver las
 * filas de todas las orgs, así que la consulta fallaba siempre ("más de una
 * fila") y el layout caía al gris por defecto, sin importar lo que el dueño
 * hubiera configurado.
 *
 * Un layout no recibe `searchParams`, así que no puede saber la sucursal: la
 * org sale de las mismas cookies con las que el kiosko arma su lista de
 * sucursales (`getPublicBranches`), `public_organization` primero y
 * `active_organization` después. Una tablet que se abre por primera vez con
 * `?branch=` y sin cookie queda en el gris hasta la próxima navegación; el
 * kiosko igual pinta encima su propio fondo, que sí conoce la sucursal.
 *
 * Service role a propósito, como `getOrgCheckinBg` de la página: de la fila se
 * usa sólo el color, y así no depende de la policy `settings_anon_read`.
 */
async function colorDelKiosko(): Promise<string> {
  const cookieStore = await cookies()
  const orgId =
    cookieStore.get('public_organization')?.value ?? cookieStore.get('active_organization')?.value
  if (!orgId || !isValidUUID(orgId)) return FONDO_POR_DEFECTO

  const { data, error } = await createAdminClient()
    .from('app_settings')
    .select('checkin_bg_color')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) {
    console.error('[tablet/layout] app_settings', { orgId, error: error.message })
    return FONDO_POR_DEFECTO
  }

  const color = data?.checkin_bg_color
  return typeof color === 'string' && color.trim() ? color.trim() : FONDO_POR_DEFECTO
}

export default async function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const raw = await colorDelKiosko()
  const { css, isLight } = resolveCheckinBackground(raw)
  const textClass = isLight ? 'text-zinc-900' : 'text-zinc-100'

  return (
    <div className={`fixed inset-0 h-dvh w-screen overflow-hidden ${textClass}`} style={{ backgroundColor: css }}>
      {children}

      <FullscreenButton />
      {/* Después de un deploy, recarga el kiosko cuando vuelve a su pantalla
          inicial y nadie lo usa (html[data-kiosko-en-reposo="true"]). */}
      <RecargaPorVersion superficie="kiosko" />
    </div>
  )
}
