import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, branch_id, client_id, barber_id, service_id')
      .eq('status', 'confirmed')
      .eq('appointment_date', new Date().toISOString().split('T')[0])
      .is('queue_entry_id', null)
      .lte('start_time', new Date().toLocaleTimeString('en-GB', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }))

    if (!appointments?.length) {
      return NextResponse.json({ processed: 0 })
    }

    let processed = 0
    for (const appt of appointments) {
      const { data: position } = await supabase.rpc('next_queue_position', {
        p_branch_id: appt.branch_id,
      })

      const { data: queueEntry, error: queueError } = await supabase
        .from('queue_entries')
        .insert({
          branch_id: appt.branch_id,
          client_id: appt.client_id,
          barber_id: appt.barber_id,
          service_id: appt.service_id,
          position: position ?? 1,
          status: 'waiting',
          is_dynamic: false,
          is_appointment: true,
          appointment_id: appt.id,
          priority_order: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (queueError || !queueEntry) {
        console.error(`[Cron] Error creando queue entry para turno ${appt.id}:`, queueError)
        continue
      }

      await supabase
        .from('appointments')
        .update({ status: 'checked_in', queue_entry_id: queueEntry.id })
        .eq('id', appt.id)

      processed++
    }

    return NextResponse.json({ processed })
  } catch (err) {
    console.error('[Cron] Error procesando turnos:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
