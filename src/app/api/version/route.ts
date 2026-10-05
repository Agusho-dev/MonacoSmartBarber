import { NextResponse } from 'next/server'
import { VERSION_APP } from '@/lib/version-app'

/**
 * GET /api/version → `{ version }`: qué deployment está sirviendo AHORA.
 *
 * Lo consultan el panel del barbero, el kiosko y la TV
 * (`src/components/recarga-por-version.tsx`) para darse cuenta de que corren un
 * bundle viejo y recargar cuando la pantalla está ociosa.
 *
 * Por qué un route handler y no una server action: con Skew Protection, Vercel
 * fija las server actions y la navegación del cliente al deployment que generó
 * el bundle (header `x-deployment-id`), así que una action le preguntaría al
 * deployment VIEJO y contestaría siempre "estás al día". Un fetch plano a esta
 * ruta no lleva ese header y llega al deployment de producción actual; lo
 * mismo la recarga (`location.reload()`), que trae el HTML nuevo.
 *
 * NO prender `experimental.useSkewCookie` en next.config: con la cookie
 * `__vdpl` Vercel fija TODOS los pedidos (también éste y la recarga) al
 * deployment viejo, y ninguna pantalla se enteraría nunca de un deploy.
 *
 * Público y sin consultas a la base (Known Risks #9/#10): lo piden decenas de
 * pantallas cada ~5 minutos. `no-store` para que ni el CDN ni el navegador
 * respondan con una versión vieja.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { version: VERSION_APP },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
