export type UserRole = 'admin' | 'manager'

export type BillType = 'table' | 'parcel' | 'abholung'

export type PaymentMethod = 'cash' | 'card' | 'paypal' | 'mixed'

export type PaymentStatus = 'paid' | 'unpaid' | 'partial' | 'cancelled'

export type ExpenseCategory =
  | 'driver_pay'
  | 'diesel_fuel'
  | 'grocery'
  | 'drinks'
  | 'packaging'
  | 'vehicle_maintenance'
  | 'restaurant_maintenance'
  | 'staff_payment'
  | 'other'

export type PaidFrom = 'cash' | 'card' | 'bank' | 'paypal' | 'other'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  is_active: boolean
  must_change_password?: boolean
  created_at: string
  updated_at: string
}

export interface Bill {
  id: string
  bill_number: string
  bill_type: BillType
  table_number?: string
  customer_note?: string
  total_amount: number
  discount: number
  paid_amount: number
  payment_status: PaymentStatus
  payment_method?: PaymentMethod
  cash_amount: number
  card_amount: number
  paypal_amount: number
  notes?: string
  is_deleted: boolean
  created_by: string
  bill_date: string
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  amount: number
  paid_from: PaidFrom
  description?: string
  notes?: string
  receipt_url?: string
  is_deleted: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface ManagerCashSession {
  id: string
  manager_id: string
  session_date: string
  opening_cash: number
  cash_income: number
  cash_expenses: number
  cash_handover: number
  adjustments: number
  closing_cash: number
  is_closed: boolean
  created_at: string
  updated_at: string
}

export interface CashHandover {
  id: string
  manager_id: string
  amount: number
  handover_date: string
  received_by?: string
  notes?: string
  created_at: string
}

export interface AuditLog {
  id: string
  action: string
  table_name: string
  record_id?: string
  old_data?: any
  new_data?: any
  performed_by?: string
  created_at: string
}

export interface BackupLog {
  id: string
  backed_up_by: string
  backup_type: string
  created_at: string
}