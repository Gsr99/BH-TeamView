import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/layout/Layout'
import { localDateKey } from '../../lib/datetime'

interface DashboardStats {
  totalIncome: number
  cashIncome: number
  cardIncome: number
  paypalIncome: number
  totalExpenses: number
  netBalance: number
  totalBills: number
  totalExpenseCount: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalIncome: 0,
    cashIncome: 0,
    cardIncome: 0,
    paypalIncome: 0,
    totalExpenses: 0,
    netBalance: 0,
    totalBills: 0,
    totalExpenseCount: 0,
  })
  const [recentBills, setRecentBills] = useState<any[]>([])
  const [recentExpenses, setRecentExpenses] = useState<any[]>([])
  const [backupWarning, setBackupWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const today = localDateKey()

  useEffect(() => {
    fetchDashboardData()
    checkBackupStatus()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Fetch today's bills
      const { data: bills } = await supabase
        .from('bills')
        .select('*')
        .gte('bill_date', `${today}T00:00:00`)
        .lte('bill_date', `${today}T23:59:59`)
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')

      // Fetch today's expenses
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*')
        .gte('expense_date', `${today}T00:00:00`)
        .lte('expense_date', `${today}T23:59:59`)
        .eq('is_deleted', false)

      // Fetch recent bills for table
      const { data: recent } = await supabase
        .from('bills')
        .select('*, profiles(full_name)')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(5)

      // Fetch recent expenses for table
      const { data: recentExp } = await supabase
        .from('expenses')
        .select('*, profiles(full_name)')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(5)

      // Calculate stats
      const cashIncome = bills?.reduce((sum, b) => sum + (b.cash_amount || 0), 0) || 0
      const cardIncome = bills?.reduce((sum, b) => sum + (b.card_amount || 0), 0) || 0
      const paypalIncome = bills?.reduce((sum, b) => sum + (b.paypal_amount || 0), 0) || 0
      const totalIncome = cashIncome + cardIncome + paypalIncome
      const totalExpenses = expenses?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0

      setStats({
        totalIncome,
        cashIncome,
        cardIncome,
        paypalIncome,
        totalExpenses,
        netBalance: totalIncome - totalExpenses,
        totalBills: bills?.length || 0,
        totalExpenseCount: expenses?.length || 0,
      })

      setRecentBills(recent || [])
      setRecentExpenses(recentExp || [])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkBackupStatus = async () => {
    const { data } = await supabase
      .from('backup_logs')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!data || data.length === 0) {
      setBackupWarning('⚠️ No backup has ever been created. Please create a backup.')
      return
    }

    const lastBackup = new Date(data[0].created_at)
    const diffDays = Math.floor((Date.now() - lastBackup.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays >= 60) {
      setBackupWarning(`🚨 URGENT: No backup for ${diffDays} days! Please backup immediately.`)
    } else if (diffDays >= 45) {
      setBackupWarning(`⚠️ Warning: No backup for ${diffDays} days. Please create a backup soon.`)
    }
  }

  const formatCurrency = (amount: number) => `€${amount.toFixed(2)}`

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      paid: 'bg-green-100 text-green-700',
      unpaid: 'bg-red-100 text-red-700',
      partial: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-gray-100 text-gray-700',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.unpaid}`}>
        {status}
      </span>
    )
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      {/* Backup warning */}
      {backupWarning && (
        <div className={`mb-6 px-4 py-3 rounded-lg text-sm font-medium ${
          backupWarning.includes('URGENT')
            ? 'bg-red-100 text-red-700 border border-red-300'
            : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
        }`}>
          {backupWarning}
        </div>
      )}

      {/* Page title */}
      <div className="mb-6 flex items-center gap-3">
        <img
          src="/bombay-haus-logo.png"
          alt="Bombay Haus"
          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
        />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Today: {new Date().toLocaleDateString('en-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-gray-500 text-xs font-medium uppercase">Total Income</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{formatCurrency(stats.totalIncome)}</p>
          <p className="text-xs text-gray-400 mt-1">{stats.totalBills} bills today</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-gray-500 text-xs font-medium uppercase">Cash Income</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(stats.cashIncome)}</p>
          <p className="text-xs text-gray-400 mt-1">Physical cash</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-gray-500 text-xs font-medium uppercase">Card Income</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(stats.cardIncome)}</p>
          <p className="text-xs text-gray-400 mt-1">Card payments</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-gray-500 text-xs font-medium uppercase">PayPal Income</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{formatCurrency(stats.paypalIncome)}</p>
          <p className="text-xs text-gray-400 mt-1">PayPal payments</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-gray-500 text-xs font-medium uppercase">Total Expenses</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(stats.totalExpenses)}</p>
          <p className="text-xs text-gray-400 mt-1">{stats.totalExpenseCount} expenses today</p>
        </div>

        <div className={`bg-white rounded-xl shadow-sm p-4 border col-span-1 ${
          stats.netBalance >= 0 ? 'border-green-200' : 'border-red-200'
        }`}>
          <p className="text-gray-500 text-xs font-medium uppercase">Net Balance</p>
          <p className={`text-2xl font-bold mt-1 ${stats.netBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(stats.netBalance)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Income - Expenses</p>
        </div>
      </div>

      {/* Recent Bills */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Recent Bills</h2>
          <span className="text-xs text-gray-400">Last 5 bills</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-3 text-left">Bill #</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Manager</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentBills.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No bills yet today
                  </td>
                </tr>
              ) : (
                recentBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{bill.bill_number}</td>
                    <td className="px-4 py-3 capitalize">{bill.bill_type}</td>
                    <td className="px-4 py-3">{bill.profiles?.full_name || '-'}</td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(bill.total_amount)}</td>
                    <td className="px-4 py-3">{getStatusBadge(bill.payment_status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Expenses */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Recent Expenses</h2>
          <span className="text-xs text-gray-400">Last 5 expenses</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Manager</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Paid From</th>
                <th className="px-4 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentExpenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No expenses yet today
                  </td>
                </tr>
              ) : (
                recentExpenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 capitalize">{expense.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">{expense.profiles?.full_name || '-'}</td>
                    <td className="px-4 py-3 font-medium text-red-600">{formatCurrency(expense.amount)}</td>
                    <td className="px-4 py-3 capitalize">{expense.paid_from}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(expense.expense_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
