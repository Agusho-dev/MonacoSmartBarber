import { NextRequest, NextResponse } from 'next/server'
import { processExpiredDelays } from '@/lib/workflow-engine'

// Ejecutado por Vercel Cron cada 1 minuto para avanzar workflows
// que están esperando en un nodo delay cuyo tiempo ya expiró.
export async function GET(req: NextRequest) {
  // Verificar authorization (Vercel Cron envía este header)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processExpiredDelays()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[Cron] Error procesando delays:', err)
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}
