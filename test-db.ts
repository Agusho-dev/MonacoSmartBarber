import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function testFetchAndInsert() {
    // 1. Fetch any active staff member to test
    const { data: staffList } = await supabase.from('staff').select('id, branch_id').eq('is_active', true).limit(1)
    if (!staffList || staffList.length === 0) {
        console.log("No staff found")
        return
    }
    const staffId = staffList[0].id
    const branchId = staffList[0].branch_id

    // 2. See if this staff has a schedule for today
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short'}).formatToParts(now)
    const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
    const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
    const dow = dowMap[argDayStr] ?? now.getDay()
    
    console.log("Testing with staff", staffId, "dow", dow)

    const { data: schedule, error: schedErr } = await supabase
        .from('staff_schedules')
        .select('start_time')
        .eq('staff_id', staffId)
        .eq('day_of_week', dow)
        .eq('is_active', true)
        .order('block_index', { ascending: true })
        .limit(1)
        .maybeSingle()

    console.log("Schedule fetch result:", schedule, "Error:", schedErr)

    // 3. Test insert disciplinary event directly
    console.log("Testing call to createDisciplinaryEvent equivalent...")
    const startOfMonth = now.toISOString().slice(0, 7) + '-01'
    const eventType = 'late'
    const { data: countData, error: rpcErr } = await supabase.rpc('get_occurrence_count', {
        p_staff_id: staffId,
        p_event_type: eventType,
        p_from_date: startOfMonth,
    })
    console.log("RPC result:", countData, "Error:", rpcErr)
    const occurrenceNumber = (countData ?? 0) + 1

    const { data: rule, error: ruleErr } = await supabase
        .from('disciplinary_rules')
        .select('consequence, deduction_amount')
        .eq('branch_id', branchId)
        .eq('event_type', eventType)
        .eq('occurrence_number', occurrenceNumber)
        .single()
    
    console.log("Rule fetch:", rule, "Error:", ruleErr)

    // Try dummy insert (with rollback or just delete it after) 
    // We won't insert to avoid polluting DB, but we will check errors.
}

testFetchAndInsert()
