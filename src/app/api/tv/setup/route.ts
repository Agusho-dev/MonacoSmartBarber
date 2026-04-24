import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Route handler público usado por /tv para auto-configurarse con ?slug=<slug>.
// Setea la cookie `public_organization` y redirige a /tv. Si el slug no existe
// o la org está suspendida/cancelada, vuelve a / con ?error=...
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim().toLowerCase()
  if (!slug) {
    return NextResponse.redirect(new URL('/', request.url), 303)
  }

  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, is_active, subscription_status')
    .eq('slug', slug)
    .maybeSingle()

  if (!org || !org.is_active) {
    return NextResponse.redirect(new URL('/?error=org_not_found', request.url), 303)
  }
  if (org.subscription_status === 'suspended' || org.subscription_status === 'cancelled') {
    return NextResponse.redirect(new URL('/?error=org_unavailable', request.url), 303)
  }

  const cookieStore = await cookies()
  // public_organization es exclusiva para rutas públicas (kiosk/TV/review).
  // No tocamos active_organization para no pisar la sesión del dashboard si
  // el mismo navegador tiene una cuenta admin logueada.
  cookieStore.set('public_organization', org.id, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })

  return NextResponse.redirect(new URL('/tv', request.url), 303)
}
