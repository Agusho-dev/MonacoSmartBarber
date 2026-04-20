export type UserRole = 'owner' | 'admin' | 'receptionist' | 'barber'
export type QueueStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled'
export type PaymentMethod = 'cash' | 'card' | 'transfer'
export type PointTxType = 'earned' | 'redeemed'
export type StaffStatus = 'available'
export type SalaryScheme = 'fixed' | 'commission' | 'hybrid'
export type AttendanceAction = 'clock_in' | 'clock_out'
export type IncentiveMetric = 'haircut_count' | 'content_post' | 'custom'
export type IncentivePeriod = 'weekly' | 'monthly'
export type DisciplinaryEventType = 'absence' | 'late'
export type ConsequenceType = 'none' | 'presentismo_loss' | 'warning' | 'incentive_loss' | 'salary_deduction'
export type ReviewRequestStatus = 'pending' | 'completed' | 'expired'
export type ReviewRatingCategory = 'high' | 'improvement' | 'low'
export type BreakRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed'
export type ServiceAvailability = 'checkin' | 'upsell' | 'both' | 'appointment' | 'all'
export type BookingMode = 'self_service' | 'manual_only' | 'both'
export type AppointmentStatus = 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
export type AppointmentSource = 'public' | 'manual'
export type MessagePlatform = 'whatsapp' | 'facebook' | 'instagram'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageContentType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'template' | 'location' | 'interactive'
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
export type ConversationStatus = 'open' | 'inactive' | 'closed' | 'archived'
export type TemplateCategory = 'marketing' | 'utility' | 'authentication'
export type TemplateStatus = 'pending' | 'approved' | 'rejected'
export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

// Workflow automation types
export type WorkflowTriggerType = 'keyword' | 'template_reply' | 'button_response' | 'post_service' | 'days_after_visit' | 'message_received' | 'conversation_reopened'
export type WorkflowNodeType = 'trigger' | 'send_message' | 'send_media' | 'send_buttons' | 'send_list' | 'send_template' | 'add_tag' | 'remove_tag' | 'condition' | 'wait_reply' | 'crm_alert' | 'delay' | 'ai_response' | 'handoff_human' | 'http_request' | 'loop' | 'ai_auto_tag'
export type WorkflowExecutionStatus = 'active' | 'waiting_reply' | 'completed' | 'cancelled' | 'error'
export type CrmAlertType = 'info' | 'warning' | 'urgent'

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  is_active: boolean
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
  organization?: Organization
}

export interface ConversationTag {
  id: string
  organization_id: string
  name: string
  color: string
  description: string | null
  ai_auto_assign: boolean
  created_at: string
}

export interface ConversationTagAssignment {
  conversation_id: string
  tag_id: string
  tag?: ConversationTag
  created_at: string
}

