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
export type ServiceAvailability = 'checkin' | 'upsell' | 'both'

export interface Branch {
  id: string
  name: string
  address: string | null
  phone: string | null
  is_active: boolean
  business_hours_open: string
  business_hours_close: string
  business_days: number[]
  timezone: string
  google_review_url?: string | null
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
  branch?: Branch
  custom_role?: Role
}

export interface Role {
  id: string
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
  branch_id: string
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
  break_request_id: string | null
  checked_in_at: string
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
  name: string
  is_active: boolean
  created_at: string
}

export interface RewardsConfig {
  id: string
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
  lost_client_days: number
  at_risk_client_days: number
  business_hours_open: string
  business_hours_close: string
  business_days: number[]
  shift_end_margin_minutes: number
  next_client_alert_minutes: number
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
  created_at: string
  updated_at: string
  branch?: Branch
}

export interface BreakConfig {
  id: string
  branch_id: string
  name: string
  duration_minutes: number
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

export interface Database {
  public: {
    Tables: {
      branches: { Row: Branch; Insert: Partial<Branch> & Pick<Branch, 'name'>; Update: Partial<Branch> }
      payment_accounts: { Row: PaymentAccount; Insert: Partial<PaymentAccount> & Pick<PaymentAccount, 'branch_id' | 'name'>; Update: Partial<PaymentAccount> }
      expense_tickets: { Row: ExpenseTicket; Insert: Partial<ExpenseTicket> & Pick<ExpenseTicket, 'branch_id' | 'amount' | 'category'>; Update: Partial<ExpenseTicket> }
      transfer_logs: { Row: TransferLog; Insert: Partial<TransferLog> & Pick<TransferLog, 'payment_account_id' | 'amount' | 'branch_id'>; Update: Partial<TransferLog> }
      staff: { Row: Staff; Insert: Partial<Staff> & Pick<Staff, 'role' | 'full_name'>; Update: Partial<Staff> }
      clients: { Row: Client; Insert: Partial<Client> & Pick<Client, 'phone' | 'name'>; Update: Partial<Client> }
      services: { Row: Service; Insert: Partial<Service> & Pick<Service, 'name' | 'price'>; Update: Partial<Service> }
      staff_service_commissions: { Row: StaffServiceCommission; Insert: Partial<StaffServiceCommission> & Pick<StaffServiceCommission, 'staff_id' | 'service_id' | 'commission_pct'>; Update: Partial<StaffServiceCommission> }
      products: { Row: Product; Insert: Partial<Product> & Pick<Product, 'branch_id' | 'name'>; Update: Partial<Product> }
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
      roles: { Row: Role; Insert: Partial<Role> & Pick<Role, 'name'>; Update: Partial<Role> }
      role_branch_scope: { Row: RoleBranchScope; Insert: Partial<RoleBranchScope> & Pick<RoleBranchScope, 'role_id' | 'branch_id'>; Update: Partial<RoleBranchScope> }
    }
    Views: {
      branch_occupancy: { Row: BranchOccupancy }
    }
  }
}
