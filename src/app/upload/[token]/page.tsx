import type { Metadata, Viewport } from 'next'
import { estadoParaCelular } from '@/lib/fotos-corte/servidor'
import { SubidaCelular } from './subida-celular'

/**
 * /upload/[token] — el celular del barbero sube las fotos del corte (QR del cobro).
 *
 * El estado inicial se resuelve en el servidor: la página abre con el nombre de
 * la barbería y del cliente, sin un spinner de por medio. Nada de esta página
 * toca tablas con la anon key (antes validaba el token, subía y registraba con
 * anon, y escuchaba un Realtime que nunca llegaba): todo pasa por server actions
 * con service role y los bytes van directo a Storage con una URL firmada.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fotos del corte',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inicial = await estadoParaCelular(token)
  return <SubidaCelular token={token} inicial={inicial} />
}
