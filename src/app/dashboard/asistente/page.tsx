import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DbDownError } from '@/components/dashboard/db-down-error'
import { hasFeature } from '@/lib/actions/entitlements'
import { cargarConversacionTex, listarConversacionesTex, obtenerPulsoTex } from '@/lib/actions/tex'
import { origenClaveTex } from '@/lib/tex/cliente'
import { obtenerContextoTex, puedeConfigurarTex, puedeUsarTex } from '@/lib/tex/contexto'
import type { TexConversacion, TexPulso, TexUIMessage } from '@/lib/tex/contrato'
import type { TexContexto } from '@/lib/tex/herramientas/tipos'
import { esUuid, nuevoUuid } from '@/components/tex/chat/ids'
import { esConversacionNoEncontrada, saludoPorHora, TEX_TZ } from '@/components/tex/chat/logica'
import { AsistenteClient } from './asistente-client'
import { TexBloqueado } from './components/tex-bloqueado'

// La ruta no cambia con el nombre: NAV_FEATURE_MAP, el shell (que acá no pone
// la barra inferior, el deslizar ni el botón flotante), los avisos, el anuncio y
// los revalidatePath dependen de /dashboard/asistente. Tex ya no está en el menú.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Tex | BarberOS' }

/** Hora de pared del negocio (0–23), para el saludo. */
function horaDelNegocio(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TEX_TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
}

function ahoraMs(): number {
  return Date.now()
}

export default async function AsistentePage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  // obtenerContextoTex TIRA si no pudo leer permisos o configuración: con la
  // base caída no se decide nada a medias (Known Risk #11: tampoco se manda al login).
  let ctx: TexContexto | null
  try {
    ctx = await obtenerContextoTex()
  } catch (e) {
    console.error('[tex] contexto:', e instanceof Error ? e.message : e)
    return <DbDownError context="Tex" />
  }
  if (!ctx) redirect('/login')
  if (!puedeUsarTex(ctx)) redirect('/dashboard')
  if (!(await hasFeature('ai.enabled'))) return <TexBloqueado />

  const { c } = await searchParams
  const pedida = typeof c === 'string' && esUuid(c) ? c : null

  const [origen, historial, pulso, cargada] = await Promise.all([
    // Si no se pudo saber, se asume que hay clave: el chat lo dirá al primer
    // envío. Bloquear el composer por un error de lectura sería peor.
    origenClaveTex(ctx.orgId).then(
      (o) => (o === null ? ('sin_clave' as const) : o),
      () => 'desconocido' as const,
    ),
    // Tira si no pudo leer: el riel dice "No pude cargar el historial" y no "Todavía no hay conversaciones".
    listarConversacionesTex().then(
      (lista) => ({ lista, error: false }),
      (e: unknown) => {
        console.error('[tex] historial:', e instanceof Error ? e.message : e)
        return { lista: [] as TexConversacion[], error: true }
      },
    ),
    // Un dato del pulso que no cargó no se muestra (nunca un cero).
    obtenerPulsoTex().catch(() => [] as TexPulso[]),
    pedida
      ? cargarConversacionTex(pedida).catch((e: unknown) => {
          console.error('[tex] abriendo la conversación:', e instanceof Error ? e.message : e)
          return { ok: false as const, error: 'No pudimos abrir la conversación. Probá de nuevo.' }
        })
      : Promise.resolve(null),
  ])

  // Una conversación ajena o inexistente arranca vacía (con un aviso y sin `?c=`).
  // Una que no se pudo LEER también arranca vacía, pero conserva `?c=` y ofrece
  // reintentar: puede estar intacta (un timeout no es "no existe").
  const fallo = pedida !== null && cargada !== null && !cargada.ok ? cargada : null
  const noEncontrada = fallo !== null && esConversacionNoEncontrada(fallo)
  const inicial: { id: string; mensajes: TexUIMessage[] } =
    pedida && cargada?.ok ? { id: pedida, mensajes: cargada.mensajes } : { id: nuevoUuid(), mensajes: [] }

  return (
    <AsistenteClient
      saludo={saludoPorHora(horaDelNegocio(), ctx.nombreUsuario)}
      orgNombre={ctx.orgNombre}
      puedeConfigurar={puedeConfigurarTex(ctx)}
      puedeConciliacion={ctx.esDuenoOAdmin || ctx.permisos['conciliacion.view'] === true}
      hayClave={origen !== 'sin_clave'}
      conversacionesIniciales={historial.lista}
      historialConError={historial.error}
      pulso={pulso}
      inicial={inicial}
      conversacionNoEncontrada={noEncontrada}
      aperturaFallida={pedida !== null && fallo !== null && !noEncontrada ? { id: pedida, mensaje: fallo.error } : null}
      ahora={ahoraMs()}
    />
  )
}
