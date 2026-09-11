import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { resolveCheckinBackground } from '@/lib/checkin-bg'

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


export default async function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('checkin_bg_color').maybeSingle()
  const raw = data?.checkin_bg_color ?? '#3f3f46'
  const { css, isLight } = resolveCheckinBackground(raw)
  const textClass = isLight ? 'text-zinc-900' : 'text-zinc-100'

  return (
    <div className={`fixed inset-0 h-dvh w-screen overflow-hidden ${textClass}`} style={{ backgroundColor: css }}>
      {children}

      <FullscreenButton />
    </div>
  )
}
