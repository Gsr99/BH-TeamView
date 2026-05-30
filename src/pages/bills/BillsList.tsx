import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Layout from '../../components/layout/Layout'
import { localDateKeyFromValue } from '../../lib/datetime'
import { fetchKnownUsers } from '../../lib/users'
import type { KnownUser } from '../../lib/users'

export default function BillsList() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [bills, setBills] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDate, setFilterDate] = useState('')
  const [filterManager, setFilterManager] = useState('all')
  const [knownUsers, setKnownUsers] = useState<Record<string, KnownUser>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editRequests, setEditRequests] = useState<Record<string, any>>({})
  const [managerRequests, setManagerRequests] = useState<Record<string, any>>({})
  const [requestModal, setRequestModal] = useState<{ billId: string; action: 'edit' | 'delete'; managerId: string } | null>(null)
  const [requestReason, setRequestReason] = useState('')
  const [requestingId, setRequestingId] = useState<string | null>(null)

  useEffect(() => {
    fetchBills()
  }, [])

  const fetchBills = async () => {
    try {
      if (profile?.role === 'admin') {
        // Admin: fetch their own requests (pending + approved) to show status
        const { data: requests } = await supabase
          .from('edit_requests')
          .select('*')
          .eq('request_type', 'bill')
          .in('status', ['pending', 'approved'])
        const reqMap: Record<string, any> = {}
        ;(requests || []).forEach(r => {
          if (!reqMap[r.record_id] || r.status === 'approved') reqMap[r.record_id] = r
        })
        setEditRequests(reqMap)
      } else {
        // Manager: fetch pending requests on their bills so they can approve/reject inline
        const { data: mgrReqs } = await supabase
          .from('edit_requests')
          .select('*')
          .eq('request_type', 'bill')
          .eq('record_manager_id', user?.id)
          .eq('status', 'pending')
        const mgrMap: Record<string, any> = {}
        ;(mgrReqs || []).forEach(r => { mgrMap[r.record_id] = r })
        setManagerRequests(mgrMap)
      }

      let query = supabase
        .from('bills')
        .select('*, profiles(full_name)')
        .eq('is_deleted', false)
        .order('bill_date', { ascending: false })

      if (profile?.role !== 'admin') {
        query = query.eq('created_by', user?.id)
      }

      const [{ data, error }, users] = await Promise.all([
        query,
        profile?.role === 'admin' ? fetchKnownUsers({ includeAdmins: true }) : Promise.resolve([]),
      ])
      if (error) throw error
      setBills(data || [])
      setKnownUsers(Object.fromEntries(users.map(user => [user.id, user])))
    } catch (error) {
      console.error('Error fetching bills:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (bill: any) => {
    setDeletingId(bill.id)
    try {
      await supabase.from('bills').update({ is_deleted: true }).eq('id', bill.id)
      await supabase.from('audit_logs').insert({
        action: 'DELETE',
        table_name: 'bills',
        performed_by: user?.id,
        old_data: { bill_number: bill.bill_number, total_amount: bill.total_amount },
      })
      setBills(prev => prev.filter(b => b.id !== bill.id))
    } catch (err) {
      console.error('Failed to delete bill:', err)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const submitRequest = async () => {
    if (!requestModal) return
    setRequestingId(requestModal.billId)
    try {
      await supabase.from('edit_requests').insert({
        request_type: 'bill',
        record_id: requestModal.billId,
        action: requestModal.action,
        reason: requestReason || null,
        record_manager_id: requestModal.managerId,
        requested_by: user?.id,
      })
      await fetchBills()
    } catch (err) {
      console.error('Failed to submit request:', err)
    } finally {
      setRequestingId(null)
      setRequestModal(null)
      setRequestReason('')
    }
  }

  const reviewRequest = async (requestId: string, recordId: string, status: 'approved' | 'rejected') => {
    await supabase
      .from('edit_requests')
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', requestId)
    setManagerRequests(prev => { const next = { ...prev }; delete next[recordId]; return next })
  }

  const filteredBills = bills.filter((bill) => {
    const matchSearch =
      bill.bill_number.toLowerCase().includes(search.toLowerCase()) ||
      bill.customer_note?.toLowerCase().includes(search.toLowerCase())
    const matchType = filterType === 'all' || bill.bill_type === filterType
    const matchStatus = filterStatus === 'all' || bill.payment_status === filterStatus
    const matchDate = filterDate ? localDateKeyFromValue(bill.bill_date) === filterDate : true
    const matchManager = filterManager === 'all' || bill.created_by === filterManager
    return matchSearch && matchType && matchStatus && matchDate && matchManager
  })

  const formatCurrency = (amount: number) => `€${amount.toFixed(2)}`

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      paid: 'bg-green-100 text-green-700',
      unpaid: 'bg-red-100 text-red-700',
      partial: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-gray-100 text-gray-500',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || ''}`}>
        {status}
      </span>
    )
  }

  const getTypeBadge = (type: string) => {
    const icons: Record<string, string> = {
      table: '🍽️',
      parcel: '📦',
      abholung: '🚗',
    }
    return `${icons[type] || ''} ${type}`
  }

  const getManagerName = (bill: any) => {
    const knownUser = knownUsers[bill.created_by]
    return bill.profiles?.full_name || knownUser?.full_name || knownUser?.email || `User ${String(bill.created_by || '').slice(0, 8)}` || '-'
  }

  const addBillPath = '/bills/add'

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bills</h1>
          <p className="text-gray-500 text-sm mt-1">{filteredBills.length} bills found</p>
        </div>
        <button
          onClick={() => navigate(addBillPath)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          + Add Bill
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Search bill number or note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="table">Table</option>
            <option value="parcel">Parcel</option>
            <option value="abholung">Abholung</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
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
      </div>

      {/* Bills table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-3 text-left">Bill #</th>
                <th className="px-4 py-3 text-left">Type</th>
                {profile?.role === 'admin' && <th className="px-4 py-3 text-left">Manager</th>}
                <th className="px-4 py-3 text-left">Total</th>
                <th className="px-4 py-3 text-left">Paid</th>
                <th className="px-4 py-3 text-left">Tip 🪙</th>
                <th className="px-4 py-3 text-left">Method</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  </td>
                </tr>
              ) : filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    No bills found
                  </td>
                </tr>
              ) : (
                filteredBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-blue-600">{bill.bill_number}</td>
                    <td className="px-4 py-3 capitalize">{getTypeBadge(bill.bill_type)}</td>
                    {profile?.role === 'admin' && (
                      <td className="px-4 py-3">{getManagerName(bill)}</td>
                    )}
                    <td className="px-4 py-3 font-medium">{formatCurrency(bill.total_amount)}</td>
                    <td className="px-4 py-3">{formatCurrency(bill.paid_amount)}</td>
                    <td className="px-4 py-3">
                      {Number(bill.tip_amount) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          🪙 €{Number(bill.tip_amount).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize">{bill.payment_method || '-'}</td>
                    <td className="px-4 py-3">{getStatusBadge(bill.payment_status)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(bill.bill_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {profile?.role === 'admin' ? (
                        (() => {
                          const req = editRequests[bill.id]
                          if (req?.status === 'approved' && req.action === 'edit') {
                            return (
                              <button onClick={() => navigate(`/bills/${bill.id}/edit`)}
                                className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors">
                                ✅ Edit Now
                              </button>
                            )
                          }
                          if (req?.status === 'approved' && req.action === 'delete') {
                            return (
                              <button onClick={() => setConfirmDeleteId(bill.id)}
                                className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors">
                                ✅ Delete Now
                              </button>
                            )
                          }
                          if (req?.status === 'pending') {
                            return (
                              <span className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 border border-yellow-200">
                                ⏳ {req.action === 'edit' ? 'Edit' : 'Delete'} Pending
                              </span>
                            )
                          }
                          return (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { setRequestModal({ billId: bill.id, action: 'edit', managerId: bill.created_by }); setRequestReason('') }}
                                className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                                Request Edit
                              </button>
                              <button
                                onClick={() => { setRequestModal({ billId: bill.id, action: 'delete', managerId: bill.created_by }); setRequestReason('') }}
                                className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                                Request Delete
                              </button>
                            </div>
                          )
                        })()
                      ) : (
                        (() => {
                          const req = managerRequests[bill.id]
                          if (!req) return <span className="text-gray-300 text-xs">—</span>
                          return (
                            <div className="flex items-center gap-1.5">
                              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded mr-1">
                                {req.action === 'edit' ? '✏️ Edit' : '🗑️ Delete'} requested
                              </div>
                              <button
                                onClick={() => reviewRequest(req.id, bill.id, 'approved')}
                                className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-medium transition-colors">
                                Approve
                              </button>
                              <button
                                onClick={() => reviewRequest(req.id, bill.id, 'rejected')}
                                className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition-colors">
                                Reject
                              </button>
                            </div>
                          )
                        })()
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
                onClick={() => { setRequestModal(null); setRequestReason('') }}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitRequest}
                disabled={requestingId === requestModal.billId}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {requestingId === requestModal.billId ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Bill?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This bill will be permanently removed. This action is logged in the audit trail.
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
                  const bill = bills.find(b => b.id === confirmDeleteId)
                  if (bill) handleDelete(bill)
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
    </Layout>
  )
}
