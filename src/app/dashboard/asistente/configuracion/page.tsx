import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DbDownError } from '@/components/dashboard/db-down-error'
import { hasFeature } from '@/lib/actions/entitlements'
import { getKnowledgeStats } from '@/lib/actions/asistente'
import { obtenerConfigTex } from '@/lib/actions/tex'
import { obtenerContextoTex, puedeConfigurarTex } from '@/lib/tex/contexto'
import type { TexContexto } from '@/lib/tex/herramientas/tipos'
import { AsistenteConfigClient } from './asistente-config-client'
import { TexBloqueado } from '../components/tex-bloqueado'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Configurar Tex | BarberOS' }

export default async function ConfigurarTexPage() {
  // Gate en la página Y en cada action: el menú sólo esconde ítems.
  let ctx: TexContexto | null
  try {
    ctx = await obtenerContextoTex()
  } catch (e) {
    console.error('[tex] contexto:', e instanceof Error ? e.message : e)
    return <DbDownError context="Configurar Tex" />
  }
  if (!ctx) redirect('/login')
  if (!puedeConfigurarTex(ctx)) redirect('/dashboard/asistente')
  if (!(await hasFeature('ai.enabled'))) return <TexBloqueado />

  const [resultado, conocimiento] = await Promise.all([
    obtenerConfigTex().catch(() => ({ ok: false as const, error: 'Probá de nuevo en un momento.' })),
    // null o con `error` = no se pudo leer: la pantalla lo dice (no es lo mismo que "vacía").
    getKnowledgeStats().catch((e: unknown) => {
      console.error('[tex] estado de la base de conocimiento:', e instanceof Error ? e.message : e)
      return null
    }),
  ])

  return <AsistenteConfigClient resultado={resultado} conocimientoInicial={conocimiento} />
}
