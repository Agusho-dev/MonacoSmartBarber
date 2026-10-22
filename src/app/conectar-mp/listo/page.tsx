import type { Metadata, Viewport } from 'next'
import type { TexPoseNombre } from '@/components/tex/assets'
import { AvisoTitular } from '../marco-titular'

// /conectar-mp/listo?r=ok|vencido|cancelado|fallo — adonde vuelve el titular
// después de autorizar (o no) en Mercado Pago. El callback no pone en la URL
// nada más que el resultado (ni tokens, ni nombres, ni el mensaje crudo de MP),
// así que esta página no sabe a quién saluda: dice cómo terminó y nada más.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Autorización de tu cuenta',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const RESULTADOS: Record<string, { pose: TexPoseNombre; titulo: string; texto: string }> = {
  ok: { pose: 'logro', titulo: 'Listo. Ya quedó conectada.', texto: 'Podés cerrar esta página.' },
  conectada: { pose: 'ayuda', titulo: 'Esta cuenta ya quedó conectada.', texto: 'No tenés que hacer nada más. Podés cerrar esta página.' },
  vencido: { pose: 'ayuda', titulo: 'Este link venció.', texto: 'Pedile uno nuevo a quien te lo mandó.' },
  cancelado: {
    pose: 'ayuda',
    titulo: 'Cancelaste en Mercado Pago.',
    texto: 'Si fue sin querer, probá de nuevo: abrí otra vez el link que te mandaron.',
  },
  fallo: {
    pose: 'ayuda',
    titulo: 'Mercado Pago tardó en confirmarnos.',
    texto: 'Probá de nuevo: abrí otra vez el link que te mandaron.',
  },
}

export default async function ConectarMpListoPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const r = typeof sp.r === 'string' ? sp.r : ''
  const resultado = RESULTADOS[r] ?? {
    pose: 'ayuda' as const,
    titulo: 'No pudimos confirmar la conexión.',
    texto: 'Abrí otra vez el link que te mandaron. Si sigue sin andar, avisale a quien te lo mandó.',
  }
  return <AvisoTitular pose={resultado.pose} titulo={resultado.titulo} texto={resultado.texto} />
}
