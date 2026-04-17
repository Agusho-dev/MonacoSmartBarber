import { Badge } from '@/components/ui/badge'
import type { PartnerBenefitStatus } from '@/lib/types/database'

const MAP: Record<PartnerBenefitStatus, { label: string; classes: string }> = {
  draft:    { label: 'Borrador',  classes: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100 hover:bg-slate-100' },
  pending:  { label: 'Pendiente', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 hover:bg-amber-100' },
  approved: { label: 'Aprobado',  classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 hover:bg-emerald-100' },
  rejected: { label: 'Rechazado', classes: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 hover:bg-red-100' },
  paused:   { label: 'Pausado',   classes: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200 hover:bg-sky-100' },
  archived: { label: 'Archivado', classes: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200' },
}

export function StatusBadge({ status }: { status: PartnerBenefitStatus }) {
  const { label, classes } = MAP[status] ?? MAP.draft
  return (
    <Badge className={`border-none shadow-sm ${classes}`}>
      {label}
    </Badge>
  )
}
