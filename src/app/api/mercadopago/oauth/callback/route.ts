// =============================================================================
// src/app/api/mercadopago/oauth/callback/route.ts
//
// El regreso del OAuth de Mercado Pago. Es la contraparte de
// `iniciarConexionMercadoPago` (`/dashboard/turnos/configuracion/actions.ts`).
//
// Por qué esta ruta existe y es una sola para toda la plataforma: Mercado Pago
// compara el `redirect_uri` del canje contra el cargado en el panel de la
// aplicación y lo exige IDÉNTICO, así que no puede llevar la sucursal ni en la
// ruta ni en un query param. La sucursal viaja en el `state`, que además es lo
// que impide que alguien nos haga conectar SU cuenta a una sucursal ajena.
//
// Tres candados, y hacen falta los tres:
//   1. El `state` tiene que existir, no estar vencido y no haberse usado. Se
//      quema con un UPDATE CONDICIONAL que es a la vez la lectura y la
//      validación (`.is('used_at', null).select(...)`): la fila que vuelve es
//      la prueba de que este request —y no otro— fue el que lo consumió. Leer
//      primero y actualizar después deja una ventana en la que dos callbacks
//      concurrentes pasan los dos la validación, y como el UPDATE no miraba
//      cuántas filas afectó, el segundo seguía como si nada. Queda quemado
//      ANTES de canjear el code: si el canje falla, el `code` de MP también es
//      de un solo uso, así que reintentar con el mismo par no llevaría a ningún
//      lado. El costo asumido es que un state robado se puede quemar sin
//      autorizar nada — el dueño vuelve a apretar "Conectar" y listo; la
//      alternativa (validar permisos antes de quemar) es la que abre la ventana
//      de concurrencia.
//   2. Quien vuelve tiene que tener sesión en el dashboard, `senas.manage`, y
//      estar en la MISMA organización que pidió la conexión. Sin esto, un state
//      filtrado alcanzaría para conectar una cuenta de cobro cualquiera.
//   3. El `code` se canjea server-side con el client_secret. Nunca viaja nada
//      de eso al browser.
//
// Nunca devuelve un token ni un mensaje crudo de Mercado Pago en la URL: el
// motivo traducido se guarda en `last_error` de la fila y la pantalla lo lee de
// ahí. En el query param sólo va un código corto.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { appMercadoPago, guardarCredenciales, urlAppProduccion } from '@/lib/mercadopago/credenciales'
import { canjearCodigo } from '@/lib/mercadopago/oauth'
import { traducirErrorMp } from '@/lib/mercadopago/errores'
import type { AmbienteMp } from '@/lib/senas/contrato'

export const dynamic = 'force-dynamic'

/** Motivos que se muestran en la pantalla de configuración. Cortos y estables. */
type Motivo =
  | 'sin_codigo'
  | 'state_invalido'
  | 'no_autorizado'
  | 'sin_app'
  | 'canje_fallido'
  | 'guardado_fallido'

function volver(branchId: string | null, extra: Record<string, string>): NextResponse {
  const url = new URL('/dashboard/turnos/configuracion', urlAppProduccion())
  if (branchId) url.searchParams.set('sucursal', branchId)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

function fallo(branchId: string | null, motivo: Motivo): NextResponse {
  return volver(branchId, { mp: 'error', motivo })
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')

  // El dueño puede haber apretado "Cancelar" en la pantalla de Mercado Pago:
  // vuelve sin `code` y sin nada roto que reportar.
  if (!state) return fallo(null, 'state_invalido')
  if (!code) return fallo(null, 'sin_codigo')

  const supabase = createAdminClient()

  // El UPDATE ES la validación: `.is('used_at', null)` sólo matchea si el state
  // sigue sin usar, y la fila devuelta es la que este request acaba de quemar.
  // Sin `.select()` no habría forma de saber si afectó una fila o ninguna, que
  // es exactamente lo que dejaba pasar dos veces el mismo state.
  const { data: fila, error: errState } = await supabase
    .from('payment_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state', state)
    .is('used_at', null)
    .select('organization_id, branch_id, environment, expires_at')
    .maybeSingle<{
      organization_id: string
      branch_id: string
      environment: string
      expires_at: string
    }>()

  if (errState) {
    console.error('[mp-oauth-callback] quemar state:', errState.message)
    return fallo(null, 'state_invalido')
  }
  // Ninguna fila: el state no existe o ya se había usado. Son el mismo error
  // para quien vuelve —no hay nada que distinguirle— y el mismo para nosotros.
  if (!fila) return fallo(null, 'state_invalido')

  // El vencimiento se chequea DESPUÉS de quemarlo: un state vencido tampoco
  // sirve para nada, así que dejarlo vivo sólo sería un cabo suelto.
  if (new Date(fila.expires_at).getTime() < Date.now()) {
    return fallo(fila.branch_id, 'state_invalido')
  }

  // Quién está volviendo. La sesión del dashboard viaja en la misma cookie que
  // el redirect del browser, así que acá se puede verificar de verdad.
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const orgActual = await getCurrentOrgId()
  if (!user || orgActual !== fila.organization_id || !(await currentUserCan('senas.manage'))) {
    return fallo(fila.branch_id, 'no_autorizado')
  }

  const app = appMercadoPago()
  if (!app) return fallo(fila.branch_id, 'sin_app')

  // El state ya quedó quemado arriba, en el mismo UPDATE que lo validó.
  let tokens
  try {
    tokens = await canjearCodigo({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      code,
      redirectUri: app.redirectUri,
    })
  } catch (e) {
    const t = traducirErrorMp(e)
    // El motivo real se guarda donde la pantalla lo puede leer, no en la URL.
    const { error } = await supabase
      .from('branch_payment_providers')
      .update({ status: 'error', last_error: `${t.titulo}: ${t.detalle}`.slice(0, 500), last_check_at: new Date().toISOString() })
      .eq('branch_id', fila.branch_id)
      .eq('provider', 'mercadopago')
      .eq('environment', fila.environment)
    if (error) console.error('[mp-oauth-callback] registrar error de canje:', error.message)
    console.error('[mp-oauth-callback] canje:', t.titulo, t.detalle)
    return fallo(fila.branch_id, 'canje_fallido')
  }

  const guardado = await guardarCredenciales({
    modo: 'oauth',
    organizationId: fila.organization_id,
    branchId: fila.branch_id,
    ambiente: (fila.environment === 'prueba' ? 'prueba' : 'produccion') as AmbienteMp,
    tokens,
    // En OAuth el secreto de firma del webhook es UNO por aplicación (el que
    // figura en "Tus integraciones" → Webhooks), no por cuenta conectada: lo
    // comparten todas las sucursales. Sin él, `verificarFirmaWebhook` falla
    // cerrada y ningún pago se acredita — es deliberado.
    webhookSecret: (process.env.MERCADOPAGO_OAUTH_WEBHOOK_SECRET ?? '').trim() || null,
    connectedBy: user.id,
  })

  if (!guardado.ok) {
    console.error('[mp-oauth-callback] guardar credenciales:', guardado.error)
    return fallo(fila.branch_id, 'guardado_fallido')
  }

  return volver(fila.branch_id, { mp: 'ok' })
}
