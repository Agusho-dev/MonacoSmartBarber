export function getLocalNow(timeZone = 'America/Argentina/Buenos_Aires'): Date {
  const now = new Date();
  // Using Intl format parts to get the local components
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23' // 0-23
  }).formatToParts(now);

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // Create a new Date treating the local components as UTC, just for naive manipulation
  return new Date(Date.UTC(
    parseInt(p.year),
    parseInt(p.month) - 1,
    parseInt(p.day),
    parseInt(p.hour),
    parseInt(p.minute),
    parseInt(p.second)
  ));
}

/**
 * Returns YYYY-MM-DD from the local timezone.
 */
export function getLocalDateStr(timeZone = 'America/Argentina/Buenos_Aires'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/**
 * Returns ISO strings for the start and end of the local day.
 * It forces the -03:00 timezone for accurate Supabase timestamptz comparisons.
 */
export function getLocalDayBounds(timeZone = 'America/Argentina/Buenos_Aires'): { start: string, end: string } {
  const localDateStr = getLocalDateStr(timeZone);
  return {
    start: `${localDateStr}T00:00:00-03:00`,
    end: `${localDateStr}T23:59:59.999-03:00`
  };
}

export function getMonthBoundsStr(monthsBack: number, timeZone = 'America/Argentina/Buenos_Aires', referenceDate?: Date): { start: string, end: string } {
    const localNow = referenceDate ?? getLocalNow(timeZone);
    const y = localNow.getUTCFullYear();
    const m = localNow.getUTCMonth(); // 0-11
    
    const startDate = new Date(Date.UTC(y, m - monthsBack + 1, 1));
    const endDate = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    
    // Format YYYY-MM-DD
    const sYear = startDate.getUTCFullYear();
    const sMonth = String(startDate.getUTCMonth() + 1).padStart(2, '0');
    const sDay = String(startDate.getUTCDate()).padStart(2, '0');
    
    const eYear = endDate.getUTCFullYear();
    const eMonth = String(endDate.getUTCMonth() + 1).padStart(2, '0');
    const eDay = String(endDate.getUTCDate()).padStart(2, '0');
    
    return {
        start: `${sYear}-${sMonth}-${sDay}T00:00:00-03:00`,
        end: `${eYear}-${eMonth}-${eDay}T23:59:59.999-03:00`
    };
}
