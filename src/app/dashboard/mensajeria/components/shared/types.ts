import type { Conversation, Message, SocialChannel, Client, OrgWhatsAppConfig, OrgInstagramConfig, ConversationTag } from '@/lib/types/database'

export interface ConversationWithRelations extends Conversation {
  channel?: SocialChannel & { branch_id?: string }
  client?: Client
  tags?: Array<{ tag_id: string; tag: ConversationTag }>
}

export interface ScheduledWithRelations {
  id: string
  client_id: string
  content: string | null
  scheduled_for: string
  status: string
  client?: { name: string; phone: string }
}

export interface ClientVisit {
  id: string
  amount: number
  started_at: string
  payment_method: string
  service?: { name: string } | null
  barber?: { full_name: string } | null
}

export interface WaTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: any
}

export interface ReviewAutoSettings {
  review_auto_send: boolean
  review_delay_minutes: number
  review_template_name: string | null
}

export interface MensajeriaProps {
  initialConversations: ConversationWithRelations[]
  channels: SocialChannel[]
  scheduledMessages: ScheduledWithRelations[]
  clients: Pick<Client, 'id' | 'name' | 'phone'>[]
  waConfig: OrgWhatsAppConfig | null
  igConfig: OrgInstagramConfig | null
  initialTags: ConversationTag[]
  appSettings: ReviewAutoSettings | null
}

export type SettingsTab = 'whatsapp' | 'instagram' | 'facebook' | 'tags'
export type PlatformFilter = 'all' | 'whatsapp' | 'instagram'
export type CrmSection = 'inbox' | 'broadcasts' | 'automations' | 'quick-replies' | 'settings'
