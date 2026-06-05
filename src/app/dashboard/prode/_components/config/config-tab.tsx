'use client'

import type { TournamentLite } from '../../_lib/types'
import { ScoringForm } from './scoring-form'
import { TournamentForm } from './tournament-form'
import { RemindersSection } from './reminders-section'

export function ConfigTab({
  tournament,
  whatsappActive,
  reminderTemplateStatus,
}: {
  tournament: TournamentLite
  whatsappActive: boolean
  reminderTemplateStatus: string | null
}) {
  return (
    <div className="space-y-6">
      <ScoringForm tournament={tournament} />
      <TournamentForm tournament={tournament} />
      <RemindersSection whatsappActive={whatsappActive} reminderTemplateStatus={reminderTemplateStatus} />
    </div>
  )
}
