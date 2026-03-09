export type UserRole = 'owner' | 'admin' | 'receptionist' | 'barber'
export type QueueStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled'
export type PaymentMethod = 'cash' | 'card' | 'transfer'
export type PointTxType = 'earned' | 'redeemed'
export type StaffStatus = 'available' | 'paused'

export interface Branch {
  id: string
  name: string
  address: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Staff {
  id: string
  auth_user_id: string | null
  branch_id: string | null
  role: UserRole
  full_name: string
  email: string | null
  pin: string | null
  commission_pct: number
  status: StaffStatus
  is_active: boolean
  created_at: string
  updated_at: string
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
}

export interface ClientFaceDescriptor {
  id: string
  client_id: string
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
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface QueueEntry {
  id: string
  branch_id: string
  client_id: string
  barber_id: string | null
  status: QueueStatus
  position: number
  reward_claimed: boolean
  checked_in_at: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  client?: Client
  barber?: Staff
}

export interface Visit {
  id: string
  branch_id: string
  client_id: string
  barber_id: string
  service_id: string | null
  queue_entry_id: string | null
  payment_method: PaymentMethod
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
  updated_at: string
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

export interface Database {
  public: {
    Tables: {
      branches: { Row: Branch; Insert: Partial<Branch> & Pick<Branch, 'name'>; Update: Partial<Branch> }
      staff: { Row: Staff; Insert: Partial<Staff> & Pick<Staff, 'role' | 'full_name'>; Update: Partial<Staff> }
      clients: { Row: Client; Insert: Partial<Client> & Pick<Client, 'phone' | 'name'>; Update: Partial<Client> }
      services: { Row: Service; Insert: Partial<Service> & Pick<Service, 'name' | 'price'>; Update: Partial<Service> }
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
    }
    Views: {
      branch_occupancy: { Row: BranchOccupancy }
    }
  }
}
