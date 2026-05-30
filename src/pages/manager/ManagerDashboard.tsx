import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKey, localDayToUTCRange } from '../../lib/datetime';

export default function ManagerDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    todayBills: 0,
    todayCashIncome: 0,
    todayCardIncome: 0,
    todayPaypalIncome: 0,
    todayTotalIncome: 0,
    todayExpenses: 0,
    todayCashExpenses: 0,
    netCash: 0,
  });

  const [recentBills, setRecentBills] = useState<any[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const today = localDateKey();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setLoading(true);
    const { start: dayStart, end: dayEnd } = localDayToUTCRange(today);
    try {
      // Today's bills for this manager
      const { data: bills } = await supabase
        .from('bills')
        .select('*')
        .eq('created_by', user?.id)
        .eq('is_deleted', false)
        .gte('bill_date', dayStart)
        .lte('bill_date', dayEnd)
        .neq('payment_status', 'cancelled');

      // Today's expenses for this manager
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*')
        .eq('created_by', user?.id)
        .gte('expense_date', dayStart)
        .lte('expense_date', dayEnd);

      // Today's bills list (filtered by bill_date, not created_at)
      const { data: recent } = await supabase
        .from('bills')
        .select('*')
        .eq('created_by', user?.id)
        .eq('is_deleted', false)
        .gte('bill_date', dayStart)
        .lte('bill_date', dayEnd)
        .order('bill_date', { ascending: false })
        .limit(10);

      // Today's expenses list (filtered by expense_date)
      const { data: recentExp } = await supabase
        .from('expenses')
        .select('*')
        .eq('created_by', user?.id)
        .gte('expense_date', dayStart)
        .lte('expense_date', dayEnd)
        .order('expense_date', { ascending: false })
        .limit(10);

      // Calculate stats
      const paidBills = (bills || []).filter(b => b.payment_status === 'paid' || b.payment_status === 'partial');

      const cashIncome = paidBills.reduce((s, b) => s + (Number(b.cash_amount) || 0), 0);
      const cardIncome = paidBills.reduce((s, b) => s + (Number(b.card_amount) || 0), 0);
      const paypalIncome = paidBills.reduce((s, b) => s + (Number(b.paypal_amount) || 0), 0);
      const totalIncome = cashIncome + cardIncome + paypalIncome;

      const totalExpenses = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const cashExpenses = (expenses || [])
        .filter(e => e.paid_from === 'cash')
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);

      setStats({
        todayBills: (bills || []).length,
        todayCashIncome: cashIncome,
        todayCardIncome: cardIncome,
        todayPaypalIncome: paypalIncome,
        todayTotalIncome: totalIncome,
        todayExpenses: totalExpenses,
        todayCashExpenses: cashExpenses,
        netCash: cashIncome - cashExpenses,
      });

      setRecentBills(recent || []);
      setRecentExpenses(recentExp || []);

      // Pending edit requests for this manager's records
      const { data: requests } = await supabase
        .from('edit_requests')
        .select('*')
        .eq('record_manager_id', user?.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      setPendingRequests(requests || []);
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function reviewRequest(id: string, status: 'approved' | 'rejected') {
    await supabase
      .from('edit_requests')
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    setPendingRequests(prev => prev.filter(r => r.id !== id));
  }

  const BILL_TYPE_LABELS: Record<string, string> = {
    table: '🍽️ Table',
    parcel: '📦 Parcel',
    abholung: '🛵 Abholung',
  };

  const STATUS_COLORS: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    unpaid: 'bg-red-100 text-red-700',
    partial: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };

  return (
    <Layout>
      <div className="space-y-6">

        {/* Welcome header */}
        <div className="flex items-center gap-3">
          <img
            src="/bombay-haus-logo.png"
            alt="Bombay Haus"
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome, {profile?.full_name?.split(' ')[0] || 'Manager'} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {new Date().toLocaleDateString('de-DE', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
              })}
            </p>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/bills/add')}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-4 text-left transition-colors"
          >
            <div className="text-2xl mb-1">🧾</div>
            <div className="font-semibold text-sm">Add New Bill</div>
            <div className="text-xs text-blue-200 mt-0.5">Table / Parcel / Abholung</div>
          </button>
          <button
            onClick={() => navigate('/expenses/add')}
            className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl p-4 text-left transition-colors"
          >
            <div className="text-2xl mb-1">💸</div>
            <div className="font-semibold text-sm">Add Expense</div>
            <div className="text-xs text-orange-100 mt-0.5">Driver / Fuel / Other</div>
          </button>
          <button
            onClick={() => navigate('/bills')}
            className="bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 rounded-xl p-4 text-left transition-colors"
          >
            <div className="text-2xl mb-1">📋</div>
            <div className="font-semibold text-sm">View My Bills</div>
            <div className="text-xs text-gray-400 mt-0.5">Today's records</div>
          </button>
          <button
            onClick={() => navigate('/cash-balance')}
            className="bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 rounded-xl p-4 text-left transition-colors"
          >
            <div className="text-2xl mb-1">💰</div>
            <div className="font-semibold text-sm">Cash Balance</div>
            <div className="text-xs text-gray-400 mt-0.5">My shift summary</div>
          </button>
          <button
            onClick={() => navigate('/online-delivery')}
            className="bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 rounded-xl p-4 text-left transition-colors"
          >
            <div className="text-2xl mb-1">🚀</div>
            <div className="font-semibold text-sm">Online Delivery</div>
            <div className="text-xs text-gray-400 mt-0.5">Lieferando / Uber / Wolt</div>
          </button>
        </div>

        {/* Today's stats */}
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading today's data...</div>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Today's Summary
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label="Total Bills"
                  value={String(stats.todayBills)}
                  icon="🧾"
                  color="blue"
                  isCount
                />
                <StatCard
                  label="Cash Income"
                  value={stats.todayCashIncome.toFixed(2)}
                  icon="💵"
                  color="green"
                />
                <StatCard
                  label="Card Income"
                  value={stats.todayCardIncome.toFixed(2)}
                  icon="💳"
                  color="indigo"
                />
                <StatCard
                  label="PayPal Income"
                  value={stats.todayPaypalIncome.toFixed(2)}
                  icon="🅿️"
                  color="blue"
                />
                <StatCard
                  label="Total Income"
                  value={stats.todayTotalIncome.toFixed(2)}
                  icon="📈"
                  color="green"
                />
                <StatCard
                  label="Total Expenses"
                  value={stats.todayExpenses.toFixed(2)}
                  icon="📉"
                  color="red"
                />
                <StatCard
                  label="Cash Expenses"
                  value={stats.todayCashExpenses.toFixed(2)}
                  icon="💸"
                  color="orange"
                />
                <StatCard
                  label="Net Cash (Est.)"
                  value={stats.netCash.toFixed(2)}
                  icon="💰"
                  color={stats.netCash >= 0 ? 'green' : 'red'}
                />
              </div>
            </div>

            {/* Pending Edit Requests */}
            {pendingRequests.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  ⏳ Pending Admin Requests ({pendingRequests.length})
                </h2>
                <div className="bg-white rounded-xl border border-amber-200 divide-y divide-amber-50">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 capitalize">
                          {req.action} {req.request_type} #{String(req.record_id).slice(0, 8)}
                        </div>
                        {req.reason && (
                          <div className="text-xs text-gray-500 mt-0.5 truncate">"{req.reason}"</div>
                        )}
                        <div className="text-xs text-gray-400 mt-0.5">
                          {new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => reviewRequest(req.id, 'approved')}
                          className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 font-medium transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reviewRequest(req.id, 'rejected')}
                          className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Bills */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  Today's Bills
                </h2>
                <button
                  onClick={() => navigate('/bills')}
                  className="text-blue-600 text-xs hover:underline"
                >
                  View all →
                </button>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {recentBills.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    No bills recorded today.
                  </div>
                ) : (
                  recentBills.map(bill => (
                    <div key={bill.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {BILL_TYPE_LABELS[bill.bill_type] || bill.bill_type}
                          {bill.table_number ? ` — Table ${bill.table_number}` : ''}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {new Date(bill.bill_date).toLocaleTimeString('de-DE', {
                            hour: '2-digit', minute: '2-digit'
                          })}
                          {bill.bill_number ? ` · #${bill.bill_number}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[bill.payment_status] || ''}`}>
                          {bill.payment_status}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">
                          €{Number(bill.total_amount).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Expenses */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  Today's Expenses
                </h2>
                <button
                  onClick={() => navigate('/expenses')}
                  className="text-blue-600 text-xs hover:underline"
                >
                  View all →
                </button>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {recentExpenses.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    No expenses recorded today.
                  </div>
                ) : (
                  recentExpenses.map(exp => (
                    <div key={exp.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{exp.description}</div>
                        <div className="text-xs text-gray-400 mt-0.5 capitalize">
                          {exp.category?.replace(/_/g, ' ')} · {exp.paid_from}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-red-600">
                        -€{Number(exp.amount).toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// Small reusable stat card
function StatCard({
  label, value, icon, color, isCount
}: {
  label: string;
  value: string;
  icon: string;
  color: 'blue' | 'green' | 'red' | 'orange' | 'indigo';
  isCount?: boolean;
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  };

  return (
    <div className={`rounded-xl p-4 ${colorMap[color]}`}>
      <div className="text-xl mb-1">{icon}</div>
      <div className="text-lg font-bold">
        {isCount ? value : `€${value}`}
      </div>
      <div className="text-xs mt-0.5 opacity-75">{label}</div>
    </div>
  );
}
