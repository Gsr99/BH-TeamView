import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKeyFromValue } from '../../lib/datetime';
import { fetchKnownUsers } from '../../lib/users';
import type { KnownUser } from '../../lib/users';

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

const PAID_FROM_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank: 'Bank Transfer',
  paypal: 'PayPal',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  driver_pay: 'bg-purple-100 text-purple-700',
  diesel_fuel: 'bg-orange-100 text-orange-700',
  grocery: 'bg-green-100 text-green-700',
  drinks: 'bg-blue-100 text-blue-700',
  packaging: 'bg-yellow-100 text-yellow-700',
  vehicle_maintenance: 'bg-red-100 text-red-700',
  restaurant_maintenance: 'bg-pink-100 text-pink-700',
  staff_payment: 'bg-indigo-100 text-indigo-700',
  other: 'bg-gray-100 text-gray-700',
};

export default function ExpensesList() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPaidFrom, setFilterPaidFrom] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterManager, setFilterManager] = useState('all');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [knownUsers, setKnownUsers] = useState<Record<string, KnownUser>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editRequests, setEditRequests] = useState<Record<string, any>>({});
  const [managerRequests, setManagerRequests] = useState<Record<string, any>>({});
  const [requestModal, setRequestModal] = useState<{ expId: string; action: 'edit' | 'delete'; managerId: string } | null>(null);
  const [requestReason, setRequestReason] = useState('');
  const [requestingId, setRequestingId] = useState<string | null>(null);

  useEffect(() => {
    fetchExpenses();
  }, []);

  async function fetchExpenses() {
    setLoading(true);
    if (profile?.role === 'admin') {
      const { data: requests } = await supabase
        .from('edit_requests')
        .select('*')
        .eq('request_type', 'expense')
        .in('status', ['pending', 'approved']);
      const reqMap: Record<string, any> = {};
      (requests || []).forEach(r => {
        if (!reqMap[r.record_id] || r.status === 'approved') reqMap[r.record_id] = r;
      });
      setEditRequests(reqMap);
    } else {
      const { data: mgrReqs } = await supabase
        .from('edit_requests')
        .select('*')
        .eq('request_type', 'expense')
        .eq('record_manager_id', user?.id)
        .eq('status', 'pending');
      const mgrMap: Record<string, any> = {};
      (mgrReqs || []).forEach(r => { mgrMap[r.record_id] = r; });
      setManagerRequests(mgrMap);
    }
    let query = supabase
      .from('expenses')
      .select('*, profiles(full_name)')
      .order('expense_date', { ascending: false });

    // Only admins see every manager's expenses.
    if (profile?.role !== 'admin') {
      query = query.eq('created_by', user?.id);
    }

    const [{ data, error }, users] = await Promise.all([
      query,
      profile?.role === 'admin' ? fetchKnownUsers({ includeAdmins: true }) : Promise.resolve([]),
    ]);
    if (!error && data) setExpenses(data);
    setKnownUsers(Object.fromEntries(users.map(user => [user.id, user])));
    setLoading(false);
  }

  async function submitRequest() {
    if (!requestModal) return;
    setRequestingId(requestModal.expId);
    try {
      await supabase.from('edit_requests').insert({
        request_type: 'expense',
        record_id: requestModal.expId,
        action: requestModal.action,
        reason: requestReason || null,
        record_manager_id: requestModal.managerId,
        requested_by: user?.id,
      });
      await fetchExpenses();
    } catch (err) {
      console.error('Failed to submit request:', err);
    } finally {
      setRequestingId(null);
      setRequestModal(null);
      setRequestReason('');
    }
  }

  async function reviewRequest(requestId: string, recordId: string, status: 'approved' | 'rejected') {
    await supabase
      .from('edit_requests')
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', requestId);
    setManagerRequests(prev => { const next = { ...prev }; delete next[recordId]; return next; });
  }

  async function handleDelete(exp: any) {
    setDeletingId(exp.id);
    try {
      await supabase.from('expenses').delete().eq('id', exp.id);
      await supabase.from('audit_logs').insert({
        action: 'DELETE',
        table_name: 'expenses',
        performed_by: user?.id,
        old_data: { description: exp.description, amount: exp.amount, category: exp.category },
      });
      setExpenses(prev => prev.filter(e => e.id !== exp.id));
    } catch (err) {
      console.error('Failed to delete expense:', err);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function viewReceipt(receiptPath: string) {
    setPreviewLoading(true);
    const { data } = await supabase.storage
      .from('receipts')
      .createSignedUrl(receiptPath, 60); // 60 second signed URL

    if (data?.signedUrl) {
      setPreviewUrl(data.signedUrl);
    }
    setPreviewLoading(false);
  }

  const filtered = expenses.filter(exp => {
    const matchSearch =
      exp.description?.toLowerCase().includes(search.toLowerCase()) ||
      exp.notes?.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory ? exp.category === filterCategory : true;
    const matchPaidFrom = filterPaidFrom ? exp.paid_from === filterPaidFrom : true;
    const matchDate = filterDate ? localDateKeyFromValue(exp.expense_date) === filterDate : true;
    const matchManager = filterManager === 'all' || exp.created_by === filterManager;
    return matchSearch && matchCategory && matchPaidFrom && matchDate && matchManager;
  });

  const totalFiltered = filtered.reduce((sum, e) => sum + (e.amount || 0), 0);

  function getManagerName(exp: any) {
    const knownUser = knownUsers[exp.created_by];
    return exp.profiles?.full_name || knownUser?.full_name || knownUser?.email || `User ${String(exp.created_by || '').slice(0, 8)}` || '—';
  }

  return (
    <Layout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
            <p className="text-gray-500 text-sm mt-1">
              {filtered.length} record{filtered.length !== 1 ? 's' : ''} — Total: <span className="font-semibold text-red-600">€{totalFiltered.toFixed(2)}</span>
            </p>
          </div>
          <button
            onClick={() => navigate('/expenses/add')}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add Expense
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Search description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterPaidFrom}
            onChange={e => setFilterPaidFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Payment Sources</option>
            {Object.entries(PAID_FROM_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {profile?.role === 'admin' && (
            <select
              value={filterManager}
              onChange={e => setFilterManager(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Managers</option>
              {Object.values(knownUsers)
                .filter(u => u.role === 'manager' || u.role === 'admin')
                .map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email || u.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm">Loading expenses...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-4xl mb-2">🧾</div>
              <p className="text-gray-500 text-sm">No expenses found.</p>
              <button
                onClick={() => navigate('/expenses/add')}
                className="mt-3 text-blue-600 text-sm hover:underline"
              >
                Add your first expense
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Category</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Description</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Paid From</th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">Amount</th>
                    {profile?.role === 'admin' && (
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Manager</th>
                    )}
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">Receipt</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(exp => (
                    <tr key={exp.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(exp.expense_date).toLocaleDateString('de-DE', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${CATEGORY_COLORS[exp.category] || 'bg-gray-100 text-gray-700'}`}>
                          {CATEGORY_LABELS[exp.category] || exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        <div>{exp.description}</div>
                        {exp.notes && <div className="text-xs text-gray-400 mt-0.5">{exp.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {PAID_FROM_LABELS[exp.paid_from] || exp.paid_from}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">
                        €{Number(exp.amount).toFixed(2)}
                      </td>
                      {profile?.role === 'admin' && (
                        <td className="px-4 py-3 text-gray-600">
                          {getManagerName(exp)}
                        </td>
                      )}
                      <td className="px-4 py-3 text-center">
                        {exp.receipt_url ? (
                          <button
                            onClick={() => viewReceipt(exp.receipt_url)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            View
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {profile?.role === 'admin' ? (
                          (() => {
                            const req = editRequests[exp.id];
                            if (req?.status === 'approved' && req.action === 'edit') {
                              return (
                                <button onClick={() => navigate(`/expenses/${exp.id}/edit`)}
                                  className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors">
                                  ✅ Edit Now
                                </button>
                              );
                            }
                            if (req?.status === 'approved' && req.action === 'delete') {
                              return (
                                <button onClick={() => setConfirmDeleteId(exp.id)}
                                  className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors">
                                  ✅ Delete Now
                                </button>
                              );
                            }
                            if (req?.status === 'pending') {
                              return (
                                <span className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 border border-yellow-200">
                                  ⏳ {req.action === 'edit' ? 'Edit' : 'Delete'} Pending
                                </span>
                              );
                            }
                            return (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setRequestModal({ expId: exp.id, action: 'edit', managerId: exp.created_by }); setRequestReason(''); }}
                                  className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                                  Request Edit
                                </button>
                                <button
                                  onClick={() => { setRequestModal({ expId: exp.id, action: 'delete', managerId: exp.created_by }); setRequestReason(''); }}
                                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                                  Request Delete
                                </button>
                              </div>
                            );
                          })()
                        ) : (
                          (() => {
                            const req = managerRequests[exp.id];
                            if (!req) return <span className="text-gray-300 text-xs">—</span>;
                            return (
                              <div className="flex items-center gap-1.5">
                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded mr-1">
                                  {req.action === 'edit' ? '✏️ Edit' : '🗑️ Delete'} requested
                                </div>
                                <button
                                  onClick={() => reviewRequest(req.id, exp.id, 'approved')}
                                  className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-medium transition-colors">
                                  Approve
                                </button>
                                <button
                                  onClick={() => reviewRequest(req.id, exp.id, 'rejected')}
                                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition-colors">
                                  Reject
                                </button>
                              </div>
                            );
                          })()
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Request Modal */}
      {requestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Request {requestModal.action === 'edit' ? 'Edit' : 'Delete'} Approval
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              The manager will review and approve this request before you can proceed.
            </p>
            <textarea
              value={requestReason}
              onChange={e => setRequestReason(e.target.value)}
              placeholder="Reason for this request (optional)..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRequestModal(null); setRequestReason(''); }}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitRequest}
                disabled={requestingId === requestModal.expId}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {requestingId === requestModal.expId ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Expense?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This expense will be permanently removed. This action is logged in the audit trail.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const exp = expenses.find(e => e.id === confirmDeleteId);
                  if (exp) handleDelete(exp);
                }}
                disabled={deletingId === confirmDeleteId}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {deletingId === confirmDeleteId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Preview Modal */}
      {(previewUrl || previewLoading) && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="bg-white rounded-xl max-w-lg w-full p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-900">Receipt</h3>
              <button onClick={() => setPreviewUrl(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            {previewLoading ? (
              <div className="text-center py-10 text-gray-400 text-sm">Loading receipt...</div>
            ) : (
              <img src={previewUrl!} alt="Receipt" className="w-full rounded-lg object-contain max-h-[70vh]" />
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
