import { NextResponse } from 'next/server'
import { embedPendingChunks } from '@/lib/asistente/rag'

// Worker idempotente de embeddings. Disparado por pg_cron (migración 152) cada
// 2 min, o manualmente. No requiere auth (convención de crons nuevos, CLAUDE.md):
// es idempotente y solo embebe chunks pendientes.
export const runtime = 'nodejs'
export const maxDuration = 60

async function run() {
  const res = await embedPendingChunks(150)
  return NextResponse.json({ ok: true, ...res })
}

export async function POST() {
  return run()
}

export async function GET() {
  return run()
}
