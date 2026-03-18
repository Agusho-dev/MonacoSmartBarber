import { createClient } from '@supabase/supabase-js'

async function checkInTest() {
    const now = new Date()
    const argTimeOptions = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }

    // Get time string "HH:MM:SS"
    const currentTimeStr = now.toLocaleTimeString('en-US', argTimeOptions)

    // Get day of week (0-6, where 0 is Sunday, which matches PostgreSQL EXTRACT(DOW))
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'short'
    }).formatToParts(now)
    const argDayStr = parts.find(p => p.type === 'weekday')?.value || ''
    const dowMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }
    const dow = dowMap[argDayStr] ?? now.getDay()

    console.log({ currentTimeStr, argDayStr, dow })

    const [h1, m1, s1] = currentTimeStr.split(':').map(Number)
    const currentMins = h1 * 60 + m1

    console.log({ h1, m1, s1, currentMins })
}

checkInTest()
