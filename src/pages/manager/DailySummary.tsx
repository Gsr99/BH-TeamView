import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKey, localDayToUTCRange, localDateKeyFromValue } from '../../lib/datetime';
import { fetchKnownUsers } from '../../lib/users';

const PLATFORMS = [
  { key: 'lieferando', label: 'Lieferando', emoji: '🟠' },
  { key: 'uber_eats',  label: 'Uber Eats',  emoji: '⬛' },
  { key: 'wolt',       label: 'Wolt',       emoji: '🔵' },
  { key: 'bh_online',  label: 'BH Online',  emoji: '🟢' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  driver_pay: 'Driver Pay',
  diesel_fuel: 'Diesel / Fuel',
  grocery: 'Grocery',
  drinks: 'Drinks',
  packaging: 'Packaging',
  vehicle_maintenance: 'Vehicle Maintenance',
  restaurant_maintenance: 'Restaurant Maintenance',
  staff_payment: 'Staff Payment',
  other: 'Other',
};

export default function DailySummary() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedManager, setSelectedManager] = useState('');
  const [managers, setManagers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [bills, setBills] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [onlineEntries, setOnlineEntries] = useState<any[]>([]);

  useEffect(() => {
    if (isAdmin) {
      fetchKnownUsers({ includeAdmins: false }).then(users => {
        setManagers(users);
        // Start with "All Managers" selected (empty string)
      });
    } else {
      setSelectedManager(user?.id || '');
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!isAdmin || selectedManager !== undefined) fetchAll();
  }, [selectedDate, selectedManager]);

  async function fetchAll() {
    setLoading(true);
    // For managers: always filter by self. For admin: filter by selected or show all.
    const managerId = isAdmin ? (selectedManager || null) : user?.id;

    const { start, end } = localDayToUTCRange(selectedDate);

    let billsQ = supabase
      .from('bills')
      .select('cash_amount, card_amount, paypal_amount, payment_status, tip_amount')
      .eq('is_deleted', false)
      .gte('bill_date', start)
      .lte('bill_date', end)
      .neq('payment_status', 'cancelled');
    if (managerId) billsQ = billsQ.eq('created_by', managerId);

    let expQ = supabase
      .from('expenses')
      .select('amount, paid_from, category, expense_date');
    if (managerId) expQ = expQ.eq('created_by', managerId);

    let onlineQ = supabase
      .from('online_delivery_entries')
      .select('platform, total_sales, cash_amount')
      .eq('entry_date', selectedDate);
    if (managerId) onlineQ = onlineQ.eq('created_by', managerId);

    const [billsRes, expRes, onlineRes] = await Promise.all([billsQ, expQ, onlineQ]);

    setBills(billsRes.data || []);
    setExpenses(
      (expRes.data || []).filter(e => localDateKeyFromValue(e.expense_date) === selectedDate)
    );
    setOnlineEntries(onlineRes.data || []);
    setLoading(false);
  }

  // ── Bill income ────────────────────────────────────────
  const paidBills = bills.filter(b => b.payment_status === 'paid' || b.payment_status === 'partial');
  const cashIncome   = paidBills.reduce((s, b) => s + (Number(b.cash_amount) || 0), 0);
  const cardIncome   = paidBills.reduce((s, b) => s + (Number(b.card_amount) || 0), 0);
  const paypalIncome = paidBills.reduce((s, b) => s + (Number(b.paypal_amount) || 0), 0);
  const totalTips    = bills.reduce((s, b) => s + (Number(b.tip_amount) || 0), 0);
  const totalBillIncome = cashIncome + cardIncome + paypalIncome;

  // ── Online delivery ────────────────────────────────────
  const totalOnlineSales = onlineEntries.reduce((s, e) => s + (Number(e.total_sales) || 0), 0);
  const totalOnlineCash  = onlineEntries.reduce((s, e) => s + (Number(e.cash_amount) || 0), 0);
  const totalOnlineDigital = totalOnlineSales - totalOnlineCash;

  // ── Expenses ───────────────────────────────────────────
  const cashExpenses   = expenses.filter(e => e.paid_from === 'cash').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalExpenses  = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // ── Grand totals ───────────────────────────────────────
  const totalRevenue = totalBillIncome + totalOnlineSales;
  const netProfit    = totalRevenue - totalExpenses;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Summary</h1>
          <p className="text-gray-500 text-sm mt-1">All income and outflow — all payment methods</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {isAdmin && (
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Manager</label>
              <select
                value={selectedManager}
                onChange={e => setSelectedManager(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Managers</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name || m.email || 'Unknown'}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        ) : (
          <>
            {/* Bill Income */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Bill Income — {bills.length} bill(s)
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                <SummaryRow label="💵 Cash" value={cashIncome} color="green" />
                <SummaryRow label="💳 Card" value={cardIncome} color="indigo" />
                <SummaryRow label="🅿️ PayPal" value={paypalIncome} color="blue" />
                {totalTips > 0 && (
                  <SummaryRow label="🪙 Tips" value={totalTips} color="amber" />
                )}
                <SummaryRow label="Total Bill Income" value={totalBillIncome} color="green" bold />
              </div>
            </section>

            {/* Online Delivery */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Online Delivery
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {PLATFORMS.map(p => {
                  const entry = onlineEntries.find(e => e.platform === p.key);
                  const sales = Number(entry?.total_sales) || 0;
                  const cash  = Number(entry?.cash_amount)  || 0;
                  if (sales === 0 && cash === 0) return null;
                  return (
                    <div key={p.key} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm text-gray-700">{p.emoji} {p.label}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Cash €{cash.toFixed(2)} · Online €{(sales - cash).toFixed(2)}
                        </div>
                      </div>
                      <span className="font-semibold text-sm text-gray-900">€{sales.toFixed(2)}</span>
                    </div>
                  );
                })}
                {totalOnlineSales === 0 && (
                  <div className="px-4 py-3 text-sm text-gray-400">No delivery entries for this date.</div>
                )}
                {totalOnlineSales > 0 && (
                  <>
                    <SummaryRow label="💵 Total Online Cash" value={totalOnlineCash} color="green" />
                    <SummaryRow label="🌐 Total Online Digital" value={totalOnlineDigital} color="blue" />
                    <SummaryRow label="Total Delivery Sales" value={totalOnlineSales} color="green" bold />
                  </>
                )}
              </div>
            </section>

            {/* Expenses */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Expenses — {expenses.length} record(s)
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {expenses.length === 0 && (
                  <div className="px-4 py-3 text-sm text-gray-400">No expenses for this date.</div>
                )}
                {Object.keys(CATEGORY_LABELS)
                  .filter(cat => expenses.some(e => e.category === cat))
                  .map(cat => {
                    const total = expenses
                      .filter(e => e.category === cat)
                      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
                    return (
                      <SummaryRow
                        key={cat}
                        label={CATEGORY_LABELS[cat]}
                        value={total}
                        color="red"
                        isDeduction
                      />
                    );
                  })}
                {expenses.length > 0 && (
                  <>
                    <SummaryRow label="💵 Cash Expenses" value={cashExpenses} color="red" isDeduction />
                    <SummaryRow label="Total Expenses" value={totalExpenses} color="red" bold isDeduction />
                  </>
                )}
              </div>
            </section>

            {/* Grand Summary */}
            <div className="bg-gray-900 rounded-xl p-5 text-white space-y-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Daily Summary
              </h2>
              <FormulaRow label="Bill Income" value={totalBillIncome} />
              <FormulaRow label="+ Online Delivery" value={totalOnlineSales} />
              <FormulaRow label="= Total Revenue" value={totalRevenue} highlight />
              <FormulaRow label="− Total Expenses" value={-totalExpenses} />
              <div className="border-t border-gray-700 pt-3 mt-3 flex justify-between items-center">
                <span className="text-sm font-semibold text-white">= Net Profit</span>
                <span className={`text-xl font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  €{netProfit.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-gray-700 pt-3 mt-1 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-gray-400">Cash</div>
                  <div className="text-sm font-semibold text-green-400">€{(cashIncome + totalOnlineCash).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Card</div>
                  <div className="text-sm font-semibold text-indigo-300">€{cardIncome.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">PayPal</div>
                  <div className="text-sm font-semibold text-blue-300">€{paypalIncome.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function SummaryRow({ label, value, color, bold, isDeduction, note }: {
  label: string;
  value: number;
  color: string;
  bold?: boolean;
  isDeduction?: boolean;
  note?: string;
}) {
  const colorMap: Record<string, string> = {
    green: 'text-green-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <div className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{label}</div>
        {note && <div className="text-xs text-gray-400">{note}</div>}
      </div>
      <span className={`font-semibold text-sm ${colorMap[color] || 'text-gray-900'}`}>
        {isDeduction ? '-' : ''}€{value.toFixed(2)}
      </span>
    </div>
  );
}

function FormulaRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={highlight ? 'text-white font-medium' : 'text-gray-400'}>{label}</span>
      <span className={
        highlight ? 'text-white font-bold text-base' :
        value < 0 ? 'text-red-400' : 'text-gray-200'
      }>
        {value < 0 ? `-€${Math.abs(value).toFixed(2)}` : `€${value.toFixed(2)}`}
      </span>
    </div>
  );
}
