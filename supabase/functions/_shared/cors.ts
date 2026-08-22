/**
 * CORS + helpers de respuesta JSON para las Edge Functions.
 *
 * La app Flutter no necesita CORS (no corre en un browser), pero el dashboard
 * y cualquier prueba desde `curl`/Postman/web sí: se responde siempre con los
 * headers y se contesta el preflight `OPTIONS` con 204.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/**
 * Si el request es un preflight `OPTIONS`, devuelve la respuesta vacía con los
 * headers CORS. Si no, devuelve `null` y el caller sigue con su lógica.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders })
}

/**
 * Respuesta JSON con CORS y `Content-Type: application/json` siempre puestos.
 * Todas las respuestas de las funciones salen por acá, incluso los errores:
 * la app parsea el cuerpo como JSON sin mirar el status.
 */
export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}