export interface OrgWhatsAppConfig {
  id: string
  organization_id: string
  whatsapp_access_token: string | null
  whatsapp_phone_id: string | null
  whatsapp_business_id: string | null
  app_secret: string | null
  verify_token: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrgInstagramConfig {
  id: string
  organization_id: string
  instagram_page_id: string | null
  instagram_page_access_token: string | null
  instagram_account_id: string | null
  app_secret: string | null
  verify_token: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Branch {
  id: string
  organization_id: string
  name: string
  address: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  business_hours_open: string
  business_hours_close: string
  business_days: number[]
  timezone: string
  google_review_url?: string | null
  checkin_bg_color: string | null
  created_at: string
  updated_at: string
  /** Presente cuando el query incluye el embed `organizations(name, logo_url)` (p. ej. getPublicBranches). */
  organizations?: Pick<Organization, 'name' | 'logo_url'> | null
}

export interface ReviewRequest {
  id: string
  client_id: string
  branch_id: string
  visit_id: string
  barber_id: string | null
  token: string
  status: ReviewRequestStatus
  created_at: string
  expires_at: string
  branch?: Pick<Branch, 'name' | 'google_review_url'>
}

export interface ClientReview {
  id: string
  review_request_id: string
  client_id: string
  branch_id: string
  rating: number
  category: ReviewRatingCategory
  improvement_categories: string[] | null
  comment: string | null
  redirected_to_google: boolean
  created_at: string
}

export interface Staff {
  id: string
  organization_id: string
  auth_user_id: string | null
  branch_id: string | null
  role: UserRole
  role_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  pin: string | null
  commission_pct: number
  status: StaffStatus
  is_active: boolean
  avatar_url: string | null
  hidden_from_checkin: boolean
  is_also_barber: boolean
  created_at: string
  updated_at: string
  branch?: Branch
  custom_role?: Role
}

export interface Role {
  id: string
  organization_id: string
  name: string
  description: string | null
  permissions: Record<string, boolean>
  is_system: boolean
  created_at: string
  updated_at: string
  role_branch_scope?: RoleBranchScope[]
}

export interface RoleBranchScope {
  id: string
  role_id: string
  branch_id: string
  branch?: Branch
}

export interface Client {
  id: string
  organization_id: string
  phone: string
  name: string
  auth_user_id: string | null
  notes: string | null
  instagram: string | null
  created_at: string
  updated_at: string
  loyalty?: { total_visits: number }[]
  visits?: { count: number }[]
}

export interface ClientFaceDescriptor {
  id: string
  client_id: string
  descriptor: number[]
  quality_score: number
  source: 'checkin' | 'barber'
  created_at: string
}

export interface StaffFaceDescriptor {
  id: string
  staff_id: string
  descriptor: number[]
  quality_score: number
  source: 'checkin' | 'barber'
  created_at: string
}

export interface Service {
  id: string
  branch_id: string | null
  name: string
  price: number
  duration_minutes: number | null
  availability: ServiceAvailability
  booking_mode: BookingMode
  default_commission_pct: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StaffServiceCommission {
  id: string
  staff_id: string
  service_id: string
  commission_pct: number
  created_at: string
  updated_at: string
  staff?: Staff
  service?: Service
}

export interface Product {
  id: string
  branch_id: string | null
  name: string
  cost: number
  sale_price: number
  barber_commission: number
  stock: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductSale {
  id: string
  visit_id: string | null
  product_id: string
  barber_id: string
  branch_id: string
  quantity: number
  unit_price: number
  commission_amount: number
  payment_method: 'cash' | 'transfer' | 'card'
  sold_at: string
  product?: Product
  barber?: Staff
}

export interface QueueEntry {
  id: string
  branch_id: string
  client_id: string | null
  barber_id: string | null
  service_id: string | null
  status: QueueStatus
  position: number
  reward_claimed: boolean
  is_break: boolean
  is_dynamic: boolean
  is_appointment: boolean
  appointment_id: string | null
  break_request_id: string | null
  checked_in_at: string
  priority_order: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  client?: Client
  barber?: Staff
  service?: Service
  break_request?: BreakRequest
}

export interface Visit {
  id: string
  branch_id: string
  client_id: string
  barber_id: string
  service_id: string | null
  extra_services: string[] | null
  queue_entry_id: string | null
  payment_method: PaymentMethod
  payment_account_id: string | null
  amount: number
  commission_pct: number
  commission_amount: number
  notes: string | null
  tags: string[] | null
  started_at: string
  completed_at: string
  created_at: string
  client?: Client
  barber?: Staff
  service?: Service
  branch?: Branch
  payment_account?: PaymentAccount
}

export interface VisitPhoto {
  id: string
  visit_id: string
  storage_path: string
  order_index: number
  created_at: string
}

export interface ServiceTag {
  id: string
  organization_id: string
  name: string
  is_active: boolean
  created_at: string
}

export interface RewardsConfig {
  id: string
  organization_id: string
  branch_id: string | null
  points_per_visit: number
  redemption_threshold: number
  reward_description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClientPoints {
  id: string
  client_id: string
  branch_id: string | null
  points_balance: number
  total_earned: number
  total_redeemed: number
  updated_at: string
}

export interface PointTransaction {
  id: string
  client_id: string
  visit_id: string | null
  points: number
  type: PointTxType
  description: string | null
  created_at: string
}

export interface BranchOccupancy {
  branch_id: string
  branch_name: string
  clients_waiting: number
  clients_in_progress: number
  total_barbers: number
  available_barbers: number
}

export interface AppSettings {
  id: string
  organization_id: string
  lost_client_days: number
  at_risk_client_days: number
  business_hours_open: string
  business_hours_close: string
  business_days: number[]
  shift_end_margin_minutes: number
  next_client_alert_minutes: number
  dynamic_cooldown_seconds: number
  review_auto_send: boolean
  review_delay_minutes: number
  review_message_template: string | null
  wa_api_url: string | null
  checkin_bg_color: string
  updated_at: string
}

export interface PaymentAccount {
  id: string
  branch_id: string
  name: string
  bank_name: string | null
  cbu_cvu: string | null
  alias: string | null
  is_active: boolean
  daily_limit: number | null
  sort_order: number
  accumulated_today: number
  last_reset_date: string
  created_at: string
}

export interface ExpenseTicket {
  id: string
  branch_id: string
  amount: number
  category: string
  description: string | null
  receipt_url: string | null
  created_by: string | null
  payment_account_id: string | null
  expense_date: string
  created_at: string
  created_by_staff?: Staff
  payment_account?: PaymentAccount
}

export interface TransferLog {
  id: string
  visit_id: string | null
  payment_account_id: string
  amount: number
  branch_id: string
  transferred_at: string
  payment_account?: PaymentAccount
  visit?: Visit
}

export interface FixedExpense {
  id: string
  branch_id: string
  name: string
  category: string | null
  amount: number
  is_active: boolean
  due_day: number | null
  created_at: string
  updated_at: string
  branch?: Branch
}

export interface BreakConfig {
  id: string
  branch_id: string
  name: string
  duration_minutes: number
  scheduled_time: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BreakRequest {
  id: string
  staff_id: string
  branch_id: string
  break_config_id: string
  status: BreakRequestStatus
  cuts_before_break: number
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  actual_started_at: string | null
  actual_completed_at: string | null
  overtime_seconds: number | null
  notes: string | null
  created_at: string
  staff?: Staff
  break_config?: BreakConfig
}

export interface PaymentAccount {
  id: string
  branch_id: string
  name: string
  alias_or_cbu: string | null
  is_active: boolean
  daily_limit: number | null
  sort_order: number
  accumulated_today: number
  last_reset_date: string
  created_at: string
  updated_at: string
}

export interface ExpenseTicket {
  id: string
  branch_id: string
  amount: number
  category: string
  description: string | null
  receipt_url: string | null
  created_by: string | null
  payment_account_id: string | null
  expense_date: string
  created_at: string
  created_by_staff?: Staff
  payment_account?: PaymentAccount
}

export interface TransferLog {
  id: string
  visit_id: string | null
  payment_account_id: string
  amount: number
  branch_id: string
  transferred_at: string
  payment_account?: PaymentAccount
  visit?: Visit
}

export interface StaffSchedule {
  id: string
  staff_id: string
  day_of_week: number
  block_index: number
  start_time: string
  end_time: string
  is_active: boolean
  created_at: string
  updated_at: string
  staff?: Staff
}

export interface StaffScheduleException {
  id: string
  staff_id: string
  exception_date: string
  is_absent: boolean
  reason: string | null
  created_at: string
  updated_at: string
}

export interface AttendanceLog {
  id: string
  staff_id: string
  branch_id: string
  action_type: AttendanceAction
  recorded_at: string
  face_verified: boolean
  notes: string | null
  staff?: Staff
}

export interface SalaryConfig {
  id: string
  staff_id: string
  scheme: SalaryScheme
  base_amount: number
  commission_pct: number
  created_at: string
  updated_at: string
  staff?: Staff
}

export interface SalaryPayment {
  id: string
  staff_id: string
  period_start: string
  period_end: string
  calculated_amount: number
  is_paid: boolean
  paid_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  staff?: Staff
}

export interface IncentiveRule {
  id: string
  branch_id: string
  name: string
  description: string | null
  metric: IncentiveMetric
  threshold: number
  reward_amount: number
  period: IncentivePeriod
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface IncentiveAchievement {
  id: string
  staff_id: string
  rule_id: string
  period_label: string
  achieved_at: string
  amount_earned: number
  notes: string | null
  staff?: Staff
  rule?: IncentiveRule
}

export interface DisciplinaryRule {
  id: string
  branch_id: string
  event_type: DisciplinaryEventType
  occurrence_number: number
  consequence: ConsequenceType
  deduction_amount: number | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface DisciplinaryEvent {
  id: string
  staff_id: string
  branch_id: string
  event_type: DisciplinaryEventType
  event_date: string
  occurrence_number: number
  consequence_applied: ConsequenceType | null
  deduction_amount: number | null
  notes: string | null
  created_by: string | null
  source: string
  created_at: string
  staff?: Staff
}

export interface SocialChannel {
  id: string
  branch_id: string
  platform: MessagePlatform
  platform_account_id: string
  display_name: string
  webhook_verify_token: string | null
  is_active: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
  branch?: Branch
}

export interface Conversation {
  id: string
  channel_id: string
  client_id: string | null
  platform_conversation_id: string | null
  platform_user_id: string
  platform_user_name: string | null
  status: ConversationStatus
  last_message_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  closed_at: string | null
  reopened_at: string | null
  auto_close_after_hours: number
  unread_count: number
  can_reply_until: string | null
  created_at: string
  updated_at: string
  channel?: SocialChannel
  client?: Client
  last_message?: Array<{ content: string | null; direction: MessageDirection; content_type: MessageContentType; created_at: string }> | null
}

export interface Message {
  id: string
  conversation_id: string
  direction: MessageDirection
  content_type: MessageContentType
  content: string | null
  media_url: string | null
  template_name: string | null
  template_params: Record<string, unknown> | null
  platform_message_id: string | null
  status: MessageStatus
  sent_by_staff_id: string | null
  error_message: string | null
  created_at: string
  sent_by?: Staff
}

export interface MessageTemplate {
  id: string
  channel_id: string
  name: string
  language: string
  category: TemplateCategory | null
  status: TemplateStatus
  components: Record<string, unknown> | null
  created_at: string
  channel?: SocialChannel
}

export interface ScheduledMessage {
  id: string
  channel_id: string | null  // nullable — mensajes vía WA Microservice no usan canal Meta
  client_id: string
  template_id: string | null
  content: string | null
  template_params: Record<string, unknown> | null
  scheduled_for: string
  status: ScheduledMessageStatus
  sent_at: string | null
  error_message: string | null
  created_by: string | null
  phone: string | null       // teléfono directo para envío por WA Microservice
  created_at: string
  channel?: SocialChannel
  client?: Client
  template?: MessageTemplate
  created_by_staff?: Staff
}

// ─── Workflow Automation ─────────────────────────────────────────

export interface AutomationWorkflow {
  id: string
  organization_id: string
  branch_id: string | null
  name: string
  description: string | null
  is_active: boolean
  channels: string[]
  trigger_type: WorkflowTriggerType
  trigger_config: Record<string, unknown>
  priority: number
  category: string | null
  overlap_policy: 'skip_if_active' | 'queue' | 'replace' | 'parallel'
  interrupts_categories: string[]
  wait_reply_timeout_minutes: number
  fallback_template_name: string | null
  requires_meta_window: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowNode {
  id: string
  workflow_id: string
  node_type: WorkflowNodeType
  label: string
  config: Record<string, unknown>
  position_x: number
  position_y: number
  width: number
  height: number
  is_entry_point: boolean
  created_at: string
}

export interface WorkflowEdge {
  id: string
  workflow_id: string
  source_node_id: string
  target_node_id: string
  source_handle: string
  label: string | null
  condition_value: string | null
  sort_order: number
}

export interface WorkflowExecution {
  id: string
  workflow_id: string
  conversation_id: string
  current_node_id: string | null
  status: WorkflowExecutionStatus
  context: Record<string, unknown>
  triggered_by: string | null
  triggered_message_id: string | null
  started_at: string
  completed_at: string | null
  updated_at: string
}

export interface WorkflowExecutionLog {
  id: string
  execution_id: string
  node_id: string
  node_type: string
  status: 'success' | 'error' | 'skipped'
  input_data: Record<string, unknown>
  output_data: Record<string, unknown>
  error_message: string | null
  executed_at: string
}

export interface CrmAlert {
  id: string
  organization_id: string
  conversation_id: string | null
  workflow_execution_id: string | null
  alert_type: CrmAlertType
  title: string
  message: string | null
  metadata: Record<string, unknown>
  is_read: boolean
  read_by: string | null
  read_at: string | null
  created_at: string
}

// Workflow con sus relaciones (nodos + edges)
export interface WorkflowWithGraph extends AutomationWorkflow {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

// Appointment system types
export interface AppointmentSettings {
  id: string
  organization_id: string
  is_enabled: boolean
  appointment_hours_open: string
  appointment_hours_close: string
  appointment_days: number[]
  slot_interval_minutes: number
  max_advance_days: number
  no_show_tolerance_minutes: number
  cancellation_min_hours: number
  confirmation_template_name: string | null
  reminder_template_name: string | null
  reminder_hours_before: number
  payment_mode: 'prepago' | 'postpago'
  brand_primary_color: string
  brand_bg_color: string
  brand_text_color: string
  welcome_message: string | null
  buffer_minutes: number
  lead_time_minutes: number
  created_at: string
  updated_at: string
}

export type AppointmentStaffWalkinMode = 'both' | 'appointments_only'

export interface AppointmentStaff {
  id: string
  organization_id: string
  staff_id: string
  is_active: boolean
  walkin_mode: AppointmentStaffWalkinMode
  created_at: string
  staff?: Staff
}

export interface Appointment {
  id: string
  organization_id: string
  branch_id: string
  client_id: string
  barber_id: string | null
  service_id: string | null
  appointment_date: string
  start_time: string
  end_time: string
  duration_minutes: number
  status: AppointmentStatus
  source: AppointmentSource
  cancellation_token: string | null
  payment_flag: string | null
  queue_entry_id: string | null
  created_by_staff_id: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  no_show_marked_at: string | null
  no_show_marked_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  client?: Client
  barber?: Staff
  service?: Service
  branch?: Branch
}

export interface Database {
  public: {
    Tables: {
      organizations: { Row: Organization; Insert: Partial<Organization> & Pick<Organization, 'name' | 'slug'>; Update: Partial<Organization> }
      organization_members: { Row: OrganizationMember; Insert: Partial<OrganizationMember> & Pick<OrganizationMember, 'organization_id' | 'user_id'>; Update: Partial<OrganizationMember> }
      branches: { Row: Branch; Insert: Partial<Branch> & Pick<Branch, 'name' | 'organization_id'>; Update: Partial<Branch> }
      payment_accounts: { Row: PaymentAccount; Insert: Partial<PaymentAccount> & Pick<PaymentAccount, 'branch_id' | 'name'>; Update: Partial<PaymentAccount> }
      expense_tickets: { Row: ExpenseTicket; Insert: Partial<ExpenseTicket> & Pick<ExpenseTicket, 'branch_id' | 'amount' | 'category'>; Update: Partial<ExpenseTicket> }
      transfer_logs: { Row: TransferLog; Insert: Partial<TransferLog> & Pick<TransferLog, 'payment_account_id' | 'amount' | 'branch_id'>; Update: Partial<TransferLog> }
      staff: { Row: Staff; Insert: Partial<Staff> & Pick<Staff, 'role' | 'full_name' | 'organization_id'>; Update: Partial<Staff> }
      clients: { Row: Client; Insert: Partial<Client> & Pick<Client, 'phone' | 'name' | 'organization_id'>; Update: Partial<Client> }
      services: { Row: Service; Insert: Partial<Service> & Pick<Service, 'name' | 'price'>; Update: Partial<Service> }
      staff_service_commissions: { Row: StaffServiceCommission; Insert: Partial<StaffServiceCommission> & Pick<StaffServiceCommission, 'staff_id' | 'service_id' | 'commission_pct'>; Update: Partial<StaffServiceCommission> }
      products: { Row: Product; Insert: Partial<Product> & Pick<Product, 'name'>; Update: Partial<Product> }
      product_sales: { Row: ProductSale; Insert: Partial<ProductSale> & Pick<ProductSale, 'product_id' | 'barber_id' | 'branch_id' | 'unit_price'>; Update: Partial<ProductSale> }
      queue_entries: { Row: QueueEntry; Insert: Partial<QueueEntry> & Pick<QueueEntry, 'branch_id' | 'client_id' | 'position'>; Update: Partial<QueueEntry> }
      visits: { Row: Visit; Insert: Partial<Visit> & Pick<Visit, 'branch_id' | 'client_id' | 'barber_id' | 'amount' | 'started_at' | 'completed_at'>; Update: Partial<Visit> }
      rewards_config: { Row: RewardsConfig; Insert: Partial<RewardsConfig>; Update: Partial<RewardsConfig> }
      client_points: { Row: ClientPoints; Insert: Partial<ClientPoints> & Pick<ClientPoints, 'client_id'>; Update: Partial<ClientPoints> }
      point_transactions: { Row: PointTransaction; Insert: Partial<PointTransaction> & Pick<PointTransaction, 'client_id' | 'points' | 'type'>; Update: Partial<PointTransaction> }
      app_settings: { Row: AppSettings; Insert: Partial<AppSettings>; Update: Partial<AppSettings> }
      fixed_expenses: { Row: FixedExpense; Insert: Partial<FixedExpense> & Pick<FixedExpense, 'branch_id' | 'name' | 'amount'>; Update: Partial<FixedExpense> }
      visit_photos: { Row: VisitPhoto; Insert: Partial<VisitPhoto> & Pick<VisitPhoto, 'visit_id' | 'storage_path'>; Update: Partial<VisitPhoto> }
      service_tags: { Row: ServiceTag; Insert: Partial<ServiceTag> & Pick<ServiceTag, 'name'>; Update: Partial<ServiceTag> }
      client_face_descriptors: { Row: ClientFaceDescriptor; Insert: Partial<ClientFaceDescriptor> & Pick<ClientFaceDescriptor, 'client_id' | 'descriptor'>; Update: Partial<ClientFaceDescriptor> }
      staff_face_descriptors: { Row: StaffFaceDescriptor; Insert: Partial<StaffFaceDescriptor> & Pick<StaffFaceDescriptor, 'staff_id' | 'descriptor'>; Update: Partial<StaffFaceDescriptor> }
      break_configs: { Row: BreakConfig; Insert: Partial<BreakConfig> & Pick<BreakConfig, 'branch_id' | 'name'>; Update: Partial<BreakConfig> }
      break_requests: { Row: BreakRequest; Insert: Partial<BreakRequest> & Pick<BreakRequest, 'staff_id' | 'branch_id' | 'break_config_id'>; Update: Partial<BreakRequest> }
      staff_schedules: { Row: StaffSchedule; Insert: Partial<StaffSchedule> & Pick<StaffSchedule, 'staff_id' | 'day_of_week' | 'start_time' | 'end_time'> & { block_index?: number }; Update: Partial<StaffSchedule> }
      staff_schedule_exceptions: { Row: StaffScheduleException; Insert: Partial<StaffScheduleException> & Pick<StaffScheduleException, 'staff_id' | 'exception_date'>; Update: Partial<StaffScheduleException> }
      attendance_logs: { Row: AttendanceLog; Insert: Partial<AttendanceLog> & Pick<AttendanceLog, 'staff_id' | 'branch_id' | 'action_type'>; Update: Partial<AttendanceLog> }
      salary_configs: { Row: SalaryConfig; Insert: Partial<SalaryConfig> & Pick<SalaryConfig, 'staff_id' | 'scheme'>; Update: Partial<SalaryConfig> }
      salary_payments: { Row: SalaryPayment; Insert: Partial<SalaryPayment> & Pick<SalaryPayment, 'staff_id' | 'period_start' | 'period_end' | 'calculated_amount'>; Update: Partial<SalaryPayment> }
      incentive_rules: { Row: IncentiveRule; Insert: Partial<IncentiveRule> & Pick<IncentiveRule, 'branch_id' | 'name' | 'threshold' | 'reward_amount'>; Update: Partial<IncentiveRule> }
      incentive_achievements: { Row: IncentiveAchievement; Insert: Partial<IncentiveAchievement> & Pick<IncentiveAchievement, 'staff_id' | 'rule_id' | 'period_label' | 'amount_earned'>; Update: Partial<IncentiveAchievement> }
      disciplinary_rules: { Row: DisciplinaryRule; Insert: Partial<DisciplinaryRule> & Pick<DisciplinaryRule, 'branch_id' | 'event_type' | 'occurrence_number'>; Update: Partial<DisciplinaryRule> }
      disciplinary_events: { Row: DisciplinaryEvent; Insert: Partial<DisciplinaryEvent> & Pick<DisciplinaryEvent, 'staff_id' | 'branch_id' | 'event_type'>; Update: Partial<DisciplinaryEvent> }
      roles: { Row: Role; Insert: Partial<Role> & Pick<Role, 'name' | 'organization_id'>; Update: Partial<Role> }
      role_branch_scope: { Row: RoleBranchScope; Insert: Partial<RoleBranchScope> & Pick<RoleBranchScope, 'role_id' | 'branch_id'>; Update: Partial<RoleBranchScope> }
      social_channels: { Row: SocialChannel; Insert: Partial<SocialChannel> & Pick<SocialChannel, 'branch_id' | 'platform' | 'platform_account_id' | 'display_name'>; Update: Partial<SocialChannel> }
      conversations: { Row: Conversation; Insert: Partial<Conversation> & Pick<Conversation, 'channel_id' | 'platform_user_id'>; Update: Partial<Conversation> }
      messages: { Row: Message; Insert: Partial<Message> & Pick<Message, 'conversation_id' | 'direction'>; Update: Partial<Message> }
      message_templates: { Row: MessageTemplate; Insert: Partial<MessageTemplate> & Pick<MessageTemplate, 'channel_id' | 'name'>; Update: Partial<MessageTemplate> }
      scheduled_messages: { Row: ScheduledMessage; Insert: Partial<ScheduledMessage> & Pick<ScheduledMessage, 'channel_id' | 'client_id' | 'scheduled_for'>; Update: Partial<ScheduledMessage> }
      appointment_settings: { Row: AppointmentSettings; Insert: Partial<AppointmentSettings> & Pick<AppointmentSettings, 'organization_id'>; Update: Partial<AppointmentSettings> }
      appointment_staff: { Row: AppointmentStaff; Insert: Partial<AppointmentStaff> & Pick<AppointmentStaff, 'organization_id' | 'staff_id'>; Update: Partial<AppointmentStaff> }
      appointments: { Row: Appointment; Insert: Partial<Appointment> & Pick<Appointment, 'organization_id' | 'branch_id' | 'client_id' | 'appointment_date' | 'start_time' | 'end_time' | 'duration_minutes'>; Update: Partial<Appointment> }
    }
    Views: {
      branch_occupancy: { Row: BranchOccupancy }
    }
  }
}

// =============================================================
// Convenios Comerciales (migration 085)
// =============================================================

export type PartnerRelationStatus = 'active' | 'paused' | 'revoked'
export type PartnerBenefitStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'archived'
export type PartnerRedemptionStatus = 'issued' | 'used' | 'expired'
export type PartnerMagicLinkPurpose = 'invitation' | 'login'

export interface CommercialPartner {
  id: string
  business_name: string
  contact_email: string | null
  contact_phone: string | null
  logo_url: string | null
  created_at: string
  updated_at: string
}

export interface PartnerOrgRelation {
  id: string
  partner_id: string
  organization_id: string
  status: PartnerRelationStatus
  invited_by: string | null
  invited_at: string
  revoked_at: string | null
}

export interface PartnerBenefit {
  id: string
  partner_id: string
  organization_id: string
  title: string
  description: string | null
  discount_text: string | null
  image_url: string | null
  terms: string | null
  location_address: string | null
  location_map_url: string | null
  valid_from: string | null
  valid_until: string | null
  status: PartnerBenefitStatus
  rejection_reason: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface PartnerBenefitWithPartner extends PartnerBenefit {
  commercial_partners?: Pick<CommercialPartner, 'id' | 'business_name' | 'logo_url'> | null
}

export interface PartnerBenefitRedemption {
  id: string
  benefit_id: string
  client_id: string
  code: string
  status: PartnerRedemptionStatus
  used_at: string | null
  validated_by_partner_id: string | null
  created_at: string
}

export interface PartnerMagicLink {
  id: string
  partner_id: string
  token_hash: string
  purpose: PartnerMagicLinkPurpose
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface PartnerSession {
  id: string
  partner_id: string
  session_token_hash: string
  expires_at: string
  created_at: string
  last_used_at: string
}
