import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKey, localDateKeyFromValue, localDayToUTCRange } from '../../lib/datetime';
import { fetchKnownUsers } from '../../lib/users';

export default function CashBalance() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedManager, setSelectedManager] = useState('');
  const [managers, setManagers] = useState<any[]>([]);

  const [data, setData] = useState({
    cashIncome: 0,
    cardIncome: 0,
    paypalIncome: 0,
    onlineDeliveryCash: 0,
    cashExpenses: 0,
    totalExpenses: 0,
    billCount: 0,
    expenseCount: 0,
  });

  const [session, setSession] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState('');
  const [handoverAmount, setHandoverAmount] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [autoFillInfo, setAutoFillInfo] = useState<{ date: string; amount: number } | null>(null);

  useEffect(() => {
    if (isAdmin) fetchManagers();
    else setSelectedManager(user?.id || '');
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!isAdmin || isAdmin) fetchData();
  }, [selectedDate, selectedManager]);

  async function fetchManagers() {
    try {
      const managerRows = await fetchKnownUsers({ includeAdmins: false });
      setManagers(managerRows);
      // Default to "All Managers" — don't auto-select first
      if (managerRows.length === 0) {
        setLoading(false);
      }
    } catch {
      setManagers([]);
      setLoading(false);
    }
  }

  async function fetchPreviousDayEndingCash(managerId: string, beforeDate: string): Promise<{ amount: number; date: string } | null> {
    // Find the most recent session before the selected date
    const { data: prevSession } = await supabase
      .from('manager_cash_sessions')
      .select('*')
      .eq('created_by', managerId)
      .lt('session_date', beforeDate)
      .order('session_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!prevSession) return null;

    const prevDate: string = prevSession.session_date;
    const { start: dateStart, end: dateEnd } = localDayToUTCRange(prevDate);

    // Fetch that day's paid bills for cash income
    const { data: prevBills } = await supabase
      .from('bills')
      .select('cash_amount, payment_status')
      .eq('created_by', managerId)
      .eq('is_deleted', false)
      .gte('bill_date', dateStart)
      .lte('bill_date', dateEnd)
      .neq('payment_status', 'cancelled');

    const prevCashIncome = (prevBills || [])
      .filter((b: any) => b.payment_status === 'paid' || b.payment_status === 'partial')
      .reduce((s: number, b: any) => s + (Number(b.cash_amount) || 0), 0);

    // Fetch that day's cash expenses
    const { data: prevExpenses } = await supabase
      .from('expenses')
      .select('amount, paid_from, expense_date')
      .eq('created_by', managerId);

    const prevCashExpenses = (prevExpenses || [])
      .filter((e: any) => localDateKeyFromValue(e.expense_date) === prevDate && String(e.paid_from).toLowerCase() === 'cash')
      .reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

    // Fetch that day's online delivery cash
    const { data: prevOnline } = await supabase
      .from('online_delivery_entries')
      .select('cash_amount')
      .eq('created_by', managerId)
      .eq('entry_date', prevDate);

    const prevOnlineCash = (prevOnline || [])
      .reduce((s: number, e: any) => s + (Number(e.cash_amount) || 0), 0);

    const prevOpening  = Number(prevSession.opening_cash)  || 0;
    const prevHandover = Number(prevSession.cash_handover)  || 0;
    const prevAdjust   = Number(prevSession.adjustment)     || 0;

    const endingCash = prevOpening + prevCashIncome + prevOnlineCash - prevCashExpenses - prevHandover + prevAdjust;
    return { amount: endingCash, date: prevDate };
  }

  async function fetchData() {
    setLoading(true);
    const allManagers = isAdmin && !selectedManager;
    const managerId = allManagers ? null : (selectedManager || user?.id || null);
    const { start: dateStart, end: dateEnd } = localDayToUTCRange(selectedDate);

    try {
      // Bills for the day
      let billsQ = supabase
        .from('bills')
        .select('cash_amount, card_amount, paypal_amount, payment_status')
        .eq('is_deleted', false)
        .gte('bill_date', dateStart)
        .lte('bill_date', dateEnd)
        .neq('payment_status', 'cancelled');
      if (managerId) billsQ = billsQ.eq('created_by', managerId);
      const { data: bills } = await billsQ;

      // Expenses for the day
      let expQ = supabase.from('expenses').select('amount, paid_from, expense_date');
      if (managerId) expQ = expQ.eq('created_by', managerId);
      const { data: allExp } = await expQ;
      const expenses = (allExp || []).filter(e => localDateKeyFromValue(e.expense_date) === selectedDate);

      // Online delivery cash for the day
      let onlineQ = supabase.from('online_delivery_entries').select('cash_amount').eq('entry_date', selectedDate);
      if (managerId) onlineQ = onlineQ.eq('created_by', managerId);
      const { data: onlineEntries } = await onlineQ;

      const paidBills = (bills || []).filter(b => b.payment_status === 'paid' || b.payment_status === 'partial');
      const cashIncome      = paidBills.reduce((s, b) => s + (Number(b.cash_amount) || 0), 0);
      const cardIncome      = paidBills.reduce((s, b) => s + (Number(b.card_amount) || 0), 0);
      const paypalIncome    = paidBills.reduce((s, b) => s + (Number(b.paypal_amount) || 0), 0);
      const cashExpenses    = expenses.filter(e => String(e.paid_from).toLowerCase() === 'cash').reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const totalExpenses   = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const onlineDeliveryCash = (onlineEntries || []).reduce((s, e: any) => s + (Number(e.cash_amount) || 0), 0);

      setData({ cashIncome, cardIncome, paypalIncome, onlineDeliveryCash, cashExpenses, totalExpenses, billCount: (bills || []).length, expenseCount: expenses.length });

      if (allManagers) {
        // Aggregate all managers' sessions for opening / handover / adjustment
        const { data: allSessions } = await supabase
          .from('manager_cash_sessions')
          .select('opening_cash, cash_handover, adjustment')
          .eq('session_date', selectedDate);
        const sumOpening  = (allSessions || []).reduce((s, sess) => s + (Number(sess.opening_cash)  || 0), 0);
        const sumHandover = (allSessions || []).reduce((s, sess) => s + (Number(sess.cash_handover) || 0), 0);
        const sumAdjust   = (allSessions || []).reduce((s, sess) => s + (Number(sess.adjustment)   || 0), 0);
        setSession(null);
        setOpeningCash(sumOpening.toFixed(2));
        setHandoverAmount(sumHandover.toFixed(2));
        setAdjustment(sumAdjust.toFixed(2));
        setAdjustmentNote('');
        setAutoFillInfo(null);
      } else if (managerId) {
        // Individual manager session
        const { data: existingSession } = await supabase
          .from('manager_cash_sessions')
          .select('*')
          .eq('created_by', managerId)
          .eq('session_date', selectedDate)
          .maybeSingle();

        if (existingSession) {
          setSession(existingSession);
          setOpeningCash(String(existingSession.opening_cash || 0));
          setHandoverAmount(String(existingSession.cash_handover || 0));
          setAdjustment(String(existingSession.adjustment || 0));
          setAdjustmentNote(existingSession.adjustment_note || '');
          setAutoFillInfo(null);
        } else {
          setSession(null);
          const prev = await fetchPreviousDayEndingCash(managerId, selectedDate);
          if (prev && prev.amount > 0) {
            setOpeningCash(prev.amount.toFixed(2));
            setAutoFillInfo(prev);
          } else {
            setOpeningCash('0');
            setAutoFillInfo(null);
          }
          setHandoverAmount('0');
          setAdjustment('0');
          setAdjustmentNote('');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Formula:
  // Ending Cash = Opening Cash + Cash Income - Cash Expenses - Cash Handover + Adjustment
  const openingCashNum = parseFloat(openingCash) || 0;
  const handoverNum = parseFloat(handoverAmount) || 0;
  const adjustmentNum = parseFloat(adjustment) || 0;

  const endingCash =
    openingCashNum +
    data.cashIncome +
    data.onlineDeliveryCash -
    data.cashExpenses -
    handoverNum +
    adjustmentNum;

  async function saveSession() {
    setSaving(true);
    setMessage('');
    setError('');
    const managerId = selectedManager || user?.id;

    try {
      const sessionData = {
        created_by: managerId,
        session_date: selectedDate,
        opening_cash: openingCashNum,
        cash_handover: handoverNum,
        adjustment: adjustmentNum,
        adjustment_note: adjustmentNote || null,
        status: 'open',
      };

      let result;
      if (session?.id) {
        result = await supabase
          .from('manager_cash_sessions')
          .update(sessionData)
          .eq('id', session.id);
      } else {
        result = await supabase
          .from('manager_cash_sessions')
          .insert(sessionData);
      }

      if (result.error) throw result.error;

      // Audit log
      await supabase.from('audit_logs').insert({
        action: session?.id ? 'UPDATE' : 'CREATE',
        table_name: 'manager_cash_sessions',
        performed_by: user?.id,
        details: `Cash session saved for ${selectedDate}. Ending balance: €${endingCash.toFixed(2)}`,
      });

      setMessage('Cash session saved successfully!');
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to save session.');
    } finally {
      setSaving(false);
    }
  }

  async function closeShift() {
    if (!session?.id) {
      setError('Please save the session first before closing the shift.');
      return;
    }
    setSaving(true);
    try {
      await supabase
        .from('manager_cash_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', session.id);

      await supabase.from('audit_logs').insert({
        action: 'CLOSE_SHIFT',
        table_name: 'manager_cash_sessions',
        performed_by: user?.id,
        details: `Shift closed for ${selectedDate}. Final cash: €${endingCash.toFixed(2)}`,
      });

      setMessage('Shift closed successfully!');
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to close shift.');
    } finally {
      setSaving(false);
    }
  }

  const isClosed = session?.status === 'closed';

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Balance</h1>
          <p className="text-gray-500 text-sm mt-1">Manager shift cash calculation</p>
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
                  <option key={m.id} value={m.id}>{m.full_name || m.email || 'Unnamed manager'}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
        ) : (
          <>
            {/* Session status badge */}
            {session && (
              <div className={`rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2
                ${isClosed
                  ? 'bg-gray-100 text-gray-600'
                  : 'bg-blue-50 text-blue-700'
                }`}>
                {isClosed ? '🔒 Shift is closed' : '🟢 Shift is open'}
                {isClosed && session.closed_at && (
                  <span className="text-xs font-normal text-gray-400 ml-1">
                    Closed at {new Date(session.closed_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}

            {/* Income breakdown */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Income — {data.billCount} bill(s)
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                <BalanceRow label="💵 Cash Income (Bills)" value={data.cashIncome} color="green" />
                <BalanceRow label="🚀 Online Delivery Cash" value={data.onlineDeliveryCash} color="green" />
                <BalanceRow label="💳 Card Income" value={data.cardIncome} color="indigo" note="Does not affect cash balance" />
                <BalanceRow label="🅿️ PayPal Income" value={data.paypalIncome} color="blue" note="Does not affect cash balance" />
              </div>
            </div>

            {/* Expenses breakdown */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Expenses — {data.expenseCount} record(s)
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                <BalanceRow label="💸 Cash Expenses" value={data.cashExpenses} color="red" isDeduction />
                <BalanceRow label="📊 Total All Expenses" value={data.totalExpenses} color="orange" note="All payment methods combined" />
              </div>
            </div>

            {/* Admin read-only notice */}
            {isAdmin && !selectedManager && (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-sm">
                📊 Showing aggregated data for all managers. Session details (opening cash, handover, adjustment) are summed from each manager's saved session.
              </div>
            )}
            {isAdmin && selectedManager && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 text-sm">
                👁️ Admin view — read only. Only the assigned manager can edit this session.
              </div>
            )}

            {/* Manual inputs */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Session Details
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">

                {/* Opening cash */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Opening Cash (€) <span className="text-gray-400 text-xs">— Cash at start of shift</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">€</span>
                    <input
                      type="number"
                      value={openingCash}
                      onChange={e => { setOpeningCash(e.target.value); setAutoFillInfo(null); }}
                      disabled={isClosed || isAdmin}
                      min="0"
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                  {autoFillInfo && (
                    <div className="mt-2 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                      <span className="text-base">🔄</span>
                      <span>
                        Auto-filled from <strong>{autoFillInfo.date}</strong> ending balance —{' '}
                        <strong>€{autoFillInfo.amount.toFixed(2)}</strong>. You can edit this if needed.
                      </span>
                    </div>
                  )}
                </div>

                {/* Cash handed over */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cash Handed Over to Admin (€)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">€</span>
                    <input
                      type="number"
                      value={handoverAmount}
                      onChange={e => setHandoverAmount(e.target.value)}
                      disabled={isClosed || isAdmin}
                      min="0"
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                </div>

                {/* Adjustment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Adjustment (€) <span className="text-gray-400 text-xs">— Use negative to deduct</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">€</span>
                    <input
                      type="number"
                      value={adjustment}
                      onChange={e => setAdjustment(e.target.value)}
                      disabled={isClosed || isAdmin}
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                </div>

                {/* Adjustment note */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Adjustment Note <span className="text-gray-400 text-xs">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={adjustmentNote}
                    onChange={e => setAdjustmentNote(e.target.value)}
                    disabled={isClosed || isAdmin}
                    placeholder="Reason for adjustment..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              </div>
            </div>

            {/* Formula summary */}
            <div className="bg-gray-900 rounded-xl p-5 text-white space-y-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Cash Balance Formula
              </h2>
              <FormulaRow label="Opening Cash" value={openingCashNum} />
              <FormulaRow label="+ Cash Income (Bills)" value={data.cashIncome} />
              <FormulaRow label="+ Online Delivery Cash" value={data.onlineDeliveryCash} />
              <FormulaRow label="− Cash Expenses" value={-data.cashExpenses} />
              <FormulaRow label="− Cash Handed Over" value={-handoverNum} />
              <FormulaRow label="± Adjustment" value={adjustmentNum} />
              <div className="border-t border-gray-700 pt-3 mt-3 flex justify-between items-center">
                <span className="text-sm font-semibold text-white">= Ending Cash Balance</span>
                <span className={`text-xl font-bold ${endingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  €{endingCash.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-gray-500 pt-1">
                Card (€{data.cardIncome.toFixed(2)}) and PayPal (€{data.paypalIncome.toFixed(2)}) income not included — see Daily Summary for full revenue.
              </p>
            </div>

            {/* Error / Success */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}
            {message && (
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
                {message}
              </div>
            )}

            {/* Action buttons — manager only */}
            {!isAdmin && !isClosed && (
              <div className="flex gap-3 pb-6">
                <button
                  onClick={saveSession}
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : '💾 Save Session'}
                </button>
                <button
                  onClick={closeShift}
                  disabled={saving}
                  className="flex-1 bg-gray-800 text-white rounded-xl py-3 text-sm font-semibold hover:bg-gray-900 disabled:opacity-50 transition-colors"
                >
                  🔒 Close Shift
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// Row in balance breakdown
function BalanceRow({ label, value, color, isDeduction, note }: {
  label: string;
  value: number;
  color: string;
  isDeduction?: boolean;
  note?: string;
}) {
  const colorMap: Record<string, string> = {
    green: 'text-green-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    orange: 'text-orange-600',
  };
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        {note && <div className="text-xs text-gray-400">{note}</div>}
      </div>
      <span className={`font-semibold text-sm ${colorMap[color] || 'text-gray-900'}`}>
        {isDeduction ? '-' : ''}€{value.toFixed(2)}
      </span>
    </div>
  );
}

// Row in formula summary
function FormulaRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={value < 0 ? 'text-red-400' : 'text-gray-200'}>
        {value < 0 ? `-€${Math.abs(value).toFixed(2)}` : `€${value.toFixed(2)}`}
      </span>
    </div>
  );
}
