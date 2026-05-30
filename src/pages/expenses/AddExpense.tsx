import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateTimeInputValue, localInputToISO } from '../../lib/datetime';

const EXPENSE_CATEGORIES = [
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

export default function AddExpense() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    category: '',
    amount: '',
    paid_from: '',
    description: '',
    notes: '',
    expense_date: localDateTimeInputValue(),
  });

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      setError('Receipt image must be smaller than 5MB.');
      return;
    }

    // Only images
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed (JPG, PNG, WEBP).');
      return;
    }

    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setError('');
  }

  function validate() {
    if (!form.category) return 'Please select an expense category.';
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)
      return 'Please enter a valid amount greater than 0.';
    if (!form.paid_from) return 'Please select how this expense was paid.';
    if (!form.description.trim()) return 'Please enter a description.';
    return '';
  }

  async function uploadReceipt(userId: string): Promise<string | null> {
    if (!receiptFile) return null;

    const fileExt = receiptFile.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(fileName, receiptFile, { upsert: false });

    if (uploadError) {
      throw new Error('Receipt upload failed: ' + uploadError.message);
    }

    // Return the path (not a public URL since bucket is private)
    return fileName;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    setError('');

    try {
      if (!user?.id) {
        throw new Error('You must be signed in to create an expense.');
      }

      let receiptPath: string | null = null;

      if (receiptFile) {
        receiptPath = await uploadReceipt(user.id);
      }

      const { error: insertError } = await supabase.from('expenses').insert({
        category: form.category,
        amount: parseFloat(form.amount),
        paid_from: form.paid_from,
        description: form.description.trim(),
        notes: form.notes.trim() || null,
        expense_date: localInputToISO(form.expense_date),
        created_by: user.id,
        receipt_url: receiptPath,
      });

      if (insertError) throw insertError;

      // Audit log
      await supabase.from('audit_logs').insert({
        action: 'CREATE',
        table_name: 'expenses',
        performed_by: user.id,
        details: `Expense created: ${form.category} €${form.amount}`,
      });

      setSuccess('Expense saved successfully!');
      setTimeout(() => navigate('/expenses'), 1500);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Add New Expense</h1>
          <p className="text-gray-500 text-sm mt-1">Fill in the details below to record an expense.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">

          {/* Date & Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time</label>
            <input
              type="datetime-local"
              name="expense_date"
              value={form.expense_date}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expense Category <span className="text-red-500">*</span></label>
            <select
              name="category"
              value={form.category}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select category...</option>
              {EXPENSE_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (€) <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500 text-sm">€</span>
              <input
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                min="0.01"
                step="0.01"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Paid From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid From <span className="text-red-500">*</span></label>
            <select
              name="paid_from"
              value={form.paid_from}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select payment source...</option>
              {PAID_FROM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="e.g. Diesel for delivery car"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Any extra details..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Receipt Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Image <span className="text-gray-400">(optional, max 5MB)</span></label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                id="receipt-upload"
              />
              <label htmlFor="receipt-upload" className="cursor-pointer">
                {receiptPreview ? (
                  <div className="space-y-2">
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      className="max-h-48 mx-auto rounded-lg object-contain"
                    />
                    <p className="text-xs text-blue-600">Click to change image</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-3xl">📷</div>
                    <p className="text-sm text-gray-600">Click to upload receipt</p>
                    <p className="text-xs text-gray-400">JPG, PNG, WEBP up to 5MB</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* Error / Success */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
              {success}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/expenses')}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
