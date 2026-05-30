import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Layout from '../../components/layout/Layout'
import { localDateTimeInputValue, localInputToISO } from '../../lib/datetime'

export default function AddBill() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    bill_number: `BILL-${Date.now()}`,
    bill_type: 'table',
    table_number: '',
    customer_note: '',
    total_amount: '',
    discount: '0',
    tip_amount: '',
    payment_status: 'paid',
    payment_method: 'cash',
    cash_amount: '',
    card_amount: '',
    paypal_amount: '',
    notes: '',
    bill_date: localDateTimeInputValue(),
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const validateForm = () => {
    const total = parseFloat(form.total_amount)
    const discount = parseFloat(form.discount) || 0
    const tip = parseFloat(form.tip_amount) || 0
    const cash = parseFloat(form.cash_amount) || 0
    const card = parseFloat(form.card_amount) || 0
    const paypal = parseFloat(form.paypal_amount) || 0

    if (!form.total_amount || total < 0) {
      return 'Total amount must be 0 or more.'
    }

    if (discount > total) {
      return 'Discount cannot be more than total amount.'
    }

    // Customer pays bill (after discount) + tip in one transaction
    const expectedPayment = total - discount + tip

    if (form.payment_status === 'paid') {
      if (form.payment_method === 'cash' && Math.abs(cash - expectedPayment) > 0.01) {
        return `Cash amount must equal €${expectedPayment.toFixed(2)} (bill €${(total - discount).toFixed(2)} + tip €${tip.toFixed(2)})`
      }
      if (form.payment_method === 'card' && Math.abs(card - expectedPayment) > 0.01) {
        return `Card amount must equal €${expectedPayment.toFixed(2)} (bill €${(total - discount).toFixed(2)} + tip €${tip.toFixed(2)})`
      }
      if (form.payment_method === 'paypal' && Math.abs(paypal - expectedPayment) > 0.01) {
        return `PayPal amount must equal €${expectedPayment.toFixed(2)} (bill €${(total - discount).toFixed(2)} + tip €${tip.toFixed(2)})`
      }
      if (form.payment_method === 'mixed') {
        const mixedTotal = cash + card + paypal
        if (Math.abs(mixedTotal - expectedPayment) > 0.01) {
          return `Cash + Card + PayPal must equal €${expectedPayment.toFixed(2)} (bill €${(total - discount).toFixed(2)} + tip €${tip.toFixed(2)}, currently €${mixedTotal.toFixed(2)})`
        }
      }
    }

    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    const total = parseFloat(form.total_amount)
    const discount = parseFloat(form.discount) || 0
    const paidAmount = form.payment_status === 'paid' ? total - discount : 0

    try {
      if (!user?.id) {
        throw new Error('You must be signed in to create a bill.')
      }

      const { error } = await supabase.from('bills').insert({
        bill_number: form.bill_number,
        bill_type: form.bill_type,
        table_number: form.bill_type === 'table' ? form.table_number : null,
        customer_note: form.customer_note || null,
        total_amount: total,
        discount: discount,
        tip_amount: parseFloat(form.tip_amount) || 0,
        paid_amount: paidAmount,
        payment_status: form.payment_status,
        payment_method: form.payment_status === 'unpaid' ? null : form.payment_method,
        cash_amount: parseFloat(form.cash_amount) || 0,
        card_amount: parseFloat(form.card_amount) || 0,
        paypal_amount: parseFloat(form.paypal_amount) || 0,
        notes: form.notes || null,
        created_by: user.id,
        bill_date: localInputToISO(form.bill_date),
      })

      if (error) throw error

      // Log audit
      await supabase.from('audit_logs').insert({
        action: 'CREATE',
        table_name: 'bills',
        new_data: { bill_number: form.bill_number, total_amount: total },
        performed_by: user.id,
      })

      setSuccess('Bill created successfully!')
      setTimeout(() => {
        const path = '/bills'
        navigate(path)
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Failed to create bill.')
    } finally {
      setLoading(false)
    }
  }

  const billAmount = (parseFloat(form.total_amount) || 0) - (parseFloat(form.discount) || 0)
  const tipAmount = parseFloat(form.tip_amount) || 0
  const totalToCollect = billAmount + tipAmount

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Add New Bill</h1>
          <p className="text-gray-500 text-sm mt-1">Create a new table, parcel, or abholung bill</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

          {/* Bill number and date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill Number</label>
              <input
                name="bill_number"
                value={form.bill_number}
                onChange={handleChange}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                name="bill_date"
                value={form.bill_date}
                onChange={handleChange}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Bill type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bill Type</label>
            <div className="grid grid-cols-3 gap-3">
              {['table', 'parcel', 'abholung'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, bill_type: type })}
                  className={`py-3 rounded-lg border-2 text-sm font-medium capitalize transition-colors ${
                    form.bill_type === type
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {type === 'table' ? '🍽️ Table' : type === 'parcel' ? '📦 Parcel' : '🚗 Abholung'}
                </button>
              ))}
            </div>
          </div>

          {/* Table number - only show if bill type is table */}
          {form.bill_type === 'table' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Table Number</label>
              <input
                name="table_number"
                value={form.table_number}
                onChange={handleChange}
                placeholder="e.g. Table 5"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Customer note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer / Order Note (optional)</label>
            <input
              name="customer_note"
              value={form.customer_note}
              onChange={handleChange}
              placeholder="e.g. Special request, customer name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Total and discount */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (€)</label>
              <input
                type="number"
                name="total_amount"
                value={form.total_amount}
                onChange={handleChange}
                required
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount (€)</label>
              <input
                type="number"
                name="discount"
                value={form.discount}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Amount to pay */}
          {form.total_amount && (
            <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm space-y-0.5">
              <div className="text-blue-700 font-medium">
                Total to collect: €{totalToCollect.toFixed(2)}
              </div>
              {tipAmount > 0 && (
                <div className="text-blue-500 text-xs">
                  Bill €{billAmount.toFixed(2)} + Tip €{tipAmount.toFixed(2)}
                </div>
              )}
            </div>
          )}

          {/* Payment status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
            <select
              name="payment_status"
              value={form.payment_status}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Payment method - only show if not unpaid or cancelled */}
          {form.payment_status !== 'unpaid' && form.payment_status !== 'cancelled' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {['cash', 'card', 'paypal', 'mixed'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setForm({ ...form, payment_method: method })}
                      className={`py-2.5 rounded-lg border-2 text-sm font-medium capitalize transition-colors ${
                        form.payment_method === method
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {method === 'cash' ? '💵 Cash' : method === 'card' ? '💳 Card' : method === 'paypal' ? '🅿️ PayPal' : '🔀 Mixed'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment amounts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(form.payment_method === 'cash' || form.payment_method === 'mixed') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cash Amount (€)</label>
                    <input
                      type="number"
                      name="cash_amount"
                      value={form.cash_amount}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                {(form.payment_method === 'card' || form.payment_method === 'mixed') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Card Amount (€)</label>
                    <input
                      type="number"
                      name="card_amount"
                      value={form.card_amount}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                {(form.payment_method === 'paypal' || form.payment_method === 'mixed') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PayPal Amount (€)</label>
                    <input
                      type="number"
                      name="paypal_amount"
                      value={form.paypal_amount}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Tip */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🪙</span>
              <label className="text-sm font-semibold text-amber-800">
                Customer Tip <span className="font-normal text-amber-600 text-xs">(optional)</span>
              </label>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-amber-500 text-sm font-medium">€</span>
              <input
                type="number"
                name="tip_amount"
                value={form.tip_amount}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full border border-amber-300 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white text-amber-900 placeholder-amber-300"
              />
            </div>
            {parseFloat(form.tip_amount) > 0 && (
              <p className="text-xs text-amber-600 mt-2">
                💛 Tip of €{(parseFloat(form.tip_amount) || 0).toFixed(2)} will be recorded separately from the bill total.
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Any additional notes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Bill'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
