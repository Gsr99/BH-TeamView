import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKey, localDayToUTCRange } from '../../lib/datetime';
import { fetchKnownUsers } from '../../lib/users';

// ── Types ──────────────────────────────────────────────
interface Bill {
  id: string;
  bill_number: string;
  bill_type: string;
  payment_status: string;
  payment_method: string;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
  paypal_amount: number;
  discount: number;
  table_number: string;
  notes: string;
  bill_date: string;
  created_at: string;
  tip_amount: number;
  profiles: { full_name: string };
}

interface Expense {
  id: string;
  category: string;
  amount: number;
  paid_from: string;
  description: string;
  notes: string;
  expense_date: string;
  profiles: { full_name: string };
}

interface OnlineEntry {
  id: string;
  platform: string;
  total_sales: number;
  cash_amount: number;
  notes: string;
  entry_date: string;
  created_by: string;
}

// ── Label maps ─────────────────────────────────────────
const BILL_TYPE_LABELS: Record<string, string> = {
  table: 'Table',
  parcel: 'Parcel',
  abholung: 'Abholung',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  paypal: 'PayPal',
  mixed: 'Mixed',
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PLATFORM_LABELS: Record<string, string> = {
  lieferando: '🟠 Lieferando',
  uber_eats:  '⬛ Uber Eats',
  wolt:       '🔵 Wolt',
  bh_online:  '🟢 BH Online',
};

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

// ── CSV helper ─────────────────────────────────────────
function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ─────────────────────────────────────
export default function Reports() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // Filters
  const today = localDateKey();
  const firstOfMonth = today.slice(0, 8) + '01';

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [filterManager, setFilterManager] = useState('');
  const [filterBillType, setFilterBillType] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [filterExpenseCategory, setFilterExpenseCategory] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'income' | 'expenses' | 'online'>('summary');

  const [managers, setManagers] = useState<any[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [onlineEntries, setOnlineEntries] = useState<OnlineEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) fetchManagers();
  }, [isAdmin]);

  useEffect(() => {
    fetchReportData();
  }, [dateFrom, dateTo, filterManager, filterBillType, filterPaymentMethod, filterExpenseCategory]);

  async function fetchManagers() {
    const users = await fetchKnownUsers({ includeAdmins: false });
    setManagers(users);
  }

  async function fetchReportData() {
    setLoading(true);
    const managerId = isAdmin ? filterManager || null : user?.id;

    try {
      // ── Bills query
      const { start: billStart } = localDayToUTCRange(dateFrom);
      const { end: billEnd } = localDayToUTCRange(dateTo);

      let billQuery = supabase
        .from('bills')
        .select('*, profiles(full_name)')
        .eq('is_deleted', false)
        .gte('bill_date', billStart)
        .lte('bill_date', billEnd)
        .order('bill_date', { ascending: false });

      if (managerId) billQuery = billQuery.eq('created_by', managerId);
      if (filterBillType) billQuery = billQuery.eq('bill_type', filterBillType);
      if (filterPaymentMethod) billQuery = billQuery.eq('payment_method', filterPaymentMethod);

      // ── Expenses query
      let expQuery = supabase
        .from('expenses')
        .select('*, profiles(full_name)')
        .gte('expense_date', billStart)
        .lte('expense_date', billEnd)
        .order('expense_date', { ascending: false });

      if (managerId) expQuery = expQuery.eq('created_by', managerId);
      if (filterExpenseCategory) expQuery = expQuery.eq('category', filterExpenseCategory);

      // ── Online delivery query (entry_date is a plain date column, no profiles join)
      let onlineQuery = supabase
        .from('online_delivery_entries')
        .select('*')
        .gte('entry_date', dateFrom)
        .lte('entry_date', dateTo)
        .order('entry_date', { ascending: false });

      if (managerId) onlineQuery = onlineQuery.eq('created_by', managerId);

      const [{ data: billData }, { data: expData }, { data: onlineData }] = await Promise.all([
        billQuery,
        expQuery,
        onlineQuery,
      ]);

      setBills((billData as Bill[]) || []);
      setExpenses((expData as Expense[]) || []);
      setOnlineEntries((onlineData as OnlineEntry[]) || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ── Computed totals ────────────────────────────────
  const paidBills = bills.filter(b =>
    b.payment_status === 'paid' || b.payment_status === 'partial'
  );

  const totalCashIncome = paidBills.reduce((s, b) => s + (Number(b.cash_amount) || 0), 0);
  const totalCardIncome = paidBills.reduce((s, b) => s + (Number(b.card_amount) || 0), 0);
  const totalPaypalIncome = paidBills.reduce((s, b) => s + (Number(b.paypal_amount) || 0), 0);
  const totalIncome = totalCashIncome + totalCardIncome + totalPaypalIncome;
  const totalDiscount = paidBills.reduce((s, b) => s + (Number(b.discount) || 0), 0);
  const totalTips = bills.reduce((s, b) => s + (Number(b.tip_amount) || 0), 0);

  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const cashExpenses = expenses
    .filter(e => e.paid_from === 'cash')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Online delivery totals
  const totalOnlineSales   = onlineEntries.reduce((s, e) => s + (Number(e.total_sales) || 0), 0);
  const totalOnlineCash    = onlineEntries.reduce((s, e) => s + (Number(e.cash_amount)  || 0), 0);
  const totalOnlineDigital = totalOnlineSales - totalOnlineCash;

  // Per-platform breakdown
  const byPlatform = Object.keys(PLATFORM_LABELS).map(platform => ({
    platform,
    entries: onlineEntries.filter(e => e.platform === platform),
    totalSales: onlineEntries.filter(e => e.platform === platform).reduce((s, e) => s + (Number(e.total_sales) || 0), 0),
    totalCash:  onlineEntries.filter(e => e.platform === platform).reduce((s, e) => s + (Number(e.cash_amount)  || 0), 0),
  })).filter(p => p.totalSales > 0 || p.entries.length > 0);

  const totalRevenue = totalIncome + totalOnlineSales;
  const netProfit    = totalRevenue - totalExpenses;

  // Net cash = all physical cash in minus all cash out
  const netCash = totalCashIncome + totalOnlineCash - cashExpenses;

  // Bill type breakdown
  const byBillType = ['table', 'parcel', 'abholung'].map(type => ({
    type,
    count: bills.filter(b => b.bill_type === type).length,
    total: bills
      .filter(b => b.bill_type === type && b.payment_status !== 'cancelled')
      .reduce((s, b) => s + (Number(b.cash_amount) || 0) + (Number(b.card_amount) || 0) + (Number(b.paypal_amount) || 0), 0),
  }));

  // Expense category breakdown
  const byCategory = Object.keys(CATEGORY_LABELS).map(cat => ({
    cat,
    count: expenses.filter(e => e.category === cat).length,
    total: expenses
      .filter(e => e.category === cat)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0),
  })).filter(c => c.count > 0);

  // ── CSV exports ────────────────────────────────────
  function exportBillsCSV() {
    const headers = [
      'Date', 'Bill Number', 'Type', 'Table',
      'Status', 'Payment Method',
      'Cash (€)', 'Card (€)', 'PayPal (€)', 'Total (€)', 'Discount (€)', 'Tip (€)',
      'Notes', 'Manager',
    ];
    const rows = bills.map(b => [
      new Date(b.bill_date).toLocaleDateString('de-DE'),
      b.bill_number || '',
      BILL_TYPE_LABELS[b.bill_type] || b.bill_type,
      b.table_number || '',
      b.payment_status,
      PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method,
      String(Number(b.cash_amount).toFixed(2)),
      String(Number(b.card_amount).toFixed(2)),
      String(Number(b.paypal_amount).toFixed(2)),
      String(Number(b.total_amount).toFixed(2)),
      String(Number(b.discount || 0).toFixed(2)),
      String(Number(b.tip_amount || 0).toFixed(2)),
      b.notes || '',
      b.profiles?.full_name || '',
    ]);
    downloadCSV(`bills_${dateFrom}_to_${dateTo}.csv`, headers, rows);
  }

  function exportExpensesCSV() {
    const headers = [
      'Date', 'Category', 'Description',
      'Amount (€)', 'Paid From', 'Notes', 'Manager',
    ];
    const rows = expenses.map(e => [
      new Date(e.expense_date).toLocaleDateString('de-DE'),
      CATEGORY_LABELS[e.category] || e.category,
      e.description || '',
      String(Number(e.amount).toFixed(2)),
      e.paid_from || '',
      e.notes || '',
      e.profiles?.full_name || '',
    ]);
    downloadCSV(`expenses_${dateFrom}_to_${dateTo}.csv`, headers, rows);
  }

  function exportSummaryCSV() {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Report Period', `${dateFrom} to ${dateTo}`],
      ['Total Bills', String(bills.length)],
      ['Paid Bills', String(paidBills.length)],
      ['Cash Income (€)', totalCashIncome.toFixed(2)],
      ['Card Income (€)', totalCardIncome.toFixed(2)],
      ['PayPal Income (€)', totalPaypalIncome.toFixed(2)],
      ['Bill Income Total (€)', totalIncome.toFixed(2)],
      ['Online Delivery Sales (€)', totalOnlineSales.toFixed(2)],
      ['Online Delivery Cash (€)', totalOnlineCash.toFixed(2)],
      ['Online Delivery Digital (€)', totalOnlineDigital.toFixed(2)],
      ['Total Revenue (€)', totalRevenue.toFixed(2)],
      ['Total Tips (€)', totalTips.toFixed(2)],
      ['Total Discounts (€)', totalDiscount.toFixed(2)],
      ['Total Expenses (€)', totalExpenses.toFixed(2)],
      ['Cash Expenses (€)', cashExpenses.toFixed(2)],
      ['Net Profit (€)', netProfit.toFixed(2)],
      ['Net Cash (€)', netCash.toFixed(2)],
    ];
    downloadCSV(`summary_${dateFrom}_to_${dateTo}.csv`, headers, rows);
  }

  // ── Render ─────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-500 text-sm mt-1">
              {isAdmin ? 'Full business overview' : 'Your personal shift report'}
            </p>
          </div>
          {/* Export buttons */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={exportSummaryCSV}
              className="text-xs px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
            >
              ⬇ Summary CSV
            </button>
            <button
              onClick={exportBillsCSV}
              className="text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ⬇ Bills CSV
            </button>
            <button
              onClick={exportExpensesCSV}
              className="text-xs px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
            >
              ⬇ Expenses CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Filters
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {isAdmin && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Manager</label>
                <select
                  value={filterManager}
                  onChange={e => setFilterManager(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Managers</option>
                  {managers.map(m => (
                    <option key={m.id} value={m.id}>{m.full_name || m.email || 'Unnamed manager'}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bill Type</label>
              <select
                value={filterBillType}
                onChange={e => setFilterBillType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="table">Table</option>
                <option value="parcel">Parcel</option>
                <option value="abholung">Abholung</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment</label>
              <select
                value={filterPaymentMethod}
                onChange={e => setFilterPaymentMethod(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Methods</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="paypal">PayPal</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense Cat.</label>
              <select
                value={filterExpenseCategory}
                onChange={e => setFilterExpenseCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Categories</option>
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading report data...</div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
              <KpiCard label="Total Revenue" value={totalRevenue} color="green" icon="📈" />
              <KpiCard label="Bill Income" value={totalIncome} color="green" icon="🧾" />
              <KpiCard label="Online Delivery" value={totalOnlineSales} color="blue" icon="🚀" />
              <KpiCard label="Total Expenses" value={totalExpenses} color="red" icon="💸" />
              <KpiCard label="Net Profit" value={netProfit} color={netProfit >= 0 ? 'green' : 'red'} icon="💰" />
              <KpiCard label="Net Cash" value={netCash} color={netCash >= 0 ? 'green' : 'red'} icon="💵" />
              <KpiCard label="Tips Collected" value={totalTips} color="orange" icon="🪙" />
              <KpiCard label="Total Discounts" value={totalDiscount} color="indigo" icon="🏷️" />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{bills.length}</div>
                <div className="text-xs text-gray-500 mt-1">Total Bills</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{paidBills.length}</div>
                <div className="text-xs text-gray-500 mt-1">Paid Bills</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{expenses.length}</div>
                <div className="text-xs text-gray-500 mt-1">Expense Records</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{onlineEntries.length}</div>
                <div className="text-xs text-gray-500 mt-1">Delivery Entries</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
              {(['summary', 'income', 'expenses', 'online'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize
                    ${activeTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  {tab === 'summary' ? '📊 Summary' : tab === 'income' ? '🧾 Bills' : tab === 'expenses' ? '💸 Expenses' : '🚀 Online'}
                </button>
              ))}
            </div>

            {/* Tab: Summary */}
            {activeTab === 'summary' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Bill type breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Bills by Type</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Type</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Count</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {byBillType.map(row => (
                        <tr key={row.type}>
                          <td className="px-4 py-2.5 text-gray-700">
                            {row.type === 'table' ? '🍽️' : row.type === 'parcel' ? '📦' : '🛵'}{' '}
                            {BILL_TYPE_LABELS[row.type]}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{row.count}</td>
                          <td className="px-4 py-2.5 text-right text-green-600 font-semibold">
                            €{row.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Payment method breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Income by Payment Method</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Method</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Amount</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">% of Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        { label: '💵 Cash', value: totalCashIncome },
                        { label: '💳 Card', value: totalCardIncome },
                        { label: '🅿️ PayPal', value: totalPaypalIncome },
                      ].map(row => (
                        <tr key={row.label}>
                          <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                          <td className="px-4 py-2.5 text-right text-green-600 font-semibold">
                            €{row.value.toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500">
                            {totalIncome > 0
                              ? ((row.value / totalIncome) * 100).toFixed(1) + '%'
                              : '0%'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Online delivery breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden lg:col-span-2">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">🚀 Online Delivery</h3>
                  </div>
                  {byPlatform.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-400 text-sm">No delivery entries in this period.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Platform</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Days</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Cash</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Digital</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Total Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {byPlatform.map(row => (
                          <tr key={row.platform}>
                            <td className="px-4 py-2.5 text-gray-700">{PLATFORM_LABELS[row.platform] || row.platform}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{row.entries.length}</td>
                            <td className="px-4 py-2.5 text-right text-green-600 font-medium">€{row.totalCash.toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right text-blue-600 font-medium">€{(row.totalSales - row.totalCash).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-900 font-semibold">€{row.totalSales.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-2.5 text-gray-700">Total</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{onlineEntries.length}</td>
                          <td className="px-4 py-2.5 text-right text-green-600">€{totalOnlineCash.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-blue-600">€{totalOnlineDigital.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-900">€{totalOnlineSales.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Expense category breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden lg:col-span-2">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Expenses by Category</h3>
                  </div>
                  {byCategory.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-400 text-sm">
                      No expenses in this period.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Category</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Count</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Total</th>
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">% of Expenses</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {byCategory.map(row => (
                          <tr key={row.cat}>
                            <td className="px-4 py-2.5 text-gray-700">{CATEGORY_LABELS[row.cat] || row.cat}</td>
                            <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{row.count}</td>
                            <td className="px-4 py-2.5 text-right text-red-600 font-semibold">€{row.total.toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-500">
                              {totalExpenses > 0 ? ((row.total / totalExpenses) * 100).toFixed(1) + '%' : '0%'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Net Cash Balance summary */}
                <div className="bg-gray-900 rounded-xl p-5 text-white lg:col-span-2">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                    Period Summary — {dateFrom} to {dateTo}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Income</div>
                      <SummaryLine label="Bill Cash Income" value={totalCashIncome} />
                      <SummaryLine label="Bill Card Income" value={totalCardIncome} />
                      <SummaryLine label="Bill PayPal Income" value={totalPaypalIncome} />
                      <SummaryLine label="Online Delivery Cash" value={totalOnlineCash} />
                      <SummaryLine label="Online Delivery Digital" value={totalOnlineDigital} />
                      <SummaryLine label="Tips" value={totalTips} />
                      <div className="border-t border-gray-700 pt-2 mt-2 flex justify-between font-semibold">
                        <span className="text-white">Total Revenue</span>
                        <span className="text-green-400">€{totalRevenue.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Outflow</div>
                      <SummaryLine label="Cash Expenses" value={cashExpenses} isDeduction />
                      <SummaryLine label="Other Expenses" value={totalExpenses - cashExpenses} isDeduction />
                      <div className="border-t border-gray-700 pt-2 mt-2 flex justify-between font-semibold">
                        <span className="text-white">Total Expenses</span>
                        <span className="text-red-400">-€{totalExpenses.toFixed(2)}</span>
                      </div>
                      <div className="border-t border-gray-700 pt-2 mt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Net Profit</span>
                          <span className={netProfit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                            €{netProfit.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Net Cash (physical)</span>
                          <span className={netCash >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                            €{netCash.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Bills */}
            {activeTab === 'income' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    All Bills — {bills.length} record(s)
                  </h3>
                  <button
                    onClick={exportBillsCSV}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    ⬇ Export CSV
                  </button>
                </div>
                {bills.length === 0 ? (
                  <div className="px-4 py-10 text-center text-gray-400 text-sm">
                    No bills found for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Date</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Bill #</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Type</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Status</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Method</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Cash</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Card</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">PayPal</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Total</th>
                          {isAdmin && (
                            <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Manager</th>
                          )}
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Tip 🪙</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bills.map(bill => (
                          <tr key={bill.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap text-xs">
                              {new Date(bill.bill_date).toLocaleDateString('de-DE')}
                            </td>
                            <td className="px-3 py-2.5 text-gray-900">
                              {bill.bill_number || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {BILL_TYPE_LABELS[bill.bill_type] || bill.bill_type}
                              {bill.table_number ? ` (T${bill.table_number})` : ''}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[bill.payment_status] || ''}`}>
                                {bill.payment_status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 capitalize">
                              {PAYMENT_METHOD_LABELS[bill.payment_method] || bill.payment_method}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-900">
                              €{Number(bill.cash_amount || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-900">
                              €{Number(bill.card_amount || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-900">
                              €{Number(bill.paypal_amount || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-green-600">
                              €{Number(bill.total_amount || 0).toFixed(2)}
                            </td>
                            {isAdmin && (
                              <td className="px-3 py-2.5 text-gray-600 text-xs">
                                {bill.profiles?.full_name || '—'}
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right">
                              {Number(bill.tip_amount) > 0 ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                  🪙 €{Number(bill.tip_amount).toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Totals row */}
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={isAdmin ? 5 : 4} className="px-3 py-3 text-xs font-semibold text-gray-600">
                            TOTAL ({paidBills.length} paid)
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-gray-900">
                            €{totalCashIncome.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-gray-900">
                            €{totalCardIncome.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-gray-900">
                            €{totalPaypalIncome.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-green-600">
                            €{totalIncome.toFixed(2)}
                          </td>
                          {isAdmin && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Expenses */}
            {activeTab === 'expenses' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    All Expenses — {expenses.length} record(s)
                  </h3>
                  <button
                    onClick={exportExpensesCSV}
                    className="text-xs text-orange-600 hover:underline"
                  >
                    ⬇ Export CSV
                  </button>
                </div>
                {expenses.length === 0 ? (
                  <div className="px-4 py-10 text-center text-gray-400 text-sm">
                    No expenses found for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Date</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Category</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Description</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Paid From</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Amount</th>
                          {isAdmin && (
                            <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Manager</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {expenses.map(exp => (
                          <tr key={exp.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap text-xs">
                              {new Date(exp.expense_date).toLocaleDateString('de-DE')}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {CATEGORY_LABELS[exp.category] || exp.category}
                            </td>
                            <td className="px-3 py-2.5 text-gray-900">
                              <div>{exp.description}</div>
                              {exp.notes && (
                                <div className="text-xs text-gray-400">{exp.notes}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 capitalize">
                              {exp.paid_from}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-red-600">
                              €{Number(exp.amount).toFixed(2)}
                            </td>
                            {isAdmin && (
                              <td className="px-3 py-2.5 text-gray-600 text-xs">
                                {exp.profiles?.full_name || '—'}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={isAdmin ? 4 : 3} className="px-3 py-3 text-xs font-semibold text-gray-600">
                            TOTAL
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-red-600">
                            €{totalExpenses.toFixed(2)}
                          </td>
                          {isAdmin && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Online Delivery */}
            {activeTab === 'online' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Online Delivery — {onlineEntries.length} entries
                  </h3>
                </div>
                {onlineEntries.length === 0 ? (
                  <div className="px-4 py-10 text-center text-gray-400 text-sm">
                    No delivery entries found for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Date</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Platform</th>
                          {isAdmin && <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Manager</th>}
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Cash</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Digital</th>
                          <th className="text-right px-3 py-3 text-xs text-gray-500 font-medium">Total Sales</th>
                          <th className="text-left px-3 py-3 text-xs text-gray-500 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {onlineEntries.map(entry => (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap text-xs">
                              {entry.entry_date}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {PLATFORM_LABELS[entry.platform] || entry.platform}
                            </td>
                            {isAdmin && (
                              <td className="px-3 py-2.5 text-gray-600 text-xs">
                                {managers.find(m => m.id === entry.created_by)?.full_name || '—'}
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right text-green-600 font-medium">
                              €{Number(entry.cash_amount).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-blue-600 font-medium">
                              €{(Number(entry.total_sales) - Number(entry.cash_amount)).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                              €{Number(entry.total_sales).toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-gray-400 text-xs">
                              {entry.notes || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={isAdmin ? 3 : 2} className="px-3 py-3 text-xs font-semibold text-gray-600">
                            TOTAL
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-green-600">
                            €{totalOnlineCash.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-blue-600">
                            €{totalOnlineDigital.toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-gray-900">
                            €{totalOnlineSales.toFixed(2)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// ── KPI card ───────────────────────────────────────────
function KpiCard({ label, value, color, icon }: {
  label: string;
  value: number;
  color: 'green' | 'red' | 'blue' | 'indigo' | 'orange';
  icon: string;
}) {
  const colorMap = {
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colorMap[color]}`}>
      <div className="text-xl mb-1">{icon}</div>
      <div className="text-base font-bold leading-tight">€{value.toFixed(2)}</div>
      <div className="text-xs mt-0.5 opacity-75">{label}</div>
    </div>
  );
}

function SummaryLine({ label, value, isDeduction }: { label: string; value: number; isDeduction?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={isDeduction ? 'text-red-400' : 'text-gray-200'}>
        {isDeduction ? '-' : ''}€{value.toFixed(2)}
      </span>
    </div>
  );
}
