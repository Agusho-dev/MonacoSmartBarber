import { NextRequest, NextResponse } from 'next/server'
import { processExpiredDelays } from '@/lib/workflow-engine'

// Ejecutado por pg_cron (Supabase) cada 1 minuto vía pg_net para avanzar
// workflows que están esperando en un nodo delay cuyo tiempo ya expiró.
// Vercel Hobby no soporta frecuencia sub-diaria en vercel.json, por eso
// el scheduling vive en Supabase.
async function handleCron(req: NextRequest) {
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

export const POST = handleCron
export const GET = handleCron
