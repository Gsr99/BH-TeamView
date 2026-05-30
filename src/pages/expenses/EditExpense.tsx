import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateTimeInputValueFromValue, localInputToISO } from '../../lib/datetime';

const CATEGORIES = [
  { value: 'driver_pay', label: 'Driver Pay' },
  { value: 'diesel_fuel', label: 'Diesel / Fuel' },
  { value: 'grocery', label: 'Grocery' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'vehicle_maintenance', label: 'Vehicle Maintenance' },
  { value: 'restaurant_maintenance', label: 'Restaurant Maintenance' },
  { value: 'staff_payment', label: 'Staff Payment' },
  { value: 'other', label: 'Other' },
];

const PAID_FROM_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'other', label: 'Other' },
];

export default function EditExpense() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [originalValues, setOriginalValues] = useState<any>(null);

  const [form, setForm] = useState({
    expense_date: '',
    category: 'driver_pay',
    amount: '',
    paid_from: 'cash',
    description: '',
    notes: '',
  });

  useEffect(() => {
    if (profile?.role !== 'admin') { navigate('/expenses'); return; }
    async function fetchExpense() {
      const { data, error } = await supabase.from('expenses').select('*').eq('id', id).single();
      if (error || !data) { setError('Expense not found.'); setFetchLoading(false); return; }
      setOriginalValues(data);
      setForm({
        expense_date: localDateTimeInputValueFromValue(data.expense_date),
        category: data.category,
        amount: String(data.amount),
        paid_from: data.paid_from,
        description: data.description || '',
        notes: data.notes || '',
      });
      setFetchLoading(false);
    }
    fetchExpense();
  }, [id, profile, navigate]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) { setError('Amount must be positive.'); return; }
    setLoading(true);
    try {
      const { data: updated, error: updateError } = await supabase.from('expenses').update({
        expense_date: localInputToISO(form.expense_date),
        category: form.category,
        amount: Number(form.amount),
        paid_from: form.paid_from,
        description: form.description || null,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select('id');

      if (updateError) throw updateError;
      if (!updated || updated.length === 0) throw new Error('Update failed: you may not have permission to edit this expense.');

      await supabase.from('audit_logs').insert({
        user_id: user!.id,
        action: 'UPDATE',
        table_name: 'expenses',
        record_id: id,
        old_values: originalValues,
        new_values: { ...form, amount: Number(form.amount) },
      });

      setSuccess('Expense updated successfully!');
      setTimeout(() => navigate('/expenses'), 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to update expense.');
    } finally {
      setLoading(false);
    }
  }

  if (fetchLoading) return <Layout><div className="text-center py-12 text-gray-400">Loading...</div></Layout>;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Edit Expense</h1>
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            ⚠️ Admin correction — this change will be recorded in the audit log.
          </p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>}

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time *</label>
            <input type="datetime-local" name="expense_date" value={form.expense_date} onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <select name="category" value={form.category} onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (€) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">€</span>
              <input type="number" name="amount" value={form.amount} onChange={handleChange} placeholder="0.00" min="0.01" step="0.01"
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid From *</label>
            <select name="paid_from" value={form.paid_from} onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PAID_FROM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" name="description" value={form.description} onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => navigate('/expenses')}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium transition-colors">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
